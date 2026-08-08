// Endgame item-level bands: the tier a piece of cap-level gear belongs to, and the
// item level that tier grants it.
//
// Below the level cap an item level is DERIVED (source level + the quality bump, see
// item_level.ts): a level-7 rare reads item level 10 because it drops at level 7 and
// rares punch three levels above their source. That derivation is right while a
// character is levelling, because the source level IS the progression axis.
//
// At the cap it stops working. Every endgame source sits at the same character level,
// so the only thing separating a normal dungeon drop from a heroic raid drop is the
// pile of additive bumps (quality, raid, heroic source levels). Those bumps span more
// than the whole endgame window: the quality bump alone runs from +1 (uncommon) to
// +10 (legendary), which pushed the ladder to item level 37 against a level cap of 20
// and left no room for the next cap's tiers.
//
// So cap-level content is ANCHORED instead: each tier owns an explicit, contiguous
// item-level band, and quality only picks a rung inside its own tier's band. The
// ladder is then a property of the CONTENT ladder (normal dungeon, normal raid,
// heroic dungeon, heroic raid, legendary) rather than an accident of additive
// bonuses, and it stays inside a fixed window under the cap.
//
// Pure leaf: no ./data import and no state, so both item_level.ts (which resolves the
// tier from the source index) and content/heroic_variants.ts (which runs at data-eval
// time, before item_level finishes initializing) can share it without a cycle.

import type { ItemDef } from './types';

// The four cap-level content tiers, in progression order. An item outside these
// (anything that drops below the cap) has no tier and keeps the derived item level.
export type EndgameTier = 'dungeon' | 'raid' | 'heroic_dungeon' | 'heroic_raid';

export const ENDGAME_TIERS: readonly EndgameTier[] = [
  'dungeon',
  'raid',
  'heroic_dungeon',
  'heroic_raid',
];

type Quality = NonNullable<ItemDef['quality']>;

// The item level each tier grants each quality. Bands are contiguous and do not
// overlap, so a tier's worst drop still reads above the tier below it:
//
//   normal five-man dungeons  21 to 23
//   normal Nythraxis raid     24 to 25
//   heroic five-man dungeons  26 to 27
//   heroic Nythraxis raid     28 to 29
//   legendaries               30 (normal) / 31 (heroic)
//
// Legendaries sit in their own band above every tier: they are flagship artifacts,
// not "one rung better than the epic in the same instance", and they are the pieces
// meant to carry an upgrade path later. Uncommon shares its tier's low rung with
// rare (no tier ships both), and poor/common carry no stat budget at all, so they
// only need a defined value, never a distinct one.
const BANDS: Record<EndgameTier, Record<Quality, number>> = {
  dungeon: { poor: 21, common: 21, uncommon: 21, rare: 22, epic: 23, legendary: 30 },
  raid: { poor: 24, common: 24, uncommon: 24, rare: 24, epic: 25, legendary: 30 },
  heroic_dungeon: { poor: 26, common: 26, uncommon: 26, rare: 26, epic: 27, legendary: 31 },
  heroic_raid: { poor: 28, common: 28, uncommon: 28, rare: 28, epic: 29, legendary: 31 },
};

// The lowest and highest item level any endgame tier grants. ENDGAME_MIN_ILVL is
// also the anchor the stat/dps budget curves pivot on (item_budget.ts): at and below
// it the levelling curve applies unchanged, above it the endgame curve takes over.
export const ENDGAME_MIN_ILVL = 21;
export const ENDGAME_MAX_ILVL = 31;

// The item level `tier` grants an item of `quality`.
export function endgameItemLevel(tier: EndgameTier, quality: ItemDef['quality']): number {
  return BANDS[tier][quality ?? 'common'];
}

// The contiguous band a tier spans, lowest rung to highest, across every quality
// EXCEPT legendary (which lives in its own band above all four tiers).
export function tierBand(tier: EndgameTier): { min: number; max: number } {
  const rungs = (Object.entries(BANDS[tier]) as [Quality, number][])
    .filter(([quality]) => quality !== 'legendary')
    .map(([, level]) => level);
  return { min: Math.min(...rungs), max: Math.max(...rungs) };
}
