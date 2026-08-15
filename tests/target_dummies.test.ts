// The Highwatch practice row: the three simulation dummies that stand beside the
// original Training Dummy (a friendly healing target, plus normal and heroic boss
// dummies). Two things are being pinned here.
//
// 1. FIXTURE BEHAVIOR. Each new dummy must be as inert as the Training Dummy it
//    joins: never aggros, never moves, never fights back, cannot be pulled off
//    its marker, and stands where the row says it stands.
// 2. DERIVED NUMBERS. The templates carry armor and health literals (a
//    MobTemplate is data, so it cannot compute them), but the literals are
//    copies of real values that live elsewhere: Nythraxis' armor on both
//    difficulties, and a level-20 best-in-slot player's pool. This suite
//    recomputes each one from its real source and fails when they drift apart,
//    so a Nythraxis retune or an item-table change cannot silently leave a
//    dummy simulating a boss that no longer exists.
import { describe, expect, it } from 'vitest';
import { isPullEligible } from '../src/sim/combat/pull_eligibility';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { ZONE3_PRACTICE_DUMMY_CAMPS } from '../src/sim/content/zone3';
import { BUILTIN_WORLD, CAMPS, MOBS } from '../src/sim/data';
import { bestEpicGearFor } from '../src/sim/dev/bis_gear';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, EquipSlot, WorldContent } from '../src/sim/types';
import { groundHeight, WATER_LEVEL } from '../src/sim/world';

const ROW_TEMPLATE_IDS = [
  'friendly_player_dummy',
  'training_dummy',
  'normal_boss_dummy',
  'heroic_boss_dummy',
] as const;

const NEW_TEMPLATE_IDS = [
  'friendly_player_dummy',
  'normal_boss_dummy',
  'heroic_boss_dummy',
] as const;

// Only the practice row matters here, so the rest of the built-in world is pure
// Sim-construction overhead (the same trim tests/training_dummy.test.ts makes).
const PRACTICE_ROW_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) =>
    (ROW_TEMPLATE_IDS as readonly string[]).includes(camp.mobId),
  ),
  npcs: {},
  groundObjects: [],
};

function makeWorld(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: PRACTICE_ROW_WORLD });
}

function dummyOf(sim: Sim, templateId: string): Entity {
  const found = [...sim.entities.values()].find((e) => e.templateId === templateId && !e.dead);
  if (!found) throw new Error(`${templateId} not spawned`);
  return found;
}

function entityById(sim: Sim, id: number): Entity {
  const entity = sim.entities.get(id);
  if (!entity) throw new Error(`entity ${id} not found`);
  return entity;
}

function warriorAt(sim: Sim, x: number, z: number): number {
  const pid = sim.addPlayer('warrior', 'Parser', { autoEquip: true });
  sim.setPlayerLevel(20, pid);
  const player = entityById(sim, pid);
  player.pos.x = x;
  player.pos.z = z;
  player.pos.y = groundHeight(x, z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
  (sim as Sim & { rebucket(e: Entity): void }).rebucket(player);
  return pid;
}

describe('Highwatch practice row: placement', () => {
  it('stands four dummies in a west-to-east row, 2 yd apart, in simulation order', () => {
    const sim = makeWorld();
    const row = ROW_TEMPLATE_IDS.map((id) => dummyOf(sim, id));

    // The authored order IS the west-to-east order: friendly healing target,
    // then the plain training dummy, then normal boss, then heroic boss.
    expect(row.map((e) => Math.round(e.pos.x))).toEqual([-42, -40, -38, -36]);
    for (const e of row) expect(Math.round(e.pos.z)).toBe(648);

    // Spacing is the point of the row, so pin the gaps, not just the positions.
    for (let i = 1; i < row.length; i++) {
      expect(Math.round(row[i].pos.x - row[i - 1].pos.x)).toBe(2);
    }
    // The original Training Dummy did not move off its long-standing marker.
    expect(Math.round(row[1].pos.x)).toBe(-40);
  });

  it('seats every post on dry, walkable ground', () => {
    const sim = makeWorld();
    for (const id of ROW_TEMPLATE_IDS) {
      const e = dummyOf(sim, id);
      expect(e.pos.y).toBeGreaterThan(WATER_LEVEL);
    }
  });

  it('appends the new camps LAST so no earlier camp changes entity id', () => {
    // The camp loop consumes entity ids in array order; seating these mid-array
    // would shift every later camp's id (src/sim/data.ts CAMPS, append-last).
    const tail = CAMPS.slice(-ZONE3_PRACTICE_DUMMY_CAMPS.length);
    expect(tail.map((c) => c.mobId)).toEqual(ZONE3_PRACTICE_DUMMY_CAMPS.map((c) => c.mobId));
    for (const camp of ZONE3_PRACTICE_DUMMY_CAMPS) {
      expect(camp.radius).toBe(0); // exact marker, no scatter
      expect(camp.count).toBe(1);
    }
  });
});

describe('Highwatch practice row: fixture behavior', () => {
  it('marks every new dummy as an inert practice fixture', () => {
    for (const id of NEW_TEMPLATE_IDS) {
      const template = MOBS[id];
      expect(template.dummy).toBe(true);
      expect(template.moveSpeed).toBe(0);
      expect(template.aggroRadius).toBe(0);
      expect(template.dmgBase).toBe(0);
      expect(template.dmgPerLevel).toBe(0);
      expect(template.loot).toEqual([]);
      expect(template.respawnSeconds).toBe(10);
    }
  });

  it('refuses to be pulled off its marker', () => {
    const sim = makeWorld();
    for (const id of ROW_TEMPLATE_IDS) {
      expect(isPullEligible(dummyOf(sim, id))).toBe(false);
    }
  });

  it('takes damage from a boss dummy without aggroing, moving, or hitting back', () => {
    for (const id of ['normal_boss_dummy', 'heroic_boss_dummy'] as const) {
      const sim = makeWorld();
      const d = dummyOf(sim, id);
      const spot = { x: d.pos.x, z: d.pos.z };
      const pid = warriorAt(sim, d.pos.x + 1, d.pos.z);
      const player = entityById(sim, pid);
      player.targetId = d.id;
      player.autoAttack = true;

      for (let i = 0; i < 20 * 6; i++) sim.tick();

      expect(d.hp).toBeLessThan(d.maxHp); // damage lands and counts on the meters
      expect(d.aggroTargetId).toBe(null);
      expect(d.aiState).toBe('idle');
      expect(player.hp).toBe(player.maxHp); // never fights back
      expect(d.pos.x).toBe(spot.x); // never moves
      expect(d.pos.z).toBe(spot.z);
    }
  });

  it('heals a boss dummy back to full a few seconds after the last hit', () => {
    const sim = makeWorld();
    const d = dummyOf(sim, 'normal_boss_dummy');
    const pid = warriorAt(sim, d.pos.x + 1, d.pos.z);
    const player = entityById(sim, pid);
    player.targetId = d.id;
    player.autoAttack = true;
    for (let i = 0; i < 20 * 4 && d.hp === d.maxHp; i++) sim.tick();
    expect(d.hp).toBeLessThan(d.maxHp);

    player.autoAttack = false;
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    expect(d.hp).toBe(d.maxHp);
    expect(d.inCombat).toBe(false);
  });

  it('keeps the friendly dummy friendly and unattackable', () => {
    const sim = makeWorld();
    const d = dummyOf(sim, 'friendly_player_dummy');
    const pid = warriorAt(sim, d.pos.x - 1, d.pos.z);
    const player = entityById(sim, pid);

    expect(d.hostile).toBe(false);
    expect(d.friendlyPracticeTarget).toBe(true);
    expect(sim.isHostileTo(player, d)).toBe(false);

    sim.tick();
    sim.targetNearestFriendly(pid);
    expect(player.targetId).toBe(d.id);
    expect(player.autoAttack).toBe(false);
  });

  it('gives the friendly dummy a wound to heal instead of parking it at full', () => {
    const sim = makeWorld();
    const d = dummyOf(sim, 'friendly_player_dummy');
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(d.hp).toBeLessThan(d.maxHp);
    expect(d.hp).toBeGreaterThan(0);
    expect(d.dead).toBe(false);
  });
});

describe('Highwatch practice row: the numbers it simulates', () => {
  // createMob: armor = round(armorPerLevel * (level - 1)). A dummy spawns at its
  // template's maxLevel, so this is the armor a parse actually meets.
  function armorAtSpawn(templateId: string): number {
    const template = MOBS[templateId];
    const mob = createMob(1, template, template.maxLevel, { x: 0, y: 0, z: 0 });
    return mob.stats.armor;
  }

  it('gives the normal boss dummy Nythraxis level and armor on normal', () => {
    const boss = MOBS.nythraxis_scourge_of_thornpeak;
    const dummy = MOBS.normal_boss_dummy;

    expect(dummy.maxLevel).toBe(boss.maxLevel);
    expect(dummy.armorPerLevel).toBe(boss.armorPerLevel);
    expect(armorAtSpawn('normal_boss_dummy')).toBe(armorAtSpawn('nythraxis_scourge_of_thornpeak'));
    // Spelled out, so a silent change to either side is visible in the diff.
    expect(armorAtSpawn('normal_boss_dummy')).toBe(798);
  });

  it('gives the heroic boss dummy the armor Heroic Nythraxis wears', () => {
    // instances/difficulty.ts applies the dungeon's armorMultiplier to
    // armorPerLevel and pins the spawn to the heroic level.
    const tuning = HEROIC_DUNGEON_TUNING.nythraxis_boss_arena;
    const boss = MOBS.nythraxis_scourge_of_thornpeak;
    const heroicArmorPerLevel = boss.armorPerLevel * tuning.armorMultiplier;
    const expectedArmor = Math.round(heroicArmorPerLevel * (tuning.level - 1));

    expect(MOBS.heroic_boss_dummy.maxLevel).toBe(tuning.level);
    expect(MOBS.heroic_boss_dummy.armorPerLevel).toBe(heroicArmorPerLevel);
    expect(armorAtSpawn('heroic_boss_dummy')).toBe(expectedArmor);
    expect(armorAtSpawn('heroic_boss_dummy')).toBe(1058);
    // Heroic must actually be the harder target, or the pair proves nothing.
    expect(armorAtSpawn('heroic_boss_dummy')).toBeGreaterThan(armorAtSpawn('normal_boss_dummy'));
    expect(MOBS.heroic_boss_dummy.maxLevel).toBeGreaterThan(MOBS.normal_boss_dummy.maxLevel);
  });

  it('carries the boss classification a rotation has to plan around', () => {
    const boss = MOBS.nythraxis_scourge_of_thornpeak;
    for (const id of ['normal_boss_dummy', 'heroic_boss_dummy'] as const) {
      expect(MOBS[id].boss).toBe(boss.boss);
      expect(MOBS[id].elite).toBe(boss.elite);
      expect(MOBS[id].ccImmune).toBe(boss.ccImmune);
      expect(MOBS[id].slowImmune).toBe(boss.slowImmune);
    }
  });

  it('gives the friendly dummy a level-20 best-in-slot pool and armor', () => {
    // Rebuild the reference the template's literals were taken from: a level-20
    // prot warrior wearing the deterministic epic set /dev bis picks.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: BUILTIN_WORLD });
    const pid = sim.addPlayer('warrior', 'Reference');
    sim.setPlayerLevel(20, pid);
    expect(sim.setSpec('prot', pid)).toBe(true);
    const meta = (
      sim as Sim & { players: Map<number, { equipment: Record<string, string> }> }
    ).players.get(pid);
    if (!meta) throw new Error('reference player has no meta');
    for (const [slot, itemId] of Object.entries(bestEpicGearFor('warrior', 'prot')) as [
      EquipSlot,
      string,
    ][]) {
      meta.equipment[slot] = itemId;
    }
    sim.setPlayerLevel(20, pid); // forces the one stat recalc
    const reference = entityById(sim, pid);

    const dummy = createMob(1, MOBS.friendly_player_dummy, 20, { x: 0, y: 0, z: 0 });
    expect(dummy.maxHp).toBe(reference.maxHp);
    expect(dummy.stats.armor).toBe(reference.stats.armor);
    // Spelled out so the diff shows the day the item tables move.
    expect(dummy.maxHp).toBe(2302);
    expect(dummy.stats.armor).toBe(3354);
    // It is a player stand-in, not another 999999 slab.
    expect(dummy.maxHp).toBeLessThan(MOBS.training_dummy.hpBase);
  });
});
