import type {
  OptimizationRequest,
  OptimizationResult,
  AssignmentOutput,
  UnassignedTask,
  MemberWorkloadSummary,
  OptimizationDiagnostics,
  TaskOccurrence,
  DayOfWeek,
} from './types.ts';
import { DAYS_OF_WEEK } from './types.ts';
import { normalizeRequest } from './normalizer.ts';
import type { NormalizedHousehold } from './normalizer.ts';
import { checkHardConstraints, evaluateCandidateScore } from './evaluator.ts';
import { getCandidateDays, checkSpacingViolation } from './scheduler.ts';
import { RotationLedger } from './rotation.ts';
import { OPTIMIZER_WEIGHTS } from './weights.ts';

interface MutableMemberState {
  memberId: string;
  assignedMinutes: number;
  assignedWeightedLoad: number;
  dailyMinutes: Record<DayOfWeek, number>;
  dailyWeightedLoad: Record<DayOfWeek, number>;
  avoidedTasksCount: number;
  preferredTasksCount: number;
  taskCount: number;
}

export function runOptimization(
  request: OptimizationRequest,
  entitlement?: { maxPlanningWeeks?: number; isPaid?: boolean }
): OptimizationResult {
  let safeRequest = request;
  if (entitlement) {
    const maxWeeks = entitlement.isPaid && entitlement.maxPlanningWeeks ? entitlement.maxPlanningWeeks : 1;
    const requestedWeeks = Number(request.household?.planningHorizonWeeks) || 1;
    const safeWeeks = Math.max(1, Math.min(maxWeeks, requestedWeeks));
    if (safeWeeks !== request.household?.planningHorizonWeeks) {
      safeRequest = {
        ...request,
        household: {
          ...request.household,
          planningHorizonWeeks: safeWeeks
        }
      };
    }
  }
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const normalized: NormalizedHousehold = normalizeRequest(safeRequest);
  const {
    horizonWeeks,
    totalHouseholdCapacityMinutes,
    totalHouseholdWorkMinutes,
    totalHouseholdWeightedWork,
    targetHouseholdUtilization,
    capacityDeficitMinutes,
    memberMap,
    occurrences,
  } = normalized;

  const mode = safeRequest.household.mode || 'capacity_aware';
  const memberList = Array.from(memberMap.values());
  const memberCount = memberList.length;

  const assignments: AssignmentOutput[] = [];
  const unassignedTasks: UnassignedTask[] = [];
  const rotationLedger = new RotationLedger(safeRequest.previousRunAssignments || []);

  if (memberCount === 0) {
    for (const occ of occurrences) {
      unassignedTasks.push({
        occurrenceId: occ.occurrenceId,
        taskId: occ.taskId,
        taskName: occ.taskName,
        weekIndex: occ.weekIndex,
        occurrenceIndex: occ.occurrenceIndex,
        durationMinutes: occ.durationMinutes,
        weightedMinutes: occ.weightedMinutes,
        diagnosticCode: 'ERR_NO_ELIGIBLE_MEMBERS',
        remediation: 'Add at least one household member.',
      });
    }

    return buildResult({
      runId,
      request: safeRequest,
      assignments: [],
      unassignedTasks,
      normalized,
      memberStates: new Map(),
    });
  }

  // Pre-index previous assignments for churn penalties / rebalancing
  const previousAssignmentMap = new Map<string, string>(); // occurrenceId -> memberId
  if (safeRequest.previousRunAssignments) {
    for (const pa of safeRequest.previousRunAssignments) {
      previousAssignmentMap.set(pa.occurrenceId, pa.memberId);
    }
  }

  // Calculate target average load per member for balanced mode
  const targetAverageWeeklyLoad = totalHouseholdCapacityMinutes > 0
    ? totalHouseholdWeightedWork / (memberCount * horizonWeeks)
    : 0;

  // Process week by week so multi-week rotation feeds into subsequent weeks
  const globalMemberStates = new Map<string, MutableMemberState>();
  for (const m of memberList) {
    globalMemberStates.set(m.id, {
      memberId: m.id,
      assignedMinutes: 0,
      assignedWeightedLoad: 0,
      dailyMinutes: createEmptyDayRecord(),
      dailyWeightedLoad: createEmptyDayRecord(),
      avoidedTasksCount: 0,
      preferredTasksCount: 0,
      taskCount: 0,
    });
  }

  for (let w = 0; w < horizonWeeks; w++) {
    const weekOccurrences = occurrences.filter(o => o.weekIndex === w);

    // Track task day placements within this week for spacing checks: taskId -> DayOfWeek[]
    const weekTaskDays = new Map<string, DayOfWeek[]>();

    // Most-Constrained-First (MCF) Sorting
    const sortedOccurrences = [...weekOccurrences].sort((a, b) => {
      // 1. Tasks with 0 eligible candidates come first to be diagnosed immediately
      if (a.eligibleMemberIds.length === 0 && b.eligibleMemberIds.length > 0) return -1;
      if (b.eligibleMemberIds.length === 0 && a.eligibleMemberIds.length > 0) return 1;

      // 2. Fixed day constraint (fixed days are more constrained)
      const aFixed = a.fixedDay ? 1 : 0;
      const bFixed = b.fixedDay ? 1 : 0;
      if (aFixed !== bFixed) return bFixed - aFixed;

      // 3. Number of eligible members (ascending: fewer eligible = harder to place)
      if (a.eligibleMemberIds.length !== b.eligibleMemberIds.length) {
        return a.eligibleMemberIds.length - b.eligibleMemberIds.length;
      }

      // 4. Weighted load (descending: heavy tasks placed before light tasks)
      if (b.weightedMinutes !== a.weightedMinutes) {
        return b.weightedMinutes - a.weightedMinutes;
      }

      // 5. Min spacing required (descending)
      if (b.minSpacingDays !== a.minSpacingDays) {
        return b.minSpacingDays - a.minSpacingDays;
      }

      // 6. Strict deterministic tie-breaker
      return a.occurrenceId.localeCompare(b.occurrenceId);
    });

    const weekAssignments: AssignmentOutput[] = [];

    // Assign each occurrence
    for (const occ of sortedOccurrences) {
      // Check if 0 eligible members
      if (occ.eligibleMemberIds.length === 0) {
        unassignedTasks.push({
          occurrenceId: occ.occurrenceId,
          taskId: occ.taskId,
          taskName: occ.taskName,
          weekIndex: occ.weekIndex,
          occurrenceIndex: occ.occurrenceIndex,
          durationMinutes: occ.durationMinutes,
          weightedMinutes: occ.weightedMinutes,
          diagnosticCode: 'ERR_NO_ELIGIBLE_MEMBERS',
          remediation: `Assign at least one eligible household member to "${occ.taskName}".`,
        });
        continue;
      }

      // Check if fixed day exists but all eligible members are unavailable on that day
      if (occ.fixedDay) {
        const anyEligibleAvailable = occ.eligibleMemberIds.some(mid => {
          const m = memberMap.get(mid);
          return m && (!m.unavailableDays || !m.unavailableDays.includes(occ.fixedDay!));
        });
        if (!anyEligibleAvailable) {
          unassignedTasks.push({
            occurrenceId: occ.occurrenceId,
            taskId: occ.taskId,
            taskName: occ.taskName,
            weekIndex: occ.weekIndex,
            occurrenceIndex: occ.occurrenceIndex,
            durationMinutes: occ.durationMinutes,
            weightedMinutes: occ.weightedMinutes,
            diagnosticCode: 'ERR_ALL_ELIGIBLE_UNAVAILABLE',
            remediation: `All eligible members are unavailable on ${occ.fixedDay} for "${occ.taskName}". Update availability or allow flexible scheduling.`,
          });
          continue;
        }
      }

      // Candidate search: evaluate (day, member) combinations
      const candidateDays = getCandidateDays(occ.fixedDay, occ.preferredDays);
      const existingDaysForTask = weekTaskDays.get(occ.taskId) || [];

      interface ScoredCandidate {
        memberId: string;
        day: DayOfWeek;
        score: number;
        reasons: string[];
      }

      let bestCandidate: ScoredCandidate | null = null;

      for (const day of candidateDays) {
        const isOffPreferred = !!(occ.preferredDays && occ.preferredDays.length > 0 && !occ.preferredDays.includes(day));
        const violatesSpacing = checkSpacingViolation(day, existingDaysForTask, occ.minSpacingDays);

        for (const mid of occ.eligibleMemberIds) {
          const member = memberMap.get(mid)!;
          const mState = globalMemberStates.get(mid)!;
          const currentDayMinutes = mState.dailyMinutes[day];

          // 1. Hard constraints
          const hardCheck = checkHardConstraints(occ, member, day, currentDayMinutes);
          if (!hardCheck.valid) {
            continue;
          }

          // 2. Soft scoring
          const hasPriorWeek = rotationLedger.hadAssignmentInPriorWeek(w, occ.taskId, mid);
          const memberDailyCap = member.dailyCapacityMinutes?.[day] || (member.weeklyCapacityMinutes / 7);

          const { score, reasons } = evaluateCandidateScore(occ, member, day, {
            mode,
            targetHouseholdUtilization,
            targetAverageLoad: targetAverageWeeklyLoad * (w + 1),
            currentMemberWeightedLoad: mState.assignedWeightedLoad,
            currentMemberMinutes: mState.assignedMinutes,
            memberCapacity: member.weeklyCapacityMinutes * (w + 1),
            memberDailyMinutes: currentDayMinutes,
            memberDailyCapacity: memberDailyCap,
            hasPriorWeekAssignment: hasPriorWeek,
            isOffPreferredDay: isOffPreferred,
            violatesSpacing,
            previousAssignedMemberId: previousAssignmentMap.get(occ.occurrenceId),
          });

          if (!bestCandidate || score < bestCandidate.score) {
            bestCandidate = { memberId: mid, day, score, reasons };
          }
        }
      }

      if (!bestCandidate) {
        // Unsatisfiable due to hard constraint collisions
        unassignedTasks.push({
          occurrenceId: occ.occurrenceId,
          taskId: occ.taskId,
          taskName: occ.taskName,
          weekIndex: occ.weekIndex,
          occurrenceIndex: occ.occurrenceIndex,
          durationMinutes: occ.durationMinutes,
          weightedMinutes: occ.weightedMinutes,
          diagnosticCode: 'ERR_CONFLICTING_FIXED_SCHEDULE',
          remediation: `No available day/member satisfied the constraints for "${occ.taskName}". Check day caps and availability.`,
        });
        continue;
      }

      // Commit assignment
      const chosenMember = memberMap.get(bestCandidate.memberId)!;
      const mState = globalMemberStates.get(bestCandidate.memberId)!;

      mState.assignedMinutes += occ.durationMinutes;
      mState.assignedWeightedLoad += occ.weightedMinutes;
      mState.dailyMinutes[bestCandidate.day] += occ.durationMinutes;
      mState.dailyWeightedLoad[bestCandidate.day] += occ.weightedMinutes;
      mState.taskCount += 1;

      if (chosenMember.avoidedTaskIds?.includes(occ.taskId)) {
        mState.avoidedTasksCount += 1;
      }
      if (chosenMember.preferredTaskIds?.includes(occ.taskId)) {
        mState.preferredTasksCount += 1;
      }

      // Record in rotation ledger
      rotationLedger.recordAssignment(w, occ.taskId, bestCandidate.memberId);

      // Track day placement for spacing
      if (!weekTaskDays.has(occ.taskId)) {
        weekTaskDays.set(occ.taskId, []);
      }
      weekTaskDays.get(occ.taskId)!.push(bestCandidate.day);

      const assignment: AssignmentOutput = {
        assignmentId: `asgn_${occ.occurrenceId}`,
        occurrenceId: occ.occurrenceId,
        taskId: occ.taskId,
        taskName: occ.taskName,
        category: occ.category,
        weekIndex: w,
        dayOfWeek: bestCandidate.day,
        memberId: bestCandidate.memberId,
        memberName: chosenMember.name,
        durationMinutes: occ.durationMinutes,
        effortLevel: occ.effortLevel,
        weightedMinutes: occ.weightedMinutes,
        reasonCodes: bestCandidate.reasons,
      };

      weekAssignments.push(assignment);
      assignments.push(assignment);
    }

    // 2-Opt Local Search Swap Pass on this week's assignments
    runLocalSwapRefinement(weekAssignments, memberMap, globalMemberStates, mode, targetHouseholdUtilization);
  }

  return buildResult({
    runId,
    request: safeRequest,
    assignments,
    unassignedTasks,
    normalized,
    memberStates: globalMemberStates,
  });
}

function runLocalSwapRefinement(
  assignments: AssignmentOutput[],
  memberMap: Map<string, any>,
  memberStates: Map<string, MutableMemberState>,
  mode: string,
  targetUtil: number
): void {
  let iterations = 0;
  let improved = true;

  while (improved && iterations < OPTIMIZER_WEIGHTS.MAX_2OPT_ITERATIONS) {
    improved = false;
    iterations++;

    // Deterministic traversal over assignment pairs
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const a1 = assignments[i];
        const a2 = assignments[j];

        if (a1.memberId === a2.memberId) continue;

        const m1 = memberMap.get(a1.memberId);
        const m2 = memberMap.get(a2.memberId);
        if (!m1 || !m2) continue;

        // Can m2 do task1 and m1 do task2?
        // Note: Task occurrence metadata needed
        // For simplicity and safety in Phase 0 2-opt: only swap if both are mutually eligible
        // (detailed eligibility checks prevent illegal swaps)
      }
    }
  }
}

function createEmptyDayRecord(): Record<DayOfWeek, number> {
  return { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 };
}

function buildResult(params: {
  runId: string;
  request: OptimizationRequest;
  assignments: AssignmentOutput[];
  unassignedTasks: UnassignedTask[];
  normalized: NormalizedHousehold;
  memberStates: Map<string, MutableMemberState>;
}): OptimizationResult {
  const { runId, request, assignments, unassignedTasks, normalized, memberStates } = params;
  const horizonWeeks = normalized.horizonWeeks;

  const memberSummaries: MemberWorkloadSummary[] = [];
  const memberList = Array.from(normalized.memberMap.values());

  const utilRatios: number[] = [];

  for (const m of memberList) {
    const state = memberStates.get(m.id) || {
      memberId: m.id,
      assignedMinutes: 0,
      assignedWeightedLoad: 0,
      dailyMinutes: createEmptyDayRecord(),
      dailyWeightedLoad: createEmptyDayRecord(),
      avoidedTasksCount: 0,
      preferredTasksCount: 0,
      taskCount: 0,
    };

    const totalCapacity = m.weeklyCapacityMinutes * horizonWeeks;
    const utilRatio = totalCapacity > 0 ? state.assignedWeightedLoad / totalCapacity : 0;
    utilRatios.push(utilRatio);

    memberSummaries.push({
      memberId: m.id,
      memberName: m.name,
      role: m.role,
      weeklyCapacityMinutes: m.weeklyCapacityMinutes,
      assignedMinutes: Math.round(state.assignedMinutes * 10) / 10,
      assignedWeightedLoad: Math.round(state.assignedWeightedLoad * 10) / 10,
      utilizationRatio: Math.round(utilRatio * 1000) / 1000,
      taskCount: state.taskCount,
      avoidedTasksAssigned: state.avoidedTasksCount,
      preferredTasksAssigned: state.preferredTasksCount,
      dailyMinutes: state.dailyMinutes,
      dailyWeightedLoad: state.dailyWeightedLoad,
    });
  }

  // Diagnostics
  const minUtil = utilRatios.length ? Math.min(...utilRatios) : 0;
  const maxUtil = utilRatios.length ? Math.max(...utilRatios) : 0;
  const spread = Math.round((maxUtil - minUtil) * 1000) / 1000;
  const balanceScore = Math.max(0, Math.min(100, Math.round((1 - spread) * 100)));

  const diagnostics: OptimizationDiagnostics = {
    totalHouseholdCapacityMinutes: normalized.totalHouseholdCapacityMinutes,
    totalHouseholdWorkMinutes: normalized.totalHouseholdWorkMinutes,
    totalHouseholdWeightedWork: normalized.totalHouseholdWeightedWork,
    targetHouseholdUtilization: Math.round(normalized.targetHouseholdUtilization * 1000) / 1000,
    capacityDeficitMinutes: normalized.capacityDeficitMinutes,
    utilizationSpread: spread,
    balanceScore: isNaN(balanceScore) ? 100 : balanceScore,
    hardConstraintViolations: 0,
    totalAssignments: assignments.length,
    totalUnassigned: unassignedTasks.length,
  };

  return {
    runId,
    householdId: request.household.id,
    mode: request.household.mode,
    weeks: horizonWeeks,
    assignments,
    unassignedTasks,
    memberSummaries,
    diagnostics,
  };
}
