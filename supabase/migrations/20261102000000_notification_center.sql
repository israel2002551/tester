-- Notification center: one list of order updates and messages per person,
-- shown under the bell on the site and sent to their phone as an alert.
--
--   * public.notifications holds each person's notifications. People read and
--     mark their own as read; only the database adds them.
--   * public.notification_settings holds which alerts each person wants
--     (order updates, messages, new products and deals). No row means all on.
--   * Triggers on orders and messages add the notifications, so every way an
--     order changes (admin screens, payment webhooks, the Telegram bots) and
--     every message is covered.
--   * Each new notification is handed to the deliver-notification Edge Function
--     through pg_net, which sends it to the person's phones. That function keeps
--     JWT verification on; the database signs its calls with the project's
--     public anon key, kept in Vault. Add it once (Dashboard > Settings > API
--     shows the anon key):
--       select vault.create_secret('<anon key>', 'buysell_anon_key');
--     Until then notifications still appear on the site; only phone alerts wait.

create extension if not exists pg_net;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('order', 'message', 'product', 'system')),
  title text not null,
  body text not null default '',
  -- What tapping it opens: {order_id, status, audience} or {partner_id, partner_name}.
  data jsonb not null default '{}'::jsonb,
  -- Unread notifications with the same key are merged ("3 new messages from Ada").
  group_key text,
  item_count integer not null default 1,
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_recent on public.notifications (user_id, created_at desc);
create unique index if not exists notifications_unread_group
  on public.notifications (user_id, group_key)
  where read_at is null and group_key is not null;

alter table public.notifications enable row level security;

drop policy if exists "Read own notifications" on public.notifications;
create policy "Read own notifications" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Mark own notifications read" on public.notifications;
create policy "Mark own notifications read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create table if not exists public.notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  orders boolean not null default true,
  messages boolean not null default true,
  products boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_settings enable row level security;

drop policy if exists "Manage own notification settings" on public.notification_settings;
create policy "Manage own notification settings" on public.notification_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.notification_settings from anon, authenticated;
grant select, insert, update on public.notification_settings to authenticated;

-- Adds a notification, or refreshes the unread one with the same group key.
-- Only the triggers below call it.
create or replace function public.buysell_notify(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_group_key text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    return;
  end if;

  if p_group_key is null then
    insert into public.notifications (user_id, kind, title, body, data)
    values (p_user_id, p_kind, p_title, coalesce(p_body, ''), coalesce(p_data, '{}'::jsonb));
  else
    insert into public.notifications (user_id, kind, title, body, data, group_key)
    values (p_user_id, p_kind, p_title, coalesce(p_body, ''), coalesce(p_data, '{}'::jsonb), p_group_key)
    on conflict (user_id, group_key) where read_at is null and group_key is not null
    do update set
      title = excluded.title,
      body = excluded.body,
      data = excluded.data,
      item_count = public.notifications.item_count + 1,
      created_at = now(),
      pushed_at = null;
  end if;
end;
$$;

revoke execute on function public.buysell_notify(uuid, text, text, text, jsonb, text) from public, anon, authenticated;

-- Order updates: the buyer hears about each step; the seller hears about new
-- paid orders, cancellations and deliveries.
create or replace function public.buysell_notify_order_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_status text;
  ref text;
  total numeric;
  amount text;
  details jsonb;
  buyer_title text;
  buyer_body text;
  seller_title text;
  seller_body text;
begin
  new_status := lower(coalesce(new.status, 'pending'));
  if tg_op = 'UPDATE' and new_status = lower(coalesce(old.status, 'pending')) then
    return new;
  end if;
  ref := left(new.id::text, 8);
  total := nullif(to_jsonb(new) ->> 'total_amount', '')::numeric;
  amount := case when total > 0 then ' (₦' || to_char(total, 'FM999,999,999,990') || ')' else '' end;
  details := jsonb_build_object('order_id', new.id::text, 'status', new_status);

  buyer_title := case new_status
    when 'pending' then 'Order placed'
    when 'confirmed' then 'Payment confirmed'
    when 'picked_up' then 'Order collected'
    when 'shipped' then 'Order collected'
    when 'in_transit' then 'Order on the way'
    when 'out_for_delivery' then 'Out for delivery'
    when 'delivered' then 'Order delivered'
    when 'cancelled' then 'Order cancelled'
    when 'refunded' then 'Refund sent'
  end;
  buyer_body := case new_status
    when 'pending' then format('We received order %s%s and are checking your payment.', ref, amount)
    when 'confirmed' then format('Order %s is confirmed. BUYSELL will collect it from the seller.', ref)
    when 'picked_up' then format('BUYSELL has collected order %s from the seller.', ref)
    when 'shipped' then format('BUYSELL has collected order %s from the seller.', ref)
    when 'in_transit' then format('Order %s is on its way to you.', ref)
    when 'out_for_delivery' then format('Order %s is out for delivery. Keep your phone close.', ref)
    when 'delivered' then format('Order %s was delivered. Tap to rate what you bought.', ref)
    when 'cancelled' then format('Order %s was cancelled. Contact support if you have questions.', ref)
    when 'refunded' then format('Your payment for order %s has been refunded.', ref)
  end;
  if buyer_title is not null then
    perform public.buysell_notify(new.buyer_id, 'order', buyer_title, buyer_body,
      details || '{"audience": "buyer"}'::jsonb, 'order:' || new.id::text);
  end if;

  seller_title := case new_status
    when 'confirmed' then 'New paid order'
    when 'cancelled' then 'Order cancelled'
    when 'delivered' then 'Order delivered'
  end;
  seller_body := case new_status
    when 'confirmed' then format('Order %s%s is paid. Get it ready for BUYSELL pickup.', ref, amount)
    when 'cancelled' then format('Order %s was cancelled. You do not need to send it.', ref)
    when 'delivered' then format('Order %s reached the buyer.', ref)
  end;
  if seller_title is not null and new.seller_id is distinct from new.buyer_id then
    perform public.buysell_notify(new.seller_id, 'order', seller_title, seller_body,
      details || '{"audience": "seller"}'::jsonb, 'seller-order:' || new.id::text);
  end if;

  return new;
exception when others then
  -- A notification that cannot be added must never stop an order update.
  raise warning 'Could not add order notification for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists buysell_notify_order_change on public.orders;
create trigger buysell_notify_order_change
after insert or update of status on public.orders
for each row execute function public.buysell_notify_order_change();

-- Messages: one notification per conversation while unread.
create or replace function public.buysell_notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  message jsonb;
  sender_name text;
  preview text;
begin
  message := to_jsonb(new);
  if new.receiver_id is null or new.receiver_id = new.sender_id then
    return new;
  end if;

  select coalesce(nullif(btrim(p.store_name), ''), nullif(btrim(p.name), ''))
    into sender_name
    from public.profiles p
    where p.id = new.sender_id;
  sender_name := coalesce(sender_name, 'A BUYSELL user');
  preview := btrim(regexp_replace(coalesce(message ->> 'content', message ->> 'message', message ->> 'body', ''), '\s+', ' ', 'g'));
  if preview ~* '^https?://\S+\.(jpe?g|png|webp|gif)(\?\S*)?$' then
    preview := 'Sent a photo';
  end if;

  perform public.buysell_notify(new.receiver_id, 'message', 'New message from ' || sender_name,
    left(preview, 160),
    jsonb_build_object('partner_id', new.sender_id::text, 'partner_name', sender_name),
    'chat:' || new.sender_id::text);
  return new;
exception when others then
  raise warning 'Could not add message notification for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists buysell_notify_new_message on public.messages;
create trigger buysell_notify_new_message
after insert on public.messages
for each row execute function public.buysell_notify_new_message();

-- Hand each new or refreshed notification to the phone-alert function.
create or replace function public.buysell_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  api_key text;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets
    where name = 'buysell_anon_key'
    limit 1;
  if api_key is null then
    raise warning 'Phone alert for notification % not sent: add the buysell_anon_key secret to Vault.', new.id;
    return new;
  end if;
  perform net.http_post(
    url := 'https://tqxljdkavljlythspeej.supabase.co/functions/v1/deliver-notification',
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key,
      'apikey', api_key
    )
  );
  return new;
exception when others then
  -- A phone alert that cannot be queued must never stop an order or a message.
  raise warning 'Could not queue phone alert for notification %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists buysell_push_notification on public.notifications;
create trigger buysell_push_notification
after insert or update of pushed_at, created_at on public.notifications
for each row when (new.pushed_at is null)
execute function public.buysell_push_notification();

-- Live updates for the bell on the site.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
