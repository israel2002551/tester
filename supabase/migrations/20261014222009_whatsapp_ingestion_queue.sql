-- Durable, private work queue for the WhatsApp Vision collector.
--
-- Only the server-side Edge Function (service_role) may access these jobs.
-- Browser roles are deliberately denied access because a job can contain group
-- JIDs, sender details, message identifiers, and private Cloudinary URLs.

create table if not exists public.whatsapp_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 16 and 300),
  group_jid text not null check (group_jid ~ '^[0-9-]{10,80}@g[.]us$'),
  sender_jid text not null check (char_length(sender_jid) between 3 and 200),
  sender_phone text,
  message_ids text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'queued' check (state in ('queued', 'processing', 'retry', 'needs_price', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 50),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lock_token uuid,
  locked_by text,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_ingestion_jobs_claim_idx
  on public.whatsapp_ingestion_jobs (state, available_at, created_at)
  where state in ('queued', 'retry');

create index if not exists whatsapp_ingestion_jobs_reclaim_idx
  on public.whatsapp_ingestion_jobs (lease_until, created_at)
  where state = 'processing';

create index if not exists whatsapp_ingestion_jobs_sender_idx
  on public.whatsapp_ingestion_jobs (sender_jid, created_at desc);

alter table public.whatsapp_ingestion_jobs enable row level security;
revoke all on table public.whatsapp_ingestion_jobs from public, anon, authenticated;

create or replace function public.set_whatsapp_ingestion_job_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists whatsapp_ingestion_jobs_updated_at on public.whatsapp_ingestion_jobs;
create trigger whatsapp_ingestion_jobs_updated_at
before update on public.whatsapp_ingestion_jobs
for each row execute function public.set_whatsapp_ingestion_job_updated_at();

revoke all on function public.set_whatsapp_ingestion_job_updated_at() from public;

-- Atomically claims work without two collectors handling the same job. An
-- expired lease is intentionally claimable again so a deploy/crash cannot lose
-- a listing. The function is invoker-security and only service_role can call it.
create or replace function public.claim_whatsapp_ingestion_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 900
)
returns setof public.whatsapp_ingestion_jobs
language plpgsql
security invoker
set search_path = public
as $$
begin
  if char_length(coalesce(p_worker_id, '')) < 8 then
    raise exception 'A worker identifier is required.';
  end if;

  return query
  with candidates as (
    select id
    from public.whatsapp_ingestion_jobs
    where (
      state in ('queued', 'retry')
      and available_at <= now()
      and (lease_until is null or lease_until < now())
    ) or (
      state = 'processing'
      and lease_until < now()
    )
    order by available_at asc, created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 10))
  ), claimed as (
    update public.whatsapp_ingestion_jobs as job
    set state = 'processing',
        attempts = job.attempts + 1,
        locked_by = p_worker_id,
        lock_token = gen_random_uuid(),
        lease_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600))),
        last_error = null
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_whatsapp_ingestion_jobs(text, integer, integer) from public;
grant execute on function public.claim_whatsapp_ingestion_jobs(text, integer, integer) to service_role;
