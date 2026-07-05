import type { DungeonDifficulty } from '../types';

export interface HeroicDungeonTuning {
  id: string;
  difficulty: Extract<DungeonDifficulty, 'heroic'>;
  level: number;
  healthMultiplier: number;
  damageMultiplier: number;
  armorMultiplier: number;
}

export const HEROIC_DUNGEON_TUNING: Record<string, HeroicDungeonTuning> = {
  hollow_crypt: {
    id: 'hollow_crypt',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.15,
    damageMultiplier: 1.1,
    armorMultiplier: 1.05,
  },
  sunken_bastion: {
    id: 'sunken_bastion',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.12,
    damageMultiplier: 1.08,
    armorMultiplier: 1.05,
  },
  drowned_temple: {
    id: 'drowned_temple',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.1,
    damageMultiplier: 1.06,
    armorMultiplier: 1.04,
  },
  gravewyrm_sanctum: {
    id: 'gravewyrm_sanctum',
    difficulty: 'heroic',
    level: 20,
    healthMultiplier: 1.08,
    damageMultiplier: 1.05,
    armorMultiplier: 1.03,
  },
};
