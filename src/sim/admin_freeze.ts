// Admin freeze: the state behind the in-game GM commands /freeze and /unfreeze.
// A frozen player is encased in the mage Ice Block (Cold Coffin) they already
// know from combat, so the effect reads instantly to everyone watching: same
// aura id, same `stasis` kind, so the renderer's ice shell (render/
// ice_block_visual.ts) and the HUD icon both light up with no new art.
//
// Reusing `stasis` is what makes the hold total, because the existing rules do
// all the work: `isRooted`/`isStunned` (combat/cc.ts) already gate movement,
// jumping, and casting, `dealDamage` already no-ops on a stasis target, and
// unstuck already refuses ('controlled') and cancels a countdown in flight
// ('state_changed'). The one thing an ordinary Ice Block does NOT do is stay,
// so this aura adds `unbreakableControl` (no cleanse, no dispel, no
// damage-break, and no recast-to-cancel: cancelStasisToggle in
// combat/casting_lifecycle.ts refuses an unbreakable aura) and a duration long
// enough that only a moderator's /unfreeze ends it.
//
// Server-side only, like `gm`/`jailed`: no client command reaches it and the
// offline Sim never applies it. Unlike the cloak it DOES persist (see
// AdminFreezeState + the `adminFreeze` field on the character save), so a
// frozen player cannot shed the hold by logging out and back in.
//
// `src/sim`-pure: imports only sibling sim data/types (no DOM/Three/render/ui/
// game/net, no Math.random/Date.now), enforced by tests/architecture.test.ts.

import { ABILITIES } from './data';
import type { Aura, Entity } from './types';

/** The mage Ice Block aura id, deliberately shared so the frozen player gets
 *  the real ice shell and buff icon instead of a bespoke lookalike. */
export const ADMIN_FREEZE_AURA_ID = 'ice_block';

/** One year. The freeze is ended by /unfreeze, not by waiting: this is only the
 *  backstop that keeps a forgotten freeze from outliving the realm itself. */
export const ADMIN_FREEZE_DURATION_SECONDS = 365 * 24 * 60 * 60;

/** Persisted freeze record (JSONB, on the character save). `since` is epoch ms
 *  from the server wall clock, kept for the moderation readout; the freeze has
 *  no expiry, so there is deliberately no `until`. */
export type AdminFreezeState = {
  since: number;
};

export function isAdminFrozen(e: Pick<Entity, 'adminFrozen'>): boolean {
  return e.adminFrozen === true;
}

/**
 * Whether an aura is THIS system's freeze rather than a mage's own Ice Block.
 * The pair share an id and a kind on purpose (that is what buys the visual), so
 * `unbreakableControl` is the discriminator: no player cast produces one, and
 * clearing a freeze must never strip a mage's own 8-second block.
 */
export function isAdminFreezeAura(a: Aura): boolean {
  return a.id === ADMIN_FREEZE_AURA_ID && a.kind === 'stasis' && a.unbreakableControl === true;
}

export function adminFreezeAura(sourceId: number): Aura {
  return {
    id: ADMIN_FREEZE_AURA_ID,
    name: ABILITIES[ADMIN_FREEZE_AURA_ID].name,
    kind: 'stasis',
    remaining: ADMIN_FREEZE_DURATION_SECONDS,
    duration: ADMIN_FREEZE_DURATION_SECONDS,
    value: 0,
    sourceId,
    school: 'frost',
    unbreakableControl: true,
  };
}

/**
 * Encase the player. Applied directly rather than through the ordinary aura
 * pipeline: a moderation hold must not be filtered by immunity, diminishing
 * returns, or an encounter's CC rules. Returns false when they were already
 * frozen, so the caller can report it instead of stacking a second shell.
 */
export function applyAdminFreeze(e: Entity, sourceId: number): boolean {
  if (isAdminFrozen(e)) return false;
  e.adminFrozen = true;
  e.auras.push(adminFreezeAura(sourceId));
  return true;
}

/** Release the player: drop the flag and every freeze aura they carry, leaving
 *  any mage-cast Ice Block alone. Returns false when they were not frozen. */
export function clearAdminFreeze(e: Entity): boolean {
  if (!isAdminFrozen(e)) return false;
  delete e.adminFrozen;
  for (let i = e.auras.length - 1; i >= 0; i--) {
    if (isAdminFreezeAura(e.auras[i])) e.auras.splice(i, 1);
  }
  return true;
}
