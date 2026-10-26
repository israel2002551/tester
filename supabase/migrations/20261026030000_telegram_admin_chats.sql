-- Admin chats linked to a Telegram bot by sending it /start (see
-- supabase/functions/_shared/telegram.ts). Lets Edge Functions send admin alerts
-- with only TELEGRAM_BOT_TOKEN configured. Service role only: these chats
-- receive buyer names, phone numbers, addresses and payment receipts.

create table if not exists public.telegram_admin_chats (
  bot_id text not null check (bot_id ~ '^[0-9]{1,20}$'),
  chat_id text not null check (chat_id ~ '^-?[0-9]{1,20}$'),
  username text,
  linked_at timestamptz not null default now(),
  primary key (bot_id, chat_id)
);

alter table public.telegram_admin_chats enable row level security;
revoke all on table public.telegram_admin_chats from public, anon, authenticated;
