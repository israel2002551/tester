# Production cutover runbook

No command in this runbook should be run against production until an owner has approved the window, backups, operators, credentials, communication, and rollback authority. Record UTC and Africa/Lagos times for every checkpoint.

## Roles and go/no-go

Assign one cutover lead, database operator, application deployer, payment verifier, and business validator. Only the cutover lead calls go/no-go. Open a shared incident channel and status log. Define the maximum acceptable write freeze and rollback decision deadline before starting.

Go requires:

- restorable source database backup and separately verified Storage copy;
- tested target database restore/rollback approach;
- exact source/target environment fingerprints, release commit, migration version, and artifact digests;
- clean Prisma migration on a production-like staging branch;
- completed full dry-run migration with reconciled auth, products, orders, finance, sourcing, and media;
- passing frontend/backend tests/build and manual buyer/seller/admin smoke tests;
- production provider credentials configured and webhook/callback/DNS routes prepared but not prematurely switched;
- monitoring dashboards/log access and an old-deployment rollback target;
- no unexplained critical quarantine, paid-order difference, ledger difference, or private-media exposure.

## T-7 days to T-1 day: preparation

1. Announce maintenance/freeze expectations and support coverage.
2. Create the final release candidate from the protected rebuild branch; stop unrelated schema changes.
3. Run source inventory/export and target import against a fresh staging clone using the exact runbook.
4. Reconcile counts, ownership, totals, ledger, statuses, identities, and media; obtain business/finance/security sign-off.
5. Run load/readiness checks, payment test-mode flow, webhook replay, cross-account authorization tests, and private-media expiry tests.
6. Lower DNS TTL only if DNS change is part of deployment; record original values.
7. Export current Supabase Auth/signing-key configuration and verify production callback URLs.
8. Confirm no frontend build contains production secrets, internal procurement fields, legacy direct database calls, or public upstream-source branding.
9. Test rollback by redeploying/repointing the previous application in staging.

## T-0: freeze and final sync

1. Record source high-water marks and activate a maintenance/read-only mode that blocks conflicting commerce writes while preserving login/support access as designed.
2. Confirm in logs/database that new product/order/payment/payout/message/sourcing writes have stopped. Do not rely on a banner alone.
3. Take the final pre-cutover database backup and Storage delta inventory.
4. Export changed rows since the agreed watermark plus any append-only tables that require overlap/reconciliation. Checksums and manifests must be saved.
5. Copy and verify media delta.
6. Apply reviewed Prisma migrations to the target through `DIRECT_DATABASE_URL`; record migration status.
7. Import final delta with side effects suppressed and deterministic upserts.
8. Run reconciliation. Any unexplained identity, paid-order, payment, ledger/payout, sourcing ownership, KYC access, or media failure is an automatic no-go.

## Switch

1. Deploy/activate the backend release and verify `/api/v1/health` and `/api/v1/ready` from inside and outside the platform.
2. Configure the Flutterwave production webhook to the new endpoint; send/verify a controlled signed event or provider test if supported. Do not disable the prior target until the rollback strategy is clear.
3. Deploy the frontend artifact with the production API URL and Supabase publishable Auth configuration.
4. Switch CDN/routing/DNS to the new frontend/API in the preplanned order.
5. Verify exact redirects, SPA fallback, static assets, CSP/security headers, canonical URLs, robots, and sitemap.
6. Keep the old application deployment and source database intact but prevent split-brain writes.

## Immediate verification

Run and timestamp each check:

- anonymous home, category, search, product, store, sourcing, legal, and 404;
- existing user login/session refresh/password recovery callback;
- buyer profile/address/cart/quote/order access and cross-user denial;
- controlled low-value live payment only with explicit finance approval, verifying reference/currency/amount, order paid state, inventory, ledger, notifications, and duplicate webhook behavior;
- seller dashboard/products/inventory/order transition/finance/payout eligibility and cross-store denial;
- messages and notification ownership;
- admin dashboard/users/catalog/orders/payments/payout/KYC/dispute/sourcing/audit permissions;
- sourcing public payload with ordinary account and internal procurement payload with authorized account;
- public media optimization and private KYC/evidence signed access/expiry;
- migrated sample records from old/young accounts, products with galleries, multi-store/paid/cancelled orders, messages, finance, KYC, disputes, referrals, and sourcing.

Monitor API error rate/latency, database connections/locks, auth/JWKS errors, payment mismatches/signature failures, job backlog, media failures, 404s, and frontend exceptions continuously during the observation window.

## Rollback triggers

Rollback immediately or at the predefined threshold for data corruption, identity misbinding, unauthorized data access, payment verification/duplicate ledger effects, material order/finance discrepancy, private media exposure, sustained unavailability, or inability to stop split-brain writes. Lesser UI issues may use a forward fix only when the cutover lead explicitly accepts the risk.

## Rollback procedure

1. Stop/disable new-system write traffic and record its final high-water marks; do not discard transactions.
2. Restore routing/CDN/DNS to the known previous frontend and API/Edge Function deployment.
3. Re-enable legacy writes only after verifying old dependencies and payment webhook routing.
4. If live transactions occurred on the new system, reconcile them manually or through an approved reverse/delta plan before accepting old writes; never silently lose or double-process them.
5. Restore previous Flutterwave webhook target/configuration and verify signatures/processing.
6. Confirm old system login, browse, order, seller, and admin critical flows.
7. Preserve target database, logs, webhook payload hashes, and media as incident evidence. Do not delete either environment.
8. Notify stakeholders, open an incident review, identify remediation, and require a new go/no-go.

## Post-cutover

- Keep enhanced monitoring and support coverage for the agreed period.
- Compare daily orders, payment settlements, ledger/payout totals, sign-ins, media errors, and provider events with source/business reports.
- Restore DNS TTL after stability.
- Keep source backups, legacy deployment, and Storage for the approved rollback/retention window.
- Disable legacy commerce functions/write credentials only after the window and evidence review; Supabase Auth remains active.
- Record final migration manifest, quarantines, actual downtime, smoke results, incidents, and approval in `IMPLEMENTATION_REPORT.md` or a dated cutover record.
