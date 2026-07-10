// Back-carry transforms for sheathed weapons (the Z-key stow toggle): where a held
// prop sits when re-parented from a handslot bone onto the `chest` bone. Pure data +
// math (no three.js) so the family fallback and side mirroring are Node-testable;
// assets.ts applies the result to the cloned prop and keeps the SCALE the normal
// hand-grip pass computed (variant-pack clamps included).
//
// Coordinates are chest-bone local space on the shared KayKit Rig_Medium skeleton
// (all 9 player classes + the Combat Mech use it). Values are hand-tuned against
// in-game screenshots; treat them as data, not derivations.

export interface BackGripTransform {
  position: [number, number, number];
  /** Unit quaternion [x, y, z, w] in chest-bone local space. */
  quaternion: [number, number, number, number];
}

interface BackGripSpec {
  position: [number, number, number];
  /** Intrinsic XYZ Euler, radians (converted once at module load). */
  euler: [number, number, number];
}

/** Intrinsic XYZ Euler to quaternion [x, y, z, w] (three.js 'XYZ' order). */
export function quatFromEulerXYZ(
  x: number,
  y: number,
  z: number,
): [number, number, number, number] {
  const c1 = Math.cos(x / 2);
  const s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2);
  const s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

// Long hafts (staves, polearms, 2H) ride the diagonal across the back; short
// blades tuck vertically behind the shoulder. The rig's chest +Z faces forward,
// +Y runs up the spine, so "on the back" is negative Z. Mainhand (right) props
// lean one way; a left-hand prop (rogue offhand dagger, the warlock spellbook)
// mirrors across X so dual-wield reads as crossed blades.
const DEFAULT_BACK: BackGripSpec = {
  position: [0.1, 0.05, -0.14],
  euler: [0, 0, Math.PI * 0.85],
};

const BACK_GRIPS: Record<string, BackGripSpec> = {
  '1H_Sword': { position: [0.1, 0.05, -0.14], euler: [0, 0, Math.PI * 0.85] },
  '2H_Sword': { position: [0.08, 0.0, -0.18], euler: [0, 0, Math.PI * 0.8] },
  '1H_Axe': { position: [0.1, 0.05, -0.14], euler: [0, 0, Math.PI * 0.85] },
  '2H_Axe': { position: [0.08, 0.0, -0.18], euler: [0, 0, Math.PI * 0.8] },
  '2H_Staff': { position: [0.08, -0.1, -0.18], euler: [0, 0, Math.PI * 0.78] },
  Knife: { position: [0.1, 0.15, -0.12], euler: [0, 0, Math.PI * 0.9] },
  '1H_Wand': { position: [0.1, 0.15, -0.12], euler: [0, 0, Math.PI * 0.9] },
  '1H_Crossbow': { position: [0.05, 0.05, -0.2], euler: [0, Math.PI / 2, Math.PI] },
  '2H_Crossbow': { position: [0.05, 0.05, -0.22], euler: [0, Math.PI / 2, Math.PI] },
  VAR_SWORD: { position: [0.1, 0.05, -0.14], euler: [0, 0, Math.PI * 0.85] },
  VAR_DAGGER: { position: [0.1, 0.15, -0.12], euler: [0, 0, Math.PI * 0.9] },
  VAR_STAFF: { position: [0.08, -0.1, -0.18], euler: [0, 0, Math.PI * 0.78] },
  VAR_AXE: { position: [0.1, 0.05, -0.14], euler: [0, 0, Math.PI * 0.85] },
  VAR_POLEARM: { position: [0.08, -0.1, -0.18], euler: [0, 0, Math.PI * 0.78] },
  VAR_WAND: { position: [0.1, 0.15, -0.12], euler: [0, 0, Math.PI * 0.9] },
};

/** The on-back transform for a sheathed prop: family-specific, mirrored across X
 *  (position and lean) for a left-hand prop, defaulting for unknown families. */
export function backGripFor(accessory: string | null, side: 'r' | 'l'): BackGripTransform {
  const spec = (accessory && BACK_GRIPS[accessory]) || DEFAULT_BACK;
  const mirror = side === 'l' ? -1 : 1;
  return {
    position: [spec.position[0] * mirror, spec.position[1], spec.position[2]],
    quaternion: quatFromEulerXYZ(spec.euler[0], spec.euler[1] * mirror, spec.euler[2] * mirror),
  };
}
