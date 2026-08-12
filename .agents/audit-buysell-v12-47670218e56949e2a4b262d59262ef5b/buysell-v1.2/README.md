# BUYSELL Nigeria V1.2

Production-oriented migration of the legacy static BUYSELL marketplace into a separated React frontend and Node/PostgreSQL backend.

## Repository layout

- `frontend/apps/marketplace` — React + Vite marketplace application for buyers, sellers, suppliers, seller managers, riders, and admins.
- `frontend/apps/landing` — independent React + Vite brand/download landing site intended for its own Vercel project/domain.
- `frontend/packages/ui` — shared UI primitives.
- `backend` — Express API, auth, RBAC, payments, marketplace domain modules, storage abstraction, PostgreSQL migrations, Supabase import tooling, and media cutover tooling.
- `docs` — architecture, migration inventory, deployment, and operational notes.

## Local setup

1. Install Node 20 or 22 and PostgreSQL 15+.
2. Run `npm install` from the repository root.
3. Copy `backend/.env.example` to `backend/.env` and fill the values.
4. Create a PostgreSQL database and run `npm run db:migrate`.
5. Copy each frontend `.env.example` file to `.env` and set the API URL.
6. Run the apps in separate terminals:
   - `npm run dev:api`
   - `npm run dev:marketplace`
   - `npm run dev:landing`

## Supabase removal

No frontend code talks directly to PostgreSQL. Supabase Auth, RLS-dependent browser writes, Storage calls, and Edge Function behavior are replaced by backend REST endpoints and service modules. See `docs/SUPABASE_MIGRATION.md`, `docs/LEGACY_FEATURE_MAP.md`, and `docs/SECURITY_CUTOVER.md`.

## Deployment

- Marketplace and landing: Vercel as two projects with separate root directories.
- API and PostgreSQL: Render.
- Production uploads: configure an S3-compatible object store. Local disk is a development-only fallback.

See `docs/DEPLOYMENT.md` for exact commands and environment variables.


## Production workflow coverage

The migration is not only a UI shell. V1.2 includes routed buyer checkout/orders/tracking/chat/reviews/account/disputes, seller product/order/payout/coupon/ad/dropship/team operations, admin review/action queues, supplier catalog ownership, delegated seller-manager scopes, and rider delivery state. `docs/MIGRATION_STATUS.md` distinguishes completed local work from external adapters that still require production credentials.
