# BUYSELL Telegram Catalog Engine (Bot 3)

Bot 3 accepts direct `t.me/<bot>?start=...` submissions in private chat. A
seller sends product photos or a video and then a caption/message with a fixed
Naira price. Albums are debounced for 1.5 seconds, so every attachment becomes
one listing rather than one product per image.

The bot has no Supabase service-role credential. It downloads Telegram media,
then calls the shared ingestion API with an HMAC-signed request. The API owns
media storage, Vision fallback, database writes, idempotency, and markup.

It also exposes a protected `POST /internal/relay/whatsapp` endpoint. The
shared API can call this to post a concise WhatsApp-ingestion notification in
`TELEGRAM_CATALOG_CHAT_ID`. Set `BOT3_RELAY_SECRET` here and in the shared API,
then set the API's `BOT3_RELAY_URL` to this service's relay URL.

## Deploy

1. Copy `.env.example` to the service environment and configure the Telegram
   token plus the shared API URL/secret.
2. Deploy with the supplied `render.yaml` or Dockerfile. The HTTP listener is
   for health checks and the internal WhatsApp relay; Telegram updates use
   long polling, so no public Telegram webhook is required.
3. Add the bot to the optional catalog group/channel before setting its chat
   ID. A bot can only send where it is a member with permission.
