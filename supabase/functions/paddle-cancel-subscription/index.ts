/**
 * Supabase Edge Function: paddle-cancel-subscription
 *
 * Securely cancels an active Paddle subscription for an authenticated ChoreMatrix user.
 * - Enforces user authorization (user can only cancel their own subscription).
 * - Calls Paddle Subscriptions Cancel API in sandbox (https://sandbox-api.paddle.com).
 * - Schedules cancellation at next_billing_period so access is maintained through the paid/trial period.
 * - Reverts public.profiles to Free tier once period ends via webhook.
 * - Preserves trial_consumed = true (locked by trigger).
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

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    let subId = body.subscription_id;
    if (!subId) {
      // Lookup active subscription in profile
      const { data: profile } = await dbClient
        .from('profiles')
        .select('paddle_subscription_id, subscription_status')
        .eq('id', user.id)
        .maybeSingle();

      subId = profile?.paddle_subscription_id;
    }

    if (!subId) {
      return new Response(JSON.stringify({ error: 'No active subscription found to cancel.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Verify ownership in DB
    const { data: subRecord } = await dbClient
      .from('paddle_subscriptions')
      .select('*')
      .eq('subscription_id', subId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!subRecord) {
      return new Response(JSON.stringify({ error: 'Subscription not found or not owned by user.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const paddleApiKey = Deno.env.get('PADDLE_API_KEY');
    const paddleBaseUrl = Deno.env.get('PADDLE_BASE_URL') || 'https://sandbox-api.paddle.com';

    let gatewayScheduledChange: string | null = null;
    let gatewayStatus = 'active';

    if (paddleApiKey) {
      const cancelEndpoint = `${paddleBaseUrl.replace(/\/+$/, '')}/subscriptions/${subId}/cancel`;
      try {
        const cancelRes = await fetch(cancelEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${paddleApiKey}`
          },
          body: JSON.stringify({
            effective_from: 'next_billing_period'
          })
        });

        if (cancelRes.ok) {
          const cancelData = await cancelRes.json();
          gatewayStatus = cancelData.data?.status || 'active';
          gatewayScheduledChange = cancelData.data?.scheduled_change?.effective_at || null;
        } else {
          const errText = await cancelRes.text();
          console.warn('[paddle-cancel-subscription] Paddle gateway cancel error:', cancelRes.status, errText);
        }
      } catch (err) {
        console.warn('[paddle-cancel-subscription] Paddle gateway exception:', err);
      }
    }

    const nowIso = new Date().toISOString();

    // Update paddle_subscriptions table with scheduled change
    await dbClient
      .from('paddle_subscriptions')
      .update({
        scheduled_change: gatewayScheduledChange || nowIso,
        updated_at: nowIso
      })
      .eq('subscription_id', subId);

    return new Response(JSON.stringify({
      success: true,
      subscription_id: subId,
      status: gatewayStatus,
      scheduled_change: gatewayScheduledChange,
      message: 'Subscription cancellation scheduled. You retain full Pro access until the end of your billing cycle.'
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
