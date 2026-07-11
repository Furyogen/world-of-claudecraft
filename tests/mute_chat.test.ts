import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the mute enforcement in the
// server's event routing is what is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { type ClientSession, GameServer } from '../server/game';
import type { PlayerClass } from '../src/sim/types';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function joinServer(
  server: GameServer,
  fc: FakeClient,
  characterId: number,
  name: string,
  cls: PlayerClass = 'warrior',
): ClientSession {
  const session = server.join(fc.ws, characterId, characterId, name, cls, null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function route(server: GameServer): void {
  (server as any).routeEvents(server.sim.tick());
}

function cmd(server: GameServer, session: ClientSession, msg: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...msg }));
}

function chatsOf(fc: FakeClient): any[] {
  return fc.sent
    .flatMap((msg) => (msg.t === 'events' ? msg.list : []))
    .filter((ev: any) => ev.type === 'chat');
}

// Park two players on top of each other so say/yell interest scope is satisfied.
function colocate(server: GameServer, aPid: number, bPid: number): void {
  const a = server.sim.entities.get(aPid);
  const b = server.sim.entities.get(bPid);
  if (!a || !b) throw new Error('missing entity');
  b.pos.x = a.pos.x;
  b.pos.y = a.pos.y;
  b.pos.z = a.pos.z;
}

// The listener has the speaker muted, by CHARACTER id (the mute list is keyed by
// character, and routeEvents maps the event's ephemeral pid through the client map).
function muteSpeaker(listener: ClientSession, speakerCharacterId: number): void {
  listener.mutedIds = new Set([speakerCharacterId]);
}

describe('mute: public chat is dropped before it reaches the muter', () => {
  it('drops the muted speaker say, and leaves everyone else audible', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const fc = fakeWs();
    const listener = joinServer(server, fa, 1, 'Listener');
    const spammer = joinServer(server, fb, 2, 'Spammer');
    const bystander = joinServer(server, fc, 3, 'Bystander');
    colocate(server, listener.pid, spammer.pid);
    colocate(server, listener.pid, bystander.pid);
    muteSpeaker(listener, spammer.characterId);

    cmd(server, spammer, { cmd: 'chat', text: 'buy gold now' });
    cmd(server, bystander, { cmd: 'chat', text: 'hello there' });
    route(server);

    const heard = chatsOf(fa).map((ev) => ev.text);
    expect(heard).not.toContain('buy gold now');
    expect(heard).toContain('hello there');
    // the speaker still sees their own line: they were muted BY someone, not silenced
    expect(chatsOf(fb).map((ev) => ev.text)).toContain('buy gold now');
  });

  it('a mute is NOT a block: the muted player can still whisper you', () => {
    // Whispers ride the same chat event as public chat, so a filter keyed on the
    // event type instead of the channel would silently make mute == block here.
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const listener = joinServer(server, fa, 1, 'Listener');
    const spammer = joinServer(server, fb, 2, 'Spammer');
    colocate(server, listener.pid, spammer.pid);
    muteSpeaker(listener, spammer.characterId);

    cmd(server, spammer, { cmd: 'chat', text: '/w Listener are we good' });
    route(server);

    const whispers = chatsOf(fa).filter((ev) => ev.channel === 'whisper');
    expect(whispers.map((ev) => ev.text)).toContain('are we good');
  });

  it('a mute does not hide a muted player /roll, which a loot dispute depends on', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const listener = joinServer(server, fa, 1, 'Listener');
    const spammer = joinServer(server, fb, 2, 'Spammer');
    colocate(server, listener.pid, spammer.pid);
    muteSpeaker(listener, spammer.characterId);

    cmd(server, spammer, { cmd: 'chat', text: '/roll' });
    route(server);

    expect(chatsOf(fa).filter((ev) => ev.channel === 'roll').length).toBe(1);
  });

  it('an unmuted listener hears everything', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const listener = joinServer(server, fa, 1, 'Listener');
    const speaker = joinServer(server, fb, 2, 'Speaker');
    colocate(server, listener.pid, speaker.pid);

    cmd(server, speaker, { cmd: 'chat', text: 'buy gold now' });
    route(server);

    expect(chatsOf(fa).map((ev) => ev.text)).toContain('buy gold now');
  });
});

describe('mute commands survive the chat pipeline gates', () => {
  it('/mute is claimed for a normal player and never reaches the chat broadcast', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const muter = joinServer(server, fa, 1, 'Muter');
    const other = joinServer(server, fb, 2, 'Other');
    colocate(server, muter.pid, other.pid);

    cmd(server, muter, { cmd: 'chat', text: '/mute Spammer' });
    route(server);

    // the literal command text must not be broadcast as a say line to anyone
    expect(chatsOf(fb).map((ev) => ev.text)).not.toContain('/mute Spammer');
    expect(chatsOf(fa).map((ev) => ev.text)).not.toContain('/mute Spammer');
  });

  it('a GM-silenced player can still manage their own mute list', async () => {
    // The interception sits BEFORE isChatMuted on purpose: the player most likely
    // to want a mute is the one already in a chat fight.
    const server = new GameServer();
    const fa = fakeWs();
    const muter = joinServer(server, fa, 1, 'Muter');
    muter.chatMutedUntil = Date.now() + 60_000;
    const before = fa.sent.length;

    cmd(server, muter, { cmd: 'chat', text: '/mutelist' });
    // the reply rides the async social service, so let its promise settle
    await new Promise((resolve) => setImmediate(resolve));

    // it was handled (a reply came back), not swallowed by the mute gate
    expect(fa.sent.length).toBeGreaterThan(before);
  });

  it('/mutelist does not burn a chat token toward the rate-limit cooldown', () => {
    // The interception also sits BEFORE consumeChatToken, so managing your mute
    // list can never lock your own chat.
    const server = new GameServer();
    const fa = fakeWs();
    const muter = joinServer(server, fa, 1, 'Muter');
    const tokensBefore = muter.chatTokens;

    for (let i = 0; i < 10; i++) cmd(server, muter, { cmd: 'chat', text: '/mutelist' });

    expect(muter.chatTokens).toBe(tokensBefore);
    expect(muter.chatCooldownUntil).toBe(0);
  });
});
