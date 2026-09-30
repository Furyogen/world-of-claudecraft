// The per-session identity-flair refreshers, moved out of server/game.ts (the
// monolith ratchet) as a move-not-rewrite: bodies are verbatim with `this.X`
// read through a narrow host. They stamp the integration-backed identity a
// player shows others (the $WOC holder tier, the linked-Discord flair, the
// developer badge, the operator-set account flair) onto the live entity and
// session. Every stamp is best-effort, guarded against the player leaving
// mid-fetch, and skipped for a staff incognito session (server/incognito.ts),
// which must look like an ordinary player's name.

import {
  type AccountFlair,
  type ChatSenderFlair,
  EMPTY_ACCOUNT_FLAIR,
  wireStreamerLinks,
} from '../src/sim/account_flair';
import { devTierIndexForMergedPrs } from '../src/sim/dev_tier';
import type { Entity } from '../src/sim/types';
import { chatSenderFlair } from './chat_sender_flair';
import { loadAccountFlair, pool, walletForAccount } from './db';
import { discordFlairForAccount } from './discord_db';
import { mergedPrsForLogin } from './github_contributors';
import { githubForAccount } from './github_db';
import { scrubIdentityFlair } from './incognito';
import { holderInfoForPubkey } from './woc_balance';

/** The session slice the refreshers read and write. ClientSession satisfies it. */
export interface IdentityFlairSession {
  pid: number;
  accountId: number;
  name: string;
  incognito: boolean;
  accountFlair: AccountFlair;
  chatFlair: ChatSenderFlair | undefined;
}

/** What the refreshers need from the GameServer. */
export interface IdentityFlairHost {
  /** True while this session is still the live one for its pid. */
  isLive(session: IdentityFlairSession): boolean;
  entity(pid: number): Entity | undefined;
  /** A dev override pinned this pid's holder tier (the /woctier cheat). */
  holderTierPinned(pid: number): boolean;
}

// Refresh one player's linked-Discord flair (status tier + PFP + nickname +
// member-since + staff role) for nearby players' nameplates / inspect cards.
export async function refreshDiscordFlair(
  host: IdentityFlairHost,
  session: IdentityFlairSession,
): Promise<void> {
  const flair = await discordFlairForAccount(pool, session.accountId);
  if (!host.isLive(session) || session.incognito) return;
  const e = host.entity(session.pid);
  if (!e) return;
  const tier = flair?.tier ?? 0;
  const avatar = flair?.avatarUrl ?? undefined;
  const name = flair?.name ?? undefined;
  const joined = flair?.joinedAtMs ?? undefined;
  const role = flair?.role ?? undefined;
  if (
    e.discordTier !== tier ||
    e.discordAvatar !== avatar ||
    e.discordName !== name ||
    e.discordJoined !== joined ||
    e.discordRole !== role
  ) {
    // identity diff re-broadcasts the linked-Discord flair to nearby players
    e.discordTier = tier;
    e.discordAvatar = avatar;
    e.discordName = name;
    e.discordJoined = joined;
    e.discordRole = role;
  }
}

// Update one player's holder-tier flair from their linked wallet's $WOC
// balance. Best-effort and guarded against the player leaving mid-fetch.
export async function refreshHolderTier(
  host: IdentityFlairHost,
  session: IdentityFlairSession,
): Promise<void> {
  if (host.holderTierPinned(session.pid)) return; // dev override pinned this pid
  const wallet = await walletForAccount(session.accountId);
  const { tier, balance } = wallet
    ? await holderInfoForPubkey(wallet.pubkey)
    : { tier: 0, balance: 0 };
  // The player may have left during the await; only apply if still the live
  // session for this pid (and never to an incognito one).
  if (!host.isLive(session) || session.incognito) return;
  const e = host.entity(session.pid);
  if (e && ((e.holderTier ?? 0) !== tier || (e.holderBalance ?? 0) !== balance)) {
    e.holderTier = tier; // identity diff re-broadcasts it to nearby players
    e.holderBalance = balance;
    console.log(`[woc] ${session.name} holder tier → ${tier} (${balance} $WOC)`);
  }
}

// Update one player's developer-badge flair from their linked GitHub login and
// the cached repo merged-PR stats. Best-effort and guarded against the player
// leaving mid-fetch. Only an actual contributor (tier > 0, so >= 1 merged PR)
// carries the flair on the wire; a linked non-contributor reads as no badge.
export async function refreshDevBadge(
  host: IdentityFlairHost,
  session: IdentityFlairSession,
): Promise<void> {
  const link = await githubForAccount(pool, session.accountId);
  const login = link?.github_login ?? null;
  const mergedPrs = login ? await mergedPrsForLogin(login) : 0;
  const tier = devTierIndexForMergedPrs(mergedPrs);
  // The player may have left during the await; only apply if still the live
  // session for this pid (and never to an incognito one).
  if (!host.isLive(session) || session.incognito) return;
  const e = host.entity(session.pid);
  if (!e) return;
  const githubLogin = tier > 0 ? (login ?? undefined) : undefined;
  const devMergedPrs = tier > 0 ? mergedPrs : undefined;
  if (
    (e.devTier ?? 0) !== tier ||
    (e.devMergedPrs ?? 0) !== (devMergedPrs ?? 0) ||
    e.githubLogin !== githubLogin
  ) {
    // identity diff re-broadcasts the developer-badge flair to nearby players
    e.devTier = tier;
    e.devMergedPrs = devMergedPrs;
    e.githubLogin = githubLogin;
    if (tier > 0) {
      console.log(`[dev] ${session.name} dev tier → ${tier} (${mergedPrs} merged PRs, @${login})`);
    }
  }
}

// Load one player's operator-set account flair (AI mark + streamer links) and
// stamp it on their entity + session. Best-effort and guarded against the player
// leaving mid-fetch, exactly like the Discord/holder/dev flair refreshes above.
export async function refreshAccountFlair(
  host: IdentityFlairHost,
  session: IdentityFlairSession,
): Promise<void> {
  const flair = await loadAccountFlair(session.accountId);
  if (!host.isLive(session) || session.incognito) return;
  stampAccountFlair(host, session, flair);
}

/**
 * Apply an account's flair to one live session: the entity fields the wire encodes
 * (the identity diff re-broadcasts them to nearby players on the next snapshot) and
 * the session copy the chat fan-out reads. `streamerLinks` is set through
 * wireStreamerLinks, so the entity never carries links for an account whose
 * streamer flag is off.
 */
export function stampAccountFlair(
  host: IdentityFlairHost,
  session: IdentityFlairSession,
  flair: AccountFlair,
): void {
  session.accountFlair = flair;
  // Derived once, here, and read straight off the session by every chat fan-out.
  session.chatFlair = chatSenderFlair(flair);
  const e = host.entity(session.pid);
  if (!e) return;
  e.aiAccount = flair.ai ? true : undefined;
  e.streamerLinks = wireStreamerLinks(flair);
}

/**
 * Push an operator's account-flair edit onto every live session of that account, so
 * the AI mark and the streamer links change with no reconnect. A no-op when the
 * account is offline (the next join loads the new row anyway), and skipped for an
 * incognito session.
 */
export function applyAccountFlairLive(
  host: IdentityFlairHost,
  sessions: Iterable<IdentityFlairSession>,
  accountId: number,
  flair: AccountFlair,
): void {
  for (const live of sessions) {
    if (live.accountId !== accountId || live.incognito) continue;
    stampAccountFlair(host, live, flair);
  }
}

// Stamp every integration-backed identity flair on one session: the $WOC
// holder tier, the linked-Discord flair, the developer badge (GitHub), and the
// operator-set account flair (AI mark + streamer links). Each read is
// best-effort: a failed read must never affect joining the world.
export function refreshAllIdentityFlair(
  host: IdentityFlairHost,
  session: IdentityFlairSession,
): void {
  void refreshHolderTier(host, session).catch((err) =>
    console.error('holder-tier refresh failed:', err),
  );
  void refreshDiscordFlair(host, session).catch((err) =>
    console.error('discord flair refresh failed:', err),
  );
  void refreshDevBadge(host, session).catch((err) =>
    console.error('dev badge refresh failed:', err),
  );
  void refreshAccountFlair(host, session).catch((err) =>
    console.error('account flair refresh failed:', err),
  );
}

// A linkdead resume may switch the login mode (log out normal, back in
// incognito inside the grace, or the reverse): scrub the flair the entity
// kept, or re-stamp it through the same best-effort refreshers a fresh join runs.
export function applyIncognitoOnResume(
  host: IdentityFlairHost,
  session: IdentityFlairSession,
  incognito: boolean,
): void {
  if (session.incognito === incognito) return;
  session.incognito = incognito;
  if (incognito) {
    const e = host.entity(session.pid);
    if (e) scrubIdentityFlair(e);
    session.accountFlair = EMPTY_ACCOUNT_FLAIR;
    session.chatFlair = undefined;
    return;
  }
  refreshAllIdentityFlair(host, session);
}
