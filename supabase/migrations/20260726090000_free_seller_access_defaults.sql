alter table public.profiles
alter column commission_paid set default true;

alter table public.profiles
alter column trial_end drop default;

alter table public.profiles
alter column is_suspended set default false;

update public.profiles
set
  commission_paid = true,
  trial_end = null
where role in ('seller', 'both', 'service_provider')
   or accounts in ('seller', 'both', 'service_provider');
