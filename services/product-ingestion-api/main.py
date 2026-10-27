from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import PurePosixPath
from typing import Any, Literal
from urllib.parse import quote, urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from partner_api import PartnerError, PartnerGateway, partner_error_response, router as partner_router


EXPLICIT_PRICE = re.compile(r"(?:\u20a6|\bngn\b|\bnaira\b|\bprice\b|\bcost\b|\bfor\b|\bat\b|\bN(?=\s*\d)|#)\s*(\d+(?:[,.]\d+)?)\s*([km])?\b", re.I)
SCALED_PRICE = re.compile(r"\b(\d+(?:[,.]\d+)?)\s*([km])\b", re.I)
ALLOWED_CATEGORIES = {"electronics", "fashion", "home", "phones", "beauty", "sports", "dropship", "other"}
CATEGORY_ALIASES = {
    "phones & accessories": "phones", "phones & tablets": "phones",
    "home & kitchen": "home", "home & furniture": "home",
    "beauty & health": "beauty", "computers & laptops": "electronics",
}


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be configured.")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    supabase_url: str
    service_role_key: str
    hmac_secret: str
    whatsapp_seller_id: str
    telegram_seller_id: str
    media_bucket: str
    markup_percent: int
    whatsapp_shipping_fee: int
    default_location: str
    allowed_media_hosts: frozenset[str]
    max_media_bytes: int
    max_request_bytes: int
    vision_api_key: str | None
    vision_api_base_url: str
    vision_model: str
    relay_url: str | None
    relay_secret: str | None
    public_site_url: str

    @classmethod
    def from_env(cls) -> "Settings":
        # Accept "res.cloudinary.com" as well as pasted URLs such as
        # "https://res.cloudinary.com/<cloud>/"; an empty value must not
        # silently reject every media item.
        hosts = frozenset(
            (urlparse(item.strip() if "://" in item else f"https://{item.strip()}").hostname or "").lower()
            for item in (os.getenv("INGESTION_ALLOWED_MEDIA_HOSTS") or "res.cloudinary.com").split(",")
            if item.strip()
        ) - {""} or frozenset({"res.cloudinary.com"})
        return cls(
            supabase_url=required("SUPABASE_URL").rstrip("/"),
            service_role_key=required("SUPABASE_SERVICE_ROLE_KEY"),
            hmac_secret=required("INGESTION_HMAC_SECRET"),
            whatsapp_seller_id=required("WHATSAPP_LISTINGS_SELLER_ID"),
            telegram_seller_id=required("TELEGRAM_LISTINGS_SELLER_ID"),
            media_bucket=os.getenv("PRODUCT_MEDIA_BUCKET", "product-media").strip() or "product-media",
            markup_percent=max(0, min(100, int(os.getenv("INGESTION_PRICE_MARKUP_PERCENT", "20")))),
            whatsapp_shipping_fee=max(0, int(os.getenv("WHATSAPP_LISTING_SHIPPING_FEE", "2500"))),
            default_location=(os.getenv("INGESTION_DEFAULT_LOCATION", "Nigeria").strip() or "Nigeria")[:100],
            allowed_media_hosts=hosts,
            max_media_bytes=max(250_000, min(25_000_000, int(os.getenv("MAX_INGEST_MEDIA_BYTES", "8388608")))),
            max_request_bytes=max(1_000_000, min(40_000_000, int(os.getenv("MAX_INGEST_REQUEST_BYTES", "12000000")))),
            vision_api_key=os.getenv("VISION_API_KEY", "").strip() or os.getenv("GROQ_API_KEY", "").strip() or None,
            vision_api_base_url=os.getenv("VISION_API_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/"),
            vision_model=os.getenv("VISION_MODEL", os.getenv("GROQ_MODEL", "llama-3.2-11b-vision-preview")).strip(),
            relay_url=os.getenv("BOT3_RELAY_URL", "").strip() or None,
            relay_secret=os.getenv("BOT3_RELAY_SECRET", "").strip() or None,
            public_site_url=os.getenv("PUBLIC_SITE_URL", "").strip().rstrip("/"),
        )


class MediaInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["image", "video"]
    content_type: str = ""
    url: str | None = None
    data_base64: str | None = None

    @model_validator(mode="after")
    def one_source(self) -> "MediaInput":
        if bool(self.url) == bool(self.data_base64):
            raise ValueError("Each media item needs exactly one of url or data_base64.")
        return self

    @field_validator("content_type")
    @classmethod
    def normalize_content_type(cls, value: str) -> str:
        return value.split(";", 1)[0].strip().lower()[:100]


class ProductIngress(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_platform: Literal["whatsapp", "telegram"]
    source_message_id: str = Field(min_length=8, max_length=300)
    sender_id: str = Field(min_length=1, max_length=200)
    sender_phone: str | None = Field(default=None, max_length=30)
    sender_username: str | None = Field(default=None, max_length=100)
    sender_first_name: str | None = Field(default=None, max_length=120)
    group_jid: str | None = Field(default=None, max_length=200)
    manage_token: str | None = Field(default=None, max_length=200)
    title: str = Field(default="", max_length=300)
    description: str = Field(default="", max_length=2_000)
    price: int | float | str | None = None
    category: str = Field(default="other", max_length=80)
    location: str = Field(default="", max_length=100)
    specs: str = Field(default="", max_length=500)
    negotiable: bool = False
    media: list[MediaInput] = Field(default_factory=list, max_length=12)

    @field_validator("source_message_id", "sender_id", "title", "description", "location", "specs", mode="before")
    @classmethod
    def strip_text(cls, value: Any) -> str:
        return str(value or "").strip()

    @model_validator(mode="after")
    def source_rules(self) -> "ProductIngress":
        if self.source_platform == "whatsapp":
            if not self.group_jid or not re.fullmatch(r"[0-9-]{10,80}@g[.]us", self.group_jid):
                raise ValueError("WhatsApp submissions require a valid group_jid.")
            if not self.manage_token or len(self.manage_token) < 24:
                raise ValueError("WhatsApp submissions require a management token.")
        return self


@dataclass(slots=True)
class ResolvedMedia:
    kind: str
    content_type: str
    data: bytes
    fingerprint: str


def api_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def parse_naira(value: Any) -> int | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        amount = int(round(float(value)))
        return amount if 1 <= amount <= 99_995_000 else None
    raw = str(value or "").strip().lower().replace("\u20a6", "").replace("ngn", "").replace("naira", "")
    raw = raw.replace(",", "").replace(" ", "")
    match = re.fullmatch(r"(\d+(?:\.\d+)?)([km])?", raw)
    if not match:
        return None
    try:
        multiplier = Decimal("1000") if match.group(2) == "k" else Decimal("1000000") if match.group(2) == "m" else Decimal("1")
        amount = int(Decimal(match.group(1)) * multiplier)
    except InvalidOperation:
        return None
    return amount if 1 <= amount <= 99_995_000 else None


def price_from_text(text: str) -> int | None:
    for pattern in (EXPLICIT_PRICE, SCALED_PRICE):
        for match in pattern.finditer(text or ""):
            amount = parse_naira(f"{match.group(1)}{match.group(2) or ''}")
            if amount:
                return amount
    return None


def category_for(value: str) -> str:
    normalized = CATEGORY_ALIASES.get(str(value or "").strip().lower(), str(value or "").strip().lower())
    return normalized if normalized in ALLOWED_CATEGORIES else "other"


def strip_price(text: str) -> str:
    clean = re.sub(r"(?:\bprice\b|\bcost\b|\bfor\b|\bat\b|\u20a6|\bngn\b|\bnaira\b|\bN(?=\s*\d)|#)\s*\d+(?:[,.]\d+)?\s*[km]?\b", "", text or "", flags=re.I)
    clean = SCALED_PRICE.sub("", clean)
    return clean.strip(" \t\n-:,;")


class SupabaseGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0))
        self.headers = {"apikey": settings.service_role_key, "Authorization": f"Bearer {settings.service_role_key}"}

    async def close(self) -> None:
        await self.client.aclose()

    async def existing(self, payload: ProductIngress) -> dict[str, Any] | None:
        if payload.source_platform == "whatsapp":
            table, column = "whatsapp_listing_meta", "source_message_id"
        else:
            table, column = "telegram_product_submissions", "source_listing_id"
        response = await self.client.get(
            f"{self.settings.supabase_url}/rest/v1/{table}",
            headers=self.headers,
            params={"select": "product_id,products(id,name,price,status)", column: f"eq.{payload.source_message_id}"},
        )
        response.raise_for_status()
        rows = response.json()
        return {"product_id": rows[0]["product_id"], "product": rows[0].get("products") or {"id": rows[0]["product_id"]}} if rows else None

    async def upload_media(self, path: PurePosixPath, media: ResolvedMedia) -> str:
        response = await self.client.post(
            f"{self.settings.supabase_url}/storage/v1/object/{self.settings.media_bucket}/{path}",
            headers={**self.headers, "Content-Type": media.content_type, "x-upsert": "true"},
            content=media.data,
        )
        response.raise_for_status()
        return f"{self.settings.supabase_url}/storage/v1/object/public/{self.settings.media_bucket}/{quote(str(path), safe='/')}"

    async def register_telegram_user(self, payload: ProductIngress) -> None:
        response = await self.client.post(
            f"{self.settings.supabase_url}/rest/v1/telegram_users?on_conflict=telegram_id",
            headers={**self.headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"},
            json={"telegram_id": int(payload.sender_id), "username": payload.sender_username or None,
                  "first_name": payload.sender_first_name or None, "last_seen_at": datetime.now(UTC).isoformat()},
        )
        response.raise_for_status()

    async def insert_product(self, record: dict[str, Any]) -> dict[str, Any]:
        response = await self.client.post(
            f"{self.settings.supabase_url}/rest/v1/products",
            headers={**self.headers, "Content-Type": "application/json", "Prefer": "return=representation"}, json=record,
        )
        response.raise_for_status()
        return response.json()[0]

    async def delete_product(self, product_id: str) -> None:
        await self.client.delete(f"{self.settings.supabase_url}/rest/v1/products?id=eq.{product_id}", headers=self.headers)

    async def record_private_price(self, product_id: str, seller_price: int, source: str, seller_id: str) -> None:
        response = await self.client.post(
            f"{self.settings.supabase_url}/rest/v1/product_seller_pricing?on_conflict=product_id",
            headers={**self.headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"},
            json={"product_id": product_id, "seller_price": seller_price, "source": source, "recorded_by": seller_id},
        )
        response.raise_for_status()

    async def record_source(self, payload: ProductIngress, product_id: str, source_price: int, markup: int) -> None:
        if payload.source_platform == "whatsapp":
            table = "whatsapp_listing_meta"
            body = {"product_id": product_id, "source_message_id": payload.source_message_id, "group_jid": payload.group_jid,
                    "sender_jid": payload.sender_id, "sender_phone": payload.sender_phone or None,
                    "manage_token_hash": hashlib.sha256((payload.manage_token or "").encode()).hexdigest(),
                    "source_price": source_price, "price_markup": markup}
        else:
            table = "telegram_product_submissions"
            body = {"product_id": product_id, "telegram_id": int(payload.sender_id), "telegram_username": payload.sender_username or None,
                    "source_listing_id": payload.source_message_id, "seller_price": source_price,
                    "price_markup_percent": self.settings.markup_percent}
        response = await self.client.post(
            f"{self.settings.supabase_url}/rest/v1/{table}", headers={**self.headers, "Content-Type": "application/json"}, json=body,
        )
        response.raise_for_status()


async def resolve_media(item: MediaInput, settings: Settings, client: httpx.AsyncClient) -> ResolvedMedia:
    if item.data_base64:
        try:
            data = base64.b64decode(item.data_base64, validate=True)
        except ValueError as error:
            raise api_error(422, "invalid_media", "A media item is not valid base64.") from error
        content_type = item.content_type
    else:
        parsed = urlparse(item.url or "")
        if parsed.scheme != "https" or parsed.hostname not in settings.allowed_media_hosts:
            raise api_error(422, "invalid_media_url", "The submitted media host is not allowed.")
        async with client.stream("GET", item.url, follow_redirects=False, headers={"Accept": "image/*,video/*"}) as response:
            if response.status_code != 200:
                raise api_error(422, "media_unavailable", "The submitted media could not be downloaded.")
            declared_size = int(response.headers.get("content-length") or 0)
            if declared_size > settings.max_media_bytes:
                raise api_error(422, "media_too_large", "A media item exceeds the allowed size.")
            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                total += len(chunk)
                if total > settings.max_media_bytes:
                    raise api_error(422, "media_too_large", "A media item exceeds the allowed size.")
                chunks.append(chunk)
            data = b"".join(chunks)
        content_type = item.content_type or response.headers.get("content-type", "").split(";", 1)[0].lower()
    if not data:
        raise api_error(422, "invalid_media", "A media item was empty.")
    expected_prefix = "image/" if item.kind == "image" else "video/"
    if not content_type.startswith(expected_prefix):
        content_type = "image/jpeg" if item.kind == "image" else "video/mp4"
    return ResolvedMedia(item.kind, content_type, data, hashlib.sha256(data).hexdigest())


async def vision_fallback(settings: Settings, title: str, description: str, images: list[ResolvedMedia]) -> tuple[str, str, str]:
    if not settings.vision_api_key or not images or (title and description):
        return title, description, "other"
    image = images[0]
    encoded = base64.b64encode(image.data).decode("ascii")
    body = {
        "model": settings.vision_model,
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
        "max_tokens": 400,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "Return JSON only with title, description, and suggested_category for this marketplace product. Do not include a price. Allowed categories: electronics, fashion, home, phones, beauty, sports, dropship, other."},
            {"type": "image_url", "image_url": {"url": f"data:{image.content_type};base64,{encoded}"}},
        ]}],
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
            response = await client.post(
                f"{settings.vision_api_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {settings.vision_api_key}", "Content-Type": "application/json"}, json=body,
            )
            response.raise_for_status()
        parsed = json.loads(response.json()["choices"][0]["message"]["content"])
    except Exception:
        return title, description, "other"
    return (
        title or str(parsed.get("title") or "").strip()[:300],
        description or str(parsed.get("description") or "").strip()[:2000],
        category_for(str(parsed.get("suggested_category") or "other")),
    )


async def send_bot3_relay(settings: Settings, payload: dict[str, Any]) -> None:
    if not settings.relay_url or not settings.relay_secret:
        return
    raw = json.dumps(payload, separators=(",", ":")).encode()
    timestamp = str(int(time.time()))
    signature = hmac.new(settings.relay_secret.encode(), f"{timestamp}.".encode() + raw, hashlib.sha256).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                settings.relay_url, content=raw,
                headers={"Content-Type": "application/json", "x-relay-timestamp": timestamp, "x-relay-signature": signature},
            )
    except Exception:
        # Catalog notifications are best effort; product persistence is not.
        return


async def signed_payload(request: Request, settings: Settings) -> ProductIngress:
    raw = await request.body()
    if len(raw) > settings.max_request_bytes:
        raise api_error(413, "request_too_large", "The ingestion request is too large.")
    timestamp = request.headers.get("x-ingestion-timestamp", "")
    signature = request.headers.get("x-ingestion-signature", "")
    try:
        too_old = abs(int(time.time()) - int(timestamp)) > 300
    except ValueError as error:
        raise api_error(401, "invalid_signature", "A valid ingestion timestamp is required.") from error
    expected = hmac.new(settings.hmac_secret.encode(), f"{timestamp}.".encode() + raw, hashlib.sha256).hexdigest()
    if too_old or not hmac.compare_digest(expected, signature):
        raise api_error(401, "invalid_signature", "The ingestion signature is invalid or expired.")
    try:
        return ProductIngress.model_validate_json(raw)
    except Exception as error:
        raise api_error(422, "invalid_payload", str(error)) from error


def product_url(settings: Settings, product_id: str) -> str:
    return f"{settings.public_site_url}/product?id={quote(product_id)}" if settings.public_site_url else ""


app = FastAPI(title="BUYSELL Product Ingestion API", docs_url=None, redoc_url=None)
app.include_router(partner_router)
app.add_exception_handler(PartnerError, partner_error_response)


@app.on_event("startup")
async def startup() -> None:
    settings = Settings.from_env()
    app.state.settings = settings
    app.state.store = SupabaseGateway(settings)
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0))
    app.state.partner = PartnerGateway(settings.supabase_url, settings.service_role_key, settings.public_site_url)


@app.on_event("shutdown")
async def shutdown() -> None:
    await app.state.http.aclose()
    await app.state.store.close()
    await app.state.partner.close()


@app.api_route("/health", methods=["GET", "HEAD"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "buysell-product-ingestion-api"}


@app.api_route("/", methods=["GET", "HEAD"])
async def root() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "buysell-product-ingestion-api",
        "health": "/health",
        "ingestion_endpoint": "/api/v1/ingest/product",
        "partner_feed_endpoint": "/api/v1/partner/feed",
    }


@app.post("/api/v1/ingest/product")
async def ingest_product(request: Request) -> dict[str, Any]:
    settings: Settings = request.app.state.settings
    store: SupabaseGateway = request.app.state.store
    payload = await signed_payload(request, settings)
    duplicate = await store.existing(payload)
    if duplicate:
        return {"created": False, **duplicate, "public_url": product_url(settings, duplicate["product_id"])}

    seller_price = parse_naira(payload.price) or price_from_text(f"{payload.title}\n{payload.description}\n{payload.specs}")
    if seller_price is None:
        raise api_error(422, "needs_price", "A fixed Naira price is required before this product can be published.")
    received = await asyncio.gather(*(resolve_media(item, settings, request.app.state.http) for item in payload.media))
    media: list[ResolvedMedia] = []
    fingerprints: set[str] = set()
    for item in received:
        if item.fingerprint not in fingerprints:
            fingerprints.add(item.fingerprint)
            media.append(item)
    title, description, vision_category = await vision_fallback(settings, payload.title, payload.description, [item for item in media if item.kind == "image"])
    title = strip_price(title) or "Marketplace item"
    description = strip_price(description) or title
    category = category_for(payload.category)
    if category == "other" and vision_category != "other":
        category = vision_category

    source_hash = hashlib.sha256(f"{payload.source_platform}:{payload.source_message_id}".encode()).hexdigest()[:32]
    uploads = await asyncio.gather(*(
        store.upload_media(
            PurePosixPath("ingested") / payload.source_platform / source_hash / f"{index:02d}{mimetypes.guess_extension(item.content_type) or ('.jpg' if item.kind == 'image' else '.mp4')}", item,
        ) for index, item in enumerate(media, start=1)
    ))
    image_urls = [url for url, item in zip(uploads, media, strict=True) if item.kind == "image"]
    video_urls = [url for url, item in zip(uploads, media, strict=True) if item.kind == "video"]
    markup = round(seller_price * settings.markup_percent / 100)
    seller_id = settings.whatsapp_seller_id if payload.source_platform == "whatsapp" else settings.telegram_seller_id
    product = await store.insert_product({
        "seller_id": seller_id, "name": title[:300], "description": description[:2000],
        "price": seller_price + markup, "original_price": seller_price + markup,
        "shipping_fee": settings.whatsapp_shipping_fee if payload.source_platform == "whatsapp" else 0,
        "shipping_cost": settings.whatsapp_shipping_fee if payload.source_platform == "whatsapp" else 0,
        "category": category, "condition": "new", "location": payload.location or settings.default_location,
        "images": image_urls, "videos": video_urls, "image_url": image_urls[0] if image_urls else None,
        "video_url": video_urls[0] if video_urls else None, "has_video": bool(video_urls),
        "stock_quantity": 1, "negotiable": payload.negotiable, "status": "pending",
    })
    try:
        if payload.source_platform == "telegram":
            await store.register_telegram_user(payload)
        await store.record_source(payload, product["id"], seller_price, markup)
        await store.record_private_price(product["id"], seller_price, f"{payload.source_platform}_submission", seller_id)
    except httpx.HTTPStatusError as error:
        await store.delete_product(product["id"])
        if error.response.status_code == 409:
            duplicate = await store.existing(payload)
            if duplicate:
                return {"created": False, **duplicate, "public_url": product_url(settings, duplicate["product_id"])}
        raise
    except Exception:
        await store.delete_product(product["id"])
        raise

    result = {"created": True, "product_id": product["id"], "product": product, "public_url": product_url(settings, product["id"])}
    if payload.source_platform == "whatsapp":
        asyncio.create_task(send_bot3_relay(settings, {
            "source_platform": "whatsapp", "product_id": product["id"], "name": product["name"],
            "price": product["price"], "status": product["status"], "image_url": product.get("image_url"),
            "public_url": result["public_url"],
        }))
    return result
