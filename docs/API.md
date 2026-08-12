# BUYSELL API contract

## Conventions

Base path: `/api/v1`. JSON is UTF-8. Private requests send `Authorization: Bearer <Supabase access token>`. Order creation and other retry-sensitive mutations send `Idempotency-Key`. Clients may send `X-Request-Id`; the server always returns a request ID header.

Success:

```json
{ "success": true, "data": {}, "meta": { "page": 1, "limit": 24, "total": 42, "pages": 2 } }
```

Failure:

```json
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "Check the highlighted fields.", "details": [] }, "requestId": "..." }
```

Money values are integer minor units and are serialized as base-10 strings, for example `"totalKobo": "1250000"`. Dates are ISO-8601 UTC. List endpoints accept `page` (default 1) and `limit` (bounded to 100) unless noted. Unsupported filters and sort values are rejected rather than interpolated into SQL.

Common errors: `400 VALIDATION_FAILED`, `401 AUTH_REQUIRED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT` or domain idempotency/state conflict, `422` domain rule failure, `429 RATE_LIMITED`, and `503` dependency/configuration unavailable. A resource owned by another user may deliberately return `404`.

## Health and identity

| Method and route | Auth | Input | Response | Important errors |
| --- | --- | --- | --- | --- |
| `GET /health` | Public | None | Liveness, version, timestamp | `500` only if process cannot respond |
| `GET /ready` | Public | None | Safe readiness summary including database | `503 NOT_READY` |
| `GET /auth/me` | Required | None | Internal user profile, platform roles, active store memberships/permissions | `401`, suspended account `403` |

`/ready` never returns connection strings, keys, host internals, or provider secrets.

## Public catalog

| Method and route | Auth | Query/body | Response | Important errors |
| --- | --- | --- | --- | --- |
| `GET /home` | Optional | collection limits | Categories, new products, real collections/stores | invalid limit `400` |
| `GET /products` | Optional | `page`, `limit`, `category`, `brand`, `store`, `minPriceKobo`, `maxPriceKobo`, `condition`, `sort` | Active product cards + page meta | invalid filter `400` |
| `GET /products/:identifier` | Optional | UUID or slug | Public product DTO | `404` |
| `GET /categories` | Public | optional parent | Active category tree | `400` |
| `GET /stores/:slug` | Optional | pagination/filter query | Public store DTO and products | `404` |
| `GET /products?q=...` | Optional | `q`, catalog filters, `sort`, pagination | Matching product results | overlong/invalid query `400` |

Public DTOs contain only published product/store/media data. Inventory is expressed as availability, not sensitive operations data.

## Profile and addresses

All endpoints require authentication and ownership.

| Method and route | Body/query | Response |
| --- | --- | --- |
| `PATCH /account/profile` | Allowed display/phone/location fields | Updated profile |
| `GET /account/addresses` | Pagination | Owned addresses |
| `POST /account/addresses` | recipient, phone, address lines, city/state/postcode/country/default | Created address |
| `PATCH /account/addresses/:id` | Mutable address fields | Updated address |
| `DELETE /account/addresses/:id` | None | Deletion acknowledgement |
| `GET/PATCH /account/notification-preferences` | Email/push/marketing booleans | Preferences |

Invalid ownership returns `404`; deleting an address referenced by an active quote may return `409 ADDRESS_IN_USE`.

## Cart, wishlist, checkout, and orders

| Method and route | Auth | Body | Response | Important errors |
| --- | --- | --- | --- | --- |
| `GET /cart` | Required | — | Cart with current variant summaries | — |
| `PUT /cart/items/:variantId` | Required | `{ quantity }` | Upserted cart item | `NOT_FOUND`, `INSUFFICIENT_STOCK` |
| `DELETE /cart/items/:variantId` | Required/owner | — | Removal acknowledgement | — |
| `GET /wishlist` | Required | pagination | Saved products |
| `PUT /wishlist/:productId` | Required | — | Saved item/idempotent success | `NOT_FOUND` |
| `DELETE /wishlist/:productId` | Required | — | Removal acknowledgement | — |
| `POST /checkout/quotes` | Required | `{ addressId, deliveryMethod, couponCode? }` | Expiring server-priced quote | `CART_EMPTY`, `PRICE_CHANGED`, stock/coupon errors |
| `GET /checkout/quotes/:id` | Required/owner | — | Quote and expiry | `QUOTE_EXPIRED`, `404` |
| `POST /orders` | Required + `Idempotency-Key` | `{ quoteId }` | Created or replayed order | `QUOTE_CONSUMED`, `QUOTE_EXPIRED`, stock conflict |
| `GET /orders` | Required | status/pagination | Buyer's orders | invalid status `400` |
| `GET /orders/:id` | Required/owner | — | Buyer order with store groups/timeline | `404` |
| `POST /orders/:id/cancel` | Required/owner | `{ reason? }` | Updated order | `INVALID_ORDER_TRANSITION` |

The quote response is the only displayed checkout price authority. The order request does not accept item price, shipping, commission, seller amount, or total.

## Flutterwave payments and webhook

| Method and route | Auth | Body | Response | Important errors |
| --- | --- | --- | --- | --- |
| `POST /orders/:id/payments/flutterwave` | Required/order owner | — | Payment ID/reference and hosted checkout URL | invalid order state, `PAYMENT_NOT_CONFIGURED` |
| `POST /payments/:id/verify` | Required/order owner | `{ transactionId }` | Normalized payment/order status | reference/currency/amount/status mismatch |
| `GET /payments/:id` | Required/order owner | — | Safe normalized payment state | `404`/`403` |
| `POST /payments/flutterwave/webhook` | Valid provider signature | Raw body + provider event | Prompt acknowledgement; processing is idempotent | invalid signature `401/400` |

Initialization loads the expected amount/currency/reference from the database. Verification re-queries Flutterwave. Duplicate events return success after recognizing the unique provider event; they never repeat stock or ledger effects.

## Conversations, reviews, and notifications

| Method and route | Auth/permission | Input | Response |
| --- | --- | --- | --- |
| `GET /conversations` | Required | type/pagination | Member's conversations |
| `POST /conversations` | Required and valid order/sourcing relationship | `{ participantId?, orderId?, sourcingRequestId? }` | Existing/new conversation |
| `GET /conversations/:id/messages` | Conversation member | cursor/limit | Messages |
| `POST /conversations/:id/messages` | Conversation member | `{ body, mediaAssetId? }` | Message |
| `POST /conversations/:id/read` | Conversation member | `{ through? }` | Read state |
| `POST /orders/:orderId/items/:itemId/reviews` | Eligible order-item buyer | `{ rating, body? }` | Review |
| `PATCH /reviews/:id` | Review owner | mutable body/rating | Updated review |
| `DELETE /reviews/:id` | Review owner/moderator | — | Removed/status response |
| `GET /notifications` | Required | unread/page | Notifications |
| `POST /notifications/:id/read` | Owner | — | Updated notification |
| `POST /account/push-subscriptions` | Required | endpoint/keys/device metadata | Upserted subscription |

Guessing a conversation, message, notification, or review ID never grants access. Common domain failures include `NOT_A_CONVERSATION_MEMBER`, `REVIEW_NOT_ELIGIBLE`, and `REVIEW_ALREADY_EXISTS`.

## Media

| Method and route | Auth/permission | Body | Response |
| --- | --- | --- | --- |
| `POST /media/uploads/authorize` | Required + purpose permission | `{ purpose, kind, mimeType, bytes, filename, access }` | Short-lived signed upload fields/URL |
| `POST /media/assets` | Required | provider/object metadata from completed upload | Registered MediaAsset DTO |
| `GET /media/assets/:id/access` | Owner, related participant, or privileged role | — | Public URL or short-lived signed private URL |

Errors include `MEDIA_TOO_LARGE`, `MEDIA_TYPE_NOT_ALLOWED`, `MEDIA_PROVIDER_UNAVAILABLE`, `MEDIA_NOT_FOUND`, and `FORBIDDEN`. Client-provided provider metadata is verified before registration.

## Product Sourcing

Public sourcing endpoints require authentication and are scoped to the requester.

| Method and route | Permission | Input | Response |
| --- | --- | --- | --- |
| `GET /sourcing` | read own | pagination/status | Public sourcing request DTOs |
| `POST /sourcing` | create | `{ deliveryLocation?, desiredDeliveryAt?, notes?, items[] }` | Created public request DTO |
| `GET /sourcing/:id` | read own | — | Public request, items, quotes/history |
| `POST /sourcing/:id/quotes/:quoteId/accept` | accept own | — | Updated public request/status |

Each item accepts title, description, specifications, positive quantity, optional generic `referenceUrl`, optional reference media, and target budget. Public responses are constructed by `publicSourcingRequest()` and never contain `SourcingProcurement` or upstream source/supplier/cost data.

Internal routes require `sourcing.internal.read`, `sourcing.internal.write`, or `sourcing.procurement.manage` as indicated:

| Method and route | Permission | Input/response |
| --- | --- | --- |
| `GET /admin/sourcing` | internal read | Filters/pagination; admin DTO list |
| `GET /admin/sourcing/:id` | internal read | Admin DTO with deliberately included procurement section |
| `PATCH /admin/sourcing/:id` | internal write | Assignment/public status/note; audited admin DTO |
| `PUT /admin/sourcing/:id/procurement` | procurement manage | Internal source/supplier/cost/status fields; audited admin DTO |
| `POST /admin/sourcing/:id/quotes` | internal write | Customer-facing quote amounts/expiry/terms |

## Seller API

All seller endpoints require authentication, an active membership for `storeId`, and the listed store permission.

| Method and route | Permission | Input/response |
| --- | --- | --- |
| `GET /seller/stores` | Authenticated | Current user's store memberships |
| `POST /seller/onboarding/store` | Authenticated | Validated store + owner membership |
| `GET /seller/:storeId/dashboard` | `STORE_READ` | Real store summary |
| `GET/POST /seller/:storeId/products` | `PRODUCT_READ` / `PRODUCT_WRITE` | Filtered list / validated draft product |
| `PATCH/DELETE /seller/:storeId/products/:productId` | `PRODUCT_WRITE` | Store-scoped edit/archive |
| `PATCH /seller/:storeId/inventory/:variantId` | `INVENTORY_WRITE` | `{ onHand, reorderPoint?, note }`; inventory + movement |
| `GET /seller/:storeId/orders` | `ORDER_READ` | Store order filters/page |
| `PATCH /seller/:storeId/orders/:storeOrderId/status` | `ORDER_FULFIL` | `{ status, note? }` |
| `GET /seller/:storeId/analytics` | `STORE_READ` | Real period aggregates |
| `GET /seller/:storeId/finance` | `FINANCE_READ` | Ledger balance/entries/payouts |
| `GET/POST /seller/:storeId/payout-destinations` | finance read / payout request | Safe list / protected destination creation |
| `POST /seller/:storeId/payouts` | `PAYOUT_REQUEST` | `{ destinationId, amountKobo }` |
| `GET/POST/DELETE /seller/:storeId/team` | `STAFF_MANAGE` | Memberships/roles/overrides |
| `GET/POST /seller/:storeId/ads` | `AD_MANAGE` | Store campaigns |
| `GET/PUT /seller/:storeId/settings` | store read/update | Store setting groups |
| `GET/POST /seller/:storeId/coupons` | `STORE_UPDATE` | Store coupons |

Equivalent seller messaging, customer, referral, settings, and sourcing routes preserve the same store/owner scoping. Invalid store context returns `403`; IDs from another store return `404`.

## Supplier and RFQ API

Supplier endpoints require an eligible `SupplierProfile` and scope all catalog/quote reads and writes to it. Important endpoints are `GET/PATCH /supplier/profile`, `GET/POST/PATCH /supplier/catalog`, `GET /supplier/requests`, `GET /supplier/requests/:id`, `POST /supplier/requests/:id/quotes`, and supplier messages. RFQ request visibility follows its status and invitation policy; a supplier cannot edit another supplier's quote. Award is an audited requester/admin operation.

## Trust, operations, and admin API

| Area | Important routes | Required authorization |
| --- | --- | --- |
| KYC | `/kyc`, `/kyc/:id`, `/admin/kyc`, `/admin/kyc/:id/decision` | own subject; admin `kyc.read/manage` |
| Disputes | `/disputes`, `/disputes/:id/messages`, `/admin/disputes/*` | order participant; `disputes.read/manage` |
| Users/stores | `/admin/users`, `/admin/users/:id/status`, `/admin/stores`, `/admin/stores/:id/status`, `/admin/export/:resource` | `users.read` or `stores.read`; mutations/exports audited |
| Catalog moderation | `/admin/products`, `/admin/categories` | `products.read/moderate`, `categories.manage` |
| Orders | `/admin/orders`, detail/transition | `orders.read/manage` |
| Payments/finance | `/admin/payments`, finance, commissions, payouts | `payments.read`, `finance.read`, `payouts.manage` |
| Advertising | `/admin/ads`, `/admin/ads/:id/status` | `advertising.manage` |
| Broadcasts | `/admin/broadcasts/*` | authorized content/operations role; fan-out via outbox |
| Analytics | `/admin/analytics` | explicit analytics/admin permission |
| Audit/settings | `/admin/audit`, `/admin/settings`, `/admin/settings/:key`, `/admin/permissions` | applicable user/settings permission |

Admin collection endpoints are always paginated. CSV exports apply the same filters/authorization, escape spreadsheet-control prefixes, and may become asynchronous for large results. Mutations accept a reason where accountability requires it and write `AuditLog` in the same transaction.

## Compatibility and versioning

`/api/v1` changes add fields compatibly where possible. Removing/renaming a field or changing semantics requires a new API version or an announced deprecation window. Frontend code must tolerate additive fields but must not spread unrecognized server objects into public output. Legacy Supabase Edge Functions are not API aliases; after verified migration they are disabled according to the cutover plan.
