-- Commission-funded Buy 1, Get 1 (BOGO) promotion.
--
-- Seller/source prices are intentionally stored outside public.products. The
-- marketplace may expose product prices to buyers, whereas this table is used
-- only by trusted Edge Functions to calculate the platform-funded allowance.

create table if not exists public.bogo_promo_settings (
  id boolean primary key default true check (id = true),
  bogo_promo_enabled boolean not null default false,
  bogo_profit_share_percent numeric(5,2) not null default 10
    check (bogo_profit_share_percent >= 0 and bogo_profit_share_percent <= 20),
  bogo_min_order_value numeric(14,2) not null default 0
    check (bogo_min_order_value >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A boolean singleton key guarantees there can be exactly one effective
-- platform-wide configuration row.
insert into public.bogo_promo_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.product_seller_pricing (
  product_id uuid primary key references public.products(id) on delete cascade,
  seller_price numeric(14,2) not null check (seller_price > 0),
  source text not null default 'legacy_product_price'
    check (char_length(btrim(source)) between 1 and 80),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_seller_pricing_seller_price_idx
  on public.product_seller_pricing (seller_price, product_id);

-- Persist an auditable BOGO quote on the order. Existing orders receive safe
-- defaults, so this can be applied while checkout remains live.
alter table public.orders
  add column if not exists is_bogo_order boolean not null default false,
  add column if not exists bogo_primary_item_id uuid
    references public.products(id) on delete set null,
  add column if not exists bogo_free_item_id uuid
    references public.products(id) on delete set null,
  add column if not exists platform_promo_discount_amount numeric(14,2) not null default 0
    check (platform_promo_discount_amount >= 0),
  add column if not exists bogo_extra_customer_charge numeric(14,2) not null default 0
    check (bogo_extra_customer_charge >= 0),
  add column if not exists bogo_pricing_snapshot jsonb not null default '{}'::jsonb;

create index if not exists orders_bogo_created_idx
  on public.orders (is_bogo_order, created_at desc)
  where is_bogo_order = true;

-- An order can pay more than one seller. Each allocation covers all units of a
-- product in that order, and allocation_key provides a stable idempotency key
-- for payment verification and webhook retries.
create table if not exists public.order_seller_allocations (
  id uuid primary key default gen_random_uuid(),
  -- public.orders.id is a text identifier in this project. Keep the ledger FK
  -- type identical so PostgreSQL can enforce it without a cast.
  order_id text not null references public.orders(id) on delete cascade,
  allocation_key text not null check (char_length(btrim(allocation_key)) between 1 and 120),
  seller_id uuid references public.profiles(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  allocation_type text not null default 'paid_item'
    check (allocation_type in ('paid_item', 'bogo_primary', 'bogo_gift')),
  seller_amount numeric(14,2) not null default 0 check (seller_amount >= 0),
  customer_amount numeric(14,2) not null default 0 check (customer_amount >= 0),
  platform_revenue_amount numeric(14,2) not null default 0 check (platform_revenue_amount >= 0),
  platform_promo_discount_amount numeric(14,2) not null default 0
    check (platform_promo_discount_amount >= 0),
  payout_status text not null default 'pending'
    check (payout_status in ('pending', 'funded', 'paid', 'void', 'refunded')),
  payout_reference text,
  funded_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, allocation_key),
  unique (order_id, product_id)
);

create index if not exists order_seller_allocations_seller_payout_idx
  on public.order_seller_allocations (seller_id, payout_status, created_at desc);

create index if not exists order_seller_allocations_order_idx
  on public.order_seller_allocations (order_id, created_at);

-- Seed pricing for existing ordinary products. Product price was the only
-- historic source for those listings; imported WhatsApp records are corrected
-- below when their private source_price is available.
insert into public.product_seller_pricing (product_id, seller_price, source)
select p.id, p.price, 'legacy_product_price'
from public.products as p
where p.price is not null
  and p.price > 0
on conflict (product_id) do nothing;

-- whatsapp_listing_meta was introduced before this migration, but guard both
-- the table and source_price column so a partially upgraded environment can
-- still apply this migration safely.
do $$
begin
  if to_regclass('public.whatsapp_listing_meta') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'whatsapp_listing_meta'
         and column_name = 'source_price'
     ) then
    execute $seed$
      insert into public.product_seller_pricing (product_id, seller_price, source)
      select meta.product_id, meta.source_price, 'whatsapp_source_price'
      from public.whatsapp_listing_meta as meta
      where meta.source_price is not null
        and meta.source_price > 0
      on conflict (product_id) do update
        set seller_price = excluded.seller_price,
            source = excluded.source,
            updated_at = now()
    $seed$;
  end if;
end;
$$;

-- Keep modification timestamps local to this promotion feature; no dependency
-- on a project-wide updated_at helper is required.
create or replace function public.set_bogo_commission_promo_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bogo_promo_settings_updated_at on public.bogo_promo_settings;
create trigger bogo_promo_settings_updated_at
before update on public.bogo_promo_settings
for each row execute function public.set_bogo_commission_promo_updated_at();

drop trigger if exists product_seller_pricing_updated_at on public.product_seller_pricing;
create trigger product_seller_pricing_updated_at
before update on public.product_seller_pricing
for each row execute function public.set_bogo_commission_promo_updated_at();

drop trigger if exists order_seller_allocations_updated_at on public.order_seller_allocations;
create trigger order_seller_allocations_updated_at
before update on public.order_seller_allocations
for each row execute function public.set_bogo_commission_promo_updated_at();

-- Funding is derived from the authoritative order lifecycle, not from a
-- browser callback. This covers both the bank-transfer admin confirmation
-- path and Flutterwave/webhook confirmation, and remains idempotent on
-- retried updates.
create or replace function public.sync_bogo_allocation_payout_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('confirmed', 'shipped', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered') then
    update public.order_seller_allocations
      set payout_status = 'funded',
          funded_at = coalesce(funded_at, now()),
          updated_at = now()
      where order_id = new.id
        and payout_status = 'pending';
  elsif new.status = 'cancelled' then
    update public.order_seller_allocations
      set payout_status = 'void',
          updated_at = now()
      where order_id = new.id
        and payout_status in ('pending', 'funded');
  elsif new.status = 'refunded' then
    update public.order_seller_allocations
      set payout_status = 'refunded',
          updated_at = now()
      where order_id = new.id
        and payout_status in ('pending', 'funded');
  end if;
  return new;
end;
$$;

drop trigger if exists bogo_allocation_payout_status_on_order on public.orders;
create trigger bogo_allocation_payout_status_on_order
after update of status on public.orders
for each row execute function public.sync_bogo_allocation_payout_status();

-- These are server-only tables. Explicit grants are required for current
-- Supabase database permissions; service_role bypasses RLS but still needs its
-- table privileges to remain explicit and auditable.
alter table public.bogo_promo_settings enable row level security;
alter table public.product_seller_pricing enable row level security;
alter table public.order_seller_allocations enable row level security;

revoke all on table public.bogo_promo_settings from public, anon, authenticated;
revoke all on table public.product_seller_pricing from public, anon, authenticated;
revoke all on table public.order_seller_allocations from public, anon, authenticated;

grant all on table public.bogo_promo_settings to service_role;
grant all on table public.product_seller_pricing to service_role;
grant all on table public.order_seller_allocations to service_role;

revoke all on function public.set_bogo_commission_promo_updated_at() from public;
revoke all on function public.sync_bogo_allocation_payout_status() from public;
