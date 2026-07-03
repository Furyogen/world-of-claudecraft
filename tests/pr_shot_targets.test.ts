// Unit test for the PR-screenshot diff classifier. classifyDiff is the whole "shoot only
// visual changes, and only the sections they touch" policy, kept pure so it needs no
// browser. The .mjs script has no TS/browser imports at module load, so vitest can import
// it directly.
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain Node ESM script, no types
import { classifyDiff, resolveTargets } from '../scripts/pr_shot_targets.mjs';

describe('classifyDiff', () => {
  it('treats a backend/data-only diff as non-visual (captures nothing)', () => {
    const plan = classifyDiff(['server/game.ts', 'src/sim/spirit.ts', 'server/db.ts']);
    expect(plan.isVisual).toBe(false);
    expect(plan.specific).toHaveLength(0);
    expect(plan.generic).toHaveLength(0);
  });

  it('maps a bags change to the inventory window target', () => {
    const plan = classifyDiff(['src/ui/bags.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((t: { key: string }) => t.key)).toContain('inventory');
    // A specific window was found, so no generic HUD fallback.
    expect(plan.generic).toHaveLength(0);
  });

  it('maps a zone/terrain change to the world-map target', () => {
    const plan = classifyDiff(['src/render/terrain.ts']);
    expect(plan.specific.map((t: { key: string }) => t.key)).toContain('world-map');
  });

  it('falls back to the desktop HUD for a generic visual change', () => {
    const plan = classifyDiff(['src/render/renderer.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific).toHaveLength(0);
    expect(plan.generic).toEqual(['hud-desktop']);
  });

  it('adds the mobile HUD when the visual change touches the mobile surface', () => {
    const plan = classifyDiff(['src/styles/hud.mobile.css']);
    expect(plan.generic).toEqual(['hud-desktop', 'hud-mobile']);
  });

  it('does not treat an i18n text-table change as visual', () => {
    const plan = classifyDiff(['src/ui/i18n.catalog/hud_chrome.ts']);
    expect(plan.isVisual).toBe(false);
    expect(plan.generic).toHaveLength(0);
  });

  it('does not treat a UI test file as visual', () => {
    const plan = classifyDiff(['tests/social_view.test.ts', 'src/ui/social_view.test.ts']);
    expect(plan.isVisual).toBe(false);
  });

  it('prefers specific targets even when other generic-visual files also changed', () => {
    const plan = classifyDiff(['src/ui/bags.ts', 'src/render/renderer.ts']);
    expect(plan.specific.map((t: { key: string }) => t.key)).toContain('inventory');
    expect(plan.generic).toHaveLength(0);
  });

  it('resolveTargets stays available and returns registry-ordered matches', () => {
    const keys = resolveTargets(['src/ui/map_window.ts', 'src/ui/bags.ts']).map(
      (t: { key: string }) => t.key,
    );
    expect(keys).toEqual(['inventory', 'world-map']);
  });
});
