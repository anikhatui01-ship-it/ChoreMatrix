import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SupabaseAdapter } from '../../src/persistence/supabaseAdapter.ts';
import {
  saveDevicePlan,
  loadDevicePlan,
  clearDevicePlan,
  hasDevicePlan
} from '../../src/persistence/localDraft.ts';
import { getPlanningEntitlement, enforcePlanningHorizon } from '../../src/monetization/entitlements.ts';
import type { OptimizationRequest, OptimizationResult } from '../../src/optimizer/types.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Mock localStorage for node test environment
class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) || null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

if (typeof (globalThis as any).localStorage === 'undefined') {
  (globalThis as any).localStorage = new MockLocalStorage();
}

/**
 * Strict Mock Supabase Client that validates PostgreSQL schema types and constraints
 */
class StrictMockSupabaseClient {
  public tables: Record<string, any[]> = {
    households: [],
    members: [],
    tasks: [],
    member_preferences: [],
    plans: [],
    profiles: []
  };

  public shouldFailNextOperation: string | null = null;

  from(tableName: string) {
    const table = this.tables[tableName];
    if (!table) {
      throw new Error(`Table ${tableName} does not exist in mock.`);
    }

    const client = this;

    return {
      select(columns = '*') {
        let filters: Array<(row: any) => boolean> = [];
        let sortFn: ((a: any, b: any) => number) | null = null;
        let limitCount: number | null = null;

        const queryObj = {
          eq(col: string, val: any) {
            filters.push(row => row[col] === val);
            return queryObj;
          },
          order(col: string, { ascending = true }: { ascending?: boolean } = {}) {
            sortFn = (a, b) => {
              if (a[col] < b[col]) return ascending ? -1 : 1;
              if (a[col] > b[col]) return ascending ? 1 : -1;
              return 0;
            };
            return queryObj;
          },
          limit(n: number) {
            limitCount = n;
            return queryObj;
          },
          async then(resolve: any) {
            if (client.shouldFailNextOperation === tableName || client.shouldFailNextOperation === 'all') {
              client.shouldFailNextOperation = null;
              return resolve({ data: null, error: new Error(`Simulated database failure on ${tableName}`) });
            }
            let res = table.filter(row => filters.every(f => f(row)));
            if (sortFn) {
              res = [...res].sort(sortFn);
            }
            if (limitCount !== null) {
              res = res.slice(0, limitCount);
            }
            return resolve({ data: JSON.parse(JSON.stringify(res)), error: null });
          },
          async single() {
            const { data, error } = await queryObj;
            if (error) return { data: null, error };
            if (!data || data.length === 0) {
              return { data: null, error: new Error('Row not found') };
            }
            return { data: data[0], error: null };
          }
        };
        return queryObj;
      },

      insert(rows: any | any[]) {
        const rowList = Array.isArray(rows) ? rows : [rows];
        const inserted: any[] = [];

        return {
          select(cols = '*') {
            return {
              async single() {
                if (client.shouldFailNextOperation === tableName || client.shouldFailNextOperation === 'all') {
                  client.shouldFailNextOperation = null;
                  return { data: null, error: new Error(`Simulated insert failure on ${tableName}`) };
                }
                const row = { ...rowList[0] };
                if (!row.id) row.id = crypto.randomUUID();
                client.validatePostgresTypes(tableName, row);
                table.push(row);
                return { data: JSON.parse(JSON.stringify(row)), error: null };
              }
            };
          },
          async then(resolve: any) {
            if (client.shouldFailNextOperation === tableName || client.shouldFailNextOperation === 'all') {
              client.shouldFailNextOperation = null;
              return resolve({ data: null, error: new Error(`Simulated insert failure on ${tableName}`) });
            }
            for (const r of rowList) {
              const row = { ...r };
              if (!row.id) row.id = crypto.randomUUID();
              client.validatePostgresTypes(tableName, row);
              table.push(row);
              inserted.push(row);
            }
            return resolve({ data: JSON.parse(JSON.stringify(inserted)), error: null });
          }
        };
      },

      upsert(row: any) {
        return {
          select(cols = '*') {
            return {
              async single() {
                if (client.shouldFailNextOperation === tableName || client.shouldFailNextOperation === 'all') {
                  client.shouldFailNextOperation = null;
                  return { data: null, error: new Error(`Simulated upsert failure on ${tableName}`) };
                }
                client.validatePostgresTypes(tableName, row);
                const existingIdx = table.findIndex(r => r.id === row.id);
                if (existingIdx >= 0) {
                  table[existingIdx] = { ...table[existingIdx], ...row };
                  return { data: JSON.parse(JSON.stringify(table[existingIdx])), error: null };
                } else {
                  const newRow = { ...row };
                  if (!newRow.id) newRow.id = crypto.randomUUID();
                  table.push(newRow);
                  return { data: JSON.parse(JSON.stringify(newRow)), error: null };
                }
              }
            };
          }
        };
      },

      update(values: any) {
        let filters: Array<(row: any) => boolean> = [];
        const updateObj = {
          eq(col: string, val: any) {
            filters.push(row => row[col] === val);
            return updateObj;
          },
          async then(resolve: any) {
            if (client.shouldFailNextOperation === tableName || client.shouldFailNextOperation === 'all') {
              client.shouldFailNextOperation = null;
              return resolve({ data: null, error: new Error(`Simulated update failure on ${tableName}`) });
            }
            for (let i = 0; i < table.length; i++) {
              if (filters.every(f => f(table[i]))) {
                table[i] = { ...table[i], ...values };
              }
            }
            return resolve({ data: null, error: null });
          }
        };
        return updateObj;
      },

      delete() {
        let filters: Array<(row: any) => boolean> = [];
        const deleteObj = {
          eq(col: string, val: any) {
            filters.push(row => row[col] === val);
            return deleteObj;
          },
          async then(resolve: any) {
            if (client.shouldFailNextOperation === tableName || client.shouldFailNextOperation === 'all') {
              client.shouldFailNextOperation = null;
              return resolve({ error: new Error(`Simulated delete failure on ${tableName}`) });
            }
            const initialCount = table.length;
            const remaining = table.filter(row => !filters.every(f => f(row)));
            client.tables[tableName] = remaining;
            return resolve({ error: null, count: initialCount - remaining.length });
          }
        };
        return deleteObj;
      }
    };
  }

  /**
   * Enforces strict Postgres type constraints, especially uuid and uuid[]
   */
  private validatePostgresTypes(table: string, row: any) {
    if (table === 'households') {
      if (row.id && !UUID_REGEX.test(row.id)) {
        throw new Error(`invalid input syntax for type uuid: "${row.id}" on households.id`);
      }
    }
    if (table === 'members') {
      if (row.id && !UUID_REGEX.test(row.id)) {
        throw new Error(`invalid input syntax for type uuid: "${row.id}" on members.id`);
      }
      if (row.household_id && !UUID_REGEX.test(row.household_id)) {
        throw new Error(`invalid input syntax for type uuid: "${row.household_id}" on members.household_id`);
      }
    }
    if (table === 'tasks') {
      if (row.id && !UUID_REGEX.test(row.id)) {
        throw new Error(`invalid input syntax for type uuid: "${row.id}" on tasks.id`);
      }
      if (row.household_id && !UUID_REGEX.test(row.household_id)) {
        throw new Error(`invalid input syntax for type uuid: "${row.household_id}" on tasks.household_id`);
      }
      if (Array.isArray(row.eligible_member_ids)) {
        for (const item of row.eligible_member_ids) {
          if (!UUID_REGEX.test(item)) {
            throw new Error(`invalid input syntax for type uuid: "${item}" on tasks.eligible_member_ids (uuid[])`);
          }
        }
      }
    }
    if (table === 'member_preferences') {
      if (row.member_id && !UUID_REGEX.test(row.member_id)) {
        throw new Error(`invalid input syntax for type uuid: "${row.member_id}" on member_preferences.member_id`);
      }
      if (row.task_id && !UUID_REGEX.test(row.task_id)) {
        throw new Error(`invalid input syntax for type uuid: "${row.task_id}" on member_preferences.task_id`);
      }
    }
  }
}

describe('Phase 5 Correction: Acceptance & Regression Suite', () => {
  const userId = 'usr_test_auth_123';

  function createTestRequest(): OptimizationRequest {
    return {
      household: {
        id: 'h1',
        name: 'The Correction Family',
        type: 'family',
        mode: 'capacity_aware',
        planningHorizonWeeks: 4
      },
      members: [
        {
          id: 'm1', // Temporary client identifier
          name: 'Parent Alice',
          role: 'Adult',
          weeklyCapacityMinutes: 300,
          unavailableDays: ['mon'],
          preferredTaskIds: ['t1'],
          avoidedTaskIds: ['t2']
        },
        {
          id: 'm2', // Temporary client identifier
          name: 'Parent Bob',
          role: 'Adult',
          weeklyCapacityMinutes: 300,
          unavailableDays: ['wed'],
          preferredTaskIds: ['t2'],
          avoidedTaskIds: ['t1']
        }
      ],
      tasks: [
        {
          id: 't1', // Temporary client identifier
          name: 'Dishes',
          category: 'Kitchen',
          frequencyPerWeek: 7,
          durationMinutes: 20,
          effortLevel: 2,
          eligibleMemberIds: ['m1', 'm2'] // Temporary client IDs in eligible list
        },
        {
          id: 't2', // Temporary client identifier
          name: 'Deep Laundry',
          category: 'Laundry',
          frequencyPerWeek: 2,
          durationMinutes: 45,
          effortLevel: 4,
          eligibleMemberIds: ['m1', 'm2']
        }
      ]
    };
  }

  function createTestResult(request: OptimizationRequest): OptimizationResult {
    return {
      assignments: [
        {
          id: 'a1',
          taskId: request.tasks[0].id,
          taskName: request.tasks[0].name,
          category: request.tasks[0].category,
          memberId: request.members[0].id,
          memberName: request.members[0].name,
          dayOfWeek: 'tue',
          weekIndex: 0,
          durationMinutes: 20,
          effortLevel: 2,
          reasonCodes: ['capacity_proportional']
        },
        {
          id: 'a2',
          taskId: request.tasks[1].id,
          taskName: request.tasks[1].name,
          category: request.tasks[1].category,
          memberId: request.members[1].id,
          memberName: request.members[1].name,
          dayOfWeek: 'thu',
          weekIndex: 1,
          durationMinutes: 45,
          effortLevel: 4,
          reasonCodes: ['capacity_proportional']
        }
      ],
      unassignedTasks: [],
      memberSummaries: [
        {
          memberId: request.members[0].id,
          memberName: request.members[0].name,
          role: 'Adult',
          capacityMinutes: 300,
          assignedMinutes: 20,
          assignedCount: 1,
          utilizationRatio: 0.067,
          weightedEffort: 2
        },
        {
          memberId: request.members[1].id,
          memberName: request.members[1].name,
          role: 'Adult',
          capacityMinutes: 300,
          assignedMinutes: 45,
          assignedCount: 1,
          utilizationRatio: 0.15,
          weightedEffort: 4
        }
      ],
      diagnostics: {
        balanceScore: 94,
        giniCoefficient: 0.05,
        maxDisparityRatio: 1.1,
        totalHouseholdCapacityMinutes: 600,
        totalHouseholdWorkMinutes: 65,
        totalHouseholdWeightedWork: 6,
        mode: 'capacity_aware',
        unassignedCount: 0
      },
      fairnessIndex: 94,
      mode: 'capacity_aware',
      weeks: 4,
      solverStatus: 'optimal'
    };
  }

  // ========================================================
  // PART A — CLOUD PERSISTENCE & UUID BOUNDARY MAPPING
  // ========================================================
  describe('A. Cloud Persistence & Boundary UUID Mapping', () => {
    it('maps client IDs like m1 and t1 to valid UUIDs and preserves Postgres uuid/uuid[] integrity', async () => {
      const mock = new StrictMockSupabaseClient();
      const adapter = new SupabaseAdapter(mock as any);

      const request = createTestRequest();
      const result = createTestResult(request);

      // This call previously crashed with: invalid input syntax for type uuid: "m1"
      const householdId = await adapter.saveHousehold(userId, request, result);
      assert.ok(UUID_REGEX.test(householdId), 'Returned household ID must be a valid UUID');

      // Check tasks table in Supabase
      const tasksInDb = mock.tables.tasks;
      assert.strictEqual(tasksInDb.length, 2);
      for (const t of tasksInDb) {
        assert.ok(UUID_REGEX.test(t.id), `Task ID in DB must be a UUID, got ${t.id}`);
        assert.ok(Array.isArray(t.eligible_member_ids), 'eligible_member_ids must be an array');
        for (const eligId of t.eligible_member_ids) {
          assert.ok(
            UUID_REGEX.test(eligId),
            `eligible_member_ids must contain only valid UUIDs, got: ${eligId}`
          );
        }
      }

      // Check members table in Supabase
      const membersInDb = mock.tables.members;
      assert.strictEqual(membersInDb.length, 2);
      for (const m of membersInDb) {
        assert.ok(UUID_REGEX.test(m.id), `Member ID in DB must be a UUID, got ${m.id}`);
      }

      // Reload household and check references
      const loaded = await adapter.loadActiveHousehold(userId, 'family');
      assert.ok(loaded);
      assert.strictEqual(loaded.request.members.length, 2);
      assert.strictEqual(loaded.request.tasks.length, 2);

      // Check that assignments still point to mapped valid member and task IDs
      const loadedMemberIds = new Set(loaded.request.members.map(m => m.id));
      const loadedTaskIds = new Set(loaded.request.tasks.map(t => t.id));
      for (const a of loaded.latestPlan?.assignments || []) {
        assert.ok(loadedMemberIds.has(a.memberId), 'Assignment memberId must match loaded member');
        assert.ok(loadedTaskIds.has(a.taskId), 'Assignment taskId must match loaded task');
      }
    });

    it('failed save throws an actionable error and does not mutate in-memory state', async () => {
      const mock = new StrictMockSupabaseClient();
      const adapter = new SupabaseAdapter(mock as any);

      const request = createTestRequest();
      request.members[0].name = 'Edited In Memory Name';

      mock.shouldFailNextOperation = 'households';

      await assert.rejects(
        async () => {
          await adapter.saveHousehold(userId, request);
        },
        /Simulated database failure on households/
      );

      // In-memory changes must be preserved
      assert.strictEqual(request.members[0].name, 'Edited In Memory Name');
    });

    it('app.html sets clean non-conflicting save states (never Saved and Error simultaneously)', () => {
      const appHtmlPath = path.resolve('app.html');
      const content = fs.readFileSync(appHtmlPath, 'utf8');

      // Verify unified setCloudSaveState function exists
      assert.ok(content.includes('function setCloudSaveState('));
      assert.ok(content.includes('case \'error\':'));
      assert.ok(content.includes('case \'saved\':'));
      assert.ok(content.includes('case \'unsaved\':'));
      assert.ok(content.includes('case \'saving\':'));

      // In error state, unsavedIndicator must remain visible and saveStatusIndicator hidden
      assert.ok(content.includes("saveStatus.style.display = 'none';"));
    });
  });

  // ========================================================
  // PART B — ANONYMOUS SAVING & DEVICE RECOVERY
  // ========================================================
  describe('B. Anonymous Saving & Device Recovery', () => {
    it('saves a 1-week plan locally on the device and recovers it accurately', () => {
      clearDevicePlan();
      assert.strictEqual(hasDevicePlan(), false);

      const request = createTestRequest();
      request.household.planningHorizonWeeks = 1;
      const result = createTestResult(request);

      const saved = saveDevicePlan(request, result);
      assert.strictEqual(saved, true);
      assert.strictEqual(hasDevicePlan(), true);

      // Simulate page refresh / restart
      const restored = loadDevicePlan();
      assert.ok(restored);
      assert.strictEqual(restored.request.household.name, 'The Correction Family');
      assert.strictEqual(restored.request.household.planningHorizonWeeks, 1);
      assert.ok(restored.result);
      assert.strictEqual(restored.result.fairnessIndex, 94);
      assert.ok(restored.savedAt);
    });

    it('index.html provides Save to This Device and does not offer PDF export to anonymous users', () => {
      const indexPath = path.resolve('index.html');
      const content = fs.readFileSync(indexPath, 'utf8');

      assert.ok(content.includes('id="btnDeviceSave"'), 'index.html must have Save to This Device button');
      assert.ok(content.includes('Save to This Device'), 'index.html must display "Save to This Device"');
      assert.ok(content.includes('id="btnClearDevicePlan"'), 'index.html must provide Clear Device Plan button');
      assert.ok(!content.includes('id="btnPrintPlan"'), 'index.html must NOT contain #btnPrintPlan');
      assert.ok(!content.includes('id="btnExportPdf"'), 'index.html must NOT contain #btnExportPdf');
      assert.ok(!content.includes('Download Saved Plan as PDF'), 'index.html must NOT advertise PDF download');
    });

    it('index.html protects against accidental overwrite when switching presets', () => {
      const indexPath = path.resolve('index.html');
      const content = fs.readFileSync(indexPath, 'utf8');

      assert.ok(
        content.includes('safeLoadPreset') && content.includes('hasDevicePlan()') && content.includes('confirm'),
        'index.html must confirm before loading preset if saved device plan exists'
      );
    });
  });

  // ========================================================
  // PART C — SIGNED-IN FREE ENTITLEMENTS
  // ========================================================
  describe('C. Signed-In Free Entitlements', () => {
    it('restricts Free user strictly to 1 week planning horizon', () => {
      const freeEntitlement = getPlanningEntitlement({ plan_tier: 'free' });
      assert.strictEqual(freeEntitlement.maxPlanningWeeks, 1);
      assert.strictEqual(freeEntitlement.isPaid, false);

      const clampedWeeks = enforcePlanningHorizon(4, freeEntitlement);
      assert.strictEqual(clampedWeeks, 1, 'Free tier must clamp 4 weeks to 1');
    });

    it('app.html guards PDF export and week saving against Free users', () => {
      const appHtmlPath = path.resolve('app.html');
      const content = fs.readFileSync(appHtmlPath, 'utf8');

      // Export PDF check requires paid entitlement
      assert.ok(content.includes('if (!currentUser || !currentEntitlement.isPaid || currentEntitlement.maxPlanningWeeks < 4)'));
      // Save week check requires paid entitlement
      assert.ok(content.includes('if (!currentUser || !currentEntitlement.isPaid) return;'));
    });
  });

  // ========================================================
  // PART D — PAID PLANS: 4 WEEKS, PER-WEEK SAVES & PRESET SEPARATION
  // ========================================================
  describe('D. Paid Plans: 4 Weeks, Per-Week Saves & Preset Separation', () => {
    it('allows Pro and Plus users 4 weeks planning horizon', () => {
      const proEntitlement = getPlanningEntitlement({ plan_tier: 'pro' });
      assert.strictEqual(proEntitlement.maxPlanningWeeks, 4);
      assert.strictEqual(proEntitlement.isPaid, true);

      const plusEntitlement = getPlanningEntitlement({ plan_tier: 'plus' });
      assert.strictEqual(plusEntitlement.maxPlanningWeeks, 4);
      assert.strictEqual(plusEntitlement.isPaid, true);

      assert.strictEqual(enforcePlanningHorizon(4, proEntitlement), 4);
    });

    it('saves individual weekly snapshots independently', async () => {
      const mock = new StrictMockSupabaseClient();
      const adapter = new SupabaseAdapter(mock as any);

      const request = createTestRequest();
      const result = createTestResult(request);
      const householdId = await adapter.saveHousehold(userId, request, result);

      // Save Week 0 snapshot
      const week0Snapshot = {
        weekIndex: 0,
        assignments: [{ taskId: 't1', dayOfWeek: 'mon' }],
        savedAt: new Date().toISOString()
      };
      await adapter.saveWeeklySnapshot(userId, householdId, 0, week0Snapshot);

      // Save Week 2 snapshot independently
      const week2Snapshot = {
        weekIndex: 2,
        assignments: [{ taskId: 't2', dayOfWeek: 'fri' }],
        savedAt: new Date().toISOString()
      };
      await adapter.saveWeeklySnapshot(userId, householdId, 2, week2Snapshot);

      // Verify plans table in mock
      const plans = mock.tables.plans.filter(p => p.household_id === householdId);
      assert.ok(plans.length > 0);
      const latestPlan = plans[plans.length - 1];
      assert.deepStrictEqual(latestPlan.diagnostics.savedWeeks.sort(), [0, 2]);
      assert.ok(latestPlan.diagnostics.weeklySnapshots[0]);
      assert.ok(latestPlan.diagnostics.weeklySnapshots[2]);
      assert.strictEqual(latestPlan.diagnostics.weeklySnapshots[1], undefined);
    });

    it('supports all presets (Couple, Family, Roommates) independently without overwriting', async () => {
      const mock = new StrictMockSupabaseClient();
      const adapter = new SupabaseAdapter(mock as any);

      // 1. Save Family household
      const familyReq = createTestRequest();
      familyReq.household.type = 'family';
      familyReq.household.name = 'The Family Home';
      const familyId = await adapter.saveHousehold(userId, familyReq);

      // 2. Save Couple household
      const coupleReq = createTestRequest();
      coupleReq.household.type = 'couple';
      coupleReq.household.name = 'The Couple Loft';
      coupleReq.members = [
        { id: 'm1', name: 'Partner One', role: 'Partner', weeklyCapacityMinutes: 200 },
        { id: 'm2', name: 'Partner Two', role: 'Partner', weeklyCapacityMinutes: 200 }
      ];
      const coupleId = await adapter.saveHousehold(userId, coupleReq);

      // 3. Save Roommates household
      const roommateReq = createTestRequest();
      roommateReq.household.type = 'roommates';
      roommateReq.household.name = 'Roommate Apartment';
      const roommateId = await adapter.saveHousehold(userId, roommateReq);

      // IDs must be distinct
      assert.notStrictEqual(familyId, coupleId);
      assert.notStrictEqual(coupleId, roommateId);

      // Loading active household for each preset returns the corresponding household
      const loadedFamily = await adapter.loadActiveHousehold(userId, 'family');
      assert.strictEqual(loadedFamily?.request.household.name, 'The Family Home');

      const loadedCouple = await adapter.loadActiveHousehold(userId, 'couple');
      assert.strictEqual(loadedCouple?.request.household.name, 'The Couple Loft');

      const loadedRoommates = await adapter.loadActiveHousehold(userId, 'roommates');
      assert.strictEqual(loadedRoommates?.request.household.name, 'Roommate Apartment');
    });

    it('requires active week to be saved before allowing PDF export', () => {
      const appHtmlPath = path.resolve('app.html');
      const content = fs.readFileSync(appHtmlPath, 'utf8');

      assert.ok(
        content.includes('if (!savedWeeks.has(activeWeek))'),
        'PDF export must verify that activeWeek has been saved first'
      );
    });
  });

  // ========================================================
  // PART E — PRINT QUALITY & ACCURATE CONTENT DISCLOSURES
  // ========================================================
  describe('E. Print Quality & Content Disclosures', () => {
    it('common.css hides website controls, ads, and navigation during print', () => {
      const cssPath = path.resolve('src/styles/common.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const printQuery = css.slice(css.indexOf('@media print'));
      assert.ok(printQuery.includes('#btnExportPdf'));
      assert.ok(printQuery.includes('#btnSaveWeek'));
      assert.ok(printQuery.includes('#btnDeviceSave'));
      assert.ok(printQuery.includes('#globalNavbar'));
      assert.ok(printQuery.includes('#globalFooter'));
      assert.ok(printQuery.includes('#cookieBannerContainer'));
      assert.ok(printQuery.includes('display: none !important'));
    });

    it('homepage hero headline is strictly preserved', () => {
      const indexPath = path.resolve('index.html');
      const indexContent = fs.readFileSync(indexPath, 'utf8');

      assert.ok(
        indexContent.includes('Stop arguing over who does what.') &&
        indexContent.includes('Let our household workload optimizer calculate the plan.'),
        'Homepage hero headline must be preserved exactly'
      );
    });

    it('how-it-works.html accurately explains device saves, free cloud saves, and pro/plus features', () => {
      const howPath = path.resolve('how-it-works.html');
      const content = fs.readFileSync(howPath, 'utf8');

      assert.ok(content.includes('Anonymous Visitors'));
      assert.ok(content.includes('Signed-In Free Users'));
      assert.ok(content.includes('Pro & Plus Subscribers'));
      assert.ok(content.includes('not automatically synchronized across devices'));
      assert.ok(content.includes('4-week horizons'));
    });
  });
});
