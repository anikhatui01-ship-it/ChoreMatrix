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

export function getLocalISODate(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDayOfWeekFromDateString(dateStr: string): DayOfWeek {
  if (!dateStr || typeof dateStr !== 'string') return 'mon';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return 'mon';
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const date = new Date(year, month, day);
  const dayIndex = date.getDay(); // 0: sun, 1: mon, ... 6: sat
  const days: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return days[dayIndex] || 'mon';
}

export function addDaysToDate(dateStr: string, daysToAdd: number): string {
  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const date = new Date(year, month, day);
  date.setDate(date.getDate() + daysToAdd);
  return getLocalISODate(date);
}

export function getDayDiff(dateStr1: string, dateStr2: string): number {
  const parts1 = dateStr1.split('-');
  const parts2 = dateStr2.split('-');
  const d1 = new Date(parseInt(parts1[0], 10), parseInt(parts1[1], 10) - 1, parseInt(parts1[2], 10));
  const d2 = new Date(parseInt(parts2[0], 10), parseInt(parts2[1], 10) - 1, parseInt(parts2[2], 10));
  return Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
}

