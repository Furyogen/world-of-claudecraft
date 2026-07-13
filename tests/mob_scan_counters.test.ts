// Direct unit tests for the mob-AI scan observability counters
// (src/sim/mob/scan_counters.ts), the two hot paths that feed them
// (src/sim/mob/locomotion.ts idle aggro scan and src/sim/mob/targeting.ts threat
// walks), and their per-tick reset + observer purity on the Sim coordinator.
//
// The counters attribute mob.update cost without touching gameplay: every literal
// here is hand-computed from the real loop bodies, so a test reddens if an
// increment is removed or moved, if the per-tick reset moves, or if reading the
// getter ever perturbs the deterministic world.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { updateMob } from '../src/sim/mob/locomotion';
import { createMobScanCounters } from '../src/sim/mob/scan_counters';
import { highestThreatTarget, retargetMob, updateMobTarget } from '../src/sim/mob/targeting';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Entity, NYTHRAXIS_BOSS_ID } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { canonical, sampleEntity, samplePlayerMeta } from './parity/trace';

type AnyEntity = ReturnType<typeof createMob> & Record<string, any>;
const ctxOf = (sim: Sim): SimContext => (sim as unknown as { ctx: SimContext }).ctx;
const seedOf = (sim: Sim): number => (sim as unknown as { cfg: { seed: number } }).cfg.seed;

// WORLD_SIZE is 360 (x spans [-180, 180]; src/sim/data.ts), so (500, 500) sits well
// outside the playable world: there are no world-spawned camps or mobs anywhere near
// it (asserted below as 0 entities within 60 units). Running the aggro scan there
// isolates the counter to exactly the players this test places, so the visit totals
// are exact integer literals rather than "at least".
const FAR = { x: 500, z: 500 };

function noPlayerSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// Add a fresh warrior and teleport it to (FAR.x + dx, FAR.z + dz). Optionally mark it
// dead: the aggro-scan increment runs BEFORE the callback's dead check, so a dead
// player in radius still counts as a grid visit.
function addPlayerAt(sim: Sim, name: string, dx: number, dz: number, dead = false): Entity {
  const pid = sim.addPlayer('warrior', name);
  const e = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid) as AnyEntity;
  e.pos.x = FAR.x + dx;
  e.pos.z = FAR.z + dz;
  e.pos.y = terrainHeight(e.pos.x, e.pos.z, seedOf(sim));
  e.prevPos = { ...e.pos };
  if (dead) e.dead = true;
  return e;
}

function idleForestWolf(sim: Sim, id: number): AnyEntity {
  const mob = createMob(id, MOBS.forest_wolf, 5, {
    x: FAR.x,
    y: terrainHeight(FAR.x, FAR.z, seedOf(sim)),
    z: FAR.z,
  }) as AnyEntity;
  mob.aiState = 'idle';
  (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(mob);
  return mob;
}

function refreshPlayerGrid(sim: Sim): void {
  const s = sim as unknown as {
    playerGrid: { refresh: (it: Iterable<Entity>) => void };
    playerEntities: () => Iterable<Entity>;
  };
  s.playerGrid.refresh(s.playerEntities());
}

// ---- the minimal-fake targeting harness (mirrors tests/mob_targeting.test.ts) -----

// Minimal Entity carrying only the fields the targeting functions touch.
function ent(id: number, over: Partial<Entity> = {}): Entity {
  return {
    id,
    dead: false,
    pos: { x: 0, y: 0, z: 0 },
    level: 1,
    templateId: 'forest_wolf',
    ownerId: null,
    scale: 1,
    aiState: 'idle',
    inCombat: false,
    despawnTimer: undefined,
    aggroTargetId: null,
    forcedTargetId: null,
    forcedTargetTimer: 0,
    threat: new Map<number, number>(),
    ...over,
  } as unknown as Entity;
}

// Fake seam: the targeting module reads `entities` and the mob-scan counters, and
// calls the two Nythraxis helpers. A fresh counter object per ctx so each call's
// tally is read in isolation.
function fakeCtx(
  entities: Map<number, Entity>,
  opts: { fallback?: Entity | null; despawn?: boolean } = {},
): SimContext {
  return {
    entities,
    mobScanCounters: createMobScanCounters(),
    nythraxisAddFallbackTarget: () => opts.fallback ?? null,
    scheduleNythraxisAddDespawnIfBossReset: () => opts.despawn ?? false,
  } as unknown as SimContext;
}

describe('mob scan counters: (FAR) spot is clear of world spawns', () => {
  it('has no world entity within 60 units, so the aggro-scan totals are exact', () => {
    const sim = noPlayerSim();
    let near = 0;
    for (const e of (sim as unknown as { entities: Map<number, Entity> }).entities.values()) {
      const dx = e.pos.x - FAR.x;
      const dz = e.pos.z - FAR.z;
      if (dx * dx + dz * dz <= 60 * 60) near++;
    }
    expect(near).toBe(0);
  });
});

describe('mob scan counters: aggro-scan player visits (updateMob idle branch)', () => {
  it('counts one visit per in-radius player and excludes players beyond radius 25', () => {
    const sim = noPlayerSim();
    // Three players within the 25-unit grid query (distances 10, 20, and exactly 25:
    // the query keeps d2 <= r2, so the 25-unit player on the boundary IS visited),
    // and two beyond it (30, 45) that must not be counted.
    addPlayerAt(sim, 'In10', 10, 0);
    addPlayerAt(sim, 'In20', 0, 20);
    addPlayerAt(sim, 'On25', 0, 25);
    addPlayerAt(sim, 'Out30', 30, 0);
    addPlayerAt(sim, 'Out45', 0, 45);
    const mob = idleForestWolf(sim, 900101);
    refreshPlayerGrid(sim);

    // Direct updateMob call (no tick) so nothing resets the counter mid-test; a fresh
    // Sim starts the counter at 0, so this reads exactly this scan's tally.
    updateMob(ctxOf(sim), mob);

    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(3);
  });

  it('counts a dead player in radius because the increment precedes the dead check', () => {
    const sim = noPlayerSim();
    // One dead and one live player, both inside radius 25. The callback increments the
    // counter as its FIRST statement, before `if (e.dead) return`, so both count.
    addPlayerAt(sim, 'DeadIn', 12, 0, true);
    addPlayerAt(sim, 'LiveIn', 0, 18);
    const mob = idleForestWolf(sim, 900102);
    refreshPlayerGrid(sim);

    updateMob(ctxOf(sim), mob);

    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(2);
  });

  it('counts visits in the Nythraxis idle scan too (the second scan callback)', () => {
    // updateMob has TWO idle aggro-scan callbacks: the general branch (above) and the
    // Nythraxis boss branch. Both increment aggroScanPlayerVisits, so cover both.
    const sim = noPlayerSim();
    // The Nythraxis idle branch recenters the boss on its spawnPos before scanning, and
    // createMob seeds spawnPos from the passed position, so the boss scans from FAR.
    // Two players inside grid radius 25 (distances 22 and 24, both beyond the boss's
    // effective aggro radius of 20, so it stays idle) and one beyond it (40).
    addPlayerAt(sim, 'In22', 22, 0);
    addPlayerAt(sim, 'In24', 0, 24);
    addPlayerAt(sim, 'Out40', 40, 0);
    const boss = createMob(900501, MOBS[NYTHRAXIS_BOSS_ID], 20, {
      x: FAR.x,
      y: terrainHeight(FAR.x, FAR.z, seedOf(sim)),
      z: FAR.z,
    }) as AnyEntity;
    // A freshly created boss has no `nythraxis` encounter state, so updateMob skips the
    // encounter driver and reaches the idle-branch scan.
    boss.aiState = 'idle';
    (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(boss);
    refreshPlayerGrid(sim);

    updateMob(ctxOf(sim), boss);

    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(2);
    expect(boss.aiState).toBe('idle'); // both in-radius players sit beyond aggro 20
  });
});

describe('mob scan counters: threat-entry visits (targeting loops)', () => {
  it('highestThreatTarget visits every table entry exactly once', () => {
    const ctx = fakeCtx(
      new Map([
        [1, ent(1)],
        [2, ent(2)],
      ]),
    );
    const mob = ent(10, {
      threat: new Map([
        [1, 70],
        [2, 30],
      ]),
    });
    highestThreatTarget(ctx, mob);
    // Two living entries, none pruned: two visits.
    expect(ctx.mobScanCounters.threatEntryVisits).toBe(2);
  });

  it('updateMobTarget with a live current target visits its own pull-over loop entries', () => {
    const ctx = fakeCtx(
      new Map([
        [1, ent(1)],
        [2, ent(2)],
        [3, ent(3)],
        [4, ent(4)],
      ]),
    );
    // Current target id 1 holds the most threat, so no pull-over fires; the loop still
    // visits ALL four entries (the increment precedes the `id === cur.id || t <= bestT`
    // continue), so the current target counts too. Only the own loop runs here (a live
    // current target skips the highestThreatTarget delegate).
    const mob = ent(10, {
      aggroTargetId: 1,
      threat: new Map([
        [1, 100],
        [2, 50],
        [3, 30],
        [4, 20],
      ]),
    });
    updateMobTarget(ctx, mob);
    expect(ctx.mobScanCounters.threatEntryVisits).toBe(4);
    expect(mob.aggroTargetId).toBe(1); // held (proves the own pull-over loop ran)
  });

  it('updateMobTarget with no current target delegates to highestThreatTarget', () => {
    const ctx = fakeCtx(
      new Map([
        [1, ent(1)],
        [2, ent(2)],
        [3, ent(3)],
      ]),
    );
    // aggroTargetId null: the no-target branch calls highestThreatTarget and returns
    // BEFORE the own pull-over loop, so the three visits come solely from the delegate
    // (own loop contributes 0; delegate contributes 3; sum 3).
    const mob = ent(10, {
      aggroTargetId: null,
      threat: new Map([
        [1, 100],
        [2, 50],
        [3, 30],
      ]),
    });
    updateMobTarget(ctx, mob);
    expect(ctx.mobScanCounters.threatEntryVisits).toBe(3);
    expect(mob.aggroTargetId).toBe(1); // delegate picked the highest (proves it ran)
  });

  it('retargetMob delegates to highestThreatTarget', () => {
    const ctx = fakeCtx(
      new Map([
        [1, ent(1)],
        [3, ent(3)],
      ]),
    );
    const mob = ent(10, {
      aiState: 'attack',
      threat: new Map([
        [1, 100],
        [3, 140],
      ]),
    });
    retargetMob(ctx, mob);
    // retargetMob's only threat walk is the highestThreatTarget delegate: two entries.
    expect(ctx.mobScanCounters.threatEntryVisits).toBe(2);
    expect(mob.aggroTargetId).toBe(3);
  });
});

describe('mob scan counters: per-tick reset', () => {
  it('zeroes at the top of each tick so a read sees only that tick tally', () => {
    const sim = noPlayerSim();
    // One player at distance 20: inside the 25-unit scan (one visit) but outside the
    // mob's effective aggro radius (16 for a level-5 wolf vs a level-1 player), so the
    // mob stays idle and keeps scanning tick after tick.
    const player = addPlayerAt(sim, 'Solo', 0, 20);
    idleForestWolf(sim, 900201);
    refreshPlayerGrid(sim);

    sim.tick();
    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(1);

    // Move the player far out of range and refresh the grid, then tick again. Without
    // the reset at the top of tick() the counter would carry the previous 1 forward;
    // with it, this tick's own tally (0 visits) is all that remains.
    player.pos.z = FAR.z + 5000;
    player.pos.y = terrainHeight(player.pos.x, player.pos.z, seedOf(sim));
    (player as AnyEntity).prevPos = { ...player.pos };
    refreshPlayerGrid(sim);

    sim.tick();
    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(0);
  });
});

describe('mob scan counters: reading them is a pure observer', () => {
  // Two Sims built with identical config and identical scripted input; run 1 reads the
  // mobScanCounters getter every tick and run 2 never touches it. The getter returns a
  // live readonly view, draws no rng and mutates nothing, so the two deterministic
  // worlds must end bit-for-bit identical. Reuses the parity trace samplers so the
  // comparison covers every gameplay field, not a hand-picked subset.
  const WOLF_ID = 900301;
  const buildRun = (): Sim => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const player = sim.player;
    const pos = {
      x: player.pos.x + 6,
      z: player.pos.z,
      y: terrainHeight(player.pos.x + 6, player.pos.z, seedOf(sim)),
    };
    const wolf = createMob(WOLF_ID, MOBS.forest_wolf, 5, pos) as AnyEntity;
    wolf.aiState = 'idle';
    (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(wolf);
    return sim;
  };

  const worldState = (sim: Sim): unknown => {
    const s = sim as unknown as {
      entities: Map<number, Entity>;
      players: Map<number, unknown>;
      time: number;
      tickCount: number;
      nextId: number;
      rng: { s: number };
    };
    const entities = [...s.entities.values()]
      .sort((a, b) => a.id - b.id)
      .map((e) => sampleEntity(e));
    const players = [...s.players.values()].map((m) => samplePlayerMeta(m as never));
    // The rng's internal mulberry32 state is the tightest net: an extra draw caused
    // by the observer would fork it even if the sampled world state happened to
    // coincide.
    return canonical({
      time: s.time,
      tickCount: s.tickCount,
      nextId: s.nextId,
      rngState: s.rng.s,
      entities,
      players,
    });
  };

  it('two identical runs agree bit for bit whether or not the counters are read', () => {
    const observed = buildRun();
    let observerSum = 0;
    for (let i = 0; i < 50; i++) {
      observed.tick();
      // Read the public getter every tick (the incident-capture host does exactly this).
      const c = observed.mobScanCounters;
      observerSum += c.aggroScanPlayerVisits + c.threatEntryVisits;
    }

    const untouched = buildRun();
    for (let i = 0; i < 50; i++) untouched.tick();

    // The scenario really exercises the counters (a wolf aggros and fights the player),
    // so the observer read is meaningful rather than reading a perpetual zero.
    expect(observerSum).toBeGreaterThan(0);
    // ...and reading them left the world identical to the run that never looked.
    expect(worldState(observed)).toEqual(worldState(untouched));
  });
});
