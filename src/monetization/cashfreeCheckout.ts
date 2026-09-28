/**
 * ChoreMatrix Cashfree Client-Side Subscription Checkout
 *
 * Integrates official Cashfree Subscription Web SDK:
 * 1. Calls secure Supabase Edge Function to create Cashfree subscription in SANDBOX.
 * 2. Receives Cashfree Subscription Session ID without exposing secret keys.
 * 3. Launches Cashfree hosted subscription checkout using Cashfree SDK.
 */

import { supabase, isSupabaseConfigured, getEnvVar } from '../config/supabase.ts';
import { CASHFREE_CONFIG, getCashfreePlanId, mapCashfreePlanToTier } from '../config/cashfree.ts';

declare global {
  interface Window {
    Cashfree?: (config: { mode: 'sandbox' | 'production' }) => {
      subscriptionsCheckout: (options: {
        subsSessionId: string;
        redirectTarget?: '_self' | '_blank' | '_modal';
      }) => Promise<{ error?: { message: string }; redirect?: boolean }>;
    };
  }
}

/**
 * Ensures the official Cashfree JS SDK script is loaded in the browser.
 */
export async function loadCashfreeSdk(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (typeof window.Cashfree === 'function') return;

  const existingScript = document.querySelector(`script[src="${CASHFREE_CONFIG.sdkUrl}"]`);
  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Cashfree SDK')));
      if (typeof window.Cashfree === 'function') resolve();
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CASHFREE_CONFIG.sdkUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Cashfree SDK script from CDN.'));
    document.head.appendChild(script);
  });
}

export interface InitiateUpgradeOptions {
  plan: string;
  interval?: 'monthly' | 'annually' | 'annual';
  phone?: string;
  redirectTarget?: '_self' | '_blank' | '_modal';
}

export interface InitiateUpgradeResult {
  success: boolean;
  subscription_id?: string;
  subscription_session_id?: string;
  auth_link?: string | null;
  error?: string;
}

/**
 * Initiates the Cashfree Sandbox subscription upgrade flow:
 * 1. Validates plan mapping against existing Cashfree sandbox plans.
 * 2. Calls Supabase Edge Function `create-subscription`.
 * 3. Launches Cashfree hosted checkout using the official SDK.
 */
export async function initiateCashfreeSubscription(
  options: InitiateUpgradeOptions
): Promise<InitiateUpgradeResult> {
  const planId = getCashfreePlanId(options.plan, options.interval);
  if (!planId) {
    return {
      success: false,
      error: `Plan "${options.plan}" is not a recognized paid tier. Only Pro and Plus can be upgraded.`
    };
  }

  if (!isSupabaseConfigured || !supabase) {
    return {
      success: false,
      error: 'Supabase is not configured. Cloud subscription checkout requires active cloud configuration.'
    };
  }

  // 1. Get authenticated user session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    return {
      success: false,
      error: 'User authentication required. Please sign in to upgrade your plan.'
    };
  }

  // 2. Call Supabase Edge Function: cashfree-create-subscription (with fallback to create-subscription)
  let responseData: any = null;
  const functionName = 'cashfree-create-subscription';
  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: {
        plan: options.plan,
        interval: options.interval || 'monthly',
        phone: options.phone
      }
    });

    if (error) {
      throw new Error(error.message || 'Edge Function call failed.');
    }
    responseData = data;
  } catch (fnErr: any) {
    // Fallback: direct HTTP fetch to Edge Function endpoint if functions.invoke is unavailable
    try {
      const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || '';
      let res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/cashfree-create-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          plan: options.plan,
          interval: options.interval || 'monthly',
          phone: options.phone
        })
      });

      if (!res.ok) {
        // Try fallback endpoint create-subscription
        res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/create-subscription`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({
            plan: options.plan,
            interval: options.interval || 'monthly',
            phone: options.phone
          })
        });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}: Subscription creation failed`);
      }
      responseData = await res.json();
    } catch (fallbackErr: any) {
      return {
        success: false,
        error: fallbackErr.message || fnErr.message || 'Unable to initiate Cashfree subscription.'
      };
    }
  }

  const { subscription_id, subscription_session_id, auth_link } = responseData || {};

  if (!subscription_session_id) {
    return {
      success: false,
      error: 'No subscription session received from server.'
    };
  }

  // 3. Open Cashfree hosted checkout using official SDK
  try {
    await loadCashfreeSdk();
    if (typeof window.Cashfree === 'function') {
      const cashfree = window.Cashfree({ mode: CASHFREE_CONFIG.mode });
      cashfree.subscriptionsCheckout({
        subsSessionId: subscription_session_id,
        redirectTarget: options.redirectTarget || '_self'
      }).then(res => {
        if (res?.error) {
          console.error('[Cashfree Checkout Error]', res.error);
        }
      });
    } else if (auth_link) {
      // Graceful fallback to hosted link redirect if SDK is blocked
      window.location.href = auth_link;
    }
  } catch (sdkErr: any) {
    console.warn('[Cashfree SDK warning]', sdkErr);
    if (auth_link) {
      window.location.href = auth_link;
    } else {
      return {
        success: false,
        subscription_id,
        subscription_session_id,
        error: sdkErr.message || 'Error launching Cashfree checkout.'
      };
    }
  }

  return {
    success: true,
    subscription_id,
    subscription_session_id,
    auth_link
  };
}
