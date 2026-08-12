# BUYSELL

BUYSELL is a production-oriented, multi-vendor Nigerian marketplace. The repository is an npm-workspace monorepo with a React storefront and role-based workspaces, an Express API, and a PostgreSQL domain model managed by Prisma.

## Repository layout

- `frontend/` — React 19, TypeScript, Vite, React Router, and TanStack Query
- `backend/` — Express API, Supabase identity verification, payments, media, notifications, and role-based authorization
- `database/prisma/` — schema, baseline migration, and safe baseline/demo seed
- `scripts/migration/` — read-only source inventory, resumable export/transform/load, media copy, and target validation
- `scripts/verification/` — public-boundary, secret, and bundle-budget checks
- `docs/` — architecture, API, security, migration, deployment, and cutover runbooks

Supabase remains the identity provider during migration. Marketplace data and all server-authoritative business operations live behind the API and PostgreSQL; the browser does not query marketplace tables directly.

## Prerequisites

- Node.js 22.12–24.x and npm
- PostgreSQL 15+ (or a compatible managed PostgreSQL service)
- A Supabase project for authentication

Payment, email, web-push, and media-provider credentials are optional for local UI work but required to exercise those integrations.

## Local setup

```powershell
npm install
Copy-Item .env.example backend/.env
Copy-Item .env.example frontend/.env.local
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:seed
npm run dev
```

The frontend runs at `http://localhost:5173`; the API runs at `http://localhost:4000`. Health endpoints are `GET /api/v1/health` and `GET /api/v1/ready`.

The default seed creates only baseline categories. To add clearly labelled local demonstration records, set `SEED_DEMO_DATA=true` outside production before running `npm run db:seed`.

## Verification

```powershell
npm run lint
npm test
npm run build
npm run verify:secrets
```

`npm run build` validates/generates Prisma, checks the backend, builds the frontend, scans the public source and bundle for protected procurement-provider terminology, and enforces the bundle budget.

## Environment

Start from [.env.example](.env.example). Important groups are:

- Runtime: `DATABASE_URL`, `DIRECT_DATABASE_URL`, `FRONTEND_ORIGINS`
- Identity: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and their `VITE_` browser equivalents
- Payments: `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH`, `PAYMENT_REDIRECT_URL`
- Media: Cloudinary or S3-compatible public media settings plus private S3 settings
- Payouts and notifications: `PAYOUT_ENCRYPTION_KEY`, Resend, and VAPID settings
- Migration-only credentials: `SOURCE_DATABASE_URL` and `SOURCE_SUPABASE_*`

Never expose backend secrets through `VITE_*` variables. Development auth bypass is opt-in and is rejected when `NODE_ENV=production`.

## Safe source-data migration

Migration commands default to read-only or dry-run behavior. Review [the Supabase migration guide](docs/SUPABASE_MIGRATION.md), [media migration guide](docs/MEDIA_MIGRATION.md), and [production cutover runbook](docs/PRODUCTION_CUTOVER.md) before using them.

```powershell
npm run migration:inventory
npm run migration:schema
npm run migration:export -- --help
npm run migration:transform -- --help
npm run migration:load -- --help
npm run migration:validate
```

Loading target data and copying media require explicit execution and confirmation flags. The tools never delete source records or source objects.

## Deployment

Build and deploy `frontend/dist` as the static application, and deploy `backend/` as a separate Node service with its own secrets and pooled PostgreSQL connection. Apply Prisma migrations using a direct database connection before promoting the API. See [deployment](docs/DEPLOYMENT.md) for the exact sequence, health checks, and rollback procedure.

## Documentation

Begin with [architecture](docs/ARCHITECTURE.md), [frontend](docs/FRONTEND.md), [API](docs/API.md), [database](docs/DATABASE.md), and [security](docs/SECURITY.md). The complete reconstruction record and any environment-dependent blockers are in [the implementation report](docs/IMPLEMENTATION_REPORT.md).
