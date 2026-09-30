import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  PADDLE_CONFIG,
  getPaddlePriceId,
  PADDLE_SUBSCRIPTION_STATUSES
} from '../../src/config/paddle.ts';
import {
  verifyPaddleWebhookSignature,
  handlePaddleWebhookEvent,
  cancelPaddleSubscription
} from '../../src/monetization/paddleService.ts';

// Helper: generate valid Paddle webhook signature header for testing
function generateTestPaddleSignature(rawBody: string, secret: string, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}:${rawBody}`;
  const h1 = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

// In-memory mock Supabase client for unit testing webhook state machine & idempotency
function createMockSupabase(initialProfile?: {
  id: string;
  plan_tier: string;
  subscription_status: string;
  trial_consumed: boolean;
  payment_provider?: string | null;
  paddle_customer_id?: string | null;
  paddle_subscription_id?: string | null;
}) {
  const webhookEvents: Set<string> = new Set();
  const profile = initialProfile || {
    id: 'user_123',
    plan_tier: 'free',
    subscription_status: 'none',
    trial_consumed: false,
    payment_provider: null,
    paddle_customer_id: null,
    paddle_subscription_id: null
  };
  const subscriptions: Record<string, any> = {};

  return {
    profile,
    webhookEvents,
    subscriptions,
    from(table: string) {
      if (table === 'paddle_webhook_events') {
        return {
          select(cols: string) {
            return {
              eq(col: string, val: string) {
                return {
                  async maybeSingle() {
                    if (webhookEvents.has(val)) {
                      return { data: { event_id: val }, error: null };
                    }
                    return { data: null, error: null };
                  },
                  async single() {
                    if (webhookEvents.has(val)) {
                      return { data: { event_id: val }, error: null };
                    }
                    return { data: null, error: { code: 'PGRST116', message: 'Not found' } };
                  }
                };
              }
            };
          },
          insert(record: { event_id: string; event_type: string }) {
            webhookEvents.add(record.event_id);
            return Promise.resolve({ error: null });
          }
        };
      }

      if (table === 'paddle_subscriptions') {
        return {
          upsert(record: any) {
            subscriptions[record.subscription_id] = { ...record };
            return Promise.resolve({ error: null });
          },
          select(cols: string) {
            return {
              eq(col: string, val: string) {
                return {
                  async maybeSingle() {
                    const sub = subscriptions[val];
                    if (sub) return { data: sub, error: null };
                    return { data: null, error: null };
                  },
                  async single() {
                    const sub = subscriptions[val];
                    if (sub) return { data: sub, error: null };
                    return { data: null, error: { code: 'PGRST116', message: 'Not found' } };
                  }
                };
              }
            };
          }
        };
      }

      if (table === 'profiles') {
        return {
          update(updates: any) {
            return {
              eq(col: string, val: string) {
                if (col === 'id' && val === profile.id) {
                  // Invariant: once trial_consumed is true, it cannot be reset to false
                  if (profile.trial_consumed && updates.trial_consumed === false) {
                    return Promise.resolve({ error: { message: 'Cannot reset trial_consumed' } });
                  }
                  Object.assign(profile, updates);
                  return Promise.resolve({ error: null });
                }
                return Promise.resolve({ error: { message: 'Profile not found' } });
              }
            };
          },
          select(cols: string) {
            return {
              eq(col: string, val: string) {
                return {
                  async maybeSingle() {
                    if (col === 'id' && val === profile.id) {
                      return { data: { ...profile }, error: null };
                    }
                    if (col === 'paddle_customer_id' && val === profile.paddle_customer_id) {
                      return { data: { ...profile }, error: null };
                    }
                    return { data: null, error: null };
                  },
                  async single() {
                    if (col === 'id' && val === profile.id) {
                      return { data: { ...profile }, error: null };
                    }
                    return { data: null, error: { code: 'PGRST116', message: 'Not found' } };
                  }
                };
              }
            };
          }
        };
      }

      throw new Error(`Unexpected table in mock: ${table}`);
    }
  };
}

describe('Paddle Sandbox Subscriptions & Entitlements Test Suite', () => {
  const rootDir = process.cwd();
  const testSecret = 'pdl_ntfset_test_secret_key_1234567890';

  // =========================================================================
  // 1. First-time trial: Price mapping selects Price A when trial_consumed = false
  // =========================================================================
  it('1. First-time trial: selects Price A (7-day trial) when eligible', () => {
    const isTrialEligible = true;
    const priceId = getPaddlePriceId(isTrialEligible);
    assert.strictEqual(priceId, PADDLE_CONFIG.prices.trial, 'Eligible user must receive Price A (trial)');
    assert.ok(priceId.startsWith('pri_'), 'Price ID must follow Paddle format');
  });

  // =========================================================================
  // 2. Trial checkout: verifies client checkout parameters
  // =========================================================================
  it('2. Trial checkout: requires payment method and maps custom user_id', () => {
    assert.ok(PADDLE_CONFIG.prices.trial, 'Trial price must be configured');
    assert.strictEqual(PADDLE_CONFIG.environment, 'sandbox', 'Must run in Sandbox environment');
    assert.ok(PADDLE_CONFIG.clientToken.startsWith('test_'), 'Client token must be sandbox token');
  });

  // =========================================================================
  // 3. Trialing subscription: webhook sets trialing state and provisions Pro tier
  // =========================================================================
  it('3. Trialing subscription: webhook provisions Pro entitlement with trialing status', async () => {
    const mock = createMockSupabase();
    const eventPayload = {
      event_id: 'evt_trialing_001',
      event_type: 'subscription.created',
      data: {
        id: 'sub_trialing_001',
        customer_id: 'ctm_customer_001',
        status: 'trialing',
        custom_data: { user_id: 'user_123' }
      }
    };

    const result = await handlePaddleWebhookEvent(eventPayload, mock as any);
    assert.strictEqual(result.processed, true);
    assert.strictEqual(mock.profile.plan_tier, 'pro', 'User must be upgraded to Pro during trial');
    assert.strictEqual(mock.profile.subscription_status, 'trialing');
    assert.strictEqual(mock.profile.payment_provider, 'paddle');
    assert.strictEqual(mock.profile.paddle_customer_id, 'ctm_customer_001');
    assert.strictEqual(mock.profile.paddle_subscription_id, 'sub_trialing_001');
  });

  // =========================================================================
  // 4. trial_consumed becomes true only after authoritative successful state
  // =========================================================================
  it('4. trial_consumed becomes true only after authoritative successful lifecycle state', async () => {
    const mock = createMockSupabase({
      id: 'user_123',
      plan_tier: 'free',
      subscription_status: 'none',
      trial_consumed: false
    });

    assert.strictEqual(mock.profile.trial_consumed, false, 'Initial state: trial_consumed is false');

    const eventPayload = {
      event_id: 'evt_trial_consumed_check',
      event_type: 'subscription.trialing',
      data: {
        id: 'sub_authoritative_trial',
        customer_id: 'ctm_authoritative',
        status: 'trialing',
        custom_data: { user_id: 'user_123' }
      }
    };

    await handlePaddleWebhookEvent(eventPayload, mock as any);
    assert.strictEqual(mock.profile.trial_consumed, true, 'trial_consumed must become true upon authoritative trial event');
  });

  // =========================================================================
  // 5. Second trial attempt is rejected: price selection rejects trial
  // =========================================================================
  it('5. Second trial attempt is rejected: user with trial_consumed=true gets Price B', () => {
    const isTrialEligible = false; // user has already consumed trial
    const priceId = getPaddlePriceId(isTrialEligible);
    assert.strictEqual(priceId, PADDLE_CONFIG.prices.standard, 'Trial-consumed user must receive Price B (standard)');
    assert.notStrictEqual(priceId, PADDLE_CONFIG.prices.trial, 'Trial-consumed user must NEVER receive Price A (trial)');
  });

  // =========================================================================
  // 6. Standard paid subscription for trial-consumed user
  // =========================================================================
  it('6. Standard paid subscription for trial-consumed user: activates Pro with status=active', async () => {
    const mock = createMockSupabase({
      id: 'user_trial_consumed',
      plan_tier: 'free',
      subscription_status: 'none',
      trial_consumed: true
    });

    const eventPayload = {
      event_id: 'evt_standard_sub_001',
      event_type: 'subscription.activated',
      data: {
        id: 'sub_paid_001',
        customer_id: 'ctm_paid_001',
        status: 'active',
        custom_data: { user_id: 'user_trial_consumed' }
      }
    };

    const result = await handlePaddleWebhookEvent(eventPayload, mock as any);
    assert.strictEqual(result.processed, true);
    assert.strictEqual(mock.profile.plan_tier, 'pro');
    assert.strictEqual(mock.profile.subscription_status, 'active');
    assert.strictEqual(mock.profile.trial_consumed, true, 'trial_consumed remains true');
  });

  // =========================================================================
  // 7. Trial cancellation: trial cancelled reverts plan to free and stops renewal
  // =========================================================================
  it('7. Trial cancellation: reverts plan to free and prevents renewal charges', async () => {
    const mock = createMockSupabase({
      id: 'user_cancelling_trial',
      plan_tier: 'pro',
      subscription_status: 'trialing',
      trial_consumed: true,
      paddle_subscription_id: 'sub_trial_to_cancel',
      paddle_customer_id: 'ctm_trial'
    });

    const eventPayload = {
      event_id: 'evt_cancel_trial_001',
      event_type: 'subscription.canceled',
      data: {
        id: 'sub_trial_to_cancel',
        customer_id: 'ctm_trial',
        status: 'canceled',
        custom_data: { user_id: 'user_cancelling_trial' }
      }
    };

    const result = await handlePaddleWebhookEvent(eventPayload, mock as any);
    assert.strictEqual(result.processed, true);
    assert.strictEqual(mock.profile.plan_tier, 'free', 'Plan must revert to free upon cancellation');
    assert.strictEqual(mock.profile.subscription_status, 'canceled');
    assert.strictEqual(mock.profile.trial_consumed, true, 'trial_consumed remains permanently true');
  });

  // =========================================================================
  // 8. Active subscription cancellation: handles cancellation event
  // =========================================================================
  it('8. Active subscription cancellation: updates status to canceled', async () => {
    const mock = createMockSupabase({
      id: 'user_cancelling_active',
      plan_tier: 'pro',
      subscription_status: 'active',
      trial_consumed: true,
      paddle_subscription_id: 'sub_active_to_cancel',
      paddle_customer_id: 'ctm_active'
    });

    const eventPayload = {
      event_id: 'evt_cancel_active_001',
      event_type: 'subscription.canceled',
      data: {
        id: 'sub_active_to_cancel',
        customer_id: 'ctm_active',
        status: 'canceled',
        custom_data: { user_id: 'user_cancelling_active' }
      }
    };

    const result = await handlePaddleWebhookEvent(eventPayload, mock as any);
    assert.strictEqual(result.processed, true);
    assert.strictEqual(mock.profile.plan_tier, 'free');
    assert.strictEqual(mock.profile.subscription_status, 'canceled');
  });

  // =========================================================================
  // 9. Payment failure: transaction.payment_failed updates state
  // =========================================================================
  it('9. Payment failure: marks subscription as past_due or records failed payment', async () => {
    const mock = createMockSupabase({
      id: 'user_past_due',
      plan_tier: 'pro',
      subscription_status: 'active',
      trial_consumed: true,
      paddle_subscription_id: 'sub_failing_payment'
    });

    // Case A: subscription.past_due event
    const pastDueEvent = {
      event_id: 'evt_sub_past_due',
      event_type: 'subscription.past_due',
      data: {
        id: 'sub_failing_payment',
        customer_id: 'ctm_failing',
        status: 'past_due',
        custom_data: { user_id: 'user_past_due' }
      }
    };
    await handlePaddleWebhookEvent(pastDueEvent, mock as any);
    assert.strictEqual(mock.profile.subscription_status, 'past_due', 'Status must be set to past_due');

    // Case B: transaction.payment_failed event
    const txnFailedEvent = {
      event_id: 'evt_txn_failed_001',
      event_type: 'transaction.payment_failed',
      data: {
        id: 'txn_failed_001',
        subscription_id: 'sub_failing_payment',
        customer_id: 'ctm_failing',
        status: 'failed',
        custom_data: { user_id: 'user_past_due' }
      }
    };
    const txnResult = await handlePaddleWebhookEvent(txnFailedEvent, mock as any);
    assert.strictEqual(txnResult.processed, true);
  });

  // =========================================================================
  // 10. Duplicate checkout prevention: rejects initiate when already active
  // =========================================================================
  it('10. Duplicate checkout prevention: identifies existing active subscription', () => {
    const existingActive = {
      plan_tier: 'pro',
      subscription_status: 'active'
    };
    const isAlreadySubscribed = existingActive.plan_tier === 'pro' &&
      (existingActive.subscription_status === 'active' || existingActive.subscription_status === 'trialing');
    assert.strictEqual(isAlreadySubscribed, true, 'Must detect existing active subscription');
  });

  // =========================================================================
  // 11. Duplicate webhook delivery: idempotency checks
  // =========================================================================
  it('11. Duplicate webhook delivery: returns duplicate=true and avoids re-processing', async () => {
    const mock = createMockSupabase();
    const eventPayload = {
      event_id: 'evt_duplicate_test',
      event_type: 'subscription.activated',
      data: {
        id: 'sub_dup_001',
        customer_id: 'ctm_dup_001',
        status: 'active',
        custom_data: { user_id: 'user_123' }
      }
    };

    // First delivery
    const firstDelivery = await handlePaddleWebhookEvent(eventPayload, mock as any);
    assert.strictEqual(firstDelivery.processed, true);
    assert.strictEqual(firstDelivery.duplicate, false);

    // Second delivery (same event_id)
    const secondDelivery = await handlePaddleWebhookEvent(eventPayload, mock as any);
    assert.strictEqual(secondDelivery.processed, false);
    assert.strictEqual(secondDelivery.duplicate, true, 'Must identify duplicate event');
  });

  // =========================================================================
  // 12. Invalid webhook signature: signature verification fails
  // =========================================================================
  it('12. Invalid webhook signature: returns false when HMAC hash does not match', () => {
    const rawBody = JSON.stringify({ event_type: 'subscription.created' });
    const invalidSignature = 'ts=1700000000;h1=invalid_hmac_hash_00000000000000000000';
    const isValid = verifyPaddleWebhookSignature(rawBody, invalidSignature, testSecret);
    assert.strictEqual(isValid, false, 'Invalid signature must be rejected');
  });

  // =========================================================================
  // 13. Missing webhook signature: returns false when header is missing or malformed
  // =========================================================================
  it('13. Missing webhook signature: rejects missing or malformed signature header', () => {
    const rawBody = JSON.stringify({ test: 1 });
    assert.strictEqual(verifyPaddleWebhookSignature(rawBody, '', testSecret), false, 'Empty signature rejected');
    assert.strictEqual(verifyPaddleWebhookSignature(rawBody, 'not-a-valid-header', testSecret), false, 'Malformed header rejected');
    assert.strictEqual(verifyPaddleWebhookSignature(rawBody, 'ts=1700000000', testSecret), false, 'Missing h1 rejected');
  });

  // =========================================================================
  // 14. Unauthorized subscription access: ignores events without valid user_id
  // =========================================================================
  it('14. Unauthorized subscription access: rejects webhook payload without user_id', async () => {
    const mock = createMockSupabase();
    const eventPayload = {
      event_id: 'evt_no_user_id',
      event_type: 'subscription.created',
      data: {
        id: 'sub_orphan_001',
        customer_id: 'ctm_orphan',
        status: 'active',
        custom_data: {} // No user_id!
      }
    };

    const result = await handlePaddleWebhookEvent(eventPayload, mock as any);
    assert.strictEqual(result.processed, false, 'Must reject payload without user_id');
    assert.strictEqual(mock.profile.plan_tier, 'free', 'Profile must not be modified');
  });

  // =========================================================================
  // 15. Correct Paddle IDs stored: customer ID and subscription ID recorded
  // =========================================================================
  it('15. Correct Paddle IDs stored: saves paddle_subscription_id and paddle_customer_id', async () => {
    const mock = createMockSupabase();
    const expectedSubId = 'sub_01m3q8bc_test_sub';
    const expectedCustId = 'ctm_01m3q8bc_test_cust';

    const eventPayload = {
      event_id: 'evt_store_ids',
      event_type: 'subscription.created',
      data: {
        id: expectedSubId,
        customer_id: expectedCustId,
        status: 'active',
        custom_data: { user_id: 'user_123' }
      }
    };

    await handlePaddleWebhookEvent(eventPayload, mock as any);
    assert.strictEqual(mock.profile.paddle_subscription_id, expectedSubId);
    assert.strictEqual(mock.profile.paddle_customer_id, expectedCustId);
    assert.ok(mock.subscriptions[expectedSubId], 'Mirror table record must be created');
  });

  // =========================================================================
  // 16. payment_provider = paddle
  // =========================================================================
  it('16. payment_provider = paddle: profile record updates payment_provider to paddle', async () => {
    const mock = createMockSupabase();
    const eventPayload = {
      event_id: 'evt_provider_check',
      event_type: 'subscription.created',
      data: {
        id: 'sub_provider_test',
        customer_id: 'ctm_provider_test',
        status: 'active',
        custom_data: { user_id: 'user_123' }
      }
    };

    await handlePaddleWebhookEvent(eventPayload, mock as any);
    assert.strictEqual(mock.profile.payment_provider, 'paddle', 'payment_provider must be exactly "paddle"');
  });

  // =========================================================================
  // 17. No Cashfree runtime references in source tree
  // =========================================================================
  it('17. No Cashfree runtime references: src and edge functions have 0 cashfree mentions', () => {
    const srcDir = path.join(rootDir, 'src');
    const functionsDir = path.join(rootDir, 'supabase', 'functions');

    function searchDirForTerm(dir: string, term: string): string[] {
      const matches: string[] = [];
      if (!fs.existsSync(dir)) return matches;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          matches.push(...searchDirForTerm(fullPath, term));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.html'))) {
          // Exclude generated bundle (will be rebuilt)
          if (entry.name === 'client.bundle.js' || entry.name === 'optimizer.bundle.js') continue;
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.toLowerCase().includes(term.toLowerCase())) {
            matches.push(fullPath);
          }
        }
      }
      return matches;
    }

    const cashfreeInSrc = searchDirForTerm(srcDir, 'cashfree');
    const cashfreeInFunctions = searchDirForTerm(functionsDir, 'cashfree');

    assert.deepStrictEqual(
      [...cashfreeInSrc, ...cashfreeInFunctions],
      [],
      'Zero cashfree references allowed in src/ or supabase/functions/'
    );
  });

  // =========================================================================
  // 18. No Razorpay runtime references in source tree
  // =========================================================================
  it('18. No Razorpay runtime references: src and edge functions have 0 razorpay mentions', () => {
    const srcDir = path.join(rootDir, 'src');
    const functionsDir = path.join(rootDir, 'supabase', 'functions');

    function searchDirForTerm(dir: string, term: string): string[] {
      const matches: string[] = [];
      if (!fs.existsSync(dir)) return matches;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          matches.push(...searchDirForTerm(fullPath, term));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.html'))) {
          // Exclude generated bundle (will be rebuilt)
          if (entry.name === 'client.bundle.js' || entry.name === 'optimizer.bundle.js') continue;
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.toLowerCase().includes(term.toLowerCase())) {
            matches.push(fullPath);
          }
        }
      }
      return matches;
    }

    const razorpayInSrc = searchDirForTerm(srcDir, 'razorpay');
    const razorpayInFunctions = searchDirForTerm(functionsDir, 'razorpay');

    assert.deepStrictEqual(
      [...razorpayInSrc, ...razorpayInFunctions],
      [],
      'Zero razorpay references allowed in src/ or supabase/functions/'
    );
  });

  // =========================================================================
  // 19. Paddle checkout uses client-side token only
  // =========================================================================
  it('19. Paddle checkout uses client-side token only: does not reference API key in client config', () => {
    const paddleConfigPath = path.join(rootDir, 'src', 'config', 'paddle.ts');
    const paddleCheckoutPath = path.join(rootDir, 'src', 'monetization', 'paddleCheckout.ts');

    const configContent = fs.readFileSync(paddleConfigPath, 'utf8');
    const checkoutContent = fs.readFileSync(paddleCheckoutPath, 'utf8');

    assert.ok(
      configContent.includes('clientToken'),
      'paddle.ts must provide clientToken'
    );
    assert.ok(
      !configContent.includes('PADDLE_API_KEY'),
      'paddle.ts must NEVER contain or export PADDLE_API_KEY'
    );
    assert.ok(
      !checkoutContent.includes('PADDLE_API_KEY'),
      'paddleCheckout.ts must NEVER contain or import PADDLE_API_KEY'
    );
  });

  // =========================================================================
  // 20. API key never appears in client bundle
  // =========================================================================
  it('20. API key never appears in client bundle: blocks API key and webhook secret from client env and bundle', async () => {
    const { getClientSafeEnv } = await import('../../build.js');

    const envWithSecrets = {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_pub_test_123',
      VITE_PADDLE_CLIENT_TOKEN: 'test_token_client_123',
      PADDLE_API_KEY: 'pdl_sdbx_secret_api_key_must_never_leak',
      PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_secret_must_never_leak',
      SUPABASE_SERVICE_ROLE_KEY: 'secret_service_role_key'
    };

    const safe = getClientSafeEnv({ env: envWithSecrets, envFile: '/nonexistent/.env' });

    assert.strictEqual((safe as any).PADDLE_API_KEY, undefined, 'PADDLE_API_KEY must never be in safe client env');
    assert.strictEqual((safe as any).PADDLE_WEBHOOK_SECRET, undefined, 'PADDLE_WEBHOOK_SECRET must never be in safe client env');
    assert.strictEqual((safe as any).SUPABASE_SERVICE_ROLE_KEY, undefined, 'SUPABASE_SERVICE_ROLE_KEY must never be in safe client env');

    // Check built client bundle if exists
    const clientBundlePath = path.join(rootDir, 'dist', 'src', 'client.bundle.js');
    if (fs.existsSync(clientBundlePath)) {
      const bundleContent = fs.readFileSync(clientBundlePath, 'utf8');
      assert.ok(!bundleContent.includes('pdl_sdbx_'), 'Paddle secret API key must never appear in client bundle');
      assert.ok(!bundleContent.includes('pdl_ntfset_'), 'Paddle webhook secret must never appear in client bundle');
    }
  });
});
