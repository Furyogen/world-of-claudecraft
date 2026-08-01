// Pure parser for the in-game game-master chat commands, the sibling of
// moderation_commands.ts. Kept separate because the two families answer to
// different permissions and different rules: moderation acts on ACCOUNTS
// (kick/mute/ban, audited), while these act on BODIES in the live world
// (visibility, holds, teleports) and are gated on 'gm.tools'.
//
// Host-agnostic and IO-free: a Vitest imports it directly. Like the moderation
// parser, invalid arguments still come back as a parsed command so the policy
// service can answer with the usage notice instead of letting a mistyped
// "/freeze Bob" broadcast to the world as ordinary chat.

/** A world position for /tp. `y` is optional: with two numbers the admin lands
 *  on the ground at (x, z), which is what almost every teleport wants. */
export interface AdminTeleportPos {
  x: number;
  y: number | null;
  z: number;
}

export type AdminChatCommand =
  | { kind: 'invisible' }
  | { kind: 'visible' }
  | { kind: 'freeze'; name: string | null }
  | { kind: 'unfreeze'; name: string | null }
  | { kind: 'tpto'; name: string | null }
  | { kind: 'tptome'; name: string | null }
  | { kind: 'tp'; pos: AdminTeleportPos | null };

// Names come in quoted ("/freeze \"Ashen Vale\"") or bare ("/tpto Ashen Vale"),
// mirroring /spectate: a quoted name is the documented form, and the bare form
// stays legal because it is what a moderator in a hurry actually types. A quoted
// name with trailing junk is rejected (null) rather than silently truncated.
function parseTargetName(rest: string): string | null {
  const trimmed = rest.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"')) {
    const quoted = /^"([^"]*)"$/.exec(trimmed);
    if (!quoted) return null;
    return cleanName(quoted[1]);
  }
  return cleanName(trimmed);
}

function cleanName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  return name || null;
}

// Coordinates are written the way the game reports them: comma separated, with
// optional spaces, and the sign attached ("/tp -231, 1, 107"). Bare spaces work
// too ("/tp -231 1 107") because that is what a copy-paste from a log looks
// like. Two numbers mean (x, z); three mean (x, y, z).
export function parseAdminTeleportArgs(rest: string): AdminTeleportPos | null {
  const parts = rest
    .trim()
    .split(/[\s,]+/)
    .filter((part) => part.length > 0);
  if (parts.length !== 2 && parts.length !== 3) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isFinite(value)) return null;
    nums.push(value);
  }
  return parts.length === 2
    ? { x: nums[0], y: null, z: nums[1] }
    : { x: nums[0], y: nums[1], z: nums[2] };
}

export function parseAdminChatCommand(text: string): AdminChatCommand | null {
  const trimmed = text.trim();
  if (/^\/invisible$/i.test(trimmed)) return { kind: 'invisible' };
  if (/^\/visible$/i.test(trimmed)) return { kind: 'visible' };
  const freeze = /^\/freeze(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (freeze) return { kind: 'freeze', name: parseTargetName(freeze[1] ?? '') };
  const unfreeze = /^\/unfreeze(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (unfreeze) return { kind: 'unfreeze', name: parseTargetName(unfreeze[1] ?? '') };
  const tpTo = /^\/tpto(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (tpTo) return { kind: 'tpto', name: parseTargetName(tpTo[1] ?? '') };
  const tpToMe = /^\/tptome(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (tpToMe) return { kind: 'tptome', name: parseTargetName(tpToMe[1] ?? '') };
  // Every verb above is anchored on a following space or end-of-string, so
  // "/tpto Bob" can never fall through to this rule as coordinates. Matching
  // /tp last keeps that guarantee obvious rather than merely true.
  const tp = /^\/tp(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (tp) return { kind: 'tp', pos: parseAdminTeleportArgs(tp[1] ?? '') };
  return null;
}
