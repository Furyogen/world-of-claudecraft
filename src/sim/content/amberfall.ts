// The Amberfall (levels 18-20). An eternal-autumn weald behind the Veiled
// Hollow's western cliffs: fire-colored forests under a honey-gold sky,
// harvest meadows, and the Great Mere at its heart, ringed by the lantern
// town of Lanternmere. Walked into through the Rootway, a tunnel behind the
// Frostveil's north benches over the Goldmelt pass, snow melting into
// gold underfoot (southPassX). Terrain shape: AMBER_* tables in world.ts.

import type {
  CampDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  PortalDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';
import { emptyZoneProps } from '../types';

export const AMBERFALL_ZONE: ZoneDef = {
  id: 'amberfall',
  name: 'The Amberfall',
  riftPortalEligible: true,
  riftTierWeights: { B: 0.15, A: 0.55, S: 0.3 },
  zMin: 1820,
  zMax: 2380,
  xMin: -540,
  xMax: -180,
  levelRange: [18, 20],
  biome: 'amber',
  southPassX: -350, // the old gold road, now rising out of the night downs
  eastPassZ: 1890, // the Goldmelt: autumn meets the snow across the column border
  hub: { x: -360, z: 2072, radius: 24, name: 'Lanternmere' },
  graveyard: { x: -336, z: 2050 },
  lakes: [
    { x: -360, z: 2132, radius: 26 }, // the Great Mere
    { x: -332, z: 2146, radius: 14 }, // ...its reeded eastern reach
    { x: -390, z: 2144, radius: 13 }, // ...and the willow-shaded west
    { x: -444, z: 2002, radius: 10 }, // the Orchard Pool
    { x: -264, z: 2246, radius: 9 }, // the Monolith tarn
  ],
  pois: [
    { x: -360, z: 2072, label: 'Lanternmere', id: 'lanternmere' },
    { x: -350, z: 1848, label: 'The Goldmelt', id: 'the_goldmelt' },
    { x: -432, z: 1992, label: 'The Gilded Orchard', id: 'the_gilded_orchard' },
    { x: -290, z: 1960, label: 'Harvest Hollow', id: 'harvest_hollow' },
    { x: -360, z: 2132, label: 'The Great Mere', id: 'the_great_mere' },
    { x: -430, z: 2210, label: 'Cindermaple Rise', id: 'cindermaple_rise' },
    { x: -276, z: 2230, label: 'The Leaning Monolith', id: 'the_leaning_monolith' },
  ],
  welcome:
    'Every leaf here burns gold and red, yet none ever fall. The lanterns of Lanternmere are lit for you.',
};

export const AMBERFALL_ROADS: { x: number; z: number }[][] = [
  [
    { x: -350, z: 1822 },
    { x: -366, z: 1880 },
    { x: -374, z: 2030 },
    { x: -360, z: 2072 },
  ], // the Goldmelt pass -> Lanternmere
  [
    { x: -372, z: 2050 },
    { x: -410, z: 2020 },
    { x: -432, z: 1994 },
  ], // Lanternmere -> the Gilded Orchard's edge
  [
    { x: -348, z: 2050 },
    { x: -315, z: 2000 },
    { x: -290, z: 1960 },
  ], // Lanternmere -> Harvest Hollow
  [
    { x: -374, z: 2090 },
    { x: -418, z: 2146 },
    { x: -430, z: 2210 },
  ], // Lanternmere -> Cindermaple Rise, west of the Mere
  [
    { x: -344, z: 2092 },
    { x: -292, z: 2156 },
    { x: -272, z: 2226 },
  ], // Lanternmere -> the Leaning Monolith, east of the Mere
  [
    { x: -374, z: 2090 },
    { x: -404, z: 2108 },
    { x: -412, z: 2180 },
    { x: -384, z: 2250 },
    { x: -380, z: 2300 },
  ], // Lanternmere -> west around the Mere -> the north shore
];

// The Westway: an open meadow crossing at the world's western edge; walking
// west past the Mirrorshallow carries you straight into the Amberfall (a
// wide unmarked trigger, no cave and no wall, like walking into a new land).
// No portals: the Amberfall is walked into over the Goldmelt pass, where
// the Frostveil's snow road melts mile by mile into autumn gold.
export const AMBERFALL_PORTALS: PortalDef[] = [];

// Quests and folk follow in a later pass.
export const AMBERFALL_MOBS: Record<string, MobTemplate> = {
  gilded_stag: {
    id: 'gilded_stag',
    name: 'Gilded Stag',
    minLevel: 18,
    maxLevel: 19,
    family: 'beast',
    hpBase: 54,
    hpPerLevel: 18,
    dmgBase: 10,
    dmgPerLevel: 2.2,
    attackSpeed: 2.0,
    armorPerLevel: 12,
    moveSpeed: 9,
    aggroRadius: 0, // grazes the gold meadows, fights only if pressed
    loot: [],
    scale: 1.15,
    color: 0xd8a848,
  },
  gloam_fox: {
    id: 'gloam_fox',
    name: 'Gloam Fox',
    minLevel: 18,
    maxLevel: 18,
    family: 'beast',
    hpBase: 44,
    hpPerLevel: 16,
    dmgBase: 9,
    dmgPerLevel: 2.0,
    attackSpeed: 1.8,
    armorPerLevel: 10,
    moveSpeed: 9.5,
    aggroRadius: 0,
    loot: [],
    scale: 1,
    color: 0xd87838,
  },
  orchard_treant: {
    id: 'orchard_treant',
    name: 'Orchard Treant',
    minLevel: 19,
    maxLevel: 20,
    family: 'ogre',
    hpBase: 110,
    hpPerLevel: 28,
    dmgBase: 14,
    dmgPerLevel: 2.6,
    attackSpeed: 2.6,
    armorPerLevel: 16,
    moveSpeed: 6.5,
    aggroRadius: 0, // ancient and calm, until an axe is raised
    elite: true,
    loot: [],
    scale: 1.4,
    color: 0xc89838,
  },
  harvest_sprite: {
    id: 'harvest_sprite',
    name: 'Harvest Sprite',
    minLevel: 18,
    maxLevel: 19,
    family: 'kobold',
    hpBase: 48,
    hpPerLevel: 17,
    dmgBase: 10,
    dmgPerLevel: 2.1,
    attackSpeed: 1.9,
    armorPerLevel: 11,
    moveSpeed: 8.5,
    aggroRadius: 11, // orchard thieves, and territorial about it
    loot: [],
    scale: 0.85,
    color: 0xe8c878,
  },
  mere_lurker: {
    id: 'mere_lurker',
    name: 'Mere Lurker',
    minLevel: 19,
    maxLevel: 20,
    family: 'murloc',
    hpBase: 58,
    hpPerLevel: 20,
    dmgBase: 12,
    dmgPerLevel: 2.4,
    attackSpeed: 2.0,
    armorPerLevel: 13,
    moveSpeed: 8,
    aggroRadius: 13,
    loot: [],
    scale: 1.1,
    color: 0xa8b048,
  },
};
export const AMBERFALL_NPCS: Record<string, NpcDef> = {};
export const AMBERFALL_QUESTS: Record<string, QuestDef> = {};
export const AMBERFALL_QUEST_ORDER: string[] = [];
export const AMBERFALL_ITEMS: Record<string, ItemDef> = {};
export const AMBERFALL_CAMPS: CampDef[] = [
  { mobId: 'gilded_stag', center: { x: -300, z: 1976 }, radius: 12, count: 3 },
  { mobId: 'gilded_stag', center: { x: -420, z: 2020 }, radius: 11, count: 2 },
  { mobId: 'gloam_fox', center: { x: -330, z: 2030 }, radius: 10, count: 2 },
  { mobId: 'harvest_sprite', center: { x: -436, z: 1984 }, radius: 10, count: 3 },
  { mobId: 'orchard_treant', center: { x: -426, z: 2202 }, radius: 9, count: 2 },
  { mobId: 'mere_lurker', center: { x: -312, z: 2158 }, radius: 8, count: 2 },
  { mobId: 'mere_lurker', center: { x: -282, z: 2226 }, radius: 8, count: 2 },
];
export const AMBERFALL_OBJECTS: GroundObjectDef[] = [];

export const AMBERFALL_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // Lanternmere: an autumn market town on the Mere's north shore
  buildings: [
    { kind: 'inn', x: -372, z: 2066, w: 6, d: 7, rot: 0.6 },
    { kind: 'house', x: -348, z: 2062, w: 6, d: 6, rot: -0.8 },
    { kind: 'house', x: -374, z: 2084, w: 6, d: 6, rot: 2.0 },
    { kind: 'chapel', x: -346, z: 2082, w: 5, d: 7, rot: -2.2 },
  ],
  wells: [{ x: -360, z: 2074, r: 1.5 }],
  stalls: [
    { x: -354, z: 2068, rot: 0.4, r: 1.6 },
    { x: -366, z: 2080, rot: -1.4, r: 1.6 },
  ],
  fences: [
    { x1: -378, z1: 2058, x2: -368, z2: 2054 },
    { x1: -352, z1: 2088, x2: -342, z2: 2090 },
  ],
  // the Goldmelt shrine: column rings flanking the pass, statue-lined, so
  // the crossing reads as a gilded threshold between snow and autumn
  ruinRings: [
    { x: -338, z: 1852, ringR: 7, columns: 6 },
    { x: -364, z: 1838, ringR: 5, columns: 5 },
    { x: -350, z: 1872, ringR: 4, columns: 4 },
  ],
  campfires: [
    [-360, 2068],
    [-352, 1845],
    [-338, 1852],
    [-364, 1838],
  ],
};
