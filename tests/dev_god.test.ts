import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function godSim(devCommands = true): { sim: Sim; pid: number } {
  const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true, devCommands });
  sim.setPlayerLevel(20);
  return { sim, pid: sim.playerId };
}

function spawnMob(sim: Sim, hp = 60000): Entity {
  const player = sim.player;
  const mob = createMob(9300, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 3,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = hp;
  mob.stats = { ...mob.stats, armor: 0 };
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  return mob;
}

const deal = (sim: Sim, source: Entity | null, target: Entity, amount: number) =>
  (
    sim as unknown as {
      dealDamage(
        source: Entity | null,
        target: Entity,
        amount: number,
        crit: boolean,
        school: string,
        ability: string | null,
        kind: string,
      ): void;
    }
  ).dealDamage(source, target, amount, false, 'physical', null, 'hit');

describe('/dev god cheat', () => {
  it('toggles invulnerability and tops off health and resource', () => {
    const { sim, pid } = godSim();
    const player = sim.player;
    player.hp = Math.round(player.maxHp * 0.3);
    player.resource = 0;

    sim.chat('/dev god', pid);

    expect(player.gm).toBe(true);
    expect(player.hp).toBe(player.maxHp);
    expect(player.resource).toBe(player.maxResource);
    const mob = spawnMob(sim);
    deal(sim, mob, player, player.maxHp * 2);
    expect(player.dead).toBe(false);
    expect(player.hp).toBe(player.maxHp);

    sim.chat('/dev god', pid);
    expect(player.gm).toBe(false);
  });

  it('makes a god-mode player deal 100x damage', () => {
    const { sim, pid } = godSim();
    sim.chat('/dev god', pid);
    const boss = spawnMob(sim);
    const before = boss.hp;

    deal(sim, sim.player, boss, 100);

    expect(before - boss.hp).toBe(10000);
  });

  it('does nothing when dev commands are disabled', () => {
    const { sim, pid } = godSim(false);
    sim.chat('/dev god', pid);
    expect(sim.player.gm).toBeFalsy();

    const boss = spawnMob(sim);
    sim.player.gm = true;
    const before = boss.hp;
    deal(sim, sim.player, boss, 100);
    expect(before - boss.hp).toBe(100);
  });
});
