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

export class SupabaseAdapter {
  private get client() {
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
      this.client.from('members').select('*').eq('household_id', householdId).eq('user_id', userId),
      this.client.from('tasks').select('*').eq('household_id', householdId).eq('user_id', userId),
      this.client.from('member_preferences').select('*').eq('household_id', householdId).eq('user_id', userId),
      this.client.from('plans').select('*').eq('household_id', householdId).eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
    ]);

    if (membersRes.error) throw membersRes.error;
    if (tasksRes.error) throw tasksRes.error;
    if (prefsRes.error) throw prefsRes.error;

    const members = (membersRes.data || []) as MemberRow[];
    const tasks = (tasksRes.data || []) as TaskRow[];
    const prefs = (prefsRes.data || []) as MemberPreferenceRow[];

    // Reconstruct domain MemberInput
    const memberInputs: MemberInput[] = members.map(m => {
      const preferred = prefs.filter(p => p.member_id === m.id && p.preference_type === 'prefer').map(p => p.task_id);
      const avoided = prefs.filter(p => p.member_id === m.id && p.preference_type === 'avoid').map(p => p.task_id);
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        weeklyCapacityMinutes: m.weekly_capacity_minutes,
        unavailableDays: m.unavailable_days as DayOfWeek[],
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
      fixedDays: t.fixed_days as DayOfWeek[],
      eligibleMemberIds: t.eligible_member_ids
    }));

    const request: OptimizationRequest = {
      household: {
        id: household.id,
        name: household.name,
        type: household.type,
        mode: household.mode,
        planningHorizonWeeks: household.planning_horizon_weeks
      },
      members: memberInputs,
      tasks: taskInputs
    };

    let latestPlan: OptimizationResult | null = null;
    if (plansRes.data && plansRes.data.length > 0) {
      const p = plansRes.data[0] as PlanRow;
      latestPlan = {
        householdId: p.household_id,
        optimizerVersion: p.optimizer_version,
        weeks: household.planning_horizon_weeks,
        totalHouseholdWorkMinutes: p.total_work_minutes,
        totalHouseholdCapacityMinutes: p.total_capacity_minutes,
        totalHouseholdWeightedWork: (p.diagnostics as any)?.totalHouseholdWeightedWork || p.total_work_minutes,
        diagnostics: p.diagnostics as any,
        memberSummaries: p.member_summaries as any,
        unassignedTasks: p.unassigned_tasks as any,
        assignments: p.assignments as any,
        diffSummary: p.diff_summary || []
      };
    }

    return { request, latestPlan };
  }

  /**
   * Persists household, members, tasks and soft preferences.
   */
  async saveHousehold(userId: string, request: OptimizationRequest): Promise<string> {
    // 1. Upsert household
    const { data: hData, error: hError } = await this.client
      .from('households')
      .upsert({
        id: request.household.id.startsWith('h_') ? undefined : request.household.id,
        user_id: userId,
        name: request.household.name,
        type: request.household.type,
        mode: request.household.mode,
        planning_horizon_weeks: request.household.planningHorizonWeeks,
        updated_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (hError) throw hError;
    const householdId = hData.id;

    // 2. Sync members
    // Delete existing members for this household to ensure clean sync
    await this.client.from('members').delete().eq('household_id', householdId).eq('user_id', userId);
    
    if (request.members.length > 0) {
      const memberRows = request.members.map(m => ({
        household_id: householdId,
        user_id: userId,
        name: m.name,
        role: m.role,
        weekly_capacity_minutes: m.weeklyCapacityMinutes,
        unavailable_days: m.unavailableDays || []
      }));
      const { data: insertedMembers, error: mError } = await this.client
        .from('members')
        .insert(memberRows)
        .select('id, name');
      if (mError) throw mError;

      // Map temporary IDs to database generated UUIDs
      const memberIdMap = new Map<string, string>();
      request.members.forEach((m, idx) => {
        if (insertedMembers && insertedMembers[idx]) {
          memberIdMap.set(m.id, insertedMembers[idx].id);
        }
      });

      // 3. Sync tasks
      await this.client.from('tasks').delete().eq('household_id', householdId).eq('user_id', userId);
      if (request.tasks.length > 0) {
        const taskRows = request.tasks.map(t => ({
          household_id: householdId,
          user_id: userId,
          name: t.name,
          category: t.category,
          frequency_per_week: t.frequencyPerWeek,
          duration_minutes: t.durationMinutes,
          effort_level: t.effortLevel,
          fixed_days: t.fixedDays || [],
          eligible_member_ids: (t.eligibleMemberIds || []).map(mid => memberIdMap.get(mid) || mid)
        }));
        await this.client.from('tasks').insert(taskRows);
      }
    }

    return householdId;
  }

  /**
   * Saves a calculated plan snapshot for diagnostics, history, and differential rebalancing.
   */
  async savePlan(userId: string, householdId: string, result: OptimizationResult): Promise<string> {
    const { data, error } = await this.client
      .from('plans')
      .insert({
        household_id: householdId,
        user_id: userId,
        optimizer_version: result.optimizerVersion,
        balance_score: result.diagnostics.balanceScore,
        total_work_minutes: result.totalHouseholdWorkMinutes,
        total_capacity_minutes: result.totalHouseholdCapacityMinutes,
        diagnostics: result.diagnostics,
        member_summaries: result.memberSummaries,
        unassigned_tasks: result.unassignedTasks,
        assignments: result.assignments,
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
