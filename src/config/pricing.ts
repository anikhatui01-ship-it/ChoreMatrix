/**
 * ChoreMatrix Centralized Pricing Configuration
 *
 * IMPORTANT:
 * As documented in 13-monetization.md, final subscription pricing is NOT finalized.
 * The values below are PROVISIONAL monetization experiment hypotheses (Options A & B).
 * These values must NEVER be hardcoded into UI components.
 */

export interface PricingTier {
  id: string;
  name: string;
  tagline: string;
  monthlyPrice: number;
  annualPrice: number;
  trialDays: number;
  isProvisional: boolean;
  popular?: boolean;
  features: string[];
  limitations: string[];
  ctaText: string;
}

export interface PricingConfig {
  isBusinessFinalized: boolean;
  provisionalNotice: string;
  defaultTrialDays: number;
  tiers: PricingTier[];
  faq: Array<{ question: string; answer: string }>;
}

export const PRICING_CONFIG: PricingConfig = {
  isBusinessFinalized: false,
  provisionalNotice: 'Notice: Pricing and trial durations are provisional development values based on monetization hypotheses in 13-monetization.md. Final pricing is subject to business confirmation before commercial launch.',
  defaultTrialDays: 14,
  tiers: [
    {
      id: 'free',
      name: 'Free',
      tagline: 'Essential workload optimization for a single household.',
      monthlyPrice: 0,
      annualPrice: 0,
      trialDays: 0,
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
      ctaText: 'Continue free'
    },
    {
      id: 'household_pro',
      name: 'Household Pro',
      tagline: 'Multi-week rotation and full constraint flexibility.',
      monthlyPrice: 4.99, // Hypothesized Option A from 13-monetization.md
      annualPrice: 39.00,
      trialDays: 14,
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
      ctaText: 'Start 14-day free trial'
    },
    {
      id: 'household_plus',
      name: 'Household Plus',
      tagline: 'For roommates, vacation homes, and complex multi-property households.',
      monthlyPrice: 7.99, // Hypothesized Option B from 13-monetization.md
      annualPrice: 59.00,
      trialDays: 14,
      isProvisional: true,
      features: [
        'Everything in Pro',
        'Multiple saved households (e.g. shared vacation, roommates)',
        'Priority differential rebalancing',
        'Advanced constraint diagnostics',
        'Priority feature feedback'
      ],
      limitations: [],
      ctaText: 'Start 14-day free trial'
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
