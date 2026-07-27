update public.profiles p
set
  kyc_status = coalesce(p.kyc_status, latest.status, 'pending'),
  verification_status = case
    when p.verification_status in ('verified', 'approved') then p.verification_status
    when latest.status = 'approved' then 'verified'
    when latest.status = 'rejected' then 'pending'
    else coalesce(p.verification_status, 'pending')
  end,
  commission_paid = true,
  trial_end = null
from (
  select distinct on (user_id)
    user_id,
    status
  from public.kyc_verifications
  order by user_id, created_at desc
) latest
where p.id = latest.user_id
  and (
    p.kyc_status is null
    or p.verification_status is null
    or p.commission_paid is distinct from true
    or p.trial_end is not null
  );
