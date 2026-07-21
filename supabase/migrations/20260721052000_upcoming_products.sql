create table if not exists public.upcoming_products (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  image_url text,
  video_url text,
  images jsonb not null default '[]'::jsonb,
  videos jsonb not null default '[]'::jsonb,
  launch_date date,
  priority integer not null default 0,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upcoming_products_status_check check (status in ('active', 'hidden', 'archived'))
);

create index if not exists upcoming_products_status_priority_idx
on public.upcoming_products (status, priority desc, created_at desc);

alter table public.upcoming_products enable row level security;

drop policy if exists "Public can read active upcoming products" on public.upcoming_products;
create policy "Public can read active upcoming products"
on public.upcoming_products
for select
using (status = 'active');

drop policy if exists "Admins can manage upcoming products" on public.upcoming_products;
create policy "Admins can manage upcoming products"
on public.upcoming_products
for all
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or p.email in ('israelefe093@gmail.com', 'peaceomomofe34@gmail.com')
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role = 'admin'
        or p.email in ('israelefe093@gmail.com', 'peaceomomofe34@gmail.com')
      )
  )
);
