// Player-facing commands for the two chat-suppression tiers.
//
//   MUTE  (/mute, /unmute, /mutelist)     chat-only. Hides the target's public
//                                         chat and their overhead bubble from
//                                         you. Their whispers, rolls, invites
//                                         and mail still arrive.
//   BLOCK (/block, /unblock, /blocklist)  the heavy tool. Also drops invites,
//                                         whispers and mail, and makes you
//                                         mutually invisible in /who.
//
// "/ignore" is an alias for BLOCK, not for mute. That is deliberate and it is
// load-bearing: "ignore" is already this game's word for a block everywhere a
// player can see it (the Social window's Ignore tab lists blocks, and the server
// says "X is now ignored"). A harassed player reaching for /ignore must get the
// STRONG tool, not silently get the weak one.
//
// The staff moderation router claims "/mute" for anyone holding a moderation
// permission (canAttemptModerationCommands in moderation_service.ts), so a staff
// member's /mute is always the GM account silence and they never reach this
// parser for that verb. Staff mute a player from the player menu instead.
//
// This parser lives in its own module on purpose: tests/command_schema.test.ts
// scrapes `case '<token>':` labels out of the dispatchMessage region of game.ts
// to derive the dispatched wire vocabulary, so a switch over these kinds written
// inline there would register phantom wire commands and fail the gate.

// Character names are bounded well under this; the cap simply stops a 16 KiB
// "name" from round-tripping to Postgres.
const NAME_MAX = 32;

export type MuteChatCommand =
  | { kind: 'mute'; name: string }
  | { kind: 'unmute'; name: string }
  | { kind: 'muteList' }
  | { kind: 'block'; name: string }
  | { kind: 'unblock'; name: string }
  | { kind: 'blockList' };

/** True for the two commands that WRITE, so the caller can charge a chat token. */
export function isMuteWriteCommand(cmd: MuteChatCommand): boolean {
  return cmd.kind !== 'muteList' && cmd.kind !== 'blockList';
}

// Channels a MUTE suppresses. Whispers and rolls ride the SAME chat SimEvent as
// public chat, so filtering on the event TYPE alone would silently make a mute
// behave like a block (no whispers) and would hide a muted player's loot roll
// mid need/greed. The gate is the CHANNEL, and this is the whole list of what a
// mute may hide. An absent channel is ordinary chat, so it is muted.
const UNMUTABLE_CHANNELS = new Set(['whisper', 'roll']);

export function isMutableChannel(channel: string | undefined): boolean {
  return channel === undefined || !UNMUTABLE_CHANNELS.has(channel);
}

// Collapse interior whitespace so `/mute  Bob   Smith` resolves like `/mute Bob Smith`.
function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
}

export function parseMuteChatCommand(text: string): MuteChatCommand | null {
  const trimmed = text.trim();

  // List forms first. They cannot collide with the add/remove forms below (those
  // require whitespace or end-of-string after the verb), but matching them first
  // keeps the intent obvious.
  if (/^\/mutelist$/i.test(trimmed)) return { kind: 'muteList' };
  if (/^\/(?:blocklist|ignorelist)$/i.test(trimmed)) return { kind: 'blockList' };

  const unmute = /^\/unmute(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (unmute) return { kind: 'unmute', name: cleanName(unmute[1] ?? '') };

  const unblock = /^\/(?:unblock|unignore)(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (unblock) return { kind: 'unblock', name: cleanName(unblock[1] ?? '') };

  const mute = /^\/mute(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (mute) return { kind: 'mute', name: cleanName(mute[1] ?? '') };

  const block = /^\/(?:block|ignore)(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (block) return { kind: 'block', name: cleanName(block[1] ?? '') };

  return null;
}
