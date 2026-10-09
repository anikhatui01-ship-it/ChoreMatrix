-- ChoreMatrix Database Migration 08: User Feedback Submissions
-- Target: Supabase Postgres
-- Description:
-- Creates the user_feedback table with strict RLS policies.
-- Allows authenticated and anonymous users to securely INSERT early feedback.
-- Disallows public/anonymous SELECT (feedback is strictly private and viewable only by authorized admins / service_role).

-- 1. Create table
create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  household_type text not null,
  experience_rating smallint check (experience_rating is null or (experience_rating >= 1 and experience_rating <= 5)),
  useful_feedback text check (useful_feedback is null or length(useful_feedback) <= 2000),
  confusing_feedback text check (confusing_feedback is null or length(confusing_feedback) <= 2000),
  improvement_feedback text check (improvement_feedback is null or length(improvement_feedback) <= 2000),
  email text check (email is null or length(email) <= 255),
  allow_quote boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. Enable Row Level Security (RLS)
alter table public.user_feedback enable row level security;

-- 3. Grant Privileges
grant insert on public.user_feedback to anon, authenticated;

-- 4. RLS Insert Policy
drop policy if exists "Allow insert feedback for anyone" on public.user_feedback;
create policy "Allow insert feedback for anyone"
  on public.user_feedback for insert
  with check (
    -- If user_id is provided, it must match auth.uid(). If anonymous, user_id must be null.
    (auth.uid() is null and user_id is null) or (auth.uid() is not null and (user_id = auth.uid() or user_id is null))
  );

-- 5. Note on Select / Read Access:
-- No SELECT policy is granted to anon or regular authenticated users.
-- Submissions remain completely private and accessible only to the project owner via Supabase Dashboard / service_role.
