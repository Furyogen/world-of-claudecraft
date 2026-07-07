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

export const HEROIC_DUNGEON_TUNING: Record<string, HeroicDungeonTuning> = {
  hollow_crypt: {
    id: 'hollow_crypt',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.15,
    damageMultiplier: 1.1,
    armorMultiplier: 1.05,
    finalBossId: 'morthen',
  },
  sunken_bastion: {
    id: 'sunken_bastion',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.12,
    damageMultiplier: 1.08,
    armorMultiplier: 1.05,
    finalBossId: 'vael_the_mistcaller',
  },
  drowned_temple: {
    id: 'drowned_temple',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.1,
    damageMultiplier: 1.06,
    armorMultiplier: 1.04,
    finalBossId: 'ysolei',
  },
  gravewyrm_sanctum: {
    id: 'gravewyrm_sanctum',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.08,
    damageMultiplier: 1.05,
    armorMultiplier: 1.03,
    finalBossId: 'korzul_the_gravewyrm',
  },
};
