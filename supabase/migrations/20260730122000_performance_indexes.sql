create index if not exists products_status_created_idx
on public.products (status, created_at desc);

create index if not exists products_seller_status_created_idx
on public.products (seller_id, status, created_at desc);

create index if not exists orders_buyer_created_idx
on public.orders (buyer_id, created_at desc);

create index if not exists orders_seller_created_idx
on public.orders (seller_id, created_at desc);

create index if not exists orders_status_created_idx
on public.orders (status, created_at desc);

create index if not exists reviews_product_created_idx
on public.reviews (product_id, created_at desc);

create index if not exists kyc_verifications_status_created_idx
on public.kyc_verifications (status, created_at desc);
