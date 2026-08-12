# Supabase → BUYSELL PostgreSQL migration

The legacy repository is a static HTML/CSS/JS application whose runtime depends on Supabase Auth, public tables, Storage and Edge Functions. The source README references several Supabase SQL migration files, but those files are not present in the repository tree, so V1.2 reconstructs the target schema from the tables, columns and operations actually used by the running application.

## Replacement map

| Legacy dependency | V1.2 replacement |
|---|---|
| Supabase Auth | PostgreSQL `users` + `user_roles` + rotated `refresh_sessions`; access JWTs issued by the API |
| Browser `db.from(...)` reads/writes | `/api/v1/*` REST modules with ownership/RBAC checks |
| Supabase RLS | server authorization + SQL constraints/transactions |
| Supabase Storage | API upload boundary + S3-compatible object storage |
| Supabase Edge Functions | Express modules for product/order/profile/review/payment/withdrawal/dispute/admin/KYC/coupon/ad/dropship/notification/analytics operations |
| Supabase Realtime-style messaging | durable conversation/message APIs; transport can later be upgraded to WebSocket/SSE without changing domain storage |
| Direct analytics writes | `/api/v1/analytics/events` |

## Authentication continuity

Supabase/GoTrue exports may contain bcrypt-compatible `encrypted_password` values. `scripts/import-supabase-export.mjs` maps those hashes into `users.password_hash`. Login verification uses PostgreSQL `pgcrypto.crypt()`, so compatible imported bcrypt hashes can continue to authenticate without calling Supabase. Accounts with no portable password hash are marked `password_reset_required` during import.

Do not expose the exported `auth.users` dataset publicly. Treat it as a one-time sensitive migration asset and destroy local copies after verification/backups are complete.

## Data export format

Create a private directory such as `backend/legacy-export/`. Export each Supabase table as JSON named after the table, for example:

- `auth_users.json` — export of `auth.users`
- `profiles.json`
- `categories.json`
- `products.json`
- `wishlists.json`
- `compare_items.json`
- `orders.json`
- `order_items.json`
- `order_tracking.json`
- `reviews.json`
- `conversations.json`, `conversation_members.json`, `messages.json`
- `wallet_transactions.json`, `withdrawals.json`, `disputes.json`
- `kyc_verifications.json`
- `upcoming_products.json`, `referrals.json`, `broadcasts.json` where present
- dropship/supplier/coupon/advertising/notification/analytics/landing-media tables where present

The importer introspects the V1.2 target table and only inserts source columns that still exist. It also maps legacy table/column shapes (for example `order_tracking` → `order_status_events`, `broadcasts` → `broadcast_jobs`, ad/receipt aliases), converts legacy naira amounts to integer kobo, normalizes status values, recreates orphan direct-message conversations, and preserves compatible password hashes.

## Import sequence

1. Provision an empty V1.2 PostgreSQL database.
2. Run `npm run db:migrate`.
3. Set `LEGACY_EXPORT_DIR=/secure/path/to/export`.
4. Run `npm run db:import:supabase` from `backend` (or through the root workspace command).
5. Compare record counts and sample critical orders/products/users.
6. Configure `STORAGE_DRIVER=s3` and all `S3_*` variables.
7. Set `LEGACY_SUPABASE_HOST=<project-ref>.supabase.co` and run `npm run db:migrate:media` to copy Supabase-hosted product media, KYC files, receipts, ads, landing assets and upcoming-product media into the new object store and rewrite their URLs.
8. Run authentication, checkout/payment, seller fulfillment, chat, KYC, admin and upload smoke tests against V1.2.
9. Put Supabase into a short read-only/freeze window for the final delta export, repeat the import for new rows, verify counts, then switch the frontend to the new API.
10. After successful cutover, rotate/revoke old Supabase keys and remove the old project only after backups are retained according to policy.

## Edge Function parity

- `delete-account` → `DELETE /api/v1/profile`
- `manage-product` → `/api/v1/products`
- `order-action`, `create-order` → `/api/v1/orders`
- `update-profile` → `PATCH /api/v1/profile/me`
- `request-withdrawal` → `/api/v1/withdrawals`
- `manage-dropship`, `extract-1688-product` → `/api/v1/dropship/*`
- `submit-dispute` → `/api/v1/disputes`
- `admin-action`, `admin-kyc` → `/api/v1/admin/*`
- `send-broadcast` → `POST /api/v1/admin/broadcasts`
- `submit-review` → `/api/v1/reviews`
- `seller-analytics` → `GET /api/v1/analytics/seller`
- `manage-coupon` → `/api/v1/coupons`
- Flutterwave verification → `/api/v1/payments/flutterwave/*`
- notification registration/inbox → `/api/v1/notifications/*`
- AI handlers → `/api/v1/ai/*` adapter boundary

External AI, scraping and push-delivery providers are deliberately not faked: the stable backend endpoints remain, but provider-specific external calls require server-side credentials/adapters.
