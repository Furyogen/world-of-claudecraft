import { HEROIC_DUNGEON_TUNING } from '../content/dungeon_difficulty';
import type { DungeonDifficulty, MobTemplate } from '../types';

export const HEROIC_DUNGEON_IDS = new Set(Object.keys(HEROIC_DUNGEON_TUNING));

export function claimDifficultyForDungeon(
  dungeonId: string,
  selected: DungeonDifficulty,
): DungeonDifficulty {
  return selected === 'heroic' && HEROIC_DUNGEON_IDS.has(dungeonId) ? 'heroic' : 'normal';
}

export function dungeonSupportsDifficulty(
  dungeonId: string,
  difficulty: DungeonDifficulty,
): boolean {
  return difficulty === 'normal' || HEROIC_DUNGEON_IDS.has(dungeonId);
}

export function mobTemplateForDungeonDifficulty(
  template: MobTemplate,
  dungeonId: string,
  difficulty: DungeonDifficulty,
): MobTemplate {
  if (difficulty !== 'heroic') return template;
  const tuning = HEROIC_DUNGEON_TUNING[dungeonId];
  if (!tuning) return template;
  return {
    ...template,
    minLevel: tuning.level,
    maxLevel: tuning.level,
    hpBase: template.hpBase * tuning.healthMultiplier,
    hpPerLevel: template.hpPerLevel * tuning.healthMultiplier,
    dmgBase: template.dmgBase * tuning.damageMultiplier,
    dmgPerLevel: template.dmgPerLevel * tuning.damageMultiplier,
    armorPerLevel: template.armorPerLevel * tuning.armorMultiplier,
  };
}

export function mobLevelForDungeonDifficulty(
  _template: MobTemplate,
  dungeonId: string,
  difficulty: DungeonDifficulty,
  rolledLevel: number,
): number {
  if (difficulty !== 'heroic') return rolledLevel;
  return HEROIC_DUNGEON_TUNING[dungeonId]?.level ?? rolledLevel;
}
