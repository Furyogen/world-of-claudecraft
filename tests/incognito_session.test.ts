import { afterEach, describe, expect, it, vi } from 'vitest';

// The staff incognito login mode, end to end through the real GameServer: a
// staff account that joins incognito must look like an ordinary player on the
// wire (no $WOC holder badge, no linked-Discord identity or role tag, no
// account flair, no chat sender flair), while a normal join of the same account
// shows all of it. Every integration read is mocked to return a fully flaired
// account, so an absent field can only mean the mode withheld it.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => ({ pubkey: 'StaffWallet111' })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  loadAccountFlair: vi.fn(async () => ({
    ai: true,
    streamer: true,
    links: { twitch: 'https://twitch.tv/staffer' },
  })),
}));
vi.mock('../server/woc_balance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/woc_balance')>()),
  holderInfoForPubkey: vi.fn(async () => ({ tier: 3, balance: 50_000 })),
}));
vi.mock('../server/github_db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/github_db')>()),
  githubForAccount: vi.fn(async () => ({ github_login: 'staffer' })),
}));
vi.mock('../server/github_contributors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/github_contributors')>()),
  mergedPrsForLogin: vi.fn(async () => 40),
}));
vi.mock('../server/discord_db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/discord_db')>()),
  discordFlairForAccount: vi.fn(async () => ({
    tier: 2,
    avatarUrl: 'https://cdn.example/staffer.png',
    name: 'Staffer',
    joinedAtMs: 1_700_000_000_000,
    role: 'admin',
  })),
}));

import { drainActivity, enqueueActivity } from '../server/discord_activity';
import { discordFlairForAccount } from '../server/discord_db';
import { drainRelay } from '../server/discord_relay';
import { type ClientSession, GameServer, wireEntity } from '../server/game';

interface FakeClient {
  sent: any[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) } };
}

function join(
  server: GameServer,
  fc: FakeClient,
  id: number,
  meta: Record<string, unknown>,
): ClientSession {
  const s = server.join(fc.ws, id, id, 'Staffer', 'warrior', null, false, meta as never);
  if ('error' in s) throw new Error(s.error);
  s.blockListLoaded = true;
  return s;
}

// The flair stamps are fire-and-forget awaits; let every pending one settle.
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

// Every identity wire key the integrations feed (server/game.ts wireEntity).
const FLAIR_KEYS = [
  'ht',
  'hb',
  'dt',
  'dav',
  'dnm',
  'dj',
  'dr',
  'dvt',
  'dvc',
  'dgl',
  'ai',
  'slk',
] as const;

afterEach(() => vi.clearAllMocks());

describe('staff incognito session', () => {
  it('a NORMAL staff join shows the wallet, Discord, and account flair (control)', async () => {
    const server = new GameServer();
    const s = join(server, fakeWs(), 1, { isAdmin: true });
    await settle();
    const e = server.sim.entities.get(s.pid)!;
    expect(e.holderTier).toBe(3);
    expect(e.discordRole).toBe('admin');
    expect(e.discordName).toBe('Staffer');
    expect(e.githubLogin).toBe('staffer');
    const wire = wireEntity(e);
    for (const k of FLAIR_KEYS) expect(wire[k], k).toBeDefined();
    expect(s.chatFlair).toBeDefined();
  });

  it('an INCOGNITO staff join carries no identity flair at all', async () => {
    const server = new GameServer();
    const s = join(server, fakeWs(), 1, { isAdmin: true, incognito: true });
    await settle();
    expect(s.incognito).toBe(true);
    const e = server.sim.entities.get(s.pid)!;
    expect(e.holderTier).toBeUndefined();
    expect(e.holderBalance).toBeUndefined();
    expect(e.discordTier).toBeUndefined();
    expect(e.discordRole).toBeUndefined();
    expect(e.discordName).toBeUndefined();
    expect(e.discordAvatar).toBeUndefined();
    expect(e.devTier).toBeUndefined();
    expect(e.aiAccount).toBeUndefined();
    expect(e.streamerLinks).toBeUndefined();
    const wire = wireEntity(e);
    for (const k of FLAIR_KEYS) expect(wire[k], k).toBeUndefined();
    expect(s.chatFlair).toBeUndefined();
  });

  it('keeps the flair off through the periodic refresh and a live operator edit', async () => {
    const server = new GameServer();
    const s = join(server, fakeWs(), 1, { isAdmin: true, incognito: true });
    await (server as any).refreshAllHolderTiers();
    server.applyAccountFlairLive(1, { ai: true, streamer: false, links: {} });
    await settle();
    const e = server.sim.entities.get(s.pid)!;
    expect(e.holderTier).toBeUndefined();
    expect(e.discordRole).toBeUndefined();
    expect(e.aiAccount).toBeUndefined();
    expect(s.chatFlair).toBeUndefined();
  });

  it('sends a chat line with no sender flair or staff role tag', async () => {
    const server = new GameServer();
    const speaker = join(server, fakeWs(), 1, { isAdmin: true, incognito: true });
    const fb = fakeWs();
    const listener = server.join(fb.ws, 2, 2, 'Listener', 'mage', null);
    if ('error' in listener) throw new Error(listener.error);
    listener.blockListLoaded = true;
    await settle();
    server.handleMessage(speaker, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '/general hi' }));
    (server as any).routeEvents(server.sim.tick());
    const heard = fb.sent
      .flatMap((m) => (m.t === 'events' ? m.list : []))
      .filter((ev: any) => ev.type === 'chat' && ev.text === 'hi');
    expect(heard.length).toBeGreaterThan(0);
    for (const ev of heard) expect(ev.flair).toBeUndefined();
  });

  it('ignores an incognito flag on a non-staff join (defense in depth past ws_auth)', async () => {
    const server = new GameServer();
    const s = join(server, fakeWs(), 1, { isAdmin: false, incognito: true });
    await settle();
    expect(s.incognito).toBe(false);
    expect(server.sim.entities.get(s.pid)!.holderTier).toBe(3);
  });

  it('a refresh already in flight when a resume switches to incognito stamps nothing', async () => {
    // Hold the Discord read open across the mode switch: the refresher's
    // post-await guard must see the NEW mode on the same session object.
    let release!: (v: unknown) => void;
    vi.mocked(discordFlairForAccount).mockImplementationOnce(
      () => new Promise((r) => (release = r)) as never,
    );
    const server = new GameServer();
    const s = join(server, fakeWs(), 1, { isAdmin: true });
    await settle();
    s.linkdead = true;
    join(server, fakeWs(), 1, { isAdmin: true, incognito: true });
    release({ tier: 2, avatarUrl: 'x', name: 'Staffer', joinedAtMs: 1, role: 'admin' });
    await settle();
    const e = server.sim.entities.get(s.pid)!;
    expect(s.incognito).toBe(true);
    expect(e.discordRole).toBeUndefined();
    expect(e.discordTier).toBeUndefined();
  });

  it('a linkdead resume can switch modes both ways', async () => {
    const server = new GameServer();
    const s = join(server, fakeWs(), 1, { isAdmin: true });
    await settle();
    expect(server.sim.entities.get(s.pid)!.discordRole).toBe('admin');

    // Normal -> incognito inside the grace window: the entity kept its flair.
    s.linkdead = true;
    const resumed = join(server, fakeWs(), 1, { isAdmin: true, incognito: true });
    expect(resumed).toBe(s);
    await settle();
    let e = server.sim.entities.get(s.pid)!;
    expect(s.incognito).toBe(true);
    expect(e.discordRole).toBeUndefined();
    expect(e.holderTier).toBeUndefined();
    expect(e.aiAccount).toBeUndefined();
    expect(s.chatFlair).toBeUndefined();

    // Incognito -> normal: the refreshers re-stamp everything.
    s.linkdead = true;
    join(server, fakeWs(), 1, { isAdmin: true });
    await settle();
    e = server.sim.entities.get(s.pid)!;
    expect(s.incognito).toBe(false);
    expect(e.discordRole).toBe('admin');
    expect(e.holderTier).toBe(3);
    expect(e.aiAccount).toBe(true);
    expect(s.chatFlair).toBeDefined();
  });

  it('a "!" community post still reaches Discord, without the character name', async () => {
    const server = new GameServer();
    const s = join(server, fakeWs(), 1, { isAdmin: true, incognito: true });
    drainRelay();
    server.handleMessage(s, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '!lfg need a tank' }));
    const posts = drainRelay();
    expect(posts).toHaveLength(1);
    expect(posts[0].accountId).toBe(1);
    expect(posts[0].characterName).toBe('An adventurer');
    expect(posts[0].profileUrl).toBeNull();
    expect(JSON.stringify(posts[0])).not.toContain('Staffer');
  });

  it('a normal session\'s "!" post keeps its character name (control)', async () => {
    const server = new GameServer();
    const s = join(server, fakeWs(), 1, { isAdmin: true });
    drainRelay();
    server.handleMessage(s, JSON.stringify({ t: 'cmd', cmd: 'chat', text: '!lfg need a tank' }));
    expect(drainRelay()[0].characterName).toBe('Staffer');
  });

  it('an activity card naming an incognito character goes out with the stand-in', async () => {
    const server = new GameServer();
    join(server, fakeWs(), 1, { isAdmin: true, incognito: true });
    drainActivity();
    enqueueActivity(
      {
        kind: 'levelup',
        accountIds: [1],
        names: ['Staffer'],
        realm: 'Test',
        profileUrl: 'https://example.test/c/Staffer',
        level: 20,
      },
      null,
      Date.now(),
    );
    const cards = drainActivity();
    expect(cards).toHaveLength(1);
    expect(cards[0].accountIds).toEqual([1]);
    expect(cards[0].names).toEqual(['An adventurer']);
    expect(cards[0].profileUrl).toBeNull();
  });
});
