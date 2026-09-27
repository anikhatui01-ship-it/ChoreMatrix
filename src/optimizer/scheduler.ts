import type { DayOfWeek } from './types.ts';
import { DAYS_OF_WEEK } from './types.ts';

export function getDayIndex(day: DayOfWeek): number {
  return DAYS_OF_WEEK.indexOf(day);
}

export function getDayFromIndex(index: number): DayOfWeek {
  const normalized = ((index % 7) + 7) % 7;
  return DAYS_OF_WEEK[normalized];
}

export function checkSpacingViolation(
  candidateDay: DayOfWeek,
  existingDaysForTask: DayOfWeek[],
  minSpacingDays: number
): boolean {
  if (minSpacingDays <= 0 || existingDaysForTask.length === 0) {
    return false;
  }
  const candidateIndex = getDayIndex(candidateDay);
  for (const existing of existingDaysForTask) {
    const existingIndex = getDayIndex(existing);
    const diff = Math.abs(candidateIndex - existingIndex);
    if (diff < minSpacingDays) {
      return true;
    }
  }
  return false;
}

export function getCandidateDays(
  fixedDay?: DayOfWeek,
  preferredDays?: DayOfWeek[]
): DayOfWeek[] {
  if (fixedDay) {
    return [fixedDay];
  }
  if (preferredDays && preferredDays.length > 0) {
    const set = new Set(preferredDays);
    const rest = DAYS_OF_WEEK.filter(d => !set.has(d));
    return [...preferredDays, ...rest];
  }
  return [...DAYS_OF_WEEK];
}
