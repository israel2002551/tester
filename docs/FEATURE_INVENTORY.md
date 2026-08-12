# Target feature inventory

This is the functional map for the rebuilt BUYSELL application. “API-backed” means the browser uses the BUYSELL API; Supabase client use is limited to authentication. Availability must reflect real records: no fabricated ratings, sellers, revenue, stock, trends, discounts, or delivery claims.

| Area | User capability | Frontend surface | Backend/domain source | Acceptance condition |
| --- | --- | --- | --- | --- |
| Discovery | See marketplace content immediately | `/`, `/marketplace`, `/products` | categories, active products, stores | Loading/error/empty states; bounded public queries |
| Search | Search and sort products | `/search` | indexed product query | Debounced query; filters are server-side; no unbounded download |
| Category | Browse hierarchy and filters | `/category/:slug` | Category tree + catalog | Canonical slug, result count, pagination, 2-column usable mobile grid |
| Product | Inspect media, variants, stock, seller, delivery, reviews | `/product/:slug` | Product/variant/inventory/store/review DTO | Only real availability/rating; responsive buy box and sticky mobile action |
| Store | Browse a verified seller's catalog | `/store/:slug` | Store and published products | Unique canonical slug; private store data omitted |
| Auth | Sign up, login, OAuth, recover/reset | `/login`, `/signup/*`, auth callback | Supabase Auth + AuthIdentity | Existing account continuity; normalized errors; no duplicate seller account |
| Account | Manage profile, addresses, security/preferences | `/account/*` | UserProfile, Address, NotificationPreference | Ownership checks and accessible forms |
| Cart | Add/update/remove, merge anonymous cart | `/cart` | Cart/CartItem + variant validation | Server cart after login; stock/price revalidated |
| Wishlist | Save products | `/wishlist` | Wishlist/WishlistItem | Duplicate-safe, cross-device authenticated state |
| Checkout | Address, delivery, coupon, quote | `/checkout` | CheckoutQuote/Item | Server-authoritative, expiring quote; duplicate submit blocked |
| Payment | Open hosted payment and reconcile | checkout/success + API | Payment/Attempt/WebhookEvent | Provider verification and idempotent financial effects |
| Orders | List/detail/status timeline | `/orders`, `/orders/:id` | Order/StoreOrder/Item/Event | Buyer ownership; historical snapshots; clear multi-store grouping |
| Reviews | Review eligible delivered purchase | product/order surfaces | Review linked to OrderItem | One per eligible line item; moderation state |
| Messages | Conversation list, order/sourcing chat | `/messages/*` | Conversation/Member/Message | Membership checked on every read/write; paginated history |
| Notifications | Read/mark preferences/push | account/header | Notification, preferences, subscriptions | Permission asked contextually; user owns subscription |
| Seller onboarding | Create store and save progress | `/seller/onboarding` | Store, StoreSetting, KYC | One user may also buy; no duplicate identity |
| Seller dashboard | Real operating summary | `/seller/dashboard` | server aggregates | No demo values in production; date scope shown |
| Seller store | Edit public identity/settings | `/seller/store/*` | Store/Setting/Media | Membership + `STORE_UPDATE`; logo/banner validated |
| Seller products | Draft/create/edit/publish/archive | `/seller/products/*` | Product/variants/options/media | Permissioned; autosave/progress where practical; status validation |
| Seller inventory | Adjust and inspect stock | `/seller/inventory` | InventoryItem/Movement | Every adjustment has reason/actor; low-stock query |
| Seller orders | Fulfil store portion and track | `/seller/orders/*` | StoreOrder/Event/Delivery | Store-scoped and valid transitions only |
| Seller finance | View ledger and request payout | `/seller/finance*`, `/seller/payouts` | Ledger/Payout models | Balance server-calculated; concurrent requests safe |
| Seller team | Invite/manage scoped members | `/seller/team` | StoreMembership/Permission | Owner/admin rules; self-lockout safeguards; audit trail |
| Seller advertising | Create/pay/track campaigns | `/seller/advertising/*` | AdCampaign/Event | Real impressions/clicks; approval and schedule state |
| Seller referrals | Codes, visits, conversions | `/seller/referrals` | Referral models | Only observed events; preserved legacy relationships |
| Product sourcing | Request unlisted/bulk products | `/sourcing*`, `/seller/sourcing*` | public sourcing models | Provider-neutral copy/DTO; own requests only |
| Supplier | Profile/catalog/RFQ responses | `/supplier/*` | SupplierProfile/Product, RFQ | Enabled only for verified real workflow; supplier-scoped access |
| Services | Offer/request a service | service discovery/account routes | ServiceListing/Booking | Staged behind actual policy/data; clear booking lifecycle |
| Delivery | Show and operate fulfilment | `/delivery`; role-specific operations | Hub/DeliveryAssignment | No unsupported operational claims; assignment-scoped access |
| Admin shell | Role-aware operations navigation | `/admin/*` | permission map | Backend role checks; route-level error/empty/loading states |
| Admin users | Search/view/suspend/export users | `/admin/users*`, buyers/sellers/suppliers | User/store/supplier services | Filtered pagination, audited mutations, safe CSV |
| Admin catalog | Moderate products/categories | `/admin/products*`, categories | catalog moderation | Reject/reinstate reasons; actor audit |
| Admin orders/payments | Inspect and resolve exceptions | `/admin/orders*`, payments | order/payment views | No manual “mark paid” without verified process |
| Admin finance | Commissions, payout review | `/admin/finance*`, payouts | ledger/payout services | Finance permission, immutable evidence, provider status distinct |
| Admin trust | KYC and dispute work queues | `/admin/kyc*`, `/admin/disputes*` | trust models/private media | Least privilege, expiring documents, decision audit |
| Admin sourcing | Customer request + private procurement workspace | `/admin/sourcing*` | sourcing + procurement | Private pane only for sourcing permissions; explicit admin DTO |
| Admin campaigns | Ads and broadcasts | `/admin/advertising*`, `/admin/broadcasts*` | campaigns, delivery/outbox | Async fan-out; no recipient leak; delivery outcomes |
| Admin analytics | Real marketplace aggregates | `/admin/analytics` | bounded aggregate queries | Metric definitions/date range displayed; export permissioned |
| Admin settings/audit | Safe settings and sensitive action log | `/admin/settings`, `/admin/audit-logs` | SiteSetting/AuditLog | Secrets excluded; schema validation; append-only audit |
| Marketing/trust | Understand buying, selling, protection, sourcing | informational routes | curated content | Accurate, BUYSELL-owned language; legal review flags where needed |
| SEO | Discover public products/stores/categories | public route metadata/sitemap | public API/build data | Canonicals and structured data; dashboards excluded |
| Accessibility | Operate with keyboard/screen reader | all routes | shared components | Visible focus, labels, semantics, reduced motion, contrast, status announcements |

## Shared experience requirements

- Every async view has loading, empty, error, retry, and success states appropriate to the task.
- Forms have persistent labels, inline validation, disabled submitting state, duplicate-submit prevention, and a useful server error.
- Brief success feedback may use a toast; critical errors remain visible in context.
- Destructive or consequential actions use a focused confirmation dialog, never a full-screen workflow disguised as a modal.
- Naira uses `Intl.NumberFormat`; dates originate as UTC and render in user context.
- Tables become cards or horizontal scroll regions on small screens; public product grids remain two columns on usable mobile widths.
- Frontend guards improve navigation but do not replace API authorization.

## Deferred-by-policy capabilities

Wallet-funded checkout, provider-specific consumer sourcing, fabricated dropship catalog connections, unsupported payment providers, and automated KYC approval are not enabled merely because legacy UI exists. They require an explicit product/security decision and production-grade server service. Their source records remain part of migration inventory and are never silently discarded.
