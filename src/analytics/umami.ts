/**
 * ChoreMatrix Umami Cloud Analytics Integration
 *
 * Website: https://chorematrix.online
 * Tracking Script: https://cloud.umami.is/script.js
 * Website ID: a6b2b202-d0c6-4383-a864-7b683fc1285f
 *
 * Guarantees:
 * - Exactly one script tag injected per page (idempotent singleton guard).
 * - Strict consent enforcement: zero tracking before explicit analytics consent.
 * - Zero PII (household member names, chore descriptions, passwords, credentials, payment info) sent as properties.
 * - Safe execution in Node.js / SSR test environments.
 */

import { getCookieConsent } from '../ui/cookieBanner.ts';
import { sanitizeUrl } from './ga4.ts';

export const UMAMI_WEBSITE_ID = 'a6b2b202-d0c6-4383-a864-7b683fc1285f';
export const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js';
export const UMAMI_SCRIPT_ID = 'umami-tracking-script';

/**
 * Strips credentials, auth tokens, passwords, and sensitive query params from URLs before tracking.
 */
export function sanitizeUmamiUrl(urlStr: string): string {
  return sanitizeUrl(urlStr);
}

/**
 * Checks whether user has explicitly granted analytics consent in cookie preferences.
 */
export function hasAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false;
  const consent = getCookieConsent();
  return Boolean(consent && consent.analytics === true);
}

/**
 * Check whether Umami analytics has already been initialized in the current browser window.
 */
export function isUmamiInitialized(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const win = window as any;
  if (win.__umamiInitialized === true) {
    return true;
  }
  const existingScript =
    document.getElementById(UMAMI_SCRIPT_ID) ||
    document.querySelector(`script[src*="cloud.umami.is/script.js"]`) ||
    document.querySelector(`script[data-website-id="${UMAMI_WEBSITE_ID}"]`);
  return Boolean(existingScript);
}

export interface UmamiInitOptions {
  forceConsent?: boolean;
  websiteId?: string;
  scriptUrl?: string;
}

/**
 * Initializes the Umami Cloud tracking script.
 *
 * Honors the visitor's analytics-consent preference. Tracking will not begin
 * unless explicit permission has been obtained, or unless forceConsent is true.
 *
 * Ensures the script is injected exactly once across any number of calls.
 *
 * @returns boolean true if script was newly injected, false if skipped or already initialized
 */
export function initUmamiAnalytics(options?: UmamiInitOptions): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  // 1. Consent guard: Tracking does not begin before required permission is obtained
  const isConsented = options?.forceConsent || hasAnalyticsConsent();
  if (!isConsented) {
    return false;
  }

  const win = window as any;

  // 2. Singleton guard against duplicate tag loading across navigation and re-renders
  if (isUmamiInitialized()) {
    win.__umamiInitialized = true;
    return false;
  }

  const websiteId = options?.websiteId || UMAMI_WEBSITE_ID;
  const scriptUrl = options?.scriptUrl || UMAMI_SCRIPT_URL;

  // 3. Create script tag with required Umami attributes
  const script = document.createElement('script');
  script.id = UMAMI_SCRIPT_ID;
  script.defer = true;
  script.src = scriptUrl;
  script.setAttribute('data-website-id', websiteId);

  const parent = document.head || document.documentElement || document.body;
  if (parent) {
    parent.appendChild(script);
  }

  win.__umamiInitialized = true;
  return true;
}

/**
 * Removes the Umami tracking script if consent is revoked.
 */
export function removeUmamiScript(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const win = window as any;
  win.__umamiInitialized = false;

  const script = document.getElementById(UMAMI_SCRIPT_ID);
  if (script && script.parentNode) {
    script.parentNode.removeChild(script);
    return true;
  }
  return false;
}

/**
 * Check whether a parameter key could contain PII, household member names,
 * chore descriptions, credentials, or billing details.
 */
export function isSensitiveUmamiKey(key: string): boolean {
  const lower = key.toLowerCase();
  const safeExceptions = [
    'member_count', 'task_count', 'household_type', 'preset_name',
    'fairness_score', 'horizon_weeks', 'has_rating', 'has_email',
    'page_title', 'plan_tier', 'optimizer_step', 'theme_mode',
    'click_target', 'step', 'category'
  ];
  if (safeExceptions.includes(lower)) {
    return false;
  }

  const sensitivePatterns = [
    'password', 'passwd', 'pwd', 'secret', 'token', 'auth', 'jwt',
    'credential', 'apikey', 'api_key', 'private', 'email', 'mail',
    'subscription', 'sub_id', 'subscription_id', 'payment', 'card',
    'cvv', 'cvc', 'pan', 'expire', 'billing', 'customer_id',
    'household', 'member', 'phone', 'ssn', 'address', 'fullname',
    'first_name', 'last_name', 'name', 'user_id',
    'task', 'tasks', 'chore', 'chores', 'allocation', 'schedule',
    'capacity', 'availability', 'description'
  ];
  return sensitivePatterns.some(pattern => lower === pattern || lower.includes(pattern));
}

/**
 * Sanitizes an event parameter value to prevent leaking PII.
 */
export function sanitizeUmamiValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') {
    // Redact email addresses
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    let sanitized = value.replace(emailRegex, '[REDACTED_EMAIL]');

    // Redact JWT or token patterns
    if (sanitized.startsWith('ey') && sanitized.split('.').length === 3) {
      return '[REDACTED_TOKEN]';
    }

    // Limit parameter length to 100 chars
    return sanitized.slice(0, 100);
  }

  if (typeof value === 'number') {
    if (value > 1000000000 && !Number.isInteger(value)) {
      return undefined;
    }
    return value;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

/**
 * Strips all sensitive keys and sanitizes values for Umami custom event tracking.
 */
export function sanitizeUmamiData(data?: Record<string, any>): Record<string, any> {
  if (!data || typeof data !== 'object') return {};
  const clean: Record<string, any> = {};

  for (const [key, val] of Object.entries(data)) {
    if (isSensitiveUmamiKey(key)) continue;
    const sanitizedVal = sanitizeUmamiValue(val);
    if (sanitizedVal !== undefined) {
      clean[key] = sanitizedVal;
    }
  }

  return clean;
}

/**
 * Safely track a custom event in Umami, enforcing zero PII and honoring consent.
 */
export function trackUmamiEvent(eventName: string, data?: Record<string, any>): void {
  if (typeof window === 'undefined') return;
  if (!hasAnalyticsConsent()) return;

  const win = window as any;
  if (!win.umami || typeof win.umami.track !== 'function') return;

  const cleanEventName = eventName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 50);
  const cleanData = sanitizeUmamiData(data);

  if (Object.keys(cleanData).length > 0) {
    win.umami.track(cleanEventName, cleanData);
  } else {
    win.umami.track(cleanEventName);
  }
}

/**
 * Safely track a pageview in Umami with a sanitized URL, enforcing zero PII and honoring consent.
 */
export function trackUmamiPageView(pagePath?: string, pageTitle?: string): void {
  if (typeof window === 'undefined') return;
  if (!hasAnalyticsConsent()) return;

  const win = window as any;
  if (!win.umami || typeof win.umami.track !== 'function') return;

  const rawLocation = pagePath
    ? (win.location ? `${win.location.origin}${pagePath}` : pagePath)
    : (win.location ? win.location.href : 'https://chorematrix.online/');

  const cleanLocation = sanitizeUmamiUrl(rawLocation);
  const payload: Record<string, any> = {
    url: cleanLocation
  };
  if (pageTitle && typeof pageTitle === 'string') {
    payload.title = pageTitle.slice(0, 100);
  }

  win.umami.track((props: any) => ({
    ...props,
    ...payload
  }));
}

// Global browser window helper bindings
if (typeof window !== 'undefined') {
  const win = window as any;
  if (!win.initUmamiAnalytics) win.initUmamiAnalytics = initUmamiAnalytics;
  if (!win.trackUmamiEvent) win.trackUmamiEvent = trackUmamiEvent;
  if (!win.trackUmamiPageView) win.trackUmamiPageView = trackUmamiPageView;
  if (!win.isUmamiInitialized) win.isUmamiInitialized = isUmamiInitialized;
}
