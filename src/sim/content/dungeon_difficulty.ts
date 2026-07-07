import type { DungeonDifficulty } from '../types';

// The participation token every eligible player can loot once from a heroic
// final-boss corpse (a personalFor slot per participant; see awardHeroicMarks
// in ../instances/dungeons.ts). The item record lives in ./items.ts.
export const HEROIC_MARK_ITEM_ID = 'heroic_mark';

export interface HeroicDungeonTuning {
  id: string;
  difficulty: Extract<DungeonDifficulty, 'heroic'>;
  level: number;
  healthMultiplier: number;
  damageMultiplier: number;
  armorMultiplier: number;
  // The dungeon's last boss: killing it in a heroic instance drops one Heroic
  // Mark per eligible participant.
  finalBossId: string;
}

// Tuning model follows classic-era (TBC) heroics, calibrated against MEASURED
// database pairs (normal vs heroic raw melee damage): Watchkeeper Gargolmar
// 3.00x, Nazan 3.28x, Omor 3.42x, and, critically, the cap-level Shattered
// Halls' Kargath Bladefist ALSO 3.50x, so the damage jump was flat across
// leveling and endgame dungeons. Health followed the cap-band level jump
// (roughly 3x for leveling dungeons, a smaller ~1.5-2x for already-cap
// normals). One deliberate deviation: TBC tanks mitigated 60-70% of raw
// swings while a level-20 tank here mitigates ~15%, so the multipliers below
// target TBC's EFFECTIVE severity (boss on tank ~20-30% of tank HP per
// swing, trash on cloth ~40-60%) rather than the raw 3.5x, which lands the
// overall raw ratios at ~2.7-3.2x. Recompute the bands with the level-20 pin
// included: e.g. Hollow Crypt L10 mobs already gain ~1.6x health and ~1.8x
// damage from the level bump alone. Mechanic damage/heals scale with these
// too (mechanicDamageMult/mechanicHealMult in ../instances/difficulty.ts).
export const HEROIC_DUNGEON_TUNING: Record<string, HeroicDungeonTuning> = {
  hollow_crypt: {
    id: 'hollow_crypt',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.9,
    damageMultiplier: 1.8,
    armorMultiplier: 1.3,
    finalBossId: 'morthen',
  },
  sunken_bastion: {
    id: 'sunken_bastion',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 2.0,
    damageMultiplier: 2.2,
    armorMultiplier: 1.3,
    finalBossId: 'vael_the_mistcaller',
  },
  drowned_temple: {
    id: 'drowned_temple',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 2.6,
    damageMultiplier: 2.8,
    armorMultiplier: 1.25,
    finalBossId: 'ysolei',
  },
  gravewyrm_sanctum: {
    id: 'gravewyrm_sanctum',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 2.0,
    damageMultiplier: 2.7,
    armorMultiplier: 1.2,
    finalBossId: 'korzul_the_gravewyrm',
  },
};
