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

export interface PricingTier {
  id: string;
  name: string;
  tagline: string;
  monthlyPrice: number;
  annualPrice: number;
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
  provisionalNotice: 'Informational Pricing Only: Subscription payment checkout is currently in development. Pricing and trial durations are provisional development values based on monetization hypotheses in 13-monetization.md. Core optimization and interactive planning remain accessible without entering payment details.',
  defaultTrialDays: 14,
  autoRenewalPolicyNotice: 'Automatic Renewal Disclosure: Future paid subscriptions automatically renew at the applicable recurring rate at the end of each billing cycle or promotional trial period until cancelled. Cancellations can be executed online anytime via Account Settings without phone or manual cancellation barriers. California and other jurisdictions require explicit affirmative consent and clear disclosure of all renewal terms adjacent to the purchase action.',
  tiers: [
    {
      id: 'free',
      name: 'Free',
      tagline: 'Essential workload optimization for a single household.',
      monthlyPrice: 0,
      annualPrice: 0,
      billingIntervals: ['month'],
      trialDays: 0,
      monthlyRenewalAmount: 0,
      annualRenewalAmount: 0,
      renewalInterval: 'monthly',
      cancellationMethod: 'Not applicable (no recurring charges)',
      isProvisional: false,
      features: [
        '1 active household',
        'Deterministic workload optimizer',
        'Capacity-aware & equal balance modes',
        'Weekly calendar & table schedule views',
        'Basic differential rebalancing',
        'Full Light, Dark, and System theme support'
      ],
      limitations: [
        'Single planning horizon',
        'Local browser storage only'
      ],
      ctaText: 'Continue free',
      checkoutDisclosures: {
        chargedToday: 0,
        trialDurationText: 'None (permanently free)',
        chargedAfterTrialMonthly: 0,
        chargedAfterTrialAnnual: 0,
        recurringFrequency: 'monthly',
        renewalBehavior: 'Free forever without automated recurring charges.',
        cancellationMethod: 'Delete account at any time in Account Settings.',
        materialLimitations: ['Local storage only', 'Single planning horizon'],
        taxesNotice: 'No tax applicable',
        jurisdictionNotice: 'Free tier requires no payment method.'
      }
    },
    {
      id: 'household_pro',
      name: 'Household Pro',
      tagline: 'Multi-week rotation and full constraint flexibility.',
      monthlyPrice: 4.99, // Hypothesized Option A from 13-monetization.md
      annualPrice: 39.00,
      billingIntervals: ['month', 'year'],
      trialDays: 14,
      monthlyRenewalAmount: 4.99,
      annualRenewalAmount: 39.00,
      renewalInterval: 'monthly',
      cancellationMethod: '1-click online cancellation via Account dashboard prior to renewal date',
      isProvisional: true,
      popular: true,
      features: [
        'Everything in Free',
        '4-week multi-week rotation heuristics',
        'Cloud sync & secure multi-device sign-in',
        'Aversion & preference scoring (soft preferences)',
        'Full explainability tags (Why this assignment?)',
        'Exportable schedule summaries'
      ],
      limitations: [
        '1 cloud household'
      ],
      ctaText: 'Start 14-day free trial',
      checkoutDisclosures: {
        chargedToday: 0,
        trialDurationText: '14-day free trial period',
        chargedAfterTrialMonthly: 4.99,
        chargedAfterTrialAnnual: 39.00,
        recurringFrequency: 'monthly',
        renewalBehavior: 'Renews automatically each month or year until cancelled. Notice provided prior to annual renewal.',
        cancellationMethod: 'Online via Account Settings before trial expires to prevent any charge.',
        materialLimitations: ['1 saved cloud household profile'],
        taxesNotice: 'Applicable state/local sales taxes calculated at checkout.',
        jurisdictionNotice: 'Complies with California ARL and statutory continuous service disclosure standards.'
      }
    },
    {
      id: 'household_plus',
      name: 'Household Plus',
      tagline: 'For roommates, vacation homes, and complex multi-property households.',
      monthlyPrice: 7.99, // Hypothesized Option B from 13-monetization.md
      annualPrice: 59.00,
      billingIntervals: ['month', 'year'],
      trialDays: 14,
      monthlyRenewalAmount: 7.99,
      annualRenewalAmount: 59.00,
      renewalInterval: 'monthly',
      cancellationMethod: '1-click online cancellation via Account dashboard prior to renewal date',
      isProvisional: true,
      features: [
        'Everything in Pro',
        'Multiple saved households (e.g. shared vacation, roommates)',
        'Priority differential rebalancing',
        'Advanced constraint diagnostics',
        'Priority feature feedback'
      ],
      limitations: [],
      ctaText: 'Start 14-day free trial',
      checkoutDisclosures: {
        chargedToday: 0,
        trialDurationText: '14-day free trial period',
        chargedAfterTrialMonthly: 7.99,
        chargedAfterTrialAnnual: 59.00,
        recurringFrequency: 'monthly',
        renewalBehavior: 'Renews automatically each month or year until cancelled. Notice provided prior to annual renewal.',
        cancellationMethod: 'Online via Account Settings before trial expires to prevent any charge.',
        materialLimitations: ['None'],
        taxesNotice: 'Applicable state/local sales taxes calculated at checkout.',
        jurisdictionNotice: 'Complies with California ARL and statutory continuous service disclosure standards.'
      }
    }
  ],
  faq: [
    {
      question: 'Is the core optimizer really free?',
      answer: 'Yes. Generating an optimized household workload allocation and testing differential rebalancing is completely free.'
    },
    {
      question: 'How do free trials work?',
      answer: 'Paid tiers will include a visible 14-day free trial from centralized configuration when subscription billing launches. You can continue free at any time.'
    },
    {
      question: 'Is payment processing active today?',
      answer: 'No. Payment processing is currently disabled during this phase of ChoreMatrix. Tiers and features reflect active roadmap capabilities.'
    }
  ]
};
