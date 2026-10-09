/**
 * ChoreMatrix Local Draft Persistence Manager
 *
 * Provides safe, privacy-first local browser draft saving and recovery
 * for unauthenticated visitors and in-progress calculator sessions.
 *
 * Guarantees:
 * 1. Never overwrites cloud-saved households for authenticated users.
 * 2. Validates schema and recovers gracefully from corrupted storage.
 * 3. Keeps drafts strictly in client-side localStorage (zero remote transmission).
 */

import type { OptimizationRequest, OptimizationResult } from '../optimizer/types.ts';
import { isValidPlanSnapshot } from './supabaseAdapter.ts';

export const DRAFT_STORAGE_KEY = 'chorematrix_local_draft_v1';

const VALID_DAYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

export interface LocalDraftPayload {
  request: OptimizationRequest;
  result: OptimizationResult | null;
  updatedAt: number;
}

/**
 * Validates whether an object matches the minimal shape of an OptimizationRequest.
 */
export function isValidOptimizationRequest(req: any): req is OptimizationRequest {
  if (!req || typeof req !== 'object') return false;
  if (!req.household || typeof req.household !== 'object') return false;
  if (!Array.isArray(req.members) || !Array.isArray(req.tasks)) return false;
  return true;
}

/**
 * Saves the current in-progress calculator state as a local draft.
 */
export function saveLocalDraft(
  request: OptimizationRequest,
  result?: OptimizationResult | null
): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }

  if (!isValidOptimizationRequest(request)) {
    return false;
  }

  // Only persist if there is meaningful user data (at least 1 member or 1 task)
  if (request.members.length === 0 && request.tasks.length === 0) {
    clearLocalDraft();
    return true;
  }

  try {
    const payload: LocalDraftPayload = {
      request: {
        household: {
          id: request.household.id || 'h1',
          name: request.household.name || 'My Household',
          type: request.household.type || 'family',
          mode: request.household.mode || 'capacity_aware',
          planningHorizonWeeks: request.household.planningHorizonWeeks || 1
        },
        members: request.members.map(m => ({
          id: String(m.id),
          name: String(m.name || 'Member'),
          role: String(m.role || 'Adult'),
          weeklyCapacityMinutes: Number(m.weeklyCapacityMinutes) || 180,
          unavailableDays: Array.isArray(m.unavailableDays) ? m.unavailableDays.filter(d => VALID_DAYS.has(d)) : [],
          preferredTaskIds: Array.isArray(m.preferredTaskIds) ? m.preferredTaskIds.map(String) : [],
          avoidedTaskIds: Array.isArray(m.avoidedTaskIds) ? m.avoidedTaskIds.map(String) : []
        })),
        tasks: request.tasks.map(t => ({
          id: String(t.id),
          name: String(t.name || 'Chore'),
          category: String(t.category || 'General'),
          frequencyPerWeek: Number(t.frequencyPerWeek) || 1,
          durationMinutes: Number(t.durationMinutes) || 15,
          effortLevel: Number(t.effortLevel) || 2,
          eligibleMemberIds: Array.isArray(t.eligibleMemberIds) ? t.eligibleMemberIds.map(String) : [],
          fixedDays: Array.isArray(t.fixedDays) ? t.fixedDays.filter(d => VALID_DAYS.has(d)) : undefined
        }))
      },
      result: isValidPlanSnapshot(result) ? result : null,
      updatedAt: Date.now()
    };

    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn('[ChoreMatrix LocalDraft] Failed to save draft:', e);
    return false;
  }
}

/**
 * Loads a previously saved local draft, validating schema and sanitizing inputs.
 */
export function loadLocalDraft(): LocalDraftPayload | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !isValidOptimizationRequest(parsed.request)) {
      clearLocalDraft();
      return null;
    }

    const req = parsed.request;
    const cleanRequest: OptimizationRequest = {
      household: {
        id: String(req.household.id || 'h1'),
        name: String(req.household.name || 'My Household'),
        type: req.household.type === 'couple' || req.household.type === 'roommates' ? req.household.type : 'family',
        mode: req.household.mode === 'balanced' ? 'balanced' : 'capacity_aware',
        planningHorizonWeeks: Number(req.household.planningHorizonWeeks) || 1
      },
      members: Array.isArray(req.members)
        ? req.members.map((m: any, idx: number) => ({
            id: String(m.id || `m_${idx}`),
            name: String(m.name || `Member ${idx + 1}`),
            role: String(m.role || 'Adult'),
            weeklyCapacityMinutes: Math.max(1, Number(m.weeklyCapacityMinutes) || 180),
            unavailableDays: Array.isArray(m.unavailableDays) ? m.unavailableDays.filter((d: any) => VALID_DAYS.has(d)) : [],
            preferredTaskIds: Array.isArray(m.preferredTaskIds) ? m.preferredTaskIds.map(String) : [],
            avoidedTaskIds: Array.isArray(m.avoidedTaskIds) ? m.avoidedTaskIds.map(String) : []
          }))
        : [],
      tasks: Array.isArray(req.tasks)
        ? req.tasks.map((t: any, idx: number) => ({
            id: String(t.id || `t_${idx}`),
            name: String(t.name || `Task ${idx + 1}`),
            category: String(t.category || 'General'),
            frequencyPerWeek: Math.max(1, Math.min(28, Number(t.frequencyPerWeek) || 1)),
            durationMinutes: Math.max(1, Number(t.durationMinutes) || 15),
            effortLevel: Math.max(1, Math.min(5, Number(t.effortLevel) || 2)) as 1 | 2 | 3 | 4 | 5,
            eligibleMemberIds: Array.isArray(t.eligibleMemberIds) ? t.eligibleMemberIds.map(String) : [],
            fixedDays: Array.isArray(t.fixedDays) ? t.fixedDays.filter((d: any) => VALID_DAYS.has(d)) : undefined
          }))
        : []
    };

    return {
      request: cleanRequest,
      result: isValidPlanSnapshot(parsed.result) ? parsed.result : null,
      updatedAt: Number(parsed.updatedAt) || Date.now()
    };
  } catch (e) {
    console.warn('[ChoreMatrix LocalDraft] Corrupted draft encountered; resetting:', e);
    clearLocalDraft();
    return null;
  }
}

/**
 * Clears the local draft from browser storage.
 */
export function clearLocalDraft(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch (e) {}
}

/**
 * Checks if a valid local draft exists in browser storage.
 */
export function hasLocalDraft(): boolean {
  return loadLocalDraft() !== null;
}
