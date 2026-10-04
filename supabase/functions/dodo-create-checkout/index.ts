/**
 * Supabase Edge Function: dodo-create-checkout
 *
 * Securely creates a Dodo Payments checkout session for an authenticated user.
 *
 * Security:
 * - Validates user session token.
 * - Server-side plan/interval validation and allowlisted product mapping.
 * - Enforces one-trial-per-account invariant based on profiles.trial_consumed.
 * - Keeps DODO_API_KEY strictly server-side.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const CANONICAL_PRODUCT_MAP: Record<string, string> = {
  'pro_monthly': Deno.env.get('VITE_DODO_PRO_MONTHLY_PRODUCT_ID') || 'pdt_01m3q8bc75wg442x3h217njd0k',
  'pro_annual': Deno.env.get('VITE_DODO_PRO_ANNUAL_PRODUCT_ID') || 'pdt_01m3rbzjm8h0t0np80k7nqfz85',
  'plus_monthly': Deno.env.get('VITE_DODO_PLUS_MONTHLY_PRODUCT_ID') || 'pdt_01m3rc6mfgdq0b7fys5s3j4t98',
  'plus_annual': Deno.env.get('VITE_DODO_PLUS_ANNUAL_PRODUCT_ID') || 'pdt_01m3rc42y9mdz16q2cn48q9z95'
};

function normalizePlan(plan: string | null | undefined): string {
  if (!plan) throw new Error('Missing plan parameter');
  const clean = plan.trim().toLowerCase();
  if (clean === 'pro' || clean === 'household_pro') return 'pro';
  if (clean === 'plus' || clean === 'household_plus' || clean === 'family_plus') return 'plus';
  throw new Error(`Invalid plan "${plan}"`);
}

function normalizeInterval(interval: string | null | undefined): string {
  if (!interval) throw new Error('Missing interval parameter');
  const clean = interval.trim().toLowerCase();
  if (clean === 'monthly' || clean === 'month') return 'monthly';
  if (clean === 'annual' || clean === 'annually' || clean === 'yearly' || clean === 'year') return 'annual';
  throw new Error(`Invalid interval "${interval}"`);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || '';

    // Validate user session token
    const authClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    const { data: { user }, error: userError } = await authClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let reqBody: any = {};
    try {
      reqBody = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Malformed JSON payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const plan = normalizePlan(reqBody.plan);
    const interval = normalizeInterval(reqBody.interval);
    const planKey = `${plan}_${interval}`;
    const productId = CANONICAL_PRODUCT_MAP[planKey];

    if (!productId) {
      return new Response(JSON.stringify({ error: `Unmapped plan/interval: ${planKey}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const dbClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    // Check user profile for trial status and active subscription
    const { data: profile } = await dbClient
      .from('profiles')
      .select('id, trial_consumed, plan_tier, subscription_status')
      .eq('id', user.id)
      .maybeSingle();

    if (profile && (profile.subscription_status === 'active' || profile.subscription_status === 'trialing')) {
      return new Response(JSON.stringify({
        error: 'Your account already has an active subscription. Manage your subscription in Account Settings.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const isTrialConsumed = Boolean(profile?.trial_consumed);
    const isTrialEligible = !isTrialConsumed;

    const dodoApiKey = Deno.env.get('DODO_API_KEY');
    const dodoBaseUrl = Deno.env.get('DODO_BASE_URL') || 'https://test.dodopayments.com';

    if (!dodoApiKey) {
      console.error('[dodo-create-checkout] DODO_API_KEY not configured.');
      return new Response(JSON.stringify({ error: 'Server configuration error: Dodo API key unconfigured.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const checkoutEndpoint = `${dodoBaseUrl.replace(/\/+$/, '')}/checkouts`;

    const requestPayload: Record<string, any> = {
      product_cart: [
        {
          product_id: productId,
          quantity: 1
        }
      ],
      customer: {
        email: user.email || undefined
      },
      metadata: {
        user_id: user.id
      },
      return_url: reqBody.return_url || `${req.headers.get('origin') || 'https://chorematrix.online'}/account.html?payment_status=submitted`
    };

    if (isTrialEligible) {
      requestPayload.subscription_data = {
        trial_period_days: 7
      };
    }

    const response = await fetch(checkoutEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dodoApiKey}`
      },
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[dodo-create-checkout] Dodo API checkout creation failed:', response.status, errText);
      return new Response(JSON.stringify({
        error: `Dodo checkout initialization failed (${response.status})`
      }), {
        status: response.status >= 400 && response.status < 500 ? response.status : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    const checkoutUrl = data.checkout_url || data.payment_link || data.url;
    const sessionId = data.session_id || data.id;

    if (!checkoutUrl) {
      return new Response(JSON.stringify({ error: 'Dodo checkout response missing checkout_url.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      checkout_url: checkoutUrl,
      session_id: sessionId,
      product_id: productId,
      has_trial: isTrialEligible
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('[dodo-create-checkout error]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
