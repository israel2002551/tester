-- Public totals for a store page.
--
-- Shoppers cannot read orders (row level security limits them to the buyer,
-- the seller, the store team and admins), so store pages showed "0 sales" to
-- everyone except admins. The products.review_count and avg_rating counters
-- are not kept up to date either. This function returns totals only, never
-- an order or a review:
--   products   active products in the store
--   delivered  orders delivered to buyers
--   reviews    reviews of the store's products
--   rating     their average to one decimal place, or null without reviews

create or replace function public.buysell_store_stats(p_seller_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'products', (
      select count(*) from public.products p
      where p.seller_id = p_seller_id and p.status = 'active'
    ),
    'delivered', (
      select count(*) from public.orders o
      where o.seller_id = p_seller_id and o.status in ('delivered', 'completed')
    ),
    'reviews', (
      select count(*) from public.reviews r
      join public.products p on p.id = r.product_id
      where p.seller_id = p_seller_id
    ),
    'rating', (
      select round(avg(r.rating)::numeric, 1) from public.reviews r
      join public.products p on p.id = r.product_id
      where p.seller_id = p_seller_id
    )
  );
$$;

revoke all on function public.buysell_store_stats(uuid) from public;
grant execute on function public.buysell_store_stats(uuid) to anon, authenticated, service_role;
