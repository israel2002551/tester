-- Team Access: people a seller adds can work on the seller's store.
--
-- A seller adds a team member by email and picks a role:
--   product_manager  products, reviews and analytics
--   store_manager    orders, coupons and flash sales, store details, reviews
--                    and analytics
--   full_admin       all of that, plus a read-only view of earnings and payouts
-- Payouts, bank and payment details, team access, the selling plan, ads and
-- 1688 sourcing stay with the owner.
--
-- Email sign-ups are not confirmed in this project, so anyone could create an
-- account with an invited address. An invite is therefore honoured only for a
-- Google sign-in with that address, which Google has verified.
--
--   1. public.seller_staff_permissions is the team list. It was created by
--      hand; this records it. Emails are stored in lower case.
--   2. public.buysell_store_role(store) says what the signed-in user may do in
--      a store: 'owner', a team role, or null. The seller edge functions and
--      the policies below use it.
--   3. public.buysell_my_stores() lists the stores the signed-in user was
--      added to, for the site's store switcher.
--   4. Team members can read the store's orders (store and full admins) and
--      its earnings (full admins). Products and reviews are already public.
--   5. Invitees no longer read the team table directly: the old policy trusted
--      the unverified email and showed them the owner's private note.

create table if not exists public.seller_staff_permissions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  category text not null default 'store_manager',
  note text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_staff_permissions_seller_email_key unique (seller_id, email),
  constraint seller_staff_permissions_category_check check (category in ('store_manager', 'product_manager', 'full_admin')),
  constraint seller_staff_permissions_status_check check (status in ('active', 'revoked'))
);

alter table public.seller_staff_permissions enable row level security;

drop policy if exists "seller owners manage team access" on public.seller_staff_permissions;
create policy "seller owners manage team access" on public.seller_staff_permissions
  for all to authenticated
  using (auth.uid() = seller_id)
  with check (auth.uid() = seller_id);

drop policy if exists "staff can read their own seller access" on public.seller_staff_permissions;

create or replace function public.buysell_normalize_staff_permission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists buysell_normalize_staff_permission on public.seller_staff_permissions;
create trigger buysell_normalize_staff_permission
before insert or update on public.seller_staff_permissions
for each row execute function public.buysell_normalize_staff_permission();

update public.seller_staff_permissions set email = lower(btrim(email)) where email <> lower(btrim(email));

-- What the signed-in user may do in a store.
create or replace function public.buysell_store_role(p_store uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or p_store is null then null
    when p_store = auth.uid() then 'owner'
    else (
      select s.category
      from public.seller_staff_permissions s
      where s.seller_id = p_store
        and s.status = 'active'
        and exists (
          select 1
          from auth.identities i
          where i.user_id = auth.uid()
            and i.provider = 'google'
            and lower(i.identity_data ->> 'email') = lower(s.email)
            and coalesce(i.identity_data ->> 'email_verified', 'false') = 'true'
        )
      limit 1
    )
  end;
$$;

revoke all on function public.buysell_store_role(uuid) from public;
grant execute on function public.buysell_store_role(uuid) to anon, authenticated, service_role;

-- The stores the signed-in user was added to. google_verified is false while
-- they have not signed in with Google as the invited address.
create or replace function public.buysell_my_stores()
returns table (store_id uuid, store_name text, logo_url text, role text, invited_email text, google_verified boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.seller_id,
    coalesce(nullif(btrim(p.store_name), ''), nullif(btrim(p.name), ''), 'Store'),
    p.logo_url,
    s.category,
    s.email,
    public.buysell_store_role(s.seller_id) is not null
  from public.seller_staff_permissions s
  join public.profiles p on p.id = s.seller_id
  where s.status = 'active'
    and s.seller_id <> auth.uid()
    and lower(s.email) in (
      select lower(u.email) from auth.users u where u.id = auth.uid()
      union
      select lower(i.identity_data ->> 'email') from auth.identities i where i.user_id = auth.uid()
    )
  order by s.created_at desc;
$$;

revoke all on function public.buysell_my_stores() from public;
grant execute on function public.buysell_my_stores() to anon, authenticated;

-- Reading the store's orders and earnings.
drop policy if exists "Store team reads store orders" on public.orders;
create policy "Store team reads store orders" on public.orders
  for select to authenticated
  using (public.buysell_store_role(seller_id) in ('store_manager', 'full_admin'));

drop policy if exists "Store full admins read store withdrawals" on public.withdrawals;
create policy "Store full admins read store withdrawals" on public.withdrawals
  for select to authenticated
  using (public.buysell_store_role(seller_id) = 'full_admin');

drop policy if exists "Store full admins read store wallet" on public.wallet_transactions;
create policy "Store full admins read store wallet" on public.wallet_transactions
  for select to authenticated
  using (public.buysell_store_role(seller_id) = 'full_admin');
