from __future__ import annotations

from dataclasses import dataclass
import os


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be configured.")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    telegram_bot_token: str
    ingestion_api_url: str
    ingestion_hmac_secret: str
    catalog_chat_id: int | None
    relay_secret: str | None
    relay_host: str
    relay_port: int
    media_debounce_seconds: float
    max_media_bytes: int

    @classmethod
    def from_env(cls) -> "Settings":
        raw_catalog_chat = os.getenv("TELEGRAM_CATALOG_CHAT_ID", "").strip()
        return cls(
            telegram_bot_token=_required("TELEGRAM_BOT_TOKEN"),
            ingestion_api_url=_required("INGESTION_API_URL").rstrip("/"),
            ingestion_hmac_secret=_required("INGESTION_HMAC_SECRET"),
            catalog_chat_id=int(raw_catalog_chat) if raw_catalog_chat else None,
            relay_secret=os.getenv("BOT3_RELAY_SECRET", "").strip() or None,
            relay_host=os.getenv("RELAY_HOST", "0.0.0.0").strip() or "0.0.0.0",
            relay_port=max(1, min(65535, int(os.getenv("PORT", "8080")))),
            media_debounce_seconds=max(0.5, min(10.0, float(os.getenv("TELEGRAM_MEDIA_DEBOUNCE_SECONDS", "1.5")))),
            max_media_bytes=max(500_000, min(12_000_000, int(os.getenv("TELEGRAM_MAX_MEDIA_BYTES", "8000000")))),
        )
