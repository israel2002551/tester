# Supabase data migration

The migration keeps Supabase read-only and preserves every public source row in
the private `legacy_supabase` schema before transforming records into the Prisma
domain model.

## Safety rules

- Never commit source exports, database URLs, service-role keys, password hashes,
  refresh tokens, or session tokens. `migration-data/` remains ignored.
- Supabase remains the credential authority during the transition. Import the
  Supabase user UUID as `AuthIdentity.providerSubject`; do not copy password or
  session internals into normal application tables.
- Do not delete or pause the Supabase project until relational counts, media
  objects, Auth, and a final write-free cutover snapshot have all reconciled.
- Payout rows stay archived until their bank destination has been encrypted and
  independently verified. Ambiguous legacy records stay archived with a
  `needs_review` manifest status instead of being guessed.

## Public relational flow

```bash
npm run migration:inventory -- --execute --strict
npm run migration:export -- --execute --strict
npm run migration:archive -- --execute --confirm ARCHIVE_SOURCE_TO_TARGET
npm run migration:transform -- --execute
npm run migration:load -- --execute --confirm IMPORT_TO_TARGET
npm run migration:validate -- --execute
```

The archive is idempotent for a batch and records expected/imported counts plus a
per-table checksum. Transform/load operations are additive upserts and do not
delete target records.

## Auth and Storage

Safe Auth account/identity metadata is archived separately. Password hashes,
sessions, and refresh tokens stay in Supabase because the backend verifies
Supabase access tokens.

Storage database metadata is archived separately from object bytes. Product and
KYC records may continue to reference Supabase objects during the transition.
Do not call the migration complete for Storage until every object has been copied
to a configured S3-compatible target and byte counts/checksums reconcile.

## Cutover

Run the full process first against an isolated Neon branch. For final production
cutover, temporarily stop source writes, create a new export batch, reconcile all
counts and checksums, deploy the backend, verify API reads, and only then switch
frontend traffic.
