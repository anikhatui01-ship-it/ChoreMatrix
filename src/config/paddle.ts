/**
 * ChoreMatrix Paddle Subscriptions Configuration (Sandbox)
 *
 * PADDLE BILLING MODEL:
 * - Product: ChoreMatrix Pro
 * - Price: USD 5.99 / month (recurring)
 * - Trial Price: Includes 7-day card-required free trial (for new eligible customers)
 * - Standard Price: No trial (for customers who have already consumed their trial)
 * - Environment: Sandbox
 */

import { getEnvVar } from './supabase.ts';

export type PaddleEnvironment = 'sandbox' | 'production';

export interface PaddlePlanDefinition {
  priceId: string;
  productId: string;
  planName: string;
  tier: 'pro';
  interval: 'monthly';
  currency: string;
  amount: number;       // In USD dollars (5.99)
  amountInCents: number; // Smallest currency unit (599)
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

export const PADDLE_CONFIG = {
  environment: (getEnvVar('VITE_PADDLE_ENV') || getEnvVar('VITE_PADDLE_ENVIRONMENT') || getEnvVar('PADDLE_ENV') || 'sandbox') as PaddleEnvironment,
  productId: getEnvVar('VITE_PADDLE_PRODUCT_ID') || 'pro_01m3q8bc75wg442x3h217njd0k',
  trialPriceId: getEnvVar('VITE_PADDLE_PRO_MONTHLY_TRIAL_PRICE_ID') || getEnvVar('VITE_PADDLE_TRIAL_PRICE_ID') || 'pri_01m3q8bcndadvqgz9jbr26pmw3',
  standardPriceId: getEnvVar('VITE_PADDLE_PRO_MONTHLY_STANDARD_PRICE_ID') || getEnvVar('VITE_PADDLE_STANDARD_PRICE_ID') || 'pri_01m3q8bcwn953t664zt4e9071z',
  prices: {
    trial: getEnvVar('VITE_PADDLE_PRO_MONTHLY_TRIAL_PRICE_ID') || getEnvVar('VITE_PADDLE_TRIAL_PRICE_ID') || 'pri_01m3q8bcndadvqgz9jbr26pmw3',
    standard: getEnvVar('VITE_PADDLE_PRO_MONTHLY_STANDARD_PRICE_ID') || getEnvVar('VITE_PADDLE_STANDARD_PRICE_ID') || 'pri_01m3q8bcwn953t664zt4e9071z'
  },
  clientToken: getEnvVar('VITE_PADDLE_CLIENT_TOKEN') || 'test_e0acafd60322d41b06bc1e77ad7',
  currency: 'USD',
  amount: 5.99,
  amountInCents: 599,
  trialDays: 7,
  companyName: 'ChoreMatrix',
  productionReturnDomain: 'https://chorematrix.online'
} as const;

export const PADDLE_PLANS: Record<string, PaddlePlanDefinition> = {
  [PADDLE_CONFIG.trialPriceId]: {
    priceId: PADDLE_CONFIG.trialPriceId,
    productId: PADDLE_CONFIG.productId,
    planName: 'ChoreMatrix Pro Monthly (7-Day Trial)',
    tier: 'pro',
    interval: 'monthly',
    currency: 'USD',
    amount: 5.99,
    amountInCents: 599,
    hasTrial: true,
    trialDays: 7
  },
  [PADDLE_CONFIG.standardPriceId]: {
    priceId: PADDLE_CONFIG.standardPriceId,
    productId: PADDLE_CONFIG.productId,
    planName: 'ChoreMatrix Pro Monthly (Standard / No Trial)',
    tier: 'pro',
    interval: 'monthly',
    currency: 'USD',
    amount: 5.99,
    amountInCents: 599,
    hasTrial: false,
    trialDays: 0
  }
};

/**
 * Returns the appropriate Paddle price ID based on trial consumption status.
 * If user has not consumed a trial, returns Price A (7-day trial).
 * If user has already consumed a trial, returns Price B (standard, no trial).
 */
export function getPaddlePriceId(isTrialEligible = true): string {
  return isTrialEligible ? PADDLE_CONFIG.trialPriceId : PADDLE_CONFIG.standardPriceId;
}

/**
 * Validates whether a price ID is a recognized ChoreMatrix Paddle price.
 */
export function isPaddlePriceId(priceId: string | null | undefined): boolean {
  if (!priceId) return false;
  const clean = priceId.trim();
  return clean === PADDLE_CONFIG.trialPriceId || clean === PADDLE_CONFIG.standardPriceId;
}

/**
 * Maps a Paddle price ID to plan tier and trial metadata.
 */
export function mapPaddlePriceToTier(priceId: string | null | undefined): {
  tier: 'pro';
  interval: 'monthly';
  hasTrial: boolean;
  trialDays: number;
  amount: number;
} | null {
  if (!priceId) return null;
  const clean = priceId.trim();
  if (PADDLE_PLANS[clean]) {
    const p = PADDLE_PLANS[clean];
    return {
      tier: p.tier,
      interval: p.interval,
      hasTrial: p.hasTrial,
      trialDays: p.trialDays,
      amount: p.amount
    };
  }
  // Generic Pro fallback if price starts with pri_
  if (clean.startsWith('pri_')) {
    return {
      tier: 'pro',
      interval: 'monthly',
      hasTrial: false,
      trialDays: 0,
      amount: 5.99
    };
  }
  return null;
}
