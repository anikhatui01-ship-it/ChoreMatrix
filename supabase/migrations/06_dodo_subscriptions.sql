-- ChoreMatrix Database Migration: Dodo Payments Test Mode Subscriptions & Webhook Idempotency
-- Target: Supabase Postgres
-- Description:
-- Adds Dodo Payments subscription lifecycle tracking, customer mapping, and idempotent webhook logging.

-- 1. Extend Profiles Table with Dodo Customer and Subscription Identifiers
alter table public.profiles add column if not exists dodo_customer_id text;
alter table public.profiles add column if not exists dodo_subscription_id text;

-- 2. Dodo Subscriptions Table (Tracks Dodo subscription lifecycle in test mode & beyond)
create table if not exists public.dodo_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  subscription_id text unique not null,
  customer_id text not null,
  product_id text not null,
  price_id text,
  plan_tier text not null default 'pro',
  status text not null, -- 'trialing', 'active', 'past_due', 'paused', 'canceled', 'failed'
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

-- 3. Webhook Events Table (Ensures strict Standard Webhooks/Svix signature verification & idempotency)
create table if not exists public.dodo_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text unique not null,
  event_type text not null,
  subscription_id text,
  customer_id text,
  processed_at timestamptz not null default now(),
  payload jsonb not null default '{}'
);

-- 4. Enable Row Level Security (RLS)
alter table public.dodo_subscriptions enable row level security;
alter table public.dodo_webhook_events enable row level security;

-- 5. RLS Policies
-- Users can view their own subscriptions
drop policy if exists "Users can view own dodo subscriptions" on public.dodo_subscriptions;
create policy "Users can view own dodo subscriptions"
  on public.dodo_subscriptions for select
  using (auth.uid() = user_id);

-- Webhook events table is internal: accessible only by service_role
-- No public or authenticated policies needed.

-- 6. Table Privileges
grant select on public.dodo_subscriptions to authenticated;
grant all on public.dodo_subscriptions to service_role;
grant all on public.dodo_webhook_events to service_role;
grant all on public.profiles to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 7. Indexes for Performance & Relational Integrity
create index if not exists idx_dodo_subscriptions_user_id on public.dodo_subscriptions(user_id);
create index if not exists idx_dodo_subscriptions_customer_id on public.dodo_subscriptions(customer_id);
create index if not exists idx_dodo_webhook_events_subscription_id on public.dodo_webhook_events(subscription_id);
create index if not exists idx_profiles_dodo_customer_id on public.profiles(dodo_customer_id);
create index if not exists idx_profiles_dodo_subscription_id on public.profiles(dodo_subscription_id);

-- 8. Durable Invariant: Protect profiles entitlement and subscription columns against client tampering
create or replace function public.protect_profile_entitlements()
returns trigger as $$
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
    if NEW.paddle_subscription_id is distinct from OLD.paddle_subscription_id then
      NEW.paddle_subscription_id := OLD.paddle_subscription_id;
    end if;
    if NEW.paddle_customer_id is distinct from OLD.paddle_customer_id then
      NEW.paddle_customer_id := OLD.paddle_customer_id;
    end if;
    if NEW.dodo_subscription_id is distinct from OLD.dodo_subscription_id then
      NEW.dodo_subscription_id := OLD.dodo_subscription_id;
    end if;
    if NEW.dodo_customer_id is distinct from OLD.dodo_customer_id then
      NEW.dodo_customer_id := OLD.dodo_customer_id;
    end if;
    if NEW.provider_subscription_id is distinct from OLD.provider_subscription_id then
      NEW.provider_subscription_id := OLD.provider_subscription_id;
    end if;
    if NEW.payment_provider is distinct from OLD.payment_provider then
      NEW.payment_provider := OLD.payment_provider;
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_protect_profile_entitlements on public.profiles;
create trigger trg_protect_profile_entitlements
  before update on public.profiles
  for each row
  execute function public.protect_profile_entitlements();
