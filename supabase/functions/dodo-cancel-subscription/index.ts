/**
 * Supabase Edge Function: dodo-cancel-subscription
 *
 * Securely cancels an active or trialing Dodo subscription for an authenticated ChoreMatrix user.
 *
 * CANCELLATION POLICY: IMMEDIATE
 * - Calls Dodo API with status: "cancelled"
 * - Synchronously downgrades profiles.plan_tier to 'free' and subscription_status to 'canceled'
 * - Updates dodo_subscriptions status to 'canceled'
 * - Returns structured JSON response with cancellation confirmation
 *
 * Security:
 * - Enforces user authorization (user can only cancel their own subscription).
 * - Validates session against Supabase Auth.
 * - Verifies subscription ownership in database before calling Dodo.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

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

    const dbClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    // Lookup active or trialing Dodo subscription for this user
    const { data: subRecord } = await dbClient
      .from('dodo_subscriptions')
      .select('subscription_id, status, plan_tier, product_id, customer_id')
      .eq('user_id', user.id)
      .in('status', ['active', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let subId = subRecord?.subscription_id;

    if (!subId) {
      const { data: profile } = await dbClient
        .from('profiles')
        .select('dodo_subscription_id, subscription_status')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.subscription_status === 'canceled' || profile?.subscription_status === 'cancelled') {
        return new Response(JSON.stringify({
          success: true,
          subscription_id: profile.dodo_subscription_id || null,
          status: 'cancelled',
          plan_tier: 'free',
          message: 'Subscription is already cancelled.'
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      subId = profile?.dodo_subscription_id;
    }

    if (!subId) {
      return new Response(JSON.stringify({ error: 'No active or trialing subscription found for this account.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verify ownership in DB
    const { data: ownedSub } = await dbClient
      .from('dodo_subscriptions')
      .select('*')
      .eq('subscription_id', subId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!ownedSub) {
      const { data: profileCheck } = await dbClient
        .from('profiles')
        .select('dodo_subscription_id')
        .eq('id', user.id)
        .eq('dodo_subscription_id', subId)
        .maybeSingle();

      if (!profileCheck) {
        return new Response(JSON.stringify({ error: 'Subscription not found or not owned by authenticated user.' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (ownedSub?.status === 'canceled' || ownedSub?.status === 'cancelled') {
      return new Response(JSON.stringify({
        success: true,
        subscription_id: subId,
        status: 'cancelled',
        plan_tier: 'free',
        message: 'Subscription is already cancelled.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check Dodo API credentials
    const dodoApiKey = Deno.env.get('DODO_API_KEY');
    const dodoBaseUrl = Deno.env.get('DODO_BASE_URL') || 'https://test.dodopayments.com';

    if (!dodoApiKey) {
      console.error('[dodo-cancel-subscription] Server error: DODO_API_KEY is not configured.');
      return new Response(JSON.stringify({ error: 'Server configuration error: Dodo API key unconfigured.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const cancelEndpoint = `${dodoBaseUrl.replace(/\/+$/, '')}/subscriptions/${subId}`;
    console.log(`[dodo-cancel-subscription] Calling Dodo cancel API for sub ${subId} (user: ${user.id})`);

    const cancelRes = await fetch(cancelEndpoint, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dodoApiKey}`
      },
      body: JSON.stringify({
        status: 'cancelled'
      })
    });

    const contentType = cancelRes.headers.get('content-type') || '';
    let cancelData: any = null;

    if (contentType.includes('application/json')) {
      cancelData = await cancelRes.json();
    } else {
      const rawText = await cancelRes.text();
      console.error('[dodo-cancel-subscription] Unexpected response from Dodo:', cancelRes.status, rawText);
    }

    if (!cancelRes.ok) {
      const errorMsg = cancelData?.message || cancelData?.error?.message || cancelData?.error || 'Dodo API cancellation failed.';
      console.warn('[dodo-cancel-subscription] Dodo API error:', cancelRes.status, errorMsg);

      if (cancelRes.status === 404 || cancelRes.status === 409) {
        // Ensure local DB is consistent
        const nowIso = new Date().toISOString();
        await dbClient
          .from('profiles')
          .update({
            plan_tier: 'free',
            subscription_status: 'canceled',
            updated_at: nowIso
          })
          .eq('id', user.id);

        await dbClient
          .from('dodo_subscriptions')
          .upsert({
            user_id: user.id,
            subscription_id: subId,
            customer_id: ownedSub?.customer_id || '',
            product_id: ownedSub?.product_id || '',
            status: 'canceled',
            plan_tier: 'free',
            scheduled_change: null,
            updated_at: nowIso
          }, { onConflict: 'subscription_id' });

        return new Response(JSON.stringify({
          success: true,
          subscription_id: subId,
          status: 'cancelled',
          plan_tier: 'free',
          message: 'Subscription is already cancelled.'
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        error: errorMsg
      }), {
        status: cancelRes.status >= 400 && cancelRes.status < 500 ? cancelRes.status : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // SUCCESS: Synchronously downgrade user in local database
    const nowIso = new Date().toISOString();

    const { error: profileErr } = await dbClient
      .from('profiles')
      .update({
        plan_tier: 'free',
        subscription_status: 'canceled',
        updated_at: nowIso
      })
      .eq('id', user.id);

    if (profileErr) {
      console.error('[dodo-cancel-subscription] Profile update error:', profileErr);
    }

    const { error: subErr } = await dbClient
      .from('dodo_subscriptions')
      .upsert({
        user_id: user.id,
        subscription_id: subId,
        customer_id: ownedSub?.customer_id || '',
        product_id: ownedSub?.product_id || '',
        status: 'canceled',
        plan_tier: 'free',
        scheduled_change: null,
        updated_at: nowIso
      }, { onConflict: 'subscription_id' });

    if (subErr) {
      console.error('[dodo-cancel-subscription] Subscription record update error:', subErr);
    }

    return new Response(JSON.stringify({
      success: true,
      subscription_id: subId,
      status: 'canceled',
      plan_tier: 'free',
      message: 'Subscription cancelled. Your paid access has ended.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('[dodo-cancel-subscription error]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
