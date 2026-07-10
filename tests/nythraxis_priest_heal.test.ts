import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';

const SEED = 51234;

// Malric, the Deathless Hierophant: the heroic Nythraxis priest add. He is
// CC-able (unlike the boss and warrior add) and channels an ESCALATING heal on
// the boss that a stun/silence must break, or it ramps every tick.
const inner = (sim: Sim) =>
  sim as unknown as {
    addEntity(e: Entity): void;
    updateBossMechanics(m: Entity): void;
    applyAura(target: Entity, aura: Aura): void;
  };

function spawn(sim: Sim, id: number, tmplId: string, hp?: number): Entity {
  const tmpl = MOBS[tmplId];
  const mob = createMob(id, tmpl, tmpl.maxLevel, { x: 0, y: 0, z: 0 });
  if (hp !== undefined) mob.hp = hp;
  mob.inCombat = true;
  inner(sim).addEntity(mob);
  return mob;
}

const stun = (sourceId: number): Aura => ({
  id: 'test_stun',
  name: 'Test Stun',
  kind: 'stun',
  remaining: 10,
  duration: 10,
  value: 0,
  sourceId,
  school: 'physical',
});

// Advance until the channel's next heal lands (every=3s = 60 ticks, plus float
// drift) and return the heal the boss received, or 0 if none fired (interrupted).
function tickOneChannel(sim: Sim, malric: Entity, boss: Entity, maxTicks = 70): number {
  const before = boss.hp;
  for (let i = 0; i < maxTicks; i++) {
    inner(sim).updateBossMechanics(malric);
    if (boss.hp > before) return boss.hp - before;
  }
  return boss.hp - before;
}

describe('heroic Nythraxis priest: escalating channeled heal', () => {
  it('is authored CC-able with a channelHeal and no ward', () => {
    const t = MOBS.nythraxis_heroic_priest_add;
    expect(t.ccImmune).toBe(false);
    expect(t.wardAllies).toBeUndefined();
    expect(t.channelHeal).toEqual({
      radius: 45,
      every: 3,
      baseHeal: 400,
      rampAdd: 300,
      maxHeal: 1800,
      name: "Malric's Mending",
      school: 'shadow',
    });
  });

  it('heals the boss for more each uninterrupted tick (the ramp)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const boss = spawn(sim, 8001, 'nythraxis_scourge_of_thornpeak', 1000); // wounded, huge pool
    const malric = spawn(sim, 8002, 'nythraxis_heroic_priest_add');
    boss.pos = { x: 4, y: 0, z: 0 };

    // Standalone spawn has no mechanicHealMult (the heroic 1.6x only applies in a
    // claimed heroic instance), so these are the raw base/ramp values.
    const first = tickOneChannel(sim, malric, boss);
    const second = tickOneChannel(sim, malric, boss);
    const third = tickOneChannel(sim, malric, boss);
    expect(first).toBe(400); // baseHeal
    expect(second).toBe(700); // +rampAdd
    expect(third).toBe(1000); // +rampAdd again
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('a stun breaks the channel and resets the ramp to base', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const boss = spawn(sim, 8011, 'nythraxis_scourge_of_thornpeak', 1000);
    const malric = spawn(sim, 8012, 'nythraxis_heroic_priest_add');
    boss.pos = { x: 4, y: 0, z: 0 };

    tickOneChannel(sim, malric, boss); // 400
    const ramped = tickOneChannel(sim, malric, boss); // 700 (ramp built)
    expect(ramped).toBe(700);

    // Stun Malric: the next interval heals for nothing and the ramp resets.
    malric.auras.push(stun(0));
    const duringStun = tickOneChannel(sim, malric, boss);
    expect(duringStun).toBe(0);
    expect(malric.channelRamp).toBe(0);

    // After the stun clears the channel restarts from base, not where it left off.
    malric.auras = [];
    const afterStun = tickOneChannel(sim, malric, boss);
    expect(afterStun).toBe(400);
  });

  it('the priest (and stalker) accept player CC; the warrior add does not', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const malric = spawn(sim, 8021, 'nythraxis_heroic_priest_add');
    const voss = spawn(sim, 8022, 'nythraxis_heroic_rogue_add');
    const aldren = spawn(sim, 8023, 'nythraxis_heroic_warrior_add');
    const playerSource = 999; // a non-self source (a player's stun)

    inner(sim).applyAura(malric, stun(playerSource));
    inner(sim).applyAura(voss, stun(playerSource));
    inner(sim).applyAura(aldren, stun(playerSource));

    expect(malric.auras.some((a) => a.kind === 'stun')).toBe(true);
    expect(voss.auras.some((a) => a.kind === 'stun')).toBe(true);
    expect(aldren.auras.some((a) => a.kind === 'stun')).toBe(false); // CC-immune like the boss
  });
});
