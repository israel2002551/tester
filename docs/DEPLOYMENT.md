# Deployment guide

## Supported topology

Deploy `frontend/` as a static Vite SPA behind a CDN and `backend/` as a Node service. Use separate development, preview/staging, and production environments. Each environment has its own Neon branch/database, Supabase Auth callback configuration, media namespaces/buckets, Flutterwave mode/keys, email identity, VAPID keys, and observability labels.

Production application traffic uses Neon's pooled connection string in `DATABASE_URL`. Prisma migrations use the direct connection in `DIRECT_DATABASE_URL`. Never run preview applications against the production database.

This separation follows Neon's [connection-pooling guidance](https://neon.com/docs/connect/connection-pooling): pooled hostnames contain `-pooler`, while migrations and `pg_dump` should use a direct connection. Neon branches provide isolated staging/preview databases; branch lifecycle and data sensitivity must still follow access and retention policy.

## Runtime requirements

- Node version satisfying both workspace engine ranges (prefer the version pinned by the repository/toolchain).
- npm with the committed lockfile; install with `npm ci` in CI.
- PostgreSQL/Neon connectivity with TLS.
- HTTPS public origins for frontend, API, Auth callbacks, payment redirects, and webhooks.
- A host that supports exact redirects before the SPA fallback and can run a persistent/serverless-compatible Node API as selected.

## Environment variables

Frontend values are public at build time:

```dotenv
VITE_API_BASE_URL=https://api.example.invalid/api/v1
VITE_SUPABASE_URL=https://project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=public-value
VITE_DEMO_MODE=false
```

Backend values are secrets unless clearly public:

```dotenv
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://...-pooler.../...
DIRECT_DATABASE_URL=postgresql://.../...
FRONTEND_ORIGINS=https://www.example.invalid
TRUST_PROXY=1
LOG_LEVEL=info

SUPABASE_URL=https://project.supabase.co
SUPABASE_PUBLISHABLE_KEY=public-value-used-server-side-for-auth-fallback
ALLOW_DEV_AUTH=false

FLUTTERWAVE_PUBLIC_KEY=
FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_WEBHOOK_HASH=
PAYMENT_REDIRECT_URL=https://www.example.invalid/checkout/success
PLATFORM_COMMISSION_BPS=300
CHECKOUT_QUOTE_TTL_MINUTES=20
INVENTORY_RESERVATION_MINUTES=30

PUBLIC_MEDIA_PROVIDER=cloudinary
PRIVATE_MEDIA_PROVIDER=s3
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
S3_ENDPOINT=
S3_REGION=auto
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_BUCKET=
S3_PRIVATE_BUCKET=
S3_PUBLIC_BASE_URL=
PAYOUT_ENCRYPTION_KEY=

RESEND_API_KEY=
EMAIL_FROM=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:support@buysell.ng
PROCUREMENT_SOURCE_PROVIDER=
```

Use the repository `.env.example` as the final variable authority. Do not prefix server secrets with `VITE_`. Store environment values in the deployment provider's encrypted configuration, not Git or build logs.

## Build and quality gate

From a clean checkout:

```bash
npm ci
npm run lint
npm test
npm run db:generate
npm run build
```

If using workspace-local commands during diagnosis:

```bash
npm --workspace @buysell/backend run prisma:validate
npm --workspace @buysell/backend test
npm --workspace @buysell/backend run build
npm --workspace @buysell/frontend test
npm --workspace @buysell/frontend run build
```

The deployment gate includes a clean production build, Prisma validation/generation, tests, dependency/secret scan, frontend bundle inspection, and a clean-database migration test. Do not deploy from a dirty local worktree or rebuild artifacts differently between approval and production; promote the same immutable artifact where the platform permits it.

## Database release

1. Create a Neon preview/staging branch from the intended baseline.
2. Set its pooled and direct URLs only in the staging deployment.
3. Run `prisma migrate status`, apply `prisma migrate deploy`, and run readiness/integration tests.
4. Review generated SQL for locks, table rewrites, destructive statements, enum changes, and backfill duration.
5. Back up production and follow [PRODUCTION_CUTOVER.md](PRODUCTION_CUTOVER.md).
6. Apply production migrations once via the direct connection before enabling code that requires them.

Prefer expand/migrate/contract changes for live evolution: add compatible columns/tables, deploy code that handles both shapes, backfill, switch reads, then remove old fields only in a later approved release.

## Backend deployment

- Start with `npm --workspace @buysell/backend start` (or the platform's equivalent) and ensure graceful SIGTERM time fits the platform.
- Expose `/api/v1/health` for liveness and `/api/v1/ready` for readiness.
- Configure the exact frontend origins and correct trusted-proxy count.
- Send structured stdout/stderr to log collection; redact secrets and personal documents.
- Set minimum/maximum instances and database pool behavior to prevent burst connection exhaustion.
- Run outbox/webhook recovery as a separately controlled worker/schedule when required; only one logical job should claim an event.
- Configure Flutterwave webhook to `/api/v1/payments/flutterwave/webhook` and retain the raw body for signature verification.

## Frontend deployment

- Build `frontend/dist` with production public variables; `VITE_DEMO_MODE` must be false.
- Configure long immutable caching for hashed assets and no-cache/revalidation for `index.html`, service worker, manifest, sitemap, and robots as appropriate.
- Apply security headers at the hosting edge. Start with a tested CSP compatible with built assets/API/Auth/media/payment hosts; do not keep legacy `'unsafe-inline'` merely for convenience.
- Configure permanent legacy redirects before the catch-all rewrite to `index.html`.
- Ensure `/api` is not rewritten to the SPA when API and frontend share a hostname.
- Register exact Supabase Auth site/callback URLs for production and preview hosts intentionally.

## Post-deploy smoke test

Verify health/readiness, anonymous catalog/product/store, login/callback, protected account, cart/quote, payment initialization in the correct mode, webhook signature/idempotency, order ownership, seller store scoping, admin denial/allow, public sourcing privacy, private media access, redirects, 404, metadata/sitemap, mobile layouts, console errors, and job backlog.

Monitor HTTP error/latency, database connections, auth verification, payment mismatches, webhook failures, payout/job failures, media errors, and frontend exceptions. Roll back the application artifact for code-only regressions. For schema/data incidents follow the explicit cutover rollback; never use an unreviewed destructive database reset.

## Local development

After root workspace scripts are installed, use:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Or run frontend/backend separately with `npm run dev:frontend` and `npm run dev:backend`. Local dev-auth bypass, if used, requires explicit `ALLOW_DEV_AUTH=true`, is prohibited in production, and must never be mistaken for authorization testing.
