do $$
declare
  owner_column text;
  update_policy text;
  delete_policy text;
begin
  if to_regclass('public.reviews') is null then
    return;
  end if;

  foreach owner_column in array array['reviewer_id', 'buyer_id', 'user_id'] loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'reviews'
        and column_name = owner_column
    ) then
      update_policy := format('reviews_update_own_%s', owner_column);
      delete_policy := format('reviews_delete_own_%s', owner_column);

      if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'reviews'
          and policyname = update_policy
      ) then
        execute format(
          'create policy %I on public.reviews for update to authenticated using (auth.uid() = %I) with check (auth.uid() = %I)',
          update_policy,
          owner_column,
          owner_column
        );
      end if;

      if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'reviews'
          and policyname = delete_policy
      ) then
        execute format(
          'create policy %I on public.reviews for delete to authenticated using (auth.uid() = %I)',
          delete_policy,
          owner_column
        );
      end if;
    end if;
  end loop;
end $$;
