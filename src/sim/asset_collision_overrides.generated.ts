// GENERATED from data/asset_collision_overrides.json - do not edit by hand.
// Authored per-asset collision from the editor's Collision Master tool: the
// dev server endpoint (/__collision_master/save) updates the JSON and this
// module together; scripts/gen_collision_overrides.mjs regenerates it too.
// An entry here is the asset's DEFAULT collision everywhere: authored boxes
// beat the voxel bake (asset_collision.ts), and the mode/shape stamp fresh
// placements (editor collision_defaults.ts).

import type { MapHitbox } from './map_doc';

export interface AssetCollisionOverride {
  /** Placement default: 'baked' renders the authored boxes, 'basic' a circle
   *  or square footprint, 'none' no collision. */
  mode: 'baked' | 'basic' | 'none';
  /** basic-mode footprint shape; absent = circle. */
  shape?: 'square';
  /** basic-mode radius/half-extent in model-space yards at scale 1; absent =
   *  the fitted/derived auto radius. */
  radius?: number;
  /** Authored boxes (normalized model space, optional per-box yaw). Read in
   *  'baked' mode; they replace the asset's voxel-baked set. */
  boxes?: readonly MapHitbox[];
}

export const ASSET_COLLISION_OVERRIDES: Readonly<Record<string, AssetCollisionOverride>> = {
  'biome/beach_chest': { mode: 'baked', boxes: [{ x: 0, y: 0.6539, z: 0, hx: 0.9989, hy: 0.722, hz: 0.6589 }] },
  'props/inn': { mode: 'baked', boxes: [{ x: 0.032, y: 0.9964, z: 0.0259, hx: 0.8392, hy: 1.1218, hz: 1.1131 }, { x: 0.0379, y: 0.8818, z: -0.2076, hx: 0.7152, hy: 1.1506, hz: 0.6747, ry: 0.7854 }] },
  'props/well': { mode: 'baked', boxes: [{ x: 0.3406, y: 0.8683, z: 0.047, hx: 0.8407, hy: 0.8655, hz: 0.2055, ry: 1.5908 }, { x: -0.3711, y: 0.8197, z: -0.0466, hx: 0.6889, hy: 0.8098, hz: 0.2482, ry: -1.5903 }, { x: 0.0147, y: 0.8514, z: -0.6505, hx: 0.4155, hy: 0.8446, hz: 0.1143, ry: -2.8886 }, { x: -0.0071, y: 0.8845, z: 0.6775, hx: 0.3199, hy: 0.8993, hz: 0.02, ry: -0.7036 }] },
};
