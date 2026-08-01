// Admin cloak: the state behind the in-game GM command /invisible (cleared by
// /visible). A cloaked admin is removed from the world for everyone else: the
// server drops them from every other viewer's interest snapshot, mobs and pets
// cannot perceive them, no player can select them, and every damage path
// no-ops on them.
//
// Server-side only, like the `gm` and `jailed` flags: nothing persists it, no
// client command sets it, and the offline Sim never turns it on. It is a plain
// entity flag so every read is a branch on a boolean, which matters because the
// perception checks below sit in the per-tick mob-scan hot path.
//
// `src/sim`-pure: imports only sibling sim types plus the pure threat helpers
// (no DOM/Three/render/ui/game/net, no Math.random/Date.now), enforced by
// tests/architecture.test.ts.

import { dropThreat } from './threat';
import type { Entity } from './types';

export function isAdminCloaked(e: Pick<Entity, 'adminCloak'>): boolean {
  return e.adminCloak === true;
}

/** Turn the cloak on or off. Clearing deletes the field rather than writing
 *  `false`, so an uncloaked entity is shaped exactly like one that never was. */
export function setAdminCloak(e: Entity, enabled: boolean): void {
  if (enabled) e.adminCloak = true;
  else delete e.adminCloak;
}

/**
 * Sever every live tie the world still holds to a player who just went
 * invisible: hate-table entries, selections, and aggro locks. Without this a
 * mob mid-chase would keep swinging at something nobody can see, and another
 * player's unit frame would stay pinned to a target that no longer wires.
 *
 * Mutates the passed entities in place (the same waiver threat.ts takes) and
 * draws no rng, so it is safe to call from the server between ticks. `retarget`
 * is the caller's `retargetMob`, invoked only for a mob whose aggro pointed at
 * the cloaked player, so the mob picks its next-highest-threat attacker or
 * evades home instead of standing idle with a dangling target id.
 */
export function shedCloakedPresence(
  cloakedId: number,
  entities: Iterable<Entity>,
  retarget: (mob: Entity) => void,
): void {
  for (const e of entities) {
    if (e.id === cloakedId) continue;
    if (e.threat.has(cloakedId)) dropThreat(e, cloakedId);
    if (e.targetId === cloakedId) {
      e.targetId = null;
      e.autoAttack = false;
    }
    if (e.aggroTargetId === cloakedId) {
      e.aggroTargetId = null;
      retarget(e);
    }
  }
}
