// Pure item-level budget primitives: the quality/slot weightings and the two
// functions that turn (level, quality, slot) into an exact primary-stat budget and
// redistribute a stat line onto it. A LEAF module with no ./data import, so both
// item_level.ts (the source-index-aware readouts) and content/heroic_variants.ts
// (which runs at data-eval time, before item_level finishes initializing) can share
// this math without an import cycle. item_level.ts re-exports these for back-compat.
import { ENDGAME_MIN_ILVL } from './item_tier';
import type { CoreStats, ItemDef, ItemSlot } from './types';

// The five primary attributes an item can carry (armor is handled separately: it
// is an armor-class/slot property, not part of the comparable stat budget).
export const PRIMARY_STATS = ['str', 'agi', 'sta', 'int', 'spi'] as const;
export type PrimaryStat = (typeof PRIMARY_STATS)[number];

// A rarer item "punches above" the level of the content that drops it. Grounded in
// the classic convention that a blue from a level-N pull outclasses a green from
// the same pull. SUB-CAP ONLY: this drives the derived LEVELLING ladder. Cap-level
// gear is anchored to its tier band instead (item_tier.ts), where quality picks a
// rung inside the tier rather than adding to it, because these bumps span a wider
// range than the whole endgame window.
export const QUALITY_ILVL_BONUS: Record<string, number> = {
  poor: 0,
  common: 0,
  uncommon: 1,
  rare: 3,
  epic: 6,
  legendary: 10,
};

// Share of a level's stat budget that each quality grants. Whites/greys carry no
// primary stats (armor only), greens roughly half, blues most, purples the full
// ladder, mirroring the existing hand-authored content (uncommon mid pieces ~2-4
// pts, class-neutral rares ~5-7 pts; cf. the items.ts budget comment). Legendaries
// are a steep jump (the two in the game are flagship BiS artifacts that should dwarf
// epics), tuned so a capstone legendary weapon lands around its existing power.
export const QUALITY_STAT_MULT: Record<string, number> = {
  poor: 0,
  common: 0,
  uncommon: 0.55,
  rare: 0.8,
  epic: 1.0,
  legendary: 1.9,
};

// Slot weight for the stat budget: chest and main-hand carry the most, the smaller
// slots less. Matches the slot weighting already described for armor in items.ts
// (head ~1.0, shoulder ~0.75, gloves ~0.65, waist ~0.55) applied to stat points.
export const SLOT_STAT_MULT: Record<ItemSlot, number> = {
  mainhand: 1.0,
  offhand: 0.75,
  chest: 1.0,
  legs: 0.9,
  helmet: 0.85,
  shoulder: 0.75,
  waist: 0.7,
  gloves: 0.7,
  feet: 0.65,
  // Jewelry: small slots with no armor contribution. Items declare 'ring'
  // (never a concrete ring1/ring2 key); the concrete keys carry the same
  // weight so budget math is stable whichever form a caller passes.
  neck: 0.65,
  ring: 0.6,
  ring1: 0.6,
  ring2: 0.6,
};

// Primary-stat points granted per item level at full (rare-mult x chest-mult = 1),
// while LEVELLING. Item levels below the endgame anchor ride this line straight from
// the origin, which is what the whole sub-cap ladder was authored against.
export const STAT_PER_ILVL = 0.7;

// Above the anchor the curve gets steeper. Endgame tiers are only one or two item
// levels apart (see item_tier.ts), so on the levelling slope a whole tier step would
// be worth 0.7 stat points before slot weighting: two tiers would round to the same
// number on half the slots and the ladder would read flat. The endgame slope is what
// makes a tier step legible, and it is also what lets the endgame occupy a 10-wide
// band instead of the 17 the additive bumps used to need, at the same absolute power.
//
// Fitted, not invented: 1.1 reproduces the pre-squish budgets of the tiers that kept
// their place in the ladder (a top-tier legendary mainhand lands on 49 either way)
// while widening the per-tier step. The curve is CONTINUOUS at the anchor, so no
// sub-cap item moves.
export const ENDGAME_STAT_PER_ILVL = 1.1;

// The dps counterpart of ENDGAME_STAT_PER_ILVL, fitted the same way against the
// hand-authored weapon ladder: 0.48/ilvl above the anchor puts a top-tier one-hander
// back on the 17.8 dps it carried at the old item level 37.
export const ENDGAME_DPS_PER_ILVL = 0.48;

// Total primary-stat points (before quality/slot weighting) an item level is worth:
// the levelling line up to the anchor, the endgame line above it.
export function statPointCurve(level: number): number {
  if (level <= ENDGAME_MIN_ILVL) return level * STAT_PER_ILVL;
  return ENDGAME_MIN_ILVL * STAT_PER_ILVL + (level - ENDGAME_MIN_ILVL) * ENDGAME_STAT_PER_ILVL;
}

// v0.27.1 re-budget: a two-handed weapon differentiates on weapon DPS (see
// TWOHAND_DPS_MULT below), never on stats. It carries a modest premium over the
// one-handed mainhand line and MUST stay strictly below the combined mainhand +
// offhand slot weights (1.0 + 0.75), so every dual-wield or weapon-and-shield
// setup out-stats a two-hander of the same item level (tests/twohand_rebudget
// pins this). The old value of 2 (both hands' budgets) assumed the offhand slot
// was sacrificed; Titan's Grip broke that assumption by filling both slots with
// two-handers. Consumers apply this only when an ItemDef is a weapon with hand
// 'twohand', rounding the product so budgets stay integral.
export const TWOHAND_STAT_MULT = 1.3;

// The weapon-DPS premium a two-hander carries over the one-hand budget line: the
// damage side of the stat tradeoff above (big slow swings, thinner stat sheet).
// Codifies the previously informal "Eastbrook/Highwatch greatsword rule" (the top
// of the 10-to-15% band) that the zone3 epics were authored against, so items,
// heroic variants, and tests all share one number.
export const TWOHAND_DPS_MULT = 1.15;

// The source level the "Heroic X" upgraded drop variants read as: one heroic tier
// above the level-20 dungeons. The level orders the source index and feeds the equip
// gate; the item level itself comes from the 'heroic_dungeon' band (item_tier.ts).
// content/heroic_variants.ts scales each variant's stats to the matching budget;
// item_level.buildSourceIndex registers every `heroicOf` item at this source level.
export const HEROIC_VARIANT_SOURCE_LEVEL = 22;

// Base weapon DPS a weapon of this item level should deal. Weapon damage tracks item
// level (quality drives the STAT budget instead, see primaryStatBudget). A linear
// curve FIT to the authored weapon ladder, not invented: the ilvl-20 rares sit near
// 11 to 11.5, and slope 0.3/ilvl carries that line up to the endgame anchor.
//
// Above the anchor it steepens to ENDGAME_DPS_PER_ILVL for the same reason the stat
// curve does: the endgame tiers are one to two item levels apart, so the levelling
// slope would leave two tiers of weapon indistinguishable. The two segments meet at
// the anchor, so no sub-cap weapon moves. Two-handers ride TWOHAND_DPS_MULT above
// this line (their side of the stat tradeoff).
export function weaponDpsBudget(level: number): number {
  const anchor = 6.7 + 0.3 * ENDGAME_MIN_ILVL;
  if (level <= ENDGAME_MIN_ILVL) return 6.7 + 0.3 * level;
  return anchor + (level - ENDGAME_MIN_ILVL) * ENDGAME_DPS_PER_ILVL;
}

// Rescale a weapon's min/max damage to hit `dps` at its existing swing speed, keeping
// the low-to-high spread proportional. Returns rounded integers; the realized dps lands
// within rounding of the target. Used to level a heroic upgrade's weapon damage to its
// item level (content/heroic_variants.ts) and to author the heroic set weapons on-curve.
export function scaleWeaponDamage(
  weapon: { min: number; max: number; speed: number },
  dps: number,
): { min: number; max: number } {
  const curAvg = (weapon.min + weapon.max) / 2;
  if (curAvg <= 0) return { min: weapon.min, max: weapon.max };
  const k = (dps * weapon.speed) / curAvg;
  return {
    min: Math.max(1, Math.round(weapon.min * k)),
    max: Math.max(1, Math.round(weapon.max * k)),
  };
}

// The total primary-stat points an item of this level + quality + slot should grant.
export function primaryStatBudget(
  level: number,
  quality: ItemDef['quality'],
  slot: ItemSlot | undefined,
): number {
  if (!slot) return 0;
  const q = QUALITY_STAT_MULT[quality ?? 'common'] ?? 0;
  const s = SLOT_STAT_MULT[slot] ?? 0.7;
  return Math.max(0, Math.round(statPointCurve(level) * q * s));
}

// Redistribute `budget` primary-stat points across whichever attributes the item
// already uses, keeping their ratio (its stat identity) and the integer sum EXACTLY
// equal to `budget`. armor is passed through untouched. Largest-remainder rounding
// makes it deterministic (ties broken by PRIMARY_STATS order). Note: under a very
// lopsided ratio with a tiny budget a minor attribute can still round to 0; the
// authored tiers use balanced ratios where every attribute survives.
export function normalizePrimaryStats(
  stats: Partial<CoreStats>,
  budget: number,
): Partial<CoreStats> {
  const out: Partial<CoreStats> = {};
  if (stats.armor !== undefined) out.armor = stats.armor;
  const present = PRIMARY_STATS.filter((k) => (stats[k] ?? 0) > 0);
  const total = present.reduce((a, k) => a + (stats[k] ?? 0), 0);
  if (present.length === 0 || total === 0 || budget <= 0) return out;
  const parts = present.map((k) => {
    const exact = (budget * (stats[k] ?? 0)) / total;
    const base = Math.floor(exact);
    return { k, base, frac: exact - base };
  });
  let assigned = parts.reduce((a, p) => a + p.base, 0);
  // Hand out the leftover points to the largest fractional parts first; the stable
  // PRIMARY_STATS order keeps ties deterministic across runs and hosts.
  const order = [...parts].sort((a, b) => b.frac - a.frac);
  for (let i = 0; assigned < budget; i++, assigned++) order[i % order.length].base += 1;
  for (const p of parts) out[p.k] = p.base;
  return out;
}
