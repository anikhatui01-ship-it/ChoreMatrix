/**
 * ChoreMatrix Persistence Adapter for Supabase
 *
 * ARCHITECTURAL PRINCIPLE:
 * The optimizer domain engine is a pure mathematical solver.
 * This adapter mediates between the database and the normalized domain model (OptimizationRequest/OptimizationResult).
 * It preserves complete user isolation and handles graceful unconfigured states.
 */

import { supabase, isSupabaseConfigured } from '../config/supabase.ts';
import type { OptimizationRequest, OptimizationResult, MemberInput, TaskInput, DayOfWeek } from '../optimizer/types.ts';
import type { ProfileRow, HouseholdRow, MemberRow, TaskRow, MemberPreferenceRow, PlanRow } from './types.ts';
import { getPlanningEntitlement } from '../monetization/entitlements.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateUuid(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Evaluates whether an OptimizationResult object contains complete, valid, non-null
 * metrics required for persistent storage in the public.plans table.
 *
 * GUARANTEES:
 * 1. Checks that diagnostics exists with numeric, non-NaN totalHouseholdWorkMinutes,
 *    totalHouseholdCapacityMinutes, and balanceScore.
 * 2. Checks that assignments array is present.
 * 3. Never permits null or undefined to slip through into NOT NULL database columns.
 * 4. Never uses 0 as a fake fallback for missing metrics.
 */
export function isValidPlanSnapshot(planResult?: OptimizationResult | null): planResult is OptimizationResult {
  if (!planResult || typeof planResult !== 'object') return false;
  if (!Array.isArray(planResult.assignments)) return false;
  if (!planResult.diagnostics || typeof planResult.diagnostics !== 'object') return false;

  const totalWorkMinutes =
    typeof planResult.diagnostics.totalHouseholdWorkMinutes === 'number'
      ? planResult.diagnostics.totalHouseholdWorkMinutes
      : typeof (planResult as any).totalHouseholdWorkMinutes === 'number'
      ? (planResult as any).totalHouseholdWorkMinutes
      : null;

  const totalCapacityMinutes =
    typeof planResult.diagnostics.totalHouseholdCapacityMinutes === 'number'
      ? planResult.diagnostics.totalHouseholdCapacityMinutes
      : typeof (planResult as any).totalHouseholdCapacityMinutes === 'number'
      ? (planResult as any).totalHouseholdCapacityMinutes
      : null;

  const balanceScore =
    typeof planResult.diagnostics.balanceScore === 'number'
      ? planResult.diagnostics.balanceScore
      : typeof (planResult as any).balanceScore === 'number'
      ? (planResult as any).balanceScore
      : null;

  if (
    totalWorkMinutes === null ||
    Number.isNaN(totalWorkMinutes) ||
    totalCapacityMinutes === null ||
    Number.isNaN(totalCapacityMinutes) ||
    balanceScore === null ||
    Number.isNaN(balanceScore)
  ) {
    return false;
  }

  // Must have at least one assignment or unassigned task diagnostic to represent a real calculated plan
  if (
    planResult.assignments.length === 0 &&
    (!Array.isArray(planResult.unassignedTasks) || planResult.unassignedTasks.length === 0)
  ) {
    return false;
  }

  return true;
}

export class SupabaseAdapter {
  protected customClient: any = null;

  constructor(client?: any) {
    if (client) {
      this.customClient = client;
    }
  }

  setClient(client: any) {
    this.customClient = client;
  }

  protected get client(): any {
    if (this.customClient) {
      return this.customClient;
    }
    if (!isSupabaseConfigured || !supabase) {
      throw new Error('Supabase client is not configured.');
    }
    return supabase;
  }

  /**
   * Fetches the user's active household and reconstructs the domain OptimizationRequest.
   */
  async loadActiveHousehold(userId: string): Promise<{ request: OptimizationRequest; latestPlan: OptimizationResult | null } | null> {
    const { data: households, error: hError } = await this.client
      .from('households')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (hError) throw hError;
    if (!households || households.length === 0) return null;

    const household = households[0] as HouseholdRow;
    const householdId = household.id;

    // Fetch members, tasks, preferences, and latest plan in parallel
    const [membersRes, tasksRes, prefsRes, plansRes] = await Promise.all([
      this.client
        .from('members')
        .select('*')
        .eq('household_id', householdId)
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      this.client
        .from('tasks')
        .select('*')
        .eq('household_id', householdId)
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      this.client
        .from('member_preferences')
        .select('*')
        .eq('household_id', householdId)
        .eq('user_id', userId),
      this.client
        .from('plans')
        .select('*')
        .eq('household_id', householdId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
    ]);

    if (membersRes.error) throw membersRes.error;
    if (tasksRes.error) throw tasksRes.error;
    if (prefsRes.error) throw prefsRes.error;

    const members = (membersRes.data || []) as MemberRow[];
    const tasks = (tasksRes.data || []) as TaskRow[];
    const prefs = (prefsRes.data || []) as MemberPreferenceRow[];

    // Reconstruct domain MemberInput
    const memberInputs: MemberInput[] = members.map(m => {
      const preferred = prefs
        .filter(p => p.member_id === m.id && p.preference_type === 'prefer')
        .map(p => p.task_id);
      const avoided = prefs
        .filter(p => p.member_id === m.id && p.preference_type === 'avoid')
        .map(p => p.task_id);
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        weeklyCapacityMinutes: m.weekly_capacity_minutes,
        unavailableDays: (m.unavailable_days || []) as DayOfWeek[],
        preferredTaskIds: preferred,
        avoidedTaskIds: avoided
      };
    });

    // Reconstruct domain TaskInput
    const taskInputs: TaskInput[] = tasks.map(t => ({
      id: t.id,
      name: t.name,
      category: t.category,
      frequencyPerWeek: t.frequency_per_week,
      durationMinutes: t.duration_minutes,
      effortLevel: t.effort_level as 1 | 2 | 3 | 4 | 5,
      fixedDays: (t.fixed_days || []) as DayOfWeek[],
      eligibleMemberIds: t.eligible_member_ids || []
    }));

    const rawWeeks = household.planning_horizon_weeks || 1;
    let maxAllowedWeeks = 4;
    try {
      const { data: profile } = await this.client
        .from('profiles')
        .select('plan_tier, subscription_status')
        .eq('id', userId)
        .maybeSingle();
      if (profile) {
        const entitlement = getPlanningEntitlement(profile);
        maxAllowedWeeks = entitlement.maxPlanningWeeks;
      }
    } catch (e) {}

    const safeLoadedWeeks = Math.max(1, Math.min(maxAllowedWeeks, rawWeeks));

    const request: OptimizationRequest = {
      household: {
        id: household.id,
        name: household.name,
        type: household.type,
        mode: household.mode,
        planningHorizonWeeks: safeLoadedWeeks
      },
      members: memberInputs,
      tasks: taskInputs
    };

    let latestPlan: OptimizationResult | null = null;
    if (plansRes.data && plansRes.data.length > 0) {
      const p = plansRes.data[0] as PlanRow;
      latestPlan = {
        runId: p.id,
        householdId: p.household_id,
        mode: household.mode,
        optimizerVersion: p.optimizer_version,
        weeks: household.planning_horizon_weeks,
        totalHouseholdWorkMinutes: p.total_work_minutes,
        totalHouseholdCapacityMinutes: p.total_capacity_minutes,
        totalHouseholdWeightedWork: (p.diagnostics as any)?.totalHouseholdWeightedWork ?? p.total_work_minutes,
        diagnostics: {
          ...(p.diagnostics || {}),
          totalHouseholdWorkMinutes: p.total_work_minutes,
          totalHouseholdCapacityMinutes: p.total_capacity_minutes,
          balanceScore: Number(p.balance_score)
        },
        memberSummaries: (p.member_summaries as any) || [],
        unassignedTasks: (p.unassigned_tasks as any) || [],
        assignments: (p.assignments as any) || [],
        diffSummary: p.diff_summary || []
      };
    }

    return { request, latestPlan };
  }

  /**
   * Persists household, members, tasks, preferences and optionally the calculated plan snapshot.
   * Fully maintains UUID stability, array ordering, foreign key consistency, and user isolation.
   */
  async saveHousehold(
    userId: string,
    request: OptimizationRequest,
    planResult?: OptimizationResult | null
  ): Promise<string> {
    // 1. Resolve or establish target household ID
    let householdId: string | null = null;
    if (request.household.id && UUID_REGEX.test(request.household.id)) {
      householdId = request.household.id;
    } else {
      // Check if user already has an active household in the database
      const { data: existing, error: findError } = await this.client
        .from('households')
        .select('id')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (findError) throw findError;
      if (existing && existing.length > 0) {
        householdId = existing[0].id;
      }
    }

    const targetHouseholdId = householdId || generateUuid();
    const nowIso = new Date().toISOString();

    let maxAllowedWeeks = 4;
    try {
      const { data: profile } = await this.client
        .from('profiles')
        .select('plan_tier, subscription_status')
        .eq('id', userId)
        .maybeSingle();
      if (profile) {
        const entitlement = getPlanningEntitlement(profile);
        maxAllowedWeeks = entitlement.maxPlanningWeeks;
      }
    } catch (e) {}

    const requestedWeeks = request.household.planningHorizonWeeks || 1;
    const safeHorizonWeeks = Math.max(1, Math.min(maxAllowedWeeks, requestedWeeks));
    request.household.planningHorizonWeeks = safeHorizonWeeks;

    const { data: hData, error: hError } = await this.client
      .from('households')
      .upsert({
        id: targetHouseholdId,
        user_id: userId,
        name: request.household.name || 'My Household',
        type: request.household.type || 'family',
        mode: request.household.mode || 'capacity_aware',
        planning_horizon_weeks: safeHorizonWeeks,
        updated_at: nowIso
      })
      .select('id')
      .single();
    if (hError) throw hError;
    const savedHouseholdId = hData?.id || targetHouseholdId;

    // Update request household identity in-place
    request.household.id = savedHouseholdId;

    // 2. Normalize and map IDs to stable UUIDs
    const memberIdMap = new Map<string, string>();
    request.members.forEach(m => {
      const oldId = m.id;
      const newId = UUID_REGEX.test(m.id) ? m.id : generateUuid();
      memberIdMap.set(oldId, newId);
      m.id = newId;
    });

    const taskIdMap = new Map<string, string>();
    request.tasks.forEach(t => {
      const oldId = t.id;
      const newId = UUID_REGEX.test(t.id) ? t.id : generateUuid();
      taskIdMap.set(oldId, newId);
      t.id = newId;
    });

    // Map member preferences to new task UUIDs
    request.members.forEach(m => {
      m.preferredTaskIds = (m.preferredTaskIds || []).map(tid => taskIdMap.get(tid) || tid);
      m.avoidedTaskIds = (m.avoidedTaskIds || []).map(tid => taskIdMap.get(tid) || tid);
    });

    // Map task eligibility to new member UUIDs
    request.tasks.forEach(t => {
      t.eligibleMemberIds = (t.eligibleMemberIds || []).map(mid => memberIdMap.get(mid) || mid);
    });

    // 3. Delete existing child records for this household in reverse foreign-key order
    const delPrefs = await this.client
      .from('member_preferences')
      .delete()
      .eq('household_id', savedHouseholdId)
      .eq('user_id', userId);
    if (delPrefs.error) throw delPrefs.error;

    const delTasks = await this.client
      .from('tasks')
      .delete()
      .eq('household_id', savedHouseholdId)
      .eq('user_id', userId);
    if (delTasks.error) throw delTasks.error;

    const delMembers = await this.client
      .from('members')
      .delete()
      .eq('household_id', savedHouseholdId)
      .eq('user_id', userId);
    if (delMembers.error) throw delMembers.error;

    // 4. Insert members with sequential created_at to strictly preserve UI ordering
    const baseTimestamp = Date.now();
    if (request.members.length > 0) {
      const memberRows = request.members.map((m, idx) => ({
        id: m.id,
        household_id: savedHouseholdId,
        user_id: userId,
        name: m.name,
        role: m.role,
        weekly_capacity_minutes: m.weeklyCapacityMinutes,
        unavailable_days: m.unavailableDays || [],
        created_at: new Date(baseTimestamp + idx * 10).toISOString(),
        updated_at: nowIso
      }));
      const { error: mError } = await this.client.from('members').insert(memberRows);
      if (mError) throw mError;
    }

    // 5. Insert tasks with sequential created_at to strictly preserve UI ordering
    if (request.tasks.length > 0) {
      const taskRows = request.tasks.map((t, idx) => ({
        id: t.id,
        household_id: savedHouseholdId,
        user_id: userId,
        name: t.name,
        category: t.category,
        frequency_per_week: t.frequencyPerWeek,
        duration_minutes: t.durationMinutes,
        effort_level: t.effortLevel,
        fixed_days: t.fixedDays || [],
        eligible_member_ids: t.eligibleMemberIds || [],
        created_at: new Date(baseTimestamp + idx * 10).toISOString(),
        updated_at: nowIso
      }));
      const { error: tError } = await this.client.from('tasks').insert(taskRows);
      if (tError) throw tError;
    }

    // 6. Insert member task preferences / aversions
    const prefRows: Array<{
      household_id: string;
      user_id: string;
      member_id: string;
      task_id: string;
      preference_type: 'prefer' | 'avoid';
      created_at: string;
    }> = [];

    const validTaskIds = new Set(request.tasks.map(t => t.id));
    const validMemberIds = new Set(request.members.map(m => m.id));

    for (const m of request.members) {
      if (!validMemberIds.has(m.id)) continue;
      if (m.preferredTaskIds) {
        for (const tid of m.preferredTaskIds) {
          if (validTaskIds.has(tid)) {
            prefRows.push({
              household_id: savedHouseholdId,
              user_id: userId,
              member_id: m.id,
              task_id: tid,
              preference_type: 'prefer',
              created_at: nowIso
            });
          }
        }
      }
      if (m.avoidedTaskIds) {
        for (const tid of m.avoidedTaskIds) {
          if (validTaskIds.has(tid)) {
            prefRows.push({
              household_id: savedHouseholdId,
              user_id: userId,
              member_id: m.id,
              task_id: tid,
              preference_type: 'avoid',
              created_at: nowIso
            });
          }
        }
      }
    }

    if (prefRows.length > 0) {
      const { error: pError } = await this.client.from('member_preferences').insert(prefRows);
      if (pError) throw pError;
    }

    // 7. Persist plan snapshot if a valid calculated plan exists and ALL required fields are populated
    if (isValidPlanSnapshot(planResult)) {
      const mappedAssignments = (planResult.assignments || []).map(a => ({
        ...a,
        memberId: memberIdMap.get(a.memberId) || a.memberId,
        taskId: taskIdMap.get(a.taskId) || a.taskId
      }));
      const mappedMemberSummaries = (planResult.memberSummaries || []).map(s => ({
        ...s,
        memberId: memberIdMap.get(s.memberId) || s.memberId
      }));
      const mappedUnassigned = (planResult.unassignedTasks || []).map(u => ({
        ...u,
        taskId: taskIdMap.get(u.taskId) || u.taskId
      }));

      const planToSave: OptimizationResult = {
        ...planResult,
        householdId: savedHouseholdId,
        assignments: mappedAssignments,
        memberSummaries: mappedMemberSummaries,
        unassignedTasks: mappedUnassigned,
        diagnostics: {
          ...planResult.diagnostics
        }
      };
      await this.savePlan(userId, savedHouseholdId, planToSave);
    }

    return savedHouseholdId;
  }

  /**
   * Saves a calculated plan snapshot for diagnostics, history, and differential rebalancing.
   * Truthfully maps optimizer diagnostics metrics to required non-null plans table columns.
   */
  async savePlan(userId: string, householdId: string, result: OptimizationResult): Promise<string> {
    if (!isValidPlanSnapshot(result)) {
      throw new Error(
        'Cannot persist plan snapshot: missing required non-null plan metrics (total_work_minutes, total_capacity_minutes, or balance_score).'
      );
    }

    const totalWorkMinutes =
      typeof result.diagnostics?.totalHouseholdWorkMinutes === 'number'
        ? result.diagnostics.totalHouseholdWorkMinutes
        : (result as any).totalHouseholdWorkMinutes;

    const totalCapacityMinutes =
      typeof result.diagnostics?.totalHouseholdCapacityMinutes === 'number'
        ? result.diagnostics.totalHouseholdCapacityMinutes
        : (result as any).totalHouseholdCapacityMinutes;

    const balanceScore =
      typeof result.diagnostics?.balanceScore === 'number'
        ? result.diagnostics.balanceScore
        : (result as any).balanceScore;

    const { data, error } = await this.client
      .from('plans')
      .insert({
        household_id: householdId,
        user_id: userId,
        optimizer_version: (result as any).optimizerVersion || '0.1.0',
        balance_score: balanceScore,
        total_work_minutes: totalWorkMinutes,
        total_capacity_minutes: totalCapacityMinutes,
        diagnostics: result.diagnostics,
        member_summaries: result.memberSummaries || [],
        unassigned_tasks: result.unassignedTasks || [],
        assignments: result.assignments || [],
        diff_summary: result.diffSummary || []
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  /**
   * Exports all user records for GDPR/data-rights compliance into a clean JSON object.
   */
  async exportUserData(userId: string): Promise<Record<string, unknown>> {
    const [profile, households, members, tasks, plans] = await Promise.all([
      this.client.from('profiles').select('*').eq('id', userId),
      this.client.from('households').select('*').eq('user_id', userId),
      this.client.from('members').select('*').eq('user_id', userId),
      this.client.from('tasks').select('*').eq('user_id', userId),
      this.client.from('plans').select('*').eq('user_id', userId)
    ]);

    return {
      exportTimestamp: new Date().toISOString(),
      profile: profile.data?.[0] || null,
      households: households.data || [],
      members: members.data || [],
      tasks: tasks.data || [],
      plans: plans.data || []
    };
  }

  /**
   * Permanently deletes user household data and profile.
   */
  async deleteUserData(userId: string): Promise<void> {
    await this.client.from('households').delete().eq('user_id', userId);
    await this.client.from('profiles').delete().eq('id', userId);
  }

  /**
   * Fetches user profile record from public.profiles.
   * Gracefully returns null if the profile row does not exist or if database errors occur.
   */
  async getProfile(userId: string): Promise<ProfileRow | null> {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('[ChoreMatrix Persistence] getProfile error:', error.message);
        return null;
      }
      return (data as ProfileRow) || null;
    } catch (err) {
      console.warn('[ChoreMatrix Persistence] getProfile exception:', err);
      return null;
    }
  }
}

export const persistenceAdapter = new SupabaseAdapter();
