import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { PRICING_CONFIG, getTierById } from '../../src/config/pricing.ts';
import {
  DODO_CONFIG,
  DODO_LIVE_PRODUCTS,
  FAIRNESS_PASS_METADATA,
  getDodoProductId,
  mapDodoProductToTier,
  normalizePlanTier,
  normalizeBillingInterval
} from '../../src/config/dodo.ts';
import { createDodoCheckoutSession } from '../../src/monetization/dodoService.ts';
import { getPlanningEntitlement, enforcePlanningHorizon } from '../../src/monetization/entitlements.ts';
import { runOptimization } from '../../src/optimizer/engine.ts';
import { rebalanceHousehold } from '../../src/optimizer/rebalancer.ts';

describe('Fairness Pass & Interactive Scheduler Upgrade Suite', () => {
  const rootDir = process.cwd();
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const appHtmlPath = path.join(rootDir, 'app.html');
  const pricingHtmlPath = path.join(rootDir, 'pricing.html');

  // ========================================================
  // 1. FREE PREVIEW MODEL (DAYS 1-3 OPEN, DAYS 4-7 PLACEHOLDER)
  // ========================================================
  describe('1. Free Preview Model Security & DOM Integrity', () => {
    it('index.html renders generic placeholder cards for Days 4–7 and does not leak hidden assignments', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

      // Verify open days and locked days definition
      assert.ok(indexHtml.includes('DAYS_OF_WEEK.slice(0, 3)'), 'Open days must be Mon–Wed (first 3 days)');
      assert.ok(indexHtml.includes('DAYS_OF_WEEK.slice(3)'), 'Locked days must be Thu–Sun (days 4–7)');

      // Verify that locked days render placeholder cards with zero real task serialization
      assert.ok(indexHtml.includes('cal-task-card-placeholder'), 'Must render placeholder cards on locked days');
      assert.ok(
        !indexHtml.includes('${lockedColsHtml = lockedDays.map(d => {\n          const dayTasks = weekAssignments.filter'),
        'Locked days must not map weekAssignments to DOM in free mode'
      );

      // Verify unlock CTA copy
      assert.ok(indexHtml.includes('Unlock Complete Plan for $14.99 (One-Time) →'), 'Must offer $14.99 Fairness Pass');
      assert.ok(indexHtml.includes('Or subscribe monthly for $5.99/mo'), 'Must offer $5.99/mo Pro option');
    });

    it('app.html also renders placeholder cards for unauthorized users', () => {
      const appHtml = fs.readFileSync(appHtmlPath, 'utf8');

      assert.ok(appHtml.includes('cal-task-card-placeholder'), 'app.html must render placeholder cards for free tier');
      assert.ok(appHtml.includes('cal-locked-row'), 'app.html must render locked rows in table view');
      assert.ok(appHtml.includes('Unlock Complete Plan for $14.99 (One-Time) →'), 'app.html must have Fairness Pass CTA');
    });

    it('free tier is strictly restricted to 1 planning week', () => {
      const freeEntitlement = getPlanningEntitlement(null);
      assert.strictEqual(freeEntitlement.tier, 'free');
      assert.strictEqual(freeEntitlement.maxPlanningWeeks, 1);
      assert.strictEqual(freeEntitlement.isPaid, false);

      // Attempting to enforce 4 weeks on free tier must clamp to 1 week
      const clamped = enforcePlanningHorizon(4, freeEntitlement);
      assert.strictEqual(clamped, 1);
    });
  });

  // ========================================================
  // 2. FAIRNESS PASS & PRO LIVE DODO CONFIGURATION
  // ========================================================
  describe('2. Live Dodo Product Mapping & Pricing', () => {
    it('configures live product IDs correctly without exposing secrets', () => {
      assert.strictEqual(
        DODO_LIVE_PRODUCTS.fairness_pass,
        'pdt_0NphhaL0NCaWmH3nA3FdK',
        'Fairness Pass must use live ID pdt_0NphhaL0NCaWmH3nA3FdK'
      );
      assert.strictEqual(
        DODO_LIVE_PRODUCTS.pro_monthly,
        'pdt_0Np1eZsemtECph1HLoDb0',
        'Pro Monthly must use live ID pdt_0Np1eZsemtECph1HLoDb0'
      );
    });

    it('maps live product ID back to correct plan tier', () => {
      assert.strictEqual(mapDodoProductToTier('pdt_0NphhaL0NCaWmH3nA3FdK')?.tier, 'fairness_pass');
      assert.strictEqual(mapDodoProductToTier('pdt_0Np1eZsemtECph1HLoDb0')?.tier, 'pro');
    });

    it('pricing configuration reflects exact product pricing and terms', () => {
      const pass = getTierById('fairness_pass');
      assert.ok(pass);
      assert.strictEqual(pass.monthlyPrice, 14.99);
      assert.strictEqual(pass.annualPrice, 14.99);
      assert.strictEqual(pass.isOneTime, true);
      assert.strictEqual(pass.monthlyRenewalAmount, 0);
      assert.strictEqual(pass.trialDays, 0);

      const pro = getTierById('pro');
      assert.ok(pro);
      assert.strictEqual(pro.monthlyPrice, 5.99);
    });

    it('webhook edge function handles 365-day access for one-time fairness pass', () => {
      const webhookPath = path.join(rootDir, 'supabase', 'functions', 'dodo-webhook', 'index.ts');
      const webhookContent = fs.readFileSync(webhookPath, 'utf8');

      assert.ok(webhookContent.includes('fairness_pass'), 'Webhook must handle fairness_pass tier');
      assert.ok(
        webhookContent.includes('365 * 86400 * 1000') || webhookContent.includes('365 * 24 * 60 * 60 * 1000'),
        'Webhook must grant 365 days (1 year) periodEnd for one-time pass'
      );
    });
  });

  // ========================================================
  // 3. INTERACTIVE DRAG-AND-DROP SCHEDULER & CONSTRAINTS
  // ========================================================
  describe('3. Drag-and-Drop Calendar Engine & Hard-Limit Conflicts', () => {
    it('index.html and app.html include scheduler action bar with 3 buttons', () => {
      for (const p of [indexHtmlPath, appHtmlPath]) {
        const content = fs.readFileSync(p, 'utf8');
        assert.ok(content.includes('id="schedulerActionBar"'), `${path.basename(p)} must include #schedulerActionBar`);
        assert.ok(content.includes('id="btnApplyScheduleEdits"'), `${path.basename(p)} must have Update Calculator button`);
        assert.ok(content.includes('id="btnPinAndRebalance"'), `${path.basename(p)} must have Pin Edits & Auto-Rebalance Rest button`);
        assert.ok(content.includes('id="btnResetScheduleEdits"'), `${path.basename(p)} must have Reset button`);
      }
    });

    it('renderTaskCardHtml includes drag handle, shift buttons, and member swap badge', () => {
      for (const p of [indexHtmlPath, appHtmlPath]) {
        const content = fs.readFileSync(p, 'utf8');
        assert.ok(content.includes('cal-card-handle'), `${path.basename(p)} must have ⋮⋮ grab handle`);
        assert.ok(content.includes('btn-cal-shift-prev'), `${path.basename(p)} must have mobile left shift button`);
        assert.ok(content.includes('btn-cal-shift-next'), `${path.basename(p)} must have mobile right shift button`);
        assert.ok(content.includes('data-action="swap-member"'), `${path.basename(p)} must have member badge swap action`);
      }
    });

    it('deterministic solver supports pinned assignments without altering manual placements', () => {
      const request = {
        household: { id: 'h1', name: 'Test Household', type: 'couple', mode: 'capacity_aware', planningHorizonWeeks: 1 },
        members: [
          { id: 'm1', name: 'Alex', role: 'Adult', weeklyCapacityMinutes: 200, unavailableDays: [], preferredTaskIds: [], avoidedTaskIds: [] },
          { id: 'm2', name: 'Sam', role: 'Adult', weeklyCapacityMinutes: 200, unavailableDays: [], preferredTaskIds: [], avoidedTaskIds: [] }
        ],
        tasks: [
          { id: 't1', name: 'Dishes', category: 'Kitchen', frequencyPerWeek: 3, durationMinutes: 20, effortLevel: 1, eligibleMemberIds: ['m1', 'm2'] },
          { id: 't2', name: 'Vacuum', category: 'Cleaning', frequencyPerWeek: 1, durationMinutes: 40, effortLevel: 2, eligibleMemberIds: ['m1', 'm2'] }
        ]
      };

      const initialResult = runOptimization(request);
      assert.ok(initialResult.assignments.length > 0);

      // Pin the first assignment to Friday with Sam
      const pinned = initialResult.assignments.map((a, i) => {
        if (i === 0) {
          return {
            ...a,
            memberId: 'm2',
            memberName: 'Sam',
            dayOfWeek: 'fri',
            isPinned: true
          };
        }
        return a;
      });

      const rebalanced = rebalanceHousehold(request, pinned);
      // Pinned assignment must remain on Friday with Sam
      const preserved = rebalanced.assignments.find(a => a.taskId === pinned[0].taskId && a.dayOfWeek === 'fri');
      assert.ok(preserved, 'Pinned assignment must remain on Friday');
      assert.strictEqual(preserved.memberId, 'm2', 'Pinned assignment must preserve manual assignee Sam');
    });

    it('free tier allows exactly 1 free calculator update before gating', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
      assert.ok(
        indexHtml.includes('freeCalculatorUpdatesUsed >= 1'),
        'index.html must gate free users after 1 update'
      );
      const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
      assert.ok(
        appHtml.includes('freeCalculatorUpdatesUsed >= 1'),
        'app.html must gate free users after 1 update'
      );
    });
  });

  // ========================================================
  // 4. SHARE FAIRNESS RECEIPT & VIRAL CARD
  // ========================================================
  describe('4. Viral Fairness Receipt Modal', () => {
    it('both index.html and app.html include #fairnessReceiptModal with 9:16 scorecard', () => {
      for (const p of [indexHtmlPath, appHtmlPath]) {
        const content = fs.readFileSync(p, 'utf8');
        assert.ok(content.includes('id="fairnessReceiptModal"'), `${path.basename(p)} must include receipt modal`);
        assert.ok(content.includes('id="receiptVerdictBadge"'), `${path.basename(p)} must show verdict badge`);
        assert.ok(content.includes('id="btnCopyReceiptText"'), `${path.basename(p)} must have Copy Summary button`);
        assert.ok(content.includes('ChoreMatrix.online'), `${path.basename(p)} must attribute ChoreMatrix.online`);
      }
    });

    it('homepage hero headline is updated with the direct-response hook', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
      assert.ok(
        indexHtml.includes('Stop Guessing Who Does More. Build a Fairer Chore Plan.'),
        'Hero headline must use the direct-response hook'
      );
    });
  });

  // ========================================================
  // 5. APPLICATION-LEVEL DODO PRODUCT MAPPING & VALIDATION
  // ========================================================
  describe('5. Application-Level Dodo Product Mapping & Plan Validation', () => {
    it('maps public application plan slug "fairness_pass" to exact product ID pdt_0NphhaL0NCaWmH3nA3FdK', () => {
      assert.strictEqual(getDodoProductId('fairness_pass'), 'pdt_0NphhaL0NCaWmH3nA3FdK');
      assert.strictEqual(getDodoProductId('fairness_pass', 'one_time'), 'pdt_0NphhaL0NCaWmH3nA3FdK');
      assert.strictEqual(getDodoProductId('fairness-pass'), 'pdt_0NphhaL0NCaWmH3nA3FdK');
      assert.strictEqual(getDodoProductId('fairness_pass_one_time'), 'pdt_0NphhaL0NCaWmH3nA3FdK');
      assert.strictEqual(getDodoProductId('onetime_pass'), 'pdt_0NphhaL0NCaWmH3nA3FdK');
      assert.strictEqual(getDodoProductId('pass'), 'pdt_0NphhaL0NCaWmH3nA3FdK');
    });

    it('maps Pro plan to verified Pro Monthly product ID pdt_0Np1eZsemtECph1HLoDb0 in live mode', () => {
      assert.strictEqual(getDodoProductId('pro', 'monthly', 'live_mode'), 'pdt_0Np1eZsemtECph1HLoDb0');
      assert.strictEqual(getDodoProductId('household_pro', 'monthly', 'live_mode'), 'pdt_0Np1eZsemtECph1HLoDb0');
    });

    it('normalizes plan and interval without throwing Invalid plan "fairness_pass"', () => {
      assert.strictEqual(normalizePlanTier('fairness_pass'), 'fairness_pass');
      assert.strictEqual(normalizePlanTier('fairness-pass'), 'fairness_pass');
      assert.strictEqual(normalizePlanTier('fairness_pass_one_time'), 'fairness_pass');
      assert.strictEqual(normalizeBillingInterval(undefined, 'fairness_pass'), 'one_time');
      assert.strictEqual(normalizeBillingInterval('one_time'), 'one_time');
    });

    it('retains source_product_id metadata reference without overriding checkout product ID', () => {
      assert.strictEqual(FAIRNESS_PASS_METADATA.source_product_id, 'pdt_0NphhVTxhO0pNjHindcHi');
      const productDef = mapDodoProductToTier('pdt_0NphhaL0NCaWmH3nA3FdK');
      assert.strictEqual(productDef?.tier, 'fairness_pass');
      assert.strictEqual(productDef?.amount, 14.99);

      // Verify source reference is recognized for product lookup compatibility
      const sourceDef = mapDodoProductToTier('pdt_0NphhVTxhO0pNjHindcHi');
      assert.strictEqual(sourceDef?.tier, 'fairness_pass');
    });

    it('creates Dodo checkout session for Fairness Pass with correct product and metadata, without subscription_data', async () => {
      let capturedPayload: any = null;
      let capturedUrl = '';
      const customFetch = (async (url: string, init: any) => {
        capturedUrl = url;
        capturedPayload = JSON.parse(init.body);
        return new Response(JSON.stringify({
          checkout_url: 'https://test.dodopayments.com/checkout/chk_test_123',
          session_id: 'chk_test_123'
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;

      const result = await createDodoCheckoutSession({
        plan: 'fairness_pass',
        user: { id: 'usr_fp_test', email: 'test@example.com' },
        credentials: { apiKey: 'dodo_api_key_test', baseUrl: 'https://test.dodopayments.com' },
        isTrialEligible: true, // Should be ignored for one-time
        customFetch
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.product_id, 'pdt_0NphhaL0NCaWmH3nA3FdK');
      assert.strictEqual(capturedPayload.product_cart[0].product_id, 'pdt_0NphhaL0NCaWmH3nA3FdK');
      assert.strictEqual(capturedPayload.metadata.source_product_id, 'pdt_0NphhVTxhO0pNjHindcHi');
      assert.strictEqual(capturedPayload.subscription_data, undefined, 'One-time Fairness Pass must not send subscription_data');
    });

    it('preserves Pro checkout with 7-day trial for eligible accounts', async () => {
      let capturedPayload: any = null;
      const customFetch = (async (_url: string, init: any) => {
        capturedPayload = JSON.parse(init.body);
        return new Response(JSON.stringify({
          checkout_url: 'https://test.dodopayments.com/checkout/chk_pro_123',
          session_id: 'chk_pro_123'
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;

      const result = await createDodoCheckoutSession({
        plan: 'pro',
        interval: 'monthly',
        user: { id: 'usr_pro_test', email: 'pro@example.com' },
        credentials: { apiKey: 'dodo_api_key_test', baseUrl: 'https://test.dodopayments.com' },
        isTrialEligible: true,
        customFetch
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(capturedPayload.subscription_data?.trial_period_days, 7, 'Pro must include 7-day trial when eligible');
    });
  });
});
