alter table public.profiles
add column if not exists kyc_status text,
add column if not exists verification_status text,
add column if not exists seller_verified boolean default false,
add column if not exists store_name text,
add column if not exists store_category text,
add column if not exists store_description text,
add column if not exists bank_name text,
add column if not exists account_number text,
add column if not exists account_name text,
add column if not exists paystack_key text,
add column if not exists notif_email text,
add column if not exists instagram_handle text,
add column if not exists store_address text,
add column if not exists logo_url text;

create table if not exists public.kyc_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  doc_type text,
  document_type text,
  doc_number text,
  document_number text,
  full_name text,
  legal_name text,
  front_url text,
  back_url text,
  selfie_url text,
  status text not null default 'pending',
  admin_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.kyc_verifications
add column if not exists doc_type text,
add column if not exists document_type text,
add column if not exists doc_number text,
add column if not exists document_number text,
add column if not exists full_name text,
add column if not exists legal_name text,
add column if not exists front_url text,
add column if not exists back_url text,
add column if not exists selfie_url text,
add column if not exists status text default 'pending',
add column if not exists admin_note text,
add column if not exists reviewed_at timestamptz,
add column if not exists created_at timestamptz default now();

create index if not exists kyc_verifications_user_created_idx
on public.kyc_verifications (user_id, created_at desc);

alter table public.kyc_verifications enable row level security;

grant select, insert, update on public.kyc_verifications to authenticated;

drop policy if exists "Users can read their own kyc submissions" on public.kyc_verifications;
create policy "Users can read their own kyc submissions"
on public.kyc_verifications
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Admins can read kyc submissions" on public.kyc_verifications;
create policy "Admins can read kyc submissions"
on public.kyc_verifications
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists "Users can insert their own kyc submissions" on public.kyc_verifications;
create policy "Users can insert their own kyc submissions"
on public.kyc_verifications
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their pending kyc submissions" on public.kyc_verifications;
create policy "Users can update their pending kyc submissions"
on public.kyc_verifications
for update
to authenticated
using (auth.uid() = user_id and status in ('pending', 'submitted', 'in_review', 'review'))
with check (auth.uid() = user_id);

drop policy if exists "Admins can update kyc submissions" on public.kyc_verifications;
create policy "Admins can update kyc submissions"
on public.kyc_verifications
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);
