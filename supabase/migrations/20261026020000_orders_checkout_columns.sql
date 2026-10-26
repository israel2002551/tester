-- Columns written by the bogo-promo checkout function when it creates an order.
-- shipping_total and shipping_groups were never added by a migration, so order
-- creation failed with "Could not find the 'shipping_groups' column of 'orders'".
-- The remaining columns repeat the BOGO and free-shipping migrations; every
-- clause is idempotent, so this is safe whether or not those were applied.

alter table public.orders
  add column if not exists payment_method text,
  add column if not exists payment_ref text,
  add column if not exists delivery_name text,
  add column if not exists delivery_phone text,
  add column if not exists delivery_address text,
  add column if not exists shipping_total numeric(14,2) not null default 0
    check (shipping_total >= 0),
  add column if not exists shipping_groups jsonb not null default '[]'::jsonb,
  add column if not exists shipping_discount_amount numeric(14,2) not null default 0
    check (shipping_discount_amount >= 0),
  add column if not exists is_free_shipping_applied boolean not null default false,
  add column if not exists platform_shipping_subsidy numeric(14,2) not null default 0
    check (platform_shipping_subsidy >= 0),
  add column if not exists free_shipping_pricing_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists is_bogo_order boolean not null default false,
  add column if not exists bogo_primary_item_id uuid
    references public.products(id) on delete set null,
  add column if not exists bogo_free_item_id uuid
    references public.products(id) on delete set null,
  add column if not exists platform_promo_discount_amount numeric(14,2) not null default 0
    check (platform_promo_discount_amount >= 0),
  add column if not exists bogo_extra_customer_charge numeric(14,2) not null default 0
    check (bogo_extra_customer_charge >= 0),
  add column if not exists bogo_pricing_snapshot jsonb not null default '{}'::jsonb;

-- Make the API see the new columns immediately instead of after its cache expires.
notify pgrst, 'reload schema';
