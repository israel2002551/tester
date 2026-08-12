# Architecture

## Decision

V1.2 uses a modular monorepo with independently runnable frontend and backend folders. The marketplace and landing site are separate deployable React apps, while the API is a modular Express service backed by PostgreSQL.

```text
buysell-v1.2/
├── frontend/
│   ├── apps/
│   │   ├── marketplace/      # role-aware React SPA
│   │   └── landing/          # public brand/download site
│   └── packages/ui/          # shared presentation primitives
├── backend/
│   ├── src/
│   │   ├── middleware/       # auth/RBAC/error/rate-limit boundaries
│   │   └── modules/          # domain modules, not one giant controller
│   └── database/migrations/  # deterministic SQL migrations
└── docs/
```

## Frontend routing model

The old application used one giant HTML document and many modals. V1.2 gives durable concepts durable URLs. Modals are retained only for short confirmations or small forms.

Public:
- `/shop`, `/search`, `/category/:slug`, `/products/:productId`, `/store/:sellerId`
- `/terms`, `/privacy`, `/upcoming`

Buyer:
- `/cart`, `/checkout`, `/wishlist`, `/compare`
- `/orders`, `/orders/:orderId`, `/orders/:orderId/tracking`
- `/messages`, `/messages/:conversationId`
- `/account`, `/account/profile`, `/account/addresses`, `/account/kyc`
- `/disputes`, `/disputes/:disputeId`

Seller:
- `/seller`, `/seller/products`, `/seller/products/new`, `/seller/products/:productId/edit`
- `/seller/orders`, `/seller/orders/:orderId`
- `/seller/analytics`, `/seller/storefront`, `/seller/profile`, `/seller/kyc`
- `/seller/withdrawals`, `/seller/coupons`, `/seller/ads`
- `/seller/dropshipping`, `/seller/dropshipping/import`, `/seller/dropshipping/1688`
- `/seller/team`, `/seller/referrals`

Supplier:
- `/supplier`, `/supplier/catalog`, `/supplier/orders`, `/supplier/connections`, `/supplier/profile`

Seller manager:
- `/manager`, `/manager/products`, `/manager/orders`, `/manager/customers`, `/manager/tasks`

Rider:
- `/rider`, `/rider/deliveries`, `/rider/deliveries/:deliveryId`, `/rider/earnings`, `/rider/profile`

Admin:
- `/admin`, `/admin/users`, `/admin/sellers`, `/admin/orders`, `/admin/disputes`
- `/admin/withdrawals`, `/admin/kyc`, `/admin/ads`, `/admin/receipts`
- `/admin/broadcasts`, `/admin/upcoming`, `/admin/analytics`, `/admin/audit-log`

## Backend principles

1. Browser clients never receive database credentials.
2. All state-changing actions are authorized on the server.
3. RBAC is explicit and auditable instead of relying on frontend role checks.
4. SQL migrations are append-only and tracked in `schema_migrations`.
5. Payment verification is server-to-server; public payment keys may be used in the browser, secret keys never are.
6. Uploads pass through an API authorization boundary and a storage provider abstraction.
7. Existing Supabase Edge Function names are mapped to explicit REST endpoints so the migration can be tested feature-by-feature.

## Role model

`buyer` is the default account role. A user can own multiple roles through `user_roles`. The backend middleware exposes `requireRole(...roles)` and seller-scoped resources additionally verify ownership/delegation. Seller managers receive explicit seller assignments rather than inheriting global seller privileges.

## Long-term scaling

The API stays a modular monolith initially: easier transactions, migrations, and deployments than premature microservices. Module boundaries make later extraction straightforward for high-load domains such as search, chat, notifications, payments, and fulfillment.


## Deployment topology rationale

The repository intentionally stays a monorepo while each deployable app has a clear root directory. Marketplace and landing are independent frontend deploys; the API is independently deployable; PostgreSQL and object storage are attached resources configured through environment variables. That keeps role/domain code cohesive without coupling release lifecycles or exposing infrastructure credentials to browser bundles.

Supplier catalog ownership, seller-manager assignments/tasks, and rider deliveries are explicit database relationships rather than frontend-only roles. This lets the authorization layer answer “which seller/supplier/delivery may this user operate on?” for every write.
