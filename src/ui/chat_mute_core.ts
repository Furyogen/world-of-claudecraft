// Pure resolution of the per-player social flags the player context menus need,
// plus the offline mute-list storage helpers.
//
// Two tiers, and keeping them straight is the whole point of this module:
//   - MUTE  is chat-only. It hides the player's public chat (and their overhead
//           bubble) from you. Their whispers, rolls, invites and mail still land.
//   - BLOCK is the heavy tool. It also drops invites, whispers and mail, and
//           makes you mutually invisible in /who.
//
// Online, both lists live on the server and arrive on the `social` frame. Offline
// there is no social graph at all, so the mute list falls back to a local, name
// keyed set that the Hud persists; blocking is simply unavailable.
//
// DOM-free, i18n-free, storage-free by contract (registered in UI_PURE_CORES):
// the caller owns the localStorage read/write and passes the parsed set in.

import type { SocialInfo } from '../world_api';

export interface PlayerSocialFlags {
  muted: boolean;
  blocked: boolean;
  isFriend: boolean;
  canGuildInvite: boolean;
  alreadyGuilded: boolean;
  /** false offline: friends, blocks and guilds need an account and a server. */
  online: boolean;
}

/** Names are matched case-insensitively; this is the one canonical key. */
export function muteKey(name: string): string {
  return name.trim().toLowerCase();
}

function hasName(list: readonly { name: string }[] | undefined, name: string): boolean {
  const key = muteKey(name);
  return !!list?.some((entry) => muteKey(entry.name) === key);
}

export function resolvePlayerSocialFlags(
  name: string,
  social: SocialInfo | null,
  localMutes: ReadonlySet<string>,
): PlayerSocialFlags {
  // Offline: no server graph. The local set is the only mute store, and there is
  // nothing to block, friend, or guild-invite.
  if (!social) {
    return {
      muted: localMutes.has(muteKey(name)),
      blocked: false,
      isFriend: false,
      canGuildInvite: false,
      alreadyGuilded: false,
      online: false,
    };
  }
  return {
    muted: hasName(social.mutes, name),
    blocked: hasName(social.blocks, name),
    isFriend: hasName(social.friends, name),
    canGuildInvite: !!social.guild && social.guild.rank !== 'member',
    alreadyGuilded: hasName(social.guild?.members, name),
    online: true,
  };
}

// --- offline mute-list storage (the Hud owns the localStorage read/write) ---

export function parseMuteList(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n): n is string => typeof n === 'string').map(muteKey));
  } catch {
    return new Set();
  }
}

export function serializeMuteList(names: ReadonlySet<string>): string {
  return JSON.stringify([...names]);
}
