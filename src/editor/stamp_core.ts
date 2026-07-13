// Pure sculpt-tool math for the map editor: the Smooth and Flatten level-stamp
// builders and the Erase hit tests. No DOM, no Three, no i18n; the terrain
// sampler is injected so a Vitest drives these with a synthetic heightfield
// (tests/editor_stamp_core.test.ts).
//
// Level-stamp semantics (src/sim/world.ts applyEditLayer): a stamp with
// mode 'level' pulls the height toward the absolute height `delta`, weighted by
// the falloff (1 at the centre for 'smooth', constant 1 for 'flat').

import type { HeightStamp } from '../sim/types';
import type { AssetPlacement } from './custom_map';

export type HeightSampler = (x: number, z: number) => number;

/**
 * Global gentleness scale for the Smooth and Flatten LEVEL brushes: every stamp
 * moves the ground only this fraction of the way it otherwise would, so fine
 * sculpting no longer overshoots. 1/5 = "5x gentler" while the brush-strength
 * slider keeps the exact same steps (a fifth the power per stamp, same range).
 * Smooth scales its blend factor by it; Flatten scales its pull toward the
 * captured target height. Raise/Lower (the `add` brushes) are unaffected.
 */
export const SCULPT_POWER_SCALE = 1 / 5;

/**
 * The five sample points the Smooth tool averages: the cursor plus four points
 * at half the brush radius on the +x/-x/+z/-z axes.
 */
export function smoothSamplePoints(
  x: number,
  z: number,
  radius: number,
): { x: number; z: number }[] {
  const h = radius / 2;
  return [
    { x, z },
    { x: x + h, z },
    { x: x - h, z },
    { x, z: z + h },
    { x, z: z - h },
  ];
}

/**
 * Smooth: a level-mode stamp whose target height is the local average, blended
 * toward that average by a modest strength factor so repeated strokes converge
 * instead of snapping. `strength` is the editor's EFFECTIVE brush strength
 * (the 1..50 slider divided by 5, i.e. 0.2..10; slider 5 == the legacy 1).
 */
export function smoothStamp(
  x: number,
  z: number,
  radius: number,
  strength: number,
  sample: HeightSampler,
): HeightStamp {
  const pts = smoothSamplePoints(x, z, radius);
  let sum = 0;
  for (const p of pts) sum += sample(p.x, p.z);
  const avg = sum / pts.length;
  const here = sample(x, z);
  // Modest strength scaling: the floor sits at a fifth of the legacy floor so
  // slider 1 really is 5x gentler; 10 (slider 50) pulls most of the way. The
  // whole curve is then scaled by SCULPT_POWER_SCALE so the brush is a further
  // 5x gentler across every slider step (its twin is flattenStamp below).
  const k = Math.min(0.65, Math.max(0.016, strength / 40)) * SCULPT_POWER_SCALE;
  return {
    x,
    z,
    radius,
    delta: here + (avg - here) * k,
    falloff: 'smooth',
    mode: 'level',
  };
}

/**
 * Flatten: a level-mode stamp that pulls the ground toward the height captured
 * at the drag START point. `hardEdge` selects the 'flat' falloff (a sheer
 * plateau edge) over the default eased taper.
 *
 * `strength` eases the pull: the stamp targets only `strength` of the way from
 * the CURRENT surface height (`currentHeight`) toward `targetHeight`, so a value
 * below 1 converges over more strokes instead of snapping in one. Both default
 * to a full hard snap (`currentHeight = targetHeight`, `strength = 1`) so older
 * callers and tests are unchanged; the editor passes SCULPT_POWER_SCALE for the
 * 5x-gentler brush.
 */
export function flattenStamp(
  x: number,
  z: number,
  radius: number,
  targetHeight: number,
  hardEdge: boolean,
  currentHeight = targetHeight,
  strength = 1,
): HeightStamp {
  return {
    x,
    z,
    radius,
    delta: currentHeight + (targetHeight - currentHeight) * strength,
    falloff: hardEdge ? 'flat' : 'smooth',
    mode: 'level',
  };
}

/**
 * Erase hit test for sculpt stamps: the index of the MOST RECENT stamp whose
 * disc contains the click point, or -1. Later stamps sit "on top", so erasing
 * peels newest-first.
 */
export function eraseStampIndex(stamps: readonly HeightStamp[], x: number, z: number): number {
  for (let i = stamps.length - 1; i >= 0; i--) {
    const s = stamps[i];
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz <= s.radius * s.radius) return i;
  }
  return -1;
}

/**
 * Erase hit test for placements: the index of the NEAREST placement within
 * `radius` of the click point, or -1.
 */
export function erasePlacementIndex(
  placements: readonly AssetPlacement[],
  x: number,
  z: number,
  radius: number,
): number {
  let best = -1;
  let bestD2 = radius * radius;
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const dx = x - p.x;
    const dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= bestD2) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}

/** World-space bounds of one stamp's influence (for region-local remeshing). */
export function stampRegion(stamp: HeightStamp): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  return {
    minX: stamp.x - stamp.radius,
    minZ: stamp.z - stamp.radius,
    maxX: stamp.x + stamp.radius,
    maxZ: stamp.z + stamp.radius,
  };
}

/** Union of two regions (accumulating a stroke's dirty bounds). */
export function unionRegion(
  a: { minX: number; minZ: number; maxX: number; maxZ: number } | null,
  b: { minX: number; minZ: number; maxX: number; maxZ: number },
): { minX: number; minZ: number; maxX: number; maxZ: number } {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}
