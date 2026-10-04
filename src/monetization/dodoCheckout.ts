/**
 * ChoreMatrix Dodo Payments Client-Side Subscription Checkout (Test Mode Only)
 *
 * Secure Client Checkout Flow:
 * 1. Checks authenticated Supabase user session.
 * 2. Calls backend Edge Function `dodo-create-checkout` to generate a secure Checkout Session.
 * 3. Server enforces plan allowlisting, trial eligibility, and price security.
 * 4. Opens Dodo test checkout session (modal overlay or redirect).
 * 5. Entitlement is authoritatively granted by server-side webhook only.
 */

import { supabase, isSupabaseConfigured, getEnvVar } from '../config/supabase.ts';
import { DODO_CONFIG, normalizePlanTier, normalizeBillingInterval, getDodoProductId } from '../config/dodo.ts';

export interface InitiateDodoUpgradeOptions {
  email?: string;
  userId?: string;
  plan?: string;
  interval?: string;
  returnUrl?: string;
  onSuccess?: (data: any) => void;
  onClose?: () => void;
  onError?: (err: any) => void;
}

export interface InitiateDodoUpgradeResult {
  success: boolean;
  checkout_url?: string;
  product_id?: string;
  has_trial?: boolean;
  error?: string;
}

/**
 * Initiates the Dodo Payments subscription checkout flow securely via backend.
 */
export async function initiateDodoSubscription(
  options: InitiateDodoUpgradeOptions = {}
): Promise<InitiateDodoUpgradeResult> {
  // 1. Resolve authenticated user session
  let token = '';
  let userId = options.userId || '';
  let email = options.email || '';

  if (isSupabaseConfigured && supabase) {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!sessionError && session?.user) {
        token = session.access_token;
        if (!userId) userId = session.user.id;
        if (!email) email = session.user.email || '';
      }
    } catch (authErr) {
      console.warn('[Dodo Checkout] Auth session lookup error:', authErr);
    }
  }

  if (!userId || !token) {
    const err = 'User authentication required. Please sign in to upgrade your plan.';
    console.error('[Dodo Checkout]', err);
    return { success: false, error: err };
  }

  // 2. Validate plan and interval parameters
  let cleanPlan: string;
  let cleanInterval: string;
  try {
    cleanPlan = normalizePlanTier(options.plan || 'pro');
    cleanInterval = normalizeBillingInterval(options.interval || 'monthly');
  } catch (paramErr: any) {
    const err = `Invalid plan or billing interval: ${paramErr.message}`;
    console.error('[Dodo Checkout]', err);
    return { success: false, error: err };
  }

  // 3. Call backend Edge Function to generate secure checkout session
  try {
    const supabaseUrl = (getEnvVar('VITE_SUPABASE_URL') || '').replace(/\/+$/, '');
    const supabaseKey = getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY') || '';

    if (!supabaseUrl) {
      throw new Error('Supabase URL is unconfigured in client environment.');
    }

    const endpoint = `${supabaseUrl}/functions/v1/dodo-create-checkout`;
    const returnUrl = options.returnUrl || `${window.location.origin}/account.html?payment_status=submitted`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseKey
      },
      body: JSON.stringify({
        plan: cleanPlan,
        interval: cleanInterval,
        return_url: returnUrl
      })
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const textResp = await res.text();
      console.error('[Dodo Checkout] Non-JSON response from create-checkout endpoint:', res.status, textResp.slice(0, 150));
      throw new Error(`Checkout service returned unexpected response (${res.status}).`);
    }

    const data = await res.json();
    if (!res.ok || !data.success || !data.checkout_url) {
      throw new Error(data.error || 'Failed to create Dodo checkout session.');
    }

    const checkoutUrl = data.checkout_url;

    // Launch Checkout
    if (typeof window !== 'undefined') {
      // Redirect to Dodo Test Checkout URL
      window.location.href = checkoutUrl;
    }

    return {
      success: true,
      checkout_url: checkoutUrl,
      product_id: data.product_id,
      has_trial: data.has_trial
    };
  } catch (err: any) {
    const finalErr = `Dodo checkout error: ${err.message || String(err)}`;
    console.error('[Dodo Checkout Exception]', finalErr, err);
    if (typeof options.onError === 'function') {
      options.onError(err);
    }
    return {
      success: false,
      error: finalErr
    };
  }
}
