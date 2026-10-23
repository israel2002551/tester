from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
import re


ALLOWED_CATEGORIES = {
    "Fashion": "fashion",
    "Electronics": "electronics",
    "Home & Kitchen": "home",
    "Beauty": "beauty",
    "Phones & Accessories": "phones",
    "Other": "other",
}


@dataclass(slots=True)
class MediaItem:
    file_id: str
    kind: str  # image or video
    content_type: str
    message_id: int


@dataclass(slots=True)
class ListingDraft:
    media: list[MediaItem] = field(default_factory=list)
    price: int | None = None
    description: str = ""
    title: str = ""
    category: str = "other"


def parse_naira(value: str) -> int | None:
    """Parse 15000, ₦15,000, 15k, 1.5k and 2m into whole Naira."""
    raw = value.strip().lower().replace("₦", "").replace("ngn", "").replace("naira", "")
    raw = raw.replace("₦", "").replace(",", "").replace(" ", "")
    match = re.fullmatch(r"(\d+(?:\.\d+)?)([km])?", raw)
    if not match:
        return None
    try:
        amount = Decimal(match.group(1))
    except InvalidOperation:
        return None
    multiplier = Decimal("1000") if match.group(2) == "k" else Decimal("1000000") if match.group(2) == "m" else Decimal("1")
    result = int(amount * multiplier)
    return result if 1 <= result <= 100_000_000 else None


def clean_vision_result(payload: object) -> tuple[str, str, str]:
    data = payload if isinstance(payload, dict) else {}
    title = str(data.get("title", "") or "").strip()[:300]
    description = str(data.get("description", "") or "").strip()[:2000]
    category_name = str(data.get("suggested_category", "Other") or "Other").strip()
    category = ALLOWED_CATEGORIES.get(category_name, "other")
    if not title:
        title = "Product listing"
    if not description:
        description = "Product submitted through the BUYSELL Telegram listing assistant."
    return title, description, category
