// Staff incognito mode: a login-time choice an account with admin privileges
// makes on the character-select screen ("normal" or "incognito"). An incognito
// session looks like an ordinary player's: every integration-backed identity
// mark is HIDDEN from other players, while the integrations themselves keep
// working (the wallet stays linked, Discord relays and feeds still run, with
// the character name replaced by a neutral stand-in; see the bottom section).
// Hidden:
//   - Discord: the linked-Discord tier, avatar, nickname, member-since, and
//     the staff/special role tag (Admin, Mod, Levy St, ...) on the nameplate,
//     inspect card, and chat line.
//   - Wallet: the $WOC holder-tier badge and balance.
//   - Flair: the developer badge (GitHub login) and the operator-set account
//     flair (AI mark, streamer links, chat sender flair).
// Gameplay is untouched: the mode only withholds cosmetic identity.
//
// Pure and IO-free (server/CLAUDE.md module-first): game.ts and ws_auth.ts are
// thin consumers; tests/server/incognito.test.ts pins the contract.

import { devBadgeTitleTier } from '../src/sim/dev_badge_titles';
import type { Entity } from '../src/sim/types';
import type { QueuedActivity } from './discord_activity';

/**
 * Decide the session's mode from the handshake's optional `incognito` field.
 * Staff only, and only on a strict boolean `true`: a non-staff request, a
 * string, a number, or an absent key all join in normal mode, so a forged
 * frame from an ordinary account is inert.
 */
export function negotiateIncognito(requested: unknown, isAdmin: boolean): boolean {
  return isAdmin && requested === true;
}

/** The identity-flair fields the integrations stamp onto a player entity. */
export type IdentityFlairFields = Pick<
  Entity,
  | 'holderTier'
  | 'holderBalance'
  | 'discordTier'
  | 'discordAvatar'
  | 'discordName'
  | 'discordJoined'
  | 'discordRole'
  | 'devTier'
  | 'devMergedPrs'
  | 'githubLogin'
  | 'aiAccount'
  | 'streamerLinks'
>;

/**
 * Clear every integration-stamped identity field on an entity, back to the
 * values a fresh player entity carries (nothing set, so nothing rides the
 * wire). Needed when a linkdead session RESUMES in incognito mode: the entity
 * kept the flair its earlier normal-mode login stamped. The identity diff
 * re-broadcasts the cleared fields to nearby players on the next snapshot.
 */
export function scrubIdentityFlair(e: IdentityFlairFields): void {
  e.holderTier = undefined;
  e.holderBalance = undefined;
  e.discordTier = undefined;
  e.discordAvatar = undefined;
  e.discordName = undefined;
  e.discordJoined = undefined;
  e.discordRole = undefined;
  e.devTier = undefined;
  e.devMergedPrs = undefined;
  e.githubLogin = undefined;
  e.aiAccount = undefined;
  e.streamerLinks = undefined;
}

// A worn developer-badge rung title ('dev:artificer', ...) names the account a
// contributor just like the badge does, so an incognito session keeps it off
// the entity (the wire field) while the saved choice (meta.activeTitle) stays,
// ready to show again on a normal login. While incognito the rung cannot be
// re-worn either: canWearDevBadgeTitle reads the unstamped devTier.
export function hideDevBadgeTitle(e: Pick<Entity, 'title'>): void {
  if (devBadgeTitleTier(e.title) !== undefined) e.title = null;
}

/** Undo hideDevBadgeTitle when a session leaves incognito (a linkdead resume). */
export function showDevBadgeTitle(
  e: Pick<Entity, 'title'>,
  meta: { activeTitle: string | null } | null,
): void {
  if (meta && devBadgeTitleTier(meta.activeTitle) !== undefined) e.title = meta.activeTitle;
}

// ── Discord side: the posts still go out, the character name does not ────────
// The Discord integrations (the "!" community relay, the activity feed) keep
// running for an incognito session and still tag the player's own Discord
// account, but they must never print WHICH character that account is playing:
// that pairing is exactly what incognito hides. The name is swapped for a
// neutral stand-in (never a staff-sounding one) and the profile link dropped.
// English on purpose: the Discord posts are English (bot/logic.ts), and the
// bot's payload shape is unchanged, so a bot mid-deploy renders it as-is.
export const INCOGNITO_DISCORD_NAME = 'An adventurer';

/**
 * Return the activity card with every incognito character name replaced by
 * the stand-in (participant names and a duel's winner/loser alike), and the
 * profile link dropped when it points at an incognito subject. The account
 * tags are kept, so the card still pings and credits the Discord user.
 * Returns the SAME object when nothing is incognito, so an ordinary card is
 * untouched.
 */
export function redactIncognitoActivity(
  item: QueuedActivity,
  isIncognitoName: (name: string) => boolean,
): QueuedActivity {
  const hide = (name: string | undefined) =>
    name !== undefined && isIncognitoName(name) ? INCOGNITO_DISCORD_NAME : name;
  const touched =
    item.names.some(isIncognitoName) ||
    [item.winnerName, item.loserName].some((n) => n !== undefined && isIncognitoName(n));
  if (!touched) return item;
  // The profile link belongs to the primary subject: names[0], or the winner
  // on a duel card whose participants were not all in session.
  const subject = item.names[0] ?? item.winnerName;
  const out: QueuedActivity = {
    ...item,
    names: item.names.map((n) => hide(n) as string),
    profileUrl: subject !== undefined && isIncognitoName(subject) ? null : item.profileUrl,
  };
  if (item.winnerName !== undefined) out.winnerName = hide(item.winnerName);
  if (item.loserName !== undefined) out.loserName = hide(item.loserName);
  return out;
}

/** The character identity a "!" relay post carries for this session. */
export function relayCharacterIdentity(
  session: { incognito: boolean; name: string },
  profileUrl: string | null,
): { characterName: string; profileUrl: string | null } {
  return session.incognito
    ? { characterName: INCOGNITO_DISCORD_NAME, profileUrl: null }
    : { characterName: session.name, profileUrl };
}

// ── Discord member sync: no character while the account plays incognito ──────
// The bot's member sync reads the account's top character (level + class) into
// the member's Discord nickname. While the account has a live incognito session
// that read carries NO character, so the nickname stays frozen at what it last
// showed rather than tracking the incognito character's progress (stripping it
// instead would itself announce "incognito now"). The flex read is REST-side,
// so the live session set reaches it through a probe the composition root
// installs over the GameServer's sessions (server/main.ts).
let incognitoAccountsProbe: () => ReadonlySet<number> = () => new Set();

/** Install the live-incognito-accounts probe (server/main.ts). */
export function setIncognitoAccountsProbe(probe: () => ReadonlySet<number>): void {
  incognitoAccountsProbe = probe;
}

/** The accounts with a live incognito session in this realm process, read once
 *  per flex request (a batch shares one read). */
export function incognitoAccountIds(): ReadonlySet<number> {
  return incognitoAccountsProbe();
}

/** One pass over the live sessions: the accounts any incognito session belongs to. */
export function incognitoAccountIdsOf(
  sessions: Iterable<{ accountId: number; incognito: boolean }>,
): Set<number> {
  const out = new Set<number>();
  for (const s of sessions) if (s.incognito) out.add(s.accountId);
  return out;
}

/** The flex payload with its character withheld while the account is incognito;
 *  the same object otherwise. */
export function hideIncognitoFlexCharacter<T extends { character: unknown }>(
  flex: T,
  accountId: number,
  incognito: ReadonlySet<number>,
): T {
  return incognito.has(accountId) ? { ...flex, character: null } : flex;
}
