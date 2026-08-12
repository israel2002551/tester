# Legacy feature inventory

## Scope and status vocabulary

This inventory records behavior found in the starting repository at commit `12c88d2`. The main sources are the root `app.js`, `styles.css`, `src/legacy/marketplaceHtml.js`, partial React category pages, static HTML route wrappers, Supabase Edge Functions, service worker, and browser storage. It is a parity gate, not an assertion that every legacy behavior is safe or correct.

Statuses used below:

- **REPLACE** — valuable behavior, but the implementation must move to the new frontend/API/domain model.
- **MIGRATE** — preserve records/relationships through explicit source transforms.
- **RETIRE** — behavior is unsafe, duplicate, fabricated, or conflicts with the target product; preserve source data where relevant.
- **COMPATIBILITY** — keep only a redirect or migration adapter until inbound traffic/data has moved.
- **VERIFY LIVE** — repository references are incomplete; read-only source inventory is required before final mapping.

No legacy file should be deleted until every row has a final `MIGRATED`, `REPLACED`, `INTENTIONALLY RETIRED`, or documented `BLOCKED` decision and its data reconciliation has passed.

## Feature matrix

| Legacy feature | Current file/function or UI | Current data/backend | Concern | Replacement module / route | Status |
| --- | --- | --- | --- | --- | --- |
| Marketing landing and role portals | `marketplaceHtml.js`; `showMarketLandingPage`, `enterSite` | `landing_media`, browser role state | Giant injected HTML, unsupported claims, role as UI mode | React marketing/marketplace layout; `/` | REPLACE |
| Catalog and homepage products | `loadProducts`, `renderProducts` | direct `products`, `profiles` queries | Browser data access, fallback columns, unbounded coupling | catalog service; `/`, `/marketplace`, `/products` | MIGRATE + REPLACE |
| Category browsing/filtering | `CategoryPage`, `categoryData.js`, `applyFilters` | products downloaded then filtered | Manual path map, mixed local/server filtering | indexed catalog query; `/category/:slug` | REPLACE |
| Search | `doSearch` | client-side product list/direct query | Inconsistent results and URL state | PostgreSQL search endpoint; `/search?q=` | REPLACE |
| Product details | `openProduct`, product modal/static wrapper | direct products/profiles/reviews | Modal-page emulation, guessed columns | product DTO; `/product/:productSlug` | REPLACE |
| Storefront | `viewStorefront`, seller profile sections | `profiles`, `products` | User/store identity conflated | Store aggregate; `/store/:storeSlug` | MIGRATE + REPLACE |
| Upcoming products | `loadUpcomingProducts`, admin upcoming functions | `upcoming_products`, local interest list | Interest only local; admin mixed into app | curated catalog collection; `/upcoming` | MIGRATE + REPLACE |
| Cart | `cart`, `saveCart`, `openCart` | `bs_cart` in local storage | Modal UI, prices and availability stale | server cart + anonymous merge; `/cart` | REPLACE |
| Checkout | `startCheckout`, checkout modal | browser cart and delivery inputs | Browser-authoritative totals and state | expiring checkout quote; `/checkout` | RETIRE old flow / REPLACE |
| Flutterwave payment | `openFlutterwaveTransaction`, `saveOrderToDb`; verification functions | `verify-flutterwave-payment`, `flutterwave-webhook` | Order/stock/ledger effects not one transaction | payment service + verified webhook; `/checkout`, `/checkout/success` | REPLACE; preserve references |
| Paystack compatibility | `openPaystackTransaction`, `paystack-webhook` | stale provider naming/function | Mixed providers and incomplete parity | Explicitly unsupported unless product decision restores it | RETIRE after reference audit |
| Bank-transfer receipts | `submitTransferOrder`, `commission_receipts`, public upload | `uploads` bucket | Sensitive receipt/public URL and manual flow | private media + payment/admin review domain if retained | VERIFY LIVE |
| Wallet checkout | `createWalletRevenueOrder` | `wallet-revenue-order`, `wallet_transactions` | Balance derived in browser; flow marked paused | immutable ledger; wallet purchase remains disabled pending policy | RETIRE unsafe flow; MIGRATE ledger evidence |
| Buyer orders/tracking | `loadBuyerOrders`, `openOrderTracking` | `orders`, `order_tracking` | JSON item blobs, loose states, IDOR depends on RLS | Order/StoreOrder and events; `/orders/:id` | MIGRATE + REPLACE |
| Seller orders/fulfilment | `loadSellerOrders`, `updateOrderStatus` | direct orders + `order-action`/`order-workflow` | Client transitions, inconsistent naming | transition service; `/seller/orders/:id` | REPLACE |
| Product creation/editing | `submitProduct`, `manage-product` | products, uploads | Direct public uploads, missing-column retries | products/media/inventory services; seller product routes | MIGRATE + REPLACE |
| CSV product import | `handleCsvUpload`, `importCsvProducts` | browser parsing and product writes | Partial failures and weak validation | server validated import/report job | REPLACE |
| Inventory/status | `toggleProductStatus`, product stock fields | `products` | No reservation/movement audit | variants, inventory items/reservations/movements | MIGRATE + REPLACE |
| Seller overview/analytics | `loadSellerStats`, `renderChart`, `seller-analytics` | orders/products/withdrawals | Client revenue calculation and possible fake/derived metrics | server aggregates; `/seller/dashboard`, `/seller/analytics` | REPLACE |
| Seller finance/withdrawal | `loadWithdrawalData`, `requestWithdrawal` | orders, `withdrawals`, `wallet_transactions`, Edge Function | Race-prone recomputation; payout controls fragmented | ledger and payout service; `/seller/finance`, `/seller/payouts` | MIGRATE + REPLACE |
| Store settings/profile | `loadSettings`, `saveSettings`, `update-profile` | `profiles`, local settings | Store and personal fields conflated | UserProfile, Store, StoreSetting | MIGRATE + REPLACE |
| Store team permissions | `loadSellerPermissions`, `saveSellerPermission` | `seller_staff_permissions`, local cache | Frontend permissions not authoritative | StoreMembership/Permission; `/seller/team` | MIGRATE + REPLACE |
| Coupons/flash sales | `createCoupon`, `loadSellerCoupons`, `createFlashSale` | deployed `manage-coupon` and product fields | Missing local function/schema truth | Coupon/Redemption service; seller advertising/promotions | VERIFY LIVE + REPLACE |
| Advertising | `loadSellerAds`, `loadActiveAds`, `trackAdStat` | `advertisements`, verification function | Client event integrity, mixed payment state | AdCampaign/AdEvent; seller/admin advertising routes | MIGRATE + REPLACE |
| Reviews | review modal and CRUD functions | `reviews`, `submit-review` | Eligibility/duplicate control inconsistent | verified OrderItem review; product detail/account | MIGRATE + REPLACE |
| Wishlist and comparison | `bs_wishlist`, `bs_compare`, related modals | browser local storage | No cross-device state; modal UI | Wishlist API `/wishlist`; comparison remains local UX if retained | REPLACE |
| Direct messaging/inbox | `showInbox`, `openConversation`, `sendMessage` | `messages`, Realtime | Pairwise IDs and membership/IDOR risk | ConversationMember checks; `/messages/:id` | MIGRATE + REPLACE |
| Admin support chat | `openAdminSupportChat` | messages | Admin identity mixed with configured values | support conversation + role assignment | MIGRATE + REPLACE |
| Push notifications | `requestNotificationPermission`, `sw.js` | `push_subscriptions`, notification Edge Functions | Public runtime coupling; prompt behavior | PushSubscription + backend notification jobs | MIGRATE + REPLACE |
| Broadcasts | `sendBroadcast`, history/messages | `broadcasts`, `send-broadcast` | Fan-out inside request; mixed buyer/admin UI | BroadcastCampaign/Delivery + outbox; `/admin/broadcasts` | MIGRATE + REPLACE |
| KYC submission/review | `submitKyc`, admin KYC functions | `kyc_verifications`; `admin-kyc`, `auto-verify-kyc` | Public document URLs, excess provider coupling, admin rules | KycSubmission/Document, private media, audited decisions | MIGRATE + REPLACE |
| Disputes | `submitDispute`, admin disputes | `disputes`, `submit-dispute` | Loose status/actions and evidence handling | Dispute, message/evidence, transition/audit service | MIGRATE + REPLACE |
| Referrals/affiliate | `renderAffiliateSection`, `loadAffiliateData` | `referrals`, local/edge behavior | Connections/payout affordances not grounded in complete source schema | Referral code/visit/conversion; `/seller/referrals` | VERIFY LIVE + MIGRATE |
| Product sourcing | legacy provider-branded seller UI and extract/import functions | deployed extraction/dropship functions and source URLs | Public upstream disclosure; hard-coded supplier/cost/catalog; unsafe import | provider-neutral sourcing + internal procurement; `/sourcing`, `/seller/sourcing` | MIGRATE data; RETIRE public branding |
| Dropship supplier connections | `connectSupplier`, `manage-dropship`, local catalog | device state plus deployed function | Fictional/hard-coded suppliers and costs; secrets risk | verified supplier/RFQ workflow only | VERIFY LIVE; RETIRE hard-coded catalog |
| Supplier role/workspace | supplier references embedded in dropship UI | profiles/deployed-only functions | External supplier role not consistently modeled | SupplierProfile/RFQ/catalog layouts | REPLACE when backed by real accounts |
| Services marketplace | `showServiceDashboard`, gigs/bookings/reviews | `service_gigs`, `service_bookings` | Partially hidden/disabled UI, role mixed with profile | ServiceListing/Booking routes | MIGRATE if live; staged UI |
| Delivery and safe hubs | `loadHubsForState`, order delivery copy | `safe_hubs`, order tracking | Claims may exceed actual operation; no assignment model | FulfilmentHub/DeliveryAssignment; `/delivery` | VERIFY LIVE + REPLACE |
| Admin marketplace operations | `showAdminPortal`, admin load/action functions | many direct tables + deployed `admin-action` | Admin embedded in seller app; email/metadata role checks | isolated AdminLayout and permissioned `/api/v1/admin/*` | REPLACE |
| Account/profile/password/delete | auth/profile functions | Supabase Auth, profiles, Edge Functions | Commerce and identity side effects fragmented | Supabase Auth + internal identity/account service | MIGRATE + REPLACE |
| Presence | `startPresenceHeartbeat`, online admin UI | profile/status updates | Privacy/load and weak semantics | optional last-seen/presence service with policy | VERIFY LIVE |
| PWA/install/service worker | PWA banner and `sw.js` | browser APIs | Global DOM handlers and stale caches possible | React install UX and versioned worker | REPLACE |
| Legal pages | separate static HTML | static files | Duplicate headers/layout, content may need legal review | React legal routes preserving text | MIGRATE content |
| Runtime config | `config.js`, `window.SB_*`, local settings | browser globals | Public config and accidental secret exposure risk | typed environment boundaries | RETIRE globals except intentional public values |

## Source tables and buckets referenced by code

Repository references include `profiles`, `products`, `orders`, `order_tracking`, `reviews`, `messages`, `withdrawals`, `wallet_transactions`, `commission_receipts`, `kyc_verifications`, `disputes`, `advertisements`, `broadcasts`, `push_subscriptions`, `referrals`, `seller_staff_permissions`, `service_gigs`, `service_bookings`, `safe_hubs`, `upcoming_products`, `landing_media`, and a legacy `uploads` reference. This is not a complete live inventory. Deployed-only functions also reference schemas not present in the repository.

The live read-only inventory must record every table/view/function/policy/bucket, its columns, primary and foreign keys, row count, maximum update timestamp, object count/bytes/content types, and every code/database column that points at a media URL.

## Supabase functions

Function directories in the repository include `admin-kyc`, `auto-verify-kyc`, `delete-account`, `flutterwave-webhook`, `manage-product`, `notify-new-product`, `notify-product-digest`, `notify-seller-order`, `paystack-webhook`, `request-withdrawal`, `send-broadcast`, `test-push-notification`, `update-profile`, `verify-flutterwave-ad-payment`, and `verify-flutterwave-payment`.

The browser also calls function names with no matching checked-in directory, including `admin-action`, `create-order`, source extraction/import, coupon and dropship management, order workflows, seller analytics, dispute/review submission, and wallet revenue order. Treat deployed function inventory as a required migration input; do not infer production behavior solely from the caller.

## Legacy removal gate

Before removing `app.js`, `src/legacy/marketplaceHtml.js`, static route wrappers, or Supabase commerce functions:

1. Attach each retained feature to a tested frontend route, API endpoint, and target model.
2. Reconcile migrated record counts, ownership, money, status, and media references.
3. Confirm inbound old URLs redirect to one canonical route.
4. Confirm the new frontend contains no direct Supabase business-table access.
5. Confirm unsafe/retired behavior is disabled without deleting production records.
6. Keep the old deployment available for rollback until the approved retention period ends.
