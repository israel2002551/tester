alter table public.products
drop constraint if exists products_status_check;

update public.products
set status = 'active'
where status is null;

alter table public.products
alter column status set default 'active';

alter table public.products
add constraint products_status_check
check (
  status in (
    'active',
    'pending',
    'paused',
    'inactive',
    'draft',
    'archived',
    'rejected',
    'sold',
    'sold_out'
  )
);
