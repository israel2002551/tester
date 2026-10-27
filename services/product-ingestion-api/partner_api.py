"""BUYSELL partner commerce API.

External partner sites read the BUYSELL catalog and admin ads, sell on their
own checkout, and report every order back for accounting and settlement.

    GET  /api/v1/partner/feed                      products + admin ads ("feed" scope)
    POST /api/v1/partner/orders                    record an order / payment update ("orders" scope)
    GET  /api/v1/partner/orders/{partner_order_id} one recorded order ("orders" scope)
    GET  /api/v1/partner/ledger                    what the partner owes BUYSELL ("orders" scope)

Every request carries ``X-BUYSELL-API-KEY``. Keys are issued with
``public.issue_partner_api_key`` and stored only as SHA-256 hashes. The feed
supports CORS for each partner's registered origins; order endpoints are
server-to-server only, because a key visible in a browser could be used to
report fake orders against the partner's account.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Literal
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

logger = logging.getLogger("buysell.partner")

API_KEY_HEADER = "x-buysell-api-key"
API_KEY_PATTERN = re.compile(r"^bsk_live_[0-9a-f]{64}$")
PARTNER_ORDER_ID_PATTERN = r"^[A-Za-z0-9._:-]{1,120}$"
FEED_CATEGORIES = {"electronics", "fashion", "home", "phones", "beauty", "sports", "dropship", "other"}
MAX_ORDER_BYTES = 64_000
# (requests, window seconds) per API key.
RATE_LIMITS = {"feed": (120, 60.0), "orders": (300, 60.0)}
KEY_CACHE_SECONDS = 60
FEED_CACHE_SECONDS = 60
ORIGIN_CACHE_SECONDS = 300
KEY_TOUCH_SECONDS = 300
DB_ERROR_STATUS = {
    "partner_inactive": (403, "This partner account is not active."),
    "unknown_product": (422, "One or more product IDs do not exist on BUYSELL."),
    "order_items_changed": (409, "This order was already recorded with different items; only its payment status can change."),
    "invalid_status_transition": (409, "That payment status change is not allowed for this order."),
}


class PartnerError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers or {}


def partner_error_response(_request: Request, error: PartnerError) -> JSONResponse:
    return JSONResponse(
        {"success": False, "error": {"code": error.code, "message": error.message}},
        status_code=error.status,
        headers=error.headers,
    )


@dataclass(frozen=True, slots=True)
class PartnerContext:
    key_id: str
    partner_id: str
    partner_name: str
    commission_rate: float
    scopes: frozenset[str]
    allowed_origins: frozenset[str]


class TTLCache:
    def __init__(self) -> None:
        self._items: dict[Any, tuple[float, Any]] = {}

    def get(self, key: Any) -> Any:
        item = self._items.get(key)
        if item and item[0] > time.monotonic():
            return item[1]
        self._items.pop(key, None)
        return None

    def set(self, key: Any, value: Any, ttl: float) -> None:
        if len(self._items) > 5_000:
            self._items.clear()
        self._items[key] = (time.monotonic() + ttl, value)


def normalize_origin(value: str) -> str | None:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    port = f":{parsed.port}" if parsed.port and parsed.port not in {80, 443} else ""
    return f"{parsed.scheme}://{parsed.hostname.lower()}{port}"


def safe_link(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    if not text:
        return fallback
    if "://" not in text:
        # javascript:, data:, mailto: ... are never valid ad destinations.
        if re.match(r"^[a-z][a-z0-9+.-]*:(?!\d)", text, re.I):
            return fallback
        text = f"https://{text}"
    parsed = urlparse(text)
    return text if parsed.scheme in {"http", "https"} and parsed.hostname else fallback


def number(value: Any) -> int | float:
    amount = Decimal(str(value or 0))
    return int(amount) if amount == amount.to_integral_value() else float(amount)


class PartnerOrderItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: UUID
    quantity: int = Field(ge=1, le=1000)
    unit_price: Decimal = Field(gt=0, le=Decimal("100000000"), max_digits=14, decimal_places=2)


class PartnerCustomerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=254)
    address: str | None = Field(default=None, max_length=1000)


class PartnerOrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    partner_order_id: str = Field(pattern=PARTNER_ORDER_ID_PATTERN)
    payment_status: Literal["pending", "paid", "failed", "cancelled", "refunded"]
    payment_reference: str | None = Field(default=None, max_length=200)
    currency: Literal["NGN"] = "NGN"
    total_amount: Decimal = Field(ge=0, le=Decimal("1000000000"), max_digits=14, decimal_places=2)
    customer: PartnerCustomerIn | None = None
    items: list[PartnerOrderItemIn] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def unique_products(self) -> "PartnerOrderIn":
        ids = [item.product_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Each product may appear only once per order; combine quantities instead.")
        return self


class PartnerGateway:
    """Supabase access (service role) plus per-process caches and rate limits."""

    def __init__(self, supabase_url: str, service_role_key: str, public_site_url: str = "",
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.base = supabase_url.rstrip("/")
        self.public_site_url = public_site_url.rstrip("/")
        self.headers = {"apikey": service_role_key, "Authorization": f"Bearer {service_role_key}"}
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=10.0), transport=transport)
        self.cache = TTLCache()
        self.requests: dict[tuple[str, str], deque[float]] = {}
        self.touched: dict[str, float] = {}

    async def close(self) -> None:
        await self.client.aclose()

    async def _call(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            response = await self.client.request(method, f"{self.base}{path}", headers={**self.headers, **kwargs.pop("headers", {})}, **kwargs)
        except httpx.HTTPError as error:
            logger.error("Supabase request failed: %s %s: %s", method, path, error)
            raise PartnerError(502, "upstream_unavailable", "BUYSELL could not complete the request. Try again shortly.") from error
        return response

    async def _rows(self, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        response = await self._call("GET", f"/rest/v1/{path}", params=params)
        if response.status_code >= 400:
            logger.error("Supabase query %s failed (%s): %s", path, response.status_code, response.text[:300])
            raise PartnerError(502, "upstream_error", "BUYSELL could not complete the request. Try again shortly.")
        return response.json()

    # ---- authentication -------------------------------------------------
    async def authenticate(self, request: Request, scope: str) -> PartnerContext:
        key = request.headers.get(API_KEY_HEADER, "").strip()
        if not API_KEY_PATTERN.fullmatch(key):
            raise PartnerError(401, "invalid_api_key", "Send a valid API key in the X-BUYSELL-API-KEY header.")
        digest = hashlib.sha256(key.encode()).hexdigest()
        context = self.cache.get(("key", digest))
        if context is None:
            rows = await self._rows("partner_api_keys", {
                "select": "id,partner_id,scopes,status,partners(partner_name,commission_rate,status,allowed_origins)",
                "key_hash": f"eq.{digest}",
            })
            row = rows[0] if rows else None
            partner = (row or {}).get("partners") or {}
            if not row or row.get("status") != "active" or partner.get("status") != "active":
                context = False
            else:
                context = PartnerContext(
                    key_id=row["id"], partner_id=row["partner_id"], partner_name=partner.get("partner_name") or "",
                    commission_rate=float(partner.get("commission_rate") or 0),
                    scopes=frozenset(row.get("scopes") or []),
                    allowed_origins=frozenset(filter(None, (normalize_origin(o) for o in partner.get("allowed_origins") or []))),
                )
            self.cache.set(("key", digest), context, KEY_CACHE_SECONDS)
        if context is False:
            raise PartnerError(401, "invalid_api_key", "This API key is not valid or has been revoked.")
        if scope not in context.scopes:
            raise PartnerError(403, "insufficient_scope", f"This API key cannot access the {scope} endpoints.")
        self._rate_limit(context.key_id, scope)
        self._touch(context.key_id)
        return context

    def _rate_limit(self, key_id: str, scope: str) -> None:
        limit, window = RATE_LIMITS[scope]
        now = time.monotonic()
        hits = self.requests.setdefault((key_id, scope), deque())
        while hits and hits[0] <= now - window:
            hits.popleft()
        if len(hits) >= limit:
            retry = max(1, int(hits[0] + window - now) + 1)
            raise PartnerError(429, "rate_limited", "Too many requests; slow down.", {"Retry-After": str(retry)})
        hits.append(now)

    def _touch(self, key_id: str) -> None:
        now = time.monotonic()
        if now - self.touched.get(key_id, -KEY_TOUCH_SECONDS) < KEY_TOUCH_SECONDS:
            return
        self.touched[key_id] = now

        async def touch() -> None:
            try:
                await self._call("PATCH", "/rest/v1/partner_api_keys", params={"id": f"eq.{key_id}"},
                                 headers={"Content-Type": "application/json"},
                                 json={"last_used_at": datetime.now(UTC).isoformat()})
            except PartnerError:
                pass

        asyncio.get_running_loop().create_task(touch())

    async def allowed_origins(self) -> set[str]:
        origins = self.cache.get("origins")
        if origins is None:
            rows = await self._rows("partners", {"select": "allowed_origins", "status": "eq.active"})
            origins = {o for row in rows for o in (normalize_origin(v) for v in row.get("allowed_origins") or []) if o}
            self.cache.set("origins", origins, ORIGIN_CACHE_SECONDS)
        return origins

    # ---- catalog --------------------------------------------------------
    async def feed(self, limit: int, offset: int, category: str | None) -> dict[str, Any]:
        cache_key = ("feed", limit, offset, category)
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached
        params = {
            "select": "id,name,price,stock_quantity,image_url,images,seller_id,category",
            "status": "eq.active",
            "stock_quantity": "gt.0",
            "order": "created_at.desc,id.desc",
            "limit": str(limit),
            "offset": str(offset),
        }
        if category:
            params["category"] = f"eq.{category}"
        products, ads = await asyncio.gather(self._rows("products", params), self._admin_ads())
        data = {
            "ads": ads,
            "products": [{
                "id": p["id"],
                "title": p.get("name") or "",
                "price": number(p.get("price")),
                "currency": "NGN",
                "stock": int(p.get("stock_quantity") or 0),
                "image_url": p.get("image_url") or next(iter(p.get("images") or []), None),
                "seller_id": p.get("seller_id"),
                "category": p.get("category"),
            } for p in products],
        }
        result = {"data": data, "pagination": {"limit": limit, "offset": offset,
                                               "next_offset": offset + limit if len(products) == limit else None}}
        self.cache.set(cache_key, result, FEED_CACHE_SECONDS)
        return result

    async def _admin_ads(self) -> list[dict[str, Any]]:
        # Ads are a bonus to the feed; a problem loading them must not hide products.
        try:
            admin_ids = self.cache.get("admin_ids")
            if admin_ids is None:
                admin_ids = [row["id"] for row in await self._rows("profiles", {"select": "id", "role": "eq.admin"})]
                self.cache.set("admin_ids", admin_ids, ORIGIN_CACHE_SECONDS)
            if not admin_ids:
                return []
            rows = await self._rows("advertisements", {
                "select": "id,title,description,media_url,media_type,cta_text,cta_link",
                "status": "eq.active",
                "expires_at": f"gt.{datetime.now(UTC).isoformat()}",
                "advertiser_id": f"in.({','.join(admin_ids)})",
                "order": "created_at.desc",
                "limit": "20",
            })
        except PartnerError:
            logger.warning("Admin ads unavailable for the partner feed.")
            return []
        ads = []
        for ad in rows:
            is_video = str(ad.get("media_type") or "").startswith("video")
            ads.append({
                "id": ad["id"],
                "title": ad.get("title") or "",
                "description": ad.get("description") or "",
                "image_url": None if is_video else ad.get("media_url"),
                "video_url": ad.get("media_url") if is_video else None,
                "cta_text": ad.get("cta_text") or "",
                "link": safe_link(ad.get("cta_link"), self.public_site_url),
            })
        return ads

    # ---- orders & ledger ------------------------------------------------
    async def record_order(self, partner_id: str, order: PartnerOrderIn) -> dict[str, Any]:
        response = await self._call("POST", "/rest/v1/rpc/record_partner_order",
                                    headers={"Content-Type": "application/json"},
                                    json={"p_partner_id": partner_id, "p_order": order.model_dump(mode="json")})
        if response.status_code >= 400:
            body = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
            code = str(body.get("message") or "")
            if code in DB_ERROR_STATUS:
                status, message = DB_ERROR_STATUS[code]
                detail = body.get("details")
                raise PartnerError(status, code, f"{message} ({detail})" if detail else message)
            logger.error("record_partner_order failed (%s): %s", response.status_code, response.text[:300])
            raise PartnerError(502, "upstream_error", "BUYSELL could not record the order. Retry with the same partner_order_id.")
        return response.json()

    async def find_order(self, partner_id: str, partner_order_id: str) -> dict[str, Any] | None:
        rows = await self._rows("partner_orders", {
            "select": "id", "partner_id": f"eq.{partner_id}", "partner_order_id": f"eq.{partner_order_id}",
        })
        if not rows:
            return None
        response = await self._call("POST", "/rest/v1/rpc/partner_order_summary",
                                    headers={"Content-Type": "application/json"}, json={"p_order_id": rows[0]["id"]})
        if response.status_code >= 400:
            raise PartnerError(502, "upstream_error", "BUYSELL could not load the order. Try again shortly.")
        return response.json()

    async def ledger(self, partner_id: str) -> dict[str, Any]:
        rows = await self._rows("partner_ledger_balances", {"select": "*", "partner_id": f"eq.{partner_id}"})
        row = rows[0] if rows else {}
        return {
            "partner_name": row.get("partner_name"),
            "commission_rate": number(row.get("commission_rate")),
            "currency": "NGN",
            "unsettled_orders": int(row.get("unsettled_orders") or 0),
            "unsettled_sales": number(row.get("unsettled_sales")),
            "unsettled_commission": number(row.get("unsettled_commission")),
            "amount_due": number(row.get("amount_due")),
            "total_settled": number(row.get("total_settled")),
            "orders_needing_review": int(row.get("orders_needing_review") or 0),
            "last_paid_at": row.get("last_paid_at"),
        }


router = APIRouter(prefix="/api/v1/partner")


def gateway(request: Request) -> PartnerGateway:
    return request.app.state.partner


def int_param(request: Request, name: str, default: int, low: int, high: int) -> int:
    raw = request.query_params.get(name)
    if raw is None:
        return default
    if not raw.isdigit() or not low <= int(raw) <= high:
        raise PartnerError(422, "invalid_parameter", f"{name} must be a whole number from {low} to {high}.")
    return int(raw)


def cors_headers(origin: str) -> dict[str, str]:
    return {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}


@router.options("/feed")
async def feed_preflight(request: Request) -> Response:
    origin = request.headers.get("origin", "")
    if normalize_origin(origin) not in await gateway(request).allowed_origins():
        return Response(status_code=204)
    return Response(status_code=204, headers={
        **cors_headers(origin),
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "X-BUYSELL-API-KEY",
        "Access-Control-Max-Age": "600",
    })


@router.get("/feed")
async def feed(request: Request) -> JSONResponse:
    store = gateway(request)
    context = await store.authenticate(request, "feed")
    limit = int_param(request, "limit", 50, 1, 100)
    offset = int_param(request, "offset", 0, 0, 100_000)
    category = (request.query_params.get("category") or "").strip().lower() or None
    if category and category not in FEED_CATEGORIES:
        raise PartnerError(422, "invalid_parameter", f"category must be one of: {', '.join(sorted(FEED_CATEGORIES))}.")
    result = await store.feed(limit, offset, category)
    origin = request.headers.get("origin", "")
    headers = cors_headers(origin) if origin and normalize_origin(origin) in context.allowed_origins else {}
    return JSONResponse({"success": True, **result}, headers={**headers, "Cache-Control": "private, max-age=30"})


def reject_browser(request: Request) -> None:
    # Browsers always send Origin on cross-site POSTs. Order reports must come
    # from the partner's server so the API key never ships to customers.
    if request.headers.get("origin"):
        raise PartnerError(403, "server_only", "Order endpoints must be called from your server, not a browser.")


@router.post("/orders")
async def record_order(request: Request) -> JSONResponse:
    reject_browser(request)
    store = gateway(request)
    context = await store.authenticate(request, "orders")
    raw = await request.body()
    if len(raw) > MAX_ORDER_BYTES:
        raise PartnerError(413, "request_too_large", "The order payload is too large.")
    try:
        order = PartnerOrderIn.model_validate_json(raw)
    except ValidationError as error:
        problems = "; ".join(f"{'.'.join(str(p) for p in item['loc']) or 'body'}: {item['msg']}" for item in error.errors()[:5])
        raise PartnerError(422, "invalid_payload", problems) from error
    result = await store.record_order(context.partner_id, order)
    return JSONResponse({"success": True, "data": result}, status_code=201 if result.get("created") else 200)


@router.get("/orders/{partner_order_id}")
async def get_order(partner_order_id: str, request: Request) -> JSONResponse:
    reject_browser(request)
    store = gateway(request)
    context = await store.authenticate(request, "orders")
    if not re.fullmatch(PARTNER_ORDER_ID_PATTERN, partner_order_id):
        raise PartnerError(422, "invalid_parameter", "partner_order_id is not valid.")
    order = await store.find_order(context.partner_id, partner_order_id)
    if order is None:
        raise PartnerError(404, "order_not_found", "No order with this partner_order_id has been recorded.")
    return JSONResponse({"success": True, "data": {"order": order}})


@router.get("/ledger")
async def ledger(request: Request) -> JSONResponse:
    reject_browser(request)
    store = gateway(request)
    context = await store.authenticate(request, "orders")
    return JSONResponse({"success": True, "data": await store.ledger(context.partner_id)})
