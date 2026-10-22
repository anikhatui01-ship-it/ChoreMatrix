/**
 * Supabase Edge Function: delete-account
 *
 * Secure, authenticated server-side account and personal data deletion workflow.
 *
 * PRIVACY & SAFETY RULES:
 * 1. Requires valid user session token via Authorization: Bearer <token>.
 * 2. Active Subscription Guard:
 *    Refuses deletion if the user has an active or trialing paid subscription.
 *    Users must explicitly cancel their subscription first to prevent unmanaged recurring charges.
 * 3. Data Deletion:
 *    - Deletes user from auth.users (cascading to public.households, members, tasks, plans, profiles).
 *    - Anonymizes public.user_feedback by nulling email and user_id.
 * 4. Data Retention for Legal/Tax Compliance:
 *    - Historical webhook logs and billing transaction IDs are preserved in de-identified form
 *      as required for statutory tax and financial compliance (DPDP Act Sec. 8(7)).
 * 5. Audit-safe logging: Never logs passwords, tokens, or raw personal data.
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

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ error: 'Server configuration error: Missing Supabase credentials' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 1. Verify user session
    const authClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
    const { data: { user }, error: userError } = await authClient.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Service-role client for administrative data deletion
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // 2. Active Subscription Guard: Check if user has an active or trialing paid subscription
    const [{ data: profile }, { data: activeSub }] = await Promise.all([
      adminClient
        .from('profiles')
        .select('plan_tier, subscription_status, dodo_subscription_id')
        .eq('id', user.id)
        .maybeSingle(),
      adminClient
        .from('dodo_subscriptions')
        .select('subscription_id, status, plan_tier')
        .eq('user_id', user.id)
        .in('status', ['active', 'trialing'])
        .maybeSingle()
    ]);

    const isPaidProfile = profile?.plan_tier && profile.plan_tier !== 'free';
    const isProfileSubActive = profile?.subscription_status === 'active' || profile?.subscription_status === 'trialing';
    const hasActiveDodoSub = !!activeSub;

    if ((isPaidProfile && isProfileSubActive) || hasActiveDodoSub) {
      return new Response(JSON.stringify({
        success: false,
        error: 'ACTIVE_SUBSCRIPTION_EXISTS',
        message: 'You have an active or trialing subscription. Please cancel your subscription under Profile & Subscription before deleting your account to ensure recurring charges are stopped.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. De-identify user feedback records (anonymize email and user_id while preserving non-PII feedback text)
    try {
      await adminClient
        .from('user_feedback')
        .update({ email: null, user_id: null })
        .eq('user_id', user.id);
    } catch (feedbackErr) {
      console.warn('[delete-account] Feedback de-identification warning:', feedbackErr);
    }

    // 4. Delete user personal data in application tables (foreign-key safe ordering)
    await adminClient.from('plans').delete().eq('user_id', user.id);
    await adminClient.from('member_preferences').delete().eq('user_id', user.id);
    await adminClient.from('tasks').delete().eq('user_id', user.id);
    await adminClient.from('members').delete().eq('user_id', user.id);
    await adminClient.from('households').delete().eq('user_id', user.id);
    await adminClient.from('user_privacy_preferences').delete().eq('user_id', user.id);
    await adminClient.from('profiles').delete().eq('id', user.id);

    // 5. Delete authentication account from auth.users via admin API
    const { error: delAuthErr } = await adminClient.auth.admin.deleteUser(user.id);
    if (delAuthErr) {
      console.error('[delete-account] Auth admin deleteUser error:', delAuthErr.message);
      return new Response(JSON.stringify({
        success: false,
        error: 'DELETION_FAILED',
        message: 'Unable to complete account authentication deletion. Please contact support.'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 6. Audit-safe record (non-identifying log)
    console.log('[delete-account] Account deleted successfully:', {
      timestamp: new Date().toISOString(),
      action: 'account_deleted',
      success: true
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Your account and associated personal data have been deleted.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('[delete-account] Unexpected exception:', err.message || err);
    return new Response(JSON.stringify({
      success: false,
      error: 'SERVER_ERROR',
      message: 'An unexpected error occurred during account deletion.'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
