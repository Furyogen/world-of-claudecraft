// Zone 4 — Atlantis (levels 15-20). A drowned city sealed under a singing
// glass dome on the abyssal shelf north of Thornpeak. No road leads here: the
// trench wall at the zone seam is sheer, and the only ways in or out are the
// Tidegate portal pads (see PORTAL_PADS below and Sim.updatePortalPadTriggers).
// The city is a safe, shared town — three lamplit terraces under the dome —
// while the flooded Kelpwarden Annex on its east flank is the one place the
// sea gets in: a swimmable kelp garden where the dome's breach lets hostile
// sea-beasts nest. Everything outside the glass is deep ocean, unreachable on
// foot by design (the dome colliders have no seaward gap).
//
// Layout numbers here are load-bearing: src/sim/world.ts shapes the terrain
// (terraces, annex bowl, grotto island, trench seal) from ATLANTIS_LAYOUT, and
// src/sim/colliders.ts builds the dome glass from ATLANTIS_PROPS.domes. Keep
// them in sync through this one module.

import type {
  CampDef,
  GroundObjectDef,
  MobTemplate,
  NpcDef,
  PortalPadDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';

// ---------------------------------------------------------------------------
// Shared layout constants — the single source for terrain + colliders + spawns
// ---------------------------------------------------------------------------

export const ATLANTIS_LAYOUT = {
  /** zone band */
  zMin: 900,
  zMax: 1260,
  /** sheer trench wall on the zone-3 seam; unlike inter-zone ridges it has NO
   * road pass and is too steep to climb (slope > PLAYER_MAX_CLIMB_SLOPE) */
  sealRidge: { z: 900, height: 48, sigma: 10 },
  /** abyssal sea floor outside the domes (well below WATER_LEVEL -4.5) */
  oceanFloor: -14,
  /** main dome: the dry city. Terraces are concentric plateaus joined by
   * stair-ramps at the listed bearings (radians from north, y-axis style
   * atan2(dx, dz)); everywhere else the terrace lips are unclimbable. */
  dome: { x: 0, z: 1080, r: 55 },
  terraces: [
    { rOut: 55, h: 1.5 }, // Lower Ward (meets the glass)
    { rOut: 34, h: 5.5 }, // Pearl Market terrace
    { rOut: 16, h: 10 }, // The Lumen Crown
  ],
  stairBearings: [Math.PI, Math.PI / 2, -Math.PI / 2], // south, east, west
  stairHalfWidth: 0.24, // radians of ramp opening around each bearing
  /** flooded annex dome: the kelp-garden combat pocket. Its bowl dips under
   * WATER_LEVEL so it is swum, not walked. */
  annex: { x: 58, z: 1112, r: 20, floor: -6.5 },
  /** secret grotto island far out on the shelf — only the hidden passage pad
   * reaches it (open ocean is sealed off, so it cannot be swum to) */
  grotto: { x: -120, z: 1215, r: 10, h: 2 },
} as const;

// ---------------------------------------------------------------------------
// Zone definition
// ---------------------------------------------------------------------------

export const ATLANTIS_ZONE: ZoneDef = {
  id: 'atlantis',
  name: 'Atlantis',
  zMin: ATLANTIS_LAYOUT.zMin,
  zMax: ATLANTIS_LAYOUT.zMax,
  levelRange: [15, 20],
  biome: 'abyss',
  hub: { x: 0, z: 1080, radius: 26, name: 'Atlantis' },
  graveyard: { x: 30, z: 1092 },
  // The annex bowl is carved by ATLANTIS_LAYOUT, not by a lake entry; listing
  // it here anyway keeps map water shading + "fishable water" checks honest.
  lakes: [{ x: 58, z: 1112, radius: 18 }],
  pois: [
    { x: 0, z: 1080, label: 'Atlantis' },
    { x: 0, z: 1036, label: 'Tidegate Plaza' },
    { x: 0, z: 1086, label: 'The Lumen Crown' },
    { x: -22, z: 1070, label: 'Pearl Market' },
    { x: -30, z: 1100, label: 'The Drowned Archive' },
    { x: 58, z: 1112, label: 'Kelpwarden Annex' },
  ],
  welcome: 'The dome still sings, and Atlantis endures beneath the Undertide.',
};

// No roads: the terraces are the streets, and nothing walks here from outside.
export const ATLANTIS_ROADS: { x: number; z: number }[][] = [];

// ---------------------------------------------------------------------------
// Portal pads — proximity teleports (see Sim.updatePortalPadTriggers). Pads
// come in pairs; every `dest` lands more than the trigger radius away from
// the reverse pad so a round trip never ping-pongs.
// ---------------------------------------------------------------------------

export const ATLANTIS_PORTAL_PADS: PortalPadDef[] = [
  {
    id: 'tidegate_thornpeak',
    name: 'The Tidegate',
    pos: { x: 110, z: 800 }, // Stormcrag ridge, zone 3
    // A step west of the return gate so the arrival camera never sits inside
    // the return arch.
    dest: { x: 6, z: 1042 }, // Tidegate Plaza, Lower Ward
  },
  {
    id: 'tidegate_atlantis',
    name: 'The Tidegate',
    pos: { x: 0, z: 1030 }, // Tidegate Plaza, seaward edge
    dest: { x: 8, z: 652 }, // Highwatch town edge, zone 3
  },
  {
    id: 'lumen_lift_up',
    name: 'Lumen Lift',
    pos: { x: 0, z: 1122 }, // Lower Ward, north
    dest: { x: 0, z: 1086 }, // the Lumen Crown
  },
  {
    id: 'lumen_lift_down',
    name: 'Lumen Lift',
    pos: { x: 0, z: 1074 }, // Lumen Crown, south lip
    dest: { x: 0, z: 1118 }, // Lower Ward, north
  },
  {
    id: 'archive_hidden_passage',
    name: 'Weathered Tide-Carving',
    pos: { x: -30, z: 1096 }, // tucked behind the Drowned Archive
    dest: { x: -120, z: 1212 }, // the grotto island
  },
  {
    id: 'grotto_return',
    name: 'Weathered Tide-Carving',
    pos: { x: -120, z: 1218 },
    dest: { x: -26, z: 1092 }, // back behind the Archive
  },
];

// ---------------------------------------------------------------------------
// Mobs — the Kelpwarden Annex nest (levels 15-18, all swimmers). The city
// terraces stay safe; nothing here spawns or leashes outside the annex bowl.
// ---------------------------------------------------------------------------

export const ATLANTIS_MOBS: Record<string, MobTemplate> = {
  glimmerfin_eel: {
    id: 'glimmerfin_eel',
    name: 'Glimmerfin Eel',
    minLevel: 15,
    maxLevel: 16,
    family: 'beast',
    canSwim: true,
    hpBase: 62,
    hpPerLevel: 22,
    dmgBase: 11,
    dmgPerLevel: 2.5,
    attackSpeed: 1.8,
    armorPerLevel: 12,
    moveSpeed: 8.5,
    aggroRadius: 11,
    // Numbing Spark: a weak paralytic sting, nature-school DoT.
    venom: {
      chance: 0.2,
      perTick: 4,
      interval: 3,
      duration: 9,
      name: 'Numbing Spark',
      school: 'nature',
    },
    loot: [
      { copper: 70, chance: 1 },
      { itemId: 'bone_fragments', chance: 0.3 },
    ],
    scale: 0.9,
    color: 0x7fd4c1,
  },
  pearlshell_skitterer: {
    id: 'pearlshell_skitterer',
    name: 'Pearlshell Skitterer',
    minLevel: 15,
    maxLevel: 16,
    family: 'beast',
    canSwim: true,
    hpBase: 74,
    hpPerLevel: 24,
    dmgBase: 10,
    dmgPerLevel: 2.4,
    attackSpeed: 2.4,
    armorPerLevel: 26, // shell-plated: notably tougher hide than its level
    moveSpeed: 7,
    aggroRadius: 10,
    loot: [{ copper: 85, chance: 1 }],
    scale: 1.05,
    color: 0xd8c9e8,
  },
  kelpshade_lurker: {
    id: 'kelpshade_lurker',
    name: 'Kelpshade Lurker',
    minLevel: 16,
    maxLevel: 17,
    family: 'murloc',
    hpBase: 70,
    hpPerLevel: 23,
    dmgBase: 12,
    dmgPerLevel: 2.6,
    attackSpeed: 2.0,
    armorPerLevel: 14,
    moveSpeed: 8,
    aggroRadius: 12,
    loot: [
      { copper: 95, chance: 1 },
      { itemId: 'linen_scrap', chance: 0.4 },
    ],
    scale: 1.0,
    color: 0x3f7d5a,
  },
  // Rare of the breach: a vast lamprey-thing coiled where the glass gave way.
  // Same reuse-only recipe as Old Cragmaw (zone 3): existing mechanics, long
  // respawn, elite+rare flags.
  undertow_maw: {
    id: 'undertow_maw',
    name: 'The Undertow Maw',
    minLevel: 18,
    maxLevel: 18,
    family: 'beast',
    rare: true,
    elite: true,
    canSwim: true,
    ccImmune: true,
    respawnMult: 7.2,
    hpBase: 340,
    hpPerLevel: 58,
    dmgBase: 15,
    dmgPerLevel: 2.8,
    attackSpeed: 2.6,
    armorPerLevel: 20,
    moveSpeed: 8.5,
    aggroRadius: 14,
    aoePulse: { min: 14, max: 20, radius: 10, every: 9, name: 'Undertow' },
    loot: [{ copper: 2200, chance: 1 }],
    scale: 1.45,
    color: 0x2e4a66,
  },
};

// Camps sit on the annex's wading rim, not in the deep bowl: the engine never
// SPAWNS a mob below wading depth (findSafePos floors swimmers at
// WATER_LEVEL - 0.5 — see tests/fixes.test.ts "mobs spawn out of deep water").
// The beasts still swim: they wander and chase into the deep centre freely.
export const ATLANTIS_CAMPS: CampDef[] = [
  { mobId: 'glimmerfin_eel', center: { x: 46, z: 1106 }, radius: 5, count: 3 },
  { mobId: 'pearlshell_skitterer', center: { x: 50, z: 1120 }, radius: 5, count: 3 },
  { mobId: 'kelpshade_lurker', center: { x: 52, z: 1100 }, radius: 4, count: 3 },
  { mobId: 'undertow_maw', center: { x: 58, z: 1096 }, radius: 3, count: 1 },
];

// ---------------------------------------------------------------------------
// NPCs — the dry city's keepers (no quests in this first slice)
// ---------------------------------------------------------------------------

export const ATLANTIS_NPCS: Record<string, NpcDef> = {
  keeper_nerissa: {
    id: 'keeper_nerissa',
    name: 'Keeper Nerissa',
    title: 'Warden of the Lumen Crown',
    pos: { x: 2, z: 1076 },
    facing: 2.6,
    color: 0x9fd8e8,
    questIds: [],
    greeting: 'Mind the glass, surfacer. It has held for an age — help us keep it that way.',
  },
  tidewright_ollo: {
    id: 'tidewright_ollo',
    name: 'Tidewright Ollo',
    title: 'Pearl Market Tidewright',
    pos: { x: -20, z: 1072 },
    facing: 1.4,
    color: 0x5aa0b8,
    questIds: [],
    vendorItems: ['healing_potion', 'mana_potion'],
    greeting: 'Fresh from the last dry stills in the deep. Coin first, stories after.',
  },
};

// No collectible sparkle objects in the first slice.
export const ATLANTIS_OBJECTS: GroundObjectDef[] = [];

// ---------------------------------------------------------------------------
// Props — the city itself. Positions respect the terraces: Lower Ward r 34-52,
// Pearl Market terrace r 16-34, Lumen Crown r < 16 (around 0,1080), plus the
// grotto island. The two `domes` entries are the glass: colliders.ts turns
// them into wall rings, leaving gaps only where the arcs say so (the city ↔
// annex breach). Bearings use atan2(dx, dz) from each dome's center.
// ---------------------------------------------------------------------------

const CITY_TO_ANNEX_BEARING = Math.atan2(58 - 0, 1112 - 1080); // ~1.07 rad
const ANNEX_TO_CITY_BEARING = Math.atan2(0 - 58, 1080 - 1112); // ~-2.07 rad

export const ATLANTIS_PROPS: ZonePropsDef = {
  buildings: [
    { kind: 'inn', x: -16, z: 1058, w: 10, d: 8, rot: 0.5 },
    { kind: 'house', x: 22, z: 1060, w: 7, d: 6, rot: -0.4 },
    { kind: 'house', x: 40, z: 1086, w: 7, d: 6, rot: 1.8 },
    { kind: 'house', x: -40, z: 1088, w: 7, d: 6, rot: -1.6 },
    { kind: 'chapel', x: -28, z: 1104, w: 9, d: 7, rot: 2.4 }, // the Drowned Archive
    { kind: 'house', x: 16, z: 1112, w: 7, d: 6, rot: 2.9 },
  ],
  wells: [{ x: 0, z: 1080, r: 1.6 }], // the Lumen Well, heart of the Crown
  stalls: [
    { x: -24, z: 1066, rot: 0.8, r: 2.2 },
    { x: -18, z: 1078, rot: -0.7, r: 2.2 },
  ],
  mines: [],
  docks: [],
  tents: [],
  crates: [
    [-14, 1074],
    [26, 1064],
    [2, 1120],
  ],
  campfires: [
    [6, 1040], // Tidegate Plaza brazier
    [-6, 1040],
    [0, 1090], // Crown brazier
    [-118, 1214], // grotto hearth
  ],
  mudHuts: [],
  ruinRings: [{ x: -30, z: 1102, ringR: 7, columns: 6 }], // Archive colonnade
  fences: [
    { x1: 26, z1: 1088, x2: 34, z2: 1088 },
    { x1: 34, z1: 1088, x2: 34, z2: 1096 },
    { x1: 26, z1: 1096, x2: 34, z2: 1096 },
  ],
  graveyards: [{ x: 30, z: 1092 }],
  domes: [
    {
      x: 0,
      z: 1080,
      r: 55,
      // one breach only: toward the annex
      gaps: [{ from: CITY_TO_ANNEX_BEARING - 0.18, to: CITY_TO_ANNEX_BEARING + 0.18 }],
    },
    {
      x: 58,
      z: 1112,
      r: 20,
      // the annex opens back toward the city; its seaward glass is intact
      gaps: [{ from: ANNEX_TO_CITY_BEARING - 0.5, to: ANNEX_TO_CITY_BEARING + 0.5 }],
    },
  ],
};
