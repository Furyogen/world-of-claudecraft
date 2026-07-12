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

export interface SkinAttackClips {
  clips: readonly string[];
  timeScale: number;
}

const BOW_ATTACK: SkinAttackClips = {
  clips: ['2H_Ranged_Reload'],
  timeScale: 1.15,
};

// Every clip a displayed weapon skin can substitute for the authored attack.
// CharacterVisual binds these alongside the def's own clip names; a rig that
// does not ship them (no animUrls entry) simply skips the absent names, so
// only the hunter pays the extra actions. All three ranged clips ship in
// bow_anims.glb so the draw can be re-tuned without rebuilding the GLB.
export const SKIN_ATTACK_CLIP_NAMES: readonly string[] = [
  '2H_Ranged_Aiming',
  '2H_Ranged_Reload',
  '2H_Ranged_Shooting',
];

/** The attack-clip override for a displayed weapon skin, or null to keep the
 *  visual's authored attack. */
export function weaponSkinAttackClips(weaponSkinId: string | null): SkinAttackClips | null {
  const skin = weaponSkinId ? WEAPON_SKINS[weaponSkinId] : null;
  return skin?.weaponType === 'bow' ? BOW_ATTACK : null;
}
