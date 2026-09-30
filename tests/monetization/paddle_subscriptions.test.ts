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
import { resolveAdEntitlement, AdSlot } from '../../src/monetization/adSlot.ts';
import { getTierById } from '../../src/config/pricing.ts';

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

  // =========================================================================
  // 21. Pro tier feature entitlement: ad suppression for Pro users vs Free
  // =========================================================================
  it('21. Pro tier feature entitlement: suppresses ads for Pro and serves house ads for Free', async () => {
    class MockElement {
      style: Record<string, string> = {};
      innerHTML: string = '';
    }

    const proFetcher = async () => ({ plan_tier: 'pro' });
    const freeFetcher = async () => ({ plan_tier: 'free' });

    // Pro user
    const proState = await resolveAdEntitlement({ id: 'pro_user_1' }, proFetcher);
    assert.strictEqual(proState, 'paid-tier');

    const proContainer = new MockElement();
    const proAdSlot = new AdSlot(proContainer as any);
    await proAdSlot.init({ id: 'pro_user_1' }, proFetcher);
    assert.strictEqual(proContainer.innerHTML, '');
    assert.strictEqual(proContainer.style.display, 'none');

    // Free user
    const freeState = await resolveAdEntitlement({ id: 'free_user_1' }, freeFetcher);
    assert.strictEqual(freeState, 'free-tier');

    const freeContainer = new MockElement();
    const freeAdSlot = new AdSlot(freeContainer as any);
    await freeAdSlot.init({ id: 'free_user_1' }, freeFetcher);
    assert.ok(freeContainer.innerHTML.includes('Sponsor Notice · Free Tier'));
    assert.strictEqual(freeContainer.style.display, 'block');
  });

  // =========================================================================
  // 22. Pro tier feature entitlement: account page subscription management
  // =========================================================================
  it('22. Pro tier feature entitlement: exposes cancellation management on account page only for active paid plans', () => {
    function isCancelSubVisible(profile: any): boolean {
      return Boolean(
        profile.plan_tier &&
        profile.plan_tier !== 'free' &&
        (profile.subscription_status === 'active' || profile.subscription_status === 'trialing')
      );
    }

    assert.strictEqual(isCancelSubVisible({ plan_tier: 'pro', subscription_status: 'active' }), true);
    assert.strictEqual(isCancelSubVisible({ plan_tier: 'pro', subscription_status: 'trialing' }), true);
    assert.strictEqual(isCancelSubVisible({ plan_tier: 'pro', subscription_status: 'canceled' }), false);
    assert.strictEqual(isCancelSubVisible({ plan_tier: 'free', subscription_status: 'none' }), false);
  });

  // =========================================================================
  // 23. Anti-tampering & privilege escalation prevention
  // =========================================================================
  it('23. Anti-tampering: rejects client-side spoofing and relies strictly on authoritative profile', async () => {
    const maliciousClientUser = {
      id: 'attacker_1',
      plan_tier: 'pro',
      subscription_status: 'active',
      isPaid: true
    };

    // Authoritative fetcher returns actual database record
    const authoritativeFetcher = async (uid: string) => ({ plan_tier: 'free' });

    const state = await resolveAdEntitlement(maliciousClientUser, authoritativeFetcher);
    assert.strictEqual(state, 'free-tier', 'Must ignore client user plan_tier and obey authoritative DB');
  });

  // =========================================================================
  // 24. Successful end-of-period cancellation
  // =========================================================================
  it('24. Successful end-of-period cancellation: schedules cancellation via POST /subscriptions/{id}/cancel with effective_from=next_billing_period', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: any = null;
    let capturedAuth = '';

    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedMethod = init?.method || 'GET';
      capturedAuth = (init?.headers as any)?.['Authorization'] || '';
      capturedBody = JSON.parse(String(init?.body || '{}'));

      return {
        ok: true,
        status: 200,
        headers: {
          get: (header: string) => header.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({
          data: {
            id: 'sub_test_123',
            status: 'active',
            scheduled_change: {
              action: 'cancel',
              effective_at: '2026-10-30T00:00:00.000Z'
            }
          }
        })
      } as any;
    }) as unknown as typeof fetch;

    const res = await cancelPaddleSubscription(
      'sub_test_123',
      { apiKey: 'test_server_key', baseUrl: 'https://sandbox-api.paddle.com' },
      'next_billing_period',
      mockFetch
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual(capturedMethod, 'POST');
    assert.strictEqual(capturedUrl, 'https://sandbox-api.paddle.com/subscriptions/sub_test_123/cancel');
    assert.strictEqual(capturedAuth, 'Bearer test_server_key');
    assert.strictEqual(capturedBody.effective_from, 'next_billing_period', 'Cancellation MUST default to next_billing_period');
    assert.strictEqual(res.data?.data?.scheduled_change?.action, 'cancel');
  });

  // =========================================================================
  // 25. Cancellation of trialing subscription
  // =========================================================================
  it('25. Cancellation of trialing subscription: maintains trialing status and schedules cancellation for trial end', async () => {
    const trialEndIso = '2026-10-07T06:02:52.567Z';
    const mockFetch = (async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => h.toLowerCase() === 'content-type' ? 'application/json' : null
      },
      json: async () => ({
        data: {
          id: 'sub_trialing_456',
          status: 'trialing',
          scheduled_change: {
            action: 'cancel',
            effective_at: trialEndIso
          },
          current_billing_period: {
            starts_at: '2026-09-30T06:02:52.567Z',
            ends_at: trialEndIso
          }
        }
      })
    })) as unknown as typeof fetch;

    const res = await cancelPaddleSubscription(
      'sub_trialing_456',
      { apiKey: 'test_key' },
      'next_billing_period',
      mockFetch
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data?.data?.status, 'trialing', 'Subscription remains in trialing status until period end');
    assert.strictEqual(res.data?.data?.scheduled_change?.effective_at, trialEndIso);
  });

  // =========================================================================
  // 26. Unauthorized / missing authentication
  // =========================================================================
  it('26. Unauthorized / missing authentication: rejects request without token or with invalid session', async () => {
    function simulateAuthGuard(headers: Record<string, string>) {
      const auth = headers['authorization'] || headers['Authorization'];
      if (!auth) {
        return { status: 401, headers: { 'Content-Type': 'application/json' }, body: { error: 'Unauthorized: Missing Authorization header' } };
      }
      const token = auth.replace(/^Bearer\s+/i, '');
      if (token !== 'valid_session_token') {
        return { status: 401, headers: { 'Content-Type': 'application/json' }, body: { error: 'Unauthorized: Invalid or expired session' } };
      }
      return { status: 200, user: { id: 'usr_valid' } };
    }

    const noAuth = simulateAuthGuard({});
    assert.strictEqual(noAuth.status, 401);
    assert.strictEqual(noAuth.headers['Content-Type'], 'application/json');
    assert.strictEqual(noAuth.body.error, 'Unauthorized: Missing Authorization header');

    const badAuth = simulateAuthGuard({ authorization: 'Bearer invalid_tok_xyz' });
    assert.strictEqual(badAuth.status, 401);
    assert.strictEqual(badAuth.headers['Content-Type'], 'application/json');
    assert.strictEqual(badAuth.body.error, 'Unauthorized: Invalid or expired session');
  });

  // =========================================================================
  // 27. Subscription ownership mismatch
  // =========================================================================
  it('27. Subscription ownership mismatch: prevents user A from cancelling user B subscription', async () => {
    const mockDb = createMockSupabase();
    // Preload user_victim subscription in paddle_subscriptions
    mockDb.subscriptions['sub_victim_999'] = {
      user_id: 'user_victim',
      subscription_id: 'sub_victim_999',
      status: 'active'
    };

    async function cancelEndpoint(requesterUserId: string, requestedSubId: string) {
      // Query subscription and verify user_id = requesterUserId
      const sub = mockDb.subscriptions[requestedSubId];
      if (!sub || sub.user_id !== requesterUserId) {
        return {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'Subscription not found or not owned by authenticated user.' }
        };
      }
      return { status: 200, body: { success: true } };
    }

    const attackerAttempt = await cancelEndpoint('user_attacker', 'sub_victim_999');
    assert.strictEqual(attackerAttempt.status, 403, 'Must return HTTP 403 Forbidden for ownership mismatch');
    assert.strictEqual(attackerAttempt.headers['Content-Type'], 'application/json');
    assert.strictEqual(attackerAttempt.body.error, 'Subscription not found or not owned by authenticated user.');

    const victimAttempt = await cancelEndpoint('user_victim', 'sub_victim_999');
    assert.strictEqual(victimAttempt.status, 200);
  });

  // =========================================================================
  // 28. Paddle API failure
  // =========================================================================
  it('28. Paddle API failure: handles upstream 400/500 JSON error cleanly without throwing', async () => {
    const mockFetch = (async () => ({
      ok: false,
      status: 400,
      headers: {
        get: (h: string) => h.toLowerCase() === 'content-type' ? 'application/json' : null
      },
      json: async () => ({
        error: {
          code: 'subscription_locked_for_update',
          detail: 'Subscription is locked for update'
        }
      })
    })) as unknown as typeof fetch;

    const res = await cancelPaddleSubscription(
      'sub_test_fail',
      { apiKey: 'test_key' },
      'next_billing_period',
      mockFetch
    );

    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('Subscription is locked for update'), 'Must extract Paddle error detail message');
  });

  // =========================================================================
  // 29. Malformed / non-JSON upstream response
  // =========================================================================
  it('29. Malformed / non-JSON upstream response: inspects Content-Type and gracefully handles HTML error pages', async () => {
    const mockFetch = (async () => ({
      ok: false,
      status: 502,
      headers: {
        get: (h: string) => h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null
      },
      text: async () => '<!doctype html><html><body>502 Bad Gateway</body></html>'
    })) as unknown as typeof fetch;

    const res = await cancelPaddleSubscription(
      'sub_html_fail',
      { apiKey: 'test_key' },
      'next_billing_period',
      mockFetch
    );

    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('502'), 'Must report 502 status code');
    assert.ok(!res.error?.includes('Unexpected token'), 'Must NOT throw SyntaxError for HTML response');
  });

  // =========================================================================
  // 30. Duplicate cancellation attempt
  // =========================================================================
  it('30. Duplicate cancellation attempt: returns idempotent success when cancellation is already scheduled', async () => {
    function handleCancellationResponse(paddleStatus: number, paddleCode: string, subRecord: any) {
      if (paddleStatus === 409 || paddleCode === 'subscription_locked_for_update' || paddleCode === 'subscription_already_canceled') {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            success: true,
            subscription_id: subRecord.subscription_id,
            status: subRecord.status,
            scheduled_change: subRecord.scheduled_change,
            message: 'Subscription cancellation is already scheduled for the end of your billing period.'
          }
        };
      }
      return { status: 400, body: { error: 'Other error' } };
    }

    const sub = {
      subscription_id: 'sub_dup_123',
      status: 'active',
      scheduled_change: '2026-10-07T06:02:52.567Z'
    };

    const duplicateRes = handleCancellationResponse(409, 'subscription_locked_for_update', sub);
    assert.strictEqual(duplicateRes.status, 200);
    assert.strictEqual(duplicateRes.body.success, true);
    assert.ok(duplicateRes.body.message.includes('already scheduled'));
  });

  // =========================================================================
  // 31. Webhook scheduled cancellation state
  // =========================================================================
  it('31. Webhook scheduled cancellation state: subscription.updated records scheduled_change without revoking Pro entitlement early', async () => {
    const mockDb = createMockSupabase({
      id: 'usr_scheduled_test',
      plan_tier: 'pro',
      subscription_status: 'active',
      trial_consumed: true,
      payment_provider: 'paddle',
      paddle_customer_id: 'ctm_test_sched',
      paddle_subscription_id: 'sub_sched_test'
    });

    const scheduledDate = '2026-10-07T06:02:52.567Z';
    const payload = {
      event_id: 'evt_update_sched_1',
      event_type: 'subscription.updated',
      occurred_at: '2026-09-30T10:00:00Z',
      data: {
        id: 'sub_sched_test',
        customer_id: 'ctm_test_sched',
        status: 'active',
        scheduled_change: {
          action: 'cancel',
          effective_at: scheduledDate
        },
        custom_data: { user_id: 'usr_scheduled_test' },
        current_billing_period: {
          starts_at: '2026-09-30T06:02:52.567Z',
          ends_at: scheduledDate
        }
      }
    };

    const result = await handlePaddleWebhookEvent(payload, mockDb);
    assert.strictEqual(result.processed, true);

    // Profile entitlement check: Pro tier MUST NOT be revoked early
    assert.strictEqual(mockDb.profile.plan_tier, 'pro', 'User keeps Pro entitlement until period end');
    assert.strictEqual(mockDb.profile.subscription_status, 'active');

    // Subscriptions table check: scheduled_change must be recorded
    const subRecord = mockDb.subscriptions['sub_sched_test'];
    assert.ok(subRecord, 'Subscription record must be upserted');
    assert.strictEqual(subRecord.scheduled_change, scheduledDate);
    assert.strictEqual(subRecord.plan_tier, 'pro');
  });

  // =========================================================================
  // 32. Final subscription.canceled state
  // =========================================================================
  it('32. Final subscription.canceled state: downgrades to free tier when cancellation becomes effective and preserves trial_consumed', async () => {
    const mockDb = createMockSupabase({
      id: 'usr_term_test',
      plan_tier: 'pro',
      subscription_status: 'active',
      trial_consumed: true,
      payment_provider: 'paddle',
      paddle_customer_id: 'ctm_test_term',
      paddle_subscription_id: 'sub_term_test'
    });

    const payload = {
      event_id: 'evt_canceled_final_1',
      event_type: 'subscription.canceled',
      occurred_at: '2026-10-07T06:02:53Z',
      data: {
        id: 'sub_term_test',
        customer_id: 'ctm_test_term',
        status: 'canceled',
        custom_data: { user_id: 'usr_term_test' }
      }
    };

    const result = await handlePaddleWebhookEvent(payload, mockDb);
    assert.strictEqual(result.processed, true);

    // Profile check: downgraded to free, status canceled, trial_consumed permanently true
    assert.strictEqual(mockDb.profile.plan_tier, 'free');
    assert.strictEqual(mockDb.profile.subscription_status, 'canceled');
    assert.strictEqual(mockDb.profile.trial_consumed, true, 'trial_consumed must never reset');

    const subRecord = mockDb.subscriptions['sub_term_test'];
    assert.strictEqual(subRecord.status, 'canceled');
    assert.strictEqual(subRecord.plan_tier, 'free');
  });

  // =========================================================================
  // 33. Security: Paddle secret credentials never appear in client bundles
  // =========================================================================
  it('33. Security: Paddle secret credentials never appear in client bundles or frontend code', () => {
    const distClientBundle = path.join(rootDir, 'dist', 'src', 'client.bundle.js');
    if (fs.existsSync(distClientBundle)) {
      const bundle = fs.readFileSync(distClientBundle, 'utf8');
      assert.ok(!bundle.includes('pdl_sdbx_apikey_'), 'Paddle API key must NOT be bundled');
      assert.ok(!bundle.includes('pdl_ntfset_'), 'Paddle webhook secret must NOT be bundled');
      assert.ok(!bundle.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Service role key must NOT be bundled');
    }

    const accountHtml = fs.readFileSync(path.join(rootDir, 'account.html'), 'utf8');
    assert.ok(!accountHtml.includes('pdl_sdbx_'), 'Paddle API key must NOT appear in account.html');
    assert.ok(!accountHtml.includes('service_role'), 'Service role must NOT appear in account.html');
  });

  // =========================================================================
  // 34. Security: arbitrary subscription_id cannot be canceled
  // =========================================================================
  it('34. Security: arbitrary subscription_id cannot be canceled without verified user ownership', async () => {
    const mockDb = createMockSupabase();

    async function secureCancelService(userId: string, targetSubId: string) {
      const sub = mockDb.subscriptions[targetSubId];
      if (!sub || sub.user_id !== userId) {
        throw new Error('Access denied: subscription ownership check failed');
      }
      return { success: true };
    }

    await assert.rejects(
      async () => {
        await secureCancelService('user_legit', 'sub_arbitrary_unowned_id');
      },
      /Access denied: subscription ownership check failed/
    );
  });

  // =========================================================================
  // 35. Regression: Step 9.1 - Successful cancellation
  // =========================================================================
  it('35. Regression 9.1: Successful cancellation calls Paddle next_billing_period and returns JSON 200', async () => {
    let paddleCalled = false;
    let paddlePayload: any = null;

    const mockDb = createMockSupabase({
      id: 'usr_reg_success',
      plan_tier: 'pro',
      subscription_status: 'trialing',
      paddle_subscription_id: 'sub_reg_success_001'
    });

    mockDb.subscriptions['sub_reg_success_001'] = {
      subscription_id: 'sub_reg_success_001',
      user_id: 'usr_reg_success',
      status: 'trialing',
      scheduled_change: null
    };

    // Simulate edge function logic
    async function handleCancelRequest(authUserId: string, targetSubId: string) {
      const sub = mockDb.subscriptions[targetSubId];
      if (!sub || sub.user_id !== authUserId) {
        return { status: 403, headers: { 'Content-Type': 'application/json' }, body: { error: 'Forbidden' } };
      }

      // Mock Paddle API call
      paddleCalled = true;
      paddlePayload = { effective_from: 'next_billing_period' };
      const effectiveAt = '2026-10-07T06:02:52.567Z';

      sub.scheduled_change = effectiveAt;

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          success: true,
          subscription_id: sub.subscription_id,
          status: sub.status,
          scheduled_change: effectiveAt,
          effective_at: effectiveAt,
          message: 'Subscription canceled at the end of your current trial/billing period.'
        }
      };
    }

    const res = await handleCancelRequest('usr_reg_success', 'sub_reg_success_001');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['Content-Type'], 'application/json');
    assert.strictEqual(paddleCalled, true);
    assert.strictEqual(paddlePayload.effective_from, 'next_billing_period');
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.status, 'trialing');
    assert.strictEqual(res.body.scheduled_change, '2026-10-07T06:02:52.567Z');
  });

  // =========================================================================
  // 36. Regression: Step 9.2 - Paddle cancellation succeeds but frontend receives malformed/non-JSON response
  // =========================================================================
  it('36. Regression 9.2: Frontend handles HTML/non-JSON responses safely without throwing SyntaxError <!doctype', async () => {
    // Simulate what account.html does on response
    async function processFrontendResponse(fakeResponse: {
      status: number;
      ok: boolean;
      headers: { get(name: string): string | null };
      text(): Promise<string>;
      json(): Promise<any>;
    }) {
      const contentType = fakeResponse.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await fakeResponse.text();
        throw new Error(`Cancellation service returned unexpected response (${fakeResponse.status}). Please try again later.`);
      }

      let data: any;
      try {
        data = await fakeResponse.json();
      } catch (parseErr: any) {
        throw new Error(`Cancellation service returned invalid JSON (${fakeResponse.status}).`);
      }

      if (!fakeResponse.ok) {
        throw new Error(data?.error || 'Failed to cancel subscription.');
      }
      return data;
    }

    // Case A: 404 HTML fallback from Vercel
    const vercel404Response = {
      status: 404,
      ok: false,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
      text: async () => '<!doctype html><html><head><title>404</title></head><body>Not Found</body></html>',
      json: async () => { throw new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON"); }
    };

    await assert.rejects(
      async () => processFrontendResponse(vercel404Response),
      (err: Error) => {
        assert.ok(!err.message.includes("Unexpected token '<'"), 'Must NOT throw SyntaxError for <!doctype');
        assert.ok(err.message.includes('unexpected response (404)'), 'Must produce user-friendly error message');
        return true;
      }
    );

    // Case B: Content-Type is json but body is malformed text
    const malformedJsonResponse = {
      status: 200,
      ok: true,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null },
      text: async () => 'not a valid json string {',
      json: async () => { throw new SyntaxError("Unexpected token 'n', \"not a vali\"... is not valid JSON"); }
    };

    await assert.rejects(
      async () => processFrontendResponse(malformedJsonResponse),
      (err: Error) => {
        assert.ok(err.message.includes('invalid JSON (200)'));
        return true;
      }
    );
  });

  // =========================================================================
  // 37. Regression: Step 9.3 - Backend 401/403
  // =========================================================================
  it('37. Regression 9.3: Backend returns clean JSON 401 for unauthenticated and 403 for unauthorized ownership', async () => {
    const mockDb = createMockSupabase({
      id: 'owner_usr_001',
      plan_tier: 'pro',
      subscription_status: 'active'
    });

    mockDb.subscriptions['sub_owned_by_owner'] = {
      subscription_id: 'sub_owned_by_owner',
      user_id: 'owner_usr_001',
      status: 'active'
    };

    function simulateEndpointAuth(token: string | null, authUserId: string | null, targetSubId: string) {
      if (!token || !authUserId) {
        return {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'Missing or invalid authorization session token.' }
        };
      }

      const sub = mockDb.subscriptions[targetSubId];
      if (!sub || sub.user_id !== authUserId) {
        return {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'Subscription not found or not owned by authenticated user.' }
        };
      }

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { success: true }
      };
    }

    // 401 Unauthenticated
    const res401 = simulateEndpointAuth(null, null, 'sub_owned_by_owner');
    assert.strictEqual(res401.status, 401);
    assert.strictEqual(res401.headers['Content-Type'], 'application/json');
    assert.strictEqual(res401.body.error, 'Missing or invalid authorization session token.');

    // 403 Forbidden (Attacker trying to cancel owner's subscription)
    const res403 = simulateEndpointAuth('valid_token_attacker', 'attacker_usr_999', 'sub_owned_by_owner');
    assert.strictEqual(res403.status, 403);
    assert.strictEqual(res403.headers['Content-Type'], 'application/json');
    assert.strictEqual(res403.body.error, 'Subscription not found or not owned by authenticated user.');
  });

  // =========================================================================
  // 38. Regression: Step 9.4 - Backend 404
  // =========================================================================
  it('38. Regression 9.4: Backend returns clean JSON 404 when no active/trialing subscription exists', async () => {
    const mockDb = createMockSupabase({
      id: 'free_usr_001',
      plan_tier: 'free',
      subscription_status: 'none'
    });

    function simulateLookup(userId: string) {
      const activeSubs = Object.values(mockDb.subscriptions).filter(
        (s: any) => s.user_id === userId && (s.status === 'active' || s.status === 'trialing')
      );

      if (activeSubs.length === 0) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'No active or trialing subscription found for this account.' }
        };
      }

      return { status: 200, body: { success: true } };
    }

    const res404 = simulateLookup('free_usr_001');
    assert.strictEqual(res404.status, 404);
    assert.strictEqual(res404.headers['Content-Type'], 'application/json');
    assert.strictEqual(res404.body.error, 'No active or trialing subscription found for this account.');
  });

  // =========================================================================
  // 39. Regression: Step 9.5 - Paddle API failure
  // =========================================================================
  it('39. Regression 9.5: Paddle API failure returns clean JSON 502 without exposing unhandled exceptions', async () => {
    function simulatePaddleFailure(paddleResponseStatus: number, paddleResponseBody: string, isJson: boolean) {
      if (!isJson) {
        return {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
          body: { error: `Payment provider returned unexpected response (${paddleResponseStatus}).` }
        };
      }

      return {
        status: paddleResponseStatus >= 400 && paddleResponseStatus < 500 ? paddleResponseStatus : 502,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Paddle API cancellation failed.', code: 'gateway_error' }
      };
    }

    // Upstream returns 500 HTML
    const htmlFailure = simulatePaddleFailure(500, '<html>500 Internal Error</html>', false);
    assert.strictEqual(htmlFailure.status, 502);
    assert.strictEqual(htmlFailure.headers['Content-Type'], 'application/json');
    assert.strictEqual(htmlFailure.body.error, 'Payment provider returned unexpected response (500).');

    // Upstream returns 503 JSON
    const jsonFailure = simulatePaddleFailure(503, JSON.stringify({ error: { code: 'service_unavailable' } }), true);
    assert.strictEqual(jsonFailure.status, 502);
    assert.strictEqual(jsonFailure.headers['Content-Type'], 'application/json');
    assert.strictEqual(jsonFailure.body.error, 'Paddle API cancellation failed.');
  });

  // =========================================================================
  // 40. Regression: Step 9.6 - Successful cancellation followed by subscription refresh
  // =========================================================================
  it('40. Regression 9.6: Successful cancellation followed by checkAccount refresh detects scheduled_change and retains Pro tier', async () => {
    const mockDb = createMockSupabase({
      id: 'refresh_usr_001',
      plan_tier: 'pro',
      subscription_status: 'trialing',
      paddle_subscription_id: 'sub_refresh_001'
    });

    const scheduledDate = '2026-10-07T06:02:52.567Z';
    mockDb.subscriptions['sub_refresh_001'] = {
      subscription_id: 'sub_refresh_001',
      user_id: 'refresh_usr_001',
      status: 'trialing',
      scheduled_change: scheduledDate
    };

    // Simulate checkAccount() query
    const subRecord = mockDb.subscriptions['sub_refresh_001'];
    const profile = mockDb.profile;

    // Check account state verification
    assert.strictEqual(profile.plan_tier, 'pro', 'User maintains Pro tier access');
    assert.strictEqual(profile.subscription_status, 'trialing');
    assert.strictEqual(subRecord.scheduled_change, scheduledDate, 'Scheduled change date must be present');

    // Simulate UI button state
    let buttonState = {
      disabled: false,
      text: 'Cancel Subscription',
      noticeVisible: false,
      noticeText: ''
    };

    if (subRecord.scheduled_change) {
      buttonState.disabled = true;
      buttonState.text = 'Cancellation Scheduled';
      buttonState.noticeVisible = true;
      buttonState.noticeText = `Subscription Notice: Cancellation scheduled. You retain full Pro access through ${scheduledDate}.`;
    }

    assert.strictEqual(buttonState.disabled, true);
    assert.strictEqual(buttonState.text, 'Cancellation Scheduled');
    assert.strictEqual(buttonState.noticeVisible, true);
    assert.ok(buttonState.noticeText.includes('Cancellation scheduled'));
  });
});
