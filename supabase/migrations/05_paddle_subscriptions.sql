-- ChoreMatrix Database Migration: Paddle Sandbox Subscriptions & Webhook Idempotency
-- Target: Supabase Postgres
-- Description:
-- Adds Paddle subscription lifecycle tracking, provider state mapping, and idempotent webhook logging.

-- 1. Extend Profiles Table with Paddle-specific Columns
alter table public.profiles add column if not exists paddle_customer_id text;
alter table public.profiles add column if not exists paddle_subscription_id text;

-- 2. Paddle Subscriptions Table (Tracks Paddle subscription lifecycle)
create table if not exists public.paddle_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  subscription_id text unique not null,
  customer_id text not null,
  price_id text not null,
  product_id text not null,
  plan_tier text not null default 'pro',
  status text not null, -- 'trialing', 'active', 'past_due', 'paused', 'canceled'
  billing_interval text not null default 'monthly',
  has_trial boolean not null default false,
  trial_ends_at timestamptz,
  scheduled_change timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Webhook Events Table (Ensures strict signature verification & idempotency)
create table if not exists public.paddle_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text unique not null,
  event_type text not null,
  subscription_id text,
  customer_id text,
  processed_at timestamptz not null default now(),
  payload jsonb not null default '{}'
);

-- 4. Enable Row Level Security (RLS)
alter table public.paddle_subscriptions enable row level security;
alter table public.paddle_webhook_events enable row level security;

-- 5. RLS Policies
-- Users can view their own subscriptions
drop policy if exists "Users can view own paddle subscriptions" on public.paddle_subscriptions;
create policy "Users can view own paddle subscriptions"
  on public.paddle_subscriptions for select
  using (auth.uid() = user_id);

-- Webhook events table is internal: accessible only by service_role
-- No public or authenticated policies needed.

-- 6. Table Privileges
grant select on public.paddle_subscriptions to authenticated;
grant all on public.paddle_subscriptions to service_role;
grant all on public.paddle_webhook_events to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 7. Durable Invariant: Ensure prevent_trial_reset trigger exists and protects profiles.trial_consumed
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
