import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 2: Outcome-Led Positioning and Product Differentiation Tests', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
  const appHtml = fs.readFileSync(path.join(rootDir, 'app.html'), 'utf-8');

  it('1. Hero headline leads with outcome rather than technical jargon', () => {
    assert.ok(
      indexHtml.includes('A chore plan your household can actually agree on.'),
      'Homepage hero must contain the outcome-led headline'
    );
    assert.ok(
      indexHtml.includes('Turn your chores, household members, available time, and task effort into a practical household workload plan.'),
      'Homepage hero supporting copy must clearly state the outcome'
    );
  });

  it('2. Primary CTA directs user directly to building their household plan', () => {
    assert.ok(
      indexHtml.includes('id="btnHeroCta"') && indexHtml.includes('Build your household plan'),
      'Homepage must have prominent primary CTA "Build your household plan"'
    );
    assert.ok(
      indexHtml.includes('href="#calculatorArea"'),
      'Primary CTA must anchor directly to the calculator work area'
    );
    assert.ok(
      indexHtml.includes('id="calculatorArea"'),
      'Calculator area must have corresponding anchor ID'
    );
  });

  it('3. Three core product differentiators are clearly explained', () => {
    assert.ok(indexHtml.includes('id="differentiators"'), 'Differentiators section must exist');
    assert.ok(
      indexHtml.includes('Why ChoreMatrix is Different from a Basic Chore Chart'),
      'Differentiator section must have clear heading'
    );

    // Differentiator 1: Quantified Fairness Index
    assert.ok(
      indexHtml.includes('Quantified Fairness Index') && indexHtml.includes('0–100 mathematical score'),
      'Must explain the 0-100 fairness score'
    );
    assert.ok(
      indexHtml.includes('not subjective emotional satisfaction'),
      'Must clearly bound what the fairness index does and does not measure'
    );

    // Differentiator 2: Two Workload Modes
    assert.ok(
      indexHtml.includes('Two Workload Modes') && indexHtml.includes('Capacity-Aware (Proportional)') && indexHtml.includes('Equal Workload (Flatten Minutes)'),
      'Must explain both Capacity-Aware and Equal Workload modes'
    );

    // Differentiator 3: Transparent Assignment Explanations
    assert.ok(
      indexHtml.includes('Explainable Assignments') && indexHtml.includes('only eligible member'),
      'Must explain transparent reason codes for task assignments'
    );
  });

  it('4. Optimization mode selector provides inline explanatory guidance', () => {
    assert.ok(indexHtml.includes('id="modeExplanation"'), 'index.html must have modeExplanation container');
    assert.ok(appHtml.includes('id="modeExplanation"'), 'app.html must have modeExplanation container');
  });

  it('5. Results diagnostics clearly contextualize fairness score interpretation', () => {
    assert.ok(indexHtml.includes('100 = balanced workload distribution'), 'index.html must explain fairness score scale');
    assert.ok(appHtml.includes('100 = balanced workload distribution'), 'app.html must explain fairness score scale');
  });

  it('6. Preserves exactly one single H1 per page and child privacy notice', () => {
    const indexH1Matches = indexHtml.match(/<h1[\s>]/g) || [];
    const appH1Matches = appHtml.match(/<h1[\s>]/g) || [];
    assert.equal(indexH1Matches.length, 1, 'index.html must have exactly one H1');
    assert.equal(appH1Matches.length, 1, 'app.html must have exactly one H1');

    assert.ok(indexHtml.includes('Child Privacy Guidance'), 'index.html preserves child privacy notice');
    assert.ok(appHtml.includes('Child Privacy Guidance'), 'app.html preserves child privacy notice');
  });
});
