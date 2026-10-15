-- Apply the 20% marketplace commission to pre-existing, ordinary seller
-- listings once. The seller/source price remains private for payouts and BOGO
-- calculations, while public.products.price becomes the customer price.
--
-- WhatsApp Vision (Bot 2) listings are explicitly excluded. Bot 2 already
-- writes a public price containing this 20% markup and is identified both by
-- its private pricing source and its WhatsApp metadata row.

with legacy_pricing as (
  select ps.product_id, ps.seller_price
  from public.product_seller_pricing as ps
  where ps.source = 'legacy_product_price'
    and not exists (
      select 1
      from public.whatsapp_listing_meta as meta
      where meta.product_id = ps.product_id
    )
)
update public.products as p
set price = round(lp.seller_price * 1.20),
    original_price = greatest(
      round(lp.seller_price * 1.20),
      round(coalesce(nullif(p.original_price, 0), p.price) * 1.20)
    )
from legacy_pricing as lp
where p.id = lp.product_id;

-- Make the migration safe to re-run manually: only untouched legacy rows are
-- candidates above, and no Bot 2 row is ever relabelled.
update public.product_seller_pricing as ps
set source = 'legacy_commission_applied',
    updated_at = now()
where ps.source = 'legacy_product_price'
  and not exists (
    select 1
    from public.whatsapp_listing_meta as meta
    where meta.product_id = ps.product_id
  );
