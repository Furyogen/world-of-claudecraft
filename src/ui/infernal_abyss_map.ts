// Pure, host-agnostic schematic model for the Infernal Abyss minimap. Room,
// doorway, lava, and lore positions come from the simulation's canonical
// dungeon records so the HUD cannot drift from collision or rendered geometry.

import { DUNGEONS, INSTANCE_SLOT_COUNT, instanceOrigin } from '../sim/data';
import { INFERNAL_ABYSS_LAYOUT } from '../sim/dungeon_layout';
import type { IWorld } from '../world_api';

export interface InfernalMapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InfernalMapRoom extends InfernalMapRect {
  id: string;
  boss: boolean;
}

export interface InfernalMapPoint {
  cx: number;
  cy: number;
  scale: number;
}

export interface InfernalMapHazard extends InfernalMapPoint {
  kind: 'pool' | 'fissure';
  angle: number;
}

export interface InfernalMapPlayer {
  cx: number;
  cy: number;
  angle: number;
}

export interface InfernalAbyssMapModel {
  rooms: InfernalMapRoom[];
  doors: InfernalMapRect[];
  lava: InfernalMapHazard[];
  lore: InfernalMapPoint[];
  player: InfernalMapPlayer;
}

interface InfernalBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function layoutBounds(): InfernalBounds {
  const rooms = INFERNAL_ABYSS_LAYOUT.rooms ?? [];
  if (rooms.length === 0) {
    return {
      minX: -(INFERNAL_ABYSS_LAYOUT.wallX ?? 0),
      maxX: INFERNAL_ABYSS_LAYOUT.wallX ?? 0,
      minZ: INFERNAL_ABYSS_LAYOUT.zMin,
      maxZ: INFERNAL_ABYSS_LAYOUT.zMax,
    };
  }
  return {
    minX: Math.min(...rooms.map((room) => room.x0)),
    maxX: Math.max(...rooms.map((room) => room.x1)),
    minZ: Math.min(...rooms.map((room) => room.z0)),
    maxZ: Math.max(...rooms.map((room) => room.z1)),
  };
}

const BOUNDS = layoutBounds();

/** Project instance-local coordinates into the complete dungeon schematic.
 * X is mirrored to preserve the established minimap convention. */
export function infernalAbyssLocalToCanvas(
  localX: number,
  localZ: number,
  canvasSize: number,
  pad: number,
): { cx: number; cy: number } {
  const sx = (canvasSize - pad * 2) / (BOUNDS.maxX - BOUNDS.minX);
  const sz = (canvasSize - pad * 2) / (BOUNDS.maxZ - BOUNDS.minZ);
  return {
    cx: pad + (BOUNDS.maxX - localX) * sx,
    cy: pad + (localZ - BOUNDS.minZ) * sz,
  };
}

function projectedRect(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  canvasSize: number,
  pad: number,
): InfernalMapRect {
  const topRight = infernalAbyssLocalToCanvas(x1, z0, canvasSize, pad);
  const bottomLeft = infernalAbyssLocalToCanvas(x0, z1, canvasSize, pad);
  return {
    x: topRight.cx,
    y: topRight.cy,
    w: bottomLeft.cx - topRight.cx,
    h: bottomLeft.cy - topRight.cy,
  };
}

/** Resolve the nearest canonical instance slot, matching the simulation's
 * instance-local collision lookup without depending on a concrete Sim host. */
export function infernalAbyssPlayerLocal(
  worldX: number,
  worldZ: number,
): {
  localX: number;
  localZ: number;
} {
  const dungeonIndex = DUNGEONS.infernal_abyss.index;
  let nearest = instanceOrigin(dungeonIndex, 0);
  let nearestDistance = Math.abs(worldZ - nearest.z);
  for (let slot = 1; slot < INSTANCE_SLOT_COUNT; slot++) {
    const candidate = instanceOrigin(dungeonIndex, slot);
    const distance = Math.abs(worldZ - candidate.z);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return { localX: worldX - nearest.x, localZ: worldZ - nearest.z };
}

/** Build the complete static schematic plus the live player arrow. */
export function infernalAbyssMapModel(
  world: IWorld,
  canvasSize: number,
  pad: number,
): InfernalAbyssMapModel {
  const rooms = (INFERNAL_ABYSS_LAYOUT.rooms ?? []).map((room) => ({
    id: room.id,
    boss: room.id.includes('boss_arena'),
    ...projectedRect(room.x0, room.x1, room.z0, room.z1, canvasSize, pad),
  }));
  const doors = (INFERNAL_ABYSS_LAYOUT.doors ?? []).map((door) =>
    projectedRect(
      door.x - door.hw,
      door.x + door.hw,
      door.z - door.hd,
      door.z + door.hd,
      canvasSize,
      pad,
    ),
  );
  const lava = (INFERNAL_ABYSS_LAYOUT.decor ?? [])
    .filter((decor) => decor.key === 'lava_pool' || decor.key === 'lava_fissure')
    .map((decor) => ({
      ...infernalAbyssLocalToCanvas(decor.x, decor.z, canvasSize, pad),
      scale: decor.scale ?? 1,
      kind: decor.key === 'lava_pool' ? ('pool' as const) : ('fissure' as const),
      angle: -decor.yaw,
    }));
  const lore = (DUNGEONS.infernal_abyss.objects ?? []).map((object) => ({
    ...infernalAbyssLocalToCanvas(object.x, object.z, canvasSize, pad),
    scale: 1,
  }));
  const local = infernalAbyssPlayerLocal(world.player.pos.x, world.player.pos.z);
  return {
    rooms,
    doors,
    lava,
    lore,
    player: {
      ...infernalAbyssLocalToCanvas(local.localX, local.localZ, canvasSize, pad),
      angle: -world.player.facing,
    },
  };
}
