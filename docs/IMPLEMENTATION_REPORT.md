# BUYSELL reconstruction implementation report

Report date: 2026-08-12 (Africa/Lagos)  
Scope: local implementation and migration preparation; no production deployment or live data mutation

## 1–5. Repository and architecture

| Item | Result |
| --- | --- |
| 1. Starting branch | `main` tracking `origin/main` |
| 2. Starting commit | `12c88d2c182e65fa19f130bb45ad33b0e59b99c0` (`Remove top announcement strips globally`) |
| 3. Ending state | Branch `rebuild/production-architecture`; working tree intentionally uncommitted at report time so the user can review. Existing user changes and supplied archives are preserved. |
| 4. Before | Vite/React shell injects a 217 KB legacy HTML string; a 9,863-line global `app.js` controls DOM, pseudo-routes, Supabase business queries, uploads, checkout, seller, and admin behavior. Multiple static HTML wrappers and global CSS duplicate routing/layout. |
| 5. After | Workspace-shaped React/Vite frontend, Express `/api/v1`, Prisma/PostgreSQL model and migration, Supabase Auth identity bridge, public/private media abstraction, backend-owned commerce services, guarded migration utilities, and architecture/operations documentation. |

The exact starting repository audit is in [INITIAL_REPOSITORY_AUDIT.md](INITIAL_REPOSITORY_AUDIT.md), and diagrams/data flow are in [ARCHITECTURE.md](ARCHITECTURE.md).

## 6. Legacy problems discovered

- `dangerouslySetInnerHTML` marketplace composition, inline `onclick`, global variables, and direct DOM mutations undermine React ownership and accessibility.
- Manual `window.location` and query/modal state imitate routing; static wrappers create duplicate URLs and deployment-specific redirect hacks.
- Browser code directly reads/writes products, orders, profiles, messages, finance, KYC, disputes, ads, broadcasts, and settings in Supabase.
- Missing-column retry/fallback queries conceal schema drift.
- Cart, checkout, totals, seller revenue, and some state transitions are browser-calculated.
- Seller/admin/service/sourcing experiences share one global application and permission presentation.
- Public `uploads` behavior sits beside receipts/KYC and other sensitive media.
- Hard-coded supplier/dropship catalogs, costs, provider names, and local device “connections” are not reliable production integrations.
- Several Edge Functions invoked by the browser are not checked into the repository, so deployed behavior cannot be reconstructed from source alone.

See [LEGACY_FEATURE_INVENTORY.md](LEGACY_FEATURE_INVENTORY.md) for the parity matrix.

## 7. Security issues discovered and treatment

| Starting issue | Reconstruction treatment |
| --- | --- |
| Frontend role/admin checks | PostgreSQL platform role assignments and active store membership permissions enforced in API middleware |
| Direct business table access | Commerce data moves behind API; frontend Supabase client is Auth-only |
| Browser totals/revenue | Expiring server quote, integer kobo, database ledger |
| Payment callback trust/duplicates | Independent Flutterwave verification, raw-body HMAC webhook, unique events/references, atomic effects |
| Race-prone stock/payout | Serializable transactions, inventory reservations/version, payout ledger hold and lock |
| Public sensitive uploads | Purpose-authorized uploads and private object storage with expiring access |
| ID guessing | Ownership/membership/store-scoped queries and platform permission checks |
| Raw source/procurement exposure | Separate procurement relation and explicit public/admin sourcing serializers |
| Secrets in browser/runtime globals | Typed backend environment; only intentional public Auth/API config uses `VITE_*` |
| Unstructured errors/logging | Stable public envelope, request IDs, structured redacted logs |

Full controls and the pre-release checklist are in [SECURITY.md](SECURITY.md).

## 8–9. Supabase dependencies and source references

Supabase remains the identity provider. The legacy system also depends on Supabase Database/Data API, Storage, Realtime, and Edge Functions. Repository table references include profiles, products, orders, order tracking, reviews, messages, withdrawals, wallet transactions, commission receipts, KYC, disputes, advertisements, broadcasts, push subscriptions, referrals, staff permissions, services/bookings, safe hubs, upcoming products, and landing media.

Checked-in functions include KYC administration/automation, account deletion, Flutterwave and Paystack webhooks/verification, product management, notifications, withdrawal, broadcast, profile update, and ad payment verification. The client also invokes deployed-only names for admin/order/review/dispute/coupon/dropship/sourcing/analytics/wallet workflows. An authorized live function/schema/RLS/bucket inventory is still required; repository calls are hints, not proof of the live schema.

## 10–12. Feature disposition

### Preserved/migrated

Marketplace discovery, categories/search/products/stores, existing identities, buyer cart/orders/wishlist/reviews/messages, seller store/products/inventory/orders/analytics/finance/payout/team/coupons/ads/referrals, notifications/push, KYC, disputes, broadcasts, sourcing history, supplier/RFQ concepts, services/bookings, delivery/hubs, and upcoming content are represented in the new domain map or an explicit migration decision.

### Redesigned

Checkout is a server quote and transactional order; payment effects are verified/idempotent; multi-seller checkout splits into `StoreOrder`; inventory uses reservations/movements; seller balance uses a ledger; dashboards have isolated layouts; conversations use membership; private files use signed access; sourcing is a BUYSELL-owned provider-neutral service with private procurement operations.

### Intentionally retired or disabled pending policy

The injected HTML/global app architecture, inline event system, modal-as-page routing, client-side business mutations, schema guessing, browser-authoritative totals, permanent public KYC/receipt URLs, hard-coded/fabricated supplier catalog/connections, public upstream-source branding, and unsafe wallet-funded checkout are not carried forward. Paystack and automatic KYC approval are not enabled without a current business/security decision. Source records are inventoried even when the unsafe behavior is retired.

## 13. Frontend routes

Canonical routes cover public marketplace/products/search/categories/product/store, BUYSELL Product Sourcing, marketing/trust/help/legal, auth, account, cart/checkout/orders/wishlist/messages, seller operations, supplier operations, and a permissioned admin workspace. The authoritative route list and guards are [ROUTES.md](ROUTES.md). Old static/product-ID/query/modal URLs and provider-specific sourcing paths are mapped in [ROUTE_MIGRATION_MAP.md](ROUTE_MIGRATION_MAP.md).

Implementation status at report finalization must be checked against the actual router and UI smoke report; a documented route is not considered implemented merely because its path appears in this file.

## 14. Backend APIs

Implemented API groups live below `/api/v1` and include health/readiness, identity/profile/addresses/preferences, catalog/home/categories/brands/products/stores, cart/wishlist, checkout/order/payment/webhook, conversation/review/referral/notification, seller store/product/inventory/order/analytics/finance/payout/team/ad/coupon/settings, supplier profile/catalog/connections/RFQ, sourcing public/admin, media, KYC/dispute, services/bookings/RFQ, and administrative users/stores/products/orders/payments/finance/payouts/trust/sourcing/ads/broadcast/audit/settings/export.

Exact current route/body/permission/error contracts are documented in [API.md](API.md). Provider credentials are optional for local boot but the corresponding operation returns an intentional unavailable error rather than fake success.

## 15. Database models

The Prisma schema contains normalized identity/roles, stores/memberships/settings, suppliers/connections/catalog, categories/brands/products/options/variants/inventory, media, addresses/cart/wishlist/quotes, parent/store orders and item snapshots, payments/attempts/webhook events, ledger/payouts, messaging/reviews/notifications, KYC/disputes, advertising, public sourcing/private procurement/history, RFQ, services/bookings, fulfilment/delivery, broadcasts, referrals, site settings, audit, and outbox models. Typed enums model the primary lifecycles. The initial SQL migration and development seed are under `database/prisma/`.

Detailed invariants, indexes, status semantics, and money convention are in [DATABASE.md](DATABASE.md).

## 16–21. Auth and migration strategies

### 16. Authentication

Supabase Auth access tokens are verified using project issuer/audience/algorithm and JWKS for asymmetric signing keys; the Auth user endpoint is the server fallback for legacy symmetric tokens. `AuthIdentity` maps provider subject to internal `User`. Authorization uses database roles/memberships, never editable user metadata. Development bypass is explicit and prohibited in production.

### 17. Users

Export authorized Supabase Auth subjects, create/upsert internal users, attach exact `SUPABASE` identity subjects, then map profiles. Quarantine missing subjects and duplicate/ambiguous identity rows; never attach by email alone or require migrated users to register again.

### 18. Stores and sellers

Separate person/profile from store. Resolve verified ownership, create owner membership and settings, map staff permissions only to known values, preserve seller status/KYC, and report ambiguous or orphan stores.

### 19. Products

Normalize seller/store, categories, status, prices in kobo, variants/options, stock, and ordered media. Create a deterministic default variant for truly unvarianted legacy records. Quarantine ambiguous money units and broken ownership/media instead of publishing them.

### 20. Orders

Parse legacy item snapshots, retain source/payment references, group by store, reconcile every subtotal/shipping/discount/fee/total, map status history chronologically, and preserve paid/cancelled/disputed state without calling providers or sending notifications during import.

### 21. Media

Inventory database references and every Storage bucket/object; classify by purpose; stream, hash, copy and verify public/private targets; write source-to-target mapping; change target references only after verification; keep source objects through rollback. See [MEDIA_MIGRATION.md](MEDIA_MIGRATION.md).

## 22–23. Payment and financial architecture

### Payment

The server initializes Flutterwave from stored order amount/currency/reference. Browser redirect, callback, and webhook are signals. Verification retrieves the provider transaction and checks successful status, exact internal reference, exact currency, and sufficient amount. Raw webhook HMAC uses timing-safe comparison. Unique payment/provider/event identifiers and one atomic paid transition make retries safe.

### Finance

Each store has a ledger account. Sale credits, commission/refund debits, payout holds/debits/reversals, and controlled adjustments are append-only entries in integer kobo with unique idempotency keys. Available balance includes eligibility time and holds. Payout creation locks the account, verifies balance/destination, and creates the hold before success; provider transfer state remains distinct from approval.

## 24–30. Platform summaries

| Area | Result |
| --- | --- |
| 24. Seller | Isolated store membership/permissions; dashboard, catalog/inventory, fulfilment, analytics, ledger/payout, team, advertising, coupons, settings, messages and sourcing contracts. |
| 25. Admin | Permissioned operations for users/stores/catalog/orders/payments/finance/payout/trust/sourcing/growth/settings/audit/export; sensitive mutations are auditable. |
| 26. Supplier/sourcing | Supplier profiles/catalog/RFQ remain distinct. Public Product Sourcing returns only customer data/quote/status. Internal procurement is role-gated to operations/sourcing/super admin. |
| 27. Messaging | Conversation membership replaces guessable pairwise reads; order and sourcing context supported; attachments use media access policy. |
| 28. Notifications | Persisted in-app preferences/subscriptions; outbox supports email/push/fan-out and retry without blocking transactions. |
| 29. KYC/disputes | Structured lifecycle, owner/participant/admin access, private documents/evidence, decision/history/audit. Automated KYC is not treated as final authority. |
| 30. Ads/referrals | Campaign approval/schedule/payment state and observed impression/click events; referrals track real code/visit/conversion relationships, never synthetic analytics. |

## 31–34. Product quality changes

### SEO

Canonical clean slugs/routes replace static wrapper duplicates. Public pages define titles/descriptions/Open Graph/Twitter data and appropriate Organization/Product/breadcrumb structured data from real records. Sitemap contains public products/stores/categories/information only and excludes auth, checkout, account, seller, supplier, admin, and legacy provider routes.

### Accessibility

The design standard specifies semantic landmarks/headings, skip link, keyboard/focus behavior, persistent form labels, labelled icon controls, live status, dialog focus restoration, contrast, reduced motion, zoom/text scaling, and meaningful loading/error/empty states. Visual and assistive-technology audit remains a release gate, not an inferred result from compilation.

### Responsive

Public cards use a usable two-column mobile product grid and adaptive 3–6-column desktop grid. Product/checkout collapse from two columns into a linear task; dashboard sidebar/tables and messages have mobile patterns; sticky actions respect safe areas.

### Performance

The target removes the giant global script/HTML string from the new app, paginates APIs, bounds query limits, centralizes caching/invalidation, lazy-loads workspaces, optimizes/resizes media, and uses indexed database access. Final production bundle sizes and representative query plans must be recorded after the frontend is complete.

## 35–36. Legacy files

No legacy source or supplied archive was destructively removed during reconstruction. This is intentional until parity, redirect, migration, and rollback gates pass. `app.js`, legacy markup, static wrappers, old Supabase functions, and styles remain as source evidence/rollback inputs but must not be imported by the new frontend production entry. After verified production retention, remove them in a separate reviewable cleanup commit.

The untracked `1688/` prototype and three supplied archives are user-owned inputs and remain unchanged. Provider-specific strings that remain there or in legacy source are classified as internal migration/evidence, not public rebuilt UI.

## 37–41. Verification record

The implementation includes backend tests for health/error envelope, anonymous rejection, checkout price/coupon/inventory rules, integer money and transition maps, platform/store permissions, Flutterwave signature/charge validation, and public/internal sourcing serializers. Migration transform tests cover deterministic mappings. Frontend component/navigation/guard tests and visual smoke checks are required by the final gate.

| Check | Final local result |
| --- | --- |
| 37. Tests added | Backend domain/API and migration transform suites; frontend suite to be recorded from final tree |
| 38. Test command/result | **Pending final workspace run** |
| 39. Frontend build | **Pending final workspace run** |
| 40. Backend build/start | **Pending final workspace run** |
| 41. Prisma validate/generate | **Pending final workspace run** |

Do not replace pending values with “passed” unless the command was run after the final edits and its exit code/output was observed.

## 42–46. Migration/deployment status and blockers

| Item | Status |
| --- | --- |
| 42. Migration tooling | Read-only Data API and catalog inventory, resumable checksummed export, deterministic transforms, confirmation-gated idempotent target load, target validation, Storage inventory/copy foundation. |
| 43. Live cutover | **Not executed.** No production data was mutated, deleted, or deployed. |
| 44. Environment | Root `.env.example` documents database, Auth, API, Flutterwave, media, email, push, procurement, and separate migration values. |
| 45. Missing credentials | Live Supabase read-only/catalog/Auth export access, Neon target, Flutterwave, public/private media, email, and VAPID values were not available for production verification. |
| 46. Remaining external blockers | Live schema/RLS/function/bucket inventory; business/finance mapping sign-off; production provider configuration; staging dry run; legal/policy review; backups; approved cutover and DNS/hosting ownership. |

The executable report template and explicit unresolved validation are in [MIGRATION_REPORT.md](MIGRATION_REPORT.md).

## 47–48. Local setup and commands

Use a supported Node/npm version, copy `.env.example` to local service environment files without committing secrets, set a local PostgreSQL database or isolated Neon branch, then:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Convenience commands are expected at root for `dev`, `dev:frontend`, `dev:backend`, `build`, `test`, `lint`, `db:generate`, `db:migrate`, and `db:seed`. Use `npm ci` in clean CI. Exact final script names must be verified against root `package.json` after workspace integration.

## 49–50. Staging and production deployment

### Staging

Create an isolated Neon branch and staging Supabase callback/media/provider namespaces. Configure pooled runtime and direct migration URLs. Install from lockfile, apply migrations, seed only explicit development fixtures where appropriate, deploy API and frontend, run automated and full buyer/seller/admin/security/media/payment-test-mode smoke flows, then run the full source migration dry run and reconciliation.

### Production

Promote the reviewed immutable artifacts, configure encrypted secrets and exact origins/callbacks, back up database and Storage, apply reviewed Prisma migrations through the direct connection, deploy API and verify readiness, configure signed webhook, deploy frontend with demo mode off, switch routing, run the cutover smoke matrix, and monitor. Details are in [DEPLOYMENT.md](DEPLOYMENT.md).

## 51. Migration dry-run procedure

1. Run source Data API and database-catalog inventory with dedicated read-only credentials.
2. Export checksummed/resumable NDJSON and Auth subjects; inventory Storage separately.
3. Transform locally and review quarantine/money/status/source mappings.
4. Apply schema to a fresh isolated Neon branch.
5. Run confirmation-gated target load with all external side effects suppressed.
6. Copy media to staging/quarantine and verify hashes/access/mappings.
7. Run target validation plus identity, ownership, product, order, finance, sourcing, KYC and media reconciliation.
8. Rerun to prove idempotency and exercise complete frontend/API flows.

Exact commands and guard phrases are in [SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md), [MEDIA_MIGRATION.md](MEDIA_MIGRATION.md), and [MIGRATION_REPORT.md](MIGRATION_REPORT.md).

## 52. Production cutover sequence

Approve backup/staging evidence; enter write freeze; record watermarks; take final backups; export/import database and media deltas; reconcile; deploy/verify API; switch webhook; deploy/switch frontend; verify redirects/Auth/catalog/controlled payment/orders/seller/admin/sourcing/private media; monitor; retain the old deployment/source through the rollback period. Full go/no-go and smoke checklists are in [PRODUCTION_CUTOVER.md](PRODUCTION_CUTOVER.md).

## 53. Rollback procedure

Stop new-system writes and capture its high-water marks, restore previous frontend/API/DNS and provider webhook routes, reconcile any transactions accepted by the new system before re-enabling legacy writes, verify the old critical flows, preserve both databases/media/logs as evidence, notify stakeholders, and require a new reviewed cutover. Never reset, truncate, mass-delete, delete Auth users, or discard new payments to make rollback appear clean.

## Final completion statement

The repository has a materially safer target architecture and an explicit, non-destructive migration path. Local code completion and verification results must be updated in sections 37–41 after the final shared-tree build. Production migration remains deliberately incomplete until credentials, backups, reconciliation, provider configuration, staging evidence, and an authorized cutover are available.
