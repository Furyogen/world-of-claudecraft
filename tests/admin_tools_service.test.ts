import { describe, expect, it } from 'vitest';
import type { AdminTeleportPos } from '../server/admin_commands';
import {
  type AdminToolsHost,
  AdminToolsService,
  type AdminToolsSession,
  canAttemptAdminToolCommands,
} from '../server/admin_tools_service';
import { localizeServerText } from '../src/ui/server_i18n';

type Session = AdminToolsSession;

const gm = (pid: number, name = `Admin${pid}`, permissions: readonly string[] = ['gm.tools']) => ({
  pid,
  isAdmin: true,
  adminPermissions: new Set(permissions),
  name,
});
const player = (pid: number, name = `Player${pid}`): Session => ({
  pid,
  isAdmin: false,
  adminPermissions: new Set<string>(),
  name,
});

function setup(actor: Session, others: Session[] = []) {
  const byPid = new Map<number, Session>([[actor.pid, actor], ...others.map((s) => [s.pid, s])] as [
    number,
    Session,
  ][]);
  const notices: string[] = [];
  const systemNotices: string[] = [];
  const cloaked = new Set<number>();
  const frozen = new Set<number>();
  const calls = {
    freeze: [] as number[],
    unfreeze: [] as number[],
    teleportToPlayer: [] as number[],
    summonPlayer: [] as number[],
    teleportToPosition: [] as AdminTeleportPos[],
  };
  let teleportOk = true;
  let summonOk = true;
  let zone: string | null = 'The Palmreach';

  const host: AdminToolsHost<Session> = {
    sessionByName: (name) =>
      [...byPid.values()].find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null,
    notice: (_session, text) => notices.push(text),
    systemNotice: (_session, text) => systemNotices.push(text),
    isCloaked: (session) => cloaked.has(session.pid),
    setCloak: (session, enabled) => {
      if (enabled) cloaked.add(session.pid);
      else cloaked.delete(session.pid);
    },
    isFrozen: (session) => frozen.has(session.pid),
    freeze: (_actor, target) => {
      calls.freeze.push(target.pid);
      frozen.add(target.pid);
    },
    unfreeze: (_actor, target) => {
      calls.unfreeze.push(target.pid);
      frozen.delete(target.pid);
    },
    teleportToPlayer: (_actor, target) => {
      calls.teleportToPlayer.push(target.pid);
      return teleportOk;
    },
    summonPlayer: (_actor, target) => {
      calls.summonPlayer.push(target.pid);
      return summonOk;
    },
    teleportToPosition: (_actor, pos) => {
      calls.teleportToPosition.push(pos);
      return zone;
    },
  };

  return {
    service: new AdminToolsService(host),
    notices,
    systemNotices,
    cloaked,
    frozen,
    calls,
    setTeleportOk: (value: boolean) => {
      teleportOk = value;
    },
    setSummonOk: (value: boolean) => {
      summonOk = value;
    },
    setZone: (value: string | null) => {
      zone = value;
    },
  };
}

describe('AdminToolsService: who may run these at all', () => {
  it('gates the whole family on gm.tools', () => {
    expect(canAttemptAdminToolCommands(gm(1))).toBe(true);
    // moderation.act is deliberately NOT enough: these commands move bodies
    // around the live world, so they sit one rung above the moderator bundle.
    expect(canAttemptAdminToolCommands(gm(1, 'Mod', ['moderation.act']))).toBe(false);
    expect(canAttemptAdminToolCommands(player(2))).toBe(false);
  });

  it('swallows the command for a non-admin instead of leaking it to chat', () => {
    const t = setup(player(1));
    expect(t.service.handleChatCommand(player(1), '/invisible')).toBe(true);
    expect(t.cloaked.size).toBe(0);
    expect(t.notices).toEqual([]);
    expect(t.systemNotices).toEqual([]);
  });

  it('refuses staff who lack gm.tools with an explicit notice', () => {
    const actor = gm(1, 'Mod', ['moderation.act']);
    const t = setup(actor);
    expect(t.service.handleChatCommand(actor, '/invisible')).toBe(true);
    expect(t.cloaked.size).toBe(0);
    expect(t.notices).toEqual(["You don't have permission to do that."]);
  });

  it('returns false for text that is not one of ours', () => {
    const actor = gm(1);
    const t = setup(actor);
    expect(t.service.handleChatCommand(actor, 'hello world')).toBe(false);
    expect(t.service.handleChatCommand(actor, '/jail "Bob" 5')).toBe(false);
  });
});

describe('AdminToolsService: /invisible and /visible', () => {
  it('toggles the cloak and confirms each edge', () => {
    const actor = gm(1);
    const t = setup(actor);
    t.service.handleChatCommand(actor, '/invisible');
    expect(t.cloaked.has(1)).toBe(true);
    expect(t.systemNotices).toEqual([
      'You are now invisible. Nobody can see, target, or harm you.',
    ]);
    t.service.handleChatCommand(actor, '/visible');
    expect(t.cloaked.has(1)).toBe(false);
    expect(t.systemNotices.at(-1)).toBe('You are now visible again.');
  });

  it('reports a no-op instead of re-applying the same state', () => {
    const actor = gm(1);
    const t = setup(actor);
    t.service.handleChatCommand(actor, '/visible');
    expect(t.notices).toEqual(['You are already visible.']);
    t.service.handleChatCommand(actor, '/invisible');
    t.service.handleChatCommand(actor, '/invisible');
    expect(t.notices.at(-1)).toBe('You are already invisible.');
    expect(t.systemNotices).toEqual([
      'You are now invisible. Nobody can see, target, or harm you.',
    ]);
  });
});

describe('AdminToolsService: /freeze and /unfreeze', () => {
  it('freezes a named online player once and releases them', () => {
    const actor = gm(1);
    const bob = player(2, 'Bob');
    const t = setup(actor, [bob]);
    t.service.handleChatCommand(actor, '/freeze "Bob"');
    expect(t.calls.freeze).toEqual([2]);
    expect(t.systemNotices).toEqual(['Froze Bob.']);
    t.service.handleChatCommand(actor, '/freeze "Bob"');
    expect(t.calls.freeze).toEqual([2]); // not stacked
    expect(t.notices).toEqual(['Bob is already frozen.']);
    t.service.handleChatCommand(actor, '/unfreeze "bob"'); // name match is case-insensitive
    expect(t.calls.unfreeze).toEqual([2]);
    expect(t.systemNotices.at(-1)).toBe('Unfroze Bob.');
    t.service.handleChatCommand(actor, '/unfreeze "Bob"');
    expect(t.calls.unfreeze).toEqual([2]);
    expect(t.notices.at(-1)).toBe('Bob is not frozen.');
  });

  it('answers usage for a nameless command and refuses unknown or self targets', () => {
    const actor = gm(1);
    const t = setup(actor);
    t.service.handleChatCommand(actor, '/freeze');
    expect(t.notices.at(-1)).toBe('Usage: /freeze "<name>"');
    t.service.handleChatCommand(actor, '/unfreeze');
    expect(t.notices.at(-1)).toBe('Usage: /unfreeze "<name>"');
    t.service.handleChatCommand(actor, '/freeze "Nobody"');
    expect(t.notices.at(-1)).toBe("No online player named 'Nobody'.");
    t.service.handleChatCommand(actor, '/freeze "Admin1"');
    expect(t.notices.at(-1)).toBe("You can't use that on yourself.");
    expect(t.calls.freeze).toEqual([]);
  });

  it('allows one admin to freeze another', () => {
    // Unlike moderation, staff are legal targets here: an event runner has to be
    // able to hold a colleague in place.
    const actor = gm(1);
    const other = gm(2, 'Admin2');
    const t = setup(actor, [other]);
    t.service.handleChatCommand(actor, '/freeze "Admin2"');
    expect(t.calls.freeze).toEqual([2]);
  });
});

describe('AdminToolsService: /tpto, /tptome and /tp', () => {
  it('teleports to a player and summons one', () => {
    const actor = gm(1);
    const bob = player(2, 'Bob');
    const t = setup(actor, [bob]);
    t.service.handleChatCommand(actor, '/tpto "Bob"');
    expect(t.calls.teleportToPlayer).toEqual([2]);
    expect(t.systemNotices.at(-1)).toBe('Teleported to Bob.');
    t.service.handleChatCommand(actor, '/tptome "Bob"');
    expect(t.calls.summonPlayer).toEqual([2]);
    expect(t.systemNotices.at(-1)).toBe('Summoned Bob.');
  });

  it('reports a host refusal rather than claiming success', () => {
    const actor = gm(1);
    const bob = player(2, 'Bob');
    const t = setup(actor, [bob]);
    t.setTeleportOk(false);
    t.setSummonOk(false);
    t.service.handleChatCommand(actor, '/tpto "Bob"');
    expect(t.notices.at(-1)).toBe('Bob has no reachable location right now.');
    t.service.handleChatCommand(actor, '/tptome "Bob"');
    expect(t.notices.at(-1)).toBe('Bob cannot be summoned right now.');
    expect(t.systemNotices).toEqual([]);
  });

  it('teleports to coordinates and echoes the zone it landed in', () => {
    const actor = gm(1);
    const t = setup(actor);
    t.service.handleChatCommand(actor, '/tp -231, 1, 107');
    expect(t.calls.teleportToPosition).toEqual([{ x: -231, y: 1, z: 107 }]);
    expect(t.systemNotices.at(-1)).toBe('Teleported to The Palmreach at (-231, 107).');
  });

  it('answers usage on a malformed /tp and refuses out-of-world coordinates', () => {
    const actor = gm(1);
    const t = setup(actor);
    t.service.handleChatCommand(actor, '/tp');
    expect(t.notices.at(-1)).toBe('Usage: /tp <x>, [y], <z>');
    expect(t.calls.teleportToPosition).toEqual([]);
    t.setZone(null);
    t.service.handleChatCommand(actor, '/tp 999999, 999999');
    expect(t.notices.at(-1)).toBe('Those coordinates are outside the world.');
    expect(t.systemNotices).toEqual([]);
  });
});

// The service emits English at the source (server/ is language-agnostic); the
// client re-localizes it. The S3 drift guard only scans server/game.ts, so this
// module's literals need their own coverage or a new emit could ship unmatched.
describe('every GM notice is recognized by the client matcher', () => {
  const literals = [
    'You are already invisible.',
    'You are already visible.',
    'You are now invisible. Nobody can see, target, or harm you.',
    'You are now visible again.',
    "You can't use that on yourself.",
    "You don't have permission to do that.",
    'Usage: /freeze "<name>"',
    'Usage: /unfreeze "<name>"',
    'Usage: /tpto "<name>"',
    'Usage: /tptome "<name>"',
    'Usage: /tp <x>, [y], <z>',
    'Froze Bob.',
    'Unfroze Bob.',
    'Bob is already frozen.',
    'Bob is not frozen.',
    'A moderator has frozen you in place.',
    'A moderator has unfrozen you.',
    'Teleported to Bob.',
    'Teleported to The Palmreach at (-231, 107).',
    'Summoned Bob.',
    'Admin1 has summoned you.',
    'Bob has no reachable location right now.',
    'Bob cannot be summoned right now.',
    'Those coordinates are outside the world.',
    "No online player named 'Nobody'.",
  ];

  for (const literal of literals) {
    it(`localizes ${JSON.stringify(literal)}`, () => {
      expect(localizeServerText(literal)).not.toBeNull();
    });
  }

  it('keeps the zone form from being swallowed by the player form', () => {
    // Both start "Teleported to ...", so rule order is load-bearing: the zone
    // rule must win, or the coordinates would be baked into a player name.
    expect(localizeServerText('Teleported to The Palmreach at (-231, 107).')).toBe(
      'Teleported to The Palmreach at (-231, 107).',
    );
    expect(localizeServerText('Teleported to Bob.')).toBe('Teleported to Bob.');
  });
});
