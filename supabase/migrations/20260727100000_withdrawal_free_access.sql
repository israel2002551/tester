create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null check (amount > 0),
  status text not null default 'pending',
  bank_name text,
  account_number text,
  account_name text,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.withdrawals
add column if not exists seller_id uuid references auth.users(id) on delete cascade,
add column if not exists amount numeric,
add column if not exists status text default 'pending',
add column if not exists bank_name text,
add column if not exists account_number text,
add column if not exists account_name text,
add column if not exists reference text,
add column if not exists created_at timestamptz default now(),
add column if not exists updated_at timestamptz;

create index if not exists withdrawals_seller_created_idx
on public.withdrawals (seller_id, created_at desc);

alter table public.withdrawals enable row level security;

grant select, insert, update on public.withdrawals to authenticated;

drop policy if exists "Users can read own withdrawals" on public.withdrawals;
create policy "Users can read own withdrawals"
on public.withdrawals
for select
to authenticated
using (auth.uid() = seller_id);

drop policy if exists "Users can create own withdrawal requests" on public.withdrawals;
create policy "Users can create own withdrawal requests"
on public.withdrawals
for insert
to authenticated
with check (auth.uid() = seller_id);

drop policy if exists "Admins can read withdrawals" on public.withdrawals;
create policy "Admins can read withdrawals"
on public.withdrawals
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

drop policy if exists "Admins can update withdrawals" on public.withdrawals;
create policy "Admins can update withdrawals"
on public.withdrawals
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
