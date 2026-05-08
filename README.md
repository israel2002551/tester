# BUYSELL.NG

Static marketplace frontend for BUYSELL Nigeria, backed by Supabase tables,
storage, auth, and Edge Functions.

## Local Setup

1. Copy `config.example.js` to `config.js`.
2. Fill in your Supabase anon key, Supabase URL, Paystack public key, and admin email.
3. Open `index.html` in a browser, or serve the folder with a static server.

`config.js` is intentionally ignored by Git because it contains local keys.

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

## GitHub Launch Checklist

- Keep `config.js` out of Git.
- Rotate any API keys that were pasted into local scripts before publishing.
- Commit `config.example.js` instead of real credentials.
- Confirm every Edge Function above is deployed in Supabase.
- Use live Paystack keys only after payment verification is handled server-side.
