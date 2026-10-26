# BUYSELL shared product-ingestion API

This private FastAPI service is the single write path for Bot 2 (WhatsApp) and
Bot 3 (Telegram). It validates a signed request, removes duplicate media,
stores media in the `product-media` Supabase bucket, uses Vision only to fill a
missing title or description, and creates the product plus private source-price
provenance in one controlled workflow.

## Endpoint contract

`POST /api/v1/ingest/product` accepts JSON. Requests must include:

```text
x-ingestion-timestamp: Unix timestamp in seconds
x-ingestion-signature: hex(HMAC-SHA256(secret, "<timestamp>.<raw JSON body>"))
```

`source_platform` is either `whatsapp` or `telegram`. WhatsApp sends
Cloudinary media URLs; Telegram sends small downloaded files as base64. The
service permits only the configured HTTPS hosts for URL media, so the endpoint
cannot be used as an SSRF proxy.

A missing price returns `422` with `code: needs_price`; Vision is never asked
to guess one. Callers should retain their buffered album and submit it again
when the seller supplies the price. Repeating the same source message returns
the originally created product instead of creating a duplicate.

## Deploy

1. Apply `supabase/migrations/20261022000000_hybrid_product_ingestion.sql`.
2. Create a Render web service from this directory using `render.yaml` or the
   supplied Dockerfile, then set the values in `.env.example`.
3. Point Bot 2 at `INGESTION_API_URL=https://<service>/api/v1/ingest/product`
   and give it the same `INGESTION_HMAC_SECRET`.
4. Set Bot 3's `INGESTION_API_URL` and `INGESTION_HMAC_SECRET` to the same
   values. Configure the optional relay variables on both services if Bot 3
   should post accepted WhatsApp listings into a Telegram catalog chat.

The service is deliberately not a browser-facing endpoint. Do not expose the
HMAC secret in Vite configuration or any client bundle.
