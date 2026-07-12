// Dungeon interior layouts as plain numbers — the single source of truth for
// BOTH the visual module placement (src/render/dungeon.ts builds KayKit kit
// pieces from this) and the interior collision sets (src/sim/colliders.ts
// derives CRYPT_COLLIDERS/SANCTUM_COLLIDERS via layoutColliders). This kills
// the old hand-mirroring between renderer geometry and collider literals.
// Sim layer: no three.js imports.
import type { Collider } from './colliders';
import {
  type AuthoredDecor,
  type AuthoredDoor,
  type AuthoredRoom,
  authoredDecorColliders,
  authoredWallSegments,
} from './dungeon_rooms';

// Shared structural constants (instance-local coordinates, y up, z into the
// dungeon). Values are frozen gameplay contracts: mob spawns and pathing
// assume these exact footprints.
export const DUNGEON_WALL_X = 23; // side wall centreline (|x|)
export const DUNGEON_WALL_HW = 1; // wall half thickness
/** Walkable half-width inside side-wall colliders (instance-local x). */
export const DUNGEON_WALK_HALF_X = DUNGEON_WALL_X - DUNGEON_WALL_HW;
export const DUNGEON_END_WALL_HW = 24; // front/back wall half width
export const PILLAR_COLLIDER_R = 1.0; // centre-aisle pillar obstacle radius
export const TOMB_HW = 1.1; // wall-side obstacle (sarcophagus/cargo) half extents
export const TOMB_HD = 2.1;
export const DUNGEON_WALL_HEIGHT = 8; // visual module height (2x KayKit 4u walls)

export interface GridPoint {
  x: number;
  z: number;
}

export interface WallStub {
  x: number;
  z: number;
  hw: number;
  hd: number;
}

export interface DungeonLayout {
  /** front wall centreline (entrance end) */
  zMin: number;
  /** back wall centreline (boss end) */
  zMax: number;
  /** side-wall collider slab (matches the legacy hand-authored extents) */
  sideWallZ: number;
  sideWallHd: number;
  /** centre-aisle pillar obstacles; torches mount on these */
  pillars: GridPoint[];
  /** wall-side obstacles — OBB TOMB_HW x TOMB_HD at rot 0 */
  tombs: GridPoint[];
  /** chamber-waist wall stubs (sanctum's three-chamber structure) */
  stubs: WallStub[];
  /** boss dais — walkable, deliberately NO collider */
  dais: { x: number; z: number; r: number };
  /** Optional room width override for oversized rooms. Defaults to the classic crypt width. */
  wallX?: number;
  endWallHw?: number;
  floorHalfX?: number;
  /** entrance archway z position; renderer places gate props here when set */
  doorZ?: number;
  /** floor scatter positions, renderer places props here AND collision circles back them */
  clutter?: GridPoint[];
  /** Room shell outline (CCW, simple, star-shaped from `shellPole`), instance-local.
   * When present, render/collision derive the room's walls and floor mask from this
   * polygon instead of the rectangular wallX/zMin/zMax shell. */
  shellPolygon?: Array<{ x: number; z: number }>;
  /** Star-shaping pole paired with `shellPolygon` (see geometry2d.polygonIsStarShaped). */
  shellPole?: { x: number; z: number };
  /** Authored axis-aligned room graph used by bespoke dungeon interiors. */
  rooms?: AuthoredRoom[];
  /** Traversable openings cut from the authored room walls. */
  doors?: AuthoredDoor[];
  /** Shared visual placement data with optional movement collision radii. */
  decor?: AuthoredDecor[];
}

function grid(zFrom: number, zTo: number, zStep: number, xs: readonly number[]): GridPoint[] {
  const out: GridPoint[] = [];
  for (let z = zFrom; z <= zTo; z += zStep) {
    for (const x of xs) out.push({ x, z });
  }
  return out;
}

// The Hollow Crypt / Sunken Bastion room (both DungeonDef.interior 'crypt'):
// one long nave, z -19..112, pillar rows at +-14, sarcophagi at +-19.
export const CRYPT_LAYOUT: DungeonLayout = {
  zMin: -19,
  zMax: 112,
  sideWallZ: 47,
  sideWallHd: 66,
  pillars: grid(10, 100, 15, [-14, 14]),
  tombs: grid(16, 92, 19, [-19, 19]),
  stubs: [],
  dais: { x: 0, z: 96, r: 9.5 },
};

// Gravewyrm Sanctum: a stretched three-chamber crypt (z -19..158) with
// narrowed waists at z 67/115 leaving a ~10u centre passage at |x| <= 5.
export const SANCTUM_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 55, 85, 100, 125, 140]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 67, hw: 9, hd: 5 }); // Boneworks -> Korgath's Hall
    stubs.push({ x: sx, z: 115, hw: 9, hd: 3 }); // Ritual Vault -> Wyrm's Hollow
  }
  return {
    zMin: -19,
    zMax: 158,
    sideWallZ: 69.5,
    sideWallHd: 89,
    pillars,
    tombs: [],
    stubs,
    dais: { x: 0, z: 146, r: 11.5 },
  };
})();

// Nythraxis' Abandoned Crypt raid room: a long dark nave ending in one large
// fighting arena. It stays within the shared wall-width contract, but leaves the
// central floor open so ten players can spread, stack, and reach three wardstones.
export const NYTHRAXIS_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [18, 38, 60, 82, 106]) {
    for (const x of [-90, -45, 45, 90]) pillars.push({ x, z });
  }
  return {
    zMin: -19,
    zMax: 126,
    sideWallZ: 53.5,
    sideWallHd: 73,
    wallX: 230,
    endWallHw: 231,
    floorHalfX: 228,
    pillars,
    tombs: [
      { x: -210, z: 20 },
      { x: 210, z: 20 },
      { x: -210, z: 42 },
      { x: 210, z: 42 },
      { x: -210, z: 64 },
      { x: 210, z: 64 },
    ],
    stubs: [],
    dais: { x: 0, z: 96, r: 13.5 },
  };
})();

// The Drowned Temple (interior 'temple'): a two-part flooded temple — a long
// antechamber, a single chamber-waist arch at z 66 (10u centre passage), then
// the moon-sanctum with Ysolei's great altar dais. Side walls at |x|=23 like
// the crypt so the KayKit wall modules fit unchanged; wall-side slots carry
// drowned reliquary altars instead of sarcophagi.
export const TEMPLE_LAYOUT: DungeonLayout = (() => {
  const pillars: GridPoint[] = [];
  for (const z of [10, 25, 40, 55, 80, 95, 110]) {
    for (const x of [-14, 14]) pillars.push({ x, z });
  }
  const stubs: WallStub[] = [];
  for (const sx of [-14, 14]) {
    stubs.push({ x: sx, z: 66, hw: 9, hd: 4 }); // antechamber -> moon-sanctum
  }
  return {
    zMin: -19,
    zMax: 132,
    sideWallZ: 56.5,
    sideWallHd: 75.5,
    pillars,
    tombs: grid(18, 40, 22, [-19, 19]), // reliquary altars hugging the antechamber walls
    stubs,
    dais: { x: 0, z: 116, r: 10.5 },
  };
})();

// Infernal Abyss: a branching endgame descent through a lava maze and forge,
// across the Maw bridge, into the Heart Cairn. Side rooms remain optional for
// progression while their doors and collisions use the same authored source.
export const INFERNAL_ABYSS_LAYOUT: DungeonLayout = {
  zMin: -25,
  zMax: 219,
  sideWallZ: 97,
  sideWallHd: 123,
  wallX: 70,
  endWallHw: 70,
  floorHalfX: 70,
  pillars: [],
  tombs: [],
  stubs: [],
  dais: { x: 0, z: 200, r: 18 },
  rooms: [
    { id: 'ashen_descent_entrance', x0: -18, x1: 18, z0: -25, z1: 9 },
    { id: 'chainscar_descent', x0: -8, x1: 8, z0: 9, z1: 27 },
    { id: 'lava_maze', x0: -34, x1: 34, z0: 27, z1: 67 },
    { id: 'lost_armory', x0: -62, x1: -34, z0: 35, z1: 59 },
    { id: 'infernal_forge', x0: -24, x1: 24, z0: 67, z1: 97 },
    { id: 'gladiator_pit', x0: 24, x1: 66, z0: 67, z1: 97 },
    { id: 'maw_approach', x0: -10, x1: 10, z0: 97, z1: 113 },
    { id: 'maw_bridge', x0: -10, x1: 10, z0: 113, z1: 155 },
    { id: 'heart_cairn_vestibule', x0: -12, x1: 12, z0: 155, z1: 173 },
    { id: 'heart_cairn_boss_arena', x0: -34, x1: 34, z0: 173, z1: 219 },
  ],
  doors: [
    { x: 0, z: -25, hw: 4, hd: 1 },
    { x: 0, z: 9, hw: 4, hd: 1 },
    { x: 0, z: 27, hw: 4, hd: 1 },
    { x: -34, z: 47, hw: 1, hd: 4 },
    { x: 0, z: 67, hw: 10, hd: 1 },
    { x: 24, z: 82, hw: 1, hd: 5 },
    { x: 0, z: 97, hw: 4, hd: 1 },
    { x: 0, z: 113, hw: 3.5, hd: 1 },
    { x: 0, z: 155, hw: 3.5, hd: 1 },
    { x: 0, z: 173, hw: 5, hd: 1 },
  ],
  decor: [
    { key: 'lava_brazier', x: -12, z: -13, yaw: 0, r: 0.9 },
    { key: 'lava_brazier', x: 12, z: -13, yaw: Math.PI, r: 0.9 },
    { key: 'chained_demon_obelisk', x: -25, z: 37, yaw: 0.2, r: 1.4 },
    { key: 'chained_demon_obelisk', x: 25, z: 57, yaw: -0.2, r: 1.4 },
    { key: 'lava_pool', x: -15, z: 50, yaw: 0.1, scale: 1.5 },
    { key: 'lava_pool', x: 16, z: 42, yaw: -0.2, scale: 1.35 },
    { key: 'lava_fissure', x: 0, z: 58, yaw: Math.PI / 2, scale: 1.7 },
    { key: 'lost_armory_weapon_rack', x: -54, z: 42, yaw: Math.PI / 2, r: 1.2 },
    { key: 'lost_armory_weapon_rack', x: -54, z: 52, yaw: Math.PI / 2, r: 1.2 },
    { key: 'infernal_forge_anvil', x: -11, z: 82, yaw: 0.15, r: 2.2 },
    { key: 'lava_brazier', x: 11, z: 76, yaw: 0, r: 0.9 },
    { key: 'lava_brazier', x: 11, z: 90, yaw: Math.PI, r: 0.9 },
    { key: 'chained_demon_obelisk', x: 37, z: 73, yaw: 0, r: 1.4 },
    { key: 'chained_demon_obelisk', x: 58, z: 91, yaw: Math.PI, r: 1.4 },
    { key: 'lava_fissure', x: 0, z: 134, yaw: 0, scale: 2.2 },
    { key: 'lava_brazier', x: -5, z: 161, yaw: Math.PI / 2, r: 0.9 },
    { key: 'lava_brazier', x: 5, z: 161, yaw: -Math.PI / 2, r: 0.9 },
    { key: 'chained_demon_obelisk', x: -24, z: 184, yaw: 0.25, r: 1.4 },
    { key: 'chained_demon_obelisk', x: 24, z: 184, yaw: -0.25, r: 1.4 },
    { key: 'chained_demon_obelisk', x: -24, z: 210, yaw: Math.PI - 0.25, r: 1.4 },
    { key: 'chained_demon_obelisk', x: 24, z: 210, yaw: Math.PI + 0.25, r: 1.4 },
    { key: 'abyssal_heart_altar', x: 0, z: 210, yaw: Math.PI, r: 3.4 },
  ],
};

// The Ashen Coliseum (interior 'arena'): a compact, fully-enclosed square pit
// — no door, no aisle (combatants are teleported in by matchmaking). Side
// walls at |x|=23 like the crypt so the KayKit wall modules fit unchanged;
// four corner pillars carry the arena's warm torches. The dais marker only
// drives the central floor glow (the renderer skips its platform for the
// arena), so it stays a flat, obstacle-free fighting ring.
export const ARENA_LAYOUT: DungeonLayout = {
  zMin: -20,
  zMax: 24,
  sideWallZ: 2,
  sideWallHd: 23,
  pillars: [
    { x: -14, z: -10 },
    { x: 14, z: -10 },
    { x: -14, z: 14 },
    { x: 14, z: 14 },
    // Cover/parkour posts, mirrored about the centre line (z=2) so neither side
    // is favoured. They give the Fiesta something to juke around (and ranked a
    // little cover too) without crowding the spawns at z=-14 / z=18.
    { x: 0, z: -4 },
    { x: 0, z: 8 },
    { x: -9, z: -10 },
    { x: 9, z: -10 },
    { x: -9, z: 14 },
    { x: 9, z: 14 },
  ],
  tombs: [],
  // Low flanking fences along the side lanes, also mirrored about z=2.
  stubs: [
    { x: -11, z: 2, hw: 0.6, hd: 4 },
    { x: 11, z: 2, hw: 0.6, hd: 4 },
  ],
  dais: { x: 0, z: 2, r: 8 },
};

// Combatant spawn points (instance-local), at opposite ends facing each other.
export const ARENA_SPAWN_A = { x: 0, z: -14, facing: 0 }; // faces +z toward B
export const ARENA_SPAWN_B = { x: 0, z: 18, facing: Math.PI }; // faces -z toward A

// 2v2: two fighters per side, spread along x.
export const ARENA_SPAWNS_A_2v2 = [
  { x: -7, z: -14, facing: 0 },
  { x: 7, z: -14, facing: 0 },
];
export const ARENA_SPAWNS_B_2v2 = [
  { x: -7, z: 18, facing: Math.PI },
  { x: 7, z: 18, facing: Math.PI },
];

/** Interior collision set for a layout, in instance-local coordinates. */
export function layoutColliders(layout: DungeonLayout): Collider[] {
  const out: Collider[] = [];
  if (layout.rooms) {
    for (const wall of authoredWallSegments(layout.rooms, layout.doors ?? [], DUNGEON_WALL_HW)) {
      out.push({ type: 'obb', ...wall, rot: 0 });
    }
    out.push(...authoredDecorColliders(layout.decor ?? []));
    return out;
  }
  const wallX = layout.wallX ?? DUNGEON_WALL_X;
  const endWallHw = layout.endWallHw ?? DUNGEON_END_WALL_HW;
  // side walls
  for (const sx of [-wallX, wallX]) {
    out.push({
      type: 'obb',
      x: sx,
      z: layout.sideWallZ,
      hw: DUNGEON_WALL_HW,
      hd: layout.sideWallHd,
      rot: 0,
    });
  }
  // back wall, then front wall (entrance porch: chase cam fits inside)
  out.push({ type: 'obb', x: 0, z: layout.zMax, hw: endWallHw, hd: DUNGEON_WALL_HW, rot: 0 });
  out.push({ type: 'obb', x: 0, z: layout.zMin, hw: endWallHw, hd: DUNGEON_WALL_HW, rot: 0 });
  // chamber waists
  for (const s of layout.stubs)
    out.push({ type: 'obb', x: s.x, z: s.z, hw: s.hw, hd: s.hd, rot: 0 });
  // pillar obstacles
  for (const p of layout.pillars)
    out.push({ type: 'circle', x: p.x, z: p.z, r: PILLAR_COLLIDER_R });
  // wall-side obstacles (the boss dais is walkable: no collider)
  for (const t of layout.tombs)
    out.push({ type: 'obb', x: t.x, z: t.z, hw: TOMB_HW, hd: TOMB_HD, rot: 0 });
  // floor clutter props (small circle per scatter point; renderer places matching props)
  for (const c of layout.clutter ?? []) out.push({ type: 'circle', x: c.x, z: c.z, r: 0.8 });
  return out;
}
