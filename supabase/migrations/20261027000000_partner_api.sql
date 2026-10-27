-- Partner commerce API: external sites read the BUYSELL catalog, take payment
-- on their own checkout, and report every order back here for accounting.
--
--   partners              partner accounts and their commission rate
--   partner_api_keys      hashed API keys (the plaintext key is shown once)
--   partner_orders        one row per partner order: payment + settlement state
--   partner_order_items   the BUYSELL products in each partner order
--   partner_ledger_balances  what each partner owes BUYSELL, for reconciliation
--
-- Everything is server-only: the partner API (services/product-ingestion-api)
-- uses the service role. Browser roles have no access to any of it.
--
-- Money: amounts are computed from BUYSELL's own product price at the time of
-- the order. The partner keeps commission_rate % of that; amount_due is what
-- the partner owes BUYSELL for paid, unsettled orders. A different reported
-- unit price is stored and flagged for review, never trusted for settlement.

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  partner_name text not null check (char_length(partner_name) between 2 and 120),
  commission_rate numeric(5,2) not null default 0 check (commission_rate >= 0 and commission_rate <= 100),
  status text not null default 'active' check (status in ('active', 'suspended', 'terminated')),
  -- Browser origins allowed to read the catalog feed, e.g. https://shop.example.com
  allowed_origins text[] not null default '{}',
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_api_keys (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  label text,
  key_prefix text not null unique,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null default array['feed', 'orders']
    check (cardinality(scopes) > 0 and scopes <@ array['feed', 'orders']),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists partner_api_keys_partner_idx on public.partner_api_keys (partner_id);

create table if not exists public.partner_orders (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  partner_order_id text not null check (partner_order_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  payment_status text not null check (payment_status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  payment_reference text check (char_length(payment_reference) <= 200),
  currency text not null default 'NGN' check (currency = 'NGN'),
  -- As reported by the partner (what their customer was charged for the items).
  total_amount numeric(14,2) not null check (total_amount >= 0),
  -- Computed by BUYSELL from its own prices.
  buysell_total numeric(14,2) not null default 0 check (buysell_total >= 0),
  commission_rate numeric(5,2) not null,
  commission_amount numeric(14,2) not null default 0 check (commission_amount >= 0),
  amount_due numeric(14,2) not null default 0 check (amount_due >= 0),
  settlement_status text not null default 'unsettled' check (settlement_status in ('unsettled', 'settled', 'void')),
  settled_at timestamptz,
  settlement_reference text,
  needs_review boolean not null default false,
  review_notes text[] not null default '{}',
  customer jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, partner_order_id)
);

create index if not exists partner_orders_ledger_idx
  on public.partner_orders (partner_id, settlement_status, payment_status, paid_at);
create index if not exists partner_orders_review_idx
  on public.partner_orders (created_at desc) where needs_review;

create table if not exists public.partner_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.partner_orders(id) on delete cascade,
  buysell_product_id uuid not null references public.products(id),
  seller_id uuid,
  quantity integer not null check (quantity between 1 and 1000),
  unit_price numeric(14,2) not null check (unit_price > 0),
  buysell_unit_price numeric(14,2) not null check (buysell_unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  stock_reserved boolean not null default false,
  unique (order_id, buysell_product_id)
);

create index if not exists partner_order_items_product_idx on public.partner_order_items (buysell_product_id);

alter table public.partners enable row level security;
alter table public.partner_api_keys enable row level security;
alter table public.partner_orders enable row level security;
alter table public.partner_order_items enable row level security;
revoke all on table public.partners, public.partner_api_keys, public.partner_orders, public.partner_order_items
  from public, anon, authenticated;

create or replace function public.set_partner_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists partners_updated_at on public.partners;
create trigger partners_updated_at before update on public.partners
for each row execute function public.set_partner_updated_at();

drop trigger if exists partner_orders_updated_at on public.partner_orders;
create trigger partner_orders_updated_at before update on public.partner_orders
for each row execute function public.set_partner_updated_at();

-- What each partner owes BUYSELL. Paid, unsettled orders make up the balance.
create or replace view public.partner_ledger_balances
with (security_invoker = true)
as
select
  p.id as partner_id,
  p.partner_name,
  p.commission_rate,
  count(o.id) filter (where o.payment_status = 'paid' and o.settlement_status = 'unsettled') as unsettled_orders,
  coalesce(sum(o.buysell_total) filter (where o.payment_status = 'paid' and o.settlement_status = 'unsettled'), 0) as unsettled_sales,
  coalesce(sum(o.commission_amount) filter (where o.payment_status = 'paid' and o.settlement_status = 'unsettled'), 0) as unsettled_commission,
  coalesce(sum(o.amount_due) filter (where o.payment_status = 'paid' and o.settlement_status = 'unsettled'), 0) as amount_due,
  coalesce(sum(o.amount_due) filter (where o.settlement_status = 'settled'), 0) as total_settled,
  count(o.id) filter (where o.needs_review) as orders_needing_review,
  max(o.paid_at) as last_paid_at
from public.partners p
left join public.partner_orders o on o.partner_id = p.id
group by p.id;

revoke all on public.partner_ledger_balances from public, anon, authenticated;

-- Issues a new API key and returns the plaintext once. Run from the SQL editor:
--   select * from public.issue_partner_api_key('<partner id>');
-- Store the key securely; BUYSELL keeps only its SHA-256 hash.
create or replace function public.issue_partner_api_key(
  p_partner_id uuid,
  p_scopes text[] default array['feed', 'orders'],
  p_label text default null
)
returns table (key_id uuid, api_key text, key_prefix text, scopes text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Two random UUIDs give 244 random bits from the server's secure generator.
  v_key text := 'bsk_live_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  if not exists (select 1 from public.partners where id = p_partner_id) then
    raise exception 'Partner % does not exist.', p_partner_id;
  end if;
  insert into public.partner_api_keys (partner_id, label, key_prefix, key_hash, scopes)
  values (p_partner_id, p_label, left(v_key, 17), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'), p_scopes)
  returning id into v_id;
  return query select v_id, v_key, left(v_key, 17), p_scopes;
end;
$$;

create or replace function public.revoke_partner_api_key(p_key_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.partner_api_keys set status = 'revoked', revoked_at = now()
  where id = p_key_id and status = 'active';
$$;

-- Internal: the order as returned to the partner API.
create or replace function public.partner_order_summary(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id,
    'partner_order_id', o.partner_order_id,
    'payment_status', o.payment_status,
    'payment_reference', o.payment_reference,
    'currency', o.currency,
    'total_amount', o.total_amount,
    'buysell_total', o.buysell_total,
    'commission_rate', o.commission_rate,
    'commission_amount', o.commission_amount,
    'amount_due', o.amount_due,
    'settlement_status', o.settlement_status,
    'settled_at', o.settled_at,
    'needs_review', o.needs_review,
    'review_notes', to_jsonb(o.review_notes),
    'paid_at', o.paid_at,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', i.buysell_product_id,
        'quantity', i.quantity,
        'unit_price', i.unit_price,
        'buysell_unit_price', i.buysell_unit_price,
        'line_total', i.line_total,
        'stock_reserved', i.stock_reserved
      ) order by i.buysell_product_id)
      from public.partner_order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.partner_orders o
  where o.id = p_order_id;
$$;

-- Records a partner order or moves it to a new payment status, atomically.
-- p_order: { partner_order_id, payment_status, payment_reference?, currency?,
--            total_amount, customer?, items: [{ product_id, quantity, unit_price }] }
-- Errors use stable codes the API maps to HTTP statuses:
--   partner_inactive, unknown_product, order_items_changed, invalid_status_transition
create or replace function public.record_partner_order(p_partner_id uuid, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner public.partners%rowtype;
  v_order public.partner_orders%rowtype;
  v_status text := p_order ->> 'payment_status';
  v_items jsonb := coalesce(p_order -> 'items', '[]'::jsonb);
  v_item jsonb;
  v_product record;
  v_notes text[] := '{}';
  v_buysell_total numeric(14,2) := 0;
  v_commission numeric(14,2);
  v_created boolean := false;
  v_previous text;
  v_existing_items jsonb;
  v_requested_items jsonb;
  v_reserved boolean;
begin
  select * into v_partner from public.partners where id = p_partner_id and status = 'active';
  if not found then
    raise exception 'partner_inactive' using errcode = 'P0001';
  end if;

  select * into v_order from public.partner_orders
  where partner_id = p_partner_id and partner_order_id = p_order ->> 'partner_order_id'
  for update;

  if found then
    -- The same order may only change payment status; its contents are fixed.
    select coalesce(jsonb_agg(jsonb_build_array(i.buysell_product_id::text, i.quantity, i.unit_price)
             order by i.buysell_product_id::text), '[]'::jsonb)
      into v_existing_items
    from public.partner_order_items i where i.order_id = v_order.id;
    select coalesce(jsonb_agg(jsonb_build_array(e ->> 'product_id', (e ->> 'quantity')::integer, (e ->> 'unit_price')::numeric(14,2))
             order by e ->> 'product_id'), '[]'::jsonb)
      into v_requested_items
    from jsonb_array_elements(v_items) e;
    if v_existing_items is distinct from v_requested_items then
      raise exception 'order_items_changed' using errcode = 'P0001';
    end if;

    if v_order.payment_status = v_status then
      return jsonb_build_object('created', false, 'changed', false, 'order', public.partner_order_summary(v_order.id));
    end if;

    v_previous := v_order.payment_status;
    if not (
      (v_previous = 'pending' and v_status in ('paid', 'failed', 'cancelled'))
      or (v_previous = 'paid' and v_status in ('refunded', 'cancelled'))
    ) then
      raise exception 'invalid_status_transition' using errcode = 'P0001',
        detail = format('%s -> %s', v_previous, v_status);
    end if;
  else
    v_created := true;
    v_previous := null;
    insert into public.partner_orders (
      partner_id, partner_order_id, payment_status, payment_reference, currency,
      total_amount, commission_rate, customer
    ) values (
      p_partner_id,
      p_order ->> 'partner_order_id',
      v_status,
      nullif(p_order ->> 'payment_reference', ''),
      coalesce(nullif(p_order ->> 'currency', ''), 'NGN'),
      (p_order ->> 'total_amount')::numeric(14,2),
      v_partner.commission_rate,
      coalesce(p_order -> 'customer', '{}'::jsonb)
    )
    returning * into v_order;

    for v_item in select * from jsonb_array_elements(v_items) loop
      select id, price, status, seller_id into v_product
      from public.products where id = (v_item ->> 'product_id')::uuid;
      if not found then
        raise exception 'unknown_product' using errcode = 'P0001', detail = v_item ->> 'product_id';
      end if;
      if v_product.status is distinct from 'active' then
        v_notes := v_notes || format('product_inactive:%s', v_product.id);
      end if;
      if abs(coalesce(v_product.price, 0) - (v_item ->> 'unit_price')::numeric) >= 0.01 then
        v_notes := v_notes || format('price_mismatch:%s:reported=%s:buysell=%s', v_product.id, v_item ->> 'unit_price', v_product.price);
      end if;
      insert into public.partner_order_items (
        order_id, buysell_product_id, seller_id, quantity, unit_price, buysell_unit_price, line_total
      ) values (
        v_order.id, v_product.id, v_product.seller_id,
        (v_item ->> 'quantity')::integer,
        (v_item ->> 'unit_price')::numeric(14,2),
        coalesce(v_product.price, 0),
        coalesce(v_product.price, 0) * (v_item ->> 'quantity')::integer
      );
      v_buysell_total := v_buysell_total + coalesce(v_product.price, 0) * (v_item ->> 'quantity')::integer;
    end loop;

    v_commission := round(v_buysell_total * v_partner.commission_rate / 100, 2);
    update public.partner_orders set
      buysell_total = v_buysell_total,
      commission_amount = v_commission,
      amount_due = v_buysell_total - v_commission,
      needs_review = cardinality(v_notes) > 0,
      review_notes = v_notes
    where id = v_order.id
    returning * into v_order;
    v_notes := '{}';
  end if;

  -- Becoming paid: take the stock. Payment already happened on the partner
  -- site, so a shortage is recorded for follow-up rather than rejected.
  if v_status = 'paid' then
    for v_item in
      select jsonb_build_object('id', i.id, 'product_id', i.buysell_product_id, 'quantity', i.quantity)
      from public.partner_order_items i where i.order_id = v_order.id
    loop
      update public.products
        set stock_quantity = stock_quantity - (v_item ->> 'quantity')::integer
      where id = (v_item ->> 'product_id')::uuid
        and coalesce(stock_quantity, 0) >= (v_item ->> 'quantity')::integer;
      v_reserved := found;
      if v_reserved then
        update public.partner_order_items set stock_reserved = true where id = (v_item ->> 'id')::uuid;
      else
        v_notes := v_notes || format('insufficient_stock:%s', v_item ->> 'product_id');
      end if;
    end loop;
    update public.partner_orders set paid_at = coalesce(paid_at, now()) where id = v_order.id;
  end if;

  -- Leaving paid (refund or cancellation): return the stock.
  if v_previous = 'paid' then
    update public.products p
      set stock_quantity = coalesce(p.stock_quantity, 0) + i.quantity
    from public.partner_order_items i
    where i.order_id = v_order.id and i.stock_reserved and p.id = i.buysell_product_id;
    update public.partner_order_items set stock_reserved = false where order_id = v_order.id;
    if v_order.settlement_status = 'settled' then
      v_notes := v_notes || 'refunded_after_settlement'::text;
    end if;
  end if;

  update public.partner_orders set
    payment_status = v_status,
    payment_reference = coalesce(nullif(p_order ->> 'payment_reference', ''), payment_reference),
    settlement_status = case
      when v_status in ('failed', 'cancelled', 'refunded') and settlement_status = 'unsettled' then 'void'
      else settlement_status
    end,
    needs_review = needs_review or cardinality(v_notes) > 0,
    review_notes = review_notes || v_notes
  where id = v_order.id;

  return jsonb_build_object('created', v_created, 'changed', true, 'order', public.partner_order_summary(v_order.id));
end;
$$;

-- Marks a partner's paid orders up to a point in time as settled, e.g. after
-- their bank transfer arrives:
--   select public.settle_partner_orders('<partner id>', now(), 'TRF-2026-11-01');
create or replace function public.settle_partner_orders(
  p_partner_id uuid,
  p_paid_before timestamptz,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orders integer;
  v_amount numeric(14,2);
begin
  if coalesce(trim(p_reference), '') = '' then
    raise exception 'A settlement reference is required.';
  end if;
  with settled as (
    update public.partner_orders set
      settlement_status = 'settled', settled_at = now(), settlement_reference = p_reference
    where partner_id = p_partner_id
      and payment_status = 'paid'
      and settlement_status = 'unsettled'
      and paid_at <= p_paid_before
    returning amount_due
  )
  select count(*), coalesce(sum(amount_due), 0) into v_orders, v_amount from settled;
  return jsonb_build_object('orders', v_orders, 'amount', v_amount, 'reference', p_reference);
end;
$$;

revoke all on function public.issue_partner_api_key(uuid, text[], text) from public, anon, authenticated;
revoke all on function public.revoke_partner_api_key(uuid) from public, anon, authenticated;
revoke all on function public.partner_order_summary(uuid) from public, anon, authenticated;
revoke all on function public.record_partner_order(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.settle_partner_orders(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_partner_order(uuid, jsonb) to service_role;
grant execute on function public.partner_order_summary(uuid) to service_role;
grant select on public.partner_ledger_balances to service_role;
grant select, update on public.partner_api_keys to service_role;
grant select on public.partners, public.partner_orders, public.partner_order_items to service_role;
