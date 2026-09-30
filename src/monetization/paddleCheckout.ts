/**
 * ChoreMatrix Paddle Client-Side Subscription Checkout
 *
 * Integrates Paddle.js for sandbox checkout:
 * 1. Checks authenticated Supabase user profile for trial consumption state.
 * 2. If trial is already consumed, selects Price B (standard monthly, no trial).
 * 3. If trial is not consumed, selects Price A (7-day free trial, card required).
 * 4. Launches Paddle.js overlay checkout with prefilled user email and customData.user_id.
 * 5. Server/webhook is strictly authoritative for entitlement.
 */

import { supabase, isSupabaseConfigured } from '../config/supabase.ts';
import { PADDLE_CONFIG, getPaddlePriceId } from '../config/paddle.ts';

declare global {
  interface Window {
    Paddle?: {
      Environment: {
        set: (env: string) => void;
      };
      Initialize: (options: {
        token: string;
        eventCallback?: (event: { name: string; data: any }) => void;
      }) => void;
      Checkout: {
        open: (options: Record<string, any>) => void;
        close: () => void;
        updateItems: (items: Array<{ priceId: string; quantity: number }>) => void;
      };
      Initialized?: boolean;
    };
  }
}

const PADDLE_JS_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js';
let paddleInitPromise: Promise<void> | null = null;

/**
 * Loads the Paddle.js v2 SDK script into the browser document.
 */
export async function loadPaddleJs(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.Paddle && window.Paddle.Checkout) return;

  const existingScript = document.querySelector(`script[src="${PADDLE_JS_URL}"]`);
  if (existingScript) {
    return new Promise((resolve, reject) => {
      if (window.Paddle && window.Paddle.Checkout) return resolve();
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Paddle.js SDK')));
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PADDLE_JS_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Paddle.js SDK script from CDN.'));
    document.head.appendChild(script);
  });
}

/**
 * Initializes the Paddle singleton instance with client token and environment.
 */
export async function initializePaddleInstance(
  onEvent?: (event: { name: string; data: any }) => void
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (paddleInitPromise) return paddleInitPromise;

  paddleInitPromise = (async () => {
    await loadPaddleJs();
    if (!window.Paddle) {
      throw new Error('Paddle.js SDK not available after loading.');
    }

    window.Paddle.Environment.set(PADDLE_CONFIG.environment);
    window.Paddle.Initialize({
      token: PADDLE_CONFIG.clientToken,
      eventCallback: (event) => {
        if (typeof onEvent === 'function') {
          onEvent(event);
        }
      }
    });
  })();

  return paddleInitPromise;
}

export interface InitiatePaddleUpgradeOptions {
  onSuccess?: (data: any) => void;
  onClose?: () => void;
  onError?: (err: any) => void;
}

export interface InitiatePaddleUpgradeResult {
  success: boolean;
  price_id?: string;
  has_trial?: boolean;
  error?: string;
}

/**
 * Initiates the Paddle subscription checkout flow:
 * 1. Authenticates current user session.
 * 2. Checks profile to enforce one-trial-per-account invariant.
 * 3. Prevents duplicate checkout if user already has an active subscription.
 * 4. Opens Paddle overlay checkout with user_id in customData.
 */
export async function initiatePaddleSubscription(
  options: InitiatePaddleUpgradeOptions = {}
): Promise<InitiatePaddleUpgradeResult> {
  if (!isSupabaseConfigured || !supabase) {
    const err = 'Supabase is not configured. Cloud subscription checkout requires active cloud configuration.';
    console.error('[Paddle Checkout]', err);
    return { success: false, error: err };
  }

  // 1. Get authenticated user session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.user) {
    const err = 'User authentication required. Please sign in to upgrade your plan.';
    console.error('[Paddle Checkout]', err, sessionError);
    return { success: false, error: err };
  }

  const user = session.user;

  // 2. Query profile state to check trial consumption and active subscriptions
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, trial_consumed, plan_tier, subscription_status')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    console.warn('[Paddle Checkout] Profile fetch warning:', profileError);
  }

  // Prevent duplicate active subscriptions
  if (profile?.subscription_status === 'active' || profile?.subscription_status === 'trialing') {
    const err = 'Your account already has an active subscription. Manage your subscription in Account Settings.';
    return { success: false, error: err };
  }

  // Authoritative trial eligibility determination
  const isTrialEligible = !profile?.trial_consumed;
  const selectedPriceId = getPaddlePriceId(isTrialEligible);

  try {
    await initializePaddleInstance((event) => {
      console.log('[Paddle.js Event]', event.name, event.data);
      if (event.name === 'checkout.completed') {
        if (typeof options.onSuccess === 'function') {
          options.onSuccess(event.data);
        }
        // Redirect to account page with submitted status notice (entitlement verified via webhook)
        window.location.href = `/account.html?payment_status=submitted`;
      } else if (event.name === 'checkout.closed') {
        if (typeof options.onClose === 'function') {
          options.onClose();
        }
      } else if (event.name === 'checkout.error') {
        if (typeof options.onError === 'function') {
          options.onError(event.data);
        }
      }
    });

    if (!window.Paddle || !window.Paddle.Checkout) {
      throw new Error('Paddle.js checkout is not ready. Please refresh the page and try again.');
    }

    // Determine dark mode
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    window.Paddle.Checkout.open({
      items: [
        {
          priceId: selectedPriceId,
          quantity: 1
        }
      ],
      customer: {
        email: user.email
      },
      customData: {
        user_id: user.id
      },
      settings: {
        variant: 'one-page',
        displayMode: 'overlay',
        theme: isDark ? 'dark' : 'light',
        allowLogout: false,
        successUrl: `${window.location.origin}/account.html?payment_status=submitted`
      }
    });

    return {
      success: true,
      price_id: selectedPriceId,
      has_trial: isTrialEligible
    };
  } catch (err: any) {
    const finalErr = `Paddle checkout error: ${err.message || String(err)}`;
    console.error('[Paddle Checkout Exception]', finalErr, err);
    return {
      success: false,
      error: finalErr
    };
  }
}
