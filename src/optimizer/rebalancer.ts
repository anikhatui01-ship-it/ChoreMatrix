import type {
  OptimizationRequest,
  OptimizationResult,
  AssignmentOutput,
} from './types.ts';
import { runOptimization } from './engine.ts';

export interface RebalanceDiff {
  changedAssignmentsCount: number;
  preservedAssignmentsCount: number;
  explanations: string[];
}

export function rebalanceHousehold(
  request: OptimizationRequest,
  previousAssignments: AssignmentOutput[]
): OptimizationResult {
  const requestWithPrevious: OptimizationRequest = {
    ...request,
    previousRunAssignments: previousAssignments,
  };

  const result = runOptimization(requestWithPrevious);
  const diff = computeAssignmentDiff(previousAssignments, result.assignments);

  result.diffSummary = diff.explanations;
  return result;
}

export function computeAssignmentDiff(
  previous: AssignmentOutput[],
  current: AssignmentOutput[]
): RebalanceDiff {
  const prevMap = new Map<string, AssignmentOutput>();
  for (const a of previous) {
    prevMap.set(a.occurrenceId, a);
  }

  const explanations: string[] = [];
  let changed = 0;
  let preserved = 0;

  for (const curr of current) {
    const prev = prevMap.get(curr.occurrenceId);
    if (!prev) {
      explanations.push(`New task occurrence "${curr.taskName}" assigned to ${curr.memberName} on ${curr.dayOfWeek.toUpperCase()}.`);
      continue;
    }

    if (prev.memberId !== curr.memberId || prev.dayOfWeek !== curr.dayOfWeek) {
      changed++;
      const reasonPart = curr.reasonCodes.length ? ` (reason: ${curr.reasonCodes.join(', ')})` : '';
      if (prev.memberId !== curr.memberId && prev.dayOfWeek !== curr.dayOfWeek) {
        explanations.push(`"${curr.taskName}" moved from ${prev.memberName} on ${prev.dayOfWeek.toUpperCase()} to ${curr.memberName} on ${curr.dayOfWeek.toUpperCase()}${reasonPart}.`);
      } else if (prev.memberId !== curr.memberId) {
        explanations.push(`"${curr.taskName}" reassigned from ${prev.memberName} to ${curr.memberName} on ${curr.dayOfWeek.toUpperCase()}${reasonPart}.`);
      } else {
        explanations.push(`"${curr.taskName}" rescheduled from ${prev.dayOfWeek.toUpperCase()} to ${curr.dayOfWeek.toUpperCase()} for ${curr.memberName}.`);
      }
    } else {
      preserved++;
    }
  }

  return {
    changedAssignmentsCount: changed,
    preservedAssignmentsCount: preserved,
    explanations,
  };
}
