-- Limits for search by photo (the image-search edge function).
--
-- Every photo search asks an AI model what the photo shows, using the Groq key
-- the WhatsApp bots also depend on. So each visitor may run 20 photo searches
-- an hour, and all visitors together 1,500 a day (the function passes these
-- numbers in). Visitors are told apart by a keyed hash of their IP address,
-- never the address itself, and rows older than two days are removed.
--
-- Only the image-search function (service role) reads or writes this table.

create table if not exists public.image_search_requests (
  id bigint generated always as identity primary key,
  client_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists image_search_requests_client_time
  on public.image_search_requests (client_hash, created_at desc);
create index if not exists image_search_requests_time
  on public.image_search_requests (created_at);

alter table public.image_search_requests enable row level security;
revoke all on public.image_search_requests from anon, authenticated;

-- Records a photo search and returns true, or returns false when the visitor
-- or the whole site has reached its limit.
create or replace function public.buysell_take_image_search(
  p_client_hash text,
  p_per_hour integer default 20,
  p_per_day integer default 1500
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(btrim(p_client_hash), '') = '' then
    return false;
  end if;

  -- One visitor at a time, so two quick searches cannot both slip under the limit.
  perform pg_advisory_xact_lock(hashtext('buysell_image_search:' || p_client_hash));

  delete from public.image_search_requests where created_at < now() - interval '2 days';

  if (select count(*) from public.image_search_requests
      where client_hash = p_client_hash and created_at > now() - interval '1 hour') >= p_per_hour then
    return false;
  end if;
  if (select count(*) from public.image_search_requests
      where created_at > now() - interval '1 day') >= p_per_day then
    return false;
  end if;

  insert into public.image_search_requests (client_hash) values (p_client_hash);
  return true;
end;
$$;

revoke all on function public.buysell_take_image_search(text, integer, integer) from public, anon, authenticated;
grant execute on function public.buysell_take_image_search(text, integer, integer) to service_role;
