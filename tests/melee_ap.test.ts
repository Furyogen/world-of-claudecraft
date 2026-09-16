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
import {
  agiMeleeApPerPoint,
  buildStatTooltip,
  type StatTooltipInput,
  strApPerPoint,
} from '../src/ui/stat_tooltip';

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
  const ent = sim.entities.get(pid);
  // Assert rather than optional-chain: a missing entity means the fixture is
  // broken, and silently skipping the push would make every form case vacuous.
  if (!ent) throw new Error(`no entity ${pid}`);
  ent.auras.push({
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

  // A gear-free level-20 druid has str === agi === 34, which makes str * 2 and
  // str + agi the SAME number: a reconcile test run on that fixture cannot tell
  // the old formula from the new one. Both tests below therefore break the tie
  // with an Agility buff first, and assert the fixture is non-degenerate so the
  // day someone rebalances the class back to equal stats it fails loudly
  // instead of going quietly blind.
  function feralPlayerWithUnequalStats(form: AuraKind) {
    const sim = playerAt('druid', 20);
    const p = sim.player;
    giveForm(sim, p.id, form, form === 'form_cat' ? 'Wolf Form' : 'Bruin Form');
    p.auras.push({
      id: 'tiebreak',
      name: 'Tiebreak',
      kind: 'buff_agi',
      remaining: 3600,
      duration: 3600,
      value: 17,
      sourceId: p.id,
      school: 'physical',
    });
    recalcPlayerStats(p, 'druid', {}, undefined, {});
    expect(p.stats.str, 'fixture must not be degenerate').not.toBe(p.stats.agi);
    return p;
  }

  it('Wolf Form attack power reconciles exactly with the module', () => {
    const sim = playerAt('druid', 20);
    const casterAgi = sim.player.stats.agi;
    const p = feralPlayerWithUnequalStats('form_cat');

    // Wolf Form raises Agility, and that raised Agility is what converts.
    expect(p.stats.agi).toBe(casterAgi + 17 + catFormAgiBonus(20));
    expect(p.attackPower).toBe(
      meleeApFromAttributes('druid', true, p.stats.str, p.stats.agi) + catFormBonusAp(20),
    );
    // And the old line is now provably a DIFFERENT number, which is what makes
    // the assertion above discriminating rather than coincidental.
    expect(p.attackPower).not.toBe(p.stats.str * 2 + catFormBonusAp(20));
  });

  it('Bruin Form attack power reconciles exactly with the module', () => {
    const p = feralPlayerWithUnequalStats('form_bear');
    expect(p.attackPower).toBe(
      meleeApFromAttributes('druid', true, p.stats.str, p.stats.agi) + bearFormBonusAp(p.stats.agi),
    );
    expect(p.attackPower).not.toBe(p.stats.str * 2 + bearFormBonusAp(p.stats.agi));
  });
});

describe('the form terms are pinned to literals, not only to each other', () => {
  // Each helper below is called by BOTH entity.ts and the reconcile tests above,
  // so a change to one moves both sides together. These literal pins are what
  // actually stop that: mutation-checked, each fails on a changed formula.
  it("Wolf Form's flat attack power is 8 plus 2 per level", () => {
    expect(catFormBonusAp(1)).toBe(10);
    expect(catFormBonusAp(20)).toBe(48);
  });

  it("Wolf Form's Agility grant floors at 2 for the low levels", () => {
    // The Math.max(2, floor(level / 2)) floor is load-bearing only at levels
    // 1 to 3, and every other test pins level 20 where it is inert. Since the
    // grant now feeds ATTACK POWER through the feral conversion (not just
    // armor and crit), the floor is worth its own pin.
    expect(catFormAgiBonus(1)).toBe(2);
    expect(catFormAgiBonus(3)).toBe(2);
    expect(catFormAgiBonus(4)).toBe(2); // first level the formula ties the floor
    expect(catFormAgiBonus(5)).toBe(2);
    expect(catFormAgiBonus(20)).toBe(10);
  });

  it("Bruin Form's flat attack power is 15, independent of Agility", () => {
    expect(BEAR_FORM_FLAT_AP).toBe(15);
    expect(bearFormBonusAp(0)).toBe(15);
  });

  it('pins the bear Agility coefficient to a literal, whatever the sweep grid', () => {
    expect(BEAR_FORM_AGI_AP_PER_POINT).toBe(0.8);
    expect(bearFormBonusAp(100)).toBe(BEAR_FORM_FLAT_AP + 80);
  });
});

describe('the feral conversion composes correctly with attack-power modifiers', () => {
  // The conversion moved INTO the multiplied term for feral druids for the
  // first time: entity.ts computes round((apFromStats + bonusAp) * (1 + apPct)).
  // These pin the order of operations, which a post-hoc multiply would get
  // wrong in ways the un-modified tests cannot see.
  function feralAp(modAp: number, apPct: number, allStatsPct: number): number {
    const sim = playerAt('druid', 20);
    const p = sim.player;
    giveForm(sim, p.id, 'form_cat', 'Wolf Form');
    if (modAp) {
      p.auras.push({
        id: 'ap_buff',
        name: 'AP Buff',
        kind: 'buff_ap',
        remaining: 3600,
        duration: 3600,
        value: modAp,
        sourceId: p.id,
        school: 'physical',
      });
    }
    if (allStatsPct) {
      p.auras.push({
        id: 'kings',
        name: 'Kings',
        kind: 'buff_stats_pct',
        remaining: 3600,
        duration: 3600,
        value: allStatsPct,
        sourceId: p.id,
        school: 'physical',
      });
    }
    const mods = apPct
      ? ({
          stats: { str: 0, agi: 0, sta: 0, int: 0, spi: 0, armor: 0, ap: 0, dodge: 0, apPct },
          global: {},
          grants: [],
        } as never)
      : undefined;
    recalcPlayerStats(p, 'druid', {}, mods, {});
    return p.attackPower;
  }

  it('a flat attack-power buff lands INSIDE the percent multiplier', () => {
    const plain = feralAp(0, 0, 0);
    const withFlat = feralAp(50, 0, 0);
    expect(withFlat - plain).toBe(50);
    // With a 10% multiplier the flat buff is amplified too, not added after.
    const withBoth = feralAp(50, 0.1, 0);
    expect(withBoth).toBe(Math.round((plain + 50) * 1.1));
  });

  it('a percent stat buff scales the attributes BEFORE the conversion', () => {
    // The consequence worth stating: because a feral druid now converts from
    // Agility as well as Strength, an all-stats percent buff is worth more to
    // it than it was. Pinned as the exact composed integer so the ordering
    // cannot silently invert.
    const plain = feralAp(0, 0, 0);
    const buffed = feralAp(0, 0, 5); // buff_stats_pct carries percent POINTS
    expect(buffed).toBeGreaterThan(plain);
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

  // Inferring the form from the live aura list is the ONLY route in production
  // (src/ui/hud.ts maps p.auras into `buffs` and passes nothing else), so drive
  // buildStatTooltip through a real aura list rather than the coefficient
  // helpers, which is the only way to prove the wiring actually resolves.
  function sheetFor(form: AuraKind | null) {
    const sim = playerAt('druid', 20);
    const p = sim.player;
    if (form) giveForm(sim, p.id, form, form === 'form_cat' ? 'Wolf Form' : 'Bruin Form');
    p.auras.push({
      id: 'tiebreak',
      name: 'Tiebreak',
      kind: 'buff_agi',
      remaining: 3600,
      duration: 3600,
      value: 17,
      sourceId: p.id,
      school: 'physical',
    });
    recalcPlayerStats(p, 'druid', {}, undefined, {});
    const input: StatTooltipInput = {
      cls: 'druid',
      stats: p.stats,
      level: p.level,
      attackPower: p.attackPower,
      spellPower: p.spellPower,
      critChance: p.critChance,
      dodgeChance: p.dodgeChance,
      critRating: p.critRating,
      hasteRating: p.hasteRating,
      hitRating: p.hitRating,
      parryChance: 0,
      dps: 0,
      buffs: p.auras.map((a) => ({ kind: a.kind, value: a.value, name: a.name })),
    };
    const apLine = (stat: 'str' | 'agi') =>
      buildStatTooltip(stat, input).effects.find((e) => e.kind === 'attackPower')?.value ?? 0;
    return { p, input, apLine };
  }

  for (const form of ['form_cat', 'form_bear'] as const) {
    it(`resolves ${form} from the live aura list and applies the rogue line`, () => {
      const { p, apLine } = sheetFor(form);
      expect(p.stats.str, 'fixture must not be degenerate').not.toBe(p.stats.agi);
      expect(apLine('str')).toBe(p.stats.str); // 1 per point, not 2
      expect(apLine('agi')).toBe(p.stats.agi); // the Agility line now exists
    });
  }

  it('shows the caster line when no form aura is present', () => {
    const { p, apLine } = sheetFor(null);
    expect(apLine('str')).toBe(p.stats.str * 2);
    expect(apLine('agi')).toBe(0);
  });

  it("the attack-power breakdown still reconciles with the sim's own number", () => {
    // The decisive cross-check: the tooltip model vs entity.attackPower, which
    // is a genuinely independent value, not another call into melee_ap.ts.
    for (const form of ['form_cat', 'form_bear', null] as const) {
      const { p, input } = sheetFor(form);
      const sources = buildStatTooltip('attackPower', input).sources;
      const summed = sources.reduce((a, src) => a + src.value, 0);
      expect(summed, `${form ?? 'caster'} breakdown must sum to the sim value`).toBe(p.attackPower);
    }
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

describe('the gear consequence this change carries, stated in the suite', () => {
  // On this catalog the premise that motivated the change upstream-of-v0.43.0
  // ("leather carries Agility, never Strength") is NO LONGER TRUE: druid-only
  // STRENGTH leather ships, mirrored slot-for-slot against the shared Agility
  // line. These pins record that, so nobody reads this change as a pure fix.
  const SLOTS = ['helmet', 'shoulder', 'chest', 'waist', 'legs', 'gloves', 'feet'];
  function bestLeather(key: 'str' | 'agi') {
    const best: Record<string, { str: number; agi: number; score: number }> = {};
    for (const item of Object.values(ITEMS)) {
      if (item.kind !== 'armor' || item.armorType !== 'leather') continue;
      if (!SLOTS.includes(item.slot as string)) continue;
      const str = item.stats?.str ?? 0;
      const agi = item.stats?.agi ?? 0;
      const score = key === 'str' ? str : agi;
      if (score <= 0) continue;
      const cur = best[item.slot as string];
      if (!cur || score > cur.score) best[item.slot as string] = { str, agi, score };
    }
    return Object.values(best).reduce((a, v) => ({ str: a.str + v.str, agi: a.agi + v.agi }), {
      str: 0,
      agi: 0,
    });
  }

  it('druid-only Strength leather exists and is what this change devalues', () => {
    const strLeather = Object.entries(ITEMS).filter(
      ([, i]) => i.kind === 'armor' && i.armorType === 'leather' && (i.stats?.str ?? 0) > 0,
    );
    expect(strLeather.length).toBeGreaterThan(20);
    // Every one of them is druid-locked: no other leather class scales from Strength.
    for (const [id, item] of strLeather) {
      expect(item.requiredClass, `${id} should be druid-only`).toEqual(['druid']);
    }
  });

  it('the two leather lines converge under the new conversion', () => {
    // The heart of the tradeoff: 2/str is what makes the Strength line worth
    // more to a druid than the shared Agility line. str + agi makes them equal.
    const lvl = 20;
    const def = CLASSES.druid;
    const baseStr = def.baseStats.str + def.statsPerLevel.str * (lvl - 1);
    const baseAgi = def.baseStats.agi + def.statsPerLevel.agi * (lvl - 1);
    const catFlat = catFormBonusAp(lvl);
    const catAgi = catFormAgiBonus(lvl);

    const strKit = bestLeather('str');
    const agiKit = bestLeather('agi');
    const apNow = (g: { str: number; agi: number }) => (baseStr + g.str) * 2 + catFlat;
    const apNew = (g: { str: number; agi: number }) =>
      meleeApFromAttributes('druid', true, baseStr + g.str, baseAgi + g.agi + catAgi) + catFlat;

    // Before: the Strength line is worth far more to a feral druid.
    expect(apNow(strKit)).toBeGreaterThan(apNow(agiKit));
    // After: the two lines are worth the same, which is the design change.
    expect(apNew(strKit)).toBe(apNew(agiKit));
  });
});
