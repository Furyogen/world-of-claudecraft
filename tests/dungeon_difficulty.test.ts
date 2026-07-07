// Direct unit tests for the heroic-difficulty module pair:
// src/sim/instances/difficulty.ts (the pure transform) and
// src/sim/content/dungeon_difficulty.ts (the tuning data). The integration
// paths (claimInstance, boss adds, marks) are covered in tests/dungeons.test.ts;
// this file pins the pure math and the data contract to exact literals.

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING, HEROIC_MARK_ITEM_ID } from '../src/sim/content/dungeon_difficulty';
import { ITEMS, MOBS } from '../src/sim/data';
import {
  applyHeroicMobTuning,
  claimDifficultyForDungeon,
  HEROIC_DUNGEON_IDS,
  mobLevelForDungeonDifficulty,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import type { Entity, MobTemplate } from '../src/sim/types';

// Round numbers so every transformed field pins to an exact literal below.
const SYNTHETIC: MobTemplate = {
  id: 'synthetic_test_mob',
  name: 'Synthetic Test Mob',
  minLevel: 10,
  maxLevel: 12,
  family: 'humanoid',
  hpBase: 100,
  hpPerLevel: 10,
  dmgBase: 20,
  dmgPerLevel: 2,
  attackSpeed: 2,
  armorPerLevel: 4,
  moveSpeed: 3,
  aggroRadius: 10,
  loot: [],
  scale: 1,
  color: 0xffffff,
};

describe('heroic tuning data contract', () => {
  it('covers exactly the four five-player dungeons with their final bosses', () => {
    expect([...HEROIC_DUNGEON_IDS].sort()).toEqual([
      'drowned_temple',
      'gravewyrm_sanctum',
      'hollow_crypt',
      'sunken_bastion',
    ]);
    expect(
      Object.fromEntries(Object.values(HEROIC_DUNGEON_TUNING).map((t) => [t.id, t.finalBossId])),
    ).toEqual({
      hollow_crypt: 'morthen',
      sunken_bastion: 'vael_the_mistcaller',
      drowned_temple: 'ysolei',
      gravewyrm_sanctum: 'korzul_the_gravewyrm',
    });
    for (const tuning of Object.values(HEROIC_DUNGEON_TUNING)) {
      expect(tuning.level).toBe(20);
      expect(MOBS[tuning.finalBossId], `${tuning.id} finalBossId is a real mob`).toBeTruthy();
    }
    expect(ITEMS[HEROIC_MARK_ITEM_ID]).toBeTruthy();
  });
});

describe('claimDifficultyForDungeon', () => {
  it('grants heroic only to the four supported dungeons', () => {
    expect(claimDifficultyForDungeon('hollow_crypt', 'heroic')).toBe('heroic');
    expect(claimDifficultyForDungeon('gravewyrm_sanctum', 'heroic')).toBe('heroic');
    // Nythraxis quest and raid ids stay normal even when heroic is selected.
    expect(claimDifficultyForDungeon('nythraxis_crypt', 'heroic')).toBe('normal');
    expect(claimDifficultyForDungeon('nythraxis_boss_arena', 'heroic')).toBe('normal');
    expect(claimDifficultyForDungeon('no_such_dungeon', 'heroic')).toBe('normal');
    expect(claimDifficultyForDungeon('hollow_crypt', 'normal')).toBe('normal');
  });
});

describe('mobTemplateForDungeonDifficulty', () => {
  it('returns the SAME template untouched for normal difficulty', () => {
    expect(mobTemplateForDungeonDifficulty(SYNTHETIC, 'hollow_crypt', 'normal')).toBe(SYNTHETIC);
    expect(mobTemplateForDungeonDifficulty(SYNTHETIC, 'no_such_dungeon', 'heroic')).toBe(SYNTHETIC);
  });

  it('produces an exact heroic transform without mutating the base template', () => {
    const before = JSON.stringify(SYNTHETIC);
    const heroic = mobTemplateForDungeonDifficulty(SYNTHETIC, 'hollow_crypt', 'heroic');
    // hollow_crypt tuning: health x1.15, damage x1.1, armor x1.05, level 20.
    expect(heroic).not.toBe(SYNTHETIC);
    expect(heroic.minLevel).toBe(20);
    expect(heroic.maxLevel).toBe(20);
    expect(heroic.hpBase).toBeCloseTo(115, 10);
    expect(heroic.hpPerLevel).toBeCloseTo(11.5, 10);
    expect(heroic.dmgBase).toBeCloseTo(22, 10);
    expect(heroic.dmgPerLevel).toBeCloseTo(2.2, 10);
    expect(heroic.armorPerLevel).toBeCloseTo(4.2, 10);
    // Untouched fields carry over; the base template is never mutated.
    expect(heroic.attackSpeed).toBe(SYNTHETIC.attackSpeed);
    expect(heroic.moveSpeed).toBe(SYNTHETIC.moveSpeed);
    expect(JSON.stringify(SYNTHETIC)).toBe(before);
  });
});

describe('mobLevelForDungeonDifficulty', () => {
  it('pins heroic spawns to the tuning level and passes rolled levels through otherwise', () => {
    expect(mobLevelForDungeonDifficulty('hollow_crypt', 'heroic', 11)).toBe(20);
    expect(mobLevelForDungeonDifficulty('hollow_crypt', 'normal', 11)).toBe(11);
    expect(mobLevelForDungeonDifficulty('no_such_dungeon', 'heroic', 11)).toBe(11);
  });
});

describe('applyHeroicMobTuning', () => {
  it('stamps the fire-time mechanic multipliers only for heroic spawns', () => {
    const mob = { mechanicDamageMult: undefined, mechanicHealMult: undefined } as Entity;
    applyHeroicMobTuning(mob, 'sunken_bastion', 'heroic');
    expect(mob.mechanicDamageMult).toBe(HEROIC_DUNGEON_TUNING.sunken_bastion.damageMultiplier);
    expect(mob.mechanicHealMult).toBe(HEROIC_DUNGEON_TUNING.sunken_bastion.healthMultiplier);

    const normalMob = { mechanicDamageMult: undefined, mechanicHealMult: undefined } as Entity;
    applyHeroicMobTuning(normalMob, 'sunken_bastion', 'normal');
    expect(normalMob.mechanicDamageMult).toBeUndefined();
    applyHeroicMobTuning(normalMob, 'no_such_dungeon', 'heroic');
    expect(normalMob.mechanicDamageMult).toBeUndefined();
  });
});
