# BUYSELL.NG

React/Vite marketplace frontend for BUYSELL Nigeria, backed by Supabase tables,
storage, auth, and Edge Functions. The current migration preserves the existing
visual system and CSS while moving route ownership and the product/category/legal
pages into React components.

## Local Setup

1. Copy `config.example.js` to `config.js`.
2. Fill in your Supabase anon key, Supabase URL, and admin email.
3. Install dependencies with `npm install --cache .\.npm-cache`.
4. Run the React dev server with `npm run dev`.
5. Build production assets with `npm run build`.

`config.js` is intentionally ignored by Git because it contains local keys.

## Production Environment

Set these variables in Vercel before deploying:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_ADMIN_EMAIL`
- `VITE_ADMIN_EMAILS`

The build generates `dist/config.js` from those values so both the React pages
and the preserved legacy marketplace runtime can load the same backend config.

## Supabase Setup

Run the SQL files in order:

1. `supabase_migration_phase2.sql`
2. `supabase_migration.sql`
3. `supabase_migrations.sql`
4. `supabase_migration_phase3.sql`
5. `supabase_migration_phase4_orders_update.sql`
6. `supabase_migration_phase5_id_fix.sql`
7. `supabase_migration_phase6.sql`
8. `supabase_storage_policies.sql`

Deploy the Edge Functions used by `app.js` before production launch. At minimum,
the frontend currently calls functions such as `admin-action`, `manage-product`,
`init-checkout`, `verify-payment`, `create-order`, `submit-review`,
`update-profile`, `request-withdrawal`, `submit-dispute`, `send-broadcast`,
`init-ad-payment`, `verify-ad-payment`, `update-ad-stats`, and
`chat-bot-handler`.

### BUYSELL bank-transfer receipts

Marketplace buyers transfer their order total to the BUYSELL Moniepoint account,
upload a receipt, and wait for an admin to verify it in the Admin Orders screen.
Doorstep delivery adds ₦2,500; pickup is free. The frontend never marks a
bank-transfer order as paid on its own.

To send each uploaded receipt to the admin Telegram chat, configure and deploy
the `telegram-payment-proof` Edge Function:

```powershell
supabase secrets set TELEGRAM_BOT_TOKEN=your-bot-token --project-ref your-project-ref
supabase secrets set TELEGRAM_CHAT_ID=your-admin-chat-id --project-ref your-project-ref
supabase functions deploy telegram-payment-proof --project-ref your-project-ref
```

Add the bot to the target Telegram group (or start a direct chat with it) before
submitting a test receipt. The order and receipt remain in the admin queue even
if Telegram delivery is temporarily unavailable.

### Cloudinary product media

Product images and videos are uploaded directly from the browser to Cloudinary.
The `cloudinary-sign-upload` Edge Function creates the short-lived upload
signature; keep the Cloudinary API secret out of `config.js` and browser code.

Set these Supabase Edge Function secrets before deploying it:

```powershell
supabase secrets set CLOUDINARY_CLOUD_NAME=your-cloud-name --project-ref your-project-ref
supabase secrets set CLOUDINARY_API_KEY=your-api-key --project-ref your-project-ref
supabase secrets set CLOUDINARY_API_SECRET=your-api-secret --project-ref your-project-ref
supabase functions deploy cloudinary-sign-upload --project-ref your-project-ref
```

The existing product `image_url`, `images`, `video_url`, and `videos` fields now
contain Cloudinary HTTPS delivery URLs. Existing Supabase Storage media is not
migrated or removed automatically.

To copy existing product and upcoming-product media, use
`scripts/migrate-product-media-to-cloudinary.mjs`. It processes every image and
video URL (including the `images` and `videos` arrays), but only copies URLs
hosted in this Supabase project's Storage.
It does not remove the original files. Set the variables below in PowerShell,
run the dry run, review it, then use `--apply`:

```powershell
$env:SUPABASE_URL='https://your-project-ref.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='your-service-role-key'
$env:CLOUDINARY_CLOUD_NAME='your-cloud-name'
$env:CLOUDINARY_API_KEY='your-api-key'
$env:CLOUDINARY_API_SECRET='your-api-secret'
node scripts/migrate-product-media-to-cloudinary.mjs
node scripts/migrate-product-media-to-cloudinary.mjs --apply
```

Alternatively, copy the ignored `.env.cloudinary-migration` template in the
project root, fill in the same values, and run the two Node commands above.

## GitHub Launch Checklist

- Keep `config.js` out of Git.
- Rotate any API keys that were pasted into local scripts before publishing.
- Commit `config.example.js` instead of real credentials.
- Confirm every Edge Function above is deployed in Supabase.
- Confirm a test transfer receipt reaches both the Admin Orders queue and Telegram.
