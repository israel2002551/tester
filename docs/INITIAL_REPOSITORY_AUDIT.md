# Initial repository audit

Audit timestamp: 2026-08-12 (Africa/Lagos)

## Repository identity

| Item | Starting state |
| --- | --- |
| Repository | `israel2002551/tester` |
| Remote | `https://github.com/israel2002551/tester.git` |
| Starting branch | `main` tracking `origin/main` |
| Starting HEAD | `12c88d2c182e65fa19f130bb45ad33b0e59b99c0` (`Remove top announcement strips globally`) |
| Rebuild branch | `rebuild/production-architecture` |
| Package manager | npm; `package-lock.json` lockfile v3 |
| Runtime observed | Node `v24.12.0`, npm `11.11.1` |
| Legacy engine declaration | None |
| Legacy frontend | React 19, Vite 7, JavaScript/JSX |
| Legacy backend | Supabase database, Auth, Storage, Realtime, and Edge Functions called directly from browser code |
| Primary deployment files | `vercel.json`, `_headers`, `_redirects`, static route wrappers, and GitHub Pages historical URL |

## Protected working-tree state

The repository was not clean before reconstruction. These pre-existing changes are user-owned and must be preserved:

- Modified `package.json`: adds `web-push@^3.6.7` and reorders dependencies.
- Modified `package-lock.json`: resolves the `web-push` dependency tree.
- Modified `privacy.html`: adds only whitespace after the root element.
- Untracked `1688/`: a separate 1688 sourcing prototype with its own Supabase functions and migration.
- Untracked `BUYSELL_Brand_Package_v1.zip`: authoritative brand guidelines and assets.
- Untracked `Two-column product grid design.zip`: authoritative UI screen references and associated assets.
- Untracked `buysell-v1.2.zip`: a prior reconstruction candidate supplied for assessment.

No existing change was reset, checked out, deleted, or overwritten during the audit. The input archives remain unchanged.

## Recent starting commits

| Commit | Date (UTC+1) | Subject |
| --- | --- | --- |
| `12c88d2` | 2026-08-12 13:37 | Remove top announcement strips globally |
| `6995ec6` | 2026-08-12 12:23 | Remove marketplace nav announcement strip |
| `ab06626` | 2026-08-12 12:09 | Upgrade marketing landing design |
| `bb32c0d` | 2026-08-12 11:59 | Restore marketing landing as homepage |
| `ce3aa54` | 2026-08-11 02:31 | Align category pages with active products |
| `db960d3` | 2026-08-11 02:11 | Materialize clean route files |
| `4fef5db` | 2026-08-11 01:51 | Add dedicated cart checkout and chat pages |

## Starting architecture

The application is a partial React migration around a legacy single-page marketplace:

```text
Vite multi-page HTML entries
  -> src/App.jsx and route-switching React pages
  -> src/legacy/marketplaceHtml.js injected with dangerouslySetInnerHTML
  -> root app.js (9,863 lines / 491 KB)
  -> global DOM handlers, browser state, and direct Supabase operations
  -> Supabase database, Auth, Storage, Realtime, and Edge Functions
```

Key measurements at the start:

- `app.js`: 9,863 lines, 491,126 bytes.
- `styles.css`: 183,230 bytes.
- `src/legacy/marketplaceHtml.js`: 217,224 bytes stored as a single generated line.
- `src/legacy/marketingHtml.js`: 26,883 bytes stored as a single generated line.
- 15 Vite HTML build entries, plus materialized route-directory copies created by `scripts/copy-static.cjs`.
- No dedicated application backend.
- No Prisma schema or normalized target database.
- No automated test script in the starting package.

## Build and deployment baseline

The unmodified starting application built successfully with `npm run build` on Node 24.12.0. Vite 7.3.6 transformed 59 modules. Its shared production assets were approximately:

- JavaScript: 438.52 KB (113.01 KB gzip).
- CSS: 161.73 KB (30.27 KB gzip).

The build copied global runtime files and generated many duplicate HTML route entries. Vercel rewrites map clean paths back to those static HTML files. `_redirects` contains a second, partially inverse set for static hosting. The content-security policy still permits inline scripts and several public CDNs because the legacy runtime depends on them.

## Starting security and data-boundary observations

- Business tables are queried and mutated from browser code, including products, orders, profiles, withdrawals, KYC, disputes, messages, advertisements, broadcasts, and administrative state.
- Browser code uploads directly to the public `uploads` bucket and stores resulting public URLs, including flows adjacent to receipts and KYC.
- Administrative affordances mix configured email addresses, browser role values, profile fields, and database calls; frontend checks are not a reliable authorization boundary.
- Cart and checkout behavior uses browser-managed state and legacy totals. Payment verification exists in Edge Functions, but the overall order/ledger transaction is not represented as one server-owned domain service.
- Schema fallback queries retry alternate column sets, masking source-schema drift.
- Seller balances are recomputed from orders, withdrawals, and wallet transactions rather than being governed by an explicit immutable ledger.
- The deployed CSP requires `'unsafe-inline'`; config is exposed as runtime browser globals by design.
- Existing user continuity depends on Supabase Auth UUIDs and must be retained through explicit auth-identity mapping.

## Audit scope and source-of-truth caveat

This audit covers repository code and supplied archives. No destructive or write-capable production operation was performed. The actual live Supabase schema, RLS policies, object inventory, and row counts cannot be asserted from frontend fallback code alone. Migration tools therefore treat a future read-only live inventory/export as the source of truth and require backup plus dry-run validation before cutover.

The detailed feature, table, function, route, local-storage, and replacement mapping is in `LEGACY_FEATURE_INVENTORY.md`.
