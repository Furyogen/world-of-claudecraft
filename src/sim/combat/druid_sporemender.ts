// Groveheart's Sporemender Form (`sporemender_form`, aura kind
// `form_sporemender`): the healer's answer to Moongrove's Moonwing Form. It is a
// CASTER form, like Moonwing: the druid keeps the whole spellbook, the mana bar,
// and the class wand, so it is not a resource-shift or action-locking form
// (combat/forms.ts leaves it out of both sets on purpose).
//
// While worn:
//   - healing done is increased by 20%: every direct heal through applyHeal
//     (combat/heal.ts) and every heal-over-time tick the druid owns
//     (combat/auras.ts) is scaled at RESOLUTION time, so a HoT planted in
//     caster form heals for more the moment the druid shifts in, and stops the
//     moment they shift out. This mirrors Moonwing's +20% spell damage, which
//     also reads the live form aura rather than baking at cast time.
//   - armor is increased by 50% (entity.ts recalcPlayerStats, the same 1.5x
//     Moonwing applies).
//   - shifting in grants Loping Stride, because the form button is one of the
//     druid FORM_ABILITY_IDS in combat/druid_engines.ts.
//
// Pure reads over the entity's auras; draws no rng.
import type { AuraKind, Entity } from '../types';

export const SPOREMENDER_FORM_ID = 'sporemender_form';
export const SPOREMENDER_FORM_KIND: AuraKind = 'form_sporemender';
/** Healing done bonus while in Sporemender Form (a fraction: 0.2 = +20%). */
export const SPOREMENDER_HEALING_DONE_PCT = 0.2;
/** Armor multiplier while in Sporemender Form (the Moonwing 1.5x). */
export const SPOREMENDER_ARMOR_MULT = 1.5;

/** True while the entity wears Sporemender Form. */
export function inSporemenderForm(entity: Pick<Entity, 'auras'>): boolean {
  for (const aura of entity.auras) if (aura.kind === SPOREMENDER_FORM_KIND) return true;
  return false;
}

/** The outgoing healing multiplier Sporemender Form contributes for a healer:
 *  1.2 while the form is worn, exactly 1 otherwise (so every other healer's
 *  arithmetic stays byte-identical). A missing healer (a HoT whose caster has
 *  left the world) contributes nothing. */
export function sporemenderHealingDoneMult(
  healer: Pick<Entity, 'auras'> | null | undefined,
): number {
  return healer && inSporemenderForm(healer) ? 1 + SPOREMENDER_HEALING_DONE_PCT : 1;
}
