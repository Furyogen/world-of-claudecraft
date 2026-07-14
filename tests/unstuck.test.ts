import { afterEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_WORLD,
  DELVE_MODULES,
  DELVES,
  INSTANCE_X_BASE,
  riftInstanceOrigin,
  setActiveWorldContent,
} from '../src/sim/data';
import { delveModuleEntry, delveModuleZOffset } from '../src/sim/delves/runs';
import { DUNGEON_WALL_X } from '../src/sim/dungeon_layout';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { generateRiftFloor } from '../src/sim/rift/rift_gen';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { BlockerDef, DelveRun, SimEvent, WorldContent } from '../src/sim/types';
import {
  isUnstuckDestinationSafe,
  UNSTUCK_COOLDOWN_ID,
  UNSTUCK_COUNTDOWN_SECONDS,
  UNSTUCK_EMBEDDED_CORRECTION_MAX,
  UNSTUCK_MAX_DISTANCE,
  UNSTUCK_RETRY_SECONDS,
  UNSTUCK_SUCCESS_COOLDOWN_SECONDS,
  unstuckLocationAt,
  unstuckRouteReachable,
  updateUnstuck,
} from '../src/sim/unstuck';

type Event = Extract<SimEvent, { type: 'unstuck' }>;

const SEED = 42;
const START = { x: 0, z: -40 };
const WEDGE_WALL_Z = START.z + 0.4;

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label}`);
  return value;
}

function makeWorld(blockers: BlockerDef[] = []): Sim {
  // A fresh content object keeps the collider cache isolated between tests.
  const world: WorldContent = {
    ...BUILTIN_WORLD,
    camps: [],
    npcs: {},
    groundObjects: [],
    blockers,
  };
  setActiveWorldContent(world);
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true, world });
  const pid = sim.addPlayer('warrior', 'Wayfinder');
  const p = required(sim.entities.get(pid), 'newly added player');
  p.pos = sim.groundPos(START.x, START.z);
  p.prevPos = { ...p.pos };
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.onGround = true;
  p.jumping = false;
  p.combatTimer = 999;
  p.inCombat = false;
  sim.grid.update(p);
  sim.playerGrid.update(p);
  sim.drainEvents();
  return sim;
}

function makeWedgedWorld(): Sim {
  return makeWorld([{ x1: -10, z1: WEDGE_WALL_Z, x2: 10, z2: WEDGE_WALL_Z }]);
}

function seedWithFloor0(
  predicate: (floor: ReturnType<typeof generateRiftFloor>) => boolean,
): number {
  for (let seed = 1; seed <= 500; seed++) {
    if (predicate(generateRiftFloor(seed, 20, 0))) return seed;
  }
  throw new Error('Expected matching rift floor seed');
}

function eventsOf(events: SimEvent[]): Event[] {
  return events.filter((event): event is Event => event.type === 'unstuck');
}

function tickMany(sim: Sim, count: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < count; i++) events.push(...sim.tick());
  return events;
}

function accepted(sim: Sim): {
  pid: number;
  player: Sim['player'];
  meta: NonNullable<ReturnType<Sim['meta']>>;
} {
  const pid = sim.player.id;
  const player = required(sim.entities.get(pid), 'primary player');
  const meta = required(sim.meta(pid), 'primary player metadata');
  expect(sim.unstuck(pid)).toBe(true);
  expect(eventsOf(sim.drainEvents())).toContainEqual({
    type: 'unstuck',
    phase: 'started',
    seconds: UNSTUCK_COUNTDOWN_SECONDS,
    pid,
  });
  return { pid, player, meta };
}

afterEach(() => {
  setActiveWorldContent(null);
});

describe('unstuck countdown and cancellation', () => {
  it('accepts an idle player, announces the countdown, and waits the full ten seconds', () => {
    const sim = makeWedgedWorld();
    const { player, meta } = accepted(sim);
    const origin = { ...player.pos };

    expect(meta.pendingUnstuck).toMatchObject({
      startedAt: 0,
      endsAt: UNSTUCK_COUNTDOWN_SECONDS,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      lastAnnouncedSecond: UNSTUCK_COUNTDOWN_SECONDS,
    });
    expect(player.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(UNSTUCK_RETRY_SECONDS);

    const beforeCompletion = tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20 - 1);
    expect(meta.pendingUnstuck).not.toBeNull();
    expect(player.pos).toEqual(origin);
    expect(eventsOf(beforeCompletion).some((event) => event.phase === 'completed')).toBe(false);
    expect(
      eventsOf(beforeCompletion).some(
        (event) => event.phase === 'countdown' && event.seconds === 1,
      ),
    ).toBe(true);

    const completion = eventsOf(sim.tick()).find((event) => event.phase === 'completed');
    expect(completion?.phase).toBe('completed');
    expect(meta.pendingUnstuck).toBeNull();
  });

  it('cancels when movement input is applied', () => {
    const sim = makeWedgedWorld();
    const { meta } = accepted(sim);
    meta.moveInput.forward = true;

    const events = eventsOf(sim.tick());
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'cancelled', reason: 'moved' }),
    );
    expect(meta.pendingUnstuck).toBeNull();
  });

  it('cancels when the player takes damage during the countdown', () => {
    const sim = makeWedgedWorld();
    const { player, meta } = accepted(sim);

    sim.ctx.dealDamage(null, player, 1, false, 'physical', null, 'hit');
    const events = eventsOf(sim.tick());
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'cancelled', reason: 'damaged' }),
    );
    expect(meta.pendingUnstuck).toBeNull();
  });

  it('cancels when combat begins during the countdown', () => {
    const sim = makeWedgedWorld();
    const { player, meta } = accepted(sim);
    player.inCombat = true;
    player.combatTimer = 0;

    const events = eventsOf(sim.tick());
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'cancelled', reason: 'combat' }),
    );
    expect(meta.pendingUnstuck).toBeNull();
  });

  it('returns one disconnected terminal event and preserves the retry cooldown', () => {
    const sim = makeWedgedWorld();
    const { pid, meta } = accepted(sim);

    expect(sim.cancelUnstuckForDisconnect(pid)).toMatchObject({
      type: 'unstuck',
      phase: 'cancelled',
      reason: 'disconnected',
      pid,
    });
    expect(meta.pendingUnstuck).toBeNull();
    expect(
      required(sim.serializeCharacter(pid), 'cancelled character state').cooldowns?.abilities?.[
        UNSTUCK_COOLDOWN_ID
      ],
    ).toBe(UNSTUCK_RETRY_SECONDS);
    expect(sim.cancelUnstuckForDisconnect(pid)).toBeNull();
    expect(eventsOf(sim.drainEvents())).toHaveLength(1);

    sim.removePlayer(pid);
    expect(eventsOf(sim.drainEvents())).toEqual([]);
  });

  it('emits one disconnected terminal event when an offline host removes the player', () => {
    const sim = makeWedgedWorld();
    const { pid, meta, player } = accepted(sim);

    sim.removePlayer(pid);

    expect(meta.pendingUnstuck).toBeNull();
    expect(player.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(UNSTUCK_RETRY_SECONDS);
    expect(eventsOf(sim.drainEvents())).toEqual([
      expect.objectContaining({
        type: 'unstuck',
        phase: 'cancelled',
        reason: 'disconnected',
        pid,
      }),
    ]);
    sim.removePlayer(pid);
    expect(eventsOf(sim.drainEvents())).toEqual([]);
  });

  it('rejects a retry while the short cooldown remains', () => {
    const sim = makeWedgedWorld();
    const { player, meta, pid } = accepted(sim);
    meta.moveInput.forward = true;
    sim.tick();
    meta.moveInput.forward = false;

    expect(sim.unstuck(pid)).toBe(false);
    expect(eventsOf(sim.drainEvents())).toContainEqual({
      type: 'unstuck',
      phase: 'blocked',
      reason: 'cooldown',
      seconds: Math.ceil(required(player.cooldowns.get(UNSTUCK_COOLDOWN_ID), 'unstuck cooldown')),
      pid,
    });
  });

  it('persists the anti-relog cooldown while discarding the runtime countdown', () => {
    const sim = makeWedgedWorld();
    const { pid } = accepted(sim);
    const state = required(sim.serializeCharacter(pid), 'serialized character');

    const restored = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const restoredPid = restored.addPlayer('warrior', 'Wayfinder', { state });
    const restoredPlayer = required(restored.entities.get(restoredPid), 'restored player');
    const restoredMeta = required(restored.meta(restoredPid), 'restored player metadata');

    expect(restoredMeta.pendingUnstuck).toBeNull();
    expect(restoredPlayer.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(UNSTUCK_RETRY_SECONDS);
    expect(restored.unstuck(restoredPid)).toBe(false);
    expect(eventsOf(restored.drainEvents())).toContainEqual({
      type: 'unstuck',
      phase: 'blocked',
      reason: 'cooldown',
      seconds: UNSTUCK_RETRY_SECONDS,
      pid: restoredPid,
    });
  });

  it('keeps the hidden cooldown through Vale Cup practice reset and a relog', () => {
    const sim = makeWedgedWorld();
    const { pid, player } = accepted(sim);

    sim.chat('/cooldowns', pid);
    const readout = sim
      .drainEvents()
      .find((event): event is Extract<SimEvent, { type: 'error' }> => event.type === 'error');
    expect(readout?.text).toBe('No abilities are on cooldown.');
    expect(readout?.text).not.toContain(UNSTUCK_COOLDOWN_ID);

    sim.vcupPracticeStart(1, pid);
    expect(sim.vcup.practices).toHaveLength(1);
    const afterPracticeReset = required(
      player.cooldowns.get(UNSTUCK_COOLDOWN_ID),
      'practice-preserved unstuck cooldown',
    );
    expect(afterPracticeReset).toBe(UNSTUCK_RETRY_SECONDS);

    const state = required(sim.serializeCharacter(pid), 'practice character state');
    const restored = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const restoredPid = restored.addPlayer('warrior', 'Wayfinder', { state });
    const restoredPlayer = required(restored.entities.get(restoredPid), 'restored practice player');
    expect(restoredPlayer.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(afterPracticeReset);

    restored.drainEvents();
    restored.chat('/cooldowns', restoredPid);
    const restoredReadout = restored
      .drainEvents()
      .find((event): event is Extract<SimEvent, { type: 'error' }> => event.type === 'error');
    expect(restoredReadout?.text).toBe('No abilities are on cooldown.');
    expect(restored.unstuck(restoredPid)).toBe(false);
  });

  it('routes offline slash use exactly like the direct action without chat or away mutations', () => {
    const direct = makeWedgedWorld();
    const slash = makeWedgedWorld();
    const directPid = direct.player.id;
    const slashPid = slash.player.id;
    const slashMeta = required(slash.meta(slashPid), 'slash player metadata');
    slashMeta.away = { mode: 'dnd', message: 'Testing recovery' };
    slash.ctx.chatTokens.set(slashPid, { tokens: 0, at: slash.time });

    expect(direct.unstuck(directPid)).toBe(true);
    expect(slash.chat('  /UnStUcK  ', slashPid)).toBeNull();

    expect(slashMeta.away).toEqual({ mode: 'dnd', message: 'Testing recovery' });
    expect(slash.ctx.chatTokens.get(slashPid)).toEqual({ tokens: 0, at: slash.time });
    expect(slash.player.cooldowns).toEqual(direct.player.cooldowns);
    expect(slashMeta.pendingUnstuck).toEqual(
      required(direct.meta(directPid), 'direct metadata').pendingUnstuck,
    );
    expect(slash.drainEvents()).toEqual(direct.drainEvents());
  });
});

describe('unstuck destination', () => {
  function runCompletion(): {
    player: Sim['player'];
    event: Extract<Event, { phase: 'completed' }>;
  } {
    const sim = makeWedgedWorld();
    const { player } = accepted(sim);
    const events = eventsOf(tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20));
    const event = events.find(
      (candidate): candidate is Extract<Event, { phase: 'completed' }> =>
        candidate.phase === 'completed',
    );
    expect(event).toBeDefined();
    expect(player.cooldowns.get(UNSTUCK_COOLDOWN_ID)).toBe(UNSTUCK_SUCCESS_COOLDOWN_SECONDS);
    return { player, event: required(event, 'completed event') };
  }

  it('completes deterministically at a same-area point no farther than eight yards', () => {
    const first = runCompletion();
    const second = runCompletion();

    expect(second.event.destination).toEqual(first.event.destination);
    expect(second.event.distance).toBe(first.event.distance);
    expect(first.event.distance).toBeGreaterThan(0);
    expect(first.event.distance).toBeLessThanOrEqual(UNSTUCK_MAX_DISTANCE);
    expect(first.event.distance).toBeLessThanOrEqual(UNSTUCK_EMBEDDED_CORRECTION_MAX);
    expect(first.event.destination.z).toBeLessThan(WEDGE_WALL_Z);
    expect(first.player.pos).toMatchObject({
      x: first.event.destination.x,
      y: first.event.destination.y,
      z: first.event.destination.z,
    });
    expect(first.player.prevPos).toEqual(first.player.pos);
    expect(first.event.area.kind).toBe('overworld');
  });

  it('immediately rejects an already-safe player without cooldown or terminal telemetry', () => {
    const sim = makeWorld();
    const player = sim.player;
    const meta = required(sim.meta(player.id), 'primary player metadata');
    const origin = { ...player.pos };

    expect(sim.unstuck(player.id)).toBe(false);
    expect(eventsOf(sim.drainEvents())).toEqual([
      { type: 'unstuck', phase: 'blocked', reason: 'already_safe', pid: player.id },
    ]);
    expect(meta.pendingUnstuck).toBeNull();
    expect(player.cooldowns.has(UNSTUCK_COOLDOWN_ID)).toBe(false);
    expect(player.pos).toEqual(origin);

    const laterEvents = eventsOf(tickMany(sim, UNSTUCK_COUNTDOWN_SECONDS * 20));
    expect(laterEvents).toEqual([]);
    expect(player.pos).toEqual(origin);
  });

  it('rejects a route through a real blocker wall', () => {
    const wallZ = 38.2;
    const wall: BlockerDef = { x1: -10, z1: wallZ, x2: 10, z2: wallZ };
    const sim = makeWorld([wall]);
    const player = sim.player;
    player.pos = sim.groundPos(0, 37);
    player.prevPos = { ...player.pos };
    sim.grid.update(player);
    sim.playerGrid.update(player);

    const direct = sim.ctx.resolvePlayerMove(
      player.pos.x,
      player.pos.z,
      player.pos.x,
      40,
      PLAYER_BODY_RADIUS,
      player,
      false,
    );
    expect(direct.z).toBeLessThan(wallZ);

    const destination = sim.groundPos(player.pos.x, 40);
    expect(unstuckRouteReachable(sim.ctx, player, player.pos, destination)).toBe(false);
  });

  it('rejects an eight-yard route whose endpoints are stable but crosses a climb gate', () => {
    const sim = makeWorld();
    const player = sim.player;
    const origin = sim.groundPos(-225, 182);
    const destination = sim.groundPos(-217.6089637399097, 178.93853254107927);
    player.pos = { ...origin };
    player.prevPos = { ...origin };

    expect(isUnstuckDestinationSafe(sim.ctx, player, origin)).toBe(true);
    expect(isUnstuckDestinationSafe(sim.ctx, player, destination)).toBe(true);
    const staticSweep = sim.ctx.resolvePlayerMove(
      origin.x,
      origin.z,
      destination.x,
      destination.z,
      PLAYER_BODY_RADIUS,
      player,
      false,
    );
    expect(staticSweep).toEqual({ x: destination.x, z: destination.z });
    expect(unstuckRouteReachable(sim.ctx, player, origin, destination)).toBe(false);
  });

  it('rejects a route through a real closed delve door and accepts it once opened', () => {
    const sim = makeWorld();
    const pid = sim.player.id;
    sim.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, pid);
    sim.enterDelve('collapsed_reliquary', 'normal', pid);
    const run = required(sim.delveRunForPlayer(pid), 'active delve run');
    run.modules = ['reliquary_sunken_ossuary'];
    run.moduleIndex = 0;
    (sim as unknown as { spawnDelveModule(run: DelveRun): void }).spawnDelveModule(run);
    const doorId = required(
      run.objectIds.find((id) => run.objectState[id]?.kind === 'locked_door'),
      'closed delve door',
    );
    const door = required(sim.entities.get(doorId), 'closed delve door entity');
    const from = sim.groundPos(door.pos.x, door.pos.z - 3);
    const to = sim.groundPos(door.pos.x, door.pos.z + 3);
    sim.player.pos = { ...from };
    sim.player.prevPos = { ...from };

    expect(run.objectState[doorId].open).toBe(false);
    expect(unstuckRouteReachable(sim.ctx, sim.player, from, to)).toBe(false);
    run.objectState[doorId].open = true;
    expect(unstuckRouteReachable(sim.ctx, sim.player, from, to)).toBe(true);
  });

  it('rejects a live delve Blackwater destination', () => {
    const sim = makeWorld();
    const pid = sim.player.id;
    sim.setPlayerLevel(DELVES.drowned_litany.minLevel, pid);
    sim.enterDelve('drowned_litany', 'normal', pid);
    const run = required(sim.delveRunForPlayer(pid), 'active Drowned Litany run');
    const module = required(DELVE_MODULES[run.modules[run.moduleIndex]], 'active delve module');
    const hazard = required(module.hazards?.[0], 'active Blackwater zone');
    const destination = sim.groundPos(
      run.origin.x + hazard.x,
      run.origin.z + delveModuleZOffset(run) + hazard.z,
    );

    expect(isUnstuckDestinationSafe(sim.ctx, sim.player, destination)).toBe(false);
  });

  it('rejects live rift lava, ice, and rolling-boulder lanes', () => {
    const cases = [
      {
        seed: seedWithFloor0((floor) => floor.hazards.length > 0),
        point: (floor: ReturnType<typeof generateRiftFloor>) => floor.hazards[0],
      },
      {
        seed: seedWithFloor0((floor) => floor.iceZone !== null),
        point: (floor: ReturnType<typeof generateRiftFloor>) => required(floor.iceZone, 'ice zone'),
      },
      {
        seed: seedWithFloor0((floor) => floor.rollers.length > 0),
        point: (floor: ReturnType<typeof generateRiftFloor>) => {
          const roller = required(floor.rollers[0], 'roller lane');
          return { x: roller.x, z: (roller.z0 + roller.z1) / 2 };
        },
      },
    ];

    for (const testCase of cases) {
      const sim = makeWorld();
      sim.enterRift(testCase.seed, 20, sim.player.id);
      const instance = required(
        sim.riftInstances.find((candidate) => candidate.partyKey !== null),
        'active rift instance',
      );
      const floor = generateRiftFloor(testCase.seed, 20, 0);
      const local = testCase.point(floor);
      const origin = riftInstanceOrigin(instance.slot, 0);
      const destination = sim.groundPos(origin.x + local.x, origin.z + local.z);
      expect(isUnstuckDestinationSafe(sim.ctx, sim.player, destination)).toBe(false);
    }
  });

  it('emits a typed failure and leaves the player in place when no point is safe', () => {
    const sim = makeWedgedWorld();
    const { player, meta } = accepted(sim);
    const origin = { ...player.pos };

    const noSafeContext = new Proxy(sim.ctx, {
      get(target, property, receiver) {
        if (property === 'time') return UNSTUCK_COUNTDOWN_SECONDS;
        if (property === 'resolveMovePoint') {
          return (x: number, z: number) => ({ x: x + 100, z: z + 100 });
        }
        return Reflect.get(target, property, receiver);
      },
    }) as SimContext;

    updateUnstuck(noSafeContext);
    expect(eventsOf(sim.drainEvents())).toContainEqual(
      expect.objectContaining({
        type: 'unstuck',
        phase: 'failed',
        reason: 'no_safe_position',
      }),
    );
    expect(meta.pendingUnstuck).toBeNull();
    expect(player.pos).toEqual(origin);
  });
});

describe('unstuck area identity', () => {
  it('reports content-local positions for dungeon, delve, and procedural rift clones', () => {
    const dungeon = makeWorld();
    dungeon.enterDungeon('hollow_crypt', dungeon.player.id);
    const dungeonLocation = required(
      unstuckLocationAt(dungeon.ctx, dungeon.player.id, dungeon.player.pos),
      'dungeon location',
    );
    expect(dungeonLocation.area).toMatchObject({
      kind: 'dungeon',
      id: 'hollow_crypt',
      instanceId: expect.any(String),
      slot: expect.any(Number),
    });
    expect(Math.abs(dungeonLocation.point.localX)).toBeLessThan(300);
    expect(Math.abs(dungeonLocation.point.x)).toBeGreaterThan(600);

    const delve = makeWorld();
    delve.setPlayerLevel(DELVES.collapsed_reliquary.minLevel, delve.player.id);
    delve.enterDelve('collapsed_reliquary', 'normal', delve.player.id);
    const delveLocation = required(
      unstuckLocationAt(delve.ctx, delve.player.id, delve.player.pos),
      'delve location',
    );
    const run = required(delve.delveRunForPlayer(delve.player.id), 'active delve run');
    const firstModuleId = required(run.modules[run.moduleIndex], 'active delve module id');
    expect(delveLocation.area).toMatchObject({
      kind: 'delve',
      id: `collapsed_reliquary:module:${firstModuleId}`,
      instanceId: `seed:${run.seed >>> 0}:tier:normal`,
      slot: expect.any(Number),
    });
    expect(Math.abs(delveLocation.point.localX)).toBeLessThan(300);

    const originalSeed = run.seed;
    run.seed = (run.seed + 1) >>> 0;
    const sameModuleOtherSeed = required(
      unstuckLocationAt(delve.ctx, delve.player.id, delve.player.pos),
      'same module with another run seed',
    );
    expect(sameModuleOtherSeed.area.id).toBe(delveLocation.area.id);
    expect(sameModuleOtherSeed.area.instanceId).not.toBe(delveLocation.area.instanceId);
    run.seed = originalSeed;

    run.moduleIndex = 1;
    const secondModuleId = required(run.modules[run.moduleIndex], 'second delve module id');
    delve.player.pos = delveModuleEntry(delve.ctx, run);
    delve.player.prevPos = { ...delve.player.pos };
    const secondModule = required(
      unstuckLocationAt(delve.ctx, delve.player.id, delve.player.pos),
      'second delve module location',
    );
    expect(secondModule.area.id).toBe(`collapsed_reliquary:module:${secondModuleId}`);
    expect(secondModule.area.id).not.toBe(delveLocation.area.id);
    expect(Math.abs(secondModule.point.localZ)).toBeLessThan(100);

    const rift = makeWorld();
    rift.enterRift(12345, 20, rift.player.id);
    const riftLocation = required(
      unstuckLocationAt(rift.ctx, rift.player.id, rift.player.pos),
      'rift location',
    );
    expect(riftLocation.area).toMatchObject({
      kind: 'rift',
      id: 'seed:12345:floor:0',
      instanceId: expect.any(String),
      slot: expect.any(Number),
    });
    expect(Math.abs(riftLocation.point.localX)).toBeLessThan(300);
  });

  it('requires a live owned dungeon claim and cancels when its identity changes', () => {
    const sim = makeWorld();
    const owner = sim.player.id;
    const foreign = sim.addPlayer('warrior', 'Stranger');
    sim.enterDungeon('hollow_crypt', owner);
    const ownerPlayer = required(sim.entities.get(owner), 'dungeon owner');
    const foreignPlayer = required(sim.entities.get(foreign), 'foreign player');
    const claim = required(
      sim.instances.find((instance) => instance.partyKey !== null),
      'owned dungeon claim',
    );
    const dungeonOrigin = sim.ctx.instanceOriginOf(claim);
    ownerPlayer.pos = sim.groundPos(dungeonOrigin.x + DUNGEON_WALL_X, dungeonOrigin.z - 2);
    ownerPlayer.prevPos = { ...ownerPlayer.pos };
    foreignPlayer.pos = { ...ownerPlayer.pos };
    foreignPlayer.prevPos = { ...foreignPlayer.pos };

    expect(unstuckLocationAt(sim.ctx, foreign, foreignPlayer.pos)).toBeNull();
    expect(sim.unstuck(owner)).toBe(true);
    sim.drainEvents();
    claim.exitId = required(claim.exitId, 'original claim id') + 10_000;
    expect(eventsOf(sim.tick())).toContainEqual(
      expect.objectContaining({ type: 'unstuck', phase: 'cancelled', reason: 'state_changed' }),
    );

    claim.partyKey = null;
    expect(unstuckLocationAt(sim.ctx, owner, ownerPlayer.pos)).toBeNull();
  });

  it('uses the live Nythraxis claim for its wide floor, ownership, and outside edge', () => {
    const sim = makeWorld();
    const owner = sim.player.id;
    for (let i = 0; i < 4; i++) {
      const member = sim.addPlayer('priest', `Raider${i}`);
      sim.partyInvite(member, owner);
      sim.partyAccept(member);
    }
    sim.convertPartyToRaid(owner);
    required(sim.meta(owner), 'raid owner metadata').questsDone.add('q_nythraxis_bound_guardian');
    sim.enterDungeon('nythraxis_boss_arena', owner);

    const claim = required(
      sim.instances.find(
        (instance) => instance.dungeonId === 'nythraxis_boss_arena' && instance.partyKey !== null,
      ),
      'live Nythraxis claim',
    );
    const origin = sim.ctx.instanceOriginOf(claim);
    const widePoint = sim.groundPos(origin.x + 210, origin.z + 20);
    const ownerPlayer = required(sim.entities.get(owner), 'raid owner');
    ownerPlayer.pos = { ...widePoint };
    ownerPlayer.prevPos = { ...widePoint };
    ownerPlayer.vx = 0;
    ownerPlayer.vy = 0;
    ownerPlayer.vz = 0;
    ownerPlayer.onGround = true;
    ownerPlayer.jumping = false;
    ownerPlayer.inCombat = false;
    ownerPlayer.combatTimer = 999;
    sim.grid.update(ownerPlayer);
    sim.playerGrid.update(ownerPlayer);

    expect(sim.instanceInfoAt(widePoint)).toBeNull();
    expect(sim.instanceClaimIdAt(widePoint)).toBe(claim.exitId);
    expect(unstuckLocationAt(sim.ctx, owner, widePoint)?.area).toMatchObject({
      kind: 'dungeon',
      id: 'nythraxis_boss_arena',
      instanceId: String(claim.exitId),
      slot: claim.slot,
    });

    const foreign = sim.addPlayer('warrior', 'Uninvited');
    const foreignPlayer = required(sim.entities.get(foreign), 'uninvited player');
    foreignPlayer.pos = { ...widePoint };
    foreignPlayer.prevPos = { ...widePoint };
    expect(unstuckLocationAt(sim.ctx, foreign, foreignPlayer.pos)).toBeNull();

    const outside = sim.groundPos(origin.x + 270, origin.z + 96);
    expect(sim.instanceClaimIdAt(outside)).toBeNull();
    expect(unstuckLocationAt(sim.ctx, owner, outside)).toBeNull();

    // The side-wing tomb is a real collider outside the generic 120-yard
    // instance rectangle, so successful admission here exercises the full
    // request path rather than only the location helper.
    expect(sim.unstuck(owner)).toBe(true);
    expect(eventsOf(sim.drainEvents())).toContainEqual({
      type: 'unstuck',
      phase: 'started',
      seconds: UNSTUCK_COUNTDOWN_SECONDS,
      pid: owner,
    });
  });

  it('never classifies unrecognized private instance bands as overworld', () => {
    const sim = makeWorld();
    const privateBand = sim.groundPos(INSTANCE_X_BASE + 7_000, -1_000);
    expect(unstuckLocationAt(sim.ctx, sim.player.id, privateBand)).toBeNull();
  });
});
