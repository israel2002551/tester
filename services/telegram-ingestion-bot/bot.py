from __future__ import annotations

import asyncio
import contextlib
import io
import re
from dataclasses import dataclass, field

from aiogram import Bot, Dispatcher, F, Router
from aiogram.enums import ChatType
from aiogram.filters import Command, CommandStart
from aiogram.types import Message
from dotenv import load_dotenv

from config import Settings
from domain import MediaItem, parse_naira
from ingestion_client import IngestionClient, IngestionError
from relay import start_relay_server


PRICE_MARKER = re.compile(r"(?:₦|\bngn\b|\bnaira\b|\bprice\b|\bcost\b|#|\bN(?=\s*\d))\s*(\d+(?:[,.]\d+)?)\s*([km])?\b", re.I)
SCALED_PRICE = re.compile(r"\b(\d+(?:[,.]\d+)?)\s*([km])\b", re.I)
BARE_PRICE = re.compile(r"\b(\d{4,8})\b")


@dataclass(slots=True)
class ListingSession:
    chat_id: int
    telegram_id: int
    username: str | None
    first_name: str | None
    media: list[MediaItem] = field(default_factory=list)
    description: str = ""
    price: int | None = None
    timer: asyncio.Task[None] | None = None
    waiting_for_price_notified: bool = False
    submitting: bool = False


class SubmissionState:
    def __init__(self, settings: Settings, client: IngestionClient) -> None:
        self.settings = settings
        self.client = client
        self.sessions: dict[int, ListingSession] = {}

    def get(self, message: Message) -> ListingSession:
        user = message.from_user
        assert user is not None
        session = self.sessions.get(user.id)
        if not session:
            session = ListingSession(message.chat.id, user.id, user.username, user.first_name)
            self.sessions[user.id] = session
        return session

    def discard(self, telegram_id: int) -> None:
        session = self.sessions.pop(telegram_id, None)
        if session and session.timer and session.timer is not asyncio.current_task():
            session.timer.cancel()

    def schedule(self, session: ListingSession) -> None:
        if session.timer:
            session.timer.cancel()
        session.timer = asyncio.create_task(self._after_debounce(session.telegram_id))

    async def _after_debounce(self, telegram_id: int) -> None:
        try:
            await asyncio.sleep(self.settings.media_debounce_seconds)
            session = self.sessions.get(telegram_id)
            if session:
                await self.submit_if_complete(session)
        except asyncio.CancelledError:
            return

    async def submit_if_complete(self, session: ListingSession) -> None:
        if session.submitting or not session.media:
            return
        if session.price is None:
            if not session.waiting_for_price_notified:
                session.waiting_for_price_notified = True
                await self._send(session.chat_id, "I have your media. Send the item description and a fixed price, for example: `Samsung S21, ₦350,000`.")
            return
        session.submitting = True
        try:
            uploaded = await self._download_media(session)
            source_ids = "-".join(str(item.message_id) for item, _ in uploaded)
            source_message_id = f"telegram:{session.telegram_id}:{source_ids}"
            description = session.description.strip() or "Product submitted through the BUYSELL Telegram catalog assistant."
            title = self._title_from_description(description)
            result = await self.client.submit(
                telegram_id=session.telegram_id,
                username=session.username,
                first_name=session.first_name,
                source_message_id=source_message_id,
                title=title,
                description=description,
                price=session.price,
                media=uploaded,
            )
        except IngestionError as error:
            session.submitting = False
            if error.code == "needs_price":
                await self._send(session.chat_id, "Please send a clear fixed price in Naira before I publish this listing.")
            else:
                await self._send(session.chat_id, f"I could not submit this listing: {error}. Please try again or send /cancel.")
            return
        except ValueError as error:
            self.discard(session.telegram_id)
            await self._send(session.chat_id, str(error))
            return
        except Exception:
            session.submitting = False
            await self._send(session.chat_id, "The catalog service is temporarily unavailable. Your media is still staged here; send the price again to retry.")
            return

        self.discard(session.telegram_id)
        product = result.get("product") if isinstance(result, dict) else {}
        marketplace_price = product.get("price") if isinstance(product, dict) else None
        duplicate = result.get("created") is False if isinstance(result, dict) else False
        label = "already received" if duplicate else "received"
        price_text = f"\nMarketplace price: ₦{int(marketplace_price):,}" if marketplace_price else ""
        await self._send(session.chat_id, f"Your listing was {label} and is awaiting BUYSELL review.{price_text}")

    async def _download_media(self, session: ListingSession) -> list[tuple[MediaItem, bytes]]:
        bot = self.bot
        total = 0
        data: list[tuple[MediaItem, bytes]] = []
        for item in session.media:
            remote = await bot.get_file(item.file_id)
            declared = int(remote.file_size or 0)
            if declared > self.settings.max_media_bytes:
                raise ValueError("One file is too large for a Telegram listing. Please send a smaller image or video.")
            target = io.BytesIO()
            await bot.download(remote, destination=target)
            value = target.getvalue()
            total += len(value)
            if total > self.settings.max_media_bytes:
                raise ValueError("This album is too large. Please submit fewer or smaller files.")
            data.append((item, value))
        return data

    @property
    def bot(self) -> Bot:
        return self._bot

    @bot.setter
    def bot(self, value: Bot) -> None:
        self._bot = value

    @staticmethod
    def _title_from_description(description: str) -> str:
        cleaned = PRICE_MARKER.sub("", description).strip(" \n-:,;")
        first = next((line.strip() for line in cleaned.splitlines() if line.strip()), "")
        return first[:300] or "Marketplace item"

    async def _send(self, chat_id: int, text: str) -> None:
        await self.bot.send_message(chat_id, text, parse_mode="Markdown")


def extract_price(text: str) -> int | None:
    for pattern in (PRICE_MARKER, SCALED_PRICE, BARE_PRICE):
        for match in pattern.finditer(text or ""):
            suffix = match.group(2) if match.lastindex and match.lastindex > 1 else ""
            amount = parse_naira(f"{match.group(1)}{suffix or ''}")
            if amount and not (1900 <= amount <= 2100 and not suffix):
                return amount
    return None


def add_text(session: ListingSession, text: str) -> None:
    text = text.strip()
    if not text:
        return
    session.description = f"{session.description}\n{text}".strip() if session.description else text
    session.price = extract_price(session.description) or session.price


def create_router(state: SubmissionState) -> Router:
    router = Router(name="telegram-product-submissions")

    @router.message(CommandStart(), F.chat.type == ChatType.PRIVATE)
    async def start(message: Message) -> None:
        await message.answer(
            "Welcome to BUYSELL Nigeria. Send photos or a video, then send a short description with a fixed Naira price.\n\n"
            "Example: `iPhone 13 128GB, clean condition — ₦420,000`\n\nUse /cancel to discard a draft.",
            parse_mode="Markdown",
        )

    @router.message(Command("cancel"), F.chat.type == ChatType.PRIVATE)
    async def cancel(message: Message) -> None:
        if message.from_user:
            state.discard(message.from_user.id)
        await message.answer("Draft discarded. Send new product media whenever you are ready.")

    async def receive_media(message: Message, item: MediaItem) -> None:
        session = state.get(message)
        if len(session.media) >= 12:
            await message.answer("A listing can include up to 12 files. Send /cancel to start a new listing.")
            return
        session.media.append(item)
        add_text(session, message.caption or "")
        state.schedule(session)

    @router.message(F.photo, F.chat.type == ChatType.PRIVATE)
    async def photo(message: Message) -> None:
        image = message.photo[-1]
        await receive_media(message, MediaItem(image.file_id, "image", "image/jpeg", message.message_id))

    @router.message(F.video, F.chat.type == ChatType.PRIVATE)
    async def video(message: Message) -> None:
        assert message.video is not None
        await receive_media(message, MediaItem(message.video.file_id, "video", message.video.mime_type or "video/mp4", message.message_id))

    @router.message(F.text, F.chat.type == ChatType.PRIVATE)
    async def text(message: Message) -> None:
        if not message.from_user or str(message.text or "").startswith("/"):
            return
        session = state.sessions.get(message.from_user.id)
        if not session:
            await message.answer("Send product photos or a video first, then add its description and fixed price.")
            return
        add_text(session, message.text or "")
        if session.price is None:
            await message.answer("I still need a fixed price, for example `₦35,000`.", parse_mode="Markdown")
            return
        if session.timer:
            session.timer.cancel()
        await state.submit_if_complete(session)

    return router


async def main() -> None:
    load_dotenv()
    settings = Settings.from_env()
    bot = Bot(settings.telegram_bot_token)
    client = IngestionClient(settings)
    state = SubmissionState(settings, client)
    state.bot = bot
    dispatcher = Dispatcher()
    dispatcher.include_router(create_router(state))
    relay_runner = await start_relay_server(bot, settings)
    try:
        await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types())
    finally:
        for session in list(state.sessions.values()):
            if session.timer:
                session.timer.cancel()
        await relay_runner.cleanup()
        await client.close()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
