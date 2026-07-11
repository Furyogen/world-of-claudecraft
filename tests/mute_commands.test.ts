import { describe, expect, it } from 'vitest';
import { parseModerationChatCommand } from '../server/moderation_commands';
import {
  isMutableChannel,
  isMuteWriteCommand,
  parseMuteChatCommand,
} from '../server/mute_commands';

describe('parseMuteChatCommand', () => {
  it('parses the mute family (chat-only)', () => {
    expect(parseMuteChatCommand('/mute Bob')).toEqual({ kind: 'mute', name: 'Bob' });
    expect(parseMuteChatCommand('/unmute Bob')).toEqual({ kind: 'unmute', name: 'Bob' });
    expect(parseMuteChatCommand('/mutelist')).toEqual({ kind: 'muteList' });
  });

  it('parses the block family (the heavy tier)', () => {
    expect(parseMuteChatCommand('/block Bob')).toEqual({ kind: 'block', name: 'Bob' });
    expect(parseMuteChatCommand('/unblock Bob')).toEqual({ kind: 'unblock', name: 'Bob' });
    expect(parseMuteChatCommand('/blocklist')).toEqual({ kind: 'blockList' });
  });

  // THE safety property. "Ignore" is already this game's word for a block (the
  // Social window's Ignore tab lists blocks; the server says "X is now ignored"),
  // so a harassed player typing /ignore must get the STRONG tool. Aliasing it to
  // the chat-only mute would silently hand them the weak one.
  it('aliases /ignore to BLOCK, never to mute', () => {
    expect(parseMuteChatCommand('/ignore Bob')).toEqual({ kind: 'block', name: 'Bob' });
    expect(parseMuteChatCommand('/unignore Bob')).toEqual({ kind: 'unblock', name: 'Bob' });
    expect(parseMuteChatCommand('/ignorelist')).toEqual({ kind: 'blockList' });
  });

  it('is case-insensitive and collapses interior whitespace in the name', () => {
    expect(parseMuteChatCommand('/MUTE   Bob   Smith ')).toEqual({
      kind: 'mute',
      name: 'Bob Smith',
    });
    expect(parseMuteChatCommand('/UnIgNoRe Bob')).toEqual({ kind: 'unblock', name: 'Bob' });
  });

  it('bounds the name so a 16 KiB "name" never round-trips to Postgres', () => {
    const parsed = parseMuteChatCommand(`/mute ${'A'.repeat(500)}`);
    expect(parsed).toEqual({ kind: 'mute', name: 'A'.repeat(32) });
  });

  it('claims a bare verb with no name so it can answer with usage, not "unknown command"', () => {
    expect(parseMuteChatCommand('/mute')).toEqual({ kind: 'mute', name: '' });
    expect(parseMuteChatCommand('/unmute')).toEqual({ kind: 'unmute', name: '' });
    expect(parseMuteChatCommand('/block')).toEqual({ kind: 'block', name: '' });
  });

  it('the list verbs are not swallowed by the add arms', () => {
    // regression guard: a /^\/mute/ prefix match without a boundary would read
    // "/mutelist" as muting a player called "list"
    expect(parseMuteChatCommand('/mutelist')).toEqual({ kind: 'muteList' });
    expect(parseMuteChatCommand('/blocklist')).toEqual({ kind: 'blockList' });
    expect(parseMuteChatCommand('/unmute Bob')).toEqual({ kind: 'unmute', name: 'Bob' });
    expect(parseMuteChatCommand('/unblock Bob')).toEqual({ kind: 'unblock', name: 'Bob' });
  });

  it('marks exactly the four writes as writes, so only they cost a chat token', () => {
    const writes = ['/mute Bob', '/unmute Bob', '/block Bob', '/unblock Bob'];
    const reads = ['/mutelist', '/blocklist'];
    for (const text of writes) {
      expect(isMuteWriteCommand(parseMuteChatCommand(text)!), text).toBe(true);
    }
    for (const text of reads) {
      expect(isMuteWriteCommand(parseMuteChatCommand(text)!), text).toBe(false);
    }
  });

  it('claims nothing else', () => {
    expect(parseMuteChatCommand('/who')).toBeNull();
    expect(parseMuteChatCommand('/muted Bob')).toBeNull();
    expect(parseMuteChatCommand('/ignoring Bob')).toBeNull();
    expect(parseMuteChatCommand('/blocked Bob')).toBeNull();
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
    // the staff parser claims ONLY the bare /mute verb, so every other command in
    // both families still reaches the player parser, staff included
    expect(parseModerationChatCommand('/ignore Bob')).toBeNull();
    expect(parseModerationChatCommand('/block Bob')).toBeNull();
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
