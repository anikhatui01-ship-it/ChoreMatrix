import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAdapter, isValidPlanSnapshot } from '../../src/persistence/supabaseAdapter.ts';
import { runOptimization } from '../../src/optimizer/engine.ts';
import type { OptimizationRequest, OptimizationResult } from '../../src/optimizer/types.ts';

const SCHEMA_NOT_NULL_COLUMNS: Record<string, string[]> = {
  plans: [
    'household_id',
    'user_id',
    'optimizer_version',
    'balance_score',
    'total_work_minutes',
    'total_capacity_minutes',
    'diagnostics',
    'member_summaries',
    'unassigned_tasks',
    'assignments',
    'diff_summary'
  ],
  households: ['user_id', 'name', 'type', 'mode', 'planning_horizon_weeks'],
  members: ['household_id', 'user_id', 'name', 'role', 'weekly_capacity_minutes'],
  tasks: ['household_id', 'user_id', 'name', 'category', 'frequency_per_week', 'duration_minutes', 'effort_level'],
  member_preferences: ['household_id', 'user_id', 'member_id', 'task_id', 'preference_type']
};

/**
 * High-fidelity in-memory Mock Supabase Client simulating Postgres RLS, constraints, and queries
 */
class MockSupabaseClient {
  private tables: Record<string, any[]> = {
    households: [],
    members: [],
    tasks: [],
    member_preferences: [],
    plans: [],
    profiles: []
  };

  getTable(tableName: string) {
    return this.tables[tableName] || [];
  }

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
          async then(resolve: any, reject: any) {
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
                const notNullCols = SCHEMA_NOT_NULL_COLUMNS[tableName];
                if (notNullCols) {
                  for (const col of notNullCols) {
                    if (rowList[0][col] === null || rowList[0][col] === undefined) {
                      return { data: null, error: new Error(`null value in column '${col}' of relation '${tableName}' violates not-null constraint.`) };
                    }
                  }
                }
                const row = { ...rowList[0] };
                if (!row.id) row.id = crypto.randomUUID();
                table.push(row);
                return { data: JSON.parse(JSON.stringify(row)), error: null };
              }
            };
          },
          async then(resolve: any, reject: any) {
            if (client.shouldFailNextOperation === tableName || client.shouldFailNextOperation === 'all') {
              client.shouldFailNextOperation = null;
              return resolve({ data: null, error: new Error(`Simulated insert failure on ${tableName}`) });
            }
            const notNullCols = SCHEMA_NOT_NULL_COLUMNS[tableName];
            if (notNullCols) {
              for (const r of rowList) {
                for (const col of notNullCols) {
                  if (r[col] === null || r[col] === undefined) {
                    return resolve({ data: null, error: new Error(`null value in column '${col}' of relation '${tableName}' violates not-null constraint.`) });
                  }
                }
              }
            }
            for (const r of rowList) {
              const row = { ...r };
              if (!row.id) row.id = crypto.randomUUID();
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
                let existingIdx = table.findIndex(r => r.id === row.id);
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

      delete() {
        let filters: Array<(row: any) => boolean> = [];
        const deleteObj = {
          eq(col: string, val: any) {
            filters.push(row => row[col] === val);
            return deleteObj;
          },
          async then(resolve: any, reject: any) {
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

  getRawTable(name: string) {
    return this.tables[name];
  }
}

describe('Authenticated Persistence & Save Changes Regression Suite', () => {
  const userIdA = 'usr_alice_123';
  const userIdB = 'usr_bob_456';

  function createSampleRequest(): OptimizationRequest {
    return {
      household: {
        id: 'h_fam', // Starter prototype ID
        name: 'The Starter Household',
        type: 'family',
        mode: 'capacity_aware',
        planningHorizonWeeks: 4
      },
      members: [
        {
          id: 'm1',
          name: 'Maya',
          role: 'Adult',
          weeklyCapacityMinutes: 300,
          unavailableDays: ['wed'],
          preferredTaskIds: ['t_cook'],
          avoidedTaskIds: ['t_bath']
        },
        {
          id: 'm2',
          name: 'Arjun',
          role: 'Adult',
          weeklyCapacityMinutes: 240,
          unavailableDays: ['thu'],
          preferredTaskIds: [],
          avoidedTaskIds: ['t_dishes']
        }
      ],
      tasks: [
        {
          id: 't_cook',
          name: 'Cooking',
          category: 'Food',
          frequencyPerWeek: 7,
          durationMinutes: 30,
          effortLevel: 3,
          eligibleMemberIds: ['m1', 'm2']
        },
        {
          id: 't_dishes',
          name: 'Dishes',
          category: 'Kitchen',
          frequencyPerWeek: 7,
          durationMinutes: 15,
          effortLevel: 2,
          eligibleMemberIds: ['m1', 'm2']
        },
        {
          id: 't_bath',
          name: 'Bath Clean',
          category: 'Cleaning',
          frequencyPerWeek: 1,
          durationMinutes: 45,
          effortLevel: 5,
          fixedDays: ['sat'],
          eligibleMemberIds: ['m1', 'm2']
        }
      ]
    };
  }

  it('Requirement 1 & 2: saves initial configuration and creates stable UUIDs', async () => {
    const mock = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mock);

    const request = createSampleRequest();
    const householdId = await adapter.saveHousehold(userIdA, request);

    assert.ok(householdId, 'Must return a generated household UUID');
    assert.match(householdId, /^[0-9a-f-]+$/i, 'Household ID must be a valid UUID');
    assert.equal(request.household.id, householdId, 'request.household.id must be updated in-place');

    // Verify all member and task IDs became UUIDs
    for (const m of request.members) {
      assert.match(m.id, /^[0-9a-f-]+$/i, `Member ID ${m.id} must be UUID`);
    }
    for (const t of request.tasks) {
      assert.match(t.id, /^[0-9a-f-]+$/i, `Task ID ${t.id} must be UUID`);
      for (const eligId of t.eligibleMemberIds) {
        assert.match(eligId, /^[0-9a-f-]+$/i, `Eligible member ID ${eligId} must be UUID`);
      }
    }

    // Verify database table rows
    const households = mock.getRawTable('households');
    assert.equal(households.length, 1);
    assert.equal(households[0].id, householdId);
    assert.equal(households[0].user_id, userIdA);
    assert.equal(households[0].name, 'The Starter Household');

    const members = mock.getRawTable('members');
    assert.equal(members.length, 2);
    assert.ok(members.every((m: any) => m.household_id === householdId && m.user_id === userIdA));

    const tasks = mock.getRawTable('tasks');
    assert.equal(tasks.length, 3);
    assert.ok(tasks.every((t: any) => t.household_id === householdId && t.user_id === userIdA));

    const preferences = mock.getRawTable('member_preferences');
    assert.equal(preferences.length, 3, 'Must save 1 preferred task and 2 avoided tasks');
    assert.ok(preferences.every((p: any) => p.household_id === householdId && p.user_id === userIdA));
  });

  it('Requirement 3 & 4: reloads persisted configuration accurately after login/refresh', async () => {
    const mock = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mock);

    const initialRequest = createSampleRequest();
    // Custom edit before saving
    initialRequest.household.name = 'Alice Custom Manor';
    initialRequest.members[0].name = 'Maya Custom';
    initialRequest.members[0].weeklyCapacityMinutes = 400;
    initialRequest.members[0].unavailableDays = ['tue', 'fri'];

    const savedHouseholdId = await adapter.saveHousehold(userIdA, initialRequest);

    // Save a mock calculated plan snapshot
    const mockPlan: OptimizationResult = {
      runId: 'plan_1',
      householdId: savedHouseholdId,
      mode: 'capacity_aware',
      weeks: 4,
      assignments: [
        {
          assignmentId: 'a1',
          occurrenceId: 'occ_1',
          taskId: initialRequest.tasks[0].id,
          taskName: 'Cooking',
          category: 'Food',
          weekIndex: 0,
          dayOfWeek: 'mon',
          memberId: initialRequest.members[0].id,
          memberName: 'Maya Custom',
          durationMinutes: 30,
          effortLevel: 3,
          weightedMinutes: 36,
          reasonCodes: ['CAPACITY_MATCH']
        }
      ],
      unassignedTasks: [],
      memberSummaries: [
        {
          memberId: initialRequest.members[0].id,
          memberName: 'Maya Custom',
          role: 'Adult',
          weeklyCapacityMinutes: 400,
          assignedMinutes: 30,
          assignedWeightedLoad: 36,
          utilizationRatio: 0.075,
          taskCount: 1,
          avoidedTasksAssigned: 0,
          preferredTasksAssigned: 1,
          dailyMinutes: { mon: 30, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
          dailyWeightedLoad: { mon: 36, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 }
        }
      ],
      diagnostics: {
        totalHouseholdCapacityMinutes: 640,
        totalHouseholdWorkMinutes: 30,
        totalHouseholdWeightedWork: 36,
        targetHouseholdUtilization: 0.046,
        capacityDeficitMinutes: 0,
        utilizationSpread: 0,
        balanceScore: 98,
        hardConstraintViolations: 0,
        totalAssignments: 1,
        totalUnassigned: 0
      }
    };
    await adapter.savePlan(userIdA, savedHouseholdId, mockPlan);

    // Simulate login / refresh: loadActiveHousehold
    const loaded = await adapter.loadActiveHousehold(userIdA);
    assert.ok(loaded, 'Must load persisted household');
    assert.ok(loaded.request, 'Must reconstruct OptimizationRequest');

    const req = loaded.request;
    assert.equal(req.household.name, 'Alice Custom Manor');
    assert.equal(req.household.id, savedHouseholdId);
    assert.equal(req.household.mode, 'capacity_aware');
    assert.equal(req.household.planningHorizonWeeks, 4);

    assert.equal(req.members.length, 2);
    assert.equal(req.members[0].name, 'Maya Custom');
    assert.equal(req.members[0].weeklyCapacityMinutes, 400);
    assert.deepEqual(req.members[0].unavailableDays, ['tue', 'fri']);
    assert.deepEqual(req.members[0].preferredTaskIds, [initialRequest.tasks[0].id]);
    assert.deepEqual(req.members[0].avoidedTaskIds, [initialRequest.tasks[2].id]);

    assert.equal(req.tasks.length, 3);
    assert.equal(req.tasks[2].name, 'Bath Clean');
    assert.deepEqual(req.tasks[2].fixedDays, ['sat']);

    // Check latest plan snapshot hydration
    assert.ok(loaded.latestPlan, 'Must load latest calculated plan snapshot');
    assert.equal(loaded.latestPlan.assignments.length, 1);
    assert.equal(loaded.latestPlan.assignments[0].memberName, 'Maya Custom');
    assert.equal(loaded.latestPlan.diagnostics.balanceScore, 98);
  });

  it('Requirement 5: save updates existing configuration without duplicate households', async () => {
    const mock = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mock);

    const request = createSampleRequest();
    const initialHId = await adapter.saveHousehold(userIdA, request);

    assert.equal(mock.getRawTable('households').length, 1);

    // Modify configuration and save again
    request.household.name = 'Updated Household Name';
    request.members.push({
      id: 'm_new',
      name: 'Baby Charlie',
      role: 'Child',
      weeklyCapacityMinutes: 60,
      unavailableDays: []
    });

    const secondHId = await adapter.saveHousehold(userIdA, request);
    assert.equal(secondHId, initialHId, 'Updating must maintain the exact same household_id');

    // Verify database household count remains 1 (no duplicate households)
    const households = mock.getRawTable('households');
    assert.equal(households.length, 1, 'Must not duplicate household rows on update');
    assert.equal(households[0].name, 'Updated Household Name');

    // Verify member count updated to 3
    const members = mock.getRawTable('members');
    assert.equal(members.length, 3);
    assert.ok(members.some((m: any) => m.name === 'Baby Charlie'));
  });

  it('Requirement 6 & 8: enforces user isolation (User A vs User B data)', async () => {
    const mock = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mock);

    // User A saves custom setup
    const requestA = createSampleRequest();
    requestA.household.name = "Alice's Secret House";
    await adapter.saveHousehold(userIdA, requestA);

    // User B saves custom setup
    const requestB = createSampleRequest();
    requestB.household.name = "Bob's Hidden Loft";
    await adapter.saveHousehold(userIdB, requestB);

    // User A loads data
    const loadedA = await adapter.loadActiveHousehold(userIdA);
    assert.ok(loadedA);
    assert.equal(loadedA.request.household.name, "Alice's Secret House");

    // User B loads data
    const loadedB = await adapter.loadActiveHousehold(userIdB);
    assert.ok(loadedB);
    assert.equal(loadedB.request.household.name, "Bob's Hidden Loft");

    // Verify total rows
    const households = mock.getRawTable('households');
    assert.equal(households.length, 2);
    assert.equal(households.filter((h: any) => h.user_id === userIdA).length, 1);
    assert.equal(households.filter((h: any) => h.user_id === userIdB).length, 1);

    // Verify User A cannot see B's tasks or members
    const membersA = mock.getRawTable('members').filter((m: any) => m.user_id === userIdA);
    const membersB = mock.getRawTable('members').filter((m: any) => m.user_id === userIdB);
    assert.ok(membersA.length > 0);
    assert.ok(membersB.length > 0);
    assert.ok(membersA.every((m: any) => m.user_id === userIdA));
    assert.ok(membersB.every((m: any) => m.user_id === userIdB));
  });

  it('Requirement 7: dirty state accurately distinguishes saved from unsaved edits', () => {
    function getSnapshot(req: any) {
      return JSON.stringify({
        household: {
          name: req.household?.name || '',
          type: req.household?.type || '',
          mode: req.household?.mode || '',
          planningHorizonWeeks: req.household?.planningHorizonWeeks || 1
        },
        members: (req.members || []).map((m: any) => ({
          name: m.name,
          role: m.role,
          weeklyCapacityMinutes: m.weeklyCapacityMinutes,
          unavailableDays: (m.unavailableDays || []).slice().sort(),
          preferredTaskIds: (m.preferredTaskIds || []).slice().sort(),
          avoidedTaskIds: (m.avoidedTaskIds || []).slice().sort()
        })),
        tasks: (req.tasks || []).map((t: any) => ({
          name: t.name,
          category: t.category,
          frequencyPerWeek: t.frequencyPerWeek,
          durationMinutes: t.durationMinutes,
          effortLevel: t.effortLevel,
          fixedDays: (t.fixedDays || []).slice().sort(),
          eligibleMemberIds: (t.eligibleMemberIds || []).slice().sort()
        }))
      });
    }

    const state = createSampleRequest();
    const savedSnapshot = getSnapshot(state);

    // Initial state: not dirty
    assert.equal(getSnapshot(state) === savedSnapshot, true, 'Clean initial state must not be dirty');

    // 1. Edit member name
    state.members[0].name = 'Maya Renamed';
    assert.equal(getSnapshot(state) === savedSnapshot, false, 'Member name change must trigger dirty state');

    // Revert
    state.members[0].name = 'Maya';
    assert.equal(getSnapshot(state) === savedSnapshot, true, 'Reverting edit must clear dirty state');

    // 2. Edit weekly capacity
    state.members[1].weeklyCapacityMinutes = 500;
    assert.equal(getSnapshot(state) === savedSnapshot, false, 'Capacity change must trigger dirty state');
    state.members[1].weeklyCapacityMinutes = 240;

    // 3. Edit unavailable day
    state.members[0].unavailableDays.push('sun');
    assert.equal(getSnapshot(state) === savedSnapshot, false, 'Unavailable day edit must trigger dirty state');
    state.members[0].unavailableDays.pop();

    // 4. Edit task duration
    state.tasks[0].durationMinutes = 60;
    assert.equal(getSnapshot(state) === savedSnapshot, false, 'Task duration edit must trigger dirty state');
    state.tasks[0].durationMinutes = 30;

    // 5. Edit preferences
    state.members[0].preferredTaskIds = [];
    assert.equal(getSnapshot(state) === savedSnapshot, false, 'Preference edit must trigger dirty state');
  });

  it('Requirement 11: failed save preserves in-memory state and rejects without false success', async () => {
    const mock = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mock);

    const request = createSampleRequest();
    request.members[0].name = 'Local Unsaved Name';

    // Simulate database failure on insert/upsert
    mock.shouldFailNextOperation = 'households';

    await assert.rejects(
      async () => {
        await adapter.saveHousehold(userIdA, request);
      },
      /Simulated database failure on households/,
      'Failed save must throw an error'
    );

    // Verify in-memory state is preserved
    assert.equal(request.members[0].name, 'Local Unsaved Name', 'Local memory state must remain intact after failure');

    // Verify database has not recorded partial corrupt rows
    assert.equal(mock.getRawTable('households').length, 0);
  });

  it('Requirement 3 & 9: loadActiveHousehold returns null for first-time users without error', async () => {
    const mock = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mock);

    const result = await adapter.loadActiveHousehold('new_user_without_data');
    assert.equal(result, null, 'First-time user with no saved data must return null, not throw');
  });

  it('Requirement 1 & 14: strictly preserves member and task array ordering across save and reload', async () => {
    const mock = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mock);

    const request: OptimizationRequest = {
      household: { id: '', name: 'Ordered Home', type: 'roommates', mode: 'balanced', planningHorizonWeeks: 2 },
      members: [
        { id: 'm1', name: 'First Person (Charlie)', role: 'Roommate', weeklyCapacityMinutes: 100 },
        { id: 'm2', name: 'Second Person (Alice)', role: 'Roommate', weeklyCapacityMinutes: 150 },
        { id: 'm3', name: 'Third Person (Bob)', role: 'Roommate', weeklyCapacityMinutes: 200 }
      ],
      tasks: [
        { id: 't1', name: 'Task Z (Morning)', category: 'General', frequencyPerWeek: 1, durationMinutes: 10, effortLevel: 1, eligibleMemberIds: [] },
        { id: 't2', name: 'Task A (Noon)', category: 'General', frequencyPerWeek: 1, durationMinutes: 20, effortLevel: 2, eligibleMemberIds: [] },
        { id: 't3', name: 'Task M (Evening)', category: 'General', frequencyPerWeek: 1, durationMinutes: 30, effortLevel: 3, eligibleMemberIds: [] }
      ]
    };

    await adapter.saveHousehold(userIdA, request);
    const loaded = await adapter.loadActiveHousehold(userIdA);
    assert.ok(loaded);

    // Verify member order is preserved exactly as inserted (Charlie, Alice, Bob)
    assert.equal(loaded.request.members[0].name, 'First Person (Charlie)');
    assert.equal(loaded.request.members[1].name, 'Second Person (Alice)');
    assert.equal(loaded.request.members[2].name, 'Third Person (Bob)');

    // Verify task order is preserved exactly as inserted (Z, A, M)
    assert.equal(loaded.request.tasks[0].name, 'Task Z (Morning)');
    assert.equal(loaded.request.tasks[1].name, 'Task A (Noon)');
    assert.equal(loaded.request.tasks[2].name, 'Task M (Evening)');
  });

  it('Requirement 2, 7 & 13: app.html contains Save Changes button, dirty state indicators, and preferences UI', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const appHtmlPath = path.resolve('app.html');
    const content = fs.readFileSync(appHtmlPath, 'utf8');

    // Save Changes button
    assert.ok(content.includes('id="btnSave"'), 'app.html must contain #btnSave button');
    assert.ok(content.includes('Save Changes'), 'app.html must contain "Save Changes" text');

    // Status & dirty indicators
    assert.ok(content.includes('id="unsavedIndicator"'), 'app.html must contain #unsavedIndicator');
    assert.ok(content.includes('id="saveStatusIndicator"'), 'app.html must contain #saveStatusIndicator');
    assert.ok(content.includes('Changes saved.'), 'app.html must contain "Changes saved." confirmation');

    // Preferred / Avoided task selectors
    assert.ok(content.includes('data-field="preferredTaskId"'), 'app.html must support preferredTaskId');
    assert.ok(content.includes('data-field="avoidedTaskId"'), 'app.html must support avoidedTaskId');

    // Layout controls
    assert.ok(content.includes('id="btnPresetFamily"'), 'app.html must contain Family preset');
    assert.ok(content.includes('id="btnPresetCouple"'), 'app.html must contain Couple preset');
    assert.ok(content.includes('id="btnPresetRoommates"'), 'app.html must contain Roommates preset');
    assert.ok(content.includes('id="btnRebalance"'), 'app.html must contain Rebalance button');
    assert.ok(content.includes('id="btnOptimize"'), 'app.html must contain Calculate Plan button');
  });

  it('Requirement 3, 8 & 11: app.html separates Calculate from Save and prevents silent preset overwrite', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const appHtmlPath = path.resolve('app.html');
    const content = fs.readFileSync(appHtmlPath, 'utf8');

    // Calculate Plan must NOT silently auto-save to cloud
    assert.ok(!content.includes('persistToCloudIfAuthed();'), 'app.html must NOT contain silent auto-save persistToCloudIfAuthed');

    // Must distinguish load failure from no saved data
    assert.ok(content.includes('Cloud load failed') || content.includes('Unable to load your saved cloud household'), 'app.html must display cloud load failure notice');
    assert.ok(content.includes('btnRetryLoad'), 'app.html must provide a Retry Load button');

    // Must handle beforeunload with unsaved changes
    assert.ok(content.includes('beforeunload'), 'app.html must register beforeunload listener for unsaved changes');
  });
});

describe('Production Regression: Non-Null Plans Columns & Household Lifecycle (Requirements A - F)', () => {
  const userId = '00000000-0000-0000-0000-000000000001';

  function createTestRequest(): OptimizationRequest {
    return {
      household: {
        id: 'h_test',
        name: 'The Pearson Household',
        type: 'family',
        mode: 'capacity_aware',
        planningHorizonWeeks: 2
      },
      members: [
        {
          id: 'm1',
          name: 'Jack',
          role: 'Adult',
          weeklyCapacityMinutes: 300,
          unavailableDays: ['wed'],
          preferredTaskIds: ['t1'],
          avoidedTaskIds: ['t2']
        },
        {
          id: 'm2',
          name: 'Rebecca',
          role: 'Adult',
          weeklyCapacityMinutes: 300,
          unavailableDays: [],
          preferredTaskIds: ['t2'],
          avoidedTaskIds: []
        }
      ],
      tasks: [
        {
          id: 't1',
          name: 'Prepare Dinner',
          category: 'Food',
          frequencyPerWeek: 7,
          durationMinutes: 30, // 7 * 30 = 210 min/week
          effortLevel: 3,
          eligibleMemberIds: ['m1', 'm2']
        },
        {
          id: 't2',
          name: 'Wash Dishes',
          category: 'Kitchen',
          frequencyPerWeek: 7,
          durationMinutes: 20, // 7 * 20 = 140 min/week
          effortLevel: 2,
          eligibleMemberIds: ['m1', 'm2']
        }
      ]
    };
  }

  it('Test A: save household before calculating a plan persists configuration without inserting invalid plans row', async () => {
    const mockClient = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mockClient);
    const request = createTestRequest();

    // User edits household and clicks "Save Changes" BEFORE calculating a plan (currentResult is null)
    const householdId = await adapter.saveHousehold(userId, request, null);
    assert.ok(householdId, 'Must return saved household UUID');

    // Households, members, tasks, and preferences must be persisted
    const households = mockClient.getTable('households');
    assert.equal(households.length, 1);
    assert.equal(households[0].name, 'The Pearson Household');
    assert.equal(households[0].user_id, userId);

    const members = mockClient.getTable('members');
    assert.equal(members.length, 2);
    assert.equal(members[0].name, 'Jack');
    assert.equal(members[1].name, 'Rebecca');

    const tasks = mockClient.getTable('tasks');
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].name, 'Prepare Dinner');
    assert.equal(tasks[1].name, 'Wash Dishes');

    // Plans table must have 0 rows — no invalid plan insert was attempted
    const plans = mockClient.getTable('plans');
    assert.equal(plans.length, 0, 'Plans table must have 0 rows when saving before calculating a plan');
  });

  it('Test B: save household after calculating a plan persists household and valid plan snapshot', async () => {
    const mockClient = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mockClient);
    const request = createTestRequest();

    // User calculates a plan using optimizer
    const planResult = runOptimization(request);
    assert.ok(planResult);
    assert.ok(planResult.assignments.length > 0);
    assert.equal(typeof planResult.diagnostics.totalHouseholdWorkMinutes, 'number');

    // Save household with calculated plan
    const householdId = await adapter.saveHousehold(userId, request, planResult);
    assert.ok(householdId);

    // Plans table must have exactly 1 row
    const plans = mockClient.getTable('plans');
    assert.equal(plans.length, 1, 'Plans table must contain the saved plan snapshot');
    const savedPlan = plans[0];
    assert.equal(savedPlan.household_id, householdId);
    assert.equal(savedPlan.user_id, userId);
    assert.equal(savedPlan.total_work_minutes, planResult.diagnostics.totalHouseholdWorkMinutes);
    assert.equal(savedPlan.total_capacity_minutes, planResult.diagnostics.totalHouseholdCapacityMinutes);
    assert.equal(savedPlan.balance_score, planResult.diagnostics.balanceScore);
  });

  it('Test C: refresh restores saved configuration (both with and without prior plan)', async () => {
    const mockClient = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mockClient);
    const request = createTestRequest();

    // Step 1: Save before plan
    await adapter.saveHousehold(userId, request, null);

    // Simulate browser refresh
    const refreshedBeforePlan = await adapter.loadActiveHousehold(userId);
    assert.ok(refreshedBeforePlan);
    assert.equal(refreshedBeforePlan.request.household.name, 'The Pearson Household');
    assert.equal(refreshedBeforePlan.request.members.length, 2);
    assert.equal(refreshedBeforePlan.latestPlan, null, 'latestPlan should be null before plan calculation');

    // Step 2: Calculate plan and save
    const planResult = runOptimization(refreshedBeforePlan.request);
    await adapter.saveHousehold(userId, refreshedBeforePlan.request, planResult);

    // Simulate second browser refresh
    const refreshedAfterPlan = await adapter.loadActiveHousehold(userId);
    assert.ok(refreshedAfterPlan);
    assert.equal(refreshedAfterPlan.request.household.name, 'The Pearson Household');
    assert.ok(refreshedAfterPlan.latestPlan, 'latestPlan must be restored after plan calculation');
    assert.equal(
      refreshedAfterPlan.latestPlan.diagnostics.totalHouseholdWorkMinutes,
      planResult.diagnostics.totalHouseholdWorkMinutes
    );
    assert.equal(refreshedAfterPlan.latestPlan.assignments.length, planResult.assignments.length);
  });

  it('Test D: logout/login restores saved configuration instead of resetting to default', async () => {
    const mockClient = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mockClient);
    const request = createTestRequest();
    request.household.name = 'Custom Preserved Castle';
    request.members[0].name = 'Master Cook';
    request.members[0].weeklyCapacityMinutes = 450;

    await adapter.saveHousehold(userId, request, null);

    // Simulate user logging out (session destroyed in memory)
    let inMemorySession: any = null;
    assert.equal(inMemorySession, null);

    // Simulate user logging back in with fresh adapter / session
    const freshAdapter = new SupabaseAdapter(mockClient);
    inMemorySession = { userId };

    const restored = await freshAdapter.loadActiveHousehold(inMemorySession.userId);
    assert.ok(restored, 'Restored data must exist for logged-in user');
    assert.equal(restored.request.household.name, 'Custom Preserved Castle');
    assert.equal(restored.request.members[0].name, 'Master Cook');
    assert.equal(restored.request.members[0].weeklyCapacityMinutes, 450);
  });

  it('Test E: calculated plan snapshot contains correct, non-faked total_work_minutes matching optimizer diagnostics', async () => {
    const mockClient = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mockClient);
    const request = createTestRequest();

    // 7 * 30 min (Prepare Dinner) + 7 * 20 min (Wash Dishes) = 210 + 140 = 350 min/week
    // Multiplied by planningHorizonWeeks (2) = 700 total household work minutes
    const expectedWeeklyWorkMinutes = (7 * 30) + (7 * 20); // 350
    const expectedHorizonWorkMinutes = expectedWeeklyWorkMinutes * request.household.planningHorizonWeeks; // 700
    const expectedHorizonCapacityMinutes = (300 + 300) * request.household.planningHorizonWeeks; // 1200

    const planResult = runOptimization(request);
    assert.equal(planResult.diagnostics.totalHouseholdWorkMinutes, expectedHorizonWorkMinutes);
    assert.equal(planResult.diagnostics.totalHouseholdCapacityMinutes, expectedHorizonCapacityMinutes);
    assert.ok(expectedHorizonWorkMinutes > 0, 'Work minutes must be a genuine non-zero derived value');

    await adapter.saveHousehold(userId, request, planResult);

    const plans = mockClient.getTable('plans');
    assert.equal(plans.length, 1);
    const savedPlan = plans[0];

    assert.equal(savedPlan.total_work_minutes, expectedHorizonWorkMinutes, 'total_work_minutes must match expected calculation');
    assert.equal(savedPlan.total_capacity_minutes, expectedHorizonCapacityMinutes, 'total_capacity_minutes must match members sum * horizon');
    assert.equal(typeof savedPlan.balance_score, 'number');
    assert.ok(savedPlan.balance_score > 0);
  });

  it('Test F: no NULL is sent to any NOT NULL plans column and invalid plans are rejected', async () => {
    const mockClient = new MockSupabaseClient();
    const adapter = new SupabaseAdapter(mockClient);
    const request = createTestRequest();
    const planResult = runOptimization(request);

    const householdId = await adapter.saveHousehold(userId, request, planResult);

    const plans = mockClient.getTable('plans');
    assert.equal(plans.length, 1);
    const row = plans[0];

    // Check all NOT NULL columns according to supabase/migrations/01_initial_schema.sql
    const notNullCols = [
      'household_id',
      'user_id',
      'optimizer_version',
      'balance_score',
      'total_work_minutes',
      'total_capacity_minutes',
      'diagnostics',
      'member_summaries',
      'unassigned_tasks',
      'assignments',
      'diff_summary'
    ];

    for (const col of notNullCols) {
      assert.notEqual(row[col], null, `Column '${col}' must not be null`);
      assert.notEqual(row[col], undefined, `Column '${col}' must not be undefined`);
      if (typeof row[col] === 'number') {
        assert.ok(!Number.isNaN(row[col]), `Column '${col}' must not be NaN`);
      }
    }

    // Verify isValidPlanSnapshot rejects invalid or incomplete plans
    assert.equal(isValidPlanSnapshot(null), false);
    assert.equal(isValidPlanSnapshot(undefined), false);
    assert.equal(isValidPlanSnapshot({} as any), false);
    assert.equal(isValidPlanSnapshot({ assignments: [], diagnostics: {} } as any), false);
    assert.equal(
      isValidPlanSnapshot({
        assignments: [{ taskId: 't1', memberId: 'm1' }],
        diagnostics: { totalHouseholdWorkMinutes: null, totalHouseholdCapacityMinutes: 600, balanceScore: 90 }
      } as any),
      false
    );

    // Verify adapter.savePlan directly rejects plans missing required metrics
    await assert.rejects(
      async () => {
        await adapter.savePlan(userId, householdId, {
          runId: 'invalid',
          householdId,
          mode: 'capacity_aware',
          weeks: 2,
          assignments: [],
          unassignedTasks: [],
          memberSummaries: [],
          diagnostics: {
            totalHouseholdWorkMinutes: null as any,
            totalHouseholdCapacityMinutes: 600,
            balanceScore: 90
          } as any
        });
      },
      /Cannot persist plan snapshot: missing required non-null plan metrics/
    );
  });
});
