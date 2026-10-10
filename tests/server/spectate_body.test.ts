vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountWeaponSkins: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  setCharacterHotbarLayout: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  saveRiftState: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
}));

import { describe, expect, it, vi } from 'vitest';
import { type ClientSession, GameServer } from '../../server/game';
import { HILL_ACCRUAL_SECONDS, spawnHillNow } from '../../src/sim/pvp';
import { DT } from '../../src/sim/types';
import { fakeWs, joinServer } from '../helpers/bare_client';

// server/spectate_body.ts: /spectate parks the moderator's body in limbo, and
// the sim must still know where that body really stands. Regression: an admin
// holding the King of the Hill who opened /spectate on another player stopped
// earning Honor, because the hill's presence pass read the limbo position.

interface SpectateArms {
  enterSpectate(moderator: ClientSession, target: ClientSession): void;
  exitSpectate(moderator: ClientSession, announce?: boolean): void;
}

function tickSeconds(server: GameServer, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) server.sim.tick();
}

describe('/spectate keeps the moderator where their body stands', () => {
  it('a hill holder who spectates another player keeps the hill and its Honor', () => {
    const server = new GameServer();
    const moderator = joinServer(server, fakeWs(), 701, 'Hill Warden');
    const target = joinServer(server, fakeWs(), 702, 'Far Wanderer');
    const arms = server as unknown as SpectateArms;
    const hill = spawnHillNow(server.sim.ctx, 'drakelands');
    if (!hill) throw new Error('no hill spot');
    const body = server.sim.entities.get(moderator.pid)!;
    body.pos = server.sim.groundPos(hill.x, hill.z);
    body.prevPos = { ...body.pos };
    hill.holder = `solo:${moderator.pid}`;

    arms.enterSpectate(moderator, target);
    expect(Math.hypot(body.pos.x - hill.x, body.pos.z - hill.z)).toBeGreaterThan(1000);
    expect(server.sim.meta(moderator.pid)!.spectateAnchor).toEqual({ x: hill.x, z: hill.z });

    const honorBefore = server.sim.meta(moderator.pid)!.honor;
    tickSeconds(server, HILL_ACCRUAL_SECONDS + 2);
    expect(hill.insideKeys.get(moderator.pid)).toBe(`solo:${moderator.pid}`);
    expect(hill.holder).toBe(`solo:${moderator.pid}`);
    expect(server.sim.meta(moderator.pid)!.honor).toBeGreaterThan(honorBefore);

    arms.exitSpectate(moderator, false);
    expect(server.sim.meta(moderator.pid)!.spectateAnchor).toBeNull();
    expect(body.pos.x).toBeCloseTo(hill.x);
    expect(body.pos.z).toBeCloseTo(hill.z);
  });

  it('retargeting keeps the anchor at the first saved spot, not the limbo', () => {
    const server = new GameServer();
    const moderator = joinServer(server, fakeWs(), 711, 'Hill Keeper');
    const first = joinServer(server, fakeWs(), 712, 'First Watched');
    const second = joinServer(server, fakeWs(), 713, 'Second Watched');
    const arms = server as unknown as SpectateArms;
    const body = server.sim.entities.get(moderator.pid)!;
    const home = { x: body.pos.x, z: body.pos.z };

    arms.enterSpectate(moderator, first);
    arms.enterSpectate(moderator, second);
    expect(server.sim.meta(moderator.pid)!.spectateAnchor).toEqual(home);
    arms.exitSpectate(moderator, false);
    expect(server.sim.meta(moderator.pid)!.spectateAnchor).toBeNull();
    expect({ x: body.pos.x, z: body.pos.z }).toEqual(home);
  });
});
