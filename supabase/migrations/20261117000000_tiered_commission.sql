-- BUYSELL's commission by price, instead of a flat 20%.
--
-- The commission added to the seller's price for one item is now:
--   below ₦300,000              8%
--   ₦300,000 up to ₦999,999     6%
--   ₦1,000,000 and above        4%
-- New and edited products get it from manage-product, the WhatsApp imports and
-- the product import service, and checkout charges it
-- (supabase/functions/_shared/commission.ts). This migration:
--
--   1. adds public.buysell_commission_percent() and public.buysell_buyer_price(),
--      the same rule in the database;
--   2. reprices every product with a known seller price, so the price buyers
--      see is the seller price plus the new commission, as checkout charges.
--      A crossed-out "was" price keeps its discount;
--   3. corrects five WhatsApp listings whose saved seller price already
--      included the old 20% (buyers were charged the commission twice): their
--      seller price becomes the WhatsApp seller's own asking price;
--   4. records every change in public.product_commission_repricing.
--
-- It can run more than once: a second run changes nothing.
--
-- To undo step 2 and 3:
--   alter table public.products disable trigger on_product_published;
--   update public.products p set price = r.old_price, original_price = r.old_original_price
--     from public.product_commission_repricing r where r.product_id = p.id;
--   update public.product_seller_pricing s set seller_price = r.old_seller_price
--     from public.product_commission_repricing r where r.product_id = s.product_id and r.old_seller_price > 0;
--   update public.whatsapp_listing_meta m set price_markup = r.old_price_markup
--     from public.product_commission_repricing r where r.product_id = m.product_id and r.old_price_markup is not null;
--   alter table public.products enable trigger on_product_published;

create or replace function public.buysell_commission_percent(p_seller_price numeric)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when round(coalesce(p_seller_price, 0)) < 300000 then 8
    when round(coalesce(p_seller_price, 0)) < 1000000 then 6
    else 4
  end;
$$;

-- The price buyers pay for one item: the seller price plus the commission,
-- rounded to whole naira as the website and server round it.
create or replace function public.buysell_buyer_price(p_seller_price numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select s + round(s * public.buysell_commission_percent(s) / 100.0)
  from (select greatest(round(coalesce(p_seller_price, 0)), 0) as s) seller;
$$;

grant execute on function public.buysell_commission_percent(numeric) to anon, authenticated, service_role;
grant execute on function public.buysell_buyer_price(numeric) to anon, authenticated, service_role;

create table if not exists public.product_commission_repricing (
  product_id uuid primary key,
  old_price numeric,
  old_original_price numeric,
  old_seller_price numeric,
  old_price_markup numeric,
  seller_price numeric not null,
  new_price numeric not null,
  new_original_price numeric,
  repriced_at timestamptz not null default now()
);
-- Only the SQL editor and the service role read this.
alter table public.product_commission_repricing enable row level security;
revoke all on public.product_commission_repricing from anon, authenticated;

drop table if exists buysell_commission_plan;
create temporary table buysell_commission_plan as
with base as (
  select p.id, p.price, p.original_price,
         sp.seller_price as saved_seller_price,
         wm.source_price, wm.price_markup
  from public.products p
  left join public.product_seller_pricing sp on sp.product_id = p.id
  left join public.whatsapp_listing_meta wm on wm.product_id = p.id
),
chosen as (
  select b.*,
    case
      -- A WhatsApp listing's seller price is the seller's own asking price,
      -- also when the saved one wrongly includes the old 20%.
      when b.source_price > 0 and (
        b.saved_seller_price is null
        or round(b.saved_seller_price) = round(b.source_price)
        or round(b.saved_seller_price) = round(b.source_price * 1.2)
      ) then round(b.source_price)
      when b.saved_seller_price > 0 then round(b.saved_seller_price)
    end as seller_price
  from base b
)
select c.*,
  public.buysell_buyer_price(c.seller_price) as new_price,
  case
    when c.original_price is null or c.original_price <= 0 then c.original_price
    -- No discount: the "was" price follows the price.
    when c.original_price <= c.price or c.price is null or c.price <= 0 then public.buysell_buyer_price(c.seller_price)
    -- A discount: the "was" price, taken back to a seller amount, plus its commission.
    else greatest(
      public.buysell_buyer_price(c.seller_price),
      public.buysell_buyer_price(round(c.original_price * c.seller_price / c.price))
    )
  end as new_original_price
from chosen c
where c.seller_price > 0
  -- Already repriced by an earlier run: leave it (a "was" price on another
  -- commission rate than its price would otherwise move slightly).
  and not exists (select 1 from public.product_commission_repricing r where r.product_id = c.id);

insert into public.product_commission_repricing
  (product_id, old_price, old_original_price, old_seller_price, old_price_markup, seller_price, new_price, new_original_price)
select id, price, original_price, saved_seller_price, price_markup, seller_price, new_price, new_original_price
from buysell_commission_plan
where price is distinct from new_price
   or original_price is distinct from new_original_price
   or saved_seller_price is distinct from seller_price
on conflict (product_id) do nothing;

-- Repricing is not a new listing: skip the per-row call to notify-new-product.
alter table public.products disable trigger on_product_published;

update public.products p
set price = plan.new_price,
    original_price = plan.new_original_price
from buysell_commission_plan plan
where plan.id = p.id
  and (p.price is distinct from plan.new_price or p.original_price is distinct from plan.new_original_price);

alter table public.products enable trigger on_product_published;

-- Checkout charges from these seller prices.
insert into public.product_seller_pricing (product_id, seller_price, source)
select id, seller_price, 'tiered_commission_repricing'
from buysell_commission_plan
on conflict (product_id) do update
  set seller_price = excluded.seller_price, updated_at = now()
  where public.product_seller_pricing.seller_price is distinct from excluded.seller_price;

update public.whatsapp_listing_meta wm
set price_markup = plan.new_price - plan.seller_price
from buysell_commission_plan plan
where plan.id = wm.product_id
  and round(wm.source_price) = plan.seller_price
  and wm.price_markup is distinct from plan.new_price - plan.seller_price;

drop table buysell_commission_plan;
