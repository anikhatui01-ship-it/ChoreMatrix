import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  saveLocalDraft,
  loadLocalDraft,
  clearLocalDraft,
  isValidOptimizationRequest,
  DRAFT_STORAGE_KEY
} from '../../src/persistence/localDraft.ts';
import type { OptimizationRequest, OptimizationResult } from '../../src/optimizer/types.ts';

// Mock localStorage for node test environment
class MockLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// Attach mock localStorage to global if undefined
if (typeof (globalThis as any).localStorage === 'undefined') {
  (globalThis as any).localStorage = new MockLocalStorage();
}

describe('Phase 5 — Retention and Practical Plan Use', () => {
  const sampleRequest: OptimizationRequest = {
    household: {
      id: 'h_test',
      name: 'Sample Household',
      type: 'couple',
      mode: 'capacity_aware',
      planningHorizonWeeks: 1
    },
    members: [
      {
        id: 'm1',
        name: 'Alex',
        role: 'Adult',
        weeklyCapacityMinutes: 240,
        unavailableDays: ['wed'],
        preferredTaskIds: ['t1'],
        avoidedTaskIds: []
      },
      {
        id: 'm2',
        name: 'Sam',
        role: 'Adult',
        weeklyCapacityMinutes: 240,
        unavailableDays: [],
        preferredTaskIds: [],
        avoidedTaskIds: []
      }
    ],
    tasks: [
      {
        id: 't1',
        name: 'Dinner Cooking',
        category: 'Food',
        frequencyPerWeek: 7,
        durationMinutes: 30,
        effortLevel: 3,
        eligibleMemberIds: ['m1', 'm2']
      }
    ]
  };

  const sampleResult: OptimizationResult = {
    assignments: [
      {
        id: 'a1',
        taskId: 't1',
        taskName: 'Dinner Cooking',
        category: 'Food',
        memberId: 'm1',
        memberName: 'Alex',
        dayOfWeek: 'mon',
        weekIndex: 0,
        durationMinutes: 30,
        effortLevel: 3,
        reasonCodes: ['preferred_task_match']
      }
    ],
    unassignedTasks: [],
    memberSummaries: [
      {
        memberId: 'm1',
        memberName: 'Alex',
        role: 'Adult',
        capacityMinutes: 240,
        assignedMinutes: 210,
        assignedCount: 7,
        utilizationRatio: 0.875,
        weightedEffort: 21
      }
    ],
    diagnostics: {
      balanceScore: 92,
      giniCoefficient: 0.08,
      maxDisparityRatio: 1.1,
      totalHouseholdCapacityMinutes: 480,
      totalHouseholdWorkMinutes: 210,
      totalHouseholdWeightedWork: 21,
      mode: 'capacity_aware',
      unassignedCount: 0
    },
    fairnessIndex: 92,
    mode: 'capacity_aware',
    weeks: 1,
    solverStatus: 'optimal'
  };

  describe('Local Draft Persistence & Schema Validation', () => {
    it('saves and loads a valid local draft accurately', () => {
      clearLocalDraft();
      const saved = saveLocalDraft(sampleRequest, sampleResult);
      assert.strictEqual(saved, true);

      const loaded = loadLocalDraft();
      assert.ok(loaded);
      assert.strictEqual(loaded.request.household.name, 'Sample Household');
      assert.strictEqual(loaded.request.members.length, 2);
      assert.strictEqual(loaded.request.tasks.length, 1);
      assert.ok(loaded.result);
      assert.strictEqual(loaded.result.fairnessIndex, 92);
      assert.strictEqual(loaded.result.assignments.length, 1);
    });

    it('sanitizes non-numeric and negative values safely upon saving and loading', () => {
      clearLocalDraft();
      const dirtyRequest: any = {
        household: { id: 'h1', name: 'Dirty Household', type: 'family', mode: 'invalid_mode', planningHorizonWeeks: 'invalid' },
        members: [
          { id: 'm1', name: 'Member 1', role: 'Adult', weeklyCapacityMinutes: -50, unavailableDays: ['mon', 'invalid_day'] }
        ],
        tasks: [
          { id: 't1', name: 'Task 1', category: 'Kitchen', frequencyPerWeek: 0, durationMinutes: -10, effortLevel: 99, eligibleMemberIds: ['m1'] }
        ]
      };

      saveLocalDraft(dirtyRequest);
      const loaded = loadLocalDraft();
      assert.ok(loaded);
      // Mode normalized
      assert.strictEqual(loaded.request.household.mode, 'capacity_aware');
      // Planning horizon clamped to 1
      assert.strictEqual(loaded.request.household.planningHorizonWeeks, 1);
      // Capacity normalized to positive number >= 1
      assert.strictEqual(loaded.request.members[0].weeklyCapacityMinutes, 1);
      // Unavailable day filtered to valid days
      assert.deepStrictEqual(loaded.request.members[0].unavailableDays, ['mon']);
      // Frequency clamped >= 1
      assert.strictEqual(loaded.request.tasks[0].frequencyPerWeek, 1);
      // Duration clamped >= 1
      assert.strictEqual(loaded.request.tasks[0].durationMinutes, 1);
      // Effort level clamped between 1 and 5
      assert.strictEqual(loaded.request.tasks[0].effortLevel, 5);
    });

    it('gracefully handles corrupted JSON in localStorage without throwing', () => {
      localStorage.setItem(DRAFT_STORAGE_KEY, 'corrupted JSON string {');
      const loaded = loadLocalDraft();
      assert.strictEqual(loaded, null);
    });

    it('gracefully clears local draft', () => {
      saveLocalDraft(sampleRequest);
      assert.ok(loadLocalDraft());
      clearLocalDraft();
      assert.strictEqual(loadLocalDraft(), null);
    });

    it('validates optimization request structures correctly', () => {
      assert.strictEqual(isValidOptimizationRequest(sampleRequest), true);
      assert.strictEqual(isValidOptimizationRequest(null), false);
      assert.strictEqual(isValidOptimizationRequest({}), false);
      assert.strictEqual(isValidOptimizationRequest({ household: {}, members: 'invalid', tasks: [] }), false);
    });
  });

  describe('Print & PDF Stylesheet Inspection', () => {
    const cssPath = path.join(process.cwd(), 'src/styles/common.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    it('contains a dedicated @media print block', () => {
      assert.ok(cssContent.includes('@media print'), 'common.css must define @media print rules');
    });

    it('hides interactive navigation, ads, editing panels, and buttons during print', () => {
      const printBlock = cssContent.slice(cssContent.indexOf('@media print'));
      assert.ok(printBlock.includes('#globalNavbar'));
      assert.ok(printBlock.includes('#globalFooter'));
      assert.ok(printBlock.includes('#cookieBannerContainer'));
      assert.ok(printBlock.includes('.no-print') || printBlock.includes('.site-nav'));
      assert.ok(printBlock.includes('#btnPrintPlan'));
      assert.ok(printBlock.includes('#btnOptimize'));
      assert.ok(printBlock.includes('#btnSave'));
      assert.ok(printBlock.includes('display: none !important'));
    });

    it('ensures clean full-width layout and avoids awkward page breaks on print', () => {
      const printBlock = cssContent.slice(cssContent.indexOf('@media print'));
      assert.ok(printBlock.includes('page-break-inside: avoid') || printBlock.includes('break-inside: avoid'));
      assert.ok(printBlock.includes('print-color-adjust: exact') || printBlock.includes('-webkit-print-color-adjust: exact'));
    });
  });

  describe('HTML Interface & Print Actions', () => {
    const indexPath = path.join(process.cwd(), 'index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const appPath = path.join(process.cwd(), 'app.html');
    const appContent = fs.readFileSync(appPath, 'utf8');

    it('index.html contains #btnPrintPlan button and draft status indicator', () => {
      assert.ok(indexContent.includes('id="btnPrintPlan"'), 'index.html should have #btnPrintPlan');
      assert.ok(indexContent.includes('id="draftStatusBadge"'), 'index.html should have #draftStatusBadge');
      assert.ok(indexContent.includes('id="btnClearDraft"'), 'index.html should have #btnClearDraft');
      assert.ok(indexContent.includes('loadLocalDraft'), 'index.html should import/call loadLocalDraft');
      assert.ok(indexContent.includes('saveLocalDraft'), 'index.html should import/call saveLocalDraft');
    });

    it('app.html contains #btnPrintPlan button and draft restoration for unauthenticated visitors', () => {
      assert.ok(appContent.includes('id="btnPrintPlan"'), 'app.html should have #btnPrintPlan');
      assert.ok(appContent.includes('loadLocalDraft'), 'app.html should import/call loadLocalDraft');
      assert.ok(appContent.includes('saveLocalDraft'), 'app.html should import/call saveLocalDraft');
    });

    it('preserves hero headline and differentiates local drafts from authenticated cloud households', () => {
      assert.ok(
        indexContent.includes('Stop arguing over who does what.') &&
        indexContent.includes('Let our household workload optimizer calculate the plan.')
      );
      assert.ok(appContent.includes('Mode: Local Browser Storage'));
      assert.ok(appContent.includes('Cloud Sync:'));
    });
  });
});
