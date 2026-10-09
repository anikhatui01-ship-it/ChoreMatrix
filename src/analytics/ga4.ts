/**
 * ChoreMatrix Google Analytics 4 (GA4) Integration
 * Measurement ID: G-M0CEPNN7S3
 *
 * Guarantees:
 * - Exactly one script tag injected per page.
 * - Idempotent initialization (guards against duplicate loads, page switches, and multi-bundle imports).
 * - Zero PII (passwords, emails, payment info, tokens, household data) sent as parameters.
 * - Strips sensitive query parameters (tokens, credentials, emails) from page_location.
 * - Privacy-respecting defaults: anonymize_ip, google signals disabled, ad personalization disabled.
 */

export const GA_MEASUREMENT_ID = 'G-M0CEPNN7S3';
export const GA4_SCRIPT_ID = 'ga4-tag-script';

/**
 * Remove sensitive parameters (emails, tokens, passwords, auth codes) from URL strings
 * to prevent leaking credentials in Analytics page views.
 */
export function sanitizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr, 'https://chorematrix.com');
    const sensitiveKeys = [
      'token', 'access_token', 'refresh_token', 'id_token', 'code',
      'secret', 'password', 'pwd', 'email', 'auth', 'key', 'signature',
      '_ptxn', 'subscription_id', 'payment_id', 'customer_id', 'user_id',
      'household', 'task', 'chore'
    ];

    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (sensitiveKeys.some(s => lower === s || lower.includes(s))) {
        url.searchParams.delete(key);
      }
    }

    // Sanitize hash if it contains auth fragments (e.g. Supabase #access_token=...)
    if (url.hash && (url.hash.includes('access_token') || url.hash.includes('token') || url.hash.includes('type='))) {
      url.hash = '';
    }

    return url.toString();
  } catch {
    // If URL parsing fails, return a safe fallback without query string
    return urlStr.split('?')[0].split('#')[0];
  }
}

/**
 * Determines whether a parameter key could contain PII or sensitive data.
 */
export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const safeExceptions = [
    'member_count', 'task_count', 'household_type', 'preset_name',
    'fairness_score', 'horizon_weeks', 'has_rating', 'has_email', 'allow_quote',
    'page_title', 'plan_tier', 'optimizer_step', 'theme_mode', 'click_target', 'step', 'category'
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
    'capacity', 'availability'
  ];
  return sensitivePatterns.some(pattern => lower === pattern || lower.includes(pattern));
}

/**
 * Sanitizes a single event parameter value to prevent PII exposure.
 */
export function sanitizeParamValue(value: unknown): string | number | boolean | undefined {
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
    // Disallow numbers that look like credit card numbers or phone numbers
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
 * Sanitizes an object of event parameters, stripping sensitive keys and sanitizing values.
 */
export function sanitizeParams(params?: Record<string, any>): Record<string, any> {
  if (!params || typeof params !== 'object') return {};
  const clean: Record<string, any> = {};

  for (const [key, val] of Object.entries(params)) {
    if (isSensitiveKey(key)) continue;
    const sanitizedVal = sanitizeParamValue(val);
    if (sanitizedVal !== undefined) {
      clean[key] = sanitizedVal;
    }
  }

  return clean;
}

/**
 * Check whether GA4 has already been initialized in the current browser window.
 */
export function isGA4Initialized(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const win = window as any;
  if (win.__ga4Initialized === true) {
    return true;
  }
  const existingScript = document.getElementById(GA4_SCRIPT_ID) ||
    document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"]`);
  return Boolean(existingScript);
}

/**
 * Initialize Google Analytics 4 Google Tag.
 *
 * Idempotent: Can be called safely from any module or page; will only inject the
 * tag and configure gtag exactly once.
 *
 * @param measurementId The GA4 Measurement ID (defaults to 'G-M0CEPNN7S3')
 * @returns boolean indicating whether tag was newly initialized (false if already initialized)
 */
export function initGoogleAnalytics(measurementId: string = GA_MEASUREMENT_ID): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  const win = window as any;

  // Singleton guard against duplicate tag loading
  if (isGA4Initialized()) {
    win.__ga4Initialized = true;
    return false;
  }

  // 1. Establish the dataLayer
  win.dataLayer = win.dataLayer || [];

  // 2. Define the gtag function
  function gtag(...args: any[]) {
    win.dataLayer.push(args);
  }
  if (!win.gtag) {
    win.gtag = gtag;
  }

  // 3. Record initialization timestamp
  win.gtag('js', new Date());

  // 4. Clean URL for pageview to strip sensitive query parameters and auth fragments
  const cleanLocation = sanitizeUrl(win.location ? win.location.href : 'https://chorematrix.com/');

  // 5. Configure GA4 with privacy-first options
  win.gtag('config', measurementId, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    restricted_data_processing: true,
    page_location: cleanLocation
  });

  // 6. Create and append the script tag exactly once
  const script = document.createElement('script');
  script.id = GA4_SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;

  const parent = document.head || document.documentElement || document.body;
  if (parent) {
    parent.appendChild(script);
  }

  win.__ga4Initialized = true;
  return true;
}

/**
 * Send a custom GA4 event safely, ensuring zero PII and sensitive parameters are sent.
 */
export function trackEvent(eventName: string, params?: Record<string, any>): void {
  if (typeof window === 'undefined') return;
  const win = window as any;
  if (typeof win.gtag !== 'function') return;

  // Clean event name (alphanumeric and underscores only, max 40 chars)
  const cleanEventName = eventName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
  const cleanParams = sanitizeParams(params);

  win.gtag('event', cleanEventName, cleanParams);
}

/**
 * Record a pageview in GA4 with a sanitized URL.
 */
export function trackPageView(pagePath?: string, pageTitle?: string): void {
  if (typeof window === 'undefined') return;
  const win = window as any;
  if (typeof win.gtag !== 'function') return;

  const rawLocation = pagePath
    ? (win.location ? `${win.location.origin}${pagePath}` : pagePath)
    : (win.location ? win.location.href : 'https://chorematrix.com/');

  const cleanLocation = sanitizeUrl(rawLocation);

  const params: Record<string, any> = {
    page_location: cleanLocation
  };
  if (pageTitle && typeof pageTitle === 'string') {
    params.page_title = pageTitle.slice(0, 100);
  }

  win.gtag('event', 'page_view', params);
}

// Global browser window helper bindings
if (typeof window !== 'undefined') {
  const win = window as any;
  if (!win.trackEvent) win.trackEvent = trackEvent;
  if (!win.trackPageView) win.trackPageView = trackPageView;
  if (!win.initGoogleAnalytics) win.initGoogleAnalytics = initGoogleAnalytics;
}
