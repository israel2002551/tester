update public.profiles
set
  commission_paid = true,
  is_suspended = false,
  trial_end = null
where role in ('seller', 'both', 'service_provider')
   or accounts in ('seller', 'both', 'service_provider');
