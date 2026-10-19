-- Migration: Enforce all WhatsApp bot ingested products are Brand New and In Stock
--
-- 1. Database trigger function to guarantee incoming WhatsApp products
-- always have condition = 'new' and stock_quantity >= 1 (In Stock).
create or replace function public.enforce_whatsapp_product_new_and_instock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products
  set condition = 'new',
      stock_quantity = case when stock_quantity is null or stock_quantity <= 0 then 1 else stock_quantity end
  where id = new.product_id;
  return new;
end;
$$;

drop trigger if exists trg_enforce_whatsapp_product_new_and_instock on public.whatsapp_listing_meta;
create trigger trg_enforce_whatsapp_product_new_and_instock
after insert on public.whatsapp_listing_meta
for each row execute function public.enforce_whatsapp_product_new_and_instock();

-- 2. Retroactively update all existing WhatsApp imported products to be Brand New and In Stock
update public.products
set condition = 'new',
    stock_quantity = case when stock_quantity is null or stock_quantity <= 0 then 1 else stock_quantity end
where id in (select product_id from public.whatsapp_listing_meta);
