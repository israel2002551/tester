# Legacy V1 → V1.2 feature parity map

This inventory was reconstructed from the legacy `app.js`, `index.html`, legal pages and README before restructuring the application.

## Identity and roles
- Supabase Auth signup/login/session → `/api/v1/auth/*`, PostgreSQL `users`, `refresh_sessions`, `user_roles`.
- Legacy buyer/seller entry switch → durable role workspaces.
- Seller verification/KYC → `/account/kyc`, `/seller/kyc`, admin KYC review.
- Account deletion → backend account deactivation/anonymisation path.
- New V1.2 roles: supplier, seller manager, rider, with server-enforced role/assignment checks.

## Buyer marketplace
- Browse/search/category/storefront/product detail.
- Cart, wishlist, compare, checkout.
- Reviews and verified-purchase-compatible review storage.
- Orders, status timeline and delivery tracking.
- Buyer/seller conversations and unread state.
- Disputes.
- Upcoming product announcements.
- Addresses and account/profile pages.

## Seller
- Products: create/edit/publish/pause/delete, stock, video/image metadata, flash pricing.
- Orders and fulfillment status.
- Seller analytics/revenue.
- Store profile and payout profile.
- Withdrawals.
- Coupons.
- Ads.
- Dropshipping connections/catalog/imports and 1688 extraction adapter endpoint.
- Seller manager assignments with permission JSON and task delegation.
- Referral/affiliate history.

## Admin
- Marketplace overview.
- User/seller status operations.
- Order moderation.
- Dispute resolution/refund state.
- Withdrawal review.
- KYC review.
- Advertisement and commission-receipt review.
- Broadcast creation/history plus role-targeted user inbox records.
- Upcoming-product publishing/moderation.
- Audit log.

## Supplier / manager / rider
- Supplier-owned catalog/profile, seller connections and supplier order visibility.
- Seller-manager delegated product/order/customer permissions.
- Rider delivery assignments/status updates.

## Infrastructure formerly handled by Supabase
- Tables/RLS → PostgreSQL + Express authorization checks.
- Auth → JWT access tokens + rotated DB-backed refresh sessions; imported compatible bcrypt hashes can be verified by PostgreSQL `pgcrypto`.
- Storage → backend upload boundary; S3-compatible object storage in production.
- Edge Functions → Express modules for product/order/profile/review/payment/withdrawal/dispute/admin/KYC/coupon/ad/dropship/notifications/analytics operations.
- Realtime-style messaging → durable REST conversation/message endpoints; WebSocket/SSE transport can be added behind the same module later without changing URLs.

## Legacy runtime adapters intentionally not faked
External scraping/AI/push-delivery providers require provider credentials. V1.2 keeps stable server endpoints and database models for them, but returns an explicit unavailable/adapter response instead of fabricating successful external work when no provider is configured.
