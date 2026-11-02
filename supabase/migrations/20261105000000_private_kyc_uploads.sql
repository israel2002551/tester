-- KYC photos (ID front and back, selfie) go to the private kyc-documents
-- bucket at <auth.uid()>/<file> instead of the public uploads bucket. A seller
-- may add files only to their own folder and read them back; verified admins
-- read them through 5-minute signed links in the admin panel, and
-- auto-verify-kyc reads them with the service role.

-- Phones also send HEIC, WebP and AVIF photos (the site sends JPEGs as image/jpeg).
update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif']
where id = 'kyc-documents';

drop policy if exists "Sellers upload own KYC documents" on storage.objects;
create policy "Sellers upload own KYC documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'kyc-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Owners and verified admins read KYC documents" on storage.objects;
create policy "Owners and verified admins read KYC documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'kyc-documents'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.buysell_is_verified_admin())
  )
);
