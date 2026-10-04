-- ChoreMatrix Database Migration: Standardize on Dodo Payments & Cleanup Legacy Payment Providers
-- Target: Supabase Postgres
-- Description:
-- Drops legacy payment provider tables (Cashfree, Razorpay, Paddle) and cleans up legacy profile columns
-- while preserving Dodo Payments tables, indexes, triggers, and Row Level Security.

-- 1. Drop Legacy Payment Provider Tables Safely (CASCADE drops associated legacy policies and indexes)
drop table if exists public.paddle_webhook_events cascade;
drop table if exists public.paddle_subscriptions cascade;
drop table if exists public.razorpay_webhook_events cascade;
drop table if exists public.razorpay_subscriptions cascade;
drop table if exists public.cashfree_webhook_events cascade;
drop table if exists public.cashfree_subscriptions cascade;

-- 2. Drop Legacy Profile Columns If They Exist
alter table public.profiles drop column if exists paddle_subscription_id;
alter table public.profiles drop column if exists paddle_customer_id;
alter table public.profiles drop column if exists provider_subscription_id;

-- 3. Update Durable Entitlement Protection Trigger Function (Dodo Payments Only)
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
$$ language plpgsql security definer;

-- 4. Re-attach Entitlement Protection Trigger
drop trigger if exists trg_protect_profile_entitlements on public.profiles;
create trigger trg_protect_profile_entitlements
  before update on public.profiles
  for each row
  execute function public.protect_profile_entitlements();
