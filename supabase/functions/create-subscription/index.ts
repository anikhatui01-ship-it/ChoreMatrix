/**
 * Supabase Edge Function: create-subscription
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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

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
    const body = await req.json().catch(() => ({}));
    const { plan, interval, phone } = body;

    const planId = resolvePlanId(plan, interval);
    if (!planId) {
      return new Response(JSON.stringify({ error: 'Invalid plan or billing interval. Must map to an authorized Cashfree sandbox plan.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const planMeta = CASHFREE_PLANS[planId];

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

    // 4. Generate subscription ID (alphanumeric and underscores, max 40 chars)
    const cleanUid = user.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
    const subscriptionId = `sub_${cleanUid}_${Date.now()}`;
    const returnUrl = `${returnUrlBase.replace(/\/+$/, '')}/account.html?sub_id={subscription_id}`;

    // 5. Call Cashfree Create Subscription API
    const cashfreeRes = await fetch(`${cashfreeBaseUrl.replace(/\/+$/, '')}/subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id': appId,
        'x-client-secret': secretKey
      },
      body: JSON.stringify({
        subscription_id: subscriptionId,
        customer_details: {
          customer_id: user.id,
          customer_email: user.email,
          customer_phone: phone || '9999999999'
        },
        plan_details: {
          plan_id: planId
        },
        subscription_meta: {
          return_url: returnUrl
        }
      })
    });

    if (!cashfreeRes.ok) {
      const errText = await cashfreeRes.text();
      console.error('[Cashfree Error]', cashfreeRes.status, errText);
      return new Response(JSON.stringify({
        error: 'Cashfree subscription creation rejected by gateway.',
        status: cashfreeRes.status
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const data = await cashfreeRes.json();
    const sessionId = data.subscription_session_id || data.data?.subscription_session_id || data.subReferenceId;

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'Gateway response missing subscription_session_id.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 6. Record initialized subscription in database using Service Role
    if (supabaseServiceKey) {
      const dbClient = createClient(supabaseUrl, supabaseServiceKey);
      await dbClient.from('cashfree_subscriptions').insert({
        user_id: user.id,
        subscription_id: subscriptionId,
        plan_id: planId,
        plan_tier: planMeta.tier,
        billing_interval: planMeta.interval,
        status: 'INITIALIZED',
        subscription_session_id: sessionId
      }).catch(err => {
        console.warn('[DB Error recording subscription]', err.message);
      });
    }

    // 7. Return to frontend (Never expose secretKey)
    return new Response(JSON.stringify({
      subscription_id: subscriptionId,
      subscription_session_id: sessionId,
      auth_link: data.auth_link || data.data?.auth_link || null,
      plan_id: planId,
      plan_tier: planMeta.tier,
      billing_interval: planMeta.interval
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('[create-subscription exception]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
