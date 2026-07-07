import { HEROIC_DUNGEON_TUNING } from '../content/dungeon_difficulty';
import type { DungeonDifficulty, Entity, MobTemplate } from '../types';

export const HEROIC_DUNGEON_IDS = new Set(Object.keys(HEROIC_DUNGEON_TUNING));

export function claimDifficultyForDungeon(
  dungeonId: string,
  selected: DungeonDifficulty,
): DungeonDifficulty {
  return selected === 'heroic' && HEROIC_DUNGEON_IDS.has(dungeonId) ? 'heroic' : 'normal';
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
  dungeonId: string,
  difficulty: DungeonDifficulty,
  rolledLevel: number,
): number {
  if (difficulty !== 'heroic') return rolledLevel;
  return HEROIC_DUNGEON_TUNING[dungeonId]?.level ?? rolledLevel;
}

// Boss/support mechanic numbers (aoePulse, bigCast, stomp damage; mendAlly,
// wardAllies, stoneskin amounts) are read from the base MOBS table at FIRE
// time, not from the spawn-time transformed template, so the template
// multipliers above cannot reach them. Instead a heroic spawn carries these
// per-entity multipliers, applied at each fire site AFTER the rng draw (the
// draw count and order stay identical to normal, which the parity gate pins).
export function applyHeroicMobTuning(
  mob: Entity,
  dungeonId: string,
  difficulty: DungeonDifficulty,
): void {
  if (difficulty !== 'heroic') return;
  const tuning = HEROIC_DUNGEON_TUNING[dungeonId];
  if (!tuning) return;
  mob.mechanicDamageMult = tuning.damageMultiplier;
  mob.mechanicHealMult = tuning.healthMultiplier;
}
