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

## Partner API (BUYSELL operations)

`partner_api.py` serves external partner sites. Partner-facing documentation is
in `PARTNER_API.md`; send partners that file, never this section.

Setup: apply `supabase/migrations/20261027000000_partner_api.sql`, then redeploy
this service. No new environment variables are needed.

All of the following run in the Supabase SQL editor.

Add a partner (commission is the percentage of BUYSELL's price the partner keeps):

```sql
insert into public.partners (partner_name, commission_rate, allowed_origins, contact_email)
values ('Shop A', 10, array['https://shop-a.com'], 'tech@shop-a.com')
returning id;
```

Issue a key. The plaintext key is shown only once, so send it to the partner
securely. Use `array['feed']` for a key that will be used in browser code:

```sql
select * from public.issue_partner_api_key('<partner id>', array['feed', 'orders'], 'production');
```

Revoke a key, or suspend a partner:

```sql
select public.revoke_partner_api_key('<key id>');
update public.partners set status = 'suspended' where id = '<partner id>';
```

Changes take effect within about a minute, because the API caches key lookups.

Balances and orders that need attention:

```sql
select * from public.partner_ledger_balances;
select partner_order_id, payment_status, amount_due, review_notes
from public.partner_orders where needs_review order by created_at desc;
```

After a partner pays, mark their paid orders up to that point as settled:

```sql
select public.settle_partner_orders('<partner id>', now(), 'TRF-2026-11-01');
```

Run the tests with `python -m unittest discover -s tests` (requires `requirements.txt`).
