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
const MIN_AXIS_SCALE = 0.05;

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

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
    rotY: cleanZero(rotY),
    scale,
    scaleX: Math.max(MIN_AXIS_SCALE, width / (size.x * scale)),
    scaleZ: Math.max(MIN_AXIS_SCALE, depth / (size.z * scale)),
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

function propRand(x: number, z: number, stream: number): number {
  return hash2(Math.round(x * 37), Math.round(z * 37) + stream * 7919, 0x517cc1);
}

function localPoint(
  x: number,
  z: number,
  rotY: number,
  localX: number,
  localZ: number,
): { x: number; z: number } {
  return {
    x: x + localX * Math.cos(rotY) + localZ * Math.sin(rotY),
    z: z - localX * Math.sin(rotY) + localZ * Math.cos(rotY),
  };
}

function addFitted(
  out: MapPlacement[],
  assetId: string,
  name: string,
  x: number,
  z: number,
  rotY: number,
  width: number,
  height: number,
  depth: number,
  y = 0,
): MapPlacement {
  const placement = fittedPlacement(assetId, name, x, z, rotY, width, height, depth, y);
  out.push(placement);
  return placement;
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
      placement.rotZ = cleanZero(pitch);
      out.push(placement);
    }
  }

  props.stalls.forEach((stall, index) => {
    const assetId = index % 2 === 0 ? 'props/market_stand_1' : 'props/market_stand_2';
    addFitted(
      out,
      assetId,
      `Market stall ${index + 1}`,
      stall.x,
      stall.z,
      stall.rot,
      3.1,
      2.6,
      2.5,
      -0.06,
    );
    const addStallProp = (
      propAssetId: string,
      label: string,
      localX: number,
      localZ: number,
      localYaw: number,
      width: number,
      height: number,
      depth: number,
    ): void => {
      const point = localPoint(stall.x, stall.z, stall.rot, localX, localZ);
      addFitted(
        out,
        propAssetId,
        `Market stall ${index + 1} ${label}`,
        point.x,
        point.z,
        stall.rot + localYaw,
        width,
        height,
        depth,
      );
    };
    if (stall.smithy) {
      addStallProp('props/anvil', 'anvil', 1.35, 1.15, 0.9, 1.1, 0.9, 1.1);
      addStallProp('props/weapon_stand', 'weapon rack', -1.45, 0.6, 0.5 + Math.PI, 1.2, 2, 0.7);
    } else {
      addStallProp(
        'props/farmcrate_apple',
        'produce crate',
        1.3,
        1.05,
        keyRand(stall.x * 7.7 + stall.z * 2.3, 2) * Math.PI,
        1,
        0.8,
        1,
      );
      addStallProp(
        'props/barrel',
        'barrel',
        -1.35,
        0.85,
        keyRand(stall.x * 7.7 + stall.z * 2.3, 3) * Math.PI,
        0.8,
        1.25,
        0.8,
      );
    }
  });

  props.wells.forEach((well, index) => {
    addFitted(
      out,
      'props/well',
      `Well ${index + 1}`,
      well.x,
      well.z,
      propRand(well.x, well.z, 1) * Math.PI,
      2.6,
      3.6,
      2.9,
      -0.1,
    );
  });

  props.graveyards.forEach((graveyard, graveyardIndex) => {
    const kinds = [
      'props/gravestone_round',
      'props/gravestone_cross',
      'props/gravestone_bevel',
      'props/gravestone_decorative',
    ] as const;
    for (let index = 0; index < 6; index++) {
      const x = graveyard.x + (index % 3) * 2.2;
      const z = graveyard.z + Math.floor(index / 3) * 2.6;
      const scale = 2 + keyRand(x * 3 + z, 4) * 0.5;
      const placement = addFitted(
        out,
        kinds[index % kinds.length],
        `Graveyard ${graveyardIndex + 1} headstone ${index + 1}`,
        x,
        z,
        index * 0.4 + (propRand(x, z, 2) - 0.5) * 0.5,
        0.75 * scale,
        1.15 * scale,
        0.45 * scale,
        -0.06,
      );
      placement.rotX = (propRand(x, z, 1) - 0.5) * 0.2;
      placement.rotZ = (propRand(x, z, 3) - 0.5) * 0.22;
    }
  });

  props.campfires.forEach(([x, z], index) => {
    const placement = addFitted(
      out,
      'props/bonfire',
      `Campfire ${index + 1}`,
      x,
      z,
      propRand(x, z, 1) * Math.PI * 2,
      1.7,
      1.35,
      1.7,
      -0.05,
    );
    placement.fire = true;
  });

  props.tents.forEach((tent, index) => {
    const assetId = propRand(tent.x, tent.z, 2) < 0.55 ? 'props/tent_open' : 'props/tent_small';
    const placement = addFitted(
      out,
      assetId,
      `Camp tent ${index + 1}`,
      tent.x,
      tent.z,
      tent.rot,
      3 * tent.scale,
      3.4 * tent.scale,
      3 * tent.scale,
      -0.06,
    );
    placement.rotX = (propRand(tent.x, tent.z, 3) - 0.5) * 0.06;
    placement.rotZ = (propRand(tent.x, tent.z, 4) - 0.5) * 0.06;
  });

  props.crates.forEach(([x, z], index) => {
    const barrel = index % 3 === 2;
    addFitted(
      out,
      barrel ? 'props/barrel' : 'props/crate_wooden',
      `Camp ${barrel ? 'barrel' : 'crate'} ${index + 1}`,
      x,
      z,
      ((x * 13 + z * 7) % 1) * Math.PI,
      barrel ? 0.85 : 1,
      barrel ? 1.3 : 1,
      barrel ? 0.85 : 1,
      -0.04,
    );
  });

  const hutCenter = props.mudHuts.reduce(
    (center, [x, z]) => ({
      x: center.x + x / props.mudHuts.length,
      z: center.z + z / props.mudHuts.length,
    }),
    { x: 0, z: 0 },
  );
  props.mudHuts.forEach(([x, z], index) => {
    const yaw = Math.atan2(hutCenter.x - x, hutCenter.z - z);
    const hut = addFitted(
      out,
      'props/mushroom_red',
      `Mud hut ${index + 1}`,
      x,
      z,
      yaw,
      4.2,
      12.5,
      4.2,
      -0.15,
    );
    hut.rotX = (propRand(x, z, 13) - 0.5) * 0.1;
    hut.rotZ = (propRand(x, z, 14) - 0.5) * 0.1;
    const clusterAngle = yaw + 0.9 + propRand(x, z, 18);
    addFitted(
      out,
      'props/mushroom_tan',
      `Mud hut ${index + 1} toadstools`,
      x + Math.sin(clusterAngle) * 1.7,
      z + Math.cos(clusterAngle) * 1.7,
      propRand(x, z, 19) * Math.PI * 2,
      1.1,
      1.6,
      1.1,
      -0.05,
    );
  });

  props.ruinRings.forEach((ring, ringIndex) => {
    for (let index = 0; index < ring.columns; index++) {
      const angle = (index / ring.columns) * Math.PI * 2;
      const x = ring.x + Math.sin(angle) * ring.ringR;
      const z = ring.z + Math.cos(angle) * ring.ringR;
      const intact = index % 4 === 1;
      const height = intact ? 3.5 + (index % 2) * 0.5 : 1.7 + (index % 3) * 0.85;
      const placement = addFitted(
        out,
        intact ? 'props/column' : 'props/column_broken',
        `Ruin ${ringIndex + 1} column ${index + 1}`,
        x,
        z,
        propRand(x, z, 8) * Math.PI,
        1.2,
        height,
        1.2,
        -0.1,
      );
      placement.rotZ = (index % 3 === 0 ? 0.13 : 0.03) * (index % 2 ? 1 : -1);
    }
    addFitted(
      out,
      'props/statue_head',
      `Ruin ${ringIndex + 1} statue head`,
      ring.x - 2.4,
      ring.z - 2.7,
      propRand(ring.x, ring.z, 30) * Math.PI * 2,
      2.2,
      2,
      2.2,
      -0.55,
    );
    addFitted(
      out,
      'props/statue_block',
      `Ruin ${ringIndex + 1} statue block`,
      ring.x + 0.1,
      ring.z - 4.3,
      propRand(ring.x, ring.z, 31) * Math.PI,
      2,
      1.5,
      2,
      -0.2,
    );
    const fallen = addFitted(
      out,
      'props/column',
      `Ruin ${ringIndex + 1} fallen column`,
      ring.x - 3.2,
      ring.z - 5.2,
      0.6,
      1.2,
      4,
      1.2,
      0.62,
    );
    fallen.rotX = Math.PI / 2 - 0.06;
  });

  props.mines.forEach((mine, mineIndex) => {
    const addMinePart = (
      assetId: string,
      label: string,
      localX: number,
      localZ: number,
      width: number,
      height: number,
      depth: number,
      localYaw = 0,
      y = 0,
    ): MapPlacement => {
      const point = localPoint(mine.x, mine.z, mine.rot, localX, localZ);
      return addFitted(
        out,
        assetId,
        `Mine ${mineIndex + 1} ${label}`,
        point.x,
        point.z,
        mine.rot + localYaw,
        width,
        height,
        depth,
        y,
      );
    };
    addMinePart('props/timber_pillar', 'left post', -1.45, 0, 0.7, 3.6, 0.7);
    addMinePart('props/timber_pillar', 'right post', 1.45, 0, 0.7, 3.6, 0.7);
    const lintel = addMinePart('props/timber_pillar', 'lintel', 0, 0, 0.7, 4.8, 0.7, 0, 3.4);
    lintel.rotZ = -Math.PI / 2;
    const mound: readonly [number, number, number, number][] = [
      [0, 1.4, -3, 2.6],
      [-2.7, 0.3, -2, 1.9],
      [2.7, 0.35, -2.2, 2],
      [-1.6, 0.1, -1, 1.2],
      [1.8, 0.1, -0.9, 1.1],
      [0.3, 3, -4.2, 2.3],
      [-1.4, 1.6, -3.4, 1.8],
      [1.5, 1.7, -3.2, 1.7],
      [0, 0.2, -1.6, 1.4],
    ];
    const rockKinds = [
      'props/rock_tall_a',
      'props/rock_large_d',
      'props/rock_tall_h',
      'props/rock_large_f',
    ] as const;
    mound.forEach(([x, y, z, radius], index) => {
      const rock = addMinePart(
        rockKinds[(index * 2 + 1) % rockKinds.length],
        `mound rock ${index + 1}`,
        x,
        z,
        radius * 2,
        radius * 1.7,
        radius * 2,
        propRand(mine.x, mine.z, index + 70) * Math.PI,
        y,
      );
      rock.rotX = (propRand(mine.x, mine.z, index + 80) - 0.5) * 0.5;
      rock.rotZ = (propRand(mine.x, mine.z, index + 90) - 0.5) * 0.5;
    });
    addMinePart('props/cart', 'ore cart', 2.8, 1.6, 2.2, 1.5, 3.2, 0.5);
    addMinePart('props/ore_rocks', 'ore', 2.75, 1.55, 1.4, 1.2, 1.4, 0.9, 0.75);
    addMinePart('props/lantern_wall', 'lantern', 1.45, 0.28, 0.45, 1.1, 0.45, 0, 2);
  });

  props.docks.forEach((dock, dockIndex) => {
    for (let index = 0; index < 4; index++) {
      const point = localPoint(dock.x, dock.z, dock.rot, 0, -index * 2.2);
      addFitted(
        out,
        'props/dock_platform',
        `Dock ${dockIndex + 1} section ${index + 1}`,
        point.x,
        point.z,
        dock.rot,
        3.2,
        1.25,
        2.3,
      );
    }
    if (dock.hutLocal.hw > 0 && dock.hutLocal.hd > 0) {
      const hut = localPoint(dock.x, dock.z, dock.rot, dock.hutLocal.x, dock.hutLocal.z);
      addFitted(
        out,
        'props/house_3',
        `Dock ${dockIndex + 1} hut`,
        hut.x,
        hut.z,
        dock.rot,
        dock.hutLocal.hw * 2,
        2.6,
        dock.hutLocal.hd * 2,
      );
    }
    const boat = localPoint(dock.x, dock.z, dock.rot, 2.4, -5);
    addFitted(
      out,
      'props/rowboat',
      `Dock ${dockIndex + 1} rowboat`,
      boat.x,
      boat.z,
      dock.rot + 0.5,
      2.4,
      0.9,
      4.8,
      0.18,
    );
    const clutter: readonly [string, string, number, number, number, number, number][] = [
      ['props/barrel', 'barrel 1', 0.55, -0.55, 0.8, 1.2, 0.8],
      ['props/barrel', 'barrel 2', 1.45, 0.9, 0.9, 1.4, 0.9],
      ['props/crate_wooden', 'crate', -0.6, -2.2, 0.9, 0.9, 0.9],
    ];
    clutter.forEach(([assetId, label, localX, localZ, width, height, depth], index) => {
      const point = localPoint(dock.x, dock.z, dock.rot, localX, localZ);
      addFitted(
        out,
        assetId,
        `Dock ${dockIndex + 1} ${label}`,
        point.x,
        point.z,
        dock.rot + keyRand(dock.x * 3.3 + dock.z * 1.7, index + 5) * Math.PI,
        width,
        height,
        depth,
        index === 1 ? 0 : 0.52,
      );
    });
  });

  (props.delveMarkers ?? []).forEach((marker, index) => {
    const drowned = marker.delveId === 'drowned_litany';
    const faceSign = drowned ? -1 : 1;
    addFitted(
      out,
      'dungeon/delve_entrance_2',
      `Delve ${marker.delveId || index + 1}`,
      marker.x,
      marker.z - faceSign * 4,
      drowned ? Math.PI : 0,
      10,
      12,
      4,
    );
  });

  (props.greatTrees ?? []).forEach((tree, index) => {
    addFitted(
      out,
      'foliage/twisted_1',
      `Great tree ${index + 1}`,
      tree.x,
      tree.z,
      0.8,
      tree.r * 4,
      tree.r * 12,
      tree.r * 4,
      -0.2,
    );
  });
  return out;
}

/** Keep the rest of the shipped scenery, but suppress converted duplicates. */
export function withoutMajorWorldProps(props: ZonePropsDef): ZonePropsDef {
  return { ...props, buildings: [], fences: [] };
}

/** Suppress every renderer-owned prop after it has been promoted to placements. */
export function withoutEditableWorldProps(props: ZonePropsDef): ZonePropsDef {
  return {
    ...props,
    buildings: [],
    wells: [],
    stalls: [],
    mines: [],
    docks: [],
    tents: [],
    crates: [],
    campfires: [],
    mudHuts: [],
    ruinRings: [],
    fences: [],
    graveyards: [],
    delveMarkers: [],
    greatTrees: [],
  };
}

/** One-time in-memory upgrade for legacy world maps whose scenery was still
 * renderer-owned. Explicit empty/converted modes are already authoritative. */
export function promoteMajorWorldProps(map: {
  placements: MapPlacement[];
  propsMode?: 'empty' | 'editable-major' | 'editable-all';
  presentationMode?: string;
  content: { zones: readonly { id: string }[] };
  meta: { seed: number };
}): boolean {
  if (map.propsMode === 'empty' || map.propsMode === 'editable-all') return false;
  if (map.presentationMode !== undefined) return false;
  const builtinIds = BUILTIN_WORLD.zones.map((zone) => zone.id);
  if (
    map.content.zones.length !== builtinIds.length ||
    !map.content.zones.every((zone, index) => zone.id === builtinIds[index])
  ) {
    return false;
  }
  const sourceProps =
    map.propsMode === 'editable-major'
      ? { ...BUILTIN_WORLD.props, buildings: [], fences: [] }
      : BUILTIN_WORLD.props;
  const converted = worldMajorPropPlacements(sourceProps, map.meta.seed);
  if (map.placements.length + converted.length > MAX_PLACEMENTS) return false;
  map.placements.push(...converted);
  map.propsMode = 'editable-all';
  return true;
}
