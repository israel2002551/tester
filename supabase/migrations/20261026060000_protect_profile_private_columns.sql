-- Hide private profile fields from the public API.
--
-- Product listings embedded each seller's profile, and the profiles table was
-- readable column-for-column by every visitor, exposing bank names, account
-- numbers, Paystack keys, emails, and WhatsApp numbers. Row level security
-- cannot hide individual columns, so this switches the browser roles to
-- column-level SELECT grants:
--   * private to everyone but the owner (via get_my_private_profile) and the
--     server: payout details, Paystack key, notification email, push token
--   * hidden from signed-out visitors (still readable when signed in, which
--     chat and the admin screens need): email, whatsapp
--
-- NOTE: columns added to profiles later are NOT readable by the browser until
-- granted, e.g. `grant select (new_column) on public.profiles to anon, authenticated;`
-- Edge Functions use the service role and are unaffected.

do $$
declare
  private_columns text[] := array[
    'bank_name', 'account_number', 'account_name', 'paystack_key',
    'notif_email', 'push_subscription_token'
  ];
  signed_in_only text[] := array['email', 'whatsapp'];
  public_list text;
  signed_in_list text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into public_list
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name <> all (private_columns)
    and column_name <> all (signed_in_only);

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into signed_in_list
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name = any (signed_in_only);

  execute 'revoke select on public.profiles from anon, authenticated';
  execute format('grant select (%s) on public.profiles to anon, authenticated', public_list);
  if signed_in_list is not null then
    execute format('grant select (%s) on public.profiles to authenticated', signed_in_list);
  end if;
end;
$$;

-- The signed-in user's own payout details (settings and withdrawal screens).
create or replace function public.get_my_private_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select jsonb_strip_nulls(jsonb_build_object(
        'bank_name', row_data -> 'bank_name',
        'account_number', row_data -> 'account_number',
        'account_name', row_data -> 'account_name',
        'paystack_key', row_data -> 'paystack_key',
        'notif_email', row_data -> 'notif_email'
      ))
      from (select to_jsonb(p) as row_data from public.profiles p where p.id = auth.uid()) own
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.get_my_private_profile() from public, anon;
grant execute on function public.get_my_private_profile() to authenticated;
