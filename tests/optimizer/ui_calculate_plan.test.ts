import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOptimization } from '../../src/optimizer/engine.ts';
import { coupleHouseholdFixture } from './fixtures.ts';
import type { OptimizationRequest } from '../../src/optimizer/types.ts';

describe('UI Interaction & Calculate Plan Regression Tests', () => {
  it('Regression Test 1: Calculate Plan reflects manual capacity and unavailable day edits', () => {
    // 1. Initial preset state
    const request: OptimizationRequest = JSON.parse(JSON.stringify(coupleHouseholdFixture));
    const initialResult = runOptimization(request);
    const initialAlex = initialResult.memberSummaries.find(m => m.memberId === 'm_alex')!;
    const initialSam = initialResult.memberSummaries.find(m => m.memberId === 'm_sam')!;

    assert.ok(
      Math.abs(initialAlex.assignedMinutes - initialSam.assignedMinutes) <= 30,
      'Alex and Sam must be close in initial baseline'
    );

    // 2. User edits input: Alex capacity increased to 360, Sam set unavailable on Monday
    request.members[0].weeklyCapacityMinutes = 360;
    request.members[1].unavailableDays = ['mon'];

    // 3. User clicks "Calculate Plan" -> triggers recalculation with new state
    const recalculated = runOptimization(request);
    const updatedAlex = recalculated.memberSummaries.find(m => m.memberId === 'm_alex')!;
    const updatedSam = recalculated.memberSummaries.find(m => m.memberId === 'm_sam')!;

    // Assert results updated immediately according to manual edits
    assert.ok(
      updatedAlex.assignedMinutes > updatedSam.assignedMinutes,
      'Alex (360m) must receive more work than Sam (240m) after recalculation'
    );

    const samMonTasks = recalculated.assignments.filter(
      a => a.memberId === 'm_sam' && a.dayOfWeek === 'mon'
    );
    assert.equal(samMonTasks.length, 0, 'Sam must receive 0 Monday tasks after manual availability edit');
  });

  it('Regression Test 2: Calculate Plan reflects task duration and effort level edits', () => {
    const request: OptimizationRequest = JSON.parse(JSON.stringify(coupleHouseholdFixture));
    const initialResult = runOptimization(request);
    const initialTotalWork = initialResult.diagnostics.totalHouseholdWorkMinutes;

    // User edits task duration of cooking from 30m to 60m and effort to 5
    const cookTask = request.tasks.find(t => t.id === 't_cooking')!;
    cookTask.durationMinutes = 60;
    cookTask.effortLevel = 5;

    // User clicks "Calculate Plan"
    const recalculated = runOptimization(request);

    // Total work minutes should increase by 7 * (60 - 30) = 210 minutes
    const expectedDiff = 7 * 30;
    assert.equal(
      recalculated.diagnostics.totalHouseholdWorkMinutes,
      initialTotalWork + expectedDiff,
      'Total household work minutes must refresh immediately upon Calculate Plan'
    );
  });

  it('Regression Test 3: Repeated Calculate Plan clicks produce deterministic identical outputs', () => {
    const request: OptimizationRequest = JSON.parse(JSON.stringify(coupleHouseholdFixture));

    const firstClickResult = JSON.stringify(runOptimization(request).assignments);
    const secondClickResult = JSON.stringify(runOptimization(request).assignments);
    const thirdClickResult = JSON.stringify(runOptimization(request).assignments);

    assert.equal(secondClickResult, firstClickResult, 'Second click must be identical to first click');
    assert.equal(thirdClickResult, firstClickResult, 'Third click must be identical to first click');
  });
});
