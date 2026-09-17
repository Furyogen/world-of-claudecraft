// Nature's Boon, the Wildfang autoattack passive (v0.43 feral pass).
//
// Every LANDED melee auto-attack a committed feral druid makes has a 10%
// chance to arm one free spell for 10 seconds. The armed window covers BOTH
// spells at once and the player chooses which to spend it on: whichever of
// Wildbloom or Lunar Tempest is cast first consumes it, and the other reverts.
//
// Two things make the window worth having in a form, and both are deliberate:
//
//   free   The window is an ordinary `next_cast_free` aura scoped by
//          `empowerAbilities`, so the existing cost tail (combat/
//          empower_next.ts) zeroes the cost and the action bar already lights
//          the slot. Nothing new rides the wire.
//   in form  A shapeshifted druid normally cannot cast either spell: the cast
//          gate refuses it, or the auto-unshift rule drops the form to let it
//          through. While the window is armed BOTH of those stand down
//          (casting_lifecycle.ts and form_auto_unshift.ts each ask
//          naturesBoonArmedFor), so the free cast goes off from Cat, Bruin,
//          Fleet, Moonwing, or caster form and the druid keeps the form it is
//          standing in. That is the whole point of the passive.
//
// Determinism: the 10% roll is drawn ONLY after the feral-druid gate has
// passed, so a non-feral player's rng stream stays byte-identical (the
// Cinderbark 2pc precedent in druid_engines.ts). It is one draw per landed
// auto-attack, never per ability swing.
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const NATURES_BOON_ID = 'natures_boon';
/** The English aura name. Localized at the client through the sim_i18n
 *  matcher, like every other sim-emitted aura name. */
export const NATURES_BOON_NAME = "Nature's Boon";
/** Per landed auto-attack. */
export const NATURES_BOON_CHANCE = 0.1;
/** How long the armed window lasts, in seconds. */
export const NATURES_BOON_DURATION = 10;

/** The two spells the window pays for: Wildbloom (`rejuvenation`) and Lunar
 *  Tempest (`moonfire`). Both are armed together; the first one cast wins. */
// Aura.empowerAbilities is a MUTABLE string[] that applyAura stores by
// reference, so every armed window gets its own copy. Handing out this module
// constant instead would share one array across every player and every Sim in
// the process, which is exactly the module-holds-state trap src/sim/CLAUDE.md
// warns about.
export const NATURES_BOON_ABILITIES: readonly string[] = ['rejuvenation', 'moonfire'];
function boonAbilityList(): string[] {
  return [...NATURES_BOON_ABILITIES];
}

/** Structural, so both a sim Aura and the action bar's mirrored aura fit. */
interface BoonAura {
  id?: string;
  kind: string;
  empowerAbilities?: readonly string[];
}

/** Is a Nature's Boon window armed for this exact ability right now? The one
 *  question the cast gate and the auto-unshift rule ask, so neither can
 *  disagree with what the consume funnel will actually accept. */
export function naturesBoonArmedFor(
  auras: readonly BoonAura[],
  abilityId: string | undefined,
): boolean {
  if (abilityId === undefined || !NATURES_BOON_ABILITIES.includes(abilityId)) return false;
  return auras.some(
    (aura) =>
      aura.id === NATURES_BOON_ID &&
      aura.kind === 'next_cast_free' &&
      aura.empowerAbilities !== undefined &&
      aura.empowerAbilities.includes(abilityId),
  );
}

/** Is this player a committed feral druid? The gate that must pass BEFORE the
 *  roll, so nobody else's rng stream moves. */
function isWildfangDruid(ctx: SimContext, player: Entity): boolean {
  if (player.kind !== 'player') return false;
  const meta = ctx.players.get(player.id);
  if (!meta || meta.cls !== 'druid') return false;
  return ctx.playerMods(meta).spec === 'feral';
}

/** Arm the window, replacing any window already running (a fresh proc refreshes
 *  the 10 sec rather than stacking). */
function armNaturesBoon(ctx: SimContext, player: Entity): void {
  const existing = player.auras.find(
    (aura) => aura.id === NATURES_BOON_ID && aura.sourceId === player.id,
  );
  if (existing) {
    existing.kind = 'next_cast_free';
    existing.remaining = NATURES_BOON_DURATION;
    existing.duration = NATURES_BOON_DURATION;
    existing.empowerAbilities = boonAbilityList();
    return;
  }
  ctx.applyAura(player, {
    id: NATURES_BOON_ID,
    name: NATURES_BOON_NAME,
    kind: 'next_cast_free',
    remaining: NATURES_BOON_DURATION,
    duration: NATURES_BOON_DURATION,
    value: 0,
    sourceId: player.id,
    school: 'nature',
    empowerAbilities: boonAbilityList(),
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: player.id,
    targetId: player.id,
    school: 'nature',
    fx: 'procSurge',
  });
}

/** The landed-auto-attack hook (combat/auto_attack.ts). Rolls the 10% only for
 *  a committed feral druid; everybody else returns before touching the rng. */
export function naturesBoonOnAutoAttack(ctx: SimContext, player: Entity): void {
  if (!isWildfangDruid(ctx, player)) return;
  if (!ctx.rng.chance(NATURES_BOON_CHANCE)) return;
  armNaturesBoon(ctx, player);
}
