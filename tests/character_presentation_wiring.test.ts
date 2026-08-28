import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
// The ridden-mount per-frame drive lives here now (extracted from renderer.ts,
// which is at its monolith ceiling), so the mount half of these pins reads the
// module that actually owns the behaviour rather than the coordinator that
// calls it.
const mountRideView = readFileSync(
  new URL('../src/render/mount_ride_view.ts', import.meta.url),
  'utf8',
);
const characterVisual = readFileSync(
  new URL('../src/render/characters/visual.ts', import.meta.url),
  'utf8',
);
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('character presentation sleep wiring', () => {
  it('routes hidden cosmetic rigs through bounded off-screen advancement', () => {
    expect(renderer).toContain(
      'const characterCasting = characterPresentationCasting(\n        e.castingAbility,\n        waterJetVisualChannel,\n        visuallyDead,',
    );
    expect(renderer).toContain(
      'const actionablePose = animatesEveryFrame(\n        id,\n        p.id,\n        p.targetId,\n        characterCasting,',
    );
    expect(renderer).toContain(
      'const runCharacterPresentation = shouldRunCharacterPresentationWork(',
    );
    expect(renderer).toContain(
      'if (runCharacterPresentation) active.update(dt, st, animate, this.reducedMotion());',
    );
    expect(renderer).toContain('else active.advanceOffscreen(dt);');
    // The weapon-skin rig is still gated on presentation (a hidden rig writes no
    // uniforms), and a visible one now carries its shed multiplier: the pin
    // covers both halves so neither can be dropped.
    expect(renderer).toContain(
      'if (runCharacterPresentation) {\n        v.visual.updateWeaponVfx(dt, weaponVfxShedScale(d2, this.appliedBudgetLevels?.vfx ?? 1));\n      }',
    );
    // A hidden mount rig still only advances its clocks. The call moved into
    // driveMountRide, so it is pinned there, together with the renderer's hand
    // -off of the same presentation flag every other rig here is gated on.
    expect(mountRideView).toContain('mountVisual.advanceOffscreen(frame.dt);');
    expect(renderer).toContain('present: runCharacterPresentation,');
  });

  it('ticks deferred weapon stow transitions while a rig is off screen', () => {
    const start = characterVisual.indexOf('advanceOffscreen(dt: number): void {');
    const end = characterVisual.indexOf('\n  /**', start + 1);
    const offscreenBlock = characterVisual.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(offscreenBlock).toContain('tickStow(this.stow, dt)');
    expect(offscreenBlock).toContain("if (stowTick === 'swap') this.applyStowSwap();");
    expect(offscreenBlock).toContain('this.endStowGesture();');
  });

  it('persists the Recklessness latch across camera re-entry and clears it on aura end', () => {
    expect(renderer).toContain('const nextRecklessSkullsLatch = nextRecklessnessSkullsLatch(');
    expect(renderer).toContain(
      'const spawnRecklessnessSkulls = nextRecklessSkullsLatch && !recklessSkullsSpawned;',
    );
    expect(renderer).toContain('v.recklessSkullsSpawned = nextRecklessSkullsLatch;');
  });

  it('sleeps ability VFX semantically while mount particles remain presentation-gated', () => {
    const mountStart = renderer.indexOf('if (v.mountVisual && mountSpec && mountShown) {');
    const abilityStart = renderer.indexOf('// per-ability windup orb + buff-orbit bands');
    expect(mountStart).toBeGreaterThan(-1);
    expect(abilityStart).toBeGreaterThan(mountStart);

    // The mount block is a thin consumer now: the renderer hands the drive its
    // emitter sink and the presentation flag, and the GATE is the early return
    // inside the drive. Both halves are pinned, so neither the hand-off nor the
    // gate can be dropped without this going red.
    const mountBlock = renderer.slice(mountStart, abilityStart);
    expect(mountBlock).toContain('driveMountRide(mountSpec, mst, v, this.vfx, {');
    expect(mountBlock).toContain('present: runCharacterPresentation,');

    const offscreenAt = mountRideView.indexOf('if (!frame.present) {');
    expect(offscreenAt).toBeGreaterThan(-1);
    expect(mountRideView.slice(offscreenAt)).toContain('return view.mountRoll;');
    // Both emitters sit PAST that return, which is what keeps an unseen mount
    // from painting slime or streaming exhaust at nobody.
    expect(mountRideView.indexOf('fxSink.mountSlimeTrail')).toBeGreaterThan(offscreenAt);
    expect(mountRideView.indexOf('fxSink.mountExhaust')).toBeGreaterThan(offscreenAt);
    expect(renderer.slice(abilityStart)).toContain(
      'this.abilityVfx.syncEntity(e, runCharacterPresentation);',
    );
    expect(renderer.slice(abilityStart)).toContain('if (runCharacterPresentation) {');
  });
});

// The recompose arm has no coverage that would run the composed body's
// GLTF/mixer pipeline (it needs a live GPU rig), so this pins the statement
// order the same way the far-LOD wiring above does: composedBefore is what
// keeps a body that WAS composed (a redesign clearing the look) recomposing
// down to the class rig, not just a body newly gaining one.
describe('modular recompose guard (source pin)', () => {
  it('nulls visualKey through composedBefore, in the order the recompose fix depends on', () => {
    const start = renderer.indexOf('if (e.modularAppearance !== v.modularAppearance) {');
    const end = renderer.indexOf('this.updateBaseVisual(e, v);', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = renderer.slice(start, end);

    const changedAt = block.indexOf('e.modularAppearance !== v.modularAppearance');
    const changedFnAt = block.indexOf(
      'modularLookChanged(v.modularAppearance, e.modularAppearance)',
    );
    const composedBeforeAt = block.indexOf('composedBefore');
    const guardAt = block.indexOf('!isMechWearer(e) && (modularLookFor(e) || composedBefore)');
    const copyAt = block.indexOf('v.modularAppearance = e.modularAppearance;');

    expect(changedAt).toBeGreaterThan(-1);
    expect(changedFnAt).toBeGreaterThan(changedAt);
    expect(composedBeforeAt).toBeGreaterThan(changedFnAt);
    expect(guardAt).toBeGreaterThan(composedBeforeAt);
    expect(copyAt).toBeGreaterThan(guardAt);
  });

  it('births EntityView with the current modularAppearance, nothing to reconcile on the first sync', () => {
    expect(renderer).toContain('modularAppearance: e.modularAppearance,');
  });
});

// The char-select roster row wiring lives in main.ts, not the renderer; same
// reason as above (a DOM-and-real-portrait-asset pipeline nothing here stands
// up), pinned as source in the same style.
describe('char-select roster wiring (source pins)', () => {
  it('captures the redesign opener before selectRow moves focus, and passes it to open()', () => {
    const start = main.indexOf(
      "row.querySelector('.reroll-char-btn')?.addEventListener('click', (e) => {",
    );
    const end = main.indexOf('redesignEditor.open(c, opener);', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = main.slice(start, end + 'redesignEditor.open(c, opener);'.length);

    const openerAt = block.indexOf('const opener = e.currentTarget as HTMLButtonElement;');
    const selectRowAt = block.indexOf('selectRow();');
    const openAt = block.indexOf('redesignEditor.open(c, opener);');

    expect(openerAt).toBeGreaterThan(-1);
    expect(selectRowAt).toBeGreaterThan(openerAt);
    expect(openAt).toBeGreaterThan(selectRowAt);
  });

  it('re-arms crest fallbacks after the composed-chip outerHTML swap', () => {
    const start = main.indexOf(
      "const chip = row.querySelector('.portrait-chip[data-portrait-composed]');",
    );
    const end = main.indexOf('hydratePortraits(row);', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = main.slice(start, end + 'hydratePortraits(row);'.length);

    const swapAt = block.indexOf('chip.outerHTML = chipHtml();');
    const hydrateAt = block.indexOf('hydratePortraits(row);');
    expect(swapAt).toBeGreaterThan(-1);
    expect(hydrateAt).toBeGreaterThan(swapAt);
  });
});
