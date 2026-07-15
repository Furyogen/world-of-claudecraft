// Converts the overworld scenery records that makers most often need to adjust
// into ordinary map placements. They then use the editor's existing selection,
// transform, undo, collision, and export pipeline instead of renderer-only props.

import { ASSET_COLLISION } from '../sim/asset_collision.generated';
import { BUILTIN_WORLD } from '../sim/data';
import { MAX_PLACEMENTS, type MapPlacement } from '../sim/map_doc';
import { hash2 } from '../sim/rng';
import type { ZonePropsDef } from '../sim/types';
import { terrainHeight } from '../sim/world';

const NORMALIZED_HEIGHT = 2.2;

function normalizedSize(assetId: string): { x: number; y: number; z: number } {
  const boxes = ASSET_COLLISION[assetId] ?? [];
  if (boxes.length === 0)
    return { x: NORMALIZED_HEIGHT, y: NORMALIZED_HEIGHT, z: NORMALIZED_HEIGHT };
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const box of boxes) {
    minX = Math.min(minX, box.x - box.hx);
    minY = Math.min(minY, box.y - box.hy);
    minZ = Math.min(minZ, box.z - box.hz);
    maxX = Math.max(maxX, box.x + box.hx);
    maxY = Math.max(maxY, box.y + box.hy);
    maxZ = Math.max(maxZ, box.z + box.hz);
  }
  return {
    x: Math.max(0.1, maxX - minX),
    y: Math.max(0.1, maxY - minY),
    z: Math.max(0.1, maxZ - minZ),
  };
}

function fittedPlacement(
  assetId: string,
  name: string,
  x: number,
  z: number,
  rotY: number,
  width: number,
  height: number,
  depth: number,
  y = 0,
  worldPropKind?: 'fence' | 'inn',
): MapPlacement {
  const size = normalizedSize(assetId);
  const scale = height / size.y;
  const placement: MapPlacement = {
    assetId,
    name,
    x,
    z,
    y,
    rotY,
    scale,
    scaleX: width / (size.x * scale),
    scaleZ: depth / (size.z * scale),
    collide: true,
    collisionMode: 'baked',
  };
  if (worldPropKind) {
    placement.worldPropKind = worldPropKind;
    placement.worldPropWidth = size.x;
    placement.worldPropDepth = size.z;
  }
  return placement;
}

function keyRand(key: number, stream: number): number {
  return hash2(Math.round(key * 97), stream * 7919, 0x9e3779);
}

function offsetAlongLocalZ(
  x: number,
  z: number,
  rotY: number,
  localZ: number,
): { x: number; z: number } {
  return { x: x + Math.sin(rotY) * localZ, z: z + Math.cos(rotY) * localZ };
}

/** Expand every built-in building and fence module into a selectable placement. */
export function worldMajorPropPlacements(props: ZonePropsDef, seed = 20061): MapPlacement[] {
  const out: MapPlacement[] = [];
  for (let index = 0; index < props.buildings.length; index++) {
    const building = props.buildings[index];
    const label = `Building ${index + 1}`;
    if (building.kind === 'chapel') {
      const towerPos = offsetAlongLocalZ(building.x, building.z, building.rot, -0.75);
      out.push(
        fittedPlacement(
          'props/bell_tower',
          `${label} tower`,
          towerPos.x,
          towerPos.z,
          building.rot,
          building.w * 0.98,
          10.6,
          building.d * 0.72,
          -0.12,
        ),
      );
      const hallZ = building.d / 2 - 1.62;
      const hallPos = offsetAlongLocalZ(building.x, building.z, building.rot, hallZ);
      out.push(
        fittedPlacement(
          'props/house_3',
          `${label} hall`,
          hallPos.x,
          hallPos.z,
          building.rot,
          building.w * 0.9,
          2.5,
          3.2,
          -0.12,
        ),
      );
      continue;
    }

    let assetId = 'props/inn';
    let height = 7.6;
    let rotY = building.rot;
    if (building.kind === 'house') {
      const pool = ['props/house_1', 'props/house_2', 'props/blacksmith'] as const;
      const key = building.x * 13.7 + building.z * 3.1;
      assetId = pool[Math.floor(keyRand(key, 3) * 0.999 * pool.length)];
      height = assetId === 'props/blacksmith' ? 6.6 : assetId === 'props/house_2' ? 7.6 : 8;
      // The static prop renderer bakes this corrective yaw into house_2.
      if (assetId === 'props/house_2') rotY -= Math.PI / 2;
    }
    out.push(
      fittedPlacement(
        assetId,
        label,
        building.x,
        building.z,
        rotY,
        building.w,
        height,
        building.d,
        -0.12,
        building.kind === 'inn' ? 'inn' : undefined,
      ),
    );
  }

  let fenceIndex = 0;
  for (const fence of props.fences) {
    const length = Math.hypot(fence.x2 - fence.x1, fence.z2 - fence.z1);
    if (length <= 0) continue;
    const modules = Math.max(1, Math.round(length / 2.35));
    const yaw = Math.atan2(-(fence.z2 - fence.z1), fence.x2 - fence.x1);
    for (let i = 0; i < modules; i++) {
      const t = (i + 0.5) / modules;
      const x = fence.x1 + (fence.x2 - fence.x1) * t;
      const z = fence.z1 + (fence.z2 - fence.z1) * t;
      const x0 = fence.x1 + (fence.x2 - fence.x1) * (i / modules);
      const z0 = fence.z1 + (fence.z2 - fence.z1) * (i / modules);
      const x1 = fence.x1 + (fence.x2 - fence.x1) * ((i + 1) / modules);
      const z1 = fence.z1 + (fence.z2 - fence.z1) * ((i + 1) / modules);
      const g0 = terrainHeight(x0, z0, seed);
      const g1 = terrainHeight(x1, z1, seed);
      const centerGround = terrainHeight(x, z, seed);
      const pitch = Math.atan2(g1 - g0, length / modules);
      const placement = fittedPlacement(
        'props/fence',
        `Fence ${++fenceIndex}`,
        x,
        z,
        yaw,
        length / modules,
        2.9,
        0.35,
        (g0 + g1) / 2 - centerGround - 0.05,
        'fence',
      );
      placement.rotZ = pitch;
      out.push(placement);
    }
  }
  return out;
}

/** Keep the rest of the shipped scenery, but suppress converted duplicates. */
export function withoutMajorWorldProps(props: ZonePropsDef): ZonePropsDef {
  return { ...props, buildings: [], fences: [] };
}

/** One-time in-memory upgrade for legacy world maps whose scenery was still
 * renderer-owned. Explicit empty/converted modes are already authoritative. */
export function promoteMajorWorldProps(map: {
  placements: MapPlacement[];
  propsMode?: 'empty' | 'editable-major';
  presentationMode?: string;
  content: { zones: readonly { id: string }[] };
  meta: { seed: number };
}): boolean {
  if (map.propsMode !== undefined) return false;
  if (map.presentationMode !== undefined) return false;
  const builtinIds = BUILTIN_WORLD.zones.map((zone) => zone.id);
  if (
    map.content.zones.length !== builtinIds.length ||
    !map.content.zones.every((zone, index) => zone.id === builtinIds[index])
  ) {
    return false;
  }
  const converted = worldMajorPropPlacements(BUILTIN_WORLD.props, map.meta.seed);
  if (map.placements.length + converted.length > MAX_PLACEMENTS) return false;
  map.placements.push(...converted);
  map.propsMode = 'editable-major';
  return true;
}
