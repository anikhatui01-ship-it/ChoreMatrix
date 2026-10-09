import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOptimization } from '../../src/optimizer/engine.ts';
import { coupleHouseholdFixture } from './fixtures.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 1: First-Time User Experience Tests', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
  const appHtml = fs.readFileSync(path.join(rootDir, 'app.html'), 'utf-8');

  it('1. Empty state container exists and provides welcoming guidance without 0-value metric wall', () => {
    assert.ok(indexHtml.includes('id="emptyStateContainer"'), 'index.html must have empty state container');
    assert.ok(indexHtml.includes('Try a sample household (Couple)'), 'index.html must have sample household button');
    assert.ok(indexHtml.includes('Ready to balance your household workload?'), 'index.html must explain how to use the calculator');

    assert.ok(appHtml.includes('id="emptyStateContainer"'), 'app.html must have empty state container');
    assert.ok(appHtml.includes('Try a sample household (Couple)'), 'app.html must have sample household button');
  });

  it('2. Calculate Plan is dominant primary action and disabled when inputs are empty', () => {
    assert.ok(indexHtml.includes('id="btnOptimize"') && indexHtml.includes('class="btn primary"') && indexHtml.includes('disabled>Calculate Plan</button>'), 'btnOptimize in index.html must be primary and disabled initially');
    assert.ok(appHtml.includes('id="btnOptimize"') && appHtml.includes('class="btn primary"') && appHtml.includes('disabled>Calculate Plan</button>'), 'btnOptimize in app.html must be primary and disabled initially');
  });

  it('3. Rebalance is secondary action and disabled initially', () => {
    assert.ok(indexHtml.includes('id="btnRebalance"') && indexHtml.includes('disabled>Rebalance</button>'), 'btnRebalance in index.html must be disabled initially');
    assert.ok(appHtml.includes('id="btnRebalance"') && appHtml.includes('disabled>Rebalance</button>'), 'btnRebalance in app.html must be disabled initially');
  });

  it('4. Preset controls exist as secondary sample actions with Couple preset prominently featured', () => {
    assert.ok(indexHtml.includes('id="btnPresetCouple"'), 'Couple preset button exists in index.html');
    assert.ok(indexHtml.includes('id="btnTrySample"'), 'Try sample button exists in index.html');
    assert.ok(appHtml.includes('id="btnPresetCouple"'), 'Couple preset button exists in app.html');
    assert.ok(appHtml.includes('id="btnTrySample"'), 'Try sample button exists in app.html');
  });

  it('5. Post-plan banner provides clear next step after plan is generated', () => {
    assert.ok(indexHtml.includes('id="postPlanBanner"'), 'index.html contains post-plan banner');
    assert.ok(indexHtml.includes('Household Plan Calculated'), 'index.html states plan calculated');
    assert.ok(indexHtml.includes('href="/signup.html"'), 'index.html links to signup for saving plan');

    assert.ok(appHtml.includes('id="postPlanBanner"'), 'app.html contains post-plan banner');
    assert.ok(appHtml.includes('id="btnPostPlanSave"'), 'app.html provides functional save action');
  });

  it('6. Couple preset calculates real fairness score and allocation without fabricated data', () => {
    const result = runOptimization(coupleHouseholdFixture);
    assert.ok(result.diagnostics.balanceScore > 0, 'Couple preset produces real non-zero fairness score');
    assert.ok(result.assignments.length > 0, 'Couple preset produces non-empty assignments');
    assert.equal(result.diagnostics.totalUnassigned, 0, 'Couple preset should achieve 0 unassigned tasks');
  });

  it('7. Preserves single H1 and child privacy guidance invariants', () => {
    const indexH1Matches = indexHtml.match(/<h1[\s>]/g) || [];
    const appH1Matches = appHtml.match(/<h1[\s>]/g) || [];
    assert.equal(indexH1Matches.length, 1, 'index.html must have exactly one H1');
    assert.equal(appH1Matches.length, 1, 'app.html must have exactly one H1');

    assert.ok(indexHtml.includes('Child Privacy Guidance'), 'index.html preserves child privacy notice');
    assert.ok(appHtml.includes('Child Privacy Guidance'), 'app.html preserves child privacy notice');
  });
});
