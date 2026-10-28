-- Upcoming products failed to load for signed-out visitors with "permission
-- denied for table profiles". The table's policies were created in the
-- dashboard and read profile columns (such as email) directly. Since
-- 20261026060000 signed-out visitors can no longer read every profile column,
-- so Postgres refused the whole query, even for public rows.
--
-- Replace them: anyone may read active upcoming products, and verified admins
-- manage them through public.buysell_is_verified_admin() (20261026040000),
-- which reads profiles with its own privileges.

alter table public.upcoming_products enable row level security;

do $$
declare
  policy record;
begin
  for policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'upcoming_products'
  loop
    execute format('drop policy %I on public.upcoming_products', policy.policyname);
  end loop;
end;
$$;

create policy "Anyone can view active upcoming products"
on public.upcoming_products
for select
to anon, authenticated
using (status = 'active');

-- Drafts, paused items, and all changes (the admin Upcoming tab writes from the browser).
create policy "Verified admins manage upcoming products"
on public.upcoming_products
for all
to authenticated
using ((select public.buysell_is_verified_admin()))
with check ((select public.buysell_is_verified_admin()));

grant select on public.upcoming_products to anon, authenticated;
grant insert, update, delete on public.upcoming_products to authenticated;
