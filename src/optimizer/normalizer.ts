import type {
  OptimizationRequest,
  TaskOccurrence,
  MemberInput,
  TaskInput,
  DayOfWeek,
} from './types.ts';
import { DAYS_OF_WEEK } from './types.ts';

import { calculateWeightedMinutes, getEffortMultiplier } from './weights.ts';

export interface NormalizedHousehold {
  horizonWeeks: number;
  totalHouseholdCapacityMinutes: number;
  totalHouseholdWorkMinutes: number;
  totalHouseholdWeightedWork: number;
  targetHouseholdUtilization: number;
  capacityDeficitMinutes: number;
  memberMap: Map<string, MemberInput>;
  taskMap: Map<string, TaskInput>;
  occurrences: TaskOccurrence[];
}

export function normalizeRequest(request: OptimizationRequest): NormalizedHousehold {
  const horizonWeeks = Math.max(1, Math.min(4, request.household.planningHorizonWeeks || 1));
  const memberMap = new Map<string, MemberInput>();
  
  // Normalize members
  for (const m of request.members) {
    const safeCapacity = Math.max(1, Number(m.weeklyCapacityMinutes) || 1);
    const unavailable = new Set(m.unavailableDays || []);
    // Ensure dailyCapacityMinutes is defined for all days
    const defaultDaily = Math.round((safeCapacity / 7) * 10) / 10;
    const dailyCap: Record<DayOfWeek, number> = {} as Record<DayOfWeek, number>;
    for (const d of DAYS_OF_WEEK) {
      if (unavailable.has(d)) {
        dailyCap[d] = 0;
      } else if (m.dailyCapacityMinutes && m.dailyCapacityMinutes[d] !== undefined) {
        dailyCap[d] = Math.max(0, m.dailyCapacityMinutes[d]!);
      } else {
        dailyCap[d] = defaultDaily;
      }
    }

    memberMap.set(m.id, {
      ...m,
      weeklyCapacityMinutes: safeCapacity,
      dailyCapacityMinutes: dailyCap,
      unavailableDays: Array.from(unavailable),
      preferredTaskIds: m.preferredTaskIds || [],
      avoidedTaskIds: m.avoidedTaskIds || [],
    });
  }

  const validMemberIds = new Set(memberMap.keys());
  const taskMap = new Map<string, TaskInput>();
  const occurrences: TaskOccurrence[] = [];

  let totalHouseholdWorkMinutes = 0;
  let totalHouseholdWeightedWork = 0;

  for (const t of request.tasks) {
    taskMap.set(t.id, t);
    const freq = Math.max(1, Math.min(14, Number(t.frequencyPerWeek) || 1));
    const duration = Math.max(1, Number(t.durationMinutes) || 1);
    const effortLevel = (Math.max(1, Math.min(5, Number(t.effortLevel) || 1))) as 1 | 2 | 3 | 4 | 5;
    const effortMultiplier = getEffortMultiplier(effortLevel);
    const weightedMinutes = calculateWeightedMinutes(duration, effortLevel);

    // Filter eligible members against exclusions and existing members
    const exclusions = new Set(t.excludedMemberIds || []);
    let eligible = (t.eligibleMemberIds || []).filter(
      id => validMemberIds.has(id) && !exclusions.has(id)
    );

    // If eligible is completely empty, keep it empty so the optimizer can register an explicit diagnostic
    const minSpacing = t.minSpacingDays !== undefined ? t.minSpacingDays : (freq > 1 ? Math.max(1, Math.floor(7 / freq)) : 0);

    for (let w = 0; w < horizonWeeks; w++) {
      for (let o = 0; o < freq; o++) {
        totalHouseholdWorkMinutes += duration;
        totalHouseholdWeightedWork += weightedMinutes;

        let fixedDay: DayOfWeek | undefined = undefined;
        if (t.fixedDays && t.fixedDays.length > 0) {
          fixedDay = t.fixedDays[o % t.fixedDays.length];
        }

        occurrences.push({
          occurrenceId: `${t.id}_w${w}_o${o}`,
          taskId: t.id,
          taskName: t.name,
          category: t.category,
          weekIndex: w,
          occurrenceIndex: o,
          durationMinutes: duration,
          effortLevel,
          effortMultiplier,
          weightedMinutes,
          eligibleMemberIds: eligible,
          fixedDay,
          preferredDays: t.preferredDays,
          minSpacingDays: minSpacing,
        });
      }
    }
  }

  let totalWeeklyCapacity = 0;
  for (const m of memberMap.values()) {
    totalWeeklyCapacity += m.weeklyCapacityMinutes;
  }
  const totalHouseholdCapacityMinutes = totalWeeklyCapacity * horizonWeeks;
  const targetHouseholdUtilization = totalHouseholdCapacityMinutes > 0
    ? totalHouseholdWeightedWork / totalHouseholdCapacityMinutes
    : 1.0;
  const capacityDeficitMinutes = Math.max(0, totalHouseholdWorkMinutes - totalHouseholdCapacityMinutes);

  return {
    horizonWeeks,
    totalHouseholdCapacityMinutes,
    totalHouseholdWorkMinutes,
    totalHouseholdWeightedWork,
    targetHouseholdUtilization,
    capacityDeficitMinutes,
    memberMap,
    taskMap,
    occurrences,
  };
}
