alter table public.profiles
add column if not exists login_count integer not null default 0;

alter table public.profiles
add column if not exists last_login_at timestamptz;

alter table public.profiles
add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_idx
on public.profiles (last_seen_at desc);
