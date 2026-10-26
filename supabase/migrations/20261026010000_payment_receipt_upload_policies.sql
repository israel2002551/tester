-- Buyers upload bank-transfer receipts to uploads/proofs/<auth.uid()>/<file>.
-- Without an insert policy on storage.objects the upload fails with
-- "new row violates row-level security policy". Each buyer may only write and
-- read files inside their own proofs folder.

drop policy if exists "Buyers upload own payment receipts" on storage.objects;
create policy "Buyers upload own payment receipts"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] = 'proofs'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists "Buyers read own payment receipts" on storage.objects;
create policy "Buyers read own payment receipts"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] = 'proofs'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);
