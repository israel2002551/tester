-- WhatsApp group listing ingestion for BUYSELL.
--
-- The collector creates ordinary rows in public.products so the existing
-- marketplace, product pages, checkout, and admin product tools work without
-- a parallel listing catalogue. This private table stores only the WhatsApp
-- source metadata and the hash of a seller's management token.

create table if not exists public.whatsapp_listing_meta (
  product_id uuid primary key references public.products(id) on delete cascade,
  source_message_id text not null unique,
  group_jid text not null,
  sender_jid text not null,
  sender_phone text,
  manage_token_hash text not null unique,
  sold_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_listing_meta_sender_created_idx
  on public.whatsapp_listing_meta (sender_jid, created_at desc);

create index if not exists whatsapp_listing_meta_group_created_idx
  on public.whatsapp_listing_meta (group_jid, created_at desc);

-- No browser role may read a phone number, group JID, source message ID, or
-- management-token hash. The Edge Function uses the service role and enforces
-- token checks itself.
alter table public.whatsapp_listing_meta enable row level security;
revoke all on table public.whatsapp_listing_meta from anon, authenticated;

create or replace function public.set_whatsapp_listing_meta_updated_at()
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

drop trigger if exists whatsapp_listing_meta_updated_at on public.whatsapp_listing_meta;
create trigger whatsapp_listing_meta_updated_at
before update on public.whatsapp_listing_meta
for each row execute function public.set_whatsapp_listing_meta_updated_at();

revoke all on function public.set_whatsapp_listing_meta_updated_at() from public;
