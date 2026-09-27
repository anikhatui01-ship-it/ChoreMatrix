import type {
  TaskOccurrence,
  MemberInput,
  DayOfWeek,
  OptimizationMode,
} from './types.ts';
import { OPTIMIZER_WEIGHTS } from './weights.ts';

export interface HardConstraintCheck {
  valid: boolean;
  errorCode?: string;
}

export interface CandidateEvaluationContext {
  mode: OptimizationMode;
  targetHouseholdUtilization: number;
  targetAverageLoad: number;
  currentMemberWeightedLoad: number;
  currentMemberMinutes: number;
  memberCapacity: number;
  memberDailyMinutes: number;
  memberDailyCapacity: number;
  hasPriorWeekAssignment: boolean;
  isOffPreferredDay: boolean;
  violatesSpacing: boolean;
  previousAssignedMemberId?: string;
}

export function checkHardConstraints(
  occurrence: TaskOccurrence,
  member: MemberInput,
  day: DayOfWeek,
  currentMemberDayMinutes: number
): HardConstraintCheck {
  // 1. Eligibility
  if (!occurrence.eligibleMemberIds.includes(member.id)) {
    return { valid: false, errorCode: 'ERR_INELIGIBLE' };
  }

  // 2. Member unavailability on day
  if (member.unavailableDays && member.unavailableDays.includes(day)) {
    return { valid: false, errorCode: 'ERR_UNAVAILABLE_DAY' };
  }

  // 3. Fixed day match
  if (occurrence.fixedDay && occurrence.fixedDay !== day) {
    return { valid: false, errorCode: 'ERR_FIXED_DAY_MISMATCH' };
  }

  // 4. Absolute sanity limit (day cap cannot exceed 1440 min = 24h)
  if (currentMemberDayMinutes + occurrence.durationMinutes > 1440) {
    return { valid: false, errorCode: 'ERR_HARD_CAP_EXCEEDED' };
  }

  return { valid: true };
}

export function evaluateCandidateScore(
  occurrence: TaskOccurrence,
  member: MemberInput,
  day: DayOfWeek,
  ctx: CandidateEvaluationContext
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1. Workload balance / utilization
  const currentLoad = ctx.currentMemberWeightedLoad;
  const addedLoad = occurrence.weightedMinutes;
  const memberCap = Math.max(1, ctx.memberCapacity);

  if (ctx.mode === 'capacity_aware') {
    // Marginal increase in sum(Load_i^2 / Cap_i)
    // dCost = ( (L + W)^2 - L^2 ) / Cap
    const marginalCost = (2 * currentLoad * addedLoad + addedLoad * addedLoad) / memberCap;
    score += marginalCost * OPTIMIZER_WEIGHTS.WEIGHT_UTILIZATION * 5;

    const projectedUtil = (currentLoad + addedLoad) / memberCap;
    if (projectedUtil <= ctx.targetHouseholdUtilization * 1.1) {
      reasons.push('proportional_capacity_fit');
    }
  } else {
    // Equal workload mode: marginal increase in sum(Load_i^2)
    const marginalCost = (2 * currentLoad * addedLoad + addedLoad * addedLoad) / 100;
    score += marginalCost * OPTIMIZER_WEIGHTS.WEIGHT_UTILIZATION;

    const projectedLoad = currentLoad + addedLoad;
    if (projectedLoad <= ctx.targetAverageLoad * 1.1) {
      reasons.push('equal_workload_fit');
    }
  }


  // 2. Preferences (avoided / preferred)
  const isAvoided = member.avoidedTaskIds?.includes(occurrence.taskId);
  const isPreferred = member.preferredTaskIds?.includes(occurrence.taskId);

  if (isAvoided) {
    score += OPTIMIZER_WEIGHTS.PENALTY_AVOIDED_TASK * occurrence.effortLevel;
    reasons.push('avoided_task_tradeoff');
  } else if (isPreferred) {
    score -= OPTIMIZER_WEIGHTS.BONUS_PREFERRED_TASK * occurrence.effortLevel;
    reasons.push('preferred_task_match');
  }

  // 3. Day preference
  if (ctx.isOffPreferredDay) {
    score += OPTIMIZER_WEIGHTS.PENALTY_OFF_PREFERRED_DAY;
  } else if (occurrence.preferredDays && occurrence.preferredDays.includes(day)) {
    reasons.push('preferred_day_alignment');
  }

  // 4. Spacing violation
  if (ctx.violatesSpacing) {
    score += OPTIMIZER_WEIGHTS.PENALTY_SPACING_VIOLATION;
  }

  // 5. Daily spike penalty
  const projectedDayMinutes = ctx.memberDailyMinutes + occurrence.durationMinutes;
  if (ctx.memberDailyCapacity > 0 && projectedDayMinutes > ctx.memberDailyCapacity * 1.3) {
    score += OPTIMIZER_WEIGHTS.PENALTY_DAILY_SPIKE;
  }

  // 6. Multi-week rotation streak penalty
  if (ctx.hasPriorWeekAssignment) {
    score += OPTIMIZER_WEIGHTS.PENALTY_ROTATION_STREAK * occurrence.effortLevel;
  }

  // 7. Churn penalty during rebalance
  if (ctx.previousAssignedMemberId && ctx.previousAssignedMemberId !== member.id) {
    score += OPTIMIZER_WEIGHTS.PENALTY_CHURN;
  } else if (ctx.previousAssignedMemberId && ctx.previousAssignedMemberId === member.id) {
    reasons.push('preserved_from_previous_plan');
  }

  // Single candidate check
  if (occurrence.eligibleMemberIds.length === 1) {
    reasons.push('only_eligible_member');
  }

  return { score, reasons };
}
