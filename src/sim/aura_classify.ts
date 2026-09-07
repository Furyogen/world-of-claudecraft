// Single source of truth for "is this aura a debuff?" — shared by the HUD buff/
// debuff split and the sim's /targetbuffs aura tagging. Host-agnostic (no DOM, no
// i18n), so it lives in src/sim/ and both src/ui/hud.ts and src/sim/sim.ts import
// it. Keeping ONE classifier avoids the drift where the HUD treated silence/disarm/
// blind/etc. as debuffs but /targetbuffs (a narrower set) tagged them as buffs.
import { isUnbreakableControlAura } from './combat/cc';
import type { Aura, AuraKind } from './types';

// A kind that is harmful by nature regardless of its value. Mirrors classic-era
// "Debuff" framing: damage-over-time, crowd control, stat/armor reductions, and
// the various combat penalties (silence/disarm/blind/lockout/expose/...).
export const DEBUFF_AURA_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'dot',
  'slow',
  'root',
  'stun',
  'incapacitate',
  'polymorph',
  'attackspeed',
  'bleed_vuln',
  'debuff_ap',
  'sunder',
  'corrode',
  'faerie_fire',
  'mortal_wound',
  'silence',
  'disarm',
  'blind',
  'expose',
  'spellvuln',
  'lockout',
  'vulnerability',
  'hex',
  'tongues',
  'cost_tax',
  'heal_absorb',
  'critvuln',
  'sated', // shared Bloodlust / Temporal Acceleration exhaustion lockout
  'cauterize_fatigue', // Cauterize's 5 min "already saved you" lockout
]);

// A negative-value stat aura (e.g. a mob's Withering Wail sapping attack power, or
// an Intellect-draining curse) is a debuff even though it reuses a buff_* kind.
export function isDebuffAura(kind: AuraKind, value: number): boolean {
  return DEBUFF_AURA_KINDS.has(kind) || (kind.startsWith('buff_') && value < 0);
}

// The one rule for "may a player counter take this aura off at all", ahead of any
// question of school or polarity. Two aura classes answer no: encounter-authored
// unbreakable control (the script owns its release) and `undispellable` penalties
// (the recovery sicknesses, which only their own timer clears). Every removal path a
// player can drive routes through here so the answer cannot drift between them: the
// dispel executor and its requiresDispellable cast gate (isDispellableAura below),
// the cleanseSelf executor (combat/effect_dispatch.ts), and the right-click buff
// cancel (combat/aura_cancel.ts).
export function isPlayerRemovableAura(
  aura: Pick<Aura, 'kind' | 'unbreakableControl' | 'undispellable'>,
): boolean {
  return !isUnbreakableControlAura(aura) && aura.undispellable !== true;
}

// The dispel eligibility rule, shared by the dispel executor and the
// requiresDispellable cast gate so the two can never drift: player-removable and
// magic-school only, and the cast's direction picks the polarity (an OFFENSIVE dispel
// strips a benefit off an enemy; a friendly one strips a harmful effect off an ally).
export function isDispellableAura(
  aura: Pick<Aura, 'kind' | 'value' | 'school' | 'unbreakableControl' | 'undispellable'>,
  offensive: boolean,
): boolean {
  if (!isPlayerRemovableAura(aura)) return false;
  if (aura.school === 'physical') return false;
  const harmful = isDebuffAura(aura.kind, aura.value);
  return offensive ? !harmful : harmful;
}

// Auras that read as a MODE rather than a timed effect: the forms, the stances,
// stealth, Ghost Wolf, and the battleground carried-flag buff. The sim backs each
// with a long finite duration (3600s, or a whole match) that is SCAFFOLDING, not
// information, so no surface may print a countdown for one: the buff bar suppresses
// its remaining-time label and the aura overlay suppresses its timer ring.
//
// This lives here, beside the debuff classifier, for the same stated reason: one
// classifier so the surfaces cannot drift. They did drift once already, which is how
// a watched Battle Stance came to show a 3,599 countdown on the overlay while the
// buff bar showed none for the same aura.
export const TOGGLE_AURA_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'stealth',
  'form_bear',
  'form_cat',
  'form_moonkin',
  'form_shadow',
  'form_travel',
  'form_fireball',
  'battle_stance',
  'berserker_stance',
  'defensive_stance',
]);

// Ghost Wolf toggles too, but its aura rides the generic buff_speed kind (which
// Sprint also uses, 15s and very much worth a countdown), so it toggles by id. The
// carried-flag buff is a MODE for the same reason: you have the flag until you do
// not, and its duration only outlasts any match so nothing can expire it out from
// under the carry.
export const TOGGLE_AURA_IDS: ReadonlySet<string> = new Set(['ghost_wolf', 'bg_carried_flag']);

// The inverse override: an aura that rides a TOGGLE kind but is a genuine timed buff
// worth a countdown. Greater Invisibility reuses the rogue-stealth machinery for its
// vanish (kind 'stealth' with full move speed) but is a fixed 20s buff.
export const TIMED_AURA_IDS: ReadonlySet<string> = new Set(['greater_invisibility']);

/** Whether this aura reads as a MODE rather than a timed effect, so no surface
 *  prints a remaining time for it. */
export function isToggleAura(kind: AuraKind, id: string): boolean {
  return (TOGGLE_AURA_KINDS.has(kind) || TOGGLE_AURA_IDS.has(id)) && !TIMED_AURA_IDS.has(id);
}

const PARTY_FRAME_HELPFUL_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'temporal_echo',
  'hot',
  'absorb',
  'cast_shield',
  'heal_echo',
  'buff_dr',
  'buff_maxhp_pct',
  'stasis',
]);

// Evasion and Deterrence share buff_dodge with long-lived maintenance buffs, so
// their stable ability ids distinguish the major defensives from passive upkeep.
const PARTY_FRAME_HELPFUL_IDS: ReadonlySet<string> = new Set(['evasion', 'deterrence']);

/** Effects worth surfacing on a compact party/raid frame. Generic maintenance
 * buffs, forms, stances, and personal damage procs remain on the normal aura UI. */
export function isPartyFrameRelevantAura(aura: {
  id: string;
  kind: AuraKind;
  value?: number;
  neg?: 1;
}): boolean {
  if (aura.kind === 'sated') return false;
  const value = aura.neg ? -1 : (aura.value ?? 1);
  return (
    isDebuffAura(aura.kind, value) ||
    PARTY_FRAME_HELPFUL_KINDS.has(aura.kind) ||
    PARTY_FRAME_HELPFUL_IDS.has(aura.id)
  );
}
