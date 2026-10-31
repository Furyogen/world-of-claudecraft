// Guards for the Season 2 PvP 1v1 duel Monte Carlo (scripts/pvp_duel/): every
// spec keeps a legal build, a full Season 2 kit of real items, and a bot whose
// every button is an ability its class actually has, so a content rename or a
// new spec fails here instead of silently skewing the next ranking run. One
// short real duel pins seed reproducibility.

import { describe, expect, it } from 'vitest';
import { SPEC_AI } from '../scripts/pvp_duel/ai';
import { BUILDS } from '../scripts/pvp_duel/builds';
import { duelSeed, runDuel, specKey } from '../scripts/pvp_duel/duel';
import { buildKit, createDuelSim, DUEL_FIELD, spawnDuelist } from '../scripts/pvp_duel/setup';
import { SEASON2_SETS } from '../src/sim/content/pvp_honor_season2';
import { classSpecs, validateAllocation } from '../src/sim/content/talents';
import { ABILITIES, ITEMS } from '../src/sim/data';

describe('pvp duel harness builds', () => {
  it('covers every spec of every class exactly once', () => {
    const want = SEASON2_SETS.map((s) => `${s.cls}/${s.spec}`).sort();
    expect(BUILDS.map(specKey).sort()).toEqual(want);
    for (const b of BUILDS) expect(classSpecs(b.cls)).toContain(b.spec);
  });

  it('gives every spec a legal level-20 talent build', () => {
    for (const b of BUILDS) {
      const check = validateAllocation(b.cls, { spec: b.spec, rows: { ...b.rows } }, 20);
      expect(check, specKey(b)).toMatchObject({ ok: true });
    }
  });

  it('dresses every spec in its five Season 2 pieces plus real honor gear', () => {
    for (const b of BUILDS) {
      const kit = buildKit(b);
      const set = SEASON2_SETS.find((s) => s.cls === b.cls && s.spec === b.spec);
      for (const id of set?.itemIds ?? []) expect(Object.values(kit), specKey(b)).toContain(id);
      for (const id of Object.values(kit))
        expect(ITEMS[id as string], `${specKey(b)} ${id}`).toBeDefined();
      expect(kit.trinket).toBe('medallion_of_defiance');
      expect(kit.mainhand).toMatch(/^vanguard_/);
    }
  });

  it('only presses abilities that belong to the spec class', () => {
    for (const b of BUILDS) {
      const ai = SPEC_AI[specKey(b)];
      expect(ai, specKey(b)).toBeDefined();
      for (const id of [...ai.prep, ...ai.rules.map((r) => r.id)]) {
        expect(ABILITIES[id], `${specKey(b)} ${id}`).toBeDefined();
        expect(ABILITIES[id].class, `${specKey(b)} ${id}`).toBe(b.cls);
      }
    }
  });
});

describe('pvp duel harness run', () => {
  it('models full Season 2 kits as immune to spell pushback', () => {
    const sim = createDuelSim(1);
    for (const key of ['shaman/elemental', 'warrior/arms']) {
      const build = BUILDS.find((b) => specKey(b) === key);
      if (!build) throw new Error(`missing ${key}`);
      const d = spawnDuelist(sim, build, 'Probe', DUEL_FIELD.x, DUEL_FIELD.z);
      const e = sim.entities.get(d.pid);
      expect(e?.castPushbackReduction, key).toBe(1);
      // A later stat recalc (an aura landing mid-fight) must keep it.
      if (e) sim.ctx.recalcPlayer(e);
      expect(e?.castPushbackReduction, key).toBe(1);
      sim.removePlayer(d.pid);
    }
  }, 120_000);

  it('replays a duel identically from its seed', () => {
    const arms = BUILDS.find((b) => specKey(b) === 'warrior/arms');
    const frost = BUILDS.find((b) => specKey(b) === 'mage/frost');
    if (!arms || !frost) throw new Error('missing builds');
    const seed = duelSeed('warrior/arms', 'mage/frost', 0);
    const first = runDuel(createDuelSim(1), arms, frost, seed);
    const second = runDuel(createDuelSim(1), arms, frost, seed);
    expect(first.winner).not.toBe('timeout');
    expect(second).toEqual(first);
  }, 120_000);
});
