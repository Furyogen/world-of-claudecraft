// Rift rank (C/B/A/S) tuning: the one place a rift's baseLevel is turned into
// rank-driven difficulty. Every consumer (the floor generator's mob levels, the
// spawn-time heroic stat transform, the boss mechanic budget, the one-shot
// hazard gate) derives the SAME rank from the descriptor's baseLevel, so the
// authoritative sim, the offline sim, and the headless env all regenerate
// identical difficulty from the wire descriptor. Natural portals map tier ->
// baseLevel via RIFT_RANK_BASE_LEVEL (portals.ts reads it back), and a /dev
// portal picks its rank implicitly through the level it was opened at.
//
// Pure leaf: no SimContext; a Vitest imports it directly.

import { MOBS } from '../data';
import type { Entity, MobTemplate, RiftTier } from '../types';

/** Canonical rank -> portal baseLevel map (portals.ts RIFT_TIER_INFO consumes
 * this, and riftRankForBaseLevel inverts it). */
export const RIFT_RANK_BASE_LEVEL: Record<RiftTier, number> = { C: 20, B: 22, A: 25, S: 28 };

/** The rank a descriptor baseLevel encodes (inverse of RIFT_RANK_BASE_LEVEL,
 * banded so a /dev portal at any level lands in the nearest rank). */
export function riftRankForBaseLevel(baseLevel: number): RiftTier {
  if (baseLevel >= RIFT_RANK_BASE_LEVEL.S) return 'S';
  if (baseLevel >= RIFT_RANK_BASE_LEVEL.A) return 'A';
  if (baseLevel >= RIFT_RANK_BASE_LEVEL.B) return 'B';
  return 'C';
}

// Mob levels by rank. C ramps from its baseLevel (20) and stays inside the
// classic fairness cap (22, two above the level-20 player cap, matching the
// heroic dungeon pin). B, A, and S all hold the 22 cap; their additional
// difficulty comes from the heroic stat transform below. S is additionally
// nudged to flat 23 on every floor, one step above the fairness cap, to
// signal that S-rank is the hardest tier while keeping its mobs at a level
// where the heroic stat transform does the heavy lifting. Giantslayer (+5-level
// kill) is no longer earnable inside S-rank rifts as a result (the maintainer
// explicitly accepted this in v0.23.0 rank retune).
export const RIFT_LEVEL_CAP = 22;
export const RIFT_S_LEVEL = 23;
/** The highest level any rift mob can spawn at (flat S-rank level). Also the
 * game-wide creditable-mob ceiling pinned by deeds (MAX_CREDITABLE_MOB_LEVEL). */
export const RIFT_MAX_MOB_LEVEL = 23;

/** Mob level for a floor: C ramps baseLevel + floorIndex under cap 22;
 * B and A hold a flat 22; S holds a flat 23 on every floor. */
export function riftFloorLevel(baseLevel: number, floorIndex: number): number {
  const rounded = Math.round(baseLevel);
  if (riftRankForBaseLevel(rounded) === 'S') {
    return RIFT_S_LEVEL;
  }
  return Math.max(1, Math.min(RIFT_LEVEL_CAP, rounded + floorIndex));
}

/** How many of a boss template's `rankMechanics` are live per rank. */
export const RIFT_RANK_MECHANIC_BUDGET: Record<RiftTier, number> = { C: 1, B: 2, A: 3, S: 4 };

// The set of driver keys that rank-gating governs. Any key in this set that a
// kit-carrying boss does NOT list in rankMechanics is treated as suppressed at
// all ranks (the displaced-mechanic budget escape fix). Keys absent from this
// set (enrage, knockback, cleave, passive on-hits) are never gated.
const GATED_DRIVER_KEYS = new Set([
  'aoePulse',
  'aoeSlow',
  'bigCast',
  'stoneskin',
  'stomp',
  'terrify',
  'summonAdds',
  'desperateHeal',
  'deathZoneCast',
  'deathZoneStrike',
]);

export function riftMechanicSuppressed(mob: Entity, key: string): boolean {
  const limit = mob.riftMechanicLimit;
  if (limit === undefined) return false;
  const order = MOBS[mob.templateId]?.rankMechanics;
  if (!order) return false;
  const index = order.indexOf(key);
  // Listed keys: suppressed when beyond the budget index.
  if (index >= 0) return index >= limit;
  // Unlisted driver keys on a kit-carrying boss are suppressed at all ranks
  // (budget escape fix: displaced template mechanics must not fire at C/B when
  // the kill-zones slots fill the high indices).
  return GATED_DRIVER_KEYS.has(key);
}

// B-, A-, and S-rank rifts are heroic scaled: a spawn-time stat transform (the
// same shape as instances/difficulty.ts mobTemplateForDungeonDifficulty) plus
// the per-entity mechanicDamageMult/mechanicHealMult applied at each mechanic
// fire site AFTER the rng draw (draw count and order stay identical across
// ranks). The shared gate riftHeroicTuningFor drives four behaviors for all
// three ranks: the stat transform, boss-add scaling (softer addDamageMultiplier),
// boulder lethality, and citadel exclusion (now C-only). The multipliers stay
// below the heroic five-man ladder (damage x4-5); B is the entry rung scaled
// proportionally between no-tuning and A.
export interface RiftHeroicTuning {
  healthMultiplier: number;
  damageMultiplier: number;
  // Boss-summoned add waves land on top of the boss's own output, so they take
  // a softer multiplier (the heroic addDamageMultiplier precedent).
  addDamageMultiplier: number;
  armorMultiplier: number;
}

export const RIFT_HEROIC_TUNING: Partial<Record<RiftTier, RiftHeroicTuning>> = {
  // B is the entry heroic tier: scaled proportionally between no-tuning and A.
  // As with A/S, the shared gate (riftHeroicTuningFor) drives the stat transform,
  // boss-add scaling, boulder lethality, and citadel exclusion (now C-only).
  B: {
    healthMultiplier: 1.5,
    damageMultiplier: 1.35,
    addDamageMultiplier: 1.12,
    armorMultiplier: 1.12,
  },
  A: {
    healthMultiplier: 1.9,
    damageMultiplier: 1.6,
    addDamageMultiplier: 1.25,
    armorMultiplier: 1.25,
  },
  // "heroic_s": S-rank is a full difficulty tier of its own, double the old S
  // hp and damage (the 2026-07-21 playtest: a 5-man of capped players cleared
  // S without pressure). Mobs and the boss hit through damageMultiplier x4
  // (autos via the template transform, mechanics via mechanicDamageMult);
  // non-lethal mechanics stay survivable from full HP through
  // capRiftNonLethalMechanicDamage, and the lethal pressure comes from the
  // telegraphed death zones, the boulder, and S lava instead.
  S: {
    healthMultiplier: 5.0,
    damageMultiplier: 4.0,
    addDamageMultiplier: 3.0,
    armorMultiplier: 1.4,
  },
};

/** heroic_s death-zone tempo: at S rank the lethal telegraphed zones cast (and
 * therefore detonate) this much faster AND recycle this much sooner, so the
 * boss fight stays in constant motion ("make the red circle faster", playtest
 * 2026-07-21). A radius-9 zone at 0.7 tempo still leaves ~1.8s+ to step out at
 * player run speed 7, so every zone remains fully dodgeable from its centre. */
export const RIFT_S_ZONE_TEMPO = 0.7;

/** Non-dodgeable rift mechanic damage (aoePulse, stomp, bigCast: raw numbers
 * with no ground telegraph to step out of) may be VERY threatening but never a
 * one-shot from full health: a single hit is capped below the target's max HP.
 * Dodgeable mechanics (death zones, the boulder, S lava) stay guaranteed kills
 * by design; this cap deliberately does not apply to them. */
export const RIFT_NONLETHAL_MECHANIC_CAP_PCT = 0.9;

export function capRiftNonLethalMechanicDamage(dmg: number, targetMaxHp: number): number {
  return Math.min(dmg, Math.max(1, Math.floor(targetMaxHp * RIFT_NONLETHAL_MECHANIC_CAP_PCT)));
}

/** The heroic rift tuning for a descriptor baseLevel, or null (C only). */
export function riftHeroicTuningFor(baseLevel: number): RiftHeroicTuning | null {
  return RIFT_HEROIC_TUNING[riftRankForBaseLevel(baseLevel)] ?? null;
}

// Every heroic-rift mob moves at least this fast (player RUN_SPEED is 7), the
// same anti-kite floor heroic dungeons use (instances/difficulty.ts).
export const RIFT_HEROIC_MIN_MOVE_SPEED = 8;

/** The spawn-time stat transform for a B/A/S-rank rift mob. Mirrors
 * mobTemplateForDungeonDifficulty (stats only; levels come from
 * riftFloorLevel, and mechanics still read the base MOBS table at fire time,
 * scaled by the per-entity multipliers the spawner sets alongside this). */
export function riftHeroicTemplate(template: MobTemplate, tuning: RiftHeroicTuning): MobTemplate {
  return {
    ...template,
    hpBase: template.hpBase * tuning.healthMultiplier,
    hpPerLevel: template.hpPerLevel * tuning.healthMultiplier,
    dmgBase: template.dmgBase * tuning.damageMultiplier,
    dmgPerLevel: template.dmgPerLevel * tuning.damageMultiplier,
    armorPerLevel: template.armorPerLevel * tuning.armorMultiplier,
    moveSpeed: Math.max(template.moveSpeed, RIFT_HEROIC_MIN_MOVE_SPEED),
  };
}
