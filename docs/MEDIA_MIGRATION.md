# Media migration

## Target media classes

| Class | Examples | Target | Delivery |
| --- | --- | --- | --- |
| Public | product gallery/video, store logo/banner, brand logo, approved ad creative, public content | Cloudinary or public S3-compatible bucket | Optimized public URL/CDN |
| Private | KYC documents/selfie, dispute evidence, receipts, private message/sourcing attachments | private S3-compatible bucket | API-authorized short-lived signed URL |

`MediaAsset` records provider, provider object ID, MIME, bytes, dimensions/duration, access class, owner, metadata, and purpose relations. Private records do not store permanent public URLs.

## Inventory before copying

Create a manifest for every source bucket and every database field that may contain a URL, object path, JSON array, or embedded media reference. Capture:

- bucket ID/name/public flag/policy summary;
- object key, normalized path, size, MIME/metadata, creation/update time and ETag/checksum when available;
- source table/column/row references to each object;
- external hosts referenced outside Supabase Storage;
- orphan objects and broken/malformed URLs;
- duplicate content candidates by strong hash;
- objects whose names or metadata reveal sensitive/internal information.

Inventory is read-only and paginated. Do not assume the repository's `uploads` reference is the only live bucket. Database backup tools do not copy Storage objects.

Guarded command sequence:

```bash
node scripts/migration/inventory-media.mjs
node scripts/migration/inventory-media.mjs --execute \
  --inventory migration-data/inventory/source-inventory.json \
  --out migration-data/inventory/media-inventory.json

node scripts/migration/migrate-media.mjs
node scripts/migration/migrate-media.mjs --execute --confirm COPY_MEDIA_TO_TARGET \
  --inventory migration-data/inventory/media-inventory.json \
  --state migration-data/media/copy-state.json
```

The inventory performs no download or mutation. The copy command reads the source and writes only to the configured target S3-compatible bucket; it never removes source objects, enforces a maximum object size, and resumes through `copy-state.json`. Target variables are `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` (plus optional path-style configuration). Run with a private quarantine destination until access classification and final key mapping are approved.

## Classification rules

Classification is based on use, not the current bucket's public flag. KYC, evidence, receipts, private correspondence, and internal procurement are always private. Product/store/brand content is public only after ownership and content mapping succeeds. Ambiguous objects default to private quarantine.

Legacy source/provider screenshots or watermarked supplier media are not published as BUYSELL marketing. If operationally necessary, they remain private and linked only to the internal procurement record.

## Copy procedure

1. Freeze the inventory manifest version and checksum it.
2. Download through an authorized migration process to encrypted temporary storage, streaming rather than retaining unbounded data in memory.
3. Validate response status, actual bytes, declared/detected MIME, and configured maximums. Record zero-byte/corrupt objects.
4. Compute SHA-256 and dimensions/duration where safe.
5. Generate a destination key independent of the user-supplied filename, partitioned by environment/access/purpose.
6. Upload public objects with intentional CDN/cache/transform settings; upload private objects with public access disabled and encryption enabled.
7. Verify destination size and checksum/ETag semantics; for multipart/provider transforms, validate downloaded content rather than assuming ETag is SHA-256.
8. Insert/upsert `MediaAsset` and its domain relation using the source-to-target mapping.
9. Write append-only mapping output containing source object, destination provider ID, access, checksum, status, and referencing rows.
10. Reruns skip only entries whose destination verification and mapping checksum still match.

Migration does not rewrite the source row or delete a source object. Target database URL updates occur in the separate import transaction from the verified mapping.

## URL and reference transformation

- Parse known Supabase public/signed URL shapes into bucket + decoded object key; never rely on string replacement alone.
- Strip expired signature/query parameters from the lookup identity.
- Normalize JSON/string arrays without losing order; retain a report of malformed values.
- Preserve product gallery sort order and select a deterministic primary image.
- Replace HTML-embedded URLs only through a reviewed parser/sanitizer.
- An external URL remains external only after host, availability, licence/business policy, and security review; otherwise download/copy or quarantine.
- Do not return old private URLs from compatibility DTOs.

## Validation report

Per bucket and domain, record:

- source objects and bytes;
- referenced, orphaned, copied, deduplicated, quarantined, failed, and verified objects/bytes;
- references rewritten and unresolved;
- source and destination checksum/size mismatches;
- access-class changes (especially public to private);
- sampled visual/playback checks for images/video;
- authorization checks for each private purpose.

Release gate: every migrated public product with legacy media has either verified target media or an explicit quarantine/default-image decision; every private reference resolves only through an authorized target asset. A row-count-only report is insufficient.

## Runtime upload flow

New uploads use a backend authorization endpoint. It verifies user, purpose, MIME/size, and resource permission and returns a short-lived signed upload. After upload, the client calls completion/registration; the backend verifies provider metadata before creating `MediaAsset`. Access URLs for private assets require a fresh ownership/role check and expire quickly (configured by `MEDIA_SIGNED_URL_TTL_SECONDS`).

Suggested production safeguards include image decoding/transformation, antivirus/content scanning for documents where available, filename sanitization, object encryption, lifecycle rules for abandoned uploads, CDN immutable caching for versioned public assets, and audit events for sensitive downloads.

## Cutover and rollback

Perform an initial bulk copy, then a final delta inventory/copy after the write freeze. Switch database references/API generation only after the final mapping passes. Keep old objects unchanged through the rollback period. If cutover rolls back, restore old routing/database behavior; do not attempt an emergency reverse-copy or delete the new objects. Source deletion, if ever approved, is a separate post-retention project with a final access/legal review.
