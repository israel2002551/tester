-- Private storage for bank-transfer receipts.
--
-- Receipts were uploaded to the public `uploads` bucket, so anyone holding the
-- link could open a buyer's receipt (name, bank, account number). New receipts
-- go to this private bucket at payment-proofs/<buyer id>/<file> and are opened
-- through short-lived signed URLs. Requires 20261026040000 (verified admin helper).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs', 'payment-proofs', false, 10485760,
  array['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif']
)
on conflict (id) do update set public = false;

drop policy if exists "Buyers upload own payment proofs" on storage.objects;
create policy "Buyers upload own payment proofs"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Readers: the buyer who uploaded it, BUYSELL admins, and the seller of an
-- order that references the receipt.
drop policy if exists "Order parties read payment proofs" on storage.objects;
create policy "Order parties read payment proofs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.buysell_is_verified_admin())
    or exists (
      select 1
      from public.orders o
      where o.seller_id = (select auth.uid())
        and o.proof_url like '%/storage/v1/object/payment-proofs/' || storage.objects.name
    )
  )
);
