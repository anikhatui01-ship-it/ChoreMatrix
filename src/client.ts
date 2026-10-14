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
export * from './analytics/umami.ts';
export * from './feedback/feedbackService.ts';

import { initGoogleAnalytics } from './analytics/ga4.ts';
import { initUmamiAnalytics, hasAnalyticsConsent } from './analytics/umami.ts';

// Automatically initialize analytics non-blockingly during browser idle time
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const scheduleInit = () => {
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => initGoogleAnalytics(), { timeout: 2500 });
    } else {
      setTimeout(() => initGoogleAnalytics(), 1000);
    }
  };

  const scheduleUmamiInit = () => {
    if (hasAnalyticsConsent()) {
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(() => initUmamiAnalytics(), { timeout: 2500 });
      } else {
        setTimeout(() => initUmamiAnalytics(), 1000);
      }
    }
  };

  if (document.readyState === 'complete') {
    scheduleInit();
    scheduleUmamiInit();
  } else {
    window.addEventListener('load', () => {
      scheduleInit();
      scheduleUmamiInit();
    }, { once: true });
  }

  // Dynamically initialize Umami if user updates consent in cookie banner / modal
  window.addEventListener('chorematrix:consent-updated', (e: any) => {
    if (e?.detail?.analytics === true) {
      initUmamiAnalytics();
    }
  });
}
