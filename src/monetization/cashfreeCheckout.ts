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
      checkout: (options: {
        subsSessionId?: string;
        paymentSessionId?: string;
        redirectTarget?: '_self' | '_blank' | '_modal';
      }) => Promise<{ error?: { message?: string; code?: string; type?: string }; redirect?: boolean } | void>;
      subscriptionsCheckout?: (options: {
        subsSessionId: string;
        redirectTarget?: '_self' | '_blank' | '_modal';
      }) => Promise<{ error?: { message?: string; code?: string; type?: string } } | void>;
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
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Cashfree SDK script')));
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
 * Opens the Cashfree hosted subscription checkout using the official JS SDK in sandbox mode.
 * - Validates subscription session ID.
 * - Reaches cashfree.checkout() and catches any SDK error.
 * - Delegates subscription sessions to SDK subscription handler for SDK v3.
 * - Surfaces all SDK errors with full context.
 */
export async function runCashfreeSdkCheckout(
  subsSessionId: string,
  redirectTarget: '_self' | '_blank' | '_modal' = '_self'
): Promise<{ success: boolean; error?: string }> {
  if (!subsSessionId || typeof subsSessionId !== 'string' || !subsSessionId.trim()) {
    return {
      success: false,
      error: 'Invalid or missing subscription session ID received from server.'
    };
  }

  const cleanSessionId = subsSessionId.trim();

  try {
    await loadCashfreeSdk();
    if (typeof window === 'undefined' || typeof window.Cashfree !== 'function') {
      const err = 'Cashfree JS SDK is not available. Please disable ad blockers and refresh the page.';
      console.error('[Cashfree SDK]', err);
      return { success: false, error: err };
    }

    console.log('[Cashfree SDK] Initializing Cashfree instance in sandbox mode...');
    const cashfree = window.Cashfree({ mode: 'sandbox' });

    let checkoutError: string | null = null;
    let checkoutReached = false;

    // Requirement 4: Verify cashfree.checkout() is actually reached
    if (typeof cashfree.checkout === 'function') {
      checkoutReached = true;
      console.log('[Cashfree SDK] cashfree.checkout() reached. Calling with options:', {
        subsSessionId: cleanSessionId,
        redirectTarget
      });

      try {
        const checkoutRes = await Promise.resolve(
          cashfree.checkout({
            subsSessionId: cleanSessionId,
            redirectTarget
          } as any)
        );

        console.log('[Cashfree SDK] cashfree.checkout() response:', checkoutRes);

        if (checkoutRes && checkoutRes.error) {
          const rawMsg = checkoutRes.error.message || checkoutRes.error.code || JSON.stringify(checkoutRes.error);
          console.warn('[Cashfree SDK] cashfree.checkout() returned SDK error:', checkoutRes.error);

          // If Cashfree JS v3 rejects checkout() due to missing paymentSessionId for subscriptions,
          // dynamically delegate to the SDK subscription handler to render hosted checkout
          const subsHandler = (cashfree as any)?.subscriptionsCheckout;
          if (typeof subsHandler === 'function') {
            console.log('[Cashfree SDK] Delegating to subscription checkout handler with subsSessionId:', cleanSessionId);
            try {
              const subsRes = await Promise.resolve(
                subsHandler.call(cashfree, {
                  subsSessionId: cleanSessionId,
                  redirectTarget
                })
              );
              console.log('[Cashfree SDK] subscription handler response:', subsRes);
              if (subsRes && subsRes.error) {
                const subsMsg = subsRes.error.message || subsRes.error.code || JSON.stringify(subsRes.error);
                console.error('[Cashfree SDK] Subscriptions checkout error:', subsMsg);
                return { success: false, error: subsMsg };
              }
              return { success: true };
            } catch (subsErr: any) {
              const subsExc = subsErr.message || String(subsErr);
              console.error('[Cashfree SDK] Subscriptions checkout exception:', subsExc);
              return { success: false, error: subsExc };
            }
          }

          // Requirement 5: Catch and display exact Cashfree SDK error
          return {
            success: false,
            error: rawMsg
          };
        } else {
          return { success: true };
        }
      } catch (err: any) {
        checkoutError = err.message || String(err);
        console.warn('[Cashfree SDK] cashfree.checkout() threw exception:', err);
      }
    } else {
      console.warn('[Cashfree SDK] cashfree.checkout is not a function on Cashfree instance.');
    }

    if (checkoutError) {
      return {
        success: false,
        error: checkoutError
      };
    }

    if (!checkoutReached) {
      return {
        success: false,
        error: 'Cashfree SDK checkout method could not be found.'
      };
    }

    return { success: true };
  } catch (sdkErr: any) {
    const finalErr = `Cashfree SDK error: ${sdkErr.message || String(sdkErr)}`;
    console.error('[Cashfree SDK Error]', finalErr, sdkErr);
    return {
      success: false,
      error: finalErr
    };
  }
}

/**
 * Initiates the Cashfree Sandbox subscription upgrade flow:
 * 1. Validates plan mapping against existing Cashfree sandbox plans.
 * 2. Validates user authentication and phone number.
 * 3. Logs request to Edge Function: cashfree-create-subscription.
 * 4. Logs HTTP status and response body from that function.
 * 5. Verifies returned field is subscription_session_id.
 * 6. Verifies cashfree.checkout() is reached and catches exact SDK errors.
 */
export async function initiateCashfreeSubscription(
  options: InitiateUpgradeOptions
): Promise<InitiateUpgradeResult> {
  const planId = getCashfreePlanId(options.plan, options.interval);
  if (!planId) {
    const err = `Plan "${options.plan}" is not a recognized paid tier. Only Pro and Plus can be upgraded.`;
    console.error('[Cashfree Checkout]', err);
    return { success: false, error: err };
  }

  // Validate mobile number: 10-15 digits after stripping non-digits
  const cleanPhone = String(options.phone || '').replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 15) {
    const err = 'A valid mobile number (10 to 15 digits) is required for subscription authorization.';
    console.error('[Cashfree Checkout]', err);
    return { success: false, error: err };
  }

  if (!isSupabaseConfigured || !supabase) {
    const err = 'Supabase is not configured. Cloud subscription checkout requires active cloud configuration.';
    console.error('[Cashfree Checkout]', err);
    return { success: false, error: err };
  }

  // 1. Get authenticated user session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    const err = 'User authentication required. Please sign in to upgrade your plan.';
    console.error('[Cashfree Checkout]', err, sessionError);
    return { success: false, error: err };
  }

  const requestPayload = {
    plan: options.plan,
    interval: options.interval || 'monthly',
    customer_phone: cleanPhone,
    phone: cleanPhone
  };

  // Requirement 1: Log the request to the create-subscription Edge Function
  console.log('[Cashfree Checkout] Request to cashfree-create-subscription:', {
    payload: requestPayload,
    user_id: session.user?.id,
    user_email: session.user?.email
  });

  const supabaseUrl = getEnvVar('VITE_SUPABASE_URL') || getEnvVar('SUPABASE_URL') || '';
  const supabaseKey = getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY') || getEnvVar('SUPABASE_PUBLISHABLE_KEY') || '';

  let responseData: any = null;
  let callErrorMessage: string | null = null;

  // 2. Call Supabase Edge Function: cashfree-create-subscription
  try {
    const { data, error } = await supabase.functions.invoke('cashfree-create-subscription', {
      body: requestPayload
    });

    if (error) {
      let errBody: any = null;
      let status = 500;
      if ((error as any).context && typeof (error as any).context.text === 'function') {
        try {
          const raw = await (error as any).context.text();
          try {
            errBody = JSON.parse(raw);
          } catch {
            errBody = raw;
          }
          status = (error as any).context.status || 500;
        } catch {}
      }

      // Requirement 2: Log HTTP status and response body
      console.warn('[Cashfree Checkout] create-subscription error status:', status, 'body:', errBody || error.message);

      const parsedError = errBody?.error || errBody?.message || (typeof errBody === 'string' ? errBody : null) || error.message;
      callErrorMessage = `Server error (${status}): ${parsedError}`;
    } else {
      responseData = data;
      // Requirement 2: Log HTTP status and response body
      console.log('[Cashfree Checkout] create-subscription response status: 200, body:', responseData);
    }
  } catch (fnErr: any) {
    console.warn('[Cashfree Checkout] supabase.functions.invoke exception:', fnErr);
    callErrorMessage = fnErr.message || 'Edge function invocation failed.';
  }

  // Fallback: direct HTTP fetch to Edge Function endpoint with apikey & Authorization
  if (!responseData && supabaseUrl) {
    const cleanUrl = supabaseUrl.replace(/\/+$/, '');
    const directEndpoint = `${cleanUrl}/functions/v1/cashfree-create-subscription`;

    console.log('[Cashfree Checkout] Attempting direct fetch fallback to:', directEndpoint);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      };
      if (supabaseKey) {
        headers['apikey'] = supabaseKey;
      }

      const res = await fetch(directEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload)
      });

      const resText = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(resText);
      } catch {
        parsed = resText;
      }

      // Requirement 2: Log HTTP status and response body
      console.log(`[Cashfree Checkout] Direct fetch status: ${res.status}, body:`, parsed);

      if (res.ok) {
        responseData = parsed;
        callErrorMessage = null;
      } else {
        const errDetail = parsed?.error || parsed?.message || (typeof parsed === 'string' ? parsed : `HTTP ${res.status}`);
        callErrorMessage = `Server error (${res.status}): ${errDetail}`;
      }
    } catch (fallbackErr: any) {
      console.error('[Cashfree Checkout] Direct fetch exception:', fallbackErr);
      if (!callErrorMessage) {
        callErrorMessage = fallbackErr.message || 'Direct connection to payment endpoint failed.';
      }
    }
  }

  if (!responseData) {
    const finalErr = callErrorMessage || 'Unable to connect to Cashfree subscription service.';
    console.error('[Cashfree Checkout] Subscription initiation failed:', finalErr);
    return {
      success: false,
      error: finalErr
    };
  }

  // Requirement 3: Verify the returned field is subscription_session_id
  const subscriptionId = responseData.subscription_id || responseData.data?.subscription_id;
  const subscriptionSessionId =
    responseData.subscription_session_id ||
    responseData.data?.subscription_session_id;

  console.log('[Cashfree Checkout] Verifying subscription_session_id in response:', {
    subscription_id: subscriptionId,
    subscription_session_id: subscriptionSessionId
  });

  if (!subscriptionSessionId || typeof subscriptionSessionId !== 'string' || !subscriptionSessionId.trim()) {
    const err = responseData.error || 'Server response did not contain a valid subscription_session_id.';
    console.error('[Cashfree Checkout]', err, responseData);
    return {
      success: false,
      subscription_id: subscriptionId,
      error: err
    };
  }

  console.log('[Cashfree Checkout] subscription_session_id verified:', subscriptionSessionId);

  // Requirement 4 & 5: Open Cashfree hosted checkout using official SDK
  const checkoutResult = await runCashfreeSdkCheckout(
    subscriptionSessionId,
    options.redirectTarget || '_self'
  );

  if (!checkoutResult.success) {
    console.error('[Cashfree Checkout] Checkout failed with SDK error:', checkoutResult.error);
    return {
      success: false,
      subscription_id: subscriptionId,
      subscription_session_id: subscriptionSessionId,
      error: checkoutResult.error
    };
  }

  return {
    success: true,
    subscription_id: subscriptionId,
    subscription_session_id: subscriptionSessionId,
    auth_link: responseData.auth_link || responseData.data?.auth_link || null
  };
}
