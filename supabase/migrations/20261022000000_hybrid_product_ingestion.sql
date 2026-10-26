-- Shared Bot 2 / Bot 3 source provenance. Product records remain in the
-- existing public.products table; platform identity and seller prices remain
-- private and are available only to server-side services.

create table if not exists public.telegram_users (
  telegram_id bigint primary key,
  username text,
  first_name text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (username is null or char_length(username) <= 100),
  check (first_name is null or char_length(first_name) <= 120)
);

create table if not exists public.telegram_product_submissions (
  product_id uuid primary key references public.products(id) on delete cascade,
  telegram_id bigint not null references public.telegram_users(telegram_id) on delete restrict,
  telegram_username text,
  source_listing_id text not null unique check (char_length(source_listing_id) between 8 and 300),
  seller_price numeric(14,2) not null check (seller_price > 0),
  price_markup_percent numeric(5,2) not null default 20 check (price_markup_percent between 0 and 100),
  created_at timestamptz not null default now()
);

create index if not exists telegram_product_submissions_telegram_created_idx
  on public.telegram_product_submissions (telegram_id, created_at desc);

alter table public.telegram_users enable row level security;
alter table public.telegram_product_submissions enable row level security;
revoke all on table public.telegram_users from public, anon, authenticated;
revoke all on table public.telegram_product_submissions from public, anon, authenticated;
grant all on table public.telegram_users to service_role;
grant all on table public.telegram_product_submissions to service_role;

-- The shared API emits public object URLs for marketplace product media.
-- Existing bucket settings are intentionally left unchanged.
insert into storage.buckets (id, name, public)
values ('product-media', 'product-media', true)
on conflict (id) do nothing;
