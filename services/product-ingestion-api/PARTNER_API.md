# BUYSELL Partner API

Sell BUYSELL products on your own site: read our catalog and ads, take payment on your checkout, and report each order back to us. BUYSELL tracks what is owed for each order and settles with you periodically.

**Base URL:** `https://<buysell-api-host>/api/v1/partner` (BUYSELL gives you the host along with your key)

## Authentication

Send your API key in a header on every request:

```
X-BUYSELL-API-KEY: bsk_live_…
```

- Keep the key on your server. Anyone holding it can report orders on your account.
- Keys can be limited to the `feed` scope. A feed-only key is the only kind that is safe to use in browser code.
- If a key leaks, ask BUYSELL to revoke it and issue a new one.

All responses are JSON. Successful responses contain `"success": true`. Errors look like this:

```json
{ "success": false, "error": { "code": "invalid_api_key", "message": "…" } }
```

## 1. Catalog feed: `GET /feed`

Returns active, in-stock products and current BUYSELL ads. Prices are in Naira and are the prices to charge your customers.

| Query | Default | Notes |
|---|---|---|
| `limit` | 50 | 1–100 products per page |
| `offset` | 0 | Use `pagination.next_offset` to read the next page |
| `category` | – | Optional: `electronics`, `fashion`, `home`, `phones`, `beauty`, `sports`, `dropship` or `other` |

```bash
curl -H "X-BUYSELL-API-KEY: $BUYSELL_KEY" "https://<host>/api/v1/partner/feed?limit=50"
```

```json
{
  "success": true,
  "data": {
    "ads": [
      { "id": "…", "title": "Mega Sale", "description": "…", "image_url": "https://…", "video_url": null, "cta_text": "Shop now", "link": "https://…" }
    ],
    "products": [
      { "id": "…", "title": "Smart Watch", "price": 25000, "currency": "NGN", "stock": 15, "image_url": "https://…", "seller_id": "…", "category": "electronics" }
    ]
  },
  "pagination": { "limit": 50, "offset": 0, "next_offset": 50 }
}
```

- Results are cached for about 60 seconds. Refresh the feed periodically, and always read it again before showing a price at checkout.
- The feed allows browser requests (CORS) only from the website origins registered with BUYSELL for your account.

## 2. Report an order: `POST /orders`

Call this from your server as soon as an order is created, and again whenever its payment status changes. Requests sent from a browser are refused.

```bash
curl -X POST "https://<host>/api/v1/partner/orders" \
  -H "X-BUYSELL-API-KEY: $BUYSELL_KEY" -H "Content-Type: application/json" \
  -d '{
    "partner_order_id": "ORD-10045",
    "payment_status": "paid",
    "payment_reference": "PSK_8xk2…",
    "currency": "NGN",
    "total_amount": 50000,
    "customer": { "name": "Ada Obi", "phone": "0803…", "email": "ada@example.com", "address": "12 Allen Ave, Ikeja, Lagos" },
    "items": [ { "product_id": "<BUYSELL product id>", "quantity": 2, "unit_price": 25000 } ]
  }'
```

| Field | Required | Rules |
|---|---|---|
| `partner_order_id` | yes | Your order ID: 1–120 letters, digits or `. _ : -`. Unique per order. |
| `payment_status` | yes | `pending`, `paid`, `failed`, `cancelled` or `refunded` |
| `payment_reference` | no | Your payment provider's reference (up to 200 characters) |
| `currency` | no | `NGN` only |
| `total_amount` | yes | What the customer paid for these items |
| `customer` | no | `name`, `phone`, `email`, `address`. Used for delivery and support. |
| `items` | yes | 1–50 lines, each product at most once: `product_id`, `quantity` (1–1000), `unit_price` |

**Responses**
- `201`: order recorded.
- `200`: status updated, or a repeat of a report we already have (no change made).

Either way, `data.order` holds BUYSELL's record, including `amount_due` (what you owe for this order) and `settlement_status`.

**Retries are safe.** Sending the same report again never creates a second order. If a request times out, resend it with the same `partner_order_id`.

**Payment status changes.** Report the same order with the new status. The items must be exactly the same as in the first report. The allowed changes are:

```
pending -> paid | failed | cancelled
paid    -> refunded | cancelled
```

**Stock** is reserved when an order becomes `paid` and released if it is later refunded or cancelled.

**Pricing.** Amounts owed are based on BUYSELL's price for each product at the time of the order. If the `unit_price` you send differs, the order is still recorded but flagged for review.

## 3. Look up an order: `GET /orders/{partner_order_id}`

Returns the same `order` object as above, or `404 order_not_found`.

## 4. Your balance: `GET /ledger`

```json
{
  "success": true,
  "data": {
    "commission_rate": 10, "currency": "NGN",
    "unsettled_orders": 3, "unsettled_sales": 105000, "unsettled_commission": 10500,
    "amount_due": 94500, "total_settled": 250000, "orders_needing_review": 1
  }
}
```

- `amount_due` is what you currently owe BUYSELL: paid, unsettled orders at BUYSELL prices, minus your commission.
- When BUYSELL receives your settlement payment, those orders move to `settled`.

## Errors

| HTTP | `code` | Meaning |
|---|---|---|
| 401 | `invalid_api_key` | Missing, malformed, unknown or revoked key |
| 403 | `insufficient_scope` | The key doesn't have the scope this endpoint needs |
| 403 | `server_only` | An order endpoint was called from a browser |
| 403 | `partner_inactive` | Your partner account is suspended |
| 404 | `order_not_found` | No recorded order has that ID |
| 409 | `order_items_changed` | The order was already recorded with different items |
| 409 | `invalid_status_transition` | That status change isn't allowed, e.g. `refunded` → `paid` |
| 413 | `request_too_large` | The request body is over 64 KB |
| 422 | `invalid_payload` / `invalid_parameter` | Bad input; `message` says which field |
| 422 | `unknown_product` | A `product_id` doesn't exist on BUYSELL |
| 429 | `rate_limited` | Too many requests. Wait for the number of seconds in the `Retry-After` header. |
| 502 | `upstream_unavailable` / `upstream_error` | A temporary BUYSELL problem. Retry; order reports are safe to repeat. |

**Rate limits:** 120 feed requests and 300 order requests per minute, per key.
