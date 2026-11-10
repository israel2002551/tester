-- One private link per WhatsApp seller. The bot used to send a manage link and
-- a public link for every item it collected. Now each seller gets one link to
-- their catalog: every item the bot took from their posts, searchable, with
-- edit, mark sold and remove (whatsapp-listing-action: seller_catalog_link,
-- catalog_get and catalog_update).
--
-- The link's token is an HMAC of the seller's WhatsApp ID, so the Edge
-- Function can send the same link every time while this table keeps only its
-- hash. Only the Edge Function (service role) reads or writes the table.
create table if not exists public.whatsapp_seller_catalogs (
  sender_jid text primary key,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_seller_catalogs enable row level security;
revoke all on table public.whatsapp_seller_catalogs from anon, authenticated;
