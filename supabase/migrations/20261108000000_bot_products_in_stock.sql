-- Migration: Products sent in by the WhatsApp and Telegram bots start with 10 in stock
--
-- Shop cards say "Only N left" at 5 or fewer, so every bot listing showed
-- "Only 1 left". New WhatsApp listings now get 10 from whatsapp-listing-action.
-- Telegram listings are written by an outside bot, so a trigger sets the stock
-- when the submission is recorded (the product row always exists by then).

create or replace function public.stock_telegram_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products
  set stock_quantity = 10
  where id = new.product_id
    and coalesce(stock_quantity, 0) < 10;
  return new;
end;
$$;

drop trigger if exists trg_stock_telegram_product on public.telegram_product_submissions;
create trigger trg_stock_telegram_product
after insert on public.telegram_product_submissions
for each row execute function public.stock_telegram_product();

-- Existing bot listings still on the old default. Sold listings (stock 0) and
-- removed WhatsApp listings are left alone.
update public.products p
set stock_quantity = 10
where p.stock_quantity between 1 and 5
  and (
    exists (
      select 1 from public.whatsapp_listing_meta m
      where m.product_id = p.id and m.sold_at is null and m.deleted_at is null
    )
    or exists (select 1 from public.telegram_product_submissions t where t.product_id = p.id)
  );
