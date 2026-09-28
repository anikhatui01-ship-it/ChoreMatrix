/**
 * ChoreMatrix Cashfree Subscription Backend Service
 *
 * Core service handling:
 * 1. Cashfree Sandbox Subscription creation with mapped plan IDs.
 * 2. HMAC-SHA256 Webhook Signature verification.
 * 3. Idempotent webhook processing and verified subscription state synchronization.
 * 4. Zero secret key exposure to the browser.
 */

import crypto from 'node:crypto';
import {
  CASHFREE_CONFIG,
  CASHFREE_PLANS,
  getCashfreePlanId,
  mapCashfreePlanToTier,
  isCashfreePlanId
} from '../config/cashfree.ts';

export interface CashfreeCredentials {
  appId: string;
  secretKey: string;
  baseUrl?: string;
  returnUrlBase?: string;
}

export interface CreateSubscriptionParams {
  userId: string;
  userEmail: string;
  plan: string;
  interval?: string;
  phone?: string;
  customSubscriptionId?: string;
}

export interface CreateSubscriptionResult {
  subscription_id: string;
  subscription_session_id: string;
  auth_link?: string | null;
  plan_id: string;
  plan_tier: 'pro' | 'plus';
  billing_interval: 'monthly' | 'annually';
}

export interface WebhookProcessingParams {
  rawBody: string;
  signature: string;
  timestamp: string;
  secretKey: string;
  dbClient: any;
}

export interface WebhookProcessingResult {
  success: boolean;
  event_id: string;
  duplicate?: boolean;
  subscription_id?: string;
  subscription_status?: string;
  plan_tier?: string;
  message?: string;
}

/**
 * Verifies the Cashfree webhook HMAC-SHA256 signature.
 * Cashfree computes: Base64(HMAC-SHA256(timestamp + rawBody, clientSecret))
 * Uses timing-safe buffer comparison to prevent timing attacks.
 */
export function verifyCashfreeWebhookSignature(
  signature: string | null | undefined,
  rawBody: string | null | undefined,
  timestamp: string | null | undefined,
  secretKey: string | null | undefined
): boolean {
  if (!signature || !rawBody || !timestamp || !secretKey) {
    return false;
  }

  try {
    const payload = `${timestamp}${rawBody}`;
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(payload);
    const expectedSignature = hmac.digest('base64');

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');

    if (sigBuf.length !== expBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/**
 * Generates a deterministic event ID for webhook idempotency tracking.
 */
export function generateWebhookEventId(payload: any, timestamp: string): string {
  if (payload.event_id) return String(payload.event_id);
  if (payload.data?.event_id) return String(payload.data.event_id);

  const subId =
    payload.data?.subscription_details?.subscription_id ||
    payload.subscription_id ||
    payload.data?.cf_subscription_id ||
    'sub_unknown';

  const eventType = payload.type || payload.event || 'STATUS_CHANGE';
  const subStatus =
    payload.data?.subscription_details?.subscription_status ||
    payload.subscription_status ||
    payload.data?.payment_details?.payment_status ||
    '';

  const eventTime = payload.event_time || payload.data?.event_time || timestamp;

  // Use a hash of payload components to guarantee uniqueness and idempotency
  const rawIdentifier = `${eventType}:${subId}:${subStatus}:${eventTime}`;
  return crypto.createHash('sha256').update(rawIdentifier).digest('hex').slice(0, 32);
}

/**
 * Creates a Cashfree subscription mandate using one of the existing Cashfree sandbox plans.
 * Never exposes the Cashfree secret key in the returned data.
 */
export async function createCashfreeSubscription(
  params: CreateSubscriptionParams,
  credentials: CashfreeCredentials,
  customFetch: typeof fetch = fetch
): Promise<CreateSubscriptionResult> {
  const { userId, userEmail, plan, interval, phone, customSubscriptionId } = params;
  const { appId, secretKey, baseUrl, returnUrlBase } = credentials;

  if (!appId || !secretKey) {
    throw new Error('Cashfree credentials unconfigured. App ID and Secret Key are required.');
  }

  if (!userId || !userEmail) {
    throw new Error('Valid user ID and email are required to create a subscription.');
  }

  // 1. Resolve exact existing Cashfree sandbox plan ID
  let resolvedPlanId: string | null = null;
  if (isCashfreePlanId(plan)) {
    resolvedPlanId = plan;
  } else {
    resolvedPlanId = getCashfreePlanId(plan, interval);
  }

  if (!resolvedPlanId) {
    throw new Error(`Invalid plan or interval: "${plan}" (${interval}). Must map to an existing Cashfree sandbox plan.`);
  }

  const planMapping = mapCashfreePlanToTier(resolvedPlanId);
  if (!planMapping) {
    throw new Error(`Plan ID "${resolvedPlanId}" cannot be mapped to an authorized ChoreMatrix tier.`);
  }

  // 2. Generate unique subscription ID (alphanumeric and underscores, max 40 chars)
  const cleanUid = userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const subscriptionId = customSubscriptionId || `sub_${cleanUid}_${Date.now()}`;

  // 3. Resolve return URL base
  const returnBase = (returnUrlBase || CASHFREE_CONFIG.productionReturnDomain).replace(/\/+$/, '');
  const returnUrl = `${returnBase}/account.html?sub_id={subscription_id}`;

  const endpoint = `${(baseUrl || CASHFREE_CONFIG.sandboxBaseUrl).replace(/\/+$/, '')}/subscriptions`;

  // 4. Call Cashfree Create Subscription API
  const requestBody = {
    subscription_id: subscriptionId,
    customer_details: {
      customer_id: userId,
      customer_email: userEmail,
      customer_phone: phone || '9999999999'
    },
    plan_details: {
      plan_id: resolvedPlanId
    },
    subscription_meta: {
      return_url: returnUrl
    }
  };

  const response = await customFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': CASHFREE_CONFIG.apiVersion,
      'x-client-id': appId,
      'x-client-secret': secretKey
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    let errorDetail = 'Unknown Cashfree error';
    try {
      const errJson = await response.json();
      errorDetail = errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text();
    }
    throw new Error(`Cashfree subscription creation failed (${response.status}): ${errorDetail}`);
  }

  const responseData = await response.json();

  const subscriptionSessionId =
    responseData.subscription_session_id ||
    responseData.data?.subscription_session_id ||
    responseData.subReferenceId;

  if (!subscriptionSessionId) {
    throw new Error('Cashfree response missing subscription_session_id.');
  }

  return {
    subscription_id: subscriptionId,
    subscription_session_id: subscriptionSessionId,
    auth_link: responseData.auth_link || responseData.data?.auth_link || null,
    plan_id: resolvedPlanId,
    plan_tier: planMapping.tier,
    billing_interval: planMapping.interval
  };
}

/**
 * Processes incoming Cashfree webhook with signature verification and idempotency check.
 * Only verified Cashfree subscription state can change plan_tier in Supabase.
 */
export async function processCashfreeWebhook(
  params: WebhookProcessingParams
): Promise<WebhookProcessingResult> {
  const { rawBody, signature, timestamp, secretKey, dbClient } = params;

  // 1. Mandatory HMAC-SHA256 signature verification
  const isValid = verifyCashfreeWebhookSignature(signature, rawBody, timestamp, secretKey);
  if (!isValid) {
    throw new Error('Unauthorized: Invalid Cashfree webhook signature.');
  }

  // 2. Parse payload safely
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (err: any) {
    throw new Error(`Malformed JSON in webhook body: ${err.message}`);
  }

  // 3. Derive deterministic event ID for idempotency
  const eventId = generateWebhookEventId(payload, timestamp);

  // 4. Idempotency Check: Query cashfree_webhook_events
  const { data: existingEvent, error: findError } = await dbClient
    .from('cashfree_webhook_events')
    .select('id, event_type')
    .eq('event_id', eventId)
    .maybeSingle();

  if (findError) {
    console.warn('[Cashfree Webhook] Error checking event idempotency:', findError.message);
  }

  if (existingEvent) {
    return {
      success: true,
      event_id: eventId,
      duplicate: true,
      message: 'Event already processed.'
    };
  }

  // 5. Extract subscription identifiers and status
  const eventType = payload.type || payload.event || 'SUBSCRIPTION_STATUS_CHANGE';
  const subDetails = payload.data?.subscription_details || payload.subscription_details || {};
  const paymentDetails = payload.data?.payment_details || payload.payment_details || {};
  const customerDetails = payload.data?.customer_details || payload.customer_details || {};

  const subscriptionId = subDetails.subscription_id || payload.subscription_id;
  const rawStatus = (
    subDetails.subscription_status ||
    payload.subscription_status ||
    paymentDetails.payment_status ||
    ''
  ).toUpperCase();

  // 6. Record event in cashfree_webhook_events table
  await dbClient.from('cashfree_webhook_events').insert({
    event_id: eventId,
    subscription_id: subscriptionId || null,
    event_type: eventType,
    processed_at: new Date().toISOString(),
    payload
  });

  if (!subscriptionId) {
    return {
      success: true,
      event_id: eventId,
      message: 'Webhook logged, but no subscription_id present in payload.'
    };
  }

  // 7. Resolve subscription record in local database
  let targetUserId = customerDetails.customer_id;
  let targetPlanId = subDetails.plan_id || payload.plan_id;
  let currentSubRecord: any = null;

  const { data: localSub } = await dbClient
    .from('cashfree_subscriptions')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .maybeSingle();

  if (localSub) {
    currentSubRecord = localSub;
    if (!targetUserId) targetUserId = localSub.user_id;
    if (!targetPlanId) targetPlanId = localSub.plan_id;
  }

  if (!targetUserId) {
    // Attempt to lookup user by subscription_id directly in profiles
    const { data: profile } = await dbClient
      .from('profiles')
      .select('id')
      .eq('cashfree_subscription_id', subscriptionId)
      .maybeSingle();
    if (profile) targetUserId = profile.id;
  }

  if (!targetUserId) {
    return {
      success: true,
      event_id: eventId,
      subscription_id: subscriptionId,
      message: 'Webhook logged, but target user could not be resolved.'
    };
  }

  // 8. Apply Verified State Transitions to Supabase
  const nowIso = new Date().toISOString();

  // A. Subscription Activation / Payment Success
  if (
    rawStatus === 'ACTIVE' ||
    rawStatus === 'SUCCESS' ||
    eventType === 'SUBSCRIPTION_PAYMENT_SUCCESS'
  ) {
    const planMapping = mapCashfreePlanToTier(targetPlanId);
    const assignedTier = planMapping?.tier || 'pro';
    const assignedInterval = planMapping?.interval || 'monthly';

    // Update public.profiles
    await dbClient
      .from('profiles')
      .update({
        plan_tier: assignedTier,
        billing_interval: assignedInterval,
        subscription_status: 'active',
        cashfree_subscription_id: subscriptionId,
        updated_at: nowIso
      })
      .eq('id', targetUserId);

    // Update public.cashfree_subscriptions
    await dbClient
      .from('cashfree_subscriptions')
      .update({
        status: 'ACTIVE',
        updated_at: nowIso
      })
      .eq('subscription_id', subscriptionId);

    return {
      success: true,
      event_id: eventId,
      subscription_id: subscriptionId,
      subscription_status: 'ACTIVE',
      plan_tier: assignedTier
    };
  }

  // B. Subscription Cancellation / Expiration
  if (
    rawStatus === 'CUSTOMER_CANCELLED' ||
    rawStatus === 'CANCELLED' ||
    rawStatus === 'EXPIRED' ||
    rawStatus === 'TERMINATED' ||
    rawStatus === 'COMPLETED'
  ) {
    // Revert to Free tier
    await dbClient
      .from('profiles')
      .update({
        plan_tier: 'free',
        subscription_status: 'canceled',
        updated_at: nowIso
      })
      .eq('id', targetUserId);

    await dbClient
      .from('cashfree_subscriptions')
      .update({
        status: 'CANCELLED',
        updated_at: nowIso
      })
      .eq('subscription_id', subscriptionId);

    return {
      success: true,
      event_id: eventId,
      subscription_id: subscriptionId,
      subscription_status: 'CANCELLED',
      plan_tier: 'free'
    };
  }

  // C. Payment Failure / On Hold
  if (
    rawStatus === 'FAILED' ||
    rawStatus === 'PAYMENT_FAILED' ||
    rawStatus === 'ON_HOLD' ||
    eventType === 'SUBSCRIPTION_PAYMENT_FAILED'
  ) {
    // Mark status as past_due without fake upgrades
    await dbClient
      .from('profiles')
      .update({
        subscription_status: 'past_due',
        updated_at: nowIso
      })
      .eq('id', targetUserId);

    await dbClient
      .from('cashfree_subscriptions')
      .update({
        status: 'FAILED',
        updated_at: nowIso
      })
      .eq('subscription_id', subscriptionId);

    return {
      success: true,
      event_id: eventId,
      subscription_id: subscriptionId,
      subscription_status: 'FAILED',
      plan_tier: 'unchanged'
    };
  }

  return {
    success: true,
    event_id: eventId,
    subscription_id: subscriptionId,
    subscription_status: rawStatus,
    message: `Logged unhandled status: ${rawStatus}`
  };
}
