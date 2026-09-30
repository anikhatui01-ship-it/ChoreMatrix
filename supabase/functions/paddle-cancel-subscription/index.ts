/**
 * Supabase Edge Function: paddle-cancel-subscription
 *
 * Securely cancels an active or trialing Paddle subscription for an authenticated ChoreMatrix user.
 *
 * CANCELLATION POLICY: IMMEDIATE
 * - Calls Paddle API with effective_from: "immediately"
 * - Synchronously downgrades profiles.plan_tier to 'free' and subscription_status to 'canceled'
 * - Updates paddle_subscriptions status to 'canceled'
 * - Returns structured JSON response with cancellation confirmation
 *
 * Security:
 * - Enforces user authorization (user can only cancel their own subscription).
 * - Validates session against Supabase Auth.
 * - Verifies subscription ownership in database before calling Paddle.
 * - Never accepts a subscription_id directly from client without ownership validation.
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

    // Do NOT accept subscription_id from client body — always resolve from DB for the authenticated user
    // Lookup active or trialing subscription for this user
    const { data: subRecord } = await dbClient
      .from('paddle_subscriptions')
      .select('subscription_id, status, scheduled_change, plan_tier')
      .eq('user_id', user.id)
      .like('subscription_id', 'sub_%')
      .in('status', ['active', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let subId = subRecord?.subscription_id;

    if (!subId) {
      // Fallback to profile
      const { data: profile } = await dbClient
        .from('profiles')
        .select('paddle_subscription_id, subscription_status')
        .eq('id', user.id)
        .maybeSingle();

      // If subscription_status is already canceled, return idempotent success
      if (profile?.subscription_status === 'canceled') {
        return new Response(JSON.stringify({
          success: true,
          subscription_id: profile.paddle_subscription_id || null,
          status: 'canceled',
          message: 'Subscription is already cancelled.'
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      subId = profile?.paddle_subscription_id;
    }

    if (!subId) {
      return new Response(JSON.stringify({ error: 'No active or trialing subscription found for this account.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verify ownership in DB: User can ONLY cancel their own subscription
    const { data: ownedSub } = await dbClient
      .from('paddle_subscriptions')
      .select('*')
      .eq('subscription_id', subId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!ownedSub) {
      // If the subId came from profile fallback but doesn't exist in paddle_subscriptions,
      // we still proceed (the subscription may only be in profiles)
      const { data: profileCheck } = await dbClient
        .from('profiles')
        .select('paddle_subscription_id')
        .eq('id', user.id)
        .eq('paddle_subscription_id', subId)
        .maybeSingle();

      if (!profileCheck) {
        return new Response(JSON.stringify({ error: 'Subscription not found or not owned by authenticated user.' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // If subscription is already canceled in our DB, return idempotent success
    if (ownedSub?.status === 'canceled') {
      return new Response(JSON.stringify({
        success: true,
        subscription_id: subId,
        status: 'canceled',
        message: 'Subscription is already cancelled.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check Paddle API credentials
    const paddleApiKey = Deno.env.get('PADDLE_API_KEY');
    const paddleBaseUrl = Deno.env.get('PADDLE_BASE_URL') || 'https://sandbox-api.paddle.com';

    if (!paddleApiKey) {
      console.error('[paddle-cancel-subscription] Server error: PADDLE_API_KEY is not configured in Supabase secrets.');
      return new Response(JSON.stringify({ error: 'Server configuration error: Paddle API key unconfigured.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const cancelEndpoint = `${paddleBaseUrl.replace(/\/+$/, '')}/subscriptions/${subId}/cancel`;
    console.log(`[paddle-cancel-subscription] Calling Paddle cancel API for sub ${subId} (user: ${user.id}) with effective_from=immediately`);

    // IMMEDIATE CANCELLATION: effective_from = "immediately"
    const cancelRes = await fetch(cancelEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${paddleApiKey}`
      },
      body: JSON.stringify({
        effective_from: 'immediately'
      })
    });

    const contentType = cancelRes.headers.get('content-type') || '';
    let cancelData: any = null;

    if (contentType.includes('application/json')) {
      cancelData = await cancelRes.json();
    } else {
      const rawText = await cancelRes.text();
      console.error('[paddle-cancel-subscription] Unexpected non-JSON response from Paddle:', cancelRes.status, rawText);
      return new Response(JSON.stringify({
        error: `Payment provider returned unexpected response (${cancelRes.status}).`
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!cancelRes.ok) {
      const errorCode = cancelData?.error?.code;
      const errorMsg = cancelData?.error?.detail || cancelData?.error?.message || cancelData?.message || 'Paddle API cancellation failed.';
      console.warn('[paddle-cancel-subscription] Paddle API error:', cancelRes.status, errorCode, errorMsg);

      // Handle idempotency: subscription already canceled or locked
      if (
        cancelRes.status === 409 ||
        errorCode === 'subscription_locked_for_update' ||
        errorCode === 'subscription_already_canceled' ||
        errorCode === 'subscription_locked_pending_changes' ||
        errorCode === 'subscription_not_active'
      ) {
        // Even though Paddle says it's already done, ensure our DB is consistent
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
          .from('paddle_subscriptions')
          .update({
            status: 'canceled',
            plan_tier: 'free',
            scheduled_change: null,
            updated_at: nowIso
          })
          .eq('subscription_id', subId);

        return new Response(JSON.stringify({
          success: true,
          subscription_id: subId,
          status: 'canceled',
          message: 'Subscription is already cancelled.'
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        error: errorMsg,
        code: errorCode
      }), {
        status: cancelRes.status >= 400 && cancelRes.status < 500 ? cancelRes.status : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // SUCCESS: Paddle confirmed immediate cancellation
    // Synchronously downgrade the user in our database
    const nowIso = new Date().toISOString();

    // Update profiles: revert to free tier immediately
    const { error: profileErr } = await dbClient
      .from('profiles')
      .update({
        plan_tier: 'free',
        subscription_status: 'canceled',
        updated_at: nowIso
      })
      .eq('id', user.id);

    if (profileErr) {
      console.error('[paddle-cancel-subscription] Profile update error:', profileErr);
    }

    // Update paddle_subscriptions: mark as canceled
    const { error: subErr } = await dbClient
      .from('paddle_subscriptions')
      .update({
        status: 'canceled',
        plan_tier: 'free',
        scheduled_change: null,
        updated_at: nowIso
      })
      .eq('subscription_id', subId);

    if (subErr) {
      console.error('[paddle-cancel-subscription] Subscription record update error:', subErr);
    }

    console.log(`[paddle-cancel-subscription] Immediate cancellation confirmed for ${subId}. User ${user.id} downgraded to free tier.`);

    return new Response(JSON.stringify({
      success: true,
      subscription_id: subId,
      status: 'canceled',
      message: 'Subscription cancelled. Your paid access has ended.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    console.error('[paddle-cancel-subscription error]', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
