// Skin-driven attack-clip substitution: the clip set and time scale a
// DISPLAYED weapon skin swaps in for a visual's authored attack.
//
// The hunter's authored attack is 2H_Ranged_Shoot, a crossbow shoulder-aim
// (the class ranged visual is a crossbow). With a BOW skin displayed the shot
// plays the pack's draw clip instead: 2H_Ranged_Reload reads as nock plus
// string pull on the KayKit rig, shipped to the hunter via the bow_anims.glb
// animUrls entry (scripts/build_bow_anims.mjs), slightly slower so the draw
// reads. Crossbow skins keep the authored aim.
//
// Pure over the skin catalog: no DOM, no three, Node-tested directly
// (tests/weapon_skins.test.ts). CharacterVisual is the one consumer.

import { WEAPON_SKINS } from '../../sim/content/weapon_skins';
import { AUTO_SHOT_DRAW_S } from '../../sim/projectile_travel';

export interface SkinAttackClips {
  clips: readonly string[];
  timeScale: number;
  /** Seconds into the clip (at timeScale 1) when the projectile leaves: the
   *  renderer delays the tracer to this moment so the arrow flies exactly at
   *  the authored release keyframe. */
  releaseAt: number;
}

// Bow_Draw_Shot is authored by scripts/build_bow_anims.mjs (raise + nock,
// eased draw, anticipation hold, release snap, follow-through) with its
// release keyframe at the sim's Auto Shot draw time: the arrow (tracer +
// damage flight) launches sim-side at AUTO_SHOT_DRAW_S after the windup, so
// the clip and the projectile are in lockstep by construction. The build
// script's BOW_RELEASE_AT must equal this (pinned by
// tests/weapon_skins.test.ts).
export const BOW_RELEASE_AT = AUTO_SHOT_DRAW_S;

const BOW_ATTACK: SkinAttackClips = {
  clips: ['Bow_Draw_Shot'],
  timeScale: 1.0,
  releaseAt: BOW_RELEASE_AT,
};

// Every clip a displayed weapon skin can substitute for the authored attack.
// CharacterVisual binds these alongside the def's own clip names; a rig that
// does not ship them (no animUrls entry) simply skips the absent names, so
// only the hunter pays the extra action.
export const SKIN_ATTACK_CLIP_NAMES: readonly string[] = ['Bow_Draw_Shot'];

/** The attack-clip override for a displayed weapon skin, or null to keep the
 *  visual's authored attack. */
export function weaponSkinAttackClips(weaponSkinId: string | null): SkinAttackClips | null {
  const skin = weaponSkinId ? WEAPON_SKINS[weaponSkinId] : null;
  return skin?.weaponType === 'bow' ? BOW_ATTACK : null;
}
