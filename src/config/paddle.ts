/**
 * ChoreMatrix Paddle Subscriptions Configuration (Sandbox)
 *
 * CANONICAL PLAN MATRIX:
 * 1. Pro Monthly   ($5.99/mo, 7-day trial or standard)
 * 2. Pro Annual    ($59.99/yr, 7-day trial or standard)
 * 3. Plus Monthly  ($9.99/mo, 7-day trial or standard)
 * 4. Plus Annual   ($99.99/yr, 7-day trial or standard)
 *
 * NO SILENT FALLBACKS:
 * Plan and interval selection must be explicit. Invalid or missing
 * parameters throw an explicit Error.
 */

import { getEnvVar } from './supabase.ts';

export type PaddleEnvironment = 'sandbox' | 'production';
export type PlanTier = 'pro' | 'plus';
export type BillingInterval = 'monthly' | 'annual';

export interface CanonicalPlanDefinition {
  tier: PlanTier;
  interval: BillingInterval;
  displayAmount: number;
  productId: string;
  trialPriceId: string;
  noTrialPriceId: string;
  trialDurationDays: number;
}

export interface PaddlePlanDefinition {
  priceId: string;
  productId: string;
  planName: string;
  tier: PlanTier;
  interval: BillingInterval;
  currency: string;
  amount: number;        // In USD dollars (e.g. 5.99)
  amountInCents: number; // In cents (e.g. 599)
  hasTrial: boolean;
  trialDays: number;
}

export const PADDLE_SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'paused',
  'canceled'
] as const;

export type PaddleSubscriptionStatus = typeof PADDLE_SUBSCRIPTION_STATUSES[number];

/**
 * 1. Canonical Plan Matrix for all 4 subscription tiers and intervals.
 * Uses exact Paddle Sandbox catalog IDs.
 */
export const CANONICAL_PLAN_MATRIX: Record<`${PlanTier}_${BillingInterval}`, CanonicalPlanDefinition> = {
  pro_monthly: {
    tier: 'pro',
    interval: 'monthly',
    displayAmount: 5.99,
    productId: getEnvVar('VITE_PADDLE_PRO_MONTHLY_PRODUCT_ID') || 'pro_01m3q8bc75wg442x3h217njd0k',
    trialPriceId: getEnvVar('VITE_PADDLE_PRO_MONTHLY_TRIAL_PRICE_ID') || getEnvVar('VITE_PADDLE_TRIAL_PRICE_ID') || 'pri_01m3q8bcndadvqgz9jbr26pmw3',
    noTrialPriceId: getEnvVar('VITE_PADDLE_PRO_MONTHLY_STANDARD_PRICE_ID') || getEnvVar('VITE_PADDLE_STANDARD_PRICE_ID') || 'pri_01m3q8bcwn953t664zt4e9071z',
    trialDurationDays: 7
  },
  pro_annual: {
    tier: 'pro',
    interval: 'annual',
    displayAmount: 59.99,
    productId: getEnvVar('VITE_PADDLE_PRO_ANNUAL_PRODUCT_ID') || 'pro_01m3rbzjm8h0t0np80k7nqfz85',
    trialPriceId: getEnvVar('VITE_PADDLE_PRO_ANNUAL_TRIAL_PRICE_ID') || 'pri_01m3rc2rxpbwq45kpjbdc124ph',
    noTrialPriceId: getEnvVar('VITE_PADDLE_PRO_ANNUAL_STANDARD_PRICE_ID') || 'pri_01m3rcv82ahy3nvcbgtpkvpemp',
    trialDurationDays: 7
  },
  plus_monthly: {
    tier: 'plus',
    interval: 'monthly',
    displayAmount: 9.99,
    productId: getEnvVar('VITE_PADDLE_PLUS_MONTHLY_PRODUCT_ID') || 'pro_01m3rc6mfgdq0b7fys5s3j4t98',
    trialPriceId: getEnvVar('VITE_PADDLE_PLUS_MONTHLY_TRIAL_PRICE_ID') || 'pri_01m3rc7qwjvt2ehz4p9xcsbhfq',
    noTrialPriceId: getEnvVar('VITE_PADDLE_PLUS_MONTHLY_STANDARD_PRICE_ID') || 'pri_01m3rcz5jsr2058j5e2v8zka84',
    trialDurationDays: 7
  },
  plus_annual: {
    tier: 'plus',
    interval: 'annual',
    displayAmount: 99.99,
    productId: getEnvVar('VITE_PADDLE_PLUS_ANNUAL_PRODUCT_ID') || 'pro_01m3rc42y9mdz16q2cn48q9z95',
    trialPriceId: getEnvVar('VITE_PADDLE_PLUS_ANNUAL_TRIAL_PRICE_ID') || 'pri_01m3rc5nmgzwske72g5h6dsh32',
    noTrialPriceId: getEnvVar('VITE_PADDLE_PLUS_ANNUAL_STANDARD_PRICE_ID') || 'pri_01m3rcx7d36mj5bw7wwrkg87mh',
    trialDurationDays: 7
  }
} as const;

export const PADDLE_CONFIG = {
  environment: (getEnvVar('VITE_PADDLE_ENV') || getEnvVar('VITE_PADDLE_ENVIRONMENT') || getEnvVar('PADDLE_ENV') || 'sandbox') as PaddleEnvironment,
  productId: CANONICAL_PLAN_MATRIX.pro_monthly.productId,
  trialPriceId: CANONICAL_PLAN_MATRIX.pro_monthly.trialPriceId,
  standardPriceId: CANONICAL_PLAN_MATRIX.pro_monthly.noTrialPriceId,
  prices: {
    trial: CANONICAL_PLAN_MATRIX.pro_monthly.trialPriceId,
    standard: CANONICAL_PLAN_MATRIX.pro_monthly.noTrialPriceId
  },
  clientToken: getEnvVar('VITE_PADDLE_CLIENT_TOKEN') || 'test_e0acafd60322d41b06bc1e77ad7',
  currency: 'USD',
  amount: 5.99,
  amountInCents: 599,
  trialDays: 7,
  companyName: 'ChoreMatrix',
  productionReturnDomain: 'https://chorematrix.online',
  plans: CANONICAL_PLAN_MATRIX
} as const;

/**
 * 2. Canonical Map of all 8 recognized price IDs to their exact metadata.
 */
export const PADDLE_PLANS: Record<string, PaddlePlanDefinition> = {
  // Pro Monthly
  [CANONICAL_PLAN_MATRIX.pro_monthly.trialPriceId]: {
    priceId: CANONICAL_PLAN_MATRIX.pro_monthly.trialPriceId,
    productId: CANONICAL_PLAN_MATRIX.pro_monthly.productId,
    planName: 'ChoreMatrix Pro Monthly (7-Day Trial)',
    tier: 'pro',
    interval: 'monthly',
    currency: 'USD',
    amount: 5.99,
    amountInCents: 599,
    hasTrial: true,
    trialDays: 7
  },
  [CANONICAL_PLAN_MATRIX.pro_monthly.noTrialPriceId]: {
    priceId: CANONICAL_PLAN_MATRIX.pro_monthly.noTrialPriceId,
    productId: CANONICAL_PLAN_MATRIX.pro_monthly.productId,
    planName: 'ChoreMatrix Pro Monthly (Standard / No Trial)',
    tier: 'pro',
    interval: 'monthly',
    currency: 'USD',
    amount: 5.99,
    amountInCents: 599,
    hasTrial: false,
    trialDays: 0
  },

  // Pro Annual
  [CANONICAL_PLAN_MATRIX.pro_annual.trialPriceId]: {
    priceId: CANONICAL_PLAN_MATRIX.pro_annual.trialPriceId,
    productId: CANONICAL_PLAN_MATRIX.pro_annual.productId,
    planName: 'ChoreMatrix Pro Annual (7-Day Trial)',
    tier: 'pro',
    interval: 'annual',
    currency: 'USD',
    amount: 59.99,
    amountInCents: 5999,
    hasTrial: true,
    trialDays: 7
  },
  [CANONICAL_PLAN_MATRIX.pro_annual.noTrialPriceId]: {
    priceId: CANONICAL_PLAN_MATRIX.pro_annual.noTrialPriceId,
    productId: CANONICAL_PLAN_MATRIX.pro_annual.productId,
    planName: 'ChoreMatrix Pro Annual (Standard / No Trial)',
    tier: 'pro',
    interval: 'annual',
    currency: 'USD',
    amount: 59.99,
    amountInCents: 5999,
    hasTrial: false,
    trialDays: 0
  },

  // Plus Monthly
  [CANONICAL_PLAN_MATRIX.plus_monthly.trialPriceId]: {
    priceId: CANONICAL_PLAN_MATRIX.plus_monthly.trialPriceId,
    productId: CANONICAL_PLAN_MATRIX.plus_monthly.productId,
    planName: 'ChoreMatrix Plus Monthly (7-Day Trial)',
    tier: 'plus',
    interval: 'monthly',
    currency: 'USD',
    amount: 9.99,
    amountInCents: 999,
    hasTrial: true,
    trialDays: 7
  },
  [CANONICAL_PLAN_MATRIX.plus_monthly.noTrialPriceId]: {
    priceId: CANONICAL_PLAN_MATRIX.plus_monthly.noTrialPriceId,
    productId: CANONICAL_PLAN_MATRIX.plus_monthly.productId,
    planName: 'ChoreMatrix Plus Monthly (Standard / No Trial)',
    tier: 'plus',
    interval: 'monthly',
    currency: 'USD',
    amount: 9.99,
    amountInCents: 999,
    hasTrial: false,
    trialDays: 0
  },

  // Plus Annual
  [CANONICAL_PLAN_MATRIX.plus_annual.trialPriceId]: {
    priceId: CANONICAL_PLAN_MATRIX.plus_annual.trialPriceId,
    productId: CANONICAL_PLAN_MATRIX.plus_annual.productId,
    planName: 'ChoreMatrix Plus Annual (7-Day Trial)',
    tier: 'plus',
    interval: 'annual',
    currency: 'USD',
    amount: 99.99,
    amountInCents: 9999,
    hasTrial: true,
    trialDays: 7
  },
  [CANONICAL_PLAN_MATRIX.plus_annual.noTrialPriceId]: {
    priceId: CANONICAL_PLAN_MATRIX.plus_annual.noTrialPriceId,
    productId: CANONICAL_PLAN_MATRIX.plus_annual.productId,
    planName: 'ChoreMatrix Plus Annual (Standard / No Trial)',
    tier: 'plus',
    interval: 'annual',
    currency: 'USD',
    amount: 99.99,
    amountInCents: 9999,
    hasTrial: false,
    trialDays: 0
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
 * Returns the exact Paddle price ID based on plan, interval, and trial consumption status.
 *
 * Selection rules (all 8 canonical combinations):
 * - pro + monthly + eligible   -> Pro Monthly Trial Price
 * - pro + monthly + consumed   -> Pro Monthly No-Trial Price
 * - pro + annual + eligible    -> Pro Annual Trial Price
 * - pro + annual + consumed    -> Pro Annual No-Trial Price
 * - plus + monthly + eligible  -> Plus Monthly Trial Price
 * - plus + monthly + consumed  -> Plus Monthly No-Trial Price
 * - plus + annual + eligible   -> Plus Annual Trial Price
 * - plus + annual + consumed   -> Plus Annual No-Trial Price
 *
 * ABSOLUTELY NO SILENT FALLBACK:
 * Missing or invalid plan/interval parameters throw an explicit Error.
 */
export function getPaddlePriceId(
  plan: string,
  interval: string,
  isTrialEligible = true
): string {
  const normPlan = normalizePlanTier(plan);
  const normInterval = normalizeBillingInterval(interval);
  const key = `${normPlan}_${normInterval}` as const;
  const config = CANONICAL_PLAN_MATRIX[key];
  if (!config) {
    throw new Error(`No canonical Paddle configuration found for plan "${plan}" and interval "${interval}".`);
  }
  return isTrialEligible ? config.trialPriceId : config.noTrialPriceId;
}

/**
 * Validates whether a price ID is a recognized ChoreMatrix Paddle price across all 8 canonical prices.
 */
export function isPaddlePriceId(priceId: string | null | undefined): boolean {
  if (!priceId || typeof priceId !== 'string') return false;
  const clean = priceId.trim();
  return Boolean(PADDLE_PLANS[clean]);
}

/**
 * Maps a Paddle price ID to plan tier and trial metadata.
 * Returns null if the price ID is unrecognized.
 * ABSOLUTELY NO SILENT FALLBACK to Pro Monthly.
 */
export function mapPaddlePriceToTier(priceId: string | null | undefined): {
  tier: PlanTier;
  interval: BillingInterval;
  hasTrial: boolean;
  trialDays: number;
  amount: number;
} | null {
  if (!priceId || typeof priceId !== 'string') return null;
  const clean = priceId.trim();
  const plan = PADDLE_PLANS[clean];
  if (plan) {
    return {
      tier: plan.tier,
      interval: plan.interval,
      hasTrial: plan.hasTrial,
      trialDays: plan.trialDays,
      amount: plan.amount
    };
  }
  return null;
}
