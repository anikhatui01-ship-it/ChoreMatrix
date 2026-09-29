-- ChoreMatrix Database Migration: Cashfree Sandbox Subscriptions & Webhook Idempotency
-- Target: Supabase Postgres
-- Description:
-- Adds subscription lifecycle tracking, verified plan state mapping, and idempotent webhook logging.

-- 1. Extend Profiles Table with Subscription State Columns
alter table public.profiles add column if not exists billing_interval text;
alter table public.profiles add column if not exists subscription_status text default 'none';
alter table public.profiles add column if not exists cashfree_subscription_id text;
alter table public.profiles add column if not exists current_period_start timestamptz;
alter table public.profiles add column if not exists current_period_end timestamptz;
alter table public.profiles add column if not exists trial_consumed boolean not null default false;
alter table public.profiles add column if not exists trial_started_at timestamptz;
alter table public.profiles add column if not exists trial_ends_at timestamptz;

-- 2. Cashfree Subscriptions Table (Tracks mandate lifecycle)
create table if not exists public.cashfree_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  subscription_id text unique not null,
  plan_id text not null,
  plan_tier text not null check (plan_tier in ('pro', 'plus')),
  billing_interval text not null check (billing_interval in ('monthly', 'annually')),
  status text not null default 'INITIALIZED',
  subscription_session_id text,
  customer_phone text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Webhook Events Table (Ensures strict signature verification & idempotency)
create table if not exists public.cashfree_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text unique not null,
  subscription_id text,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload jsonb not null default '{}'
);

-- 4. Enable Row Level Security (RLS)
alter table public.cashfree_subscriptions enable row level security;
alter table public.cashfree_webhook_events enable row level security;

-- 5. RLS Policies
-- Users can view their own subscriptions
drop policy if exists "Users can view own subscriptions" on public.cashfree_subscriptions;
create policy "Users can view own subscriptions"
  on public.cashfree_subscriptions for select
  using (auth.uid() = user_id);

-- Webhook events table is internal: accessible only by backend / service_role. No public or authenticated policies needed.

-- 6. Table Privileges
grant select on public.cashfree_subscriptions to authenticated;
grant all on public.cashfree_subscriptions to service_role;
grant all on public.cashfree_webhook_events to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 7. Subscription Table Extensions (idempotent for existing instances)
alter table public.cashfree_subscriptions add column if not exists has_trial boolean not null default false;
alter table public.cashfree_subscriptions add column if not exists first_charge_date timestamptz;

-- 8. Durable Invariant: Once trial_consumed is true, it can never be reset to false
create or replace function public.prevent_trial_reset()
returns trigger as $$
begin
  if OLD.trial_consumed = true and NEW.trial_consumed = false then
    NEW.trial_consumed := true;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_prevent_trial_reset on public.profiles;
create trigger trg_prevent_trial_reset
  before update on public.profiles
  for each row
  execute function public.prevent_trial_reset();
