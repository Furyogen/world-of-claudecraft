// Druid quality of life: a healing or damaging cast pressed from Bruin, Wolf, or
// Fleet Form leaves the form on its own instead of being refused with "You can't
// do that while shapeshifted."
//
// The whole decision is a pure function of the worn auras plus the cast's
// RANK-RESOLVED effects, so it is a leaf module (no SimContext, no clock, no rng)
// that the cast gate in ./casting_lifecycle.ts and the action bar's usable-state
// core (src/ui/hud/action_bar/action_bar_view.ts) both import. Bar and combat
// asking the same function is what keeps a slot from painting unusable while the
// cast it refuses to advertise succeeds.
//
// Scope, deliberately: only the three action-locking forms that also PARK THE
// MANA POOL (form_bear / form_cat / form_travel, i.e. Bruin / Wolf / Fleet). Those
// are exactly the druid forms whose whole reason for blocking a spell is that the
// caster kit has no bar to spend from. Moonwing Form keeps its mana bar and can
// already cast, and the mage's form_fireball is action-locked for its own reasons,
// so neither is touched. Keying on the aura kind rather than on the class keeps
// this data-driven: a form is covered because of what it does to the resource bar,
// not because of who wears it.

import type { AbilityDef, AbilityEffect, AuraKind } from '../types';
import { isFormToggleAbility, isResourceShiftFormAuraKind } from './forms';

/** Effects that deliver healing. `consumeAura` (Swiftmend) is handled separately:
 *  it only heals when the effect carries a heal payload. */
const HEALING_EFFECT_TYPES: ReadonlySet<AbilityEffect['type']> = new Set([
  'heal',
  'hot',
  'aoeHeal',
  'chainHeal',
  'selfHealPctMax',
  'selfHotPctMax',
  // The Groveheart payoff: Overbloom harvests the druid's own HoTs into a burst heal.
  'druidOverbloom',
]);

/** Effects that deliver damage. Note that `aoeAllyDamage` is deliberately absent:
 *  despite the name it is an ally DAMAGE BUFF, not a damage effect. */
const DAMAGING_EFFECT_TYPES: ReadonlySet<AbilityEffect['type']> = new Set([
  'directDamage',
  'dot',
  'aoeDamage',
  'chainDamage',
  'finisherDamage',
  'weaponDamage',
  'weaponStrike',
  'drainTick',
]);

/** Hard crowd control. A damage effect riding ALONGSIDE one of these is a rider on
 *  a control button, not the point of the cast, so it does not on its own make the
 *  cast a damaging spell. Gripping Roots is the case this exists for: from rank 2
 *  it carries a bleed beside its root, and a druid pressing it wants the root, not
 *  to be dumped out of Bruin Form for 32 damage over 12 seconds. */
const CROWD_CONTROL_EFFECT_TYPES: ReadonlySet<AbilityEffect['type']> = new Set([
  'root',
  'stun',
  'finisherStun',
  'incapacitate',
  'polymorph',
  'aoeFear',
  'silence',
  'interrupt',
]);

function healsSomething(effect: AbilityEffect): boolean {
  if (HEALING_EFFECT_TYPES.has(effect.type)) return true;
  // Swiftmend: eats one of the caster's own HoTs and pays it out as a direct heal.
  return effect.type === 'consumeAura' && effect.heal !== undefined;
}

/** Is this cast a healing or damaging spell, the two kinds a druid shifts out of
 *  form to cast? Healing always counts; damage counts unless it rides on a hard
 *  crowd control effect (see CROWD_CONTROL_EFFECT_TYPES). */
export function isHealingOrDamagingCast(effects: readonly AbilityEffect[]): boolean {
  if (effects.some(healsSomething)) return true;
  if (effects.some((effect) => CROWD_CONTROL_EFFECT_TYPES.has(effect.type))) return false;
  return effects.some((effect) => DAMAGING_EFFECT_TYPES.has(effect.type));
}

/**
 * The form aura an automatic shift-out would drop for this cast, or null when the
 * cast triggers no shift (the caller then applies the ordinary form rules).
 *
 * Pass the RANK-RESOLVED effects (`ResolvedAbility.effects`), not the base def's:
 * those are what actually run, and a spell that only gains an effect at a later
 * rank would slip a base-def check. Same list the sibling cast gates read.
 */
export function autoShiftFormAura<T extends { kind: AuraKind }>(
  auras: readonly T[],
  ability: Pick<AbilityDef, 'requiresForm' | 'usableInForm'>,
  effects: readonly AbilityEffect[],
): T | null {
  // The form kit itself, and anything already cleared for use while shifted, keeps
  // the existing rules: those casts never wanted the form gone. The toggle question
  // is asked against the RESOLVED effects passed in rather than the def's own list,
  // so this needs nothing from the def beyond the two flags above.
  if (ability.requiresForm !== undefined || ability.usableInForm === true) return null;
  if (isFormToggleAbility({ effects })) return null;
  if (!isHealingOrDamagingCast(effects)) return null;
  return auras.find((aura) => isResourceShiftFormAuraKind(aura.kind)) ?? null;
}
