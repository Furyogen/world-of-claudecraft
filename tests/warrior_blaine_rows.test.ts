import { describe, expect, it, vi } from 'vitest';
import { abilityQualifiesForAreaEcho, consumeAreaEchoCharge } from '../src/sim/combat/area_echo';
import { consumeSureCritCharge } from '../src/sim/combat/sure_crit';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';

function rig(rows: Record<number, string>) {
  const sim = new Sim({ seed: 41, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: null, rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return { sim, p: sim.player };
}

function addMob(sim: Sim, hp = 1000, dist = 3): Entity {
  const p = sim.player;
  const mob = createMob(9300 + sim.tickCount, MOBS.forest_wolf, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dist,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = hp;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  p.facing = 0;
  return mob;
}

function dealDamage(sim: Sim, source: Entity | null, target: Entity, amount: number): void {
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
  ).dealDamage(source, target, amount, false, 'physical', null, 'hit');
}

describe('Blaine1705 warrior row mechanics', () => {
  it('Twin Onrush resolves to two stored Onrush uses', () => {
    const { sim } = rig({ 5: 'war_r5_twin_onrush' });
    expect(sim.resolvedAbility('charge')?.bonusCharges).toBe(1);
  });

  it('Red Harvest stacks apply on credited kills', () => {
    const { sim, p } = rig({ 17: 'war_r17_red_harvest' });
    const first = addMob(sim, 10);
    dealDamage(sim, p, first, 20);
    expect(p.auras.find((a) => a.id === 'war_bloodbath_dmg')?.stacks).toBe(1);

    const second = addMob(sim, 10);
    dealDamage(sim, p, second, 20);
    expect(p.auras.find((a) => a.id === 'war_bloodbath_dmg')?.stacks).toBe(2);
  });

  it('area echo and sure-crit charges consume deterministically without rng', () => {
    expect(abilityQualifiesForAreaEcho([{ type: 'directDamage', min: 1, max: 1 }])).toBe(true);
    expect(
      abilityQualifiesForAreaEcho([
        { type: 'directDamage', min: 1, max: 1 },
        { type: 'aoeDamage', min: 1, max: 1, radius: 5 },
      ]),
    ).toBe(false);

    const events: SimEvent[] = [];
    const e = {
      id: 1,
      auras: [
        {
          id: 'echo',
          name: 'Echo',
          kind: 'aoe_echo',
          remaining: 8,
          duration: 8,
          value: 0,
          charges: 1,
          sourceId: 1,
          school: 'physical',
        },
        {
          id: 'crit',
          name: 'Crit',
          kind: 'sure_crit',
          remaining: 8,
          duration: 8,
          value: 0,
          charges: 1,
          sourceId: 1,
          school: 'physical',
        },
      ],
    } as Entity;
    const ctx = { emit: vi.fn((ev: SimEvent) => events.push(ev)) } as unknown as SimContext;
    consumeAreaEchoCharge(ctx, e);
    consumeSureCritCharge(ctx, e);
    expect(e.auras).toEqual([]);
    expect(events).toHaveLength(2);
  });
});
