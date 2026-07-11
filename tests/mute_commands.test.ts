import { describe, expect, it } from 'vitest';
import { parseModerationChatCommand } from '../server/moderation_commands';
import { isMutableChannel, parseMuteChatCommand } from '../server/mute_commands';

describe('parseMuteChatCommand', () => {
  it('parses the mute forms and their /ignore aliases', () => {
    expect(parseMuteChatCommand('/mute Bob')).toEqual({ kind: 'mute', name: 'Bob' });
    expect(parseMuteChatCommand('/ignore Bob')).toEqual({ kind: 'mute', name: 'Bob' });
    expect(parseMuteChatCommand('/unmute Bob')).toEqual({ kind: 'unmute', name: 'Bob' });
    expect(parseMuteChatCommand('/unignore Bob')).toEqual({ kind: 'unmute', name: 'Bob' });
    expect(parseMuteChatCommand('/mutelist')).toEqual({ kind: 'list' });
    expect(parseMuteChatCommand('/ignorelist')).toEqual({ kind: 'list' });
  });

  it('is case-insensitive and collapses interior whitespace in the name', () => {
    expect(parseMuteChatCommand('/MUTE   Bob   Smith ')).toEqual({
      kind: 'mute',
      name: 'Bob Smith',
    });
    expect(parseMuteChatCommand('/UnIgNoRe Bob')).toEqual({ kind: 'unmute', name: 'Bob' });
  });

  it('claims a bare verb with no name so it can answer with usage, not "unknown command"', () => {
    expect(parseMuteChatCommand('/mute')).toEqual({ kind: 'mute', name: '' });
    expect(parseMuteChatCommand('/unmute')).toEqual({ kind: 'unmute', name: '' });
  });

  it('/mutelist and /unmute are not swallowed by the /mute arm', () => {
    // regression guard: a /^\/mute/ prefix match without a boundary would read
    // "/mutelist" as muting a player called "list"
    expect(parseMuteChatCommand('/mutelist')).toEqual({ kind: 'list' });
    expect(parseMuteChatCommand('/unmute Bob')).toEqual({ kind: 'unmute', name: 'Bob' });
  });

  it('claims nothing else', () => {
    expect(parseMuteChatCommand('/who')).toBeNull();
    expect(parseMuteChatCommand('/muted Bob')).toBeNull();
    expect(parseMuteChatCommand('/ignoring Bob')).toBeNull();
    expect(parseMuteChatCommand('hello /mute Bob')).toBeNull();
    expect(parseMuteChatCommand('mute Bob')).toBeNull();
  });

  // The staff GM mute is a DIFFERENT command that happens to share the verb. It is
  // safe only because game.ts runs the moderation router FIRST and gates it on
  // canAttemptModerationCommands(), so a staff /mute never reaches this parser.
  // These pin the two parsers as the overlapping-but-distinct pair they are.
  it('overlaps with the staff /mute verb, which the dispatch order resolves', () => {
    expect(parseModerationChatCommand('/mute "Bob" 30 spam')).toEqual({
      kind: 'mute',
      name: 'Bob',
      minutes: 30,
      reason: 'spam',
    });
    // the staff parser does NOT recognise the aliases, so staff keep a working
    // personal mute via /ignore even though their /mute is the GM silence
    expect(parseModerationChatCommand('/ignore Bob')).toBeNull();
    expect(parseModerationChatCommand('/unmute Bob')).toBeNull();
    expect(parseModerationChatCommand('/mutelist')).toBeNull();
  });
});

describe('isMutableChannel', () => {
  it('mutes every public channel', () => {
    for (const ch of [
      'say',
      'yell',
      'general',
      'party',
      'guild',
      'officer',
      'world',
      'lfg',
      'emote',
    ]) {
      expect(isMutableChannel(ch), ch).toBe(true);
    }
    // an absent channel is ordinary chat
    expect(isMutableChannel(undefined)).toBe(true);
  });

  it('never mutes whispers or rolls', () => {
    // These ride the SAME chat event as public chat. If the filter keyed on the
    // event TYPE instead of the channel, a mute would silently become a block for
    // whispers, and would hide a muted player's loot roll mid need/greed.
    expect(isMutableChannel('whisper')).toBe(false);
    expect(isMutableChannel('roll')).toBe(false);
  });
});
