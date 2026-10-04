/**
 * ChoreMatrix Dodo Payments Subscriptions Configuration (Test Mode Only)
 *
 * CANONICAL PLAN MATRIX:
 * 1. Pro Monthly   ($5.99/mo, 7-day trial for eligible new users)
 * 2. Pro Annual    ($59.99/yr, 7-day trial for eligible new users)
 * 3. Plus Monthly  ($9.99/mo, 7-day trial for eligible new users)
 * 4. Plus Annual   ($99.99/yr, 7-day trial for eligible new users)
 *
 * STRICT MAPPING - NO SILENT FALLBACKS:
 * Plan and interval selection must be explicit. Invalid or missing
 * parameters throw an explicit Error.
 */

import { getEnvVar } from './supabase.ts';

export type DodoEnvironment = 'test_mode' | 'live_mode';
export type PlanTier = 'pro' | 'plus';
export type BillingInterval = 'monthly' | 'annual';

export interface CanonicalDodoPlanDefinition {
  tier: PlanTier;
  interval: BillingInterval;
  displayAmount: number;
  productId: string;
  trialDurationDays: number;
}

export interface DodoProductDefinition {
  productId: string;
  planName: string;
  tier: PlanTier;
  interval: BillingInterval;
  currency: string;
  amount: number;        // In USD dollars (e.g. 5.99)
  amountInCents: number; // In cents (e.g. 599)
  trialDays: number;
}

export const DODO_SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'paused',
  'canceled',
  'failed'
] as const;

export type DodoSubscriptionStatus = typeof DODO_SUBSCRIPTION_STATUSES[number];

/**
 * 1. Canonical Plan Matrix for all 4 subscription tiers and intervals.
 * Uses exact Dodo Test Mode catalog IDs with environment variable overrides.
 */
export const CANONICAL_DODO_PLAN_MATRIX: Record<`${PlanTier}_${BillingInterval}`, CanonicalDodoPlanDefinition> = {
  pro_monthly: {
    tier: 'pro',
    interval: 'monthly',
    displayAmount: 5.99,
    productId: getEnvVar('VITE_DODO_PRO_MONTHLY_PRODUCT_ID') || 'pdt_0NozKZ3sZ6h0vplb451YK',
    trialDurationDays: 7
  },
  pro_annual: {
    tier: 'pro',
    interval: 'annual',
    displayAmount: 59.99,
    productId: getEnvVar('VITE_DODO_PRO_ANNUAL_PRODUCT_ID') || 'pdt_0NozL7OvhpMonCSMw99Ng',
    trialDurationDays: 7
  },
  plus_monthly: {
    tier: 'plus',
    interval: 'monthly',
    displayAmount: 9.99,
    productId: getEnvVar('VITE_DODO_PLUS_MONTHLY_PRODUCT_ID') || 'pdt_0NozLK4XCjDSCbkADEtQL',
    trialDurationDays: 7
  },
  plus_annual: {
    tier: 'plus',
    interval: 'annual',
    displayAmount: 99.99,
    productId: getEnvVar('VITE_DODO_PLUS_ANNUAL_PRODUCT_ID') || 'pdt_0NozLba96vBrtNtGdFONX',
    trialDurationDays: 7
  }
} as const;

export const DODO_CONFIG = {
  environment: (getEnvVar('VITE_DODO_ENV') || getEnvVar('VITE_DODO_ENVIRONMENT') || 'test_mode') as DodoEnvironment,
  currency: 'USD',
  trialDays: 7,
  companyName: 'ChoreMatrix',
  productionReturnDomain: 'https://chorematrix.online',
  plans: CANONICAL_DODO_PLAN_MATRIX
} as const;

/**
 * 2. Canonical Map of recognized Dodo product IDs to their metadata.
 */
export const DODO_PRODUCTS: Record<string, DodoProductDefinition> = {
  [CANONICAL_DODO_PLAN_MATRIX.pro_monthly.productId]: {
    productId: CANONICAL_DODO_PLAN_MATRIX.pro_monthly.productId,
    planName: 'ChoreMatrix Pro Monthly',
    tier: 'pro',
    interval: 'monthly',
    currency: 'USD',
    amount: 5.99,
    amountInCents: 599,
    trialDays: 7
  },
  [CANONICAL_DODO_PLAN_MATRIX.pro_annual.productId]: {
    productId: CANONICAL_DODO_PLAN_MATRIX.pro_annual.productId,
    planName: 'ChoreMatrix Pro Annual',
    tier: 'pro',
    interval: 'annual',
    currency: 'USD',
    amount: 59.99,
    amountInCents: 5999,
    trialDays: 7
  },
  [CANONICAL_DODO_PLAN_MATRIX.plus_monthly.productId]: {
    productId: CANONICAL_DODO_PLAN_MATRIX.plus_monthly.productId,
    planName: 'ChoreMatrix Plus Monthly',
    tier: 'plus',
    interval: 'monthly',
    currency: 'USD',
    amount: 9.99,
    amountInCents: 999,
    trialDays: 7
  },
  [CANONICAL_DODO_PLAN_MATRIX.plus_annual.productId]: {
    productId: CANONICAL_DODO_PLAN_MATRIX.plus_annual.productId,
    planName: 'ChoreMatrix Plus Annual',
    tier: 'plus',
    interval: 'annual',
    currency: 'USD',
    amount: 99.99,
    amountInCents: 9999,
    trialDays: 7
  }
};

/**
 * Normalizes input plan string to canonical PlanTier ('pro' | 'plus').
 * Throws explicit Error on missing or invalid input.
 */
export function normalizePlanTier(plan: string | null | undefined): PlanTier {
  if (!plan || typeof plan !== 'string') {
    throw new Error('Missing plan parameter: plan must be "pro" or "plus".');
  }
  const clean = plan.trim().toLowerCase();
  if (clean === 'pro' || clean === 'household_pro') {
    return 'pro';
  }
  if (clean === 'plus' || clean === 'household_plus' || clean === 'family_plus') {
    return 'plus';
  }
  throw new Error(`Invalid plan "${plan}": supported plans are "pro" and "plus".`);
}

/**
 * Normalizes input interval string to canonical BillingInterval ('monthly' | 'annual').
 * Throws explicit Error on missing or invalid input.
 */
export function normalizeBillingInterval(interval: string | null | undefined): BillingInterval {
  if (!interval || typeof interval !== 'string') {
    throw new Error('Missing interval parameter: interval must be "monthly" or "annual".');
  }
  const clean = interval.trim().toLowerCase();
  if (clean === 'monthly' || clean === 'month') {
    return 'monthly';
  }
  if (clean === 'annual' || clean === 'annually' || clean === 'yearly' || clean === 'year') {
    return 'annual';
  }
  throw new Error(`Invalid interval "${interval}": supported intervals are "monthly" and "annual".`);
}

/**
 * Returns the exact Dodo product ID based on plan and interval.
 *
 * ABSOLUTELY NO SILENT FALLBACK:
 * Missing or invalid plan/interval parameters throw an explicit Error.
 */
export function getDodoProductId(
  plan: string,
  interval: string
): string {
  const normPlan = normalizePlanTier(plan);
  const normInterval = normalizeBillingInterval(interval);
  const key = `${normPlan}_${normInterval}` as const;
  const config = CANONICAL_DODO_PLAN_MATRIX[key];
  if (!config) {
    throw new Error(`No canonical Dodo configuration found for plan "${plan}" and interval "${interval}".`);
  }
  return config.productId;
}

/**
 * Validates whether a product ID is an allowlisted ChoreMatrix Dodo product.
 */
export function isDodoProductId(productId: string | null | undefined): boolean {
  if (!productId || typeof productId !== 'string') return false;
  const clean = productId.trim();
  return Boolean(DODO_PRODUCTS[clean]);
}

/**
 * Maps a Dodo product ID to plan tier and interval metadata.
 * Returns null if the product ID is unrecognized.
 * ABSOLUTELY NO SILENT FALLBACK.
 */
export function mapDodoProductToTier(productId: string | null | undefined): {
  tier: PlanTier;
  interval: BillingInterval;
  amount: number;
  trialDays: number;
} | null {
  if (!productId || typeof productId !== 'string') return null;
  const clean = productId.trim();
  const prod = DODO_PRODUCTS[clean];
  if (prod) {
    return {
      tier: prod.tier,
      interval: prod.interval,
      amount: prod.amount,
      trialDays: prod.trialDays
    };
  }
  return null;
}
