alter table public.profiles
add column if not exists push_subscription_token text;
