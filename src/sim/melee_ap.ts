// Melee attack-power conversion: WHICH primary attributes feed a class's attack
// power, at what weight, and what the druid's feral forms add on top.
//
// A pure leaf (types only, no ./data import, no rng, no DOM) so the consumers
// share one source of truth and cannot drift: `recalcPlayerStats`
// (src/sim/entity.ts) derives the real number, `src/ui/stat_tooltip.ts` explains
// it on the character sheet, and the tests pin it.
//
// WHAT THIS CHANGES, and the tradeoff it carries. A druid converts attack power
// from Strength at 2/point in every form. This module moves the two FERAL forms
// (Wolf and Bruin) onto the ROGUE line, str + agi, so that a feral druid scales
// from the Agility its leather carries the way the other two leather classes do.
//
// That is a DESIGN choice with a real cost, not a free fix, and reviewers should
// weigh it rather than assume it: the catalog currently ships druid-only
// STRENGTH leather (the bramblehide, wildfang emberhide and crucible_str sets)
// mirrored slot-for-slot against the shared Agility line (packlord emberhide and
// friends). Under 2/str those two lines are worth very different amounts to a
// druid, which is what keeps feral off the rogue loot pool. Under str + agi they
// converge, so this change devalues the Strength line by design and re-points
// feral at the shared Agility one. The PR body carries the measured numbers.
import type { PlayerClass } from './types';

/** Attack power gained per point of each primary attribute. */
export interface MeleeApWeights {
  readonly str: number;
  readonly agi: number;
}

// The 2/str line: the mail/plate melee classes plus the druid's CASTER form.
const DOUBLE_STR_CLASSES: ReadonlySet<PlayerClass> = new Set<PlayerClass>([
  'warrior',
  'paladin',
  'shaman',
  'druid',
]);

// The classes whose melee attack power also converts from Agility, at 1/point.
const AGI_AP_CLASSES: ReadonlySet<PlayerClass> = new Set<PlayerClass>(['rogue', 'hunter']);

/** The conversion a feral druid (Wolf Form / Bruin Form) uses: the rogue line. */
export const FERAL_AP_WEIGHTS: MeleeApWeights = { str: 1, agi: 1 };

/** True for the two druid shapeshifts that fight in melee and convert on the
 *  rogue line. Travel Form and Moonwing Form are NOT feral: they keep the
 *  caster-form conversion. */
export function isFeralApForm(kind: string): boolean {
  return kind === 'form_bear' || kind === 'form_cat';
}

/** The attribute weights for one class in one shapeshift state. `feralForm` is
 *  true only while a druid holds a `form_bear` or `form_cat` aura. */
export function meleeApWeights(cls: PlayerClass, feralForm: boolean): MeleeApWeights {
  if (cls === 'druid' && feralForm) return FERAL_AP_WEIGHTS;
  return {
    str: DOUBLE_STR_CLASSES.has(cls) ? 2 : 1,
    agi: AGI_AP_CLASSES.has(cls) ? 1 : 0,
  };
}

/** Melee attack power contributed by the primary attributes alone, BEFORE the
 *  flat form/gear/buff bonuses and the AP percent multipliers. */
export function meleeApFromAttributes(
  cls: PlayerClass,
  feralForm: boolean,
  str: number,
  agi: number,
): number {
  const w = meleeApWeights(cls, feralForm);
  return str * w.str + agi * w.agi;
}

// --- the feral form bonuses, on top of the conversion above -----------------

/** Bruin Form's flat attack power, before its Agility term. */
export const BEAR_FORM_FLAT_AP = 15;

/** Bruin Form's Agility-to-attack-power bridge.
 *
 *  This term predates the feral conversion above and existed BECAUSE the druid
 *  had no Agility line at all: without it Bruin Form scaled off nothing a druid
 *  could wear. Now that `meleeApWeights` converts Agility for both feral forms,
 *  the old 1.5 coefficient would double-count it and hand the TANK form 2.5
 *  attack power per Agility against Wolf Form's 1.0.
 *
 *  Retuned to 0.8, calibrated on the AGILITY leather line, which is the line
 *  this change re-points feral at: a level-20 best-in-slot Agility-geared bear
 *  lands within about 1% of its pre-change attack power (pinned in
 *  tests/melee_ap.test.ts). A bear still wearing the druid-only STRENGTH leather
 *  comes out roughly a third lower, and no coefficient recovers that, because
 *  devaluing the Strength line is what this change does on purpose. */
export const BEAR_FORM_AGI_AP_PER_POINT = 0.8;

/** Bruin Form's attack-power bonus for a given (fully summed) Agility.
 *
 *  `agi` is expected already floored at 0, which `recalcPlayerStats` does one
 *  step before it reaches here. Deliberately no clamp of its own: this is a
 *  move of the expression that used to sit inline in entity.ts, and adding
 *  defensive handling for a case the one caller cannot produce would make the
 *  extraction a rewrite. */
export function bearFormBonusAp(agi: number): number {
  return BEAR_FORM_FLAT_AP + Math.round(agi * BEAR_FORM_AGI_AP_PER_POINT);
}

/** Wolf Form's attack-power bonus: flat and level-scaled, never stat-scaled
 *  (its stat scaling comes from the feral conversion). */
export function catFormBonusAp(level: number): number {
  return 8 + level * 2;
}

/** The Agility Wolf Form itself grants, which then feeds the feral conversion,
 *  crit, dodge, and armor like any other Agility. */
export function catFormAgiBonus(level: number): number {
  return Math.max(2, Math.floor(level / 2));
}
