-- ============================================================
--  ATELIER — database setup
--  Paste this whole file into Supabase: SQL Editor → New query → Run
--  It creates one shared table for your business data and locks
--  it so only signed-in users (you and your partner) can read/write.
-- ============================================================

-- 1) The table that holds your whole business as one JSON document
create table if not exists public.business_data (
  id text primary key,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) Turn on Row Level Security
alter table public.business_data enable row level security;

-- 3) Allow any signed-in (authenticated) user to read and write.
--    Since only you and your partner will have accounts, this means
--    just the two of you share the data.
drop policy if exists "authenticated read"  on public.business_data;
drop policy if exists "authenticated write" on public.business_data;
drop policy if exists "authenticated insert" on public.business_data;
drop policy if exists "authenticated update" on public.business_data;

create policy "authenticated read"
  on public.business_data for select
  to authenticated using (true);

create policy "authenticated insert"
  on public.business_data for insert
  to authenticated with check (true);

create policy "authenticated update"
  on public.business_data for update
  to authenticated using (true) with check (true);

-- 4) Let live sync (realtime) broadcast changes to both devices
alter publication supabase_realtime add table public.business_data;

-- 5) IMPORTANT for live sync: make realtime include the full changed row
--    Without this, the other phone gets an empty update and won't refresh
--    until the app is reopened. This fixes that.
alter table public.business_data replica identity full;

