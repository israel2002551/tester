-- Stop users from granting themselves privileges through their own profile row.
--
-- The browser creates and edits its own profile (signup, "become a seller",
-- KYC submission, store details), and many Edge Functions trust
-- profiles.role = 'admin'. Without a guard, anyone could run
--   db.from('profiles').update({ role: 'admin' }).eq('id', <own id>)
-- from the browser console. This trigger keeps the legitimate browser flows
-- working and rejects privilege changes that only the server may make.
--
-- Trusted callers (unchanged behaviour): the service role used by Edge
-- Functions, the SQL editor, and verified admins (role 'admin' whose profile
-- email equals their signed-in email).

create or replace function public.buysell_is_verified_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and lower(coalesce(p.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and lower(coalesce(p.email, '')) <> ''
  );
$$;

revoke all on function public.buysell_is_verified_admin() from public;
grant execute on function public.buysell_is_verified_admin() to anon, authenticated, service_role;

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  caller text := coalesce(nullif(auth.role(), ''), current_user);
  new_row jsonb := to_jsonb(new);
  old_row jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  col text;
begin
  if caller = 'service_role' then
    return new;
  end if;

  -- Applies to every other caller, including the signup trigger that copies
  -- user-chosen metadata: nobody becomes an admin by creating a profile.
  if tg_op = 'INSERT'
     and (lower(coalesce(new_row ->> 'role', '')) in ('admin', 'super_admin')
          or lower(coalesce(new_row ->> 'accounts', '')) in ('admin', 'super_admin')) then
    raise exception 'Admin accounts can only be granted by BUYSELL staff.'
      using errcode = '42501';
  end if;

  -- SQL editor, migrations, and other database-side code are trusted for updates.
  if caller not in ('authenticated', 'anon') then
    return new;
  end if;

  if public.buysell_is_verified_admin() then
    return new;
  end if;

  -- Role: buyers may become sellers, but never admins.
  if (lower(coalesce(new_row ->> 'role', '')) in ('admin', 'super_admin')
        and new_row ->> 'role' is distinct from old_row ->> 'role')
     or (lower(coalesce(new_row ->> 'accounts', '')) in ('admin', 'super_admin')
        and new_row ->> 'accounts' is distinct from old_row ->> 'accounts') then
    raise exception 'Admin accounts can only be granted by BUYSELL staff.'
      using errcode = '42501';
  end if;

  -- Email must match the signed-in account (it is used in admin checks).
  if (tg_op = 'INSERT' or new_row ->> 'email' is distinct from old_row ->> 'email')
     and coalesce(new_row ->> 'email', '') <> ''
     and lower(new_row ->> 'email') <> jwt_email then
    raise exception 'Profile email must match the signed-in account.'
      using errcode = '42501';
  end if;

  -- Server-managed fields: suspension, balances, platform-store flags, and
  -- staff access. Columns that do not exist are simply ignored.
  foreach col in array array[
    'is_suspended', 'wallet_balance', 'available_balance', 'pending_balance',
    'is_platform_store', 'store_type', 'seller_access_category'
  ] loop
    if tg_op = 'INSERT' then
      if coalesce(new_row ->> col, '') not in ('', 'false', '0') then
        raise exception 'Profile field % is managed by BUYSELL.', col using errcode = '42501';
      end if;
    elsif new_row -> col is distinct from old_row -> col then
      raise exception 'Profile field % is managed by BUYSELL.', col using errcode = '42501';
    end if;
  end loop;

  -- Verification: a user may submit KYC (status 'pending'), never approve it.
  foreach col in array array['kyc_status', 'verification_status'] loop
    if new_row -> col is distinct from old_row -> col
       and lower(coalesce(new_row ->> col, '')) in ('approved', 'verified') then
      raise exception 'Verification can only be approved by BUYSELL staff.' using errcode = '42501';
    end if;
  end loop;
  if new_row -> 'seller_verified' is distinct from old_row -> 'seller_verified'
     and (new_row ->> 'seller_verified') = 'true' then
    raise exception 'Verification can only be approved by BUYSELL staff.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges
before insert or update on public.profiles
for each row execute function public.protect_profile_privileges();
