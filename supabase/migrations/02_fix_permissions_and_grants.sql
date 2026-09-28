-- ChoreMatrix Database Fix: Grant Authenticated Privileges & Complete RLS Policies
-- Target: Supabase Postgres
-- Description:
-- Fixes "permission denied for table households" (Postgres error 42501).
-- PostgreSQL requires table-level GRANTs for the 'authenticated' role so that
-- queries can proceed to Row Level Security (RLS) evaluation.
-- RLS ensures authenticated users can ONLY access rows where auth.uid() = user_id.

-- 1. Ensure Schema Usage
grant usage on schema public to anon, authenticated;

-- 2. Grant Table Privileges to Authenticated Role
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.households to authenticated;
grant select, insert, update, delete on public.members to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.member_preferences to authenticated;
grant select, insert, update, delete on public.plans to authenticated;
grant select, insert, update, delete on public.user_privacy_preferences to authenticated;

-- 3. Grant Sequence Privileges
grant usage, select on all sequences in schema public to authenticated;

-- 4. Configure Default Privileges for Future Tables
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- 5. Complete and Verify Idempotent RLS Policies

-- Profiles
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Users can delete own profile" on public.profiles;
create policy "Users can delete own profile"
  on public.profiles for delete
  using (auth.uid() = id);

-- Households
drop policy if exists "Users can update own households" on public.households;
create policy "Users can update own households"
  on public.households for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Members
drop policy if exists "Users can update own members" on public.members;
create policy "Users can update own members"
  on public.members for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Tasks
drop policy if exists "Users can update own tasks" on public.tasks;
create policy "Users can update own tasks"
  on public.tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Member Preferences
drop policy if exists "Users can update own member preferences" on public.member_preferences;
create policy "Users can update own member preferences"
  on public.member_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Plans
drop policy if exists "Users can update own plans" on public.plans;
create policy "Users can update own plans"
  on public.plans for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
