import { type Decoration, decorationKey } from '../sim/world';
import type { AssetPlacement } from './custom_map';

const PINE_VARIANTS = [1, 2, 4, 5] as const;
export const AMBIENT_TREE_EDIT_BATCH = 500;

export const ambientDecorationKey = decorationKey;

/** Pick the nearest procedural trees with stable key tie-breaking. */
export function closestAmbientTrees(
  decorations: readonly Decoration[],
  focus: { x: number; z: number },
  limit: number,
): Decoration[] {
  if (limit <= 0) return [];
  return decorations
    .filter((decoration) => decoration.kind !== 'rock')
    .map((decoration) => ({
      decoration,
      distance2: (decoration.x - focus.x) ** 2 + (decoration.z - focus.z) ** 2,
      key: decorationKey(decoration),
    }))
    .sort((a, b) => a.distance2 - b.distance2 || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(({ decoration }) => decoration);
}

function hashAt(a: number, b: number, salt: number): number {
  const value = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function treeAsset(decoration: Decoration): { assetId: string; scale: number } {
  if (decoration.kind === 'tree') {
    const variant = PINE_VARIANTS[decoration.variant % PINE_VARIANTS.length];
    return { assetId: `foliage/pine_${variant}`, scale: decoration.scale * 1.1 };
  }
  if (decoration.biome === 'marsh' || decoration.biome === 'dusk') {
    const dead = decoration.biome === 'marsh' && hashAt(decoration.x, decoration.z, 19) < 0.35;
    const variant = (decoration.variant % 3) + 1;
    return {
      assetId: `foliage/${dead ? 'dead' : 'twisted'}_${variant}`,
      scale: decoration.scale * (dead ? 0.7 : 0.5),
    };
  }
  return {
    assetId: `foliage/oak_${(decoration.variant % 5) + 1}`,
    scale: decoration.scale * 1.15,
  };
}

function rockPlacement(decoration: Decoration): AssetPlacement {
  const h1 = hashAt(decoration.x, decoration.z, 8);
  const h2 = hashAt(decoration.x, decoration.z, 9);
  const h3 = hashAt(decoration.x, decoration.z, 10);
  const scale = decoration.scale * 0.62;
  const scaleX = 0.85 + h2 * 0.5;
  const scaleZ = 0.85 + h1 * 0.45;
  const maxH = Math.max(scale * scaleX, scale * scaleZ);
  const scaleY = Math.max(decoration.scale * 0.45 * (0.75 + h3 * 0.5), 0.55 * maxH) / scale;
  return {
    assetId: `foliage/rock_${(decoration.variant % 3) + 1}`,
    x: decoration.x,
    z: decoration.z,
    rotX: (h1 - 0.5) * (maxH > 0.8 ? 0.12 : 0.26),
    rotY: decoration.variant * 1.7 + h3 * 2,
    rotZ: (h2 - 0.5) * (maxH > 0.8 ? 0.12 : 0.26),
    scale,
    scaleX,
    scaleY,
    scaleZ,
    collide: true,
  };
}

/** Convert procedural trees and rocks into ordinary selectable map placements. */
export function ambientDecorationsToPlacements(
  decorations: readonly Decoration[],
): AssetPlacement[] {
  return decorations.map((decoration) => {
    if (decoration.kind === 'rock') return rockPlacement(decoration);
    const asset = treeAsset(decoration);
    return {
      assetId: asset.assetId,
      x: decoration.x,
      z: decoration.z,
      rotY: decoration.variant * 2.1 + hashAt(decoration.x, decoration.z, 11) * Math.PI * 2,
      scale: asset.scale,
      collide: true,
    };
  });
}
