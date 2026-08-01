// GameServer wiring for the game-master toolkit: the half AdminToolsService
// delegates to (visibility on the wire, the sim-side hold, teleports, and the
// freeze's persistence across a relog). The parser and the policy rules are
// covered by tests/admin_commands.test.ts and tests/admin_tools_service.test.ts.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

vi.mock('../server/moderation_db', () => ({
  recordInGameAction: vi.fn(async () => {}),
  muteAccountChat: vi.fn(async () => {}),
  moderateAccount: vi.fn(async () => {}),
  forceCharacterRename: vi.fn(async () => ({ accountId: 0 })),
}));

import { saveCharacterState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';
import { isAdminCloaked } from '../src/sim/admin_cloak';
import { isAdminFreezeAura, isAdminFrozen } from '../src/sim/admin_freeze';
import { BUILTIN_WORLD, setActiveWorldContent, WORLD_MAX_X, zoneAt } from '../src/sim/data';

// The toolkit acts on player sessions only; ambient camps, npcs and ground
// objects never take part, and every case boots a full GameServer, so strip
// them through the active-world seam (same pattern as moderation_game.test.ts).
setActiveWorldContent({ ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] });
afterAll(() => setActiveWorldContent(null));

const GM_PERMS = ['gm.tools'] as const;
const MOD_ONLY_PERMS = ['moderation.act', 'moderation.spectate'] as const;

type FakeWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type TestFrame = {
  t?: string;
  // The server splices pre-serialized entity records into the frame text, so a
  // parsed frame hands them back as objects, not as strings.
  ents?: { id: number }[];
  keep?: number[];
  list?: { type?: string; text?: string }[];
};

function fakeWs(): FakeWs & Parameters<GameServer['join']>[0] {
  const ws = { readyState: 1, send: vi.fn(), close: vi.fn() };
  return ws as unknown as FakeWs & Parameters<GameServer['join']>[0];
}

function joined(result: ClientSession | { error: string }): ClientSession {
  if ('error' in result) throw new Error(result.error);
  result.blockListLoaded = true;
  return result;
}

function entity(server: GameServer, pid: number) {
  const found = server.sim.entities.get(pid);
  if (!found) throw new Error(`entity ${pid} missing`);
  return found;
}

function frames(ws: FakeWs): TestFrame[] {
  return ws.send.mock.calls.map((call) => JSON.parse(String(call[0])) as TestFrame);
}

function eventTexts(ws: FakeWs): string[] {
  return frames(ws)
    .filter((frame) => frame.t === 'events')
    .flatMap((frame) => frame.list ?? [])
    .map((event) => event.text)
    .filter((text): text is string => typeof text === 'string');
}

// Whether the viewer's latest snapshot still knows about `pid`, through either
// arm of the wire: a full/lite record in `ents` or a bare id on `keep`.
function seesEntity(ws: FakeWs, pid: number): boolean {
  const snap = frames(ws)
    .filter((frame) => frame.t === 'snap')
    .at(-1);
  if (!snap) throw new Error('no snapshot sent');
  const inEnts = (snap.ents ?? []).some((record) => record.id === pid);
  return inEnts || (snap.keep ?? []).includes(pid);
}

function command(server: GameServer, session: ClientSession, text: string): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'chat', text }));
}

function broadcast(server: GameServer): void {
  (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
}

// One admin with gm.tools plus one ordinary player, standing on the same spot so
// they are inside each other's interest radius from the first snapshot.
function twoPlayers() {
  const server = new GameServer();
  const adminWs = fakeWs();
  const playerWs = fakeWs();
  const admin = joined(
    server.join(adminWs, 1, 101, 'Gm', 'warrior', null, false, {
      isAdmin: true,
      adminPermissions: GM_PERMS,
    }),
  );
  const bob = joined(server.join(playerWs, 2, 102, 'Bob', 'rogue', null));
  const bobEntity = entity(server, bob.pid);
  const adminEntity = entity(server, admin.pid);
  bobEntity.pos = { ...adminEntity.pos };
  bobEntity.prevPos = { ...adminEntity.pos };
  server.sim.grid.update(bobEntity);
  server.sim.playerGrid.update(bobEntity);
  return { server, admin, adminWs, bob, playerWs };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveCharacterState).mockResolvedValue(true);
});

describe('/invisible and /visible', () => {
  it('removes the admin from another player snapshot and puts them back', () => {
    const { server, admin, adminWs, playerWs } = twoPlayers();
    broadcast(server);
    expect(seesEntity(playerWs, admin.pid)).toBe(true);

    command(server, admin, '/invisible');
    expect(isAdminCloaked(entity(server, admin.pid))).toBe(true);
    broadcast(server);
    expect(seesEntity(playerWs, admin.pid)).toBe(false);
    // The admin still sees themselves: the self block is wired separately from
    // the interest list, so the cloak never blinds its owner.
    expect(
      frames(adminWs)
        .filter((frame) => frame.t === 'snap')
        .at(-1)?.t,
    ).toBe('snap');
    expect(eventTexts(adminWs)).toContain(
      'You are now invisible. Nobody can see, target, or harm you.',
    );

    command(server, admin, '/visible');
    expect(isAdminCloaked(entity(server, admin.pid))).toBe(false);
    broadcast(server);
    expect(seesEntity(playerWs, admin.pid)).toBe(true);
    expect(eventTexts(adminWs)).toContain('You are now visible again.');
  });

  it('hides the cloaked admin from another player /who, but not from their own', () => {
    const { server, admin, adminWs, bob, playerWs } = twoPlayers();
    command(server, bob, '/who');
    expect(eventTexts(playerWs).some((text) => text.startsWith('Gm - level'))).toBe(true);

    command(server, admin, '/invisible');
    playerWs.send.mockClear();
    command(server, bob, '/who');
    expect(eventTexts(playerWs).some((text) => text.startsWith('Gm - level'))).toBe(false);
    expect(eventTexts(playerWs).some((text) => text.startsWith('Bob - level'))).toBe(true);
    adminWs.send.mockClear();
    command(server, admin, '/who');
    expect(eventTexts(adminWs).some((text) => text.startsWith('Gm - level'))).toBe(true);
  });

  it('is not reachable by a moderator who lacks gm.tools', () => {
    const server = new GameServer();
    const ws = fakeWs();
    const mod = joined(
      server.join(ws, 1, 101, 'Mod', 'warrior', null, false, {
        isAdmin: true,
        adminPermissions: MOD_ONLY_PERMS,
      }),
    );
    command(server, mod, '/invisible');
    expect(isAdminCloaked(entity(server, mod.pid))).toBe(false);
  });
});

describe('/freeze and /unfreeze', () => {
  it('encases the target, tells them, and releases them again', () => {
    const { server, admin, bob, playerWs } = twoPlayers();
    command(server, admin, '/freeze "Bob"');
    const bobEntity = entity(server, bob.pid);
    expect(isAdminFrozen(bobEntity)).toBe(true);
    expect(bobEntity.auras.filter(isAdminFreezeAura)).toHaveLength(1);
    expect(bob.adminFreeze).not.toBeNull();
    expect(eventTexts(playerWs)).toContain('A moderator has frozen you in place.');

    command(server, admin, '/unfreeze "Bob"');
    expect(isAdminFrozen(entity(server, bob.pid))).toBe(false);
    expect(entity(server, bob.pid).auras.filter(isAdminFreezeAura)).toHaveLength(0);
    expect(bob.adminFreeze).toBeNull();
    expect(eventTexts(playerWs)).toContain('A moderator has unfrozen you.');
  });

  it('persists the freeze so a relog cannot shed it', async () => {
    const { server, admin, bob } = twoPlayers();
    command(server, admin, '/freeze "Bob"');

    await server.saveCharacter(bob);
    const saved = vi
      .mocked(saveCharacterState)
      .mock.calls.find(([characterId]) => characterId === bob.characterId)?.[2];
    if (!saved) throw new Error('frozen state was not saved');
    expect(saved.adminFreeze?.since).toBeGreaterThan(0);

    const relogServer = new GameServer();
    const relogged = joined(relogServer.join(fakeWs(), 2, 102, 'Bob', 'rogue', saved));
    expect(relogged.adminFreeze?.since).toBe(saved.adminFreeze?.since);
    expect(isAdminFrozen(entity(relogServer, relogged.pid))).toBe(true);
  });

  it('does not let a cloak stow clobber a pet another parked state already holds', async () => {
    // Cloaking while ALREADY spectating stows nothing (the spectate state owns
    // the real pet), so the cloak's save arm must not write its null over it.
    const { server, admin } = twoPlayers();
    const adminEntity = entity(server, admin.pid);
    const stowedPet = {
      templateId: 'forest_wolf',
      name: 'Fang',
      level: 5,
      hp: 40,
      dead: false,
    };
    admin.spectating = {
      characterId: 999,
      name: 'Bob',
      savedPos: { ...adminEntity.pos },
      priorGm: false,
      stowedPet,
    };
    command(server, admin, '/invisible');
    expect(admin.cloak?.stowedPet).toBeNull();

    await server.saveCharacter(admin);
    const saved = vi
      .mocked(saveCharacterState)
      .mock.calls.find(([characterId]) => characterId === admin.characterId)?.[2];
    expect(saved?.pet).toEqual(stowedPet);
  });

  it('drops the freeze from the save once released', async () => {
    const { server, admin, bob } = twoPlayers();
    command(server, admin, '/freeze "Bob"');
    command(server, admin, '/unfreeze "Bob"');
    await server.saveCharacter(bob);
    const saved = vi
      .mocked(saveCharacterState)
      .mock.calls.find(([characterId]) => characterId === bob.characterId)?.[2];
    expect(saved && Object.hasOwn(saved, 'adminFreeze')).toBe(false);
  });
});

describe('/tpto, /tptome and /tp', () => {
  it('moves the admin to the player and the player to the admin', () => {
    const { server, admin, adminWs, bob, playerWs } = twoPlayers();
    const bobEntity = entity(server, bob.pid);
    bobEntity.pos = { ...bobEntity.pos, x: bobEntity.pos.x + 60, z: bobEntity.pos.z + 60 };
    server.sim.grid.update(bobEntity);
    server.sim.playerGrid.update(bobEntity);

    command(server, admin, '/tpto "Bob"');
    const adminEntity = entity(server, admin.pid);
    expect(adminEntity.pos.x).toBeCloseTo(bobEntity.pos.x, 5);
    expect(adminEntity.pos.z).toBeCloseTo(bobEntity.pos.z, 5);
    expect(eventTexts(adminWs)).toContain('Teleported to Bob.');

    // Now walk the admin away and pull Bob to them.
    adminEntity.pos = { ...adminEntity.pos, x: adminEntity.pos.x - 120 };
    server.sim.grid.update(adminEntity);
    server.sim.playerGrid.update(adminEntity);
    command(server, admin, '/tptome "Bob"');
    expect(entity(server, bob.pid).pos.x).toBeCloseTo(adminEntity.pos.x, 5);
    expect(entity(server, bob.pid).pos.z).toBeCloseTo(adminEntity.pos.z, 5);
    expect(eventTexts(adminWs)).toContain('Summoned Bob.');
    expect(eventTexts(playerWs)).toContain('Gm has summoned you.');
  });

  it('teleports to coordinates and names the zone it landed in', () => {
    const { server, admin, adminWs } = twoPlayers();
    command(server, admin, '/tp -231, 1, 107');
    const adminEntity = entity(server, admin.pid);
    expect(adminEntity.pos.x).toBe(-231);
    expect(adminEntity.pos.z).toBe(107);
    expect(eventTexts(adminWs)).toContain(
      `Teleported to ${zoneAt(-231, 107).name} at (-231, 107).`,
    );
  });

  it('honours an explicit height but clamps an absurd one', () => {
    const { server, admin } = twoPlayers();
    command(server, admin, '/tp -231, 40, 107');
    const raised = entity(server, admin.pid);
    const groundY = server.sim.groundPos(-231, 107).y;
    expect(raised.pos.y).toBe(40);
    expect(raised.onGround).toBe(false);
    // A height at or below the terrain just lands on the ground, as every
    // pre-existing teleport caller does.
    command(server, admin, '/tp -231, -50, 107');
    expect(entity(server, admin.pid).pos.y).toBe(groundY);
    expect(entity(server, admin.pid).onGround).toBe(true);
    // A typo does not park the body in orbit.
    command(server, admin, '/tp -231, 1000000000, 107');
    expect(entity(server, admin.pid).pos.y).toBe(groundY + 200);
  });

  it('refuses coordinates outside the world instead of stranding the admin', () => {
    const { server, admin, adminWs } = twoPlayers();
    const before = { ...entity(server, admin.pid).pos };
    command(server, admin, `/tp ${WORLD_MAX_X + 5000}, 0`);
    expect(entity(server, admin.pid).pos).toEqual(before);
    expect(eventTexts(adminWs)).toContain('Those coordinates are outside the world.');
  });

  it('refuses to teleport either end into or out of instance space', () => {
    // Instance coordinates sit far outside the overworld footprint; landing a
    // body there without instance membership strands it in a room it cannot
    // leave, so both /tpto and /tptome refuse rather than trying.
    const { server, admin, adminWs, bob } = twoPlayers();
    const bobEntity = entity(server, bob.pid);
    const overworld = { ...bobEntity.pos };
    bobEntity.pos = { ...bobEntity.pos, x: 100_300 };
    server.sim.grid.update(bobEntity);
    server.sim.playerGrid.update(bobEntity);

    const adminBefore = { ...entity(server, admin.pid).pos };
    command(server, admin, '/tpto "Bob"');
    expect(entity(server, admin.pid).pos).toEqual(adminBefore);
    expect(eventTexts(adminWs)).toContain('Bob has no reachable location right now.');

    command(server, admin, '/tptome "Bob"');
    expect(entity(server, bob.pid).pos.x).toBe(100_300);
    expect(eventTexts(adminWs)).toContain('Bob cannot be summoned right now.');

    // Back in the overworld the same two commands work again.
    bobEntity.pos = overworld;
    server.sim.grid.update(bobEntity);
    server.sim.playerGrid.update(bobEntity);
    command(server, admin, '/tpto "Bob"');
    expect(eventTexts(adminWs)).toContain('Teleported to Bob.');
  });

  it('refuses to summon a jailed player', () => {
    const { server, admin, adminWs, bob } = twoPlayers();
    command(server, admin, '/tptome "Bob"');
    expect(eventTexts(adminWs)).toContain('Summoned Bob.');
    bob.jailed = { returnPos: { x: 0, z: 0 }, returnFacing: 0 };
    command(server, admin, '/tptome "Bob"');
    expect(eventTexts(adminWs)).toContain('Bob cannot be summoned right now.');
  });
});
