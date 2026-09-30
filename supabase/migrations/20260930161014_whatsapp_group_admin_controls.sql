-- Admin-managed WhatsApp group ingestion configuration.
-- This information is intentionally private: the browser never receives a
-- sender JID, source message ID, management token, or group configuration
-- without passing the Edge Function's admin check.

create table if not exists public.whatsapp_group_settings (
  id uuid primary key default gen_random_uuid(),
  group_jid text not null unique check (group_jid ~ '^[0-9-]{10,80}@g\\.us$'),
  display_name text not null default '' check (char_length(display_name) <= 120),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_group_settings_active_idx
  on public.whatsapp_group_settings (is_active, created_at desc);

-- Retain pricing provenance for staff without exposing it to marketplace
-- clients. Existing imported listings pre-date these fields, so source_price
-- remains nullable for those legacy rows.
alter table public.whatsapp_listing_meta
  add column if not exists source_price numeric,
  add column if not exists price_markup numeric not null default 5000
    check (price_markup >= 0);

alter table public.whatsapp_group_settings enable row level security;
revoke all on table public.whatsapp_group_settings from anon, authenticated;

create or replace function public.set_whatsapp_group_settings_updated_at()
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

drop trigger if exists whatsapp_group_settings_updated_at on public.whatsapp_group_settings;
create trigger whatsapp_group_settings_updated_at
before update on public.whatsapp_group_settings
for each row execute function public.set_whatsapp_group_settings_updated_at();

revoke all on function public.set_whatsapp_group_settings_updated_at() from public;
