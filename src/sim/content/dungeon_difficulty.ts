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

// Tuning model follows classic-era (TBC) heroics: every mob jumps to the cap
// band (the level-20 pin) and then carries a LARGE flat multiplier, so a
// heroic mob lands at roughly 3x the health and 2.5x the damage of its own
// normal-mode version for the leveling dungeons. The level-20 pin already
// supplies part of that for low dungeons (Hollow Crypt L10 mobs gain ~1.6x
// health from the level bump alone), so the per-dungeon multipliers below
// SHRINK as the dungeon's normal tuning level rises; Gravewyrm Sanctum
// (already L20 on normal) carries its whole heroic jump in the multiplier,
// at the smaller endgame-dungeon ratio (~1.8x health, ~1.5x damage), like a
// cap-level dungeon's heroic. Mechanic damage/heals scale with these too
// (mechanicDamageMult/mechanicHealMult in ../instances/difficulty.ts).
export const HEROIC_DUNGEON_TUNING: Record<string, HeroicDungeonTuning> = {
  hollow_crypt: {
    id: 'hollow_crypt',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.9,
    damageMultiplier: 1.55,
    armorMultiplier: 1.3,
    finalBossId: 'morthen',
  },
  sunken_bastion: {
    id: 'sunken_bastion',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 2.0,
    damageMultiplier: 1.6,
    armorMultiplier: 1.3,
    finalBossId: 'vael_the_mistcaller',
  },
  drowned_temple: {
    id: 'drowned_temple',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 2.6,
    damageMultiplier: 2.2,
    armorMultiplier: 1.25,
    finalBossId: 'ysolei',
  },
  gravewyrm_sanctum: {
    id: 'gravewyrm_sanctum',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.8,
    damageMultiplier: 1.5,
    armorMultiplier: 1.2,
    finalBossId: 'korzul_the_gravewyrm',
  },
};
