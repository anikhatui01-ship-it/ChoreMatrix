/**
 * ChoreMatrix Centralized Pricing Configuration
 *
 * IMPORTANT:
 * As documented in 13-monetization.md, final subscription pricing is NOT finalized.
 * The values below are PROVISIONAL monetization experiment hypotheses (Options A & B).
 * These values must NEVER be hardcoded into UI components.
 */

export interface CheckoutDisclosures {
  chargedToday: number;
  trialDurationText: string;
  chargedAfterTrialMonthly: number;
  chargedAfterTrialAnnual: number;
  recurringFrequency: 'monthly' | 'annually';
  renewalBehavior: string;
  cancellationMethod: string;
  materialLimitations: string[];
  taxesNotice: string;
  jurisdictionNotice: string;
}

export type AdEntitlement = 'ads_enabled' | 'ad_free';

export interface PricingTier {
  id: string;
  name: string;
  tagline: string;
  monthlyPrice: number;
  annualPrice: number;
  annualSavingText: string;
  billingIntervals: Array<'month' | 'year'>;
  trialDays: number;
  monthlyRenewalAmount: number;
  annualRenewalAmount: number;
  renewalInterval: 'monthly' | 'annually';
  cancellationMethod: string;
  isProvisional: boolean;
  popular?: boolean;
  features: string[];
  limitations: string[];
  ctaText: string;
  adFree: boolean;
  adEntitlement: AdEntitlement;
  checkoutDisclosures: CheckoutDisclosures;
}

export interface PricingConfig {
  isBusinessFinalized: boolean;
  provisionalNotice: string;
  defaultTrialDays: number;
  autoRenewalPolicyNotice: string;
  tiers: PricingTier[];
  faq: Array<{ question: string; answer: string }>;
}

export const PRICING_CONFIG: PricingConfig = {
  isBusinessFinalized: false,
  provisionalNotice: 'Informational Pricing Only: Subscription payment checkout is currently in development. Pricing and trial durations are development values. Core optimization and interactive planning remain accessible without entering payment details.',
  defaultTrialDays: 7,
  autoRenewalPolicyNotice: 'Automatic Renewal Disclosure: Future paid subscriptions automatically renew at the applicable recurring rate ($5.99/mo or $59.99/yr for Pro; $9.99/mo or $99.99/yr for Plus) at the end of each billing cycle or promotional trial period until cancelled. Cancellations can be executed online anytime via Account Settings without phone or manual cancellation barriers. California and other jurisdictions require explicit affirmative consent and clear disclosure of all renewal terms adjacent to the purchase action.',
  tiers: [
    {
      id: 'free',
      name: 'Free',
      tagline: 'Essential workload optimization for your household.',
      monthlyPrice: 0,
      annualPrice: 0,
      annualSavingText: 'Free forever',
      billingIntervals: ['month'],
      trialDays: 0,
      monthlyRenewalAmount: 0,
      annualRenewalAmount: 0,
      renewalInterval: 'monthly',
      cancellationMethod: 'Not applicable (no recurring charges)',
      isProvisional: false,
      features: [
        '1-week planning',
        'core optimizer',
        'Calculate Plan',
        'Rebalance',
        'cloud saving',
        'basic diagnostics',
        'ads'
      ],
      limitations: [
        '1-week planning horizon only',
        'Ad-supported workspace'
      ],
      ctaText: 'Continue Free',
      adFree: false,
      adEntitlement: 'ads_enabled',
      checkoutDisclosures: {
        chargedToday: 0,
        trialDurationText: 'None (permanently free)',
        chargedAfterTrialMonthly: 0,
        chargedAfterTrialAnnual: 0,
        recurringFrequency: 'monthly',
        renewalBehavior: 'Free forever without automated recurring charges.',
        cancellationMethod: 'Delete account at any time in Account Settings.',
        materialLimitations: ['1-week planning only', 'Ad-supported workspace'],
        taxesNotice: 'No tax applicable',
        jurisdictionNotice: 'Free tier requires no payment method.'
      }
    },
    {
      id: 'pro',
      name: 'Pro',
      tagline: 'Multi-week rotational fairness, soft preferences, and no ads.',
      monthlyPrice: 5.99,
      annualPrice: 59.99,
      annualSavingText: 'Save about 2 months',
      billingIntervals: ['month', 'year'],
      trialDays: 7,
      monthlyRenewalAmount: 5.99,
      annualRenewalAmount: 59.99,
      renewalInterval: 'monthly',
      cancellationMethod: 'Online cancellation via Account Settings prior to renewal date',
      isProvisional: true,
      popular: true,
      features: [
        'everything in Free',
        '4-week planning',
        'advanced preferences/aversions',
        'richer plan information',
        'no ads'
      ],
      limitations: [],
      ctaText: 'Start 7-day free trial',
      adFree: true,
      adEntitlement: 'ad_free',
      checkoutDisclosures: {
        chargedToday: 0,
        trialDurationText: '7-day free trial period',
        chargedAfterTrialMonthly: 5.99,
        chargedAfterTrialAnnual: 59.99,
        recurringFrequency: 'monthly',
        renewalBehavior: 'Renews automatically each month ($5.99/mo) or year ($59.99/yr) until cancelled. Notice provided prior to renewal.',
        cancellationMethod: 'Online via Account Settings before trial expires to prevent any charge.',
        materialLimitations: [],
        taxesNotice: 'Applicable state/local sales taxes calculated at checkout.',
        jurisdictionNotice: 'Complies with California ARL and statutory continuous service disclosure standards.'
      }
    },
    {
      id: 'plus',
      name: 'Plus',
      tagline: 'Comprehensive household planning with priority feedback and no ads.',
      monthlyPrice: 9.99,
      annualPrice: 99.99,
      annualSavingText: 'Save about 2 months',
      billingIntervals: ['month', 'year'],
      trialDays: 7,
      monthlyRenewalAmount: 9.99,
      annualRenewalAmount: 99.99,
      renewalInterval: 'monthly',
      cancellationMethod: 'Online cancellation via Account Settings prior to renewal date',
      isProvisional: true,
      features: [
        'everything in Pro',
        'priority feature feedback',
        'no ads'
      ],
      limitations: [],
      ctaText: 'Start 7-day free trial',
      adFree: true,
      adEntitlement: 'ad_free',
      checkoutDisclosures: {
        chargedToday: 0,
        trialDurationText: '7-day free trial period',
        chargedAfterTrialMonthly: 9.99,
        chargedAfterTrialAnnual: 99.99,
        recurringFrequency: 'monthly',
        renewalBehavior: 'Renews automatically each month ($9.99/mo) or year ($99.99/yr) until cancelled. Notice provided prior to renewal.',
        cancellationMethod: 'Online via Account Settings before trial expires to prevent any charge.',
        materialLimitations: [],
        taxesNotice: 'Applicable state/local sales taxes calculated at checkout.',
        jurisdictionNotice: 'Complies with California ARL and statutory continuous service disclosure standards.'
      }
    }
  ],
  faq: [
    {
      question: 'Is the core optimizer really free?',
      answer: 'Yes. Generating an optimized household workload allocation, testing differential rebalancing, and saving your configuration is completely free.'
    },
    {
      question: 'How do free trials work?',
      answer: 'Paid tiers include a 7-day free trial when subscription billing launches. You can cancel online anytime before the trial ends to avoid recurring charges.'
    },
    {
      question: 'Is payment processing active today?',
      answer: 'No. Payment processing is currently disabled during this phase of ChoreMatrix. Tiers and features reflect active roadmap capabilities.'
    }
  ]
};

/**
 * Normalizes tier ID string to handle canonical IDs and legacy aliases.
 */
export function normalizeTierId(tierId: string | null | undefined): string {
  if (!tierId) return 'free';
  const clean = tierId.toLowerCase().trim();
  if (clean === 'household_pro' || clean === 'pro') return 'pro';
  if (clean === 'household_plus' || clean === 'family_plus' || clean === 'plus') return 'plus';
  return clean;
}

/**
 * Returns a tier by ID from centralized pricing config.
 * Supports canonical IDs ('free', 'pro', 'plus') and legacy aliases ('household_pro', 'household_plus').
 */
export function getTierById(tierId: string | null | undefined): PricingTier | undefined {
  if (!tierId) return undefined;
  const normalized = normalizeTierId(tierId);
  return PRICING_CONFIG.tiers.find(t => t.id === normalized);
}

/**
 * Returns whether a given plan tier ID is entitled to an ad-free experience.
 * Authoritative check based on centralized tier configuration.
 */
export function isTierAdFree(tierId: string | null | undefined): boolean {
  if (!tierId) return false;
  const tier = getTierById(tierId);
  return Boolean(tier && tier.adFree);
}

/**
 * Returns default paid plan tier for upgrade flows.
 */
export function getDefaultPaidTier(): PricingTier {
  return PRICING_CONFIG.tiers.find(t => t.id === 'pro') || PRICING_CONFIG.tiers[1];
}

/**
 * Calculates annual savings for a plan compared to monthly billing over 12 months.
 */
export function calculateAnnualSavings(tier: PricingTier): {
  monthlyTotal: number;
  annualPrice: number;
  savingsAmount: number;
  savingsText: string;
} {
  const monthlyTotal = Math.round(tier.monthlyPrice * 12 * 100) / 100;
  const savingsAmount = Math.max(0, Math.round((monthlyTotal - tier.annualPrice) * 100) / 100);
  return {
    monthlyTotal,
    annualPrice: tier.annualPrice,
    savingsAmount,
    savingsText: tier.annualSavingText
  };
}

