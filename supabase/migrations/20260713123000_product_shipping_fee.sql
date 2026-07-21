alter table public.products
add column if not exists shipping_fee numeric not null default 0;

alter table public.products
add column if not exists shipping_cost numeric not null default 0;
