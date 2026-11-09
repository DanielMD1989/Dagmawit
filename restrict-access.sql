-- ============================================================
--  ATELIER money app — allow ONLY your two accounts
--
--  Why: the old rules let ANY signed-in account read and change
--  the business data. If sign-ups are open, a stranger could
--  create an account and see or wipe the books.
--
--  How to use:
--  1. Replace the two example emails below with the two real
--     sign-in emails (keep the quotes). Lower or upper case is fine.
--  2. Supabase → SQL Editor → New query → paste all of this → Run.
--  3. Supabase → Authentication → Sign In / Providers →
--     turn OFF "Allow new users to sign up".
--  It is safe to run this again later (for example to change an email).
-- ============================================================

create or replace function public.is_team()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    lower('first.person@example.com'),     -- <-- email 1
    lower('second.person@example.com')     -- <-- email 2
  );
$$;

-- remove the old "any signed-in user" rules
drop policy if exists "authenticated read"   on public.business_data;
drop policy if exists "authenticated write"  on public.business_data;
drop policy if exists "authenticated insert" on public.business_data;
drop policy if exists "authenticated update" on public.business_data;
drop policy if exists "team read"   on public.business_data;
drop policy if exists "team insert" on public.business_data;
drop policy if exists "team update" on public.business_data;

alter table public.business_data enable row level security;

create policy "team read"   on public.business_data for select to authenticated using (public.is_team());
create policy "team insert" on public.business_data for insert to authenticated with check (public.is_team());
create policy "team update" on public.business_data for update to authenticated using (public.is_team()) with check (public.is_team());

-- Check: this should list exactly the three "team" rules.
select policyname, cmd from pg_policies where tablename = 'business_data';
