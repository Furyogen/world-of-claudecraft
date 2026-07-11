import { describe, expect, it } from 'vitest';
import {
  muteKey,
  parseMuteList,
  resolvePlayerSocialFlags,
  serializeMuteList,
} from '../src/ui/chat_mute_core';
import type { FriendInfo, SocialInfo } from '../src/world_api';

const friend = (name: string): FriendInfo => ({
  id: 1,
  name,
  cls: 'mage',
  level: 10,
  realm: 'R1',
  online: true,
});

const social = (over: Partial<SocialInfo> = {}): SocialInfo => ({
  friends: [],
  blocks: [],
  mutes: [],
  guild: null,
  ...over,
});

describe('muteKey', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(muteKey('  BoB  ')).toBe('bob');
    expect(muteKey('bob')).toBe(muteKey('BOB'));
  });
});

describe('resolvePlayerSocialFlags online (the server graph is the source of truth)', () => {
  it('reads mute and block from their OWN lists, never from each other', () => {
    const info = social({ mutes: [{ id: 2, name: 'Chatty' }], blocks: [{ id: 3, name: 'Jerk' }] });

    const chatty = resolvePlayerSocialFlags('Chatty', info, new Set());
    expect(chatty.muted).toBe(true);
    expect(chatty.blocked).toBe(false);

    const jerk = resolvePlayerSocialFlags('Jerk', info, new Set());
    expect(jerk.blocked).toBe(true);
    expect(jerk.muted).toBe(false);
  });

  it('lets a player be muted AND a friend: muting a chatty friend is normal', () => {
    const info = social({ friends: [friend('Chatty')], mutes: [{ id: 1, name: 'Chatty' }] });
    const flags = resolvePlayerSocialFlags('Chatty', info, new Set());
    expect(flags.muted).toBe(true);
    expect(flags.isFriend).toBe(true);
  });

  it('matches names case-insensitively', () => {
    const info = social({ mutes: [{ id: 2, name: 'Chatty' }] });
    expect(resolvePlayerSocialFlags('cHaTtY', info, new Set()).muted).toBe(true);
  });

  it('IGNORES the local set online, so a stale local mute cannot resurrect itself', () => {
    // The whole "I unmuted them and still cannot see them" bug in one assertion:
    // online, the account list is authoritative and the local list is not consulted.
    const flags = resolvePlayerSocialFlags('Chatty', social(), new Set(['chatty']));
    expect(flags.muted).toBe(false);
  });

  it('resolves guild-invite permission from rank', () => {
    const asMember = social({
      guild: { id: 1, name: 'G', rank: 'member', members: [], events: [] },
    });
    expect(resolvePlayerSocialFlags('Bob', asMember, new Set()).canGuildInvite).toBe(false);

    const asOfficer = social({
      guild: { id: 1, name: 'G', rank: 'officer', members: [], events: [] },
    });
    expect(resolvePlayerSocialFlags('Bob', asOfficer, new Set()).canGuildInvite).toBe(true);
  });
});

describe('resolvePlayerSocialFlags offline (no account, no server graph)', () => {
  it('falls back to the local set for mutes and offers nothing else', () => {
    const flags = resolvePlayerSocialFlags('Chatty', null, new Set(['chatty']));
    expect(flags).toEqual({
      muted: true,
      blocked: false,
      isFriend: false,
      canGuildInvite: false,
      alreadyGuilded: false,
      online: false,
    });
  });

  it('reports an unmuted name as unmuted', () => {
    expect(resolvePlayerSocialFlags('Someone', null, new Set(['chatty'])).muted).toBe(false);
  });
});

describe('local mute-list storage helpers', () => {
  it('round-trips through the serialized form', () => {
    const set = new Set(['bob', 'chatty']);
    expect(parseMuteList(serializeMuteList(set))).toEqual(set);
  });

  it('normalizes names on parse, so a legacy mixed-case entry still matches', () => {
    expect(parseMuteList('["BoB", " Chatty "]')).toEqual(new Set(['bob', 'chatty']));
  });

  it('survives absent, malformed, and wrong-shaped storage', () => {
    expect(parseMuteList(null)).toEqual(new Set());
    expect(parseMuteList('not json')).toEqual(new Set());
    expect(parseMuteList('{"nope":1}')).toEqual(new Set());
    expect(parseMuteList('[1, null, "bob"]')).toEqual(new Set(['bob']));
  });
});
