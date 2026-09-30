import { describe, expect, it } from 'vitest';
import type { QueuedActivity } from '../../server/discord_activity';
import {
  type IdentityFlairFields,
  INCOGNITO_DISCORD_NAME,
  negotiateIncognito,
  redactIncognitoActivity,
  relayCharacterIdentity,
  scrubIdentityFlair,
} from '../../server/incognito';

describe('negotiateIncognito: the staff-only handshake gate', () => {
  it('honors a strict boolean true from a staff account', () => {
    expect(negotiateIncognito(true, true)).toBe(true);
  });

  it('refuses a non-staff account whatever it sends (a forged frame is inert)', () => {
    expect(negotiateIncognito(true, false)).toBe(false);
  });

  it.each([
    ['absent', undefined],
    ['false', false],
    ['string "true"', 'true'],
    ['number 1', 1],
    ['object', { incognito: true }],
    ['null', null],
  ])('treats a %s request from staff as normal mode', (_label, requested) => {
    expect(negotiateIncognito(requested, true)).toBe(false);
  });
});

describe('scrubIdentityFlair', () => {
  it('clears every integration-stamped identity field back to absent', () => {
    const e: IdentityFlairFields = {
      holderTier: 3,
      holderBalance: 12_000,
      discordTier: 2,
      discordAvatar: 'https://cdn.example/a.png',
      discordName: 'Staffer',
      discordJoined: 1_700_000_000_000,
      discordRole: 'admin',
      devTier: 4,
      devMergedPrs: 40,
      githubLogin: 'staffer',
      aiAccount: true,
      streamerLinks: { twitch: 'https://twitch.tv/staffer' },
    };
    scrubIdentityFlair(e);
    // Every key the type names, so a field added to the Pick without a matching
    // clear fails here rather than leaking on a resume.
    const keys: (keyof IdentityFlairFields)[] = [
      'holderTier',
      'holderBalance',
      'discordTier',
      'discordAvatar',
      'discordName',
      'discordJoined',
      'discordRole',
      'devTier',
      'devMergedPrs',
      'githubLogin',
      'aiAccount',
      'streamerLinks',
    ];
    for (const k of keys) expect(e[k], k).toBeUndefined();
  });
});

describe('the Discord side: posts go out, the character name does not', () => {
  const card = (over: Partial<QueuedActivity> = {}): QueuedActivity => ({
    kind: 'levelup',
    accountIds: [7],
    names: ['Staffer'],
    realm: 'Test',
    profileUrl: 'https://example.test/c/Staffer',
    level: 20,
    ...over,
  });
  const isStaffer = (n: string) => n === 'Staffer';

  it('swaps the incognito name for the stand-in, drops its profile link, keeps the tag', () => {
    const out = redactIncognitoActivity(card(), isStaffer);
    expect(out.names).toEqual([INCOGNITO_DISCORD_NAME]);
    expect(out.profileUrl).toBeNull();
    expect(out.accountIds).toEqual([7]);
    expect(JSON.stringify(out)).not.toContain('Staffer');
  });

  it('hides a duel side by its event names too, keeping the other side intact', () => {
    const duel = card({
      kind: 'duel',
      accountIds: [1, 7],
      names: ['Winner', 'Staffer'],
      profileUrl: 'https://example.test/c/Winner',
      winnerName: 'Winner',
      loserName: 'Staffer',
    });
    const out = redactIncognitoActivity(duel, isStaffer);
    expect(out.names).toEqual(['Winner', INCOGNITO_DISCORD_NAME]);
    expect(out.winnerName).toBe('Winner');
    expect(out.loserName).toBe(INCOGNITO_DISCORD_NAME);
    expect(out.profileUrl).toBe('https://example.test/c/Winner');
    expect(JSON.stringify(out)).not.toContain('Staffer');
  });

  it('returns an ordinary card untouched (same object)', () => {
    const c = card({ names: ['Someone'] });
    expect(redactIncognitoActivity(c, isStaffer)).toBe(c);
  });

  it('gives a relay post the stand-in name and no profile link only when incognito', () => {
    expect(relayCharacterIdentity({ incognito: true, name: 'Staffer' }, 'u')).toEqual({
      characterName: INCOGNITO_DISCORD_NAME,
      profileUrl: null,
    });
    expect(relayCharacterIdentity({ incognito: false, name: 'Staffer' }, 'u')).toEqual({
      characterName: 'Staffer',
      profileUrl: 'u',
    });
  });
});
