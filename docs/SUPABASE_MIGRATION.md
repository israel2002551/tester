# Supabase to BUYSELL data migration

## Objective and boundary

The first migration moves marketplace business data from the legacy Supabase Postgres/Data API to the normalized BUYSELL PostgreSQL schema while preserving Supabase Auth. Existing people keep their Supabase accounts. Their provider subject is recorded in `AuthIdentity(provider=SUPABASE, providerSubject=<auth user id>)` and linked to the internal `User`.

Supabase Storage is a separate migration stream documented in [MEDIA_MIGRATION.md](MEDIA_MIGRATION.md). Database success without object success is not a complete migration. No script in this repository is authorization to mutate or delete live production data.

## Safety rules

- Take a restorable database backup and separate Storage inventory/copy before cutover.
- Use a dedicated read-only source credential where possible. The migration helpers reject broad credentials unless `ALLOW_BROAD_SOURCE_CREDENTIAL=true` is deliberately set.
- Run the inventory and export in dry-run mode first; add `--execute` only after target/output review.
- Keep export files out of Git. They may contain personal and financial data; encrypt them at rest and restrict operator access.
- Never transform source in place. Export to immutable, checksummed NDJSON, then transform to a new directory.
- Import into a disposable/staging Neon branch first. Production import requires an approved cutover window.
- A best-effort export taken while writes continue is not a transactionally consistent cutover snapshot; perform a final delta/freeze pass.

## Source discovery

Repository references are only hints. The live inventory is authoritative and must include:

- schemas, tables, views, materialized views, columns, types, defaults, keys, indexes, triggers, functions, extensions, grants, and RLS policies;
- exact row counts or recorded count method and maximum `updated_at`/sequence watermark;
- Supabase Auth user count and subject IDs through an authorized admin export (never a client key);
- Edge Function deployment names/configuration and which client paths call them;
- Storage buckets, policies, object count/bytes/content type, and database URL columns;
- unknown status values, orphan foreign keys, duplicate emails/slugs/SKUs, malformed JSON, and money-unit ambiguity.

Current platform note (verified 2026-08-12): Supabase no longer permits anonymous-key access to the Data API OpenAPI schema, and new projects default to explicit table grants; the latter is scheduled to apply to existing projects on 2026-10-30. Inventory must therefore use an authorized read-only/admin catalog path where needed and must not assume that absence through the Data API means a table does not exist. Grants and RLS are separate controls. See the official [Data API exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [OpenAPI access change](https://supabase.com/changelog/42949-breaking-change-removing-access-to-openapi-spec-via-the-anon-key), and [API security guide](https://supabase.com/docs/guides/api/securing-your-api).

The checked-in read-only starting commands are:

```bash
node scripts/migration/source-inventory.mjs
node scripts/migration/inventory-source-schema.mjs
node scripts/migration/source-inventory.mjs --execute --out migration-data/inventory/source-inventory.json
node scripts/migration/inventory-source-schema.mjs --execute --out migration-data/inventory/source-schema.json
node scripts/migration/export-source.mjs
node scripts/migration/export-source.mjs --execute --out migration-data/source
```

Set `SOURCE_SUPABASE_URL` and `SOURCE_SUPABASE_READ_ONLY_KEY` only in the operator environment. The catalog command additionally uses `SOURCE_DATABASE_URL` for a dedicated read-only database role and starts an explicitly read-only transaction. `--tables profiles,products` limits the Data API scope; `--strict` treats optional missing tables as failure; `--page-size` is bounded at 1000. Export state is updated after each page, so rerunning resumes and verifies completed SHA-256 checksums.

`source-inventory.mjs` observes columns from a sample row and counts via Data API; it is not a substitute for a catalog-level schema/policy export. Empty tables require separate column discovery. Record CLI/tool versions in the migration report.

## Identity mapping

1. Export Supabase Auth user IDs and safe identity fields through an authorized server/admin channel.
2. Create one `User` per real person, preserving status and timestamps where trustworthy.
3. Insert a `SUPABASE` `AuthIdentity` with the exact auth UUID as `providerSubject`.
4. Map `profiles.id/user_id` to that internal user. Do not assign roles from editable user metadata.
5. Create `UserProfile`, stores, memberships, supplier profile, addresses, and role assignments from verified source facts.
6. Quarantine profile rows with no matching auth subject; do not silently attach them by email alone.
7. Report duplicate identities, conflicting emails, deleted auth subjects, and ambiguous role/store ownership.

On first post-migration login, the backend resolves the Supabase subject. It may safely update last login and provider email, but it must not create a second user when a migrated identity exists.

## Transformation map

| Source hint | Target | Key transformation/reconciliation |
| --- | --- | --- |
| `profiles` | `User`, `UserProfile`, `Store`, memberships, optional supplier profile | Separate person from store; normalize role only from trusted data; preserve source ID mapping |
| `products` | Product, variant, inventory, product media | Determine price units; default variant for unvarianted product; normalize category/status; preserve seller ownership |
| `orders` | Order, StoreOrder, OrderItem, Payment, status events | Parse item JSON, snapshot facts, split stores, retain references; quarantine unbalanced totals |
| `order_tracking` | OrderStatusEvent / DeliveryAssignment | Map legacy vocabulary chronologically; preserve free-text notes |
| `reviews` | Review | Resolve buyer + eligible order item; quarantine duplicates/unverifiable purchases |
| `messages` | Conversation, members, messages | Group participant/order/sourcing threads; require both users; retain chronology |
| `withdrawals` | PayoutRequest/Transaction | Preserve state and reference; do not recreate transfer side effects |
| `wallet_transactions` | LedgerEntry or legacy finance evidence | Determine sign/type; use deterministic idempotency key; balance reconciliation mandatory |
| `commission_receipts` | Audit/legacy finance record and private media | Do not treat receipt as verified payment automatically |
| `seller_staff_permissions` | StoreMembership + explicit permissions | Resolve store/user; map only known permissions |
| `kyc_verifications` | KycSubmission/Document | Preserve decision and reviewer evidence; media becomes private |
| `disputes` | Dispute, messages/evidence | Map order/parties/status; retain resolution history |
| `advertisements` / `ad_campaigns` | AdCampaign/Event | Preserve real paid/approval state; no synthetic metrics |
| `broadcasts` | BroadcastCampaign/Delivery | Preserve content and recorded outcomes; do not re-send during import |
| `push_subscriptions` | PushSubscription | Validate endpoint/keys; deduplicate; expired endpoints may be disabled, not guessed |
| `referrals` | ReferralCode/Visit/Conversion | Preserve inviter/invitee linkage and observed events |
| `service_gigs`, `service_bookings` | ServiceListing/Booking | Migrate only if live inventory confirms use; map status explicitly |
| `safe_hubs` | FulfilmentHub | Preserve only verified operating locations/status |
| `upcoming_products` | approved catalog/content representation | Preserve content/media and publication status |
| `landing_media` | MediaAsset/content configuration | Preserve valid assets; do not carry public sensitive URLs |
| sourcing/dropship records | SourcingRequest/Item/Quote + private SourcingProcurement | Customer content remains public model; legacy source URL/cost/supplier data moves only to internal procurement |

Each transformed record carries source system/table/ID and a source-record hash in the migration envelope or mapping report. Deterministic UUIDs make reruns idempotent. Unknown enum values go to a quarantine report with the raw value and source ID.

## Import ordering

1. Users and auth identities.
2. Profiles, media placeholders, categories/brands.
3. Stores, settings, memberships, suppliers.
4. Products, variants/options, inventory, public media relations.
5. Addresses, carts, wishlists.
6. Orders, store orders/items, tracking/status events, payment evidence and inventory facts.
7. Ledger and payouts after finance reconciliation rules are approved.
8. Conversations/messages/reviews/notifications.
9. KYC/disputes and private-media relations.
10. Sourcing public records, then internal procurement under restricted access.
11. Ads, referrals, services, delivery, broadcasts, settings, audit migration records.

Imports use database transactions per safe batch, upserts keyed by deterministic migration identity, and a durable checkpoint. Import does not call payment, email, push, broadcast, or payout providers. Side-effect jobs are suppressed during historical load.

The guarded local/target command sequence is:

```bash
node scripts/migration/transform-source.mjs
node scripts/migration/transform-source.mjs --execute --in migration-data/source --out migration-data/transformed

node scripts/migration/load-target.mjs
node scripts/migration/load-target.mjs --execute --confirm IMPORT_TO_TARGET --in migration-data/transformed

node scripts/migration/validate-target.mjs
node scripts/migration/validate-target.mjs --execute \
  --inventory migration-data/inventory/source-inventory.json \
  --out migration-data/reports/migration-report.json
```

The first invocation of each command prints its plan. `load-target` is the only database-writing step and requires both `--execute` and the exact confirmation phrase. Point `DATABASE_URL` only at the reviewed target; imports are upserts and do not delete target rows.

## Validation gates

Produce a machine-readable and human-readable report for each run:

- source/export/transformed/imported/quarantined counts per entity;
- duplicate and orphan counts with source IDs;
- auth identity coverage and profile/store ownership coverage;
- product/store/category/variant/media relationship coverage;
- order item sum, shipping, discounts, fees, total, payment reference, and store split reconciliation;
- ledger opening/closing balance per store against approved legacy evidence;
- message participant membership and chronology;
- KYC/dispute/sourcing ownership and private media coverage;
- source and output checksums, timestamps, schema migration version, code commit, operator, and environment.

No unexplained discrepancy is “close enough,” especially for paid orders, payments, seller balances, and payouts. Approved quarantines are counted and documented rather than discarded.

## Supabase coexistence and retirement

During staged migration, the old frontend and Edge Functions may remain available for rollback, but only one system should accept authoritative writes for a domain during the cutover window. Any source tables still exposed through Supabase Data API retain RLS and least-privilege grants. The new frontend contains no `.from()` business-data calls.

After cutover and retention:

1. Confirm all new traffic uses the BUYSELL API and Supabase only for Auth.
2. Disable legacy commerce Edge Functions and write paths in a reversible, recorded order.
3. Keep Supabase Auth, callback URLs, and signing-key verification operational.
4. Archive exports/backups according to privacy and retention policy.
5. Delete no source database or media until business owner approval after the rollback window.

Authentication verification follows Supabase's current [JWT signing-key guidance](https://supabase.com/docs/guides/auth/signing-keys): asymmetric projects publish verification keys through the project JWKS endpoint and support staged key rotation. Rotation and cache timing must be tested before production cutover.
