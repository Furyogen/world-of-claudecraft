// Player-facing chat mute commands. A mute is personal and chat-only: it hides
// the target's public chat (and their overhead bubble) from you, and nothing
// else. The heavy tool is a block, which also drops invites, whispers, mail,
// and /who visibility.
//
// "/ignore" is a first-class alias for "/mute", not an afterthought: the staff
// moderation router claims "/mute" for anyone holding a moderation permission
// (see canAttemptModerationCommands in moderation_service.ts), so a staff
// member's "/mute" always means the GM account silence. "/ignore" is the route
// that works for everyone, staff included.
//
// This parser lives in its own module on purpose. tests/command_schema.test.ts
// scrapes `case '<token>':` labels out of the dispatchMessage region of game.ts
// to derive the dispatched wire vocabulary, so a switch over these kinds
// written inline there would register "mute"/"unmute"/"list" as phantom wire
// commands and fail the gate.

export type MuteChatCommand =
  | { kind: 'mute'; name: string }
  | { kind: 'unmute'; name: string }
  | { kind: 'list' };

// Channels a mute suppresses. Whispers and rolls ride the SAME chat SimEvent as
// public chat, so filtering on the event TYPE alone would silently make a mute
// behave like a block (no whispers) and would hide a muted player's loot rolls
// mid need/greed. The gate is the CHANNEL, and this is the whole list of what a
// mute is allowed to hide. An absent channel is ordinary chat, so it is muted.
const UNMUTABLE_CHANNELS = new Set(['whisper', 'roll']);

export function isMutableChannel(channel: string | undefined): boolean {
  return channel === undefined || !UNMUTABLE_CHANNELS.has(channel);
}

// Collapse interior whitespace so `/mute  Bob   Smith` resolves like `/mute Bob Smith`.
function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function parseMuteChatCommand(text: string): MuteChatCommand | null {
  const trimmed = text.trim();

  // List forms first. They cannot collide with the add/remove forms below (those
  // require whitespace or end-of-string after the verb), but matching them first
  // keeps the intent obvious.
  if (/^\/(?:mutelist|ignorelist)$/i.test(trimmed)) return { kind: 'list' };

  const unmute = /^\/(?:unmute|unignore)(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (unmute) return { kind: 'unmute', name: cleanName(unmute[1] ?? '') };

  const mute = /^\/(?:mute|ignore)(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (mute) return { kind: 'mute', name: cleanName(mute[1] ?? '') };

  return null;
}
