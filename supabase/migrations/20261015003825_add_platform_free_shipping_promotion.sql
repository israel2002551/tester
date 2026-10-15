-- Platform-funded free-shipping promotion. This extends the existing BOGO
-- singleton configuration so both promotions are priced atomically by the same
-- trusted Edge Function.

alter table public.bogo_promo_settings
  add column if not exists free_shipping_promo_enabled boolean not null default false,
  add column if not exists free_shipping_mode text not null default 'HYBRID'
    check (free_shipping_mode in ('FULL_THRESHOLD', 'PERCENTAGE_CAP', 'HYBRID')),
  add column if not exists free_shipping_profit_share_percent numeric(5,2) not null default 10
    check (free_shipping_profit_share_percent >= 0 and free_shipping_profit_share_percent <= 20),
  add column if not exists free_shipping_min_order_value numeric(14,2) not null default 100
    check (free_shipping_min_order_value >= 0),
  add column if not exists allow_promo_stacking boolean not null default false;

alter table public.orders
  add column if not exists shipping_discount_amount numeric(14,2) not null default 0
    check (shipping_discount_amount >= 0),
  add column if not exists is_free_shipping_applied boolean not null default false,
  add column if not exists platform_shipping_subsidy numeric(14,2) not null default 0
    check (platform_shipping_subsidy >= 0),
  add column if not exists free_shipping_pricing_snapshot jsonb not null default '{}'::jsonb;

create index if not exists orders_free_shipping_created_idx
  on public.orders (is_free_shipping_applied, created_at desc)
  where is_free_shipping_applied = true;

-- Courier funds are distinct from seller payouts. One row is recorded for each
-- delivery group so administrators can reconcile the full courier fee, buyer
-- shipping contribution, and the platform subsidy independently.
create table if not exists public.order_logistics_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  allocation_key text not null check (char_length(btrim(allocation_key)) between 1 and 120),
  courier_id uuid references public.profiles(id) on delete set null,
  courier_amount numeric(14,2) not null default 0 check (courier_amount >= 0),
  customer_shipping_amount numeric(14,2) not null default 0 check (customer_shipping_amount >= 0),
  platform_shipping_subsidy numeric(14,2) not null default 0 check (platform_shipping_subsidy >= 0),
  payout_status text not null default 'pending'
    check (payout_status in ('pending', 'funded', 'paid', 'void', 'refunded')),
  payout_reference text,
  funded_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, allocation_key)
);

create index if not exists order_logistics_allocations_payout_idx
  on public.order_logistics_allocations (payout_status, created_at desc);

create index if not exists order_logistics_allocations_order_idx
  on public.order_logistics_allocations (order_id, created_at);

drop trigger if exists order_logistics_allocations_updated_at on public.order_logistics_allocations;
create trigger order_logistics_allocations_updated_at
before update on public.order_logistics_allocations
for each row execute function public.set_bogo_commission_promo_updated_at();

-- Keep courier funding in sync with the same authoritative order-status
-- lifecycle used for seller allocations.
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
    update public.order_logistics_allocations
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
    update public.order_logistics_allocations
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
    update public.order_logistics_allocations
      set payout_status = 'refunded',
          updated_at = now()
      where order_id = new.id
        and payout_status in ('pending', 'funded');
  end if;
  return new;
end;
$$;

alter table public.order_logistics_allocations enable row level security;
revoke all on table public.order_logistics_allocations from public, anon, authenticated;
grant all on table public.order_logistics_allocations to service_role;
