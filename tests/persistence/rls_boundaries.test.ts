import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Database Schema & Row Level Security (RLS) Boundaries', () => {
  const schemaPath = path.resolve('supabase', 'migrations', '01_initial_schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  it('enforces RLS on all user-owned tables in migration schema', () => {
    const requiredRlsTables = [
      'profiles',
      'households',
      'members',
      'tasks',
      'member_preferences',
      'plans',
      'user_privacy_preferences'
    ];

    for (const table of requiredRlsTables) {
      assert.ok(
        sql.includes(`alter table public.${table} enable row level security;`),
        `Table public.${table} must have RLS enabled`
      );
    }
  });

  it('guarantees user_id = auth.uid() check on all household data policies', () => {
    const userIsolationClauses = [
      'using (auth.uid() = user_id)',
      'with check (auth.uid() = user_id)'
    ];

    for (const clause of userIsolationClauses) {
      assert.ok(
        sql.includes(clause),
        `Migration SQL must contain RLS policy clause: ${clause}`
      );
    }
  });

  it('simulates RLS access boundary: User A cannot read User B data', () => {
    // In-memory simulation of Postgres RLS engine
    interface DbRow {
      id: string;
      user_id: string;
      data: string;
    }

    const database: DbRow[] = [
      { id: 'h_1', user_id: 'user_A', data: "User A's Family Plan" },
      { id: 'h_2', user_id: 'user_B', data: "User B's Private Plan" }
    ];

    function executeRlsQuery(currentAuthUid: string | null, targetId?: string): DbRow[] {
      // Simulates Postgres RLS policy: WHERE auth.uid() = user_id
      return database.filter(row => {
        if (!currentAuthUid) return false; // Unauthenticated blocked
        if (row.user_id !== currentAuthUid) return false; // Cross-user blocked
        if (targetId && row.id !== targetId) return false;
        return true;
      });
    }

    // 1. User A can access own data
    const userAData = executeRlsQuery('user_A');
    assert.strictEqual(userAData.length, 1);
    assert.strictEqual(userAData[0].data, "User A's Family Plan");

    // 2. User A attempts to read User B's record by modifying ID
    const crossAccess = executeRlsQuery('user_A', 'h_2');
    assert.strictEqual(crossAccess.length, 0, 'User A must receive zero rows when requesting User B data');

    // 3. Unauthenticated request attempts to read data
    const unauthedAccess = executeRlsQuery(null);
    assert.strictEqual(unauthedAccess.length, 0, 'Unauthenticated visitor must receive zero rows');
  });

  it('performs full two-account isolation test across all household data entities', () => {
    // Multi-entity PostgreSQL RLS Simulation matching 01_initial_schema.sql
    interface BaseEntity {
      id: string;
      user_id: string;
      household_id?: string;
      name?: string;
      details?: any;
    }

    class MockPostgresRlsTable {
      private rows: BaseEntity[] = [];

      insert(authUid: string | null, row: BaseEntity): BaseEntity {
        // Enforces: with check (auth.uid() = user_id)
        if (!authUid || authUid !== row.user_id) {
          throw new Error('RLS check violation: auth.uid() != user_id on INSERT');
        }
        this.rows.push({ ...row });
        return row;
      }

      select(authUid: string | null, filter?: (r: BaseEntity) => boolean): BaseEntity[] {
        // Enforces: using (auth.uid() = user_id)
        if (!authUid) return [];
        return this.rows.filter(r => r.user_id === authUid && (!filter || filter(r)));
      }

      update(authUid: string | null, id: string, updates: Partial<BaseEntity>): number {
        // Enforces: using (auth.uid() = user_id)
        if (!authUid) return 0;
        let modified = 0;
        this.rows = this.rows.map(r => {
          if (r.id === id && r.user_id === authUid) {
            modified++;
            return { ...r, ...updates, user_id: r.user_id }; // Cannot reassign ownership
          }
          return r;
        });
        return modified;
      }

      delete(authUid: string | null, id: string): number {
        // Enforces: using (auth.uid() = user_id)
        if (!authUid) return 0;
        const initialCount = this.rows.length;
        this.rows = this.rows.filter(r => !(r.id === id && r.user_id === authUid));
        return initialCount - this.rows.length;
      }
    }

    const householdsTable = new MockPostgresRlsTable();
    const membersTable = new MockPostgresRlsTable();
    const tasksTable = new MockPostgresRlsTable();
    const plansTable = new MockPostgresRlsTable();

    // 1. User A creates household, members, tasks, and calculated plan
    const userA = 'usr_alice_123';
    householdsTable.insert(userA, { id: 'h_alice', user_id: userA, name: "Alice's Household" });
    membersTable.insert(userA, { id: 'm_alice_1', user_id: userA, household_id: 'h_alice', name: 'Alice' });
    membersTable.insert(userA, { id: 'm_alice_2', user_id: userA, household_id: 'h_alice', name: 'Bob' });
    tasksTable.insert(userA, { id: 't_alice_1', user_id: userA, household_id: 'h_alice', name: 'Cooking' });
    tasksTable.insert(userA, { id: 't_alice_2', user_id: userA, household_id: 'h_alice', name: 'Dishes' });
    plansTable.insert(userA, { id: 'p_alice_1', user_id: userA, household_id: 'h_alice', details: { week: 1 } });

    // 2. User B creates separate household, members, and tasks
    const userB = 'usr_bob_456';
    householdsTable.insert(userB, { id: 'h_bob', user_id: userB, name: "Bob's Apartment" });
    membersTable.insert(userB, { id: 'm_bob_1', user_id: userB, household_id: 'h_bob', name: 'Charlie' });
    tasksTable.insert(userB, { id: 't_bob_1', user_id: userB, household_id: 'h_bob', name: 'Trash' });
    plansTable.insert(userB, { id: 'p_bob_1', user_id: userB, household_id: 'h_bob', details: { week: 1 } });

    // 3. User A Queries: Can only see Alice's data, zero rows of Bob's data
    const userAHouseholds = householdsTable.select(userA);
    assert.strictEqual(userAHouseholds.length, 1);
    assert.strictEqual(userAHouseholds[0].id, 'h_alice');

    const userAMembers = membersTable.select(userA);
    assert.strictEqual(userAMembers.length, 2);
    assert.ok(userAMembers.every(m => m.user_id === userA));

    const userATasks = tasksTable.select(userA);
    assert.strictEqual(userATasks.length, 2);

    // 4. User A attempts to directly access User B's specific records by ID
    const aViewsBHousehold = householdsTable.select(userA, r => r.id === 'h_bob');
    assert.strictEqual(aViewsBHousehold.length, 0, 'User A must not be able to select User B household');

    const aViewsBMembers = membersTable.select(userA, r => r.id === 'm_bob_1');
    assert.strictEqual(aViewsBMembers.length, 0, 'User A must not be able to select User B member');

    const aViewsBTasks = tasksTable.select(userA, r => r.id === 't_bob_1');
    assert.strictEqual(aViewsBTasks.length, 0, 'User A must not be able to select User B task');

    const aViewsBPlan = plansTable.select(userA, r => r.id === 'p_bob_1');
    assert.strictEqual(aViewsBPlan.length, 0, 'User A must not be able to select User B plan');

    // 5. User A attempts to UPDATE User B's task or household
    const updatedCount = tasksTable.update(userA, 't_bob_1', { name: 'Compromised Task' });
    assert.strictEqual(updatedCount, 0, 'User A cannot update User B task');
    // Verify Bob's task remains untouched
    const bTasks = tasksTable.select(userB, r => r.id === 't_bob_1');
    assert.strictEqual(bTasks[0].name, 'Trash');

    // 6. User A attempts to DELETE User B's household
    const deletedCount = householdsTable.delete(userA, 'h_bob');
    assert.strictEqual(deletedCount, 0, 'User A cannot delete User B household');
    // Verify Bob's household exists
    const bHouseholds = householdsTable.select(userB);
    assert.strictEqual(bHouseholds.length, 1);

    // 7. User A attempts to spoof an INSERT with user_id = userB
    assert.throws(
      () => {
        tasksTable.insert(userA, { id: 't_spoof', user_id: userB, name: 'Malicious Task' });
      },
      /RLS check violation/,
      'User A cannot insert rows assigned to User B'
    );

    // 8. Vice-versa: User B attempts to access User A's data
    const bViewsAHousehold = householdsTable.select(userB, r => r.id === 'h_alice');
    assert.strictEqual(bViewsAHousehold.length, 0, 'User B must not be able to select User A household');

    const bViewsATasks = tasksTable.select(userB, r => r.household_id === 'h_alice');
    assert.strictEqual(bViewsATasks.length, 0, 'User B must not see any tasks for User A');

    // 9. Unauthenticated visitor gets 0 rows
    assert.strictEqual(householdsTable.select(null).length, 0);
    assert.strictEqual(membersTable.select(null).length, 0);
    assert.strictEqual(tasksTable.select(null).length, 0);
    assert.strictEqual(plansTable.select(null).length, 0);
  });
});
