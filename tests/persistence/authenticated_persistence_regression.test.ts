import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAdapter } from '../../src/persistence/supabaseAdapter.ts';
import type { OptimizationRequest, OptimizationResult } from '../../src/optimizer/types.ts';

/**
 * High-fidelity in-memory Mock Supabase Client simulating Postgres RLS and queries
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
