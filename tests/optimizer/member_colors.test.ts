import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  MEMBER_PRIMARY_PALETTE,
  getMemberColorDef,
  getMemberColorInstance,
  assignMemberColorIndices,
  getNextAvailableMemberColorIndex,
  buildHouseholdColorMap,
  getMemberColor
} from '../../src/optimizer/memberColors.ts';

describe('Household Member Colors System', () => {
  describe('Primary Palette & Color Definitions', () => {
    it('defines at least 10 distinct, curated accessible colors in the primary palette', () => {
      assert.ok(MEMBER_PRIMARY_PALETTE.length >= 10, 'Must have at least 10 primary colors');
      const names = new Set(MEMBER_PRIMARY_PALETTE.map(c => c.name));
      assert.strictEqual(names.size, MEMBER_PRIMARY_PALETTE.length, 'Every palette entry must have a unique name');
    });

    it('provides both light and dark tokens with text, background, border, and accent for every color', () => {
      MEMBER_PRIMARY_PALETTE.forEach((color, idx) => {
        assert.ok(color.light.text, `Color ${idx} must have light text`);
        assert.ok(color.light.bg, `Color ${idx} must have light bg`);
        assert.ok(color.light.border, `Color ${idx} must have light border`);
        assert.ok(color.light.accent, `Color ${idx} must have light accent`);

        assert.ok(color.dark.text, `Color ${idx} must have dark text`);
        assert.ok(color.dark.bg, `Color ${idx} must have dark bg`);
        assert.ok(color.dark.border, `Color ${idx} must have dark border`);
        assert.ok(color.dark.accent, `Color ${idx} must have dark accent`);
      });
    });

    it('returns valid color instances with CSS variables for light and dark modes', () => {
      const darkInstance = getMemberColorInstance(0, true);
      assert.strictEqual(darkInstance.className, 'member-color-0');
      assert.ok(darkInstance.cssVars.includes('--member-text:'), 'Must include --member-text');
      assert.ok(darkInstance.cssVars.includes('--member-bg:'), 'Must include --member-bg');
      assert.ok(darkInstance.cssVars.includes('--member-border:'), 'Must include --member-border');
      assert.ok(darkInstance.cssVars.includes('--member-accent:'), 'Must include --member-accent');
      assert.strictEqual(darkInstance.current, darkInstance.dark);

      const lightInstance = getMemberColorInstance(0, false);
      assert.strictEqual(lightInstance.current, lightInstance.light);
    });
  });

  describe('Deterministic Color Index Assignment', () => {
    it('assigns distinct color indices to standard households (e.g., Couple, Family, Roommates)', () => {
      const couple = [
        { id: 'm1', name: 'Alex' },
        { id: 'm2', name: 'Sam' }
      ];
      const indicesCouple = assignMemberColorIndices(couple);
      assert.strictEqual(indicesCouple.get('m1'), 0);
      assert.strictEqual(indicesCouple.get('m2'), 1);
      assert.notStrictEqual(indicesCouple.get('m1'), indicesCouple.get('m2'));

      const family = [
        { id: 'm1', name: 'Parent 1' },
        { id: 'm2', name: 'Parent 2' },
        { id: 'm3', name: 'Teen' },
        { id: 'm4', name: 'Kid' }
      ];
      const indicesFamily = assignMemberColorIndices(family);
      const usedIndices = new Set(family.map(m => indicesFamily.get(m.id)));
      assert.strictEqual(usedIndices.size, 4, 'All 4 family members must have distinct color indices');
    });

    it('preserves existing explicit colorIndex on members', () => {
      const members = [
        { id: 'm1', name: 'Alice', colorIndex: 4 },
        { id: 'm2', name: 'Bob', colorIndex: 2 }
      ];
      const indices = assignMemberColorIndices(members);
      assert.strictEqual(indices.get('m1'), 4);
      assert.strictEqual(indices.get('m2'), 2);
    });

    it('adding a member does not alter existing members colors', () => {
      const initial = [
        { id: 'm1', name: 'Member 1', colorIndex: 0 },
        { id: 'm2', name: 'Member 2', colorIndex: 1 }
      ];
      const nextIdx = getNextAvailableMemberColorIndex(initial);
      assert.strictEqual(nextIdx, 2);

      const updated = [
        ...initial,
        { id: 'm3', name: 'Member 3', colorIndex: nextIdx }
      ];
      const indices = assignMemberColorIndices(updated);
      assert.strictEqual(indices.get('m1'), 0, 'Member 1 color must remain unchanged');
      assert.strictEqual(indices.get('m2'), 1, 'Member 2 color must remain unchanged');
      assert.strictEqual(indices.get('m3'), 2, 'Member 3 gets new available slot');
    });

    it('removing a member does not shift remaining members colors', () => {
      const initial = [
        { id: 'm1', name: 'Member 1', colorIndex: 0 },
        { id: 'm2', name: 'Member 2', colorIndex: 1 },
        { id: 'm3', name: 'Member 3', colorIndex: 2 }
      ];
      // Remove middle member
      const remaining = [initial[0], initial[2]];
      const indices = assignMemberColorIndices(remaining);
      assert.strictEqual(indices.get('m1'), 0, 'Member 1 must still have color 0');
      assert.strictEqual(indices.get('m3'), 2, 'Member 3 must still retain color 2');

      // Next new member reuses the lowest free slot (1)
      const nextSlot = getNextAvailableMemberColorIndex(remaining);
      assert.strictEqual(nextSlot, 1, 'Next member should cleanly backfill free slot 1');
    });
  });

  describe('Graceful Overflow for Large Households (> 10 Members)', () => {
    it('generates distinct golden-angle hues for households exceeding the primary palette', () => {
      const largeHousehold = Array.from({ length: 16 }, (_, i) => ({
        id: `m_${i + 1}`,
        name: `Resident ${i + 1}`,
        colorIndex: i
      }));

      const colorMap = buildHouseholdColorMap(largeHousehold, true);
      // Map indexes by both id and name for fast lookups
      assert.strictEqual(colorMap.size, 32);
      largeHousehold.forEach(m => {
        assert.ok(colorMap.has(m.id), `Map must contain id ${m.id}`);
        assert.ok(colorMap.has(m.name), `Map must contain name ${m.name}`);
      });

      // Verify members 0-9 use primary palette names
      assert.strictEqual(colorMap.get('m_1')?.name, 'sky');
      assert.strictEqual(colorMap.get('m_2')?.name, 'emerald');

      // Verify member 10+ uses golden-angle calculation and is distinct
      const m10 = colorMap.get('m_11'); // index 10
      const m11 = colorMap.get('m_12'); // index 11
      assert.ok(m10?.name.startsWith('color-10'));
      assert.ok(m11?.name.startsWith('color-11'));
      assert.notStrictEqual(m10?.current.text, m11?.current.text);
      assert.notStrictEqual(m10?.current.accent, m11?.current.accent);
    });

    it('getMemberColorDef handles any positive integer without throwing or returning undefined', () => {
      for (const idx of [0, 5, 9, 10, 25, 99, 500]) {
        const def = getMemberColorDef(idx);
        assert.ok(def.name, `Index ${idx} must produce a name`);
        assert.ok(def.dark.text, `Index ${idx} must produce dark text`);
        assert.ok(def.light.text, `Index ${idx} must produce light text`);
      }
    });
  });

  describe('Color Consistency across Views, Refreshes, and Loads', () => {
    it('returns identical color instances across multiple lookups for the same member', () => {
      const household = [
        { id: 'm1', name: 'Jordan' },
        { id: 'm2', name: 'Taylor' }
      ];

      const c1 = getMemberColor('m1', 'Jordan', household, true);
      const c2 = getMemberColor('m1', 'Jordan', household, true);
      assert.deepStrictEqual(c1, c2, 'Same member must have identical color instance on re-render');

      // Table view vs Calendar view check
      const calViewColor = getMemberColor('m2', 'Taylor', household, true);
      const tableViewColor = getMemberColor('m2', 'Taylor', household, true);
      assert.strictEqual(calViewColor.className, tableViewColor.className);
      assert.strictEqual(calViewColor.current.text, tableViewColor.current.text);
    });

    it('falls back gracefully to stable hash or ID if household list is empty', () => {
      const c1 = getMemberColor('m1', 'Unknown', [], true);
      const c2 = getMemberColor('m1', 'Unknown', [], true);
      assert.strictEqual(c1.className, c2.className);
      assert.strictEqual(c1.current.accent, c2.current.accent);

      const customMember = getMemberColor('custom-id-99', 'Alex Smith', [], true);
      assert.ok(customMember.className);
    });
  });

  describe('CSS & HTML UI Consistency Check', () => {
    const commonCss = fs.readFileSync(path.resolve('src/styles/common.css'), 'utf8');
    const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
    const appHtml = fs.readFileSync(path.resolve('app.html'), 'utf8');

    it('common.css contains member color tokens and classes for all 10 primary colors', () => {
      for (let i = 0; i < 10; i++) {
        assert.ok(commonCss.includes(`.member-color-${i}`), `common.css must define .member-color-${i}`);
      }
      assert.ok(commonCss.includes('.member-chip'), 'Must define .member-chip');
      assert.ok(commonCss.includes('.member-dot'), 'Must define .member-dot');
      assert.ok(commonCss.includes('.cal-task-owner-badge.has-member-color'), 'Must define .cal-task-owner-badge.has-member-color');
    });

    it('index.html and app.html contain scheduleMemberLegend container and member color wiring', () => {
      assert.ok(indexHtml.includes('id="scheduleMemberLegend"'), 'index.html must have scheduleMemberLegend element');
      assert.ok(appHtml.includes('id="scheduleMemberLegend"'), 'app.html must have scheduleMemberLegend element');

      assert.ok(indexHtml.includes('getMemberColorForCurrentHousehold'), 'index.html must have color helper');
      assert.ok(appHtml.includes('getMemberColorForCurrentHousehold'), 'app.html must have color helper');

      assert.ok(indexHtml.includes('has-member-color'), 'index.html must apply has-member-color');
      assert.ok(appHtml.includes('has-member-color'), 'app.html must apply has-member-color');
    });

    it('preserves existing interactive attributes on calendar badges for drag & drop and swap-member', () => {
      assert.ok(indexHtml.includes('data-action="swap-member"'), 'index.html must preserve swap-member action');
      assert.ok(appHtml.includes('data-action="swap-member"'), 'app.html must preserve swap-member action');
      assert.ok(indexHtml.includes('cal-card-handle'), 'index.html must preserve drag handle');
      assert.ok(appHtml.includes('cal-card-handle'), 'app.html must preserve drag handle');
    });
  });
});
