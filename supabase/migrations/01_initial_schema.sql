-- ChoreMatrix Production Schema & Row Level Security (RLS)
-- Target: Supabase Postgres

-- 1. Profiles (syncs with auth.users)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  plan_tier text not null default 'free',
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Households (Top-level container owned by auth.users)
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  type text not null default 'family',
  mode text not null default 'capacity_aware',
  planning_horizon_weeks int not null default 4,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Household Members
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  role text not null default 'Adult',
  weekly_capacity_minutes int not null check (weekly_capacity_minutes > 0),
  unavailable_days text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Tasks
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  category text not null default 'General',
  frequency_per_week int not null check (frequency_per_week between 1 and 14),
  duration_minutes int not null check (duration_minutes > 0),
  effort_level int not null check (effort_level between 1 and 5),
  fixed_days text[] not null default '{}',
  eligible_member_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Member Task Preferences
create table if not exists public.member_preferences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  member_id uuid references public.members(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete cascade not null,
  preference_type text not null check (preference_type in ('prefer', 'avoid')),
  created_at timestamptz not null default now()
);

-- 6. Generated Plans & Diagnostics
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  optimizer_version text not null default '0.1.0',
  balance_score numeric not null,
  total_work_minutes int not null,
  total_capacity_minutes int not null,
  diagnostics jsonb not null default '{}',
  member_summaries jsonb not null default '[]',
  unassigned_tasks jsonb not null default '[]',
  assignments jsonb not null default '[]',
  diff_summary text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- 7. User Privacy & Consent
create table if not exists public.user_privacy_preferences (
  user_id uuid references auth.users(id) on delete cascade primary key,
  preferences_consent boolean not null default true,
  analytics_consent boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ========================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ========================================================

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.tasks enable row level security;
alter table public.member_preferences enable row level security;
alter table public.plans enable row level security;
alter table public.user_privacy_preferences enable row level security;

-- Profiles: Users can only read/update/delete their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can delete own profile"
  on public.profiles for delete
  using (auth.uid() = id);

-- Households: Users can only CRUD their own households
create policy "Users can view own households"
  on public.households for select
  using (auth.uid() = user_id);

create policy "Users can create own households"
  on public.households for insert
  with check (auth.uid() = user_id);

create policy "Users can update own households"
  on public.households for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own households"
  on public.households for delete
  using (auth.uid() = user_id);

-- Members: Users can only CRUD members belonging to their households
create policy "Users can view own members"
  on public.members for select
  using (auth.uid() = user_id);

create policy "Users can insert own members"
  on public.members for insert
  with check (auth.uid() = user_id);

create policy "Users can update own members"
  on public.members for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own members"
  on public.members for delete
  using (auth.uid() = user_id);

-- Tasks: Users can only CRUD tasks belonging to their households
create policy "Users can view own tasks"
  on public.tasks for select
  using (auth.uid() = user_id);

create policy "Users can insert own tasks"
  on public.tasks for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tasks"
  on public.tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own tasks"
  on public.tasks for delete
  using (auth.uid() = user_id);

-- Member Preferences: Users can only CRUD preferences belonging to their households
create policy "Users can view own member preferences"
  on public.member_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert own member preferences"
  on public.member_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own member preferences"
  on public.member_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own member preferences"
  on public.member_preferences for delete
  using (auth.uid() = user_id);

-- Plans: Users can only view/create/delete their own generated plans
create policy "Users can view own plans"
  on public.plans for select
  using (auth.uid() = user_id);

create policy "Users can insert own plans"
  on public.plans for insert
  with check (auth.uid() = user_id);

create policy "Users can update own plans"
  on public.plans for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own plans"
  on public.plans for delete
  using (auth.uid() = user_id);

-- User Privacy Preferences
create policy "Users can view own privacy preferences"
  on public.user_privacy_preferences for select
  using (auth.uid() = user_id);

create policy "Users can upsert own privacy preferences"
  on public.user_privacy_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ========================================================
-- PERMISSIONS & TABLE PRIVILEGES (GRANTS)
-- ========================================================
-- In PostgreSQL, RLS policies are applied AFTER table-level privileges are checked.
-- Authenticated users must be granted table privileges so that PostgREST queries
-- can be evaluated against the RLS policies instead of failing with 42501 permission denied.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.households to authenticated;
grant select, insert, update, delete on public.members to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.member_preferences to authenticated;
grant select, insert, update, delete on public.plans to authenticated;
grant select, insert, update, delete on public.user_privacy_preferences to authenticated;

grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;


-- ========================================================
-- HELPER FUNCTIONS & TRIGGERS
-- ========================================================

-- Trigger to create a profile automatically on auth.users sign up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
