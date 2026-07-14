// Online wire path for gather-node harvest (#1888). The harvest_node command
// dispatch (server/game.ts) shipped in #1121 with no test ever driving it over
// the wire (every gathering test calls sim.harvestNode directly), which is one
// of the reasons the missing client trigger stayed invisible. These tests feed
// real frames through GameServer.handleMessage: the grant lands, denials come
// back as error events to the acting session, malformed frames are ignored,
// and the per-viewer `gnodes` self-wire delta rides the snapshot.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => ({ listings: [], collections: new Map() })),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => true),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { GATHER_NODES } from '../src/sim/data';
import { NODE_HARVEST_TABLE } from '../src/sim/professions/gathering';
import type { PlayerClass } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const ORE_NODE = GATHER_NODES.find((n) => n.type === 'ore')!;
const ORE_ITEM = NODE_HARVEST_TABLE.ore.itemId;

interface FakeClient {
  sent: unknown[];
  ws: { readyState: number; send: (payload: string) => void };
}

function fakeWs(): FakeClient {
  const sent: unknown[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
    },
  };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws as any, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function teleport(sim: GameServer['sim'], pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

function advance(server: GameServer): void {
  const events = server.sim.tick();
  (server as any).routeEvents(events);
  (server as any).broadcastSnapshots();
}

function lastSnap(fc: FakeClient): any {
  for (let i = fc.sent.length - 1; i >= 0; i--) {
    const msg = fc.sent[i] as any;
    if (msg.t === 'snap') return msg;
  }
  return null;
}

function errorTexts(fc: FakeClient): string[] {
  return fc.sent
    .flatMap((msg: any) => (msg.t === 'events' ? msg.list : []))
    .filter((ev: any) => ev.type === 'error')
    .map((ev: any) => ev.text);
}

function harvestCmd(server: GameServer, session: ClientSession, node: unknown): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'harvest_node', node }));
}

describe('harvest_node over the wire (#1888)', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
  });

  it('a harvest_node frame from a player on the node grants the material and ships the gnodes delta', () => {
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'WireMiner');
    teleport(server.sim, session.pid, ORE_NODE.pos.x, ORE_NODE.pos.z);

    harvestCmd(server, session, ORE_NODE.id);
    advance(server);

    expect(server.sim.countItem(ORE_ITEM, session.pid)).toBe(1);
    const snap = lastSnap(fc);
    expect(snap).not.toBeNull();
    // The per-viewer cooldown map arrived with exactly this node cooling.
    expect(snap.self.gnodes).toHaveProperty(ORE_NODE.id);
    expect(snap.self.gnodes[ORE_NODE.id]).toBeGreaterThan(server.sim.time);
  });

  it('a premature re-harvest returns the respawn denial to the acting session only', () => {
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Spammer');
    const fcOther = fakeWs();
    const other = joinServer(server, fcOther, 2, 'Bystander', 'mage');
    teleport(server.sim, session.pid, ORE_NODE.pos.x, ORE_NODE.pos.z);
    teleport(server.sim, other.pid, ORE_NODE.pos.x, ORE_NODE.pos.z);

    harvestCmd(server, session, ORE_NODE.id);
    advance(server);
    harvestCmd(server, session, ORE_NODE.id);
    advance(server);

    expect(server.sim.countItem(ORE_ITEM, session.pid)).toBe(1);
    expect(errorTexts(fc)).toContain('This resource node has not respawned for you yet.');
    expect(errorTexts(fcOther)).toHaveLength(0);
    // The bystander's own timer is untouched: their gnodes delta stays empty.
    expect(lastSnap(fcOther).self.gnodes ?? {}).toEqual({});
  });

  it('an out-of-range harvest_node frame is denied by the server distance gate', () => {
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'FarMiner');
    teleport(server.sim, session.pid, ORE_NODE.pos.x + 100, ORE_NODE.pos.z + 100);

    harvestCmd(server, session, ORE_NODE.id);
    advance(server);

    expect(server.sim.countItem(ORE_ITEM, session.pid)).toBe(0);
    expect(errorTexts(fc)).toContain('Too far away.');
  });

  it('malformed frames are ignored: a non-string node id neither grants nor throws', () => {
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Fuzzer');
    teleport(server.sim, session.pid, ORE_NODE.pos.x, ORE_NODE.pos.z);

    expect(() => {
      harvestCmd(server, session, 5);
      harvestCmd(server, session, null);
      harvestCmd(server, session, { id: ORE_NODE.id });
    }).not.toThrow();
    advance(server);

    expect(server.sim.countItem(ORE_ITEM, session.pid)).toBe(0);
    expect(errorTexts(fc)).toHaveLength(0);
  });
});
