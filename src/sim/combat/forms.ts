import type { AbilityEffect, AuraKind } from '../types';
import { isFormAuraKind as isFormAuraKindImpl } from '../types';

// One source of truth for the form kind set (types.ts FORM_AURA_KINDS, which
// includes form_fireball); re-exported here for the combat-side call sites.
export { isFormAuraKind } from '../types';

export function isResourceShiftFormAuraKind(kind: AuraKind): boolean {
  return kind === 'form_bear' || kind === 'form_cat' || kind === 'form_travel';
}

export function isActionLockingFormAuraKind(kind: AuraKind): boolean {
  return isResourceShiftFormAuraKind(kind) || kind === 'form_fireball';
}

export function isTravelFormAuraKind(kind: AuraKind): boolean {
  return kind === 'form_travel' || kind === 'form_fireball';
}

/** Does casting this ability toggle a form aura? Lives here beside the kind set
 *  rather than inside the cast gate so ./form_autoshift.ts can ask the same
 *  question without importing the casting lifecycle (a value cycle). */
export function isFormToggleAbility(ability: { effects: readonly AbilityEffect[] }): boolean {
  return ability.effects.some((e) => e.type === 'selfBuff' && isFormAuraKindImpl(e.kind));
}
