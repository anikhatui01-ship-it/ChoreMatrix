import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOptimization } from '../../src/optimizer/engine.ts';
import { coupleHouseholdFixture, familyHouseholdFixture } from './fixtures.ts';
import type { OptimizationRequest } from '../../src/optimizer/types.ts';

describe('Phase 0 Deterministic Optimizer Engine', () => {
  it('TS-01: Equal Capacity Couple balances workload evenly', () => {
    const result = runOptimization(coupleHouseholdFixture);

    assert.equal(result.unassignedTasks.length, 0, 'No unassigned tasks');
    assert.equal(result.diagnostics.hardConstraintViolations, 0);

    const alexSummary = result.memberSummaries.find(m => m.memberId === 'm_alex')!;
    const samSummary = result.memberSummaries.find(m => m.memberId === 'm_sam')!;

    assert.ok(alexSummary, 'Alex summary exists');
    assert.ok(samSummary, 'Sam summary exists');

    // Both should receive assignments within 35 minutes of each other
    const diff = Math.abs(alexSummary.assignedMinutes - samSummary.assignedMinutes);
    assert.ok(diff <= 35, `Load difference (${diff}m) should be <= 35m for equal capacity`);
    assert.ok(result.diagnostics.balanceScore >= 85, `Balance score should be >= 85, was ${result.diagnostics.balanceScore}`);
  });

  it('TS-02: Unequal Family balances workload proportionally to capacity', () => {
    const result = runOptimization(familyHouseholdFixture);

    const maya = result.memberSummaries.find(m => m.memberId === 'm_maya')!;
    const arjun = result.memberSummaries.find(m => m.memberId === 'm_arjun')!;
    const riya = result.memberSummaries.find(m => m.memberId === 'm_riya')!;
    const kabir = result.memberSummaries.find(m => m.memberId === 'm_kabir')!;

    // Assigned minutes order should match capacity hierarchy
    assert.ok(maya.assignedMinutes >= arjun.assignedMinutes, 'Maya (300m) should have >= Arjun (240m)');
    assert.ok(arjun.assignedMinutes > riya.assignedMinutes, 'Arjun (240m) should have > Riya (120m)');
    assert.ok(riya.assignedMinutes >= kabir.assignedMinutes, 'Riya (120m) should have >= Kabir (60m)');
  });

  it('TS-03: Strict Ineligibility guarantees ineligible members never receive restricted tasks', () => {
    const result = runOptimization(familyHouseholdFixture);

    for (const a of result.assignments) {
      if (a.memberId === 'm_kabir') {
        assert.equal(a.taskId, 't_trash', 'Kabir must only receive tasks he is eligible for (trash)');
      }
      if (a.taskId === 't_bath') {
        assert.ok(
          a.memberId === 'm_maya' || a.memberId === 'm_arjun',
          'Bathroom clean must only be assigned to Maya or Arjun'
        );
      }
    }
  });

  it('TS-04: Unavailable Day prevents assignments on travel/absent days', () => {
    const requestWithAbsence: OptimizationRequest = {
      ...coupleHouseholdFixture,
      members: [
        { ...coupleHouseholdFixture.members[0], unavailableDays: ['tue', 'wed'] },
        coupleHouseholdFixture.members[1],
      ],
    };

    const result = runOptimization(requestWithAbsence);
    const alexAssignments = result.assignments.filter(a => a.memberId === 'm_alex');

    for (const a of alexAssignments) {
      assert.notEqual(a.dayOfWeek, 'tue', 'Alex cannot be assigned on Tuesday');
      assert.notEqual(a.dayOfWeek, 'wed', 'Alex cannot be assigned on Wednesday');
    }
  });

  it('TS-05: Effort Weight Differentiation scales weighted workload properly', () => {
    const request: OptimizationRequest = {
      household: {
        id: 'h_test',
        name: 'Effort Test',
        type: 'couple',
        mode: 'capacity_aware',
        planningHorizonWeeks: 1,
      },
      members: [
        { id: 'm1', name: 'Person 1', role: 'Adult', weeklyCapacityMinutes: 200 },
        { id: 'm2', name: 'Person 2', role: 'Adult', weeklyCapacityMinutes: 200 },
      ],
      tasks: [
        { id: 't_light', name: 'Light Fold', category: 'General', frequencyPerWeek: 1, durationMinutes: 60, effortLevel: 1, eligibleMemberIds: ['m1', 'm2'] },
        { id: 't_heavy', name: 'Heavy Scrub', category: 'General', frequencyPerWeek: 1, durationMinutes: 60, effortLevel: 5, eligibleMemberIds: ['m1', 'm2'] },
      ],
    };

    const result = runOptimization(request);
    const light = result.assignments.find(a => a.taskId === 't_light')!;
    const heavy = result.assignments.find(a => a.taskId === 't_heavy')!;

    assert.equal(light.weightedMinutes, 60, 'Level 1 effort: 60 * 1.0 = 60');
    assert.equal(heavy.weightedMinutes, 135, 'Level 5 effort: 60 * 2.25 = 135');
  });

  it('TS-06: Aversion & Preference favors preferred member and avoids penalized member', () => {
    const request: OptimizationRequest = {
      ...coupleHouseholdFixture,
      members: [
        { ...coupleHouseholdFixture.members[0], avoidedTaskIds: ['t_dishes'] },
        { ...coupleHouseholdFixture.members[1], preferredTaskIds: ['t_dishes'] },
      ],
    };

    const result = runOptimization(request);
    const dishAssignments = result.assignments.filter(a => a.taskId === 't_dishes');

    const samDishCount = dishAssignments.filter(a => a.memberId === 'm_sam').length;
    const alexDishCount = dishAssignments.filter(a => a.memberId === 'm_alex').length;

    assert.ok(samDishCount > alexDishCount, `Sam (prefers) should get more dishes than Alex (avoids). Sam: ${samDishCount}, Alex: ${alexDishCount}`);
  });

  it('TS-07: Multi-Week Rotation rotates recurring heavy tasks across 4 weeks', () => {
    const multiWeekRequest: OptimizationRequest = {
      ...coupleHouseholdFixture,
      household: {
        ...coupleHouseholdFixture.household,
        planningHorizonWeeks: 4,
      },
    };

    const result = runOptimization(multiWeekRequest);
    const bathAssignments = result.assignments.filter(a => a.taskId === 't_bath');

    assert.equal(bathAssignments.length, 4, '4 weekly bathroom clean occurrences');

    const alexCount = bathAssignments.filter(a => a.memberId === 'm_alex').length;
    const samCount = bathAssignments.filter(a => a.memberId === 'm_sam').length;

    assert.ok(alexCount > 0, 'Alex must receive at least 1 bathroom cleaning');
    assert.ok(samCount > 0, 'Sam must receive at least 1 bathroom cleaning');
    assert.equal(alexCount + samCount, 4);
  });

  it('TS-08: System Overload Flagging flags capacity deficit without crashing', () => {
    const overloadedRequest: OptimizationRequest = {
      ...coupleHouseholdFixture,
      members: [
        { id: 'm_alex', name: 'Alex', role: 'Adult', weeklyCapacityMinutes: 60 },
        { id: 'm_sam', name: 'Sam', role: 'Adult', weeklyCapacityMinutes: 60 },
      ],
    };

    const result = runOptimization(overloadedRequest);

    assert.ok(result.diagnostics.capacityDeficitMinutes > 0, 'Deficit must be detected');
    assert.ok(result.diagnostics.targetHouseholdUtilization > 1.0, 'Utilization must exceed 1.0');
    assert.equal(result.diagnostics.hardConstraintViolations, 0);
  });

  it('TS-09: Zero Eligible Members registers explicit unassigned diagnostic', () => {
    const impossibleRequest: OptimizationRequest = {
      ...coupleHouseholdFixture,
      tasks: [
        ...coupleHouseholdFixture.tasks,
        { id: 't_impossible', name: 'Orphan chore', category: 'Other', frequencyPerWeek: 1, durationMinutes: 30, effortLevel: 2, eligibleMemberIds: [] },
      ],
    };

    const result = runOptimization(impossibleRequest);
    const unassigned = result.unassignedTasks.find(u => u.taskId === 't_impossible');

    assert.ok(unassigned, 'Impossible chore must appear in unassignedTasks');
    assert.equal(unassigned?.diagnosticCode, 'ERR_NO_ELIGIBLE_MEMBERS');
  });

  it('TS-11: Deterministic Invariance produces exact same assignments across 100 runs', () => {
    const firstRun = JSON.stringify(runOptimization(familyHouseholdFixture).assignments);

    for (let i = 0; i < 100; i++) {
      const subsequentRun = JSON.stringify(runOptimization(familyHouseholdFixture).assignments);
      assert.equal(subsequentRun, firstRun, `Run ${i + 1} did not match baseline`);
    }
  });
});
