-- ChoreMatrix Database Migration: Razorpay Subscriptions & Webhook Idempotency
-- Target: Supabase Postgres
-- Description:
-- Adds Razorpay subscription lifecycle tracking, provider-neutral fields, and idempotent webhook logging.
-- Preserves existing Cashfree historical records and schema.

-- 1. Extend Profiles Table with Razorpay / Provider-Neutral Subscription Columns
alter table public.profiles add column if not exists razorpay_subscription_id text;
alter table public.profiles add column if not exists razorpay_customer_id text;
alter table public.profiles add column if not exists payment_provider text default 'razorpay';
alter table public.profiles add column if not exists provider_subscription_id text;

-- 2. Razorpay Subscriptions Table (Tracks mandate and subscription lifecycle)
create table if not exists public.razorpay_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  subscription_id text unique not null,
  plan_id text not null,
  plan_tier text not null check (plan_tier in ('pro', 'plus')),
  billing_interval text not null check (billing_interval in ('monthly', 'annually')),
  status text not null default 'INITIALIZED',
  customer_email text,
  customer_phone text,
  has_trial boolean not null default false,
  first_charge_date timestamptz,
  payment_provider text not null default 'razorpay',
  provider_subscription_id text,
  provider_plan_id text,
  provider_customer_id text,
  provider_payment_id text,
  short_url text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Webhook Events Table (Ensures strict signature verification & idempotency)
create table if not exists public.razorpay_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text unique not null,
  subscription_id text,
  payment_id text,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload jsonb not null default '{}'
);

-- 4. Enable Row Level Security (RLS)
alter table public.razorpay_subscriptions enable row level security;
alter table public.razorpay_webhook_events enable row level security;

-- 5. RLS Policies
-- Users can view their own subscriptions
drop policy if exists "Users can view own razorpay subscriptions" on public.razorpay_subscriptions;
create policy "Users can view own razorpay subscriptions"
  on public.razorpay_subscriptions for select
  using (auth.uid() = user_id);

-- Webhook events table is internal: accessible only by backend / service_role.

-- 6. Table Privileges
grant select on public.razorpay_subscriptions to authenticated;
grant all on public.razorpay_subscriptions to service_role;
grant all on public.razorpay_webhook_events to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 7. Ensure prevent_trial_reset trigger exists and protects profiles.trial_consumed
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
