import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function rigMage() {
  const sim = new Sim({ seed: 17, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: null, rows: { 17: 'mag_r17_ice_block' } })).toBe(true);
  const p = sim.player;
  p.resource = p.maxResource;
  p.gcdRemaining = 0;
  return { sim, p };
}

function addTargetMob(sim: Sim, dist = 8): Entity {
  const p = sim.player;
  const mob = createMob(9100, MOBS.forest_wolf, 20, {
    x: p.pos.x + dist,
    y: p.pos.y,
    z: p.pos.z,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 100000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  return mob;
}

function dealDamage(sim: Sim, target: Entity, amount: number): void {
  (
    sim as unknown as {
      dealDamage(
        s: Entity | null,
        t: Entity,
        n: number,
        c: boolean,
        sc: string,
        a: string | null,
        k: string,
      ): void;
    }
  ).dealDamage(null, target, amount, false, 'physical', null, 'hit');
}

function tickSeconds(sim: Sim, seconds: number) {
  const events = [];
  for (let i = 0; i < 20 * seconds; i++) events.push(...sim.tick());
  return events;
}

function auraKinds(p: Entity): string[] {
  return p.auras.map((a) => `${a.id}:${a.kind}:${Math.round(a.value)}:${a.remaining.toFixed(2)}`);
}

describe('ice block stasis', () => {
  it('blocks casts and swings while held, absorbs damage, then restores action on expiry', () => {
    const { sim, p } = rigMage();
    const mob = addTargetMob(sim);

    sim.startAutoAttack();
    expect(p.autoAttack).toBe(true);

    sim.castAbility('ice_block');
    expect(p.auras.some((a) => a.id === 'ice_block' && a.kind === 'stasis')).toBe(true);
    const shield = p.auras.find((a) => a.id === 'ice_block_absorb' && a.kind === 'absorb');
    expect(shield?.value).toBe(600);
    expect(p.autoAttack).toBe(false);

    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('fireball');
    expect(p.castingAbility).toBe(null);

    sim.startAutoAttack();
    expect(p.autoAttack).toBe(false);
    const blockedSwingEvents = tickSeconds(sim, 4).filter(
      (e) => e.type === 'damage' && e.sourceId === p.id && e.targetId === mob.id,
    );
    expect(blockedSwingEvents).toEqual([]);

    const hpBefore = p.hp;
    const shieldBefore = p.auras.find((a) => a.id === 'ice_block_absorb')?.value ?? 0;
    dealDamage(sim, p, 250);
    expect(p.hp).toBe(hpBefore);
    expect(p.auras.find((a) => a.id === 'ice_block_absorb')?.value).toBe(shieldBefore - 250);

    tickSeconds(sim, 5);
    expect(p.auras.some((a) => a.kind === 'stasis')).toBe(false);
    expect(p.auras.some((a) => a.id === 'ice_block_absorb')).toBe(false);

    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('fireball');
    expect(p.castingAbility).toBe('fireball');
  });

  it('recast cancels stasis and the remaining absorb early', () => {
    const { sim, p } = rigMage();
    addTargetMob(sim);

    sim.castAbility('ice_block');
    expect(p.auras.some((a) => a.kind === 'stasis')).toBe(true);
    expect(p.auras.some((a) => a.id === 'ice_block_absorb')).toBe(true);

    tickSeconds(sim, 1);
    sim.castAbility('ice_block');

    expect(p.auras.some((a) => a.kind === 'stasis')).toBe(false);
    expect(p.auras.some((a) => a.id === 'ice_block_absorb')).toBe(false);
  });

  it('replays deterministically', () => {
    const run = () => {
      const { sim, p } = rigMage();
      const mob = addTargetMob(sim);
      const events = [];
      sim.startAutoAttack();
      sim.castAbility('ice_block');
      events.push(...tickSeconds(sim, 2));
      dealDamage(sim, p, 175);
      p.gcdRemaining = 0;
      sim.castAbility('fireball');
      events.push(...tickSeconds(sim, 1));
      sim.castAbility('ice_block');
      p.gcdRemaining = 0;
      p.resource = p.maxResource;
      sim.castAbility('fireball');
      events.push(...tickSeconds(sim, 4));
      return {
        player: {
          hp: p.hp,
          resource: p.resource,
          castingAbility: p.castingAbility,
          cooldowns: [...p.cooldowns.entries()].sort(),
          auras: auraKinds(p),
        },
        mob: { hp: mob.hp, auras: auraKinds(mob) },
        events,
      };
    };

    expect(run()).toEqual(run());
  });
});
