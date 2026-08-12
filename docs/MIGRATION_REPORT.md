# Migration execution report

Status: **tooling/dry-run documentation only — no live production migration executed**  
Report date: 2026-08-12 (Africa/Lagos)  
Source: legacy Supabase project (exact project fingerprint withheld until an authorized run)  
Target: Neon/PostgreSQL (exact project/branch fingerprint withheld until an authorized run)

## Why this report is not a completed migration certificate

No live read-only Supabase credential, authorized Auth export, source database catalog dump, Storage object listing, or production Neon target was supplied to this local reconstruction. Consequently, live row/object counts, source schema/RLS/function inventory, checksums, quarantines, financial reconciliation, and cutover results cannot truthfully be reported. The repository contains guarded inventory/export foundations and the procedures below; an authorized operator must run them and append immutable artifacts before approving cutover.

This limitation does not block local schema, API, frontend, transform, and dry-run work. It does block any claim that production users/data/media have already migrated.

## Run identity (complete for every execution)

| Field | Value |
| --- | --- |
| Report/run ID | `UNRUN` |
| Environment | `dry-run / staging / production` |
| Repository commit | record full SHA |
| Prisma migration version | record exact migration directory/checksum |
| Source project fingerprint | record non-secret project reference/host |
| Target project/branch | record non-secret Neon project/branch IDs |
| Operator/reviewer | record approved names/IDs |
| Started/completed UTC | record ISO timestamps |
| Write freeze window | record start/end or `not applicable` |
| Source export manifest SHA-256 | record digest |
| Transform manifest SHA-256 | record digest |
| Media manifest SHA-256 | record digest |
| Result | `NOT RUN` |

Never add credentials, JWTs, full identity documents, bank account values, or customer message bodies to this report.

## Guarded source commands

Dry-run plan (no network request):

```bash
node scripts/migration/source-inventory.mjs
node scripts/migration/export-source.mjs
```

Authorized read-only run:

```bash
SOURCE_SUPABASE_URL=https://project.supabase.co \
SOURCE_SUPABASE_READ_ONLY_KEY=... \
node scripts/migration/source-inventory.mjs --execute \
  --out migration-data/inventory/source-inventory.json --strict

SOURCE_SUPABASE_URL=https://project.supabase.co \
SOURCE_SUPABASE_READ_ONLY_KEY=... \
node scripts/migration/export-source.mjs --execute \
  --out migration-data/source --page-size 500 --strict

SOURCE_DATABASE_URL=postgresql://read-only-source/... \
node scripts/migration/inventory-source-schema.mjs --execute \
  --out migration-data/inventory/source-schema.json
```

On PowerShell, set the same variables in the current process rather than committing an environment file. The export writes permission-restricted JSON/NDJSON, resumable state, counts, and SHA-256 values. Store `migration-data/` only in encrypted, access-controlled operator storage and confirm it is ignored by Git.

The Data API sample inventory is not a full schema catalog. Add an authorized read-only database/catalog export and an authorized Supabase Auth subject export. The Storage object inventory/copy is a separate run described in [MEDIA_MIGRATION.md](MEDIA_MIGRATION.md).

Transform and target commands first print a plan; actual target load requires an explicit phrase:

```bash
node scripts/migration/transform-source.mjs --execute \
  --in migration-data/source --out migration-data/transformed

DATABASE_URL=postgresql://verified-target/... \
node scripts/migration/load-target.mjs --execute --confirm IMPORT_TO_TARGET \
  --in migration-data/transformed

DATABASE_URL=postgresql://verified-target/... \
node scripts/migration/validate-target.mjs --execute \
  --inventory migration-data/inventory/source-inventory.json \
  --out migration-data/reports/migration-report.json
```

## Source inventory results

Replace `NOT RUN` only from signed/checksummed artifacts.

| Entity/table | Available | Source count | Export count | Max watermark | Notes |
| --- | ---: | ---: | ---: | --- | --- |
| Auth users | NOT RUN | — | — | — | Requires authorized Auth export |
| Profiles/users | NOT RUN | — | — | — | |
| Stores/memberships | NOT RUN | — | — | — | Derived from profile/staff sources |
| Products/variants/inventory | NOT RUN | — | — | — | |
| Orders/items/tracking | NOT RUN | — | — | — | |
| Payments/financial evidence | NOT RUN | — | — | — | |
| Withdrawals/ledger evidence | NOT RUN | — | — | — | |
| Messages/reviews/notifications | NOT RUN | — | — | — | |
| KYC/disputes | NOT RUN | — | — | — | Sensitive/private |
| Sourcing/procurement | NOT RUN | — | — | — | Provider details internal only |
| Advertising/referrals | NOT RUN | — | — | — | |
| Services/delivery/broadcast | NOT RUN | — | — | — | Confirm live usage |
| Storage buckets/objects | NOT RUN | — | — | — | Separate manifest required |

## Transformation/import results

For every target entity report:

| Target entity | Source rows considered | Transformed | Imported/upserted | Quarantined | Skipped with approved reason | Reconciled |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Users/AuthIdentity | NOT RUN | — | — | — | — | — |
| Profiles/Stores/Memberships | NOT RUN | — | — | — | — | — |
| Catalog/Inventory/Media links | NOT RUN | — | — | — | — | — |
| Orders/Payments/Events | NOT RUN | — | — | — | — | — |
| Ledger/Payouts | NOT RUN | — | — | — | — | — |
| Conversations/Reviews | NOT RUN | — | — | — | — | — |
| KYC/Disputes | NOT RUN | — | — | — | — | — |
| Sourcing/Public + Procurement/Internal | NOT RUN | — | — | — | — | — |
| Remaining domains | NOT RUN | — | — | — | — | — |

Every quarantine entry needs source table/ID, deterministic target key if any, reason code, safe diagnostic, disposition owner, and decision. Never silently discard a record to make counts match.

## Mandatory reconciliation evidence

Attach or link to access-controlled artifacts for:

- one internal user per valid Supabase subject and zero subject collisions;
- profiles, store owners/members, products, and orders retaining correct ownership;
- source/export/import counts and checksums by table/entity;
- product prices/stock/categories/media coverage and orphan report;
- item sums, discounts, shipping, fees, totals, currency, payment references, and store splits for every order;
- seller ledger opening balance and payout state agreed by finance;
- chronological order/message/sourcing status history;
- KYC/dispute/private-media access checks;
- sourcing requests retaining customer data while source URL/supplier/cost data appears only in internal procurement;
- media source/destination bytes/checksums and unresolved references;
- duplicate/idempotent rerun showing no duplicate rows or external side effects.

Financial reconciliation must equal exactly under the approved minor-unit convention. Any ambiguity about legacy major units versus kobo is quarantined and resolved with source evidence.

## Approval gates

| Gate | Owner | Result | Evidence |
| --- | --- | --- | --- |
| Backup restore tested | Database owner | NOT RUN | |
| Source/Auth inventory accepted | Migration lead | NOT RUN | |
| Media copy/authorization accepted | Security/product | NOT RUN | |
| Identity/ownership reconciliation | Product/support | NOT RUN | |
| Orders/payments reconciliation | Commerce/finance | NOT RUN | |
| Ledger/payout reconciliation | Finance | NOT RUN | |
| Private sourcing boundary verified | Operations/security | NOT RUN | |
| Staging smoke/regression passed | QA | NOT RUN | |
| Rollback rehearsal passed | Cutover lead | NOT RUN | |
| Production cutover approved | Business owner | NOT RUN | |

## Delta and production outcome

Record freeze watermarks, final-delta counts/checksums, media delta, Prisma migration output, import duration, reconciliation result, actual downtime, traffic switch time, smoke results, provider webhook switch, incidents, and rollback decision. Until those fields are completed and approved, production migration status remains **NOT EXECUTED**.

Follow [SUPABASE_MIGRATION.md](SUPABASE_MIGRATION.md), [MEDIA_MIGRATION.md](MEDIA_MIGRATION.md), and [PRODUCTION_CUTOVER.md](PRODUCTION_CUTOVER.md). The source database, Auth users, and source media must remain intact through the approved rollback/retention window.
