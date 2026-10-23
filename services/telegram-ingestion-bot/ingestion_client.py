from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import httpx

from config import Settings
from domain import MediaItem


class IngestionClient:
    """Signed client for the shared product-ingestion API."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(100.0, connect=20.0))

    async def close(self) -> None:
        await self.client.aclose()

    async def submit(
        self,
        *,
        telegram_id: int,
        username: str | None,
        first_name: str | None,
        source_message_id: str,
        title: str,
        description: str,
        price: int,
        media: list[tuple[MediaItem, bytes]],
    ) -> dict[str, Any]:
        payload = {
            "source_platform": "telegram",
            "source_message_id": source_message_id,
            "sender_id": str(telegram_id),
            "sender_username": username or None,
            "sender_first_name": first_name or None,
            "title": title,
            "description": description,
            "price": price,
            "category": "other",
            "media": [
                {
                    "kind": item.kind,
                    "content_type": item.content_type,
                    "data_base64": __import__("base64").b64encode(data).decode("ascii"),
                }
                for item, data in media
            ],
        }
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        timestamp = str(int(time.time()))
        signature = hmac.new(
            self.settings.ingestion_hmac_secret.encode("utf-8"),
            f"{timestamp}.".encode("utf-8") + raw,
            hashlib.sha256,
        ).hexdigest()
        response = await self.client.post(
            self.settings.ingestion_api_url,
            content=raw,
            headers={
                "Content-Type": "application/json",
                "x-ingestion-timestamp": timestamp,
                "x-ingestion-signature": signature,
            },
        )
        data = response.json() if response.content else {}
        if response.is_error:
            detail = data.get("detail") if isinstance(data, dict) else None
            message = detail.get("message") if isinstance(detail, dict) else None
            code = detail.get("code") if isinstance(detail, dict) else "ingestion_failed"
            raise IngestionError(str(message or "The catalog service could not accept this listing."), str(code), response.status_code)
        return data


class IngestionError(RuntimeError):
    def __init__(self, message: str, code: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
