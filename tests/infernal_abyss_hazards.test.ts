import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { infernalLavaAt, tickInfernalAbyssLava } from '../src/sim/instances/infernal_abyss_hazards';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';

describe('Infernal Abyss lava hazards', () => {
  it('matches the authored lava pools and keeps their edge outside safe', () => {
    expect(infernalLavaAt(-78, 76)).toBe(true);
    expect(infernalLavaAt(-72.6, 76)).toBe(true);
    expect(infernalLavaAt(-72.4, 76)).toBe(false);
  });

  it('rotates fissure hit boxes with the rendered decor yaw', () => {
    expect(infernalLavaAt(-32, 76)).toBe(true);
    expect(infernalLavaAt(-27, 76)).toBe(true);
    expect(infernalLavaAt(-32, 79)).toBe(false);
  });

  it('matches the boss arena moat while keeping its inner island safe', () => {
    expect(infernalLavaAt(0, 216.5)).toBe(false);
    expect(infernalLavaAt(30, 216.5)).toBe(true);
    expect(infernalLavaAt(40, 216.5)).toBe(false);
  });

  it('keeps the authored entry, side rooms and boss position off lava', () => {
    for (const point of [
      { x: 0, z: -10 },
      { x: -66, z: 59 },
      { x: 48, z: 110 },
      { x: 0, z: 224 },
    ]) {
      expect(infernalLavaAt(point.x, point.z)).toBe(false);
    }
  });

  it('deals a deterministic eight percent health pulse to players in lava', () => {
    const sim = new Sim({ seed: 401, playerClass: 'warrior' });
    const player = sim.player;
    player.maxHp = 1000;
    player.hp = 1000;
    player.pos.x = -78;
    player.pos.z = 76;

    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    tickInfernalAbyssLava(ctx, { x: 0, z: 0 });

    expect(player.hp).toBe(920);
  });

  it('labels the pulse with the localizable Abyssal Lava damage source', () => {
    const sim = new Sim({ seed: 401, playerClass: 'warrior' });
    const player = sim.player;
    player.maxHp = 1000;
    player.hp = 1000;
    player.pos.x = -78;
    player.pos.z = 76;

    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const sources: string[] = [];
    const realDeal = ctx.dealDamage;
    (ctx as { dealDamage: SimContext['dealDamage'] }).dealDamage = (...args) => {
      sources.push(args[5] as string);
      return realDeal(...args);
    };
    tickInfernalAbyssLava(ctx, { x: 0, z: 0 });
    (ctx as { dealDamage: SimContext['dealDamage'] }).dealDamage = realDeal;

    // The exact English the client matcher (sim_i18n AURA_NAME_KEY) re-localizes.
    expect(sources).toEqual(['Abyssal Lava']);
  });

  it('runs at the once-a-second updateInstances cadence, never per tick', () => {
    // The 8 percent pulse is per SECOND: the only call site must sit inside
    // updateInstances, which self-gates on `tickCount % 20`. A relocation that
    // called the lava tick per 20 Hz tick would deal 160 percent per second.
    const source = readFileSync('src/sim/instances/dungeons.ts', 'utf8');
    const updateBody = source.slice(source.indexOf('export function updateInstances'));
    expect(updateBody).toContain('ctx.tickCount % 20');
    expect(updateBody.indexOf('tickInfernalAbyssLava')).toBeGreaterThan(
      updateBody.indexOf('ctx.tickCount % 20'),
    );
    // ...and nowhere else in the sim calls it.
    expect(source.split('tickInfernalAbyssLava').length).toBe(3); // import + one call
  });

  it('skips players outside lava and dead players entirely', () => {
    const sim = new Sim({ seed: 401, playerClass: 'warrior' });
    const player = sim.player;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;

    player.maxHp = 1000;
    player.hp = 1000;
    player.pos.x = 0;
    player.pos.z = -10; // authored entry, off lava
    tickInfernalAbyssLava(ctx, { x: 0, z: 0 });
    expect(player.hp).toBe(1000);

    player.pos.x = -78;
    player.pos.z = 76; // in the pool, but dead
    player.dead = true;
    player.hp = 0;
    tickInfernalAbyssLava(ctx, { x: 0, z: 0 });
    expect(player.hp).toBe(0);
  });
});
