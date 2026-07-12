import { describe, expect, it } from 'vitest';
import { infernalLavaAt, tickInfernalAbyssLava } from '../src/sim/instances/infernal_abyss_hazards';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';

describe('Infernal Abyss lava hazards', () => {
  it('matches the authored lava pools and keeps their edge outside safe', () => {
    expect(infernalLavaAt(-15, 50)).toBe(true);
    expect(infernalLavaAt(-7.6, 50)).toBe(true);
    expect(infernalLavaAt(-7.4, 50)).toBe(false);
  });

  it('rotates fissure hit boxes with the rendered decor yaw', () => {
    expect(infernalLavaAt(0, 58)).toBe(true);
    expect(infernalLavaAt(7, 58)).toBe(true);
    expect(infernalLavaAt(0, 65)).toBe(false);
  });

  it('keeps the authored entry, side rooms and boss position off lava', () => {
    for (const point of [
      { x: 0, z: -10 },
      { x: -50, z: 48 },
      { x: 45, z: 84 },
      { x: 0, z: 195 },
    ]) {
      expect(infernalLavaAt(point.x, point.z)).toBe(false);
    }
  });

  it('deals a deterministic eight percent health pulse to players in lava', () => {
    const sim = new Sim({ seed: 401, playerClass: 'warrior' });
    const player = sim.player;
    player.maxHp = 1000;
    player.hp = 1000;
    player.pos.x = -15;
    player.pos.z = 50;

    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    tickInfernalAbyssLava(ctx, { x: 0, z: 0 });

    expect(player.hp).toBe(920);
  });
});
