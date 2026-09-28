/**
 * ChoreMatrix Cashfree Subscriptions Configuration
 *
 * CASHFREE SANDBOX PLANS:
 * 1. CHOREMATRIX_PRO_MONTHLY:
 *    Plan: ChoreMatrix Pro Monthly
 *    Amount: USD 5.99
 *    Interval: 1 month
 *
 * 2. ChoreMatrix_Pro_Annual:
 *    Plan: ChoreMatrix Pro Annual
 *    Amount: USD 59.99
 *    Interval: 1 year
 *
 * 3. ChoreMatrix_Plus_Monthly:
 *    Plan: ChoreMatrix Plus Monthly
 *    Amount: USD 9.99
 *    Interval: 1 month
 *
 * 4. ChoreMatrix_Plus_Annual:
 *    Plan: ChoreMatrix Plus Annual
 *    Amount: USD 99.99
 *    Interval: 1 year
 *
 * PRODUCTION RETURN DOMAIN BASE:
 * https://chorematrix.online
 */

import { normalizeTierId } from './pricing.ts';

export interface CashfreePlanDefinition {
  planId: string;
  planName: string;
  tier: 'pro' | 'plus';
  interval: 'monthly' | 'annually';
  currency: string;
  amount: number;
}

export const CASHFREE_CONFIG = {
  mode: 'sandbox' as const,
  sandboxBaseUrl: 'https://sandbox.cashfree.com/pg',
  apiVersion: '2023-08-01',
  productionReturnDomain: 'https://chorematrix.online',
  sdkUrl: 'https://sdk.cashfree.com/js/v3/cashfree.js'
} as const;

export const CASHFREE_PLANS: Record<string, CashfreePlanDefinition> = {
  CHOREMATRIX_PRO_MONTHLY: {
    planId: 'CHOREMATRIX_PRO_MONTHLY',
    planName: 'ChoreMatrix Pro Monthly',
    tier: 'pro',
    interval: 'monthly',
    currency: 'USD',
    amount: 5.99
  },
  ChoreMatrix_Pro_Annual: {
    planId: 'ChoreMatrix_Pro_Annual',
    planName: 'ChoreMatrix Pro Annual',
    tier: 'pro',
    interval: 'annually',
    currency: 'USD',
    amount: 59.99
  },
  ChoreMatrix_Plus_Monthly: {
    planId: 'ChoreMatrix_Plus_Monthly',
    planName: 'ChoreMatrix Plus Monthly',
    tier: 'plus',
    interval: 'monthly',
    currency: 'USD',
    amount: 9.99
  },
  ChoreMatrix_Plus_Annual: {
    planId: 'ChoreMatrix_Plus_Annual',
    planName: 'ChoreMatrix Plus Annual',
    tier: 'plus',
    interval: 'annually',
    currency: 'USD',
    amount: 99.99
  }
} as const;

/**
 * Resolves the exact Cashfree sandbox plan ID from a plan tier and interval.
 * Returns null if not a paid plan or unrecognized interval.
 */
export function getCashfreePlanId(tierId: string | null | undefined, interval?: string | null): string | null {
  if (!tierId) return null;
  const cleanTier = normalizeTierId(tierId);
  const cleanInterval = (interval || '').toLowerCase().trim();
  const isAnnual = cleanInterval === 'annual' || cleanInterval === 'annually' || cleanInterval === 'year';

  if (cleanTier === 'pro') {
    return isAnnual ? 'ChoreMatrix_Pro_Annual' : 'CHOREMATRIX_PRO_MONTHLY';
  }
  if (cleanTier === 'plus') {
    return isAnnual ? 'ChoreMatrix_Plus_Annual' : 'ChoreMatrix_Plus_Monthly';
  }
  return null;
}

/**
 * Maps a Cashfree plan ID back to ChoreMatrix plan_tier and billing_interval.
 * Requirement 13:
 *   Pro Monthly → Pro
 *   Pro Annual → Pro
 *   Plus Monthly → Plus
 *   Plus Annual → Plus
 */
export function mapCashfreePlanToTier(planId: string | null | undefined): {
  tier: 'pro' | 'plus';
  interval: 'monthly' | 'annually';
  planName: string;
} | null {
  if (!planId) return null;
  const plan = CASHFREE_PLANS[planId];
  if (plan) {
    return {
      tier: plan.tier,
      interval: plan.interval,
      planName: plan.planName
    };
  }

  // Case-insensitive fallback
  const found = Object.values(CASHFREE_PLANS).find(
    p => p.planId.toLowerCase() === planId.toLowerCase()
  );
  if (found) {
    return {
      tier: found.tier,
      interval: found.interval,
      planName: found.planName
    };
  }
  return null;
}

/**
 * Checks whether a given plan ID matches one of the 4 existing Cashfree sandbox plans.
 */
export function isCashfreePlanId(planId: string | null | undefined): boolean {
  return Boolean(mapCashfreePlanToTier(planId));
}

/**
 * Resolves the return URL for the subscription authorization redirect.
 * Uses https://chorematrix.online as the production base, but allows runtime origin in dev.
 */
export function resolveReturnUrl(customBase?: string): string {
  const base = customBase || CASHFREE_CONFIG.productionReturnDomain;
  const cleanBase = base.replace(/\/+$/, '');
  return `${cleanBase}/account.html?sub_id={subscription_id}`;
}
