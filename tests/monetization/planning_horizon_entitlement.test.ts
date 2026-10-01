import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
  getPlanningEntitlement,
  resolvePlanningEntitlement,
  enforcePlanningHorizon
} from '../../src/monetization/entitlements.ts';
import type { PlanningEntitlement } from '../../src/monetization/entitlements.ts';
import { runOptimization } from '../../src/optimizer/engine.ts';
import { rebalanceHousehold } from '../../src/optimizer/rebalancer.ts';
import type { OptimizationRequest } from '../../src/optimizer/types.ts';

const coupleHouseholdFixture: OptimizationRequest = {
  household: {
    id: 'h_test',
    name: 'Test Household',
    type: 'couple',
    mode: 'capacity_aware',
    planningHorizonWeeks: 4
  },
  members: [
    { id: 'm1', name: 'Alex', role: 'Adult', weeklyCapacityMinutes: 240, unavailableDays: [] },
    { id: 'm2', name: 'Sam', role: 'Adult', weeklyCapacityMinutes: 240, unavailableDays: [] }
  ],
  tasks: [
    { id: 't1', name: 'Cook', category: 'Food', frequencyPerWeek: 7, durationMinutes: 30, effortLevel: 3, eligibleMemberIds: ['m1', 'm2'] },
    { id: 't2', name: 'Dishes', category: 'Kitchen', frequencyPerWeek: 7, durationMinutes: 15, effortLevel: 2, eligibleMemberIds: ['m1', 'm2'] }
  ]
};

describe('ChoreMatrix Planning Horizon Entitlement & Security Suite', () => {
  const rootDir = process.cwd();
  const appHtmlPath = path.join(rootDir, 'app.html');
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const distAppHtmlPath = path.join(rootDir, 'dist', 'app.html');
  const distIndexHtmlPath = path.join(rootDir, 'dist', 'index.html');

  // ========================================================
  // 1. UNAUTHENTICATED ENTITLEMENT RESOLUTION
  // ========================================================
  it('1. unauthenticated -> only 1 week (maxPlanningWeeks = 1, isPaid = false)', () => {
    const unauthedEntitlement = getPlanningEntitlement(null);
    assert.strictEqual(unauthedEntitlement.tier, 'free');
    assert.strictEqual(unauthedEntitlement.maxPlanningWeeks, 1);
    assert.strictEqual(unauthedEntitlement.isPaid, false);
    assert.deepStrictEqual(unauthedEntitlement.allowedWeeks, [1]);

    const undefinedEntitlement = getPlanningEntitlement(undefined);
    assert.strictEqual(undefinedEntitlement.maxPlanningWeeks, 1);
    assert.strictEqual(undefinedEntitlement.isPaid, false);

    const emptyObjEntitlement = getPlanningEntitlement({});
    assert.strictEqual(emptyObjEntitlement.tier, 'free');
    assert.strictEqual(emptyObjEntitlement.maxPlanningWeeks, 1);
  });

  // ========================================================
  // 2. AUTHENTICATED FREE USER
  // ========================================================
  it('2. Free -> only 1 week', () => {
    const freeProfile = { plan_tier: 'free', subscription_status: 'active' };
    const entitlement = getPlanningEntitlement(freeProfile);
    assert.strictEqual(entitlement.tier, 'free');
    assert.strictEqual(entitlement.maxPlanningWeeks, 1);
    assert.strictEqual(entitlement.isPaid, false);
    assert.deepStrictEqual(entitlement.allowedWeeks, [1]);
  });

  // ========================================================
  // 3. AUTHENTICATED PRO USER
  // ========================================================
  it('3. Pro -> 4 weeks', () => {
    const proProfile = { plan_tier: 'pro', subscription_status: 'active' };
    const entitlement = getPlanningEntitlement(proProfile);
    assert.strictEqual(entitlement.tier, 'pro');
    assert.strictEqual(entitlement.maxPlanningWeeks, 4);
    assert.strictEqual(entitlement.isPaid, true);
    assert.deepStrictEqual(entitlement.allowedWeeks, [1, 2, 3, 4]);
  });

  // ========================================================
  // 4. AUTHENTICATED PLUS USER
  // ========================================================
  it('4. Plus -> 4 weeks', () => {
    const plusProfile = { plan_tier: 'plus', subscription_status: 'active' };
    const entitlement = getPlanningEntitlement(plusProfile);
    assert.strictEqual(entitlement.tier, 'plus');
    assert.strictEqual(entitlement.maxPlanningWeeks, 4);
    assert.strictEqual(entitlement.isPaid, true);
    assert.deepStrictEqual(entitlement.allowedWeeks, [1, 2, 3, 4]);
  });

  // ========================================================
  // 5. LOGOUT FROM PRO -> DROPS TO 1 WEEK
  // ========================================================
  it('5. logout from Pro -> immediately reverts to 1 week', () => {
    let session: any = { user: { id: 'usr_pro' } };
    let profile: any = { plan_tier: 'pro', subscription_status: 'active' };
    let entitlement = getPlanningEntitlement(profile);
    assert.strictEqual(entitlement.maxPlanningWeeks, 4);

    // Simulate session logout
    session = null;
    profile = null;
    entitlement = getPlanningEntitlement(profile);
    assert.strictEqual(entitlement.tier, 'free');
    assert.strictEqual(entitlement.maxPlanningWeeks, 1);
    assert.strictEqual(entitlement.isPaid, false);
  });

  // ========================================================
  // 6. CANCELLATION TO FREE -> DROPS TO 1 WEEK
  // ========================================================
  it('6. cancellation to Free -> only 1 week after cancellation persisted', () => {
    const canceledProfile = { plan_tier: 'free', subscription_status: 'canceled' };
    const entitlement = getPlanningEntitlement(canceledProfile);
    assert.strictEqual(entitlement.tier, 'free');
    assert.strictEqual(entitlement.maxPlanningWeeks, 1);
    assert.strictEqual(entitlement.isPaid, false);

    const proCanceledProfile = { plan_tier: 'pro', subscription_status: 'canceled' };
    const proCanceledEntitlement = getPlanningEntitlement(proCanceledProfile);
    assert.strictEqual(proCanceledEntitlement.tier, 'free');
    assert.strictEqual(proCanceledEntitlement.maxPlanningWeeks, 1);
    assert.strictEqual(proCanceledEntitlement.isPaid, false);
  });

  // ========================================================
  // 7. STALE 4-WEEK CLIENT STATE -> NORMALIZED
  // ========================================================
  it('7. stale 4-week client state -> normalized to 1 week', () => {
    const freeEntitlement = getPlanningEntitlement(null);
    const staleRequestedWeeks = 4;
    const safeWeeks = enforcePlanningHorizon(staleRequestedWeeks, freeEntitlement);
    assert.strictEqual(safeWeeks, 1, 'Stale 4-week client value must be normalized to 1 week');

    const garbageWeeks = 'invalid_number';
    assert.strictEqual(enforcePlanningHorizon(garbageWeeks, freeEntitlement), 1);
  });

  // ========================================================
  // 8. URL FORCING 4 WEEKS -> REJECTED / NORMALIZED
  // ========================================================
  it('8. URL forcing 4 weeks -> normalized to 1 week', () => {
    const freeEntitlement = getPlanningEntitlement(null);
    const mockUrlParams = new URLSearchParams('weeks=4&horizon=4');
    const requestedWeeks = mockUrlParams.get('weeks');
    const safeWeeks = enforcePlanningHorizon(requestedWeeks, freeEntitlement);
    assert.strictEqual(safeWeeks, 1, 'URL query parameter cannot escalate entitlement to 4 weeks');
  });

  // ========================================================
  // 9. DIRECT CALCULATION REQUEST FORCING 4 WEEKS -> REJECTED / CLAMPED
  // ========================================================
  it('9. direct calculation request forcing 4 weeks -> clamped to 1 week for Free / unauthenticated', () => {
    const freeEntitlement = getPlanningEntitlement(null);
    const unauthedRequest: OptimizationRequest = {
      ...coupleHouseholdFixture,
      household: {
        ...coupleHouseholdFixture.household,
        planningHorizonWeeks: 4
      }
    };

    // runOptimization with freeEntitlement must produce a 1-week plan only
    const result = runOptimization(unauthedRequest, freeEntitlement);
    assert.strictEqual(result.weeks, 1, 'Plan calculation result must be strictly clamped to 1 week');
    assert.ok(result.assignments.length > 0, 'Assignments must exist for week 1');
    assert.ok(
      result.assignments.every(a => a.weekIndex === 0),
      'All assignments must strictly belong to weekIndex 0 (Week 1)'
    );

    // rebalanceHousehold with freeEntitlement must also preserve 1-week limit
    const rebalanced = rebalanceHousehold(unauthedRequest, result.assignments, freeEntitlement);
    assert.strictEqual(rebalanced.weeks, 1, 'Rebalanced plan result must be strictly clamped to 1 week');
    assert.ok(
      rebalanced.assignments.every(a => a.weekIndex === 0),
      'All rebalanced assignments must strictly belong to weekIndex 0'
    );
  });

  // ========================================================
  // 10. WEEK 2/3/4 TABS UNAVAILABLE FOR FREE / UNAUTHENTICATED
  // ========================================================
  it('10. Week 2/3/4 tabs are not rendered for Free / unauthenticated', () => {
    const freeEntitlement = getPlanningEntitlement(null);
    const result = runOptimization(coupleHouseholdFixture, freeEntitlement);

    // Simulate tab strip generation from renderResults()
    const horizon = Math.min(freeEntitlement.maxPlanningWeeks, result.weeks);
    const tabLabels = Array.from({ length: horizon }).map((_, w) => `Week ${w + 1}`);

    assert.deepStrictEqual(tabLabels, ['Week 1'], 'Only Week 1 tab must be generated');
    assert.strictEqual(tabLabels.includes('Week 2'), false);
    assert.strictEqual(tabLabels.includes('Week 3'), false);
    assert.strictEqual(tabLabels.includes('Week 4'), false);
  });

  // ========================================================
  // 11. AUTHENTICATION-LOADING STATE NEVER EXPOSES PAID CONTROLS
  // ========================================================
  it('11. authentication-loading state and static HTML never expose paid controls', () => {
    // Both app.html and index.html static markup must contain ONLY 1 Week option
    const appHtml = fs.readFileSync(appHtmlPath, 'utf8');
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

    for (const [name, content] of [['app.html', appHtml], ['index.html', indexHtml]]) {
      const selWeeksBlockMatch = content.match(/<select id="selWeeks"[^>]*>([\s\S]*?)<\/select>/);
      assert.ok(selWeeksBlockMatch, `${name} must contain select#selWeeks`);
      const selWeeksContent = selWeeksBlockMatch[1];

      assert.ok(selWeeksContent.includes('value="1"'), `${name} selWeeks must contain value 1`);
      assert.ok(!selWeeksContent.includes('value="2"'), `${name} static HTML must NOT contain value 2 (FOUC leak)`);
      assert.ok(!selWeeksContent.includes('value="3"'), `${name} static HTML must NOT contain value 3 (FOUC leak)`);
      assert.ok(!selWeeksContent.includes('value="4"'), `${name} static HTML must NOT contain value 4 (FOUC leak)`);
    }

    // Default presets in both files must have planningHorizonWeeks: 1
    for (const [name, content] of [['app.html', appHtml], ['index.html', indexHtml]]) {
      assert.ok(
        content.includes("planningHorizonWeeks: 1"),
        `${name} presets must default to planningHorizonWeeks: 1`
      );
      assert.ok(
        !content.includes("planningHorizonWeeks: 4"),
        `${name} must not contain presets with hardcoded planningHorizonWeeks: 4`
      );
    }
  });

  // ========================================================
  // 12. LOGIN FROM ANONYMOUS -> RESTORES CORRECT PRO ENTITLEMENT
  // ========================================================
  it('12. login from anonymous -> correct entitlement after server profile loads', async () => {
    let currentEntitlement = getPlanningEntitlement(null);
    assert.strictEqual(currentEntitlement.maxPlanningWeeks, 1);

    // Mock asynchronous profile fetcher
    const mockFetcher = async (uid: string) => {
      if (uid === 'usr_pro') {
        return { plan_tier: 'pro', subscription_status: 'active' };
      }
      return { plan_tier: 'free', subscription_status: 'active' };
    };

    // User logs in as Pro
    currentEntitlement = await resolvePlanningEntitlement({ id: 'usr_pro' }, mockFetcher);
    assert.strictEqual(currentEntitlement.tier, 'pro');
    assert.strictEqual(currentEntitlement.maxPlanningWeeks, 4);
    assert.strictEqual(currentEntitlement.isPaid, true);
    assert.deepStrictEqual(currentEntitlement.allowedWeeks, [1, 2, 3, 4]);

    // Authorized calculation now successfully computes 4 weeks
    const proResult = runOptimization(coupleHouseholdFixture, currentEntitlement);
    assert.strictEqual(proResult.weeks, 4, 'Pro user calculation must produce 4 weeks');
    assert.ok(proResult.assignments.some(a => a.weekIndex === 3), 'Pro plan must contain assignments for Week 4');
  });

  // ========================================================
  // 13. DIST ASSET VERIFICATION
  // ========================================================
  it('13. dist/app.html and dist/index.html are rebuilt and protected', () => {
    assert.ok(fs.existsSync(distAppHtmlPath), 'dist/app.html must exist');
    assert.ok(fs.existsSync(distIndexHtmlPath), 'dist/index.html must exist');

    for (const [name, p] of [['dist/app.html', distAppHtmlPath], ['dist/index.html', distIndexHtmlPath]]) {
      const content = fs.readFileSync(p, 'utf8');
      const selWeeksBlockMatch = content.match(/<select id="selWeeks"[^>]*>([\s\S]*?)<\/select>/);
      assert.ok(selWeeksBlockMatch, `${name} must contain select#selWeeks`);
      const selWeeksContent = selWeeksBlockMatch[1];
      assert.ok(!selWeeksContent.includes('value="4"'), `${name} must not contain value 4 in static select`);
    }
  });
});
