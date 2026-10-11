import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOptimization } from '../../src/optimizer/engine.ts';
import { rebalanceHousehold } from '../../src/optimizer/rebalancer.ts';
import { saveLocalDraft, loadLocalDraft } from '../../src/persistence/localDraft.ts';
import { getPlanningEntitlement } from '../../src/monetization/entitlements.ts';
import { getDayOfWeekFromDateString, getLocalISODate, addDaysToDate } from '../../src/optimizer/scheduler.ts';
import { coupleHouseholdFixture, familyHouseholdFixture } from './fixtures.ts';
import type { OptimizationRequest } from '../../src/optimizer/types.ts';

describe('Single-Day Planning Feature', () => {
  // Helper dates (2026-10-12 is Monday, 2026-10-15 is Thursday, 2026-10-18 is Sunday)
  const mondayDate = '2026-10-12';
  const tuesdayDate = '2026-10-13';
  const thursdayDate = '2026-10-15';
  const sundayDate = '2026-10-18';

  it('1. Selecting Single Day generates a plan for exactly one target date and day-of-week', () => {
    const request: OptimizationRequest = {
      ...coupleHouseholdFixture,
      household: {
        ...coupleHouseholdFixture.household,
        planningMode: 'single_day',
        targetDate: thursdayDate,
        targetDayOfWeek: 'thu',
      },
    };

    const result = runOptimization(request);

    assert.equal(result.weeks, 1, 'Single-day plan must report 1 week container');
    assert.equal(result.planningMode, 'single_day', 'Result must indicate single_day mode');
    assert.equal(result.targetDate, thursdayDate, 'Result must retain targetDate');
    assert.equal(result.targetDayOfWeek, 'thu', 'Result must retain targetDayOfWeek');

    assert.ok(result.assignments.length > 0, 'Should have chores assigned on Thursday');
    for (const a of result.assignments) {
      assert.equal(a.dayOfWeek, 'thu', `Every assignment must be for Thursday, got ${a.dayOfWeek}`);
      assert.equal(a.weekIndex, 0, 'All assignments belong to weekIndex 0');
    }
  });

  it('2. Target date and day-of-week are computed correctly from ISO date strings', () => {
    assert.equal(getDayOfWeekFromDateString('2026-10-12'), 'mon');
    assert.equal(getDayOfWeekFromDateString('2026-10-13'), 'tue');
    assert.equal(getDayOfWeekFromDateString('2026-10-14'), 'wed');
    assert.equal(getDayOfWeekFromDateString('2026-10-15'), 'thu');
    assert.equal(getDayOfWeekFromDateString('2026-10-16'), 'fri');
    assert.equal(getDayOfWeekFromDateString('2026-10-17'), 'sat');
    assert.equal(getDayOfWeekFromDateString('2026-10-18'), 'sun');
  });

  it('3. Fixed-day chores are NOT scheduled on ineligible days', () => {
    const requestWithFixedChore: OptimizationRequest = {
      household: {
        id: 'h_test',
        name: 'Fixed Test',
        type: 'couple',
        mode: 'capacity_aware',
        planningHorizonWeeks: 1,
        planningMode: 'single_day',
        targetDate: tuesdayDate, // Tuesday
        targetDayOfWeek: 'tue',
      },
      members: [
        { id: 'm1', name: 'Member 1', role: 'Adult', weeklyCapacityMinutes: 300 },
        { id: 'm2', name: 'Member 2', role: 'Adult', weeklyCapacityMinutes: 300 },
      ],
      tasks: [
        {
          id: 't_fixed_mon',
          name: 'Take Out Trash',
          category: 'Cleaning',
          frequencyPerWeek: 1,
          durationMinutes: 20,
          effortLevel: 2,
          fixedDays: ['mon'], // Strictly Monday
          eligibleMemberIds: ['m1', 'm2'],
        },
        {
          id: 't_daily',
          name: 'Wash Dishes',
          category: 'Kitchen',
          frequencyPerWeek: 7,
          durationMinutes: 25,
          effortLevel: 2,
          eligibleMemberIds: ['m1', 'm2'],
        },
      ],
    };

    // When planned for Tuesday:
    const resultTue = runOptimization(requestWithFixedChore);
    assert.ok(
      !resultTue.assignments.some(a => a.taskId === 't_fixed_mon'),
      'Chore fixed to Monday must NOT appear on Tuesday plan'
    );
    assert.ok(
      resultTue.assignments.some(a => a.taskId === 't_daily'),
      'Daily chore must appear on Tuesday'
    );

    // When planned for Monday:
    const resultMon = runOptimization({
      ...requestWithFixedChore,
      household: {
        ...requestWithFixedChore.household,
        targetDate: mondayDate,
        targetDayOfWeek: 'mon',
      },
    });
    assert.ok(
      resultMon.assignments.some(a => a.taskId === 't_fixed_mon'),
      'Chore fixed to Monday MUST appear on Monday plan'
    );
  });

  it('4. Weekly task frequency is NEVER compressed into one single day', () => {
    const request: OptimizationRequest = {
      household: {
        id: 'h_freq',
        name: 'Freq Test',
        type: 'couple',
        mode: 'capacity_aware',
        planningHorizonWeeks: 1,
        planningMode: 'single_day',
        targetDate: mondayDate,
        targetDayOfWeek: 'mon',
      },
      members: [
        { id: 'm1', name: 'Member 1', role: 'Adult', weeklyCapacityMinutes: 500 },
      ],
      tasks: [
        {
          id: 't_3x',
          name: 'Vacuum',
          category: 'Cleaning',
          frequencyPerWeek: 3, // 3x a week
          durationMinutes: 30,
          effortLevel: 2,
          eligibleMemberIds: ['m1'],
        },
        {
          id: 't_7x',
          name: 'Dishes',
          category: 'Kitchen',
          frequencyPerWeek: 7, // 7x a week
          durationMinutes: 20,
          effortLevel: 2,
          eligibleMemberIds: ['m1'],
        },
      ],
    };

    const result = runOptimization(request);

    // A 3x/week chore must NEVER appear 3 times in a single day
    const vacuumCount = result.assignments.filter(a => a.taskId === 't_3x').length;
    assert.ok(vacuumCount <= 1, `Chore 3x/week must appear at most once per single day, got ${vacuumCount}`);

    // A 7x/week chore appears exactly once
    const dishesCount = result.assignments.filter(a => a.taskId === 't_7x').length;
    assert.equal(dishesCount, 1, `Daily chore must appear exactly once on single day, got ${dishesCount}`);
  });

  it('5. Member eligibility and availability constraints remain strictly enforced', () => {
    const request: OptimizationRequest = {
      household: {
        id: 'h_unav',
        name: 'Availability Test',
        type: 'couple',
        mode: 'capacity_aware',
        planningHorizonWeeks: 1,
        planningMode: 'single_day',
        targetDate: thursdayDate,
        targetDayOfWeek: 'thu',
      },
      members: [
        // Member 1 is unavailable on Thursday
        { id: 'm1', name: 'Alex', role: 'Adult', weeklyCapacityMinutes: 240, unavailableDays: ['thu'] },
        // Member 2 is available
        { id: 'm2', name: 'Sam', role: 'Adult', weeklyCapacityMinutes: 240, unavailableDays: [] },
      ],
      tasks: [
        {
          id: 't_cook',
          name: 'Dinner Cooking',
          category: 'Food',
          frequencyPerWeek: 7,
          durationMinutes: 40,
          effortLevel: 3,
          eligibleMemberIds: ['m1', 'm2'],
        },
      ],
    };

    const result = runOptimization(request);
    assert.equal(result.assignments.length, 1);
    assert.equal(result.assignments[0].memberId, 'm2', 'Must assign to Sam because Alex is unavailable on Thursday');
    assert.notEqual(result.assignments[0].memberId, 'm1', 'Alex must NOT receive tasks on an unavailable day');
  });

  it('6. Duration, effort, and workload balancing logic are preserved for single day', () => {
    const request: OptimizationRequest = {
      ...coupleHouseholdFixture,
      household: {
        ...coupleHouseholdFixture.household,
        planningMode: 'single_day',
        targetDate: sundayDate,
        targetDayOfWeek: 'sun',
      },
    };

    const result = runOptimization(request);

    // Check diagnostics
    assert.ok(result.diagnostics.balanceScore > 0, 'Balance score must be calculated');
    assert.ok(result.diagnostics.totalHouseholdCapacityMinutes > 0, 'Daily capacity must be > 0');
    assert.ok(result.diagnostics.totalHouseholdWorkMinutes > 0, 'Daily work minutes must be > 0');

    // Check member summaries
    assert.equal(result.memberSummaries.length, 2);
    for (const summary of result.memberSummaries) {
      assert.ok(summary.assignedMinutes >= 0);
      assert.ok(summary.weeklyCapacityMinutes > 0);
    }
  });

  it('7. Rebalance affects only the selected day allocation and reports diff', () => {
    // 1. Initial single-day plan on Sunday
    const initialRequest: OptimizationRequest = {
      ...coupleHouseholdFixture,
      household: {
        ...coupleHouseholdFixture.household,
        planningMode: 'single_day',
        targetDate: sundayDate,
        targetDayOfWeek: 'sun',
      },
    };
    const initialResult = runOptimization(initialRequest);
    assert.ok(initialResult.assignments.length > 0);

    // Find who was assigned cooking on Sunday
    const cookingAssignment = initialResult.assignments.find(a => a.taskId === 't_cooking');
    assert.ok(cookingAssignment);
    const assignedMemberId = cookingAssignment.memberId;
    const otherMemberId = assignedMemberId === 'm_alex' ? 'm_sam' : 'm_alex';

    // 2. Make that assigned member unavailable on Sunday
    const updatedRequest: OptimizationRequest = {
      ...initialRequest,
      members: initialRequest.members.map(m => {
        if (m.id === assignedMemberId) {
          return { ...m, unavailableDays: ['sun'] };
        }
        return m;
      }),
    };

    // 3. Rebalance single day
    const rebalancedResult = rebalanceHousehold(updatedRequest, initialResult.assignments);

    // The unavailable member must NOT have any tasks on Sunday
    const unavAssignments = rebalancedResult.assignments.filter(a => a.memberId === assignedMemberId);
    assert.equal(unavAssignments.length, 0, 'Unavailable member cannot have tasks on Sunday');

    // The cooking task should be reassigned to the other member
    const newCooking = rebalancedResult.assignments.find(a => a.taskId === 't_cooking');
    assert.ok(newCooking);
    assert.equal(newCooking.memberId, otherMemberId, 'Cooking must be reassigned to available member');

    // Diff summary should explain the reassignment on SUN
    assert.ok(rebalancedResult.diffSummary && rebalancedResult.diffSummary.length > 0, 'Diff summary must be present');
    assert.ok(
      rebalancedResult.diffSummary.some(s => s.includes('reassigned') && s.includes('SUN')),
      `Diff summary must record reassignment on SUN: ${JSON.stringify(rebalancedResult.diffSummary)}`
    );
  });

  it('8. Infeasible chores on selected day produce clear unassigned diagnostic feedback', () => {
    const impossibleRequest: OptimizationRequest = {
      household: {
        id: 'h_imp',
        name: 'Infeasible Test',
        type: 'couple',
        mode: 'capacity_aware',
        planningHorizonWeeks: 1,
        planningMode: 'single_day',
        targetDate: thursdayDate,
        targetDayOfWeek: 'thu',
      },
      members: [
        // Both members are unavailable on Thursday
        { id: 'm1', name: 'Alex', role: 'Adult', weeklyCapacityMinutes: 240, unavailableDays: ['thu'] },
        { id: 'm2', name: 'Sam', role: 'Adult', weeklyCapacityMinutes: 240, unavailableDays: ['thu'] },
      ],
      tasks: [
        {
          id: 't_fixed_thu',
          name: 'Special Thursday Project',
          category: 'Deep Clean',
          frequencyPerWeek: 1,
          durationMinutes: 60,
          effortLevel: 4,
          fixedDays: ['thu'],
          eligibleMemberIds: ['m1', 'm2'],
        },
      ],
    };

    const result = runOptimization(impossibleRequest);
    assert.equal(result.assignments.length, 0, 'Cannot assign chore when all eligible members are unavailable');
    assert.ok(result.unassignedTasks.length > 0, 'Must record unassigned task');
    assert.equal(result.unassignedTasks[0].taskId, 't_fixed_thu');
    assert.equal(result.unassignedTasks[0].diagnosticCode, 'ERR_ALL_ELIGIBLE_UNAVAILABLE');
    assert.ok(result.unassignedTasks[0].remediation.length > 0, 'Must provide remediation advice');
  });

  it('9. Local draft persistence preserves single_day planning mode and target date', () => {
    // Clear storage mockup
    const fakeStore: Record<string, string> = {};
    const mockStorage = {
      getItem: (k: string) => fakeStore[k] || null,
      setItem: (k: string, v: string) => { fakeStore[k] = v; },
      removeItem: (k: string) => { delete fakeStore[k]; },
      clear: () => { Object.keys(fakeStore).forEach(k => delete fakeStore[k]); },
      length: 0,
      key: () => null,
    };
    (globalThis as any).localStorage = mockStorage;

    const req: OptimizationRequest = {
      ...coupleHouseholdFixture,
      household: {
        ...coupleHouseholdFixture.household,
        planningMode: 'single_day',
        targetDate: '2026-10-25',
        targetDayOfWeek: 'sun',
      },
    };

    const saved = saveLocalDraft(req, null);
    assert.ok(saved);

    const loaded = loadLocalDraft();
    assert.ok(loaded);
    assert.equal(loaded?.request.household.planningMode, 'single_day');
    assert.equal(loaded?.request.household.targetDate, '2026-10-25');
    assert.equal(loaded?.request.household.targetDayOfWeek, 'sun');
  });

  it('10. Free vs Pro planning horizon restrictions are enforced for single-day dates', () => {
    const freeEntitlement = getPlanningEntitlement(null); // Anonymous / Free
    assert.equal(freeEntitlement.maxPlanningWeeks, 1);

    const proEntitlement = getPlanningEntitlement({ plan_tier: 'pro', subscription_status: 'active' });
    assert.equal(proEntitlement.maxPlanningWeeks, 4);

    const todayStr = getLocalISODate();
    const allowedFreeMaxDays = 1 * 7 - 1; // 6 days ahead
    const allowedProMaxDays = 4 * 7 - 1; // 27 days ahead

    const freeMaxDate = addDaysToDate(todayStr, allowedFreeMaxDays);
    const proMaxDate = addDaysToDate(todayStr, allowedProMaxDays);

    assert.ok(freeMaxDate < proMaxDate, 'Pro planning date limit must extend further than Free limit');
  });

  it('11. Standard multi-week planning behavior remains completely intact', () => {
    const multiWeekReq: OptimizationRequest = {
      ...familyHouseholdFixture,
      household: {
        ...familyHouseholdFixture.household,
        planningHorizonWeeks: 4,
        planningMode: 'multi_week',
      },
    };

    const proEntitlement = getPlanningEntitlement({ plan_tier: 'pro', subscription_status: 'active' });
    const result = runOptimization(multiWeekReq, proEntitlement);

    assert.equal(result.weeks, 4, 'Multi-week planning must produce 4 weeks');
    assert.equal(result.planningMode, 'multi_week', 'Result must be multi_week');
    assert.ok(result.assignments.some(a => a.weekIndex === 0));
    assert.ok(result.assignments.some(a => a.weekIndex === 1));
    assert.ok(result.assignments.some(a => a.weekIndex === 2));
    assert.ok(result.assignments.some(a => a.weekIndex === 3));
  });
});
