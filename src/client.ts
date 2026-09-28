/**
 * ChoreMatrix Client Runtime Bundle
 * Exports common UI utilities, auth session management, and configuration.
 */

export * from './config/supabase.ts';
export * from './config/pricing.ts';
export * from './config/email.ts';
export * from './auth/session.ts';
export * from './persistence/supabaseAdapter.ts';
export * from './persistence/types.ts';
export * from './ui/nav.ts';
export * from './ui/footer.ts';
export * from './ui/cookieBanner.ts';
export * from './monetization/adSlot.ts';
