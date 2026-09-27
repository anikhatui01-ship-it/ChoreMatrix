/**
 * Database Row Types & Mapping Interfaces for ChoreMatrix
 */

import type { DayOfWeek, HouseholdType, OptimizationMode, OptimizationRequest, OptimizationResult } from '../optimizer/types.ts';

export interface ProfileRow {
  id: string;
  email: string;
  plan_tier: string;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HouseholdRow {
  id: string;
  user_id: string;
  name: string;
  type: HouseholdType;
  mode: OptimizationMode;
  planning_horizon_weeks: number;
  created_at: string;
  updated_at: string;
}

export interface MemberRow {
  id: string;
  household_id: string;
  user_id: string;
  name: string;
  role: string;
  weekly_capacity_minutes: number;
  unavailable_days: DayOfWeek[];
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  household_id: string;
  user_id: string;
  name: string;
  category: string;
  frequency_per_week: number;
  duration_minutes: number;
  effort_level: number;
  fixed_days: DayOfWeek[];
  eligible_member_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface MemberPreferenceRow {
  id: string;
  household_id: string;
  user_id: string;
  member_id: string;
  task_id: string;
  preference_type: 'prefer' | 'avoid';
  created_at: string;
}

export interface PlanRow {
  id: string;
  household_id: string;
  user_id: string;
  optimizer_version: string;
  balance_score: number;
  total_work_minutes: number;
  total_capacity_minutes: number;
  diagnostics: Record<string, unknown>;
  member_summaries: unknown[];
  unassigned_tasks: unknown[];
  assignments: unknown[];
  diff_summary: string[];
  created_at: string;
}

export interface UserPrivacyPreferencesRow {
  user_id: string;
  preferences_consent: boolean;
  analytics_consent: boolean;
  updated_at: string;
}
