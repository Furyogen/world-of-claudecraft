// The feral druid attack-power conversion (src/sim/melee_ap.ts).
//
// The defect this pins: a druid's attack power converted from Strength at 2/point
// in EVERY form, but the leather a feral druid wears carries Agility and never
// Strength, so its whole armor set contributed zero attack power. Wolf Form and
// Bruin Form now convert on the rogue line (str + agi) instead.
//
// Every numeric claim below is reconciled against the ONE place the sim derives
// stats (recalcPlayerStats), never against the module's own constants, so the pin
// fails if either side drifts.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import { recalcPlayerStats } from '../src/sim/entity';
import {
  BEAR_FORM_AGI_AP_PER_POINT,
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
    // The level-20 best-in-slot feral set this change was measured against: the
    // highest-Agility leather piece in each armor slot plus the best two-hander.
    // Both the FORMULA and the GEAR moved, so the honest comparison runs each
    // side with its own, and that is what these two lines are.
    const BASE_STR = 34; // level-20 druid class base
    const BASE_AGI = 34;
    const ARMOR_AGI = 75; // the seven best-Agility leather pieces, no weapon
    // Before: the armor set, plus wildsoul_maul's 13 Strength / 9 Agility.
    const beforeStr = BASE_STR + 13;
    const beforeAgi = BASE_AGI + ARMOR_AGI + 9;
    const before = beforeStr * 2 + 15 + Math.round(beforeAgi * 1.5);
    // After: the same set, with the two-hander's Strength folded into Agility.
    const afterStr = BASE_STR;
    const afterAgi = BASE_AGI + ARMOR_AGI + 22;
    const after =
      meleeApFromAttributes('druid', true, afterStr, afterAgi) + bearFormBonusAp(afterAgi);

    expect(before).toBe(286);
    expect(Math.abs(after - before) / before).toBeLessThan(0.02);
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

  it('leaves no druid-equippable Strength on the feral ladder', () => {
    for (const id of FERAL_TWO_HANDERS) {
      expect(ITEMS[id].stats?.str ?? 0).toBe(0);
    }
  });
});
