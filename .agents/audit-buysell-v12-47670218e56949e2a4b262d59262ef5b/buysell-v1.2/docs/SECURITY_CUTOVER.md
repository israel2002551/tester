# Security cutover checklist

The legacy client repository contains live runtime configuration in browser-readable JavaScript. Even values that are intended to be public should not remain authoritative after the Supabase cutover.

Before production traffic moves to V1.2:

1. Create new strong `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values in Render only.
2. Configure the Flutterwave **secret** and webhook verification values only in Render. Never expose them through a `VITE_*` variable.
3. Restrict `CORS_ORIGINS` to the final marketplace and landing origins that actually need API access.
4. Configure the production S3-compatible bucket with a dedicated application credential and least-privilege object access.
5. Keep the Supabase export, including `auth_users.json`, outside Git. `backend/legacy-export/` is ignored by default.
6. Take a final source database backup, enter a short write-freeze window, import the final delta, copy Storage objects, then verify counts and sample records.
7. Test old-user login, password-reset-required accounts, KYC files, product media, payment receipts, order tracking, chats, seller balances and admin queues before DNS/domain cutover.
8. After the rollback window has passed, revoke obsolete Supabase credentials/project access and remove legacy deployment variables from Vercel/hosting.
9. Rotate any third-party credential that was ever committed when its provider treats that credential as secret. Public browser keys should still be retired when the old integration is no longer used.
10. Keep database backups and object-storage retention enabled independently of the application deploy.

V1.2 deliberately stores deploy-specific credentials in environment variables rather than source files.
