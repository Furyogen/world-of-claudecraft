// Per-asset baked collision lookup: the bridge between a placement's model
// path and its baked box set. Catalogue assets resolve into the generated
// table (scripts/assets/bake_collision.mjs); imported models ('local/<sha>' /
// 'user/<sha>' ids) resolve into the map document's own bake map, carried on
// WorldContent so playtests and exports keep their collision.

import {
  ASSET_COLLISION,
  ASSET_RAMPS,
  type BakedCollisionBox,
  type BakedCollisionRamp,
} from './asset_collision.generated';

export type { BakedCollisionBox, BakedCollisionRamp };

/**
 * The baked boxes for a placement's model path, or null when the asset has no
 * bake (procedural placements, ground-cover foliage, unknown models) - the
 * caller falls back to the legacy collide circle.
 */
export function bakedBoxesForPath(
  path: string | undefined,
  overrides?: Readonly<Record<string, readonly BakedCollisionBox[]>>,
): readonly BakedCollisionBox[] | null {
  if (!path) return null;
  const over = overrides?.[path];
  if (over && over.length > 0) return over;
  const m = /^\/models\/(.+)\.glb$/.exec(path);
  // NOTE: stairs-category assets bake an EMPTY box list on purpose (their
  // walkable deck lives in ASSET_RAMPS): [] means walk-through, null means
  // "no bake, fall back to the legacy circle".
  if (m) return ASSET_COLLISION[m[1]] ?? null;
  return null;
}

/** The walkable stairs deck for a catalogue model path, or null. */
export function bakedRampForPath(path: string | undefined): BakedCollisionRamp | null {
  if (!path) return null;
  const m = /^\/models\/(.+)\.glb$/.exec(path);
  if (m) return ASSET_RAMPS[m[1]] ?? null;
  return null;
}
