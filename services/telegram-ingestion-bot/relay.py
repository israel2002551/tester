from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

from aiohttp import web
from aiogram import Bot

from config import Settings


def _authorized(raw: bytes, timestamp: str, signature: str, secret: str | None) -> bool:
    if not secret:
        return False
    try:
        if abs(int(time.time()) - int(timestamp)) > 300:
            return False
    except ValueError:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _relay_text(item: dict[str, Any]) -> str:
    name = str(item.get("name") or "Marketplace item")
    price = int(item.get("price") or 0)
    link = str(item.get("public_url") or "")
    lines = [
        "New WhatsApp listing received by BUYSELL",
        f"Item: {name}",
        f"Marketplace price: ₦{price:,.0f}",
        "Status: pending BUYSELL review",
    ]
    if link:
        lines.append(link)
    return "\n".join(lines)


def create_relay_app(bot: Bot, settings: Settings) -> web.Application:
    app = web.Application(client_max_size=1_000_000)

    async def root(_request: web.Request) -> web.Response:
        return web.json_response({
            "status": "ok",
            "service": "buysell-telegram-ingestion-bot",
            "health": "/health",
            "relay_endpoint": "/internal/relay/whatsapp",
        })

    async def health(_request: web.Request) -> web.Response:
        return web.json_response({"status": "ok", "service": "buysell-telegram-ingestion-bot"})

    async def receive_whatsapp(request: web.Request) -> web.Response:
        raw = await request.read()
        if not _authorized(raw, request.headers.get("x-relay-timestamp", ""), request.headers.get("x-relay-signature", ""), settings.relay_secret):
            return web.json_response({"error": "Unauthorized."}, status=401)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return web.json_response({"error": "Invalid JSON."}, status=400)
        if payload.get("source_platform") != "whatsapp":
            return web.json_response({"error": "Unsupported source."}, status=422)
        if settings.catalog_chat_id is None:
            return web.json_response({"received": True, "relayed": False})
        try:
            await bot.send_message(settings.catalog_chat_id, _relay_text(payload), disable_web_page_preview=True)
        except Exception as error:
            return web.json_response({"received": True, "relayed": False, "error": str(error)}, status=502)
        return web.json_response({"received": True, "relayed": True})

    app.router.add_get("/", root)
    app.router.add_get("/health", health)
    app.router.add_post("/internal/relay/whatsapp", receive_whatsapp)
    return app


async def start_relay_server(bot: Bot, settings: Settings) -> web.AppRunner:
    app = create_relay_app(bot, settings)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, settings.relay_host, settings.relay_port).start()
    return runner
