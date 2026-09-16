// The feral druid attack-power conversion (src/sim/melee_ap.ts).
//
// The defect this pins: a druid's attack power converted from Strength at 2/point
// in EVERY form, but the leather a feral druid wears carries Agility and never
// Strength, so its whole armor set contributed zero attack power. Wolf Form and
// Bruin Form now convert on the rogue line (str + agi) instead.
//
// Every behavioral claim is driven through the ONE place the sim derives stats
// (recalcPlayerStats). Two kinds of assertion appear below, and they prove
// different things:
//   - LITERAL pins (the agility-probe deltas, the pre-change conversion written
//     out by hand) are independent of melee_ap.ts and catch the two modules
//     drifting TOGETHER.
//   - The "reconciles with the module" pins compare recalcPlayerStats against
//     the same helpers entity.ts calls, so they do NOT catch a shared drift;
//     what they pin is the COMPOSITION ORDER inside recalcPlayerStats (the form
//     agility bonus landing before the conversion, the flat bonus after).
// Mutation-checked: reverting the class gate, the form predicate, the bear
// coefficient, entity.ts's feral argument, or the cat-form agility bump each
// turns this file red.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, CLASSES, ITEMS } from '../src/sim/data';
import { recalcPlayerStats } from '../src/sim/entity';
import {
  BEAR_FORM_AGI_AP_PER_POINT,
  BEAR_FORM_FLAT_AP,
  bearFormBonusAp,
  catFormAgiBonus,
  catFormBonusAp,
  FERAL_AP_WEIGHTS,
  isFeralApForm,
  meleeApFromAttributes,
  meleeApWeights,
} from '../src/sim/melee_ap';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type AuraKind, type PlayerClass, type WorldContent } from '../src/sim/types';
import { agiMeleeApPerPoint, strApPerPoint } from '../src/ui/stat_tooltip';

// Player-derived stats only; strip ambient content so each Sim is cheap (the
// subsystem-world pattern from tests/stat_tooltip.test.ts).
const AP_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

// Forms are a 3600s toggle aura on the player (mirrors tests/form_swing.ts).
function giveForm(sim: Sim, pid: number, kind: AuraKind, name: string): void {
  sim.entities.get(pid)!.auras.push({
    id: name.toLowerCase().replace(/\s+/g, '_'),
    name,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 1,
    sourceId: pid,
    school: 'physical',
  });
}

function playerAt(cls: PlayerClass, level: number) {
  const sim = new Sim({ seed: 7, playerClass: cls, world: AP_TEST_WORLD });
  sim.setPlayerLevel(level);
  return sim;
}

describe('melee attack-power weights', () => {
  it('leaves every non-druid class exactly where it was', () => {
    for (const cls of ALL_CLASSES) {
      if (cls === 'druid') continue;
      const expected = {
        str: cls === 'warrior' || cls === 'paladin' || cls === 'shaman' ? 2 : 1,
        agi: cls === 'rogue' || cls === 'hunter' ? 1 : 0,
      };
      // The form flag is a druid-only switch: it must not move any other class.
      expect(meleeApWeights(cls, false)).toEqual(expected);
      expect(meleeApWeights(cls, true)).toEqual(expected);
    }
  });

  it('gives a feral druid the rogue line and a caster-form druid the old 2/str line', () => {
    expect(meleeApWeights('druid', true)).toEqual(meleeApWeights('rogue', false));
    expect(meleeApWeights('druid', true)).toEqual(FERAL_AP_WEIGHTS);
    expect(meleeApWeights('druid', false)).toEqual({ str: 2, agi: 0 });
  });

  it('counts only the two melee forms as feral', () => {
    expect(isFeralApForm('form_bear')).toBe(true);
    expect(isFeralApForm('form_cat')).toBe(true);
    for (const kind of ['form_travel', 'form_moonkin', 'form_shadow', 'form_metamorph']) {
      expect(isFeralApForm(kind)).toBe(false);
    }
  });
});

describe('a shapeshifted druid scales its attack power from Agility', () => {
  // The headline behavior, driven through the real recalcPlayerStats: in a feral
  // form, +10 Agility must add exactly 10 attack power. In caster form the same
  // Agility adds none, which is the pre-change behavior and why leather was dead
  // weight for a feral druid.
  const AGI_PROBE = 10;

  function apWithAgiProbe(form: AuraKind | null, probe: number): number {
    const sim = playerAt('druid', 20);
    const e = sim.player;
    if (form) giveForm(sim, e.id, form, form === 'form_cat' ? 'Wolf Form' : 'Bruin Form');
    if (probe > 0) {
      e.auras.push({
        id: 'agi_probe',
        name: 'Agility Probe',
        kind: 'buff_agi',
        remaining: 3600,
        duration: 3600,
        value: probe,
        sourceId: e.id,
        school: 'physical',
      });
    }
    recalcPlayerStats(e, 'druid', {}, undefined, {});
    return e.attackPower;
  }

  it('Wolf Form: 10 Agility is worth exactly 10 attack power', () => {
    // Wolf Form has no Agility term of its own, so the conversion is the whole
    // gain: 1 attack power per Agility, the rogue line.
    const before = apWithAgiProbe('form_cat', 0);
    expect(apWithAgiProbe('form_cat', AGI_PROBE) - before).toBe(AGI_PROBE);
  });

  it('Bruin Form: 10 Agility is worth the conversion PLUS its own bridge', () => {
    // Bruin Form keeps a (retuned) Agility term on top of the conversion, so it
    // gains more per point than Wolf Form. Reconciled against entity.ts rather
    // than restated, so a drift in either term fails here.
    const sim = playerAt('druid', 20);
    const agi = sim.player.stats.agi;
    const before = apWithAgiProbe('form_bear', 0);
    const after = apWithAgiProbe('form_bear', AGI_PROBE);
    const bridgeGain = bearFormBonusAp(agi + AGI_PROBE) - bearFormBonusAp(agi);
    expect(after - before).toBe(AGI_PROBE + bridgeGain);
    expect(after - before).toBeGreaterThan(AGI_PROBE);
  });

  it('caster form still gets nothing from Agility (unchanged behavior)', () => {
    expect(apWithAgiProbe(null, AGI_PROBE) - apWithAgiProbe(null, 0)).toBe(0);
  });

  it('caster form keeps converting from Strength, so nothing else changed', () => {
    const sim = playerAt('druid', 20);
    const p = sim.player;
    recalcPlayerStats(p, 'druid', {}, undefined, {});
    expect(p.auras.some((a) => isFeralApForm(a.kind))).toBe(false);
    expect(p.attackPower).toBe(meleeApFromAttributes('druid', false, p.stats.str, p.stats.agi));
    expect(p.attackPower).toBe(p.stats.str * 2);
  });

  it('Wolf Form attack power reconciles exactly with the module', () => {
    const sim = playerAt('druid', 20);
    const p = sim.player;
    const casterAgi = p.stats.agi;
    giveForm(sim, p.id, 'form_cat', 'Wolf Form');
    recalcPlayerStats(p, 'druid', {}, undefined, {});

    // Wolf Form raises Agility, and that raised Agility is what converts.
    expect(p.stats.agi).toBe(casterAgi + catFormAgiBonus(20));
    expect(p.attackPower).toBe(
      meleeApFromAttributes('druid', true, p.stats.str, p.stats.agi) + catFormBonusAp(20),
    );
  });

  it('Bruin Form attack power reconciles exactly with the module', () => {
    const sim = playerAt('druid', 20);
    const p = sim.player;
    giveForm(sim, p.id, 'form_bear', 'Bruin Form');
    recalcPlayerStats(p, 'druid', {}, undefined, {});
    expect(p.attackPower).toBe(
      meleeApFromAttributes('druid', true, p.stats.str, p.stats.agi) + bearFormBonusAp(p.stats.agi),
    );
  });
});

describe("Bruin Form's Agility bridge does not double-count", () => {
  // The retune this change had to make: the old 1.5 bridge existed BECAUSE the
  // druid had no Agility conversion. Left alone alongside the new conversion it
  // would hand the TANK form 2.5 attack power per Agility against Wolf Form's
  // 1.0. Pinned as a relationship, not a magic number.
  it('keeps the bridge below the Wolf Form total per point of Agility', () => {
    const perAgiInBear = meleeApWeights('druid', true).agi + BEAR_FORM_AGI_AP_PER_POINT;
    expect(perAgiInBear).toBeLessThan(2);
    expect(BEAR_FORM_AGI_AP_PER_POINT).toBeLessThan(1.5);
  });

  it('preserves a geared Bruin Form total: re-sourced to Agility, not buffed', () => {
    // The justification for 0.8, derived from the CONTENT TREE rather than
    // hand-entered arithmetic, so it re-derives (and can fail) after a druid
    // base-stat or leather-budget rebalance instead of freezing a stale claim.
    const def = CLASSES.druid;
    const lvl = 20;
    const baseStr = def.baseStats.str + def.statsPerLevel.str * (lvl - 1);
    const baseAgi = def.baseStats.agi + def.statsPerLevel.agi * (lvl - 1);

    // The best-Agility leather piece in each armor slot: the set a level-20
    // feral actually chases, read live from ITEMS.
    const bestPerSlot = new Map<string, number>();
    for (const item of Object.values(ITEMS)) {
      if (item.kind !== 'armor' || item.armorType !== 'leather') continue;
      const agi = item.stats?.agi ?? 0;
      bestPerSlot.set(item.slot, Math.max(bestPerSlot.get(item.slot) ?? 0, agi));
    }
    const armorAgi = [...bestPerSlot.values()].reduce((a, b) => a + b, 0);
    expect(armorAgi, 'the leather ladder should still carry real Agility').toBeGreaterThan(50);

    // The top feral two-hander, before and after its Strength was folded in.
    const maul = ITEMS.wildsoul_maul;
    const weaponAgiAfter = maul.stats?.agi ?? 0;
    const weaponPoints = weaponAgiAfter; // the fold was point-for-point
    const weaponStrBefore = 13;
    const weaponAgiBefore = weaponPoints - weaponStrBefore;

    // Both the FORMULA and the GEAR moved, so each side runs with its own.
    const before =
      (baseStr + weaponStrBefore) * 2 +
      BEAR_FORM_FLAT_AP +
      Math.round((baseAgi + armorAgi + weaponAgiBefore) * 1.5);
    const afterAgi = baseAgi + armorAgi + weaponAgiAfter;
    const after =
      meleeApFromAttributes('druid', true, baseStr, afterAgi) + bearFormBonusAp(afterAgi);

    expect(Math.abs(after - before) / before).toBeLessThan(0.02);
  });

  it('0.8 is the only coefficient that holds that total, to one decimal', () => {
    // The band above is satisfied by a RANGE of coefficients, so pin the choice
    // directly: sweep every 0.1 step and assert the shipped value is the one
    // that lands closest to the pre-change total. This fails on 0.7 or 0.9.
    const def = CLASSES.druid;
    const lvl = 20;
    const baseStr = def.baseStats.str + def.statsPerLevel.str * (lvl - 1);
    const baseAgi = def.baseStats.agi + def.statsPerLevel.agi * (lvl - 1);
    const bestPerSlot = new Map<string, number>();
    for (const item of Object.values(ITEMS)) {
      if (item.kind !== 'armor' || item.armorType !== 'leather') continue;
      bestPerSlot.set(item.slot, Math.max(bestPerSlot.get(item.slot) ?? 0, item.stats?.agi ?? 0));
    }
    const armorAgi = [...bestPerSlot.values()].reduce((a, b) => a + b, 0);
    const weaponPoints = ITEMS.wildsoul_maul.stats?.agi ?? 0;
    const before =
      (baseStr + 13) * 2 +
      BEAR_FORM_FLAT_AP +
      Math.round((baseAgi + armorAgi + weaponPoints - 13) * 1.5);
    const afterAgi = baseAgi + armorAgi + weaponPoints;
    const flat = meleeApFromAttributes('druid', true, baseStr, afterAgi) + BEAR_FORM_FLAT_AP;

    let best = 0;
    let bestErr = Number.POSITIVE_INFINITY;
    for (let c = 1; c <= 20; c++) {
      const err = Math.abs(flat + Math.round(afterAgi * (c / 10)) - before);
      if (err < bestErr) {
        bestErr = err;
        best = c / 10;
      }
    }
    expect(best).toBe(BEAR_FORM_AGI_AP_PER_POINT);
  });
});

describe('the character sheet reads the same conversion as the sim', () => {
  it('feral form flips both tooltip coefficients', () => {
    expect(strApPerPoint('druid', false)).toBe(2);
    expect(agiMeleeApPerPoint('druid', false)).toBe(0);
    expect(strApPerPoint('druid', true)).toBe(1);
    expect(agiMeleeApPerPoint('druid', true)).toBe(1);
  });

  it('matches the rogue, which is the line feral was moved onto', () => {
    expect(strApPerPoint('druid', true)).toBe(strApPerPoint('rogue'));
    expect(agiMeleeApPerPoint('druid', true)).toBe(agiMeleeApPerPoint('rogue'));
  });
});

describe('nothing outside a feral form moved', () => {
  // The regression proof for the whole change. Deliberately restates the
  // PRE-CHANGE conversion as a literal expression instead of calling
  // meleeApWeights, so it still fails if melee_ap.ts and entity.ts ever drift
  // together (the constant-self-comparison trap a shared helper invites).
  function apBeforeThisChange(cls: PlayerClass, str: number, agi: number): number {
    if (cls === 'warrior' || cls === 'paladin' || cls === 'shaman' || cls === 'druid') {
      return str * 2;
    }
    if (cls === 'rogue' || cls === 'hunter') return str + agi;
    return str;
  }

  for (const cls of ALL_CLASSES) {
    it(`${cls} out of form converts exactly as it did before`, () => {
      for (const level of [1, 10, 20]) {
        const sim = playerAt(cls, level);
        const p = sim.player;
        recalcPlayerStats(p, cls, {}, undefined, {});
        expect(p.attackPower, `${cls} at level ${level}`).toBe(
          apBeforeThisChange(cls, p.stats.str, p.stats.agi),
        );
      }
    });
  }

  it('Travel Form and Moonwing Form are NOT feral and keep the caster line', () => {
    // Only the two MELEE shapeshifts moved. A druid that shifts to run or to
    // cast is still a caster-form druid for attack-power purposes.
    for (const kind of ['form_travel', 'form_moonkin'] as const) {
      const sim = playerAt('druid', 20);
      const p = sim.player;
      giveForm(sim, p.id, kind, kind);
      recalcPlayerStats(p, 'druid', {}, undefined, {});
      expect(p.attackPower, kind).toBe(apBeforeThisChange('druid', p.stats.str, p.stats.agi));
    }
  });
});

describe('feral gear carries Agility, not Strength', () => {
  // The other half of the fix: the druid-only two-handers were the feral
  // druid's ONLY Strength source, so leaving them on Strength after moving the
  // conversion would have left the ladder scaling off a dead stat.
  const FERAL_TWO_HANDERS = [
    'briarroot_staff',
    'fenshadow_maul',
    'cragthorn_greatstaff',
    'gravewyrm_thornmaul',
    'nightfangs_greatstaff',
    'maul_of_the_scourged_wilds',
    'wildsoul_maul',
  ];

  for (const id of FERAL_TWO_HANDERS) {
    it(`${id} carries Agility and no Strength`, () => {
      const item = ITEMS[id];
      expect(item, `${id} must exist`).toBeDefined();
      expect(item.requiredClass).toEqual(['druid']);
      expect(item.stats?.str ?? 0).toBe(0);
      expect(item.stats?.agi ?? 0).toBeGreaterThan(0);
    });
  }

  it('no leather piece carries Strength, the premise the whole change rests on', () => {
    // The scan the fix is predicated on, run over the LIVE table rather than a
    // hand-list: leather is the feral druid's armor class, so a Strength leather
    // piece would be attack power the conversion silently halves. If one is ever
    // authored, this is the test that should stop it.
    const offenders: string[] = [];
    let leatherSeen = 0;
    for (const [id, item] of Object.entries(ITEMS)) {
      if (item.kind !== 'armor' || item.armorType !== 'leather') continue;
      leatherSeen++;
      if ((item.stats?.str ?? 0) > 0) offenders.push(id);
    }
    expect(leatherSeen, 'the leather ladder should not have vanished').toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it('documents the Strength a feral druid can still reach, so the nerf is deliberate', () => {
    // Class-NEUTRAL items (jewelry, cloth, generic one-handers) are shared with
    // the Strength classes, so this change deliberately did NOT convert them: a
    // feral druid that wears one now gets 1 attack power per Strength instead of
    // 2. That is a known, accepted consequence rather than an oversight, and
    // this pin makes the set visible so it is re-decided rather than forgotten.
    const stillStrength = Object.entries(ITEMS)
      .filter(([, i]) => (i.stats?.str ?? 0) > 0 && i.armorType !== 'leather')
      .filter(([, i]) => !i.requiredClass || i.requiredClass.includes('druid'))
      .map(([id]) => id);
    // None of them is druid-ONLY: every remaining Strength item a druid can wear
    // is shared content, which is exactly why it was left alone.
    for (const id of stillStrength) {
      const req = ITEMS[id].requiredClass;
      expect(req, `${id} is druid-only and should have been converted`).not.toEqual(['druid']);
    }
  });
});
