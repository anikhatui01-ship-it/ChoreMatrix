/**
 * ChoreMatrix Client Runtime Bundle
 * Exports common UI utilities, auth session management, pricing, and Dodo checkout.
 */

export * from './config/supabase.ts';
export * from './config/pricing.ts';
export * from './config/dodo.ts';
export * from './config/email.ts';
export * from './auth/session.ts';
export * from './persistence/supabaseAdapter.ts';
export * from './persistence/localDraft.ts';
export * from './persistence/types.ts';
export * from './ui/nav.ts';
export * from './ui/footer.ts';
export * from './ui/cookieBanner.ts';
export * from './monetization/adSlot.ts';
export * from './monetization/entitlements.ts';
export * from './monetization/dodoCheckout.ts';
export * from './analytics/ga4.ts';
export * from './feedback/feedbackService.ts';

import { initGoogleAnalytics } from './analytics/ga4.ts';

// Automatically initialize Google Analytics 4 exactly once in the browser runtime
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initGoogleAnalytics();
    }, { once: true });
  } else {
    initGoogleAnalytics();
  }
}
