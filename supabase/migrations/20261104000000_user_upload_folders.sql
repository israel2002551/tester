-- Signed-in users upload pictures to their own folder in the public `uploads`
-- bucket: <folder>/<auth.uid()>/<file>. Without an insert policy on
-- storage.objects these uploads fail with "new row violates row-level security
-- policy": store logos (Store Settings and the admin branding logo), review
-- photos, commission receipts, service listings and ads. Payment receipts
-- (proofs/) and chat photos have their own policies.

drop policy if exists "Users upload to their own folders" on storage.objects;
create policy "Users upload to their own folders"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] in ('branding', 'reviews', 'receipts', 'gigs', 'ads')
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

-- Upcoming product photos and videos: upcoming/<images|videos>/<auth.uid()>/<file>,
-- for verified admins only, as on public.upcoming_products. The upload tries the
-- products bucket first, then uploads.
drop policy if exists "Admins upload upcoming product media" on storage.objects;
create policy "Admins upload upcoming product media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id in ('products', 'uploads')
  and (storage.foldername(name))[1] = 'upcoming'
  and (storage.foldername(name))[2] in ('images', 'videos')
  and (storage.foldername(name))[3] = (select auth.uid())::text
  and (select public.buysell_is_verified_admin())
);
