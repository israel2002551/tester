-- 1688 sourcing requests.
--
-- "Send to BUYSELL" on the seller's 1688 page posted into public.orders with
-- columns that table does not have (name, contact, destination, request), so
-- every request failed and was only kept in the seller's own browser. Requests
-- now have their own table:
--   * sellers add requests and follow their own, and may cancel one that has
--     not been quoted yet;
--   * verified admins (public.buysell_is_verified_admin) see every request and
--     set its status, quote, note and tracking;
--   * the notification center tells admins about new requests and sellers
--     about each step (20261102000000_notification_center.sql).

create table if not exists public.sourcing_requests (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contact text not null default '',
  destination text not null default '',
  note text not null default '',
  -- [{title, url, quantity, variant, price, desired_price, image, supplier, moq, note}]
  items jsonb not null default '[]'::jsonb,
  link_count integer not null default 0,
  -- The seller's estimate when sending: link charge, shipping, repacking, total.
  estimate jsonb not null default '{}'::jsonb,
  status text not null default 'submitted' check (status in (
    'submitted', 'reviewing', 'quoted', 'paid', 'ordered', 'at_warehouse', 'in_transit', 'delivered', 'cancelled'
  )),
  quote_amount numeric check (quote_amount is null or quote_amount >= 0),
  admin_note text not null default '',
  tracking text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sourcing_requests_seller on public.sourcing_requests (seller_id, created_at desc);
create index if not exists sourcing_requests_status on public.sourcing_requests (status, created_at desc);

alter table public.sourcing_requests enable row level security;

drop policy if exists "Sellers add their own sourcing requests" on public.sourcing_requests;
create policy "Sellers add their own sourcing requests" on public.sourcing_requests
  for insert to authenticated
  with check (
    seller_id = (select auth.uid())
    and status = 'submitted'
    and quote_amount is null and admin_note = '' and tracking = ''
    and jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 60
    and length(contact) <= 120 and length(destination) <= 120 and length(note) <= 2000
  );

drop policy if exists "Sellers and admins read sourcing requests" on public.sourcing_requests;
create policy "Sellers and admins read sourcing requests" on public.sourcing_requests
  for select to authenticated
  using (seller_id = (select auth.uid()) or (select public.buysell_is_verified_admin()));

drop policy if exists "Sellers cancel open sourcing requests" on public.sourcing_requests;
create policy "Sellers cancel open sourcing requests" on public.sourcing_requests
  for update to authenticated
  using (seller_id = (select auth.uid()) and status in ('submitted', 'reviewing'))
  with check (seller_id = (select auth.uid()) and status = 'cancelled');

drop policy if exists "Admins update sourcing requests" on public.sourcing_requests;
create policy "Admins update sourcing requests" on public.sourcing_requests
  for update to authenticated
  using ((select public.buysell_is_verified_admin()))
  with check ((select public.buysell_is_verified_admin()));

revoke all on public.sourcing_requests from anon, authenticated;
grant select, insert on public.sourcing_requests to authenticated;
grant update (status, quote_amount, admin_note, tracking) on public.sourcing_requests to authenticated;

-- Keeps updated_at current; only BUYSELL may change the quote, note or tracking.
create or replace function public.buysell_sourcing_request_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.buysell_is_verified_admin()
    and (new.quote_amount is distinct from old.quote_amount
      or new.admin_note is distinct from old.admin_note
      or new.tracking is distinct from old.tracking) then
    raise exception 'Only BUYSELL can change the quote, note or tracking.';
  end if;
  return new;
end;
$$;

drop trigger if exists buysell_sourcing_request_guard on public.sourcing_requests;
create trigger buysell_sourcing_request_guard
before update on public.sourcing_requests
for each row execute function public.buysell_sourcing_request_guard();

-- Admins hear about new and cancelled requests; the seller hears about each step.
create or replace function public.buysell_notify_sourcing_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref text;
  seller_name text;
  quote text;
  title text;
  body text;
  details jsonb;
  admin record;
begin
  ref := upper(left(new.id::text, 6));
  details := jsonb_build_object('sourcing_request_id', new.id::text, 'status', new.status);

  if tg_op = 'INSERT' or (new.status = 'cancelled' and old.status <> 'cancelled' and auth.uid() = new.seller_id) then
    select coalesce(nullif(btrim(p.store_name), ''), nullif(btrim(p.name), ''), 'A seller')
      into seller_name from public.profiles p where p.id = new.seller_id;
    title := case when tg_op = 'INSERT' then 'New 1688 sourcing request' else '1688 request cancelled' end;
    body := case when tg_op = 'INSERT'
      then format('%s sent %s link%s to source for %s (request %s).', coalesce(seller_name, 'A seller'),
        new.link_count, case when new.link_count = 1 then '' else 's' end, coalesce(nullif(new.destination, ''), 'Nigeria'), ref)
      else format('%s cancelled request %s.', coalesce(seller_name, 'A seller'), ref) end;
    for admin in select p.id from public.profiles p where p.role = 'admin' and p.id <> new.seller_id loop
      perform public.buysell_notify(admin.id, 'order', title, body,
        details || '{"audience": "admin"}'::jsonb, 'sourcing-admin:' || new.id::text);
    end loop;
    return new;
  end if;

  if new.status is not distinct from old.status and new.quote_amount is not distinct from old.quote_amount then
    return new;
  end if;
  quote := case when new.quote_amount > 0 then '₦' || to_char(new.quote_amount, 'FM999,999,999,990') end;
  title := case new.status
    when 'reviewing' then 'BUYSELL is reviewing your 1688 request'
    when 'quoted' then 'Your 1688 quote is ready'
    when 'paid' then 'Payment received for your 1688 order'
    when 'ordered' then 'Ordered from the 1688 supplier'
    when 'at_warehouse' then 'Your 1688 order reached the China warehouse'
    when 'in_transit' then 'Your 1688 order is on the way'
    when 'delivered' then 'Your 1688 order was delivered'
    when 'cancelled' then 'Your 1688 request was cancelled'
    else 'Update on your 1688 request'
  end;
  body := case new.status
    when 'quoted' then format('Request %s: BUYSELL quoted %s. Open it to see the details.', ref, coalesce(quote, 'a price'))
    else format('Request %s.', ref)
  end;
  if new.admin_note <> '' then
    body := left(body || ' ' || new.admin_note, 220);
  end if;
  perform public.buysell_notify(new.seller_id, 'order', title, body,
    details || '{"audience": "seller"}'::jsonb, 'sourcing:' || new.id::text);
  return new;
exception when others then
  -- A notification that cannot be added must never stop the request itself.
  raise warning 'Could not add sourcing notification for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists buysell_notify_sourcing_change on public.sourcing_requests;
create trigger buysell_notify_sourcing_change
after insert or update of status, quote_amount on public.sourcing_requests
for each row execute function public.buysell_notify_sourcing_change();

-- Live updates for the seller's "My requests" list.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sourcing_requests'
    ) then
    alter publication supabase_realtime add table public.sourcing_requests;
  end if;
end;
$$;
