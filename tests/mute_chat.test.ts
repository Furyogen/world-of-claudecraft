import { afterEach, describe, expect, it, vi } from 'vitest';

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

function noticesOf(fc: FakeClient): string[] {
  return fc.sent
    .flatMap((msg) => (msg.t === 'events' ? msg.list : []))
    .filter((ev: any) => ev.type === 'log' || ev.type === 'error')
    .map((ev: any) => ev.text);
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

afterEach(() => vi.restoreAllMocks());

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

  it('a GM-silenced player can still read their own mute list', async () => {
    // The interception sits BEFORE isChatMuted on purpose: the player most likely
    // to want a mute is the one already in a chat fight.
    const server = new GameServer();
    const fa = fakeWs();
    const muter = joinServer(server, fa, 1, 'Muter');
    muter.chatMutedUntil = Date.now() + 60_000;

    cmd(server, muter, { cmd: 'chat', text: '/mutelist' });
    // the reply rides the async social service, so let its promise settle
    await new Promise((resolve) => setImmediate(resolve));

    // the real readout came back, not merely "some frame" (which a rate-limit
    // error would also satisfy)
    expect(noticesOf(fa)).toContain('Your mute list is empty.');
  });

  // THE safety property, pinned at the DISPATCH, not just at the parser. Swapping
  // the two branches in game.ts's if-chain would hand a harassed player typing
  // /ignore the WEAK tool (chat-only) while they believe they blocked their
  // harasser, and a parser-only test would stay green through it.
  it.each([
    ['/ignore Bob', 'blockAdd'],
    ['/block Bob', 'blockAdd'],
    ['/unignore Bob', 'blockRemove'],
    ['/unblock Bob', 'blockRemove'],
    ['/mute Bob', 'muteAdd'],
    ['/unmute Bob', 'muteRemove'],
  ] as const)('%s routes to social.%s and nothing else', (text, expected) => {
    const server = new GameServer();
    const fa = fakeWs();
    const session = joinServer(server, fa, 1, 'Player');
    const social = (server as any).social;
    const spies = {
      muteAdd: vi.spyOn(social, 'muteAdd').mockResolvedValue(undefined),
      muteRemove: vi.spyOn(social, 'muteRemove').mockResolvedValue(undefined),
      blockAdd: vi.spyOn(social, 'blockAdd').mockResolvedValue(undefined),
      blockRemove: vi.spyOn(social, 'blockRemove').mockResolvedValue(undefined),
    };

    cmd(server, session, { cmd: 'chat', text });

    for (const [name, spy] of Object.entries(spies)) {
      if (name === expected) {
        expect(spy, name).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][1]).toBe('Bob');
      } else {
        expect(spy, name).not.toHaveBeenCalled();
      }
    }
  });

  it.each([
    ['/mutelist', 'muteList'],
    ['/blocklist', 'blockList'],
    ['/ignorelist', 'blockList'],
  ] as const)('%s routes to social.%s', (text, expected) => {
    const server = new GameServer();
    const fa = fakeWs();
    const session = joinServer(server, fa, 1, 'Player');
    const social = (server as any).social;
    const muteList = vi.spyOn(social, 'muteList').mockResolvedValue(undefined);
    const blockList = vi.spyOn(social, 'blockList').mockResolvedValue(undefined);

    cmd(server, session, { cmd: 'chat', text });

    expect(muteList).toHaveBeenCalledTimes(expected === 'muteList' ? 1 : 0);
    expect(blockList).toHaveBeenCalledTimes(expected === 'blockList' ? 1 : 0);
  });

  it('a bare verb answers with ITS OWN usage line', () => {
    const server = new GameServer();
    const fa = fakeWs();
    const session = joinServer(server, fa, 1, 'Player');

    cmd(server, session, { cmd: 'chat', text: '/mute' });
    expect(noticesOf(fa)).toContain('Usage: /mute <name>, /unmute <name>, /mutelist.');

    cmd(server, session, { cmd: 'chat', text: '/block' });
    expect(noticesOf(fa)).toContain('Usage: /block <name>, /unblock <name>, /blocklist.');
  });

  it('reading your mute list is free: it never burns a chat token', () => {
    // Echoing your own list back must not be able to lock your own chat.
    const server = new GameServer();
    const fa = fakeWs();
    const muter = joinServer(server, fa, 1, 'Muter');
    const tokensBefore = muter.chatTokens;

    for (let i = 0; i < 10; i++) cmd(server, muter, { cmd: 'chat', text: '/mutelist' });

    expect(muter.chatTokens).toBe(tokensBefore);
    expect(muter.chatCooldownUntil).toBe(0);
  });

  it.each([
    '/mute Bob',
    '/unmute Bob',
    '/block Bob',
    '/unblock Bob',
  ])('an exhausted chat bucket REFUSES the write command %s', (text) => {
    // Charging a token is not the security property; REFUSING once the bucket is
    // empty is. Each of these INSERT/DELETEs and then pushes a full social
    // snapshot, so they are the most expensive commands on the chat path and
    // must not be the one thing on it an attacker can spin for free.
    const server = new GameServer();
    const fa = fakeWs();
    const session = joinServer(server, fa, 1, 'Player');
    const social = (server as any).social;
    const spies = [
      vi.spyOn(social, 'muteAdd').mockResolvedValue(undefined),
      vi.spyOn(social, 'muteRemove').mockResolvedValue(undefined),
      vi.spyOn(social, 'blockAdd').mockResolvedValue(undefined),
      vi.spyOn(social, 'blockRemove').mockResolvedValue(undefined),
    ];

    // CHAT_RATE_BURST is 5; send well past it in one go
    for (let i = 0; i < 40; i++) cmd(server, session, { cmd: 'chat', text });

    const total = spies.reduce((n, s) => n + s.mock.calls.length, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(5);
  });

  it('a muted player goes quiet through the REAL command, not a hand-planted set', async () => {
    // Everything above plants session.mutedIds directly. This drives the actual
    // path: /mute -> SocialService -> onMutesChanged -> session.mutedIds -> the
    // routeEvents filter. Dropping the onMutesChanged hook would leave /mute
    // reporting success while the target stayed audible all session, and every
    // other test here would still pass.
    const server = new GameServer();
    const fa = fakeWs();
    const fb = fakeWs();
    const listener = joinServer(server, fa, 1, 'Listener');
    const spammer = joinServer(server, fb, 2, 'Spammer');
    colocate(server, listener.pid, spammer.pid);

    // resolve 'Spammer' -> character id 2, and report the post-write mute set
    const social = (server as any).social;
    vi.spyOn((server as any).socialDb, 'findCharacterByName').mockResolvedValue({
      id: 2,
      name: 'Spammer',
      cls: 'warrior',
      level: 1,
      realm: 'R1',
    } as any);
    vi.spyOn((server as any).socialDb, 'listMutes').mockResolvedValue([]);
    vi.spyOn((server as any).socialDb, 'addMute').mockResolvedValue(undefined);
    vi.spyOn((server as any).socialDb, 'mutedIds').mockResolvedValue([2]);
    expect(listener.mutedIds.size).toBe(0);

    cmd(server, listener, { cmd: 'chat', text: '/mute Spammer' });
    await new Promise((resolve) => setImmediate(resolve));

    // the transport hook actually repopulated the live session set
    expect([...listener.mutedIds]).toEqual([2]);
    expect(social).toBeTruthy();

    cmd(server, spammer, { cmd: 'chat', text: 'buy gold now' });
    route(server);

    expect(chatsOf(fa).map((ev) => ev.text)).not.toContain('buy gold now');
  });
});
