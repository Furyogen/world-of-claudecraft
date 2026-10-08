import { NYTHRAXIS_IMPALED_AURA_ID } from '../sim/nythraxis_bone_spike';

export const CHARACTER_EFFECT_SOUL_REND = 1 << 0;
export const CHARACTER_EFFECT_SANGUINE = 1 << 1;
export const CHARACTER_EFFECT_RECKLESSNESS = 1 << 2;
/** Pinned to a Nythraxis Bone Spike: the living body drapes the death pose
 *  (plays its death clip and holds the last frame) until the aura clears. */
export const CHARACTER_EFFECT_IMPALED = 1 << 3;
/** Rising spores: worn by a druid in Sporemender Form AND by anyone carrying
 *  the Wildbloom (`rejuvenation`) heal-over-time, so the healed target reads
 *  the same mushroom-druid motif as the healer. Cosmetic only. */
export const CHARACTER_EFFECT_SPORES = 1 << 4;

export interface CharacterEffectAura {
  id: string;
  kind: string;
}

export function addCharacterEffectAura(flags: number, aura: CharacterEffectAura): number {
  let next = flags;
  if (aura.id === 'nythraxis_soul_rend') next |= CHARACTER_EFFECT_SOUL_REND;
  if (aura.id === NYTHRAXIS_IMPALED_AURA_ID) next |= CHARACTER_EFFECT_IMPALED;
  if (aura.id === 'sanguine_aura') next |= CHARACTER_EFFECT_SANGUINE;
  if (aura.kind === 'buff_reckless') next |= CHARACTER_EFFECT_RECKLESSNESS;
  if (aura.kind === 'form_sporemender' || (aura.id === 'rejuvenation' && aura.kind === 'hot')) {
    next |= CHARACTER_EFFECT_SPORES;
  }
  return next;
}

export function characterEffectFlags(auras: readonly CharacterEffectAura[]): number {
  let flags = 0;
  for (const aura of auras) flags = addCharacterEffectAura(flags, aura);
  return flags;
}

export function hasCharacterEffect(flags: number, effect: number): boolean {
  return (flags & effect) !== 0;
}
