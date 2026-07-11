// Per-weapon in-game VFX tuning, written by the asset-pipeline inspector's
// "Save VFX" button (scripts/asset_pipeline/lib/integrate.mjs saveVfxTuning).
// Each row is the FULL slider state for that weapon: absolute multipliers over
// the authored spec, exactly what the inspector showed when saved. A row
// REPLACES the tier's WORLD_TUNING baseline (it does not stack on it), so the
// look dialed in the editor is the look that ships in the world renderer and
// the armory inspect preview. An absent key falls back to WORLD_TUNING[tier].
import { type WeaponVfxTierName, type WeaponVfxTuning, WORLD_TUNING } from './weapon_vfx';

export const WEAPON_VFX_TUNING: Record<string, Partial<WeaponVfxTuning>> = {
  // Populated by the inspector Save VFX button, keyed by weapon model basename.
};

/** Effective in-game tuning for a skinned weapon: the hand-saved per-weapon
 *  row when one exists, else the tier's world softening baseline. */
export function weaponVfxTuningFor(
  model: string,
  tier: WeaponVfxTierName,
): Partial<WeaponVfxTuning> {
  return WEAPON_VFX_TUNING[model] ?? WORLD_TUNING[tier] ?? {};
}
