# Deployment

## Vercel — two React projects from one repository

Create two Vercel projects connected to the same GitHub repository.

### Marketplace app
- Root directory: `frontend/apps/marketplace`
- Framework: Vite
- Build: `npm run build`
- Output: `dist`
- Env: `VITE_API_URL=https://<render-api-host>/api/v1`

### Brand/download landing app
- Root directory: `frontend/apps/landing`
- Framework: Vite
- Build: `npm run build`
- Output: `dist`
- Env:
  - `VITE_MARKETPLACE_URL=https://<marketplace-domain>`
  - `VITE_ANDROID_APK_URL=https://<download-domain-or-object-store>/buysell.apk`

The landing CTA downloads the Android package directly when that URL is configured. Play Store and App Store remain visibly marked `Coming soon`.

## Render — API + PostgreSQL

`render.yaml` provisions the Node API and PostgreSQL database. On the included free-service blueprint, the build command runs `npm run db:migrate` after dependency installation because Render pre-deploy commands are a paid-service capability; migrations are tracked and idempotent. Required values marked `sync: false` must be added in Render before production cutover:

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `FLUTTERWAVE_SECRET_KEY`
- `FLUTTERWAVE_WEBHOOK_SECRET`
- `AD_PRICE_KOBO` (defaults to `500000`, i.e. ₦5,000)
- `PUBLIC_MARKETPLACE_URL`
- `CORS_ORIGINS`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_PUBLIC_BASE_URL`

`STORAGE_DRIVER=s3` is intentional for production. Render service-local filesystem storage is not used as the durable marketplace media store.

## First deploy/cutover order

1. Push the repository to GitHub.
2. Create/apply the Render Blueprint from `render.yaml`.
3. Fill Render secrets and verify `/api/v1/health`.
4. Run PostgreSQL migrations.
5. Import the Supabase database export and migrate Supabase Storage media.
6. Create the Vercel marketplace project and point `VITE_API_URL` at Render.
7. Create the Vercel landing project and set its marketplace/APK URLs.
8. Smoke-test auth, product CRUD, checkout + Flutterwave return verification, order status, chat, KYC, withdrawals, admin review and uploads.
9. Attach production domains only after smoke tests pass.
