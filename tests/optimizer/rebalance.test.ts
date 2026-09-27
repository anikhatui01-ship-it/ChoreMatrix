import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runOptimization } from '../../src/optimizer/engine.ts';
import { rebalanceHousehold } from '../../src/optimizer/rebalancer.ts';
import { coupleHouseholdFixture } from './fixtures.ts';
import type { OptimizationRequest } from '../../src/optimizer/types.ts';

describe('Phase 0 Rebalancing Engine', () => {
  it('TS-10: Minimal Disruption Rebalance preserves unaffected tasks and provides explanation diff', () => {
    // 1. Initial run
    const initialResult = runOptimization(coupleHouseholdFixture);
    assert.ok(initialResult.assignments.length > 0);

    // 2. Adjust constraint: Alex is now unavailable on Friday
    const updatedRequest: OptimizationRequest = {
      ...coupleHouseholdFixture,
      members: [
        { ...coupleHouseholdFixture.members[0], unavailableDays: ['fri'] },
        coupleHouseholdFixture.members[1],
      ],
    };

    // 3. Rebalance with previous assignments
    const rebalancedResult = rebalanceHousehold(updatedRequest, initialResult.assignments);

    // Alex should not have any tasks on Friday now
    const alexFriAssignments = rebalancedResult.assignments.filter(
      a => a.memberId === 'm_alex' && a.dayOfWeek === 'fri'
    );
    assert.equal(alexFriAssignments.length, 0, 'Alex cannot have Friday tasks after update');

    // Check that diffSummary is populated
    assert.ok(rebalancedResult.diffSummary !== undefined, 'Diff summary must exist');

    // Ensure unaffected tasks are largely preserved
    const prevMap = new Map(initialResult.assignments.map(a => [a.occurrenceId, a.memberId]));
    let preservedCount = 0;
    for (const a of rebalancedResult.assignments) {
      if (prevMap.get(a.occurrenceId) === a.memberId) {
        preservedCount++;
      }
    }

    const preservationRatio = preservedCount / rebalancedResult.assignments.length;
    assert.ok(
      preservationRatio >= 0.7,
      `At least 70% of assignments should be preserved on a single-day change, got ${Math.round(preservationRatio * 100)}%`
    );
  });
});
