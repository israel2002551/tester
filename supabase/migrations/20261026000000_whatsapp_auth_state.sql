-- Durable WhatsApp session (Baileys auth state) for the Bot 2 Vision collector.
--
-- Render's free plan has no persistent disk, so the collector's session files
-- were lost on every restart/redeploy and the bot had to be re-paired. Values are
-- AES-256-GCM ciphertext produced by the collector; the encryption key never
-- reaches Supabase. Only the server-side Edge Function (service_role) may access
-- this table because a decrypted session grants full access to the account.

create table if not exists public.whatsapp_auth_state (
  session_id text not null check (session_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  key text not null check (char_length(key) between 1 and 400),
  value text not null check (char_length(value) between 1 and 1048576),
  updated_at timestamptz not null default now(),
  primary key (session_id, key)
);

alter table public.whatsapp_auth_state enable row level security;
revoke all on table public.whatsapp_auth_state from public, anon, authenticated;
