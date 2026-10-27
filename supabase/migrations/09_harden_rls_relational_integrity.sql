-- ChoreMatrix Database Migration 09: Relational Integrity & RLS Hardening
-- Target: Supabase Postgres
-- Description:
-- 1. Enforces strict relational foreign-key ownership across all child tables (members, tasks,
--    member_preferences, plans) preventing Insecure Direct Object References (IDOR) where a user
--    could attempt to insert or associate records under another user's household ID.
-- 2. Hardens SECURITY DEFINER trigger functions with explicit immutable search_path to prevent
--    search_path injection attacks.

-- ========================================================
-- 1. HARDEN SECURITY DEFINER FUNCTIONS WITH EXPLICIT SEARCH_PATH
-- ========================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create or replace function public.protect_profile_entitlements()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  -- Prevent trial reset under all callers
  if OLD.trial_consumed = true and NEW.trial_consumed = false then
    NEW.trial_consumed := true;
  end if;

  -- Block client-side privilege escalation from authenticated user role
  if (auth.jwt() ->> 'role') = 'authenticated' or current_user = 'authenticated' then
    if NEW.plan_tier is distinct from OLD.plan_tier then
      NEW.plan_tier := OLD.plan_tier;
    end if;
    if NEW.subscription_status is distinct from OLD.subscription_status then
      NEW.subscription_status := OLD.subscription_status;
    end if;
    if NEW.trial_consumed is distinct from OLD.trial_consumed then
      NEW.trial_consumed := OLD.trial_consumed;
    end if;
    if NEW.trial_ends_at is distinct from OLD.trial_ends_at then
      NEW.trial_ends_at := OLD.trial_ends_at;
    end if;
    if NEW.dodo_subscription_id is distinct from OLD.dodo_subscription_id then
      NEW.dodo_subscription_id := OLD.dodo_subscription_id;
    end if;
    if NEW.dodo_customer_id is distinct from OLD.dodo_customer_id then
      NEW.dodo_customer_id := OLD.dodo_customer_id;
    end if;
    if NEW.payment_provider is distinct from OLD.payment_provider then
      NEW.payment_provider := OLD.payment_provider;
    end if;
  end if;

  return NEW;
end;
$$;

-- ========================================================
-- 2. HARDEN RLS POLICIES WITH STRICT RELATIONAL BOUNDARIES
-- ========================================================

-- Members: Must belong to auth.uid() AND household owned by auth.uid()
drop policy if exists "Users can insert own members" on public.members;
create policy "Users can insert own members"
  on public.members for insert
  with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own members" on public.members;
create policy "Users can update own members"
  on public.members for update
  using (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  );

-- Tasks: Must belong to auth.uid() AND household owned by auth.uid()
drop policy if exists "Users can insert own tasks" on public.tasks;
create policy "Users can insert own tasks"
  on public.tasks for insert
  with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own tasks" on public.tasks;
create policy "Users can update own tasks"
  on public.tasks for update
  using (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  );

-- Member Preferences: Must belong to auth.uid() AND household, member, task owned by auth.uid()
drop policy if exists "Users can insert own member preferences" on public.member_preferences;
create policy "Users can insert own member preferences"
  on public.member_preferences for insert
  with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    ) and
    exists (
      select 1 from public.members m
      where m.id = member_id and m.user_id = auth.uid()
    ) and
    exists (
      select 1 from public.tasks t
      where t.id = task_id and t.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own member preferences" on public.member_preferences;
create policy "Users can update own member preferences"
  on public.member_preferences for update
  using (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  );

-- Plans: Must belong to auth.uid() AND household owned by auth.uid()
drop policy if exists "Users can insert own plans" on public.plans;
create policy "Users can insert own plans"
  on public.plans for insert
  with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own plans" on public.plans;
create policy "Users can update own plans"
  on public.plans for update
  using (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id and
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  );
