/**
 * ChoreMatrix Centralized Pricing Configuration
 *
 * Live subscription plans: Pro and Plus with 7-day free trial.
 * These values are maintained centrally for consistency across customer-facing surfaces.
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
  isOneTime?: boolean;
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
  isBusinessFinalized: true,
  provisionalNotice: '',
  defaultTrialDays: 0,
  autoRenewalPolicyNotice: 'Automatic Renewal & Merchant of Record Disclosure: Paid subscriptions for ChoreMatrix Pro Monthly automatically renew at $5.99/month at the end of each monthly billing cycle until cancelled. The One-Time Fairness Pass ($14.99) is a single payment for a 1-year household pass with zero automated recurring charges. Cancellations can be executed online anytime via Account Settings without phone or manual cancellation barriers. Orders are processed by Dodo Payments as Merchant of Record. Please review our Cancellation & Refund Policy for full terms on cancellation, statutory consumer rights, and refund requests.',
  tiers: [
    {
      id: 'free',
      name: 'Free Audit',
      tagline: 'Try ChoreMatrix — Build a household setup and see how a more balanced chore plan could look.',
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
        'Full Household Capacity & Effort Calculator',
        'Live Fairness Index & Load Disparity Score',
        'Days 1–3 Schedule Preview',
        'Shareable "Chore Disparity Receipt" Card',
        'Browser Local Storage Save'
      ],
      limitations: [
        'Days 4–7 schedule locked in preview',
        'Rebalance & PDF export require pass or pro',
        '1-week planning horizon only'
      ],
      ctaText: 'Try Calculator Free',
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
        materialLimitations: ['Days 4–7 schedule locked in preview', '1-week planning only'],
        taxesNotice: 'No tax applicable',
        jurisdictionNotice: 'Free tier requires no payment method.'
      }
    },
    {
      id: 'fairness_pass',
      name: 'One-Time Fairness Pass',
      tagline: 'Get One Complete Plan — One payment for one complete four-week chore plan for your household.',
      monthlyPrice: 14.99,
      annualPrice: 14.99,
      annualSavingText: 'Single payment · Zero recurring fees',
      billingIntervals: ['month'],
      trialDays: 0,
      monthlyRenewalAmount: 0,
      annualRenewalAmount: 0,
      renewalInterval: 'monthly',
      cancellationMethod: 'One-time payment (not a recurring subscription)',
      isProvisional: false,
      popular: true,
      isOneTime: true,
      features: [
        'Instant Unlock of Full 7-Day & 4-Week Rotational Schedules',
        'Unlimited Drag-and-Drop Edits, Rebalance & 2-Opt Fairness Swaps',
        'Clean Printable PDF & Fridge-Ready Schedule Exports',
        'Full Explainability Tags (capacity_relief, preference_bonus)',
        '1-Year Full Household Pass (Single Payment, Zero Recurring Fees)'
      ],
      limitations: [
        'Single household and single plan purchase',
        'Manual edits to this plan are included',
        'Generating newly optimized plans from changed inputs requires Pro',
        'Unlimited new plans are not included'
      ],
      ctaText: 'Get My Complete Plan — $14.99',
      adFree: true,
      adEntitlement: 'ad_free',
      checkoutDisclosures: {
        chargedToday: 14.99,
        trialDurationText: 'None (instant one-time purchase)',
        chargedAfterTrialMonthly: 0,
        chargedAfterTrialAnnual: 0,
        recurringFrequency: 'monthly',
        renewalBehavior: 'One-time payment of $14.99 for a 1-year household pass. Does not automatically renew.',
        cancellationMethod: 'One-time charge; review our Cancellation & Refund Policy.',
        materialLimitations: [
          'Single household & single plan purchase',
          'Newly optimized recalculation from changed inputs requires Pro'
        ],
        taxesNotice: 'Applicable state/local sales taxes calculated at checkout.',
        jurisdictionNotice: 'Single charge processed by Dodo Payments as Merchant of Record.'
      }
    },
    {
      id: 'pro',
      name: 'Household Autopilot Pro',
      tagline: 'Keep Your Plan Up to Date — For households whose chores, availability, and schedules keep changing.',
      monthlyPrice: 5.99,
      annualPrice: 59.99,
      annualSavingText: 'Save about 2 months',
      billingIntervals: ['month', 'year'],
      trialDays: 7,
      monthlyRenewalAmount: 5.99,
      annualRenewalAmount: 59.99,
      renewalInterval: 'monthly',
      cancellationMethod: 'Online cancellation via Account Settings prior to renewal date',
      isProvisional: false,
      popular: false,
      features: [
        'Everything in the Fairness Pass',
        'Unlimited Household Profiles & Custom Presets',
        'Read-Only Shareable Roommate/Partner Schedule Links',
        'Multi-Month Rotation Memory (never get stuck with the worst chore twice)',
        'Priority Support & Cloud Backup Across Devices'
      ],
      limitations: [],
      ctaText: 'Subscribe Monthly — $5.99/mo',
      adFree: true,
      adEntitlement: 'ad_free',
      checkoutDisclosures: {
        chargedToday: 5.99,
        trialDurationText: '7-day free trial period',
        chargedAfterTrialMonthly: 5.99,
        chargedAfterTrialAnnual: 59.99,
        recurringFrequency: 'monthly',
        renewalBehavior: 'Renews automatically each month ($5.99/mo) until cancelled. Notice provided prior to renewal.',
        cancellationMethod: 'Online via Account Settings before monthly renewal date to prevent future charge.',
        materialLimitations: [],
        taxesNotice: 'Applicable state/local sales taxes calculated at checkout.',
        jurisdictionNotice: 'Complies with statutory continuous service disclosure standards.'
      }
    }
  ],
  faq: [
    {
      question: 'Is the core optimizer really free?',
      answer: 'Yes. Generating an initial household workload allocation, viewing your Fairness Index Score, seeing workload disparity, and previewing Days 1 to 3 is completely free with zero login barrier.'
    },
    {
      question: 'What is the One-Time Fairness Pass?',
      answer: 'The One-Time Fairness Pass is a single $14.99 payment that instantly unlocks full 7-day and 4-week rotational schedules, unlimited drag-and-drop edits, and fridge-ready printable PDFs for a full year (365 days)—with zero recurring subscription fees.'
    },
    {
      question: 'Is there a recurring fee with the Fairness Pass?',
      answer: 'No. The Fairness Pass is a single $14.99 payment that grants 365 days of full schedule access for your household with zero automatic renewals. ChoreMatrix Pro Monthly is billed at $5.99/month with straightforward monthly flexibility and online cancellation anytime.'
    },
    {
      question: 'How does payment processing work?',
      answer: 'Payments and billing for ChoreMatrix are securely processed by our Merchant of Record, Dodo Payments. You can choose a one-time payment for the Fairness Pass or subscribe with monthly flexibility for Pro Monthly.'
    }
  ]
};

/**
 * Normalizes tier ID string to handle canonical IDs and legacy aliases.
 */
export function normalizeTierId(tierId: string | null | undefined): string {
  if (!tierId) return 'free';
  const clean = tierId.toLowerCase().trim();
  if (clean === 'household_pro' || clean === 'pro' || clean === 'autopilot_pro') return 'pro';
  if (clean === 'fairness_pass' || clean === 'onetime_pass' || clean === 'pass' || clean === 'one_time_pass') return 'fairness_pass';
  if (clean === 'household_plus' || clean === 'family_plus' || clean === 'plus') return 'fairness_pass';
  if (clean === 'free_audit') return 'free';
  return clean;
}

/**
 * Returns a tier by ID from centralized pricing config.
 * Supports canonical IDs ('free', 'fairness_pass', 'pro') and legacy aliases ('plus', 'household_pro', 'household_plus').
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

export * from '../monetization/entitlements.ts';

