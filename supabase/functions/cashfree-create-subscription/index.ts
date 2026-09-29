/**
 * Supabase Edge Function: cashfree-create-subscription
 *
 * Securely creates a Cashfree Sandbox subscription for an authenticated ChoreMatrix user.
 * - Enforces authentication via Bearer token.
 * - Never exposes the Cashfree secret key to the client.
 * - Returns subscription_id and subscription_session_id.
 * - Uses production return domain: https://chorematrix.online
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const CASHFREE_PLANS: Record<string, { planId: string; tier: 'pro' | 'plus'; interval: 'monthly' | 'annually' }> = {
  CHOREMATRIX_PRO_MONTHLY: { planId: 'CHOREMATRIX_PRO_MONTHLY', tier: 'pro', interval: 'monthly' },
  ChoreMatrix_Pro_Annual: { planId: 'ChoreMatrix_Pro_Annual', tier: 'pro', interval: 'annually' },
  ChoreMatrix_Plus_Monthly: { planId: 'ChoreMatrix_Plus_Monthly', tier: 'plus', interval: 'monthly' },
  ChoreMatrix_Plus_Annual: { planId: 'ChoreMatrix_Plus_Annual', tier: 'plus', interval: 'annually' }
};

function resolvePlanId(plan: string, interval?: string): string | null {
  const cleanPlan = (plan || '').trim();
  if (CASHFREE_PLANS[cleanPlan]) return CASHFREE_PLANS[cleanPlan].planId;

  const cleanTier = cleanPlan.toLowerCase();
  const cleanInterval = (interval || '').toLowerCase().trim();
  const isAnnual = cleanInterval === 'annual' || cleanInterval === 'annually' || cleanInterval === 'year';

  if (cleanTier === 'pro' || cleanTier === 'household_pro') {
    return isAnnual ? 'ChoreMatrix_Pro_Annual' : 'CHOREMATRIX_PRO_MONTHLY';
  }
  if (cleanTier === 'plus' || cleanTier === 'household_plus') {
    return isAnnual ? 'ChoreMatrix_Plus_Annual' : 'ChoreMatrix_Plus_Monthly';
  }
  return null;
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
    // 1. Authenticate user from Supabase JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseAnonKey =
      Deno.env.get('SUPABASE_ANON_KEY') ||
      Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ||
      '';
    const supabaseServiceKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SECRET_KEY') ||
      Deno.env.get('SB_SECRET_KEY') ||
      '';

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false }
    });

    const { data: { user }, error: userError } = await authClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Parse request body
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const { plan, interval } = body;
    const rawPhone = body.customer_phone || body.phone || '';
    const cleanPhone = String(rawPhone).replace(/\D/g, '');

    if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 15) {
      return new Response(JSON.stringify({
        error: 'Valid customer mobile number (10 to 15 digits) is required.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const planId = resolvePlanId(plan, interval);
    if (!planId) {
      return new Response(JSON.stringify({ error: 'Invalid plan or billing interval. Must map to an authorized Cashfree sandbox plan.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const planMeta = CASHFREE_PLANS[planId];

    // Customer name from user metadata with safe fallback
    const userMetadata = user.user_metadata || {};
    const customerName = (
      userMetadata.full_name ||
      userMetadata.name ||
      userMetadata.customer_name ||
      (user.email ? user.email.split('@')[0] : 'ChoreMatrix Customer')
    ).slice(0, 100);

    // 3. Credentials and endpoints
    const appId = Deno.env.get('CASHFREE_APP_ID');
    const secretKey = Deno.env.get('CASHFREE_SECRET_KEY');
    const cashfreeBaseUrl = Deno.env.get('CASHFREE_BASE_URL') || 'https://sandbox.cashfree.com/pg';
    const returnUrlBase = Deno.env.get('CASHFREE_RETURN_URL_BASE') || 'https://chorematrix.online';

    if (!appId || !secretKey) {
      return new Response(JSON.stringify({ error: 'Cashfree credentials not configured in edge function environment.' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!supabaseServiceKey) {
      console.error('[cashfree-create-subscription] Server-side secret key (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY) not found in environment.');
      return new Response(JSON.stringify({
        error: 'Database configuration error: Server-side secret key not configured.'
      }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. Verify trial eligibility server-side using privileged client
    const dbClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });

    const { data: profile } = await dbClient
      .from('profiles')
      .select('id, trial_consumed, plan_tier, subscription_status')
      .eq('id', user.id)
      .maybeSingle();

    // Introductory trial is strictly ONE-TIME per ChoreMatrix account
    const isTrialEligible = !profile?.trial_consumed;

    // 5. Generate subscription ID (alphanumeric and underscores, max 40 chars)
    const cleanUid = user.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
    const subscriptionId = `sub_${cleanUid}_${Date.now()}`;
    const returnUrl = `${returnUrlBase.replace(/\/+$/, '')}/account.html?sub_id={subscription_id}`;

    // 6. Call Cashfree Create Subscription API
    const cashfreeEndpoint = `${cashfreeBaseUrl.replace(/\/+$/, '')}/subscriptions`;
    console.log('[cashfree-create-subscription] Calling Cashfree API:', cashfreeEndpoint, {
      subscription_id: subscriptionId,
      plan_id: planId,
      user_id: user.id,
      customer_email: user.email,
      customer_phone: cleanPhone,
      isTrialEligible
    });

    const requestPayload: any = {
      subscription_id: subscriptionId,
      customer_details: {
        customer_id: user.id,
        customer_name: customerName,
        customer_email: user.email,
        customer_phone: cleanPhone
      },
      plan_details: {
        plan_id: planId
      },
      subscription_meta: {
        return_url: returnUrl
      }
    };

    let firstChargeTime: string | null = null;
    if (isTrialEligible) {
      firstChargeTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      requestPayload.subscription_first_charge_time = firstChargeTime;
    }

    const cashfreeRes = await fetch(cashfreeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id': appId,
        'x-client-secret': secretKey
      },
      body: JSON.stringify(requestPayload)
    });

    console.log('[cashfree-create-subscription] Cashfree response status:', cashfreeRes.status);

    if (!cashfreeRes.ok) {
      const errText = await cashfreeRes.text();
      let errDetail = errText;
      try {
        const parsed = JSON.parse(errText);
        errDetail = parsed.message || parsed.error || errText;
      } catch {}
      console.error('[Cashfree Gateway Error]', cashfreeRes.status, errDetail);
      return new Response(JSON.stringify({
        error: `Cashfree gateway error (${cashfreeRes.status}): ${errDetail}`,
        status: cashfreeRes.status,
        details: errText
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let data: any = {};
    try {
      data = await cashfreeRes.json();
    } catch {
      data = {};
    }
    console.log('[cashfree-create-subscription] Cashfree response body:', JSON.stringify(data));

    const sessionId =
      data.subscription_session_id ||
      data.data?.subscription_session_id ||
      data.subReferenceId ||
      data.data?.subReferenceId;

    if (!sessionId) {
      console.error('[cashfree-create-subscription] Missing subscription_session_id:', data);
      return new Response(JSON.stringify({
        error: 'Gateway response missing subscription_session_id.',
        response: data
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 7. Record initialized subscription in database using Service Role
    const { error: dbError } = await dbClient
      .from('cashfree_subscriptions')
      .insert({
        user_id: user.id,
        subscription_id: subscriptionId,
        plan_id: planId,
        plan_tier: planMeta.tier,
        billing_interval: planMeta.interval,
        status: 'INITIALIZED',
        subscription_session_id: sessionId,
        customer_phone: cleanPhone,
        has_trial: isTrialEligible,
        first_charge_date: firstChargeTime
      });

    if (dbError) {
      console.error('[cashfree-create-subscription] DB insert error:', dbError);
      throw dbError;
    }

    // 8. Return to frontend (Never expose secretKey)
    return new Response(JSON.stringify({
      subscription_id: subscriptionId,
      subscription_session_id: sessionId,
      auth_link: data.auth_link || data.data?.auth_link || null,
      plan_id: planId,
      plan_tier: planMeta.tier,
      billing_interval: planMeta.interval,
      is_trial_eligible: isTrialEligible,
      has_trial: isTrialEligible,
      trial_days: isTrialEligible ? 7 : 0
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('[cashfree-create-subscription exception]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
