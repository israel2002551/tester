-- The inbox client inserts messages directly with the authenticated user's ID
-- as sender_id.  Keep RLS enabled, but allow only that identity to create its
-- own outbound messages.
alter table public.messages enable row level security;

do $$
begin
  -- Some production databases already have an equivalent sender policy created
  -- outside the migration history. Do not add a duplicate permissive policy.
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and cmd = 'INSERT'
  ) then
    create policy "Authenticated users can send their own messages"
      on public.messages
      for insert
      to authenticated
      with check (
        sender_id = (select auth.uid())
        and receiver_id is not null
        and receiver_id <> (select auth.uid())
      );
  end if;
end;
$$;
