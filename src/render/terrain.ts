import * as THREE from 'three';
import {
  COLUMN_ZONES,
  columnBlendAt,
  STRIP_MAX_X,
  STRIP_MIN_X,
  STRIP_ZONES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  ZONES,
} from '../sim/data';
import { fbm2 } from '../sim/rng';
import type { BiomeId, ZoneDef } from '../sim/types';
import { inGardenMaze, roadDistance, terrainHeight, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX } from './gfx';
import { idleSlot } from './idle_queue';
import { impactCraterTerrainBlend } from './impact_terrain';
import { chunkIntersectsRegion, normalTexelBounds } from './terrain_region_core';
import { groundDetailTexture, groundSplatMaps, macroNoiseTexture } from './textures';

// Chunked terrain across the whole 360x1080 zone strip.
//
// - ~60u chunks with their own bounding volumes so frustum culling actually
//   works (the old single-plane-per-zone terrain was always fully submitted).
// - LOD by distance from the nearest hub at build time: settlements (where
//   the camera lingers) get dense vertices, the wilderness gets coarse ones.
//   Chunks carrying the impassable mountain walls (inter-zone ridges, world
//   rim) are promoted to the densest band regardless: the terraced walls hold
//   the heightfield's highest frequencies and the far band smears them into
//   ragged shards.
// - Skirts hang from every chunk edge to hide LOD cracks: a 0.3u base drop
//   plus the vertex slope times the coarsest band spacing, since a T-junction
//   hole grows with both the neighbor's chord span and the local gradient
//   (terraced cliffs open multi-yard holes that a flat drop cannot cover).
// - High tier: MeshStandardMaterial + splat shading (grass/dirt/rock/sand
//   weights precomputed per vertex from slope/height/roadDistance into a vec4
//   attribute) over the biome vertex-color tint, plus a world-space macro
//   normal map baked from terrainHeight.
// - Low tier: the legacy vertex-color Lambert look, still chunked for culling.

const CHUNK_SIZE = 60;
const SKIRT_DROP = 0.3;
const SLOPE_EPS = 1.5; // matches the legacy color pass so tints don't shift
// An 'idle'-paced zone build waits for a browser idle slot between batches;
// this timeout forces one batch through anyway under sustained frame load.
const IDLE_BUILD_TIMEOUT_MS = 200;

// ---------------------------------------------------------------------------
// Real PBR splat layers (ambientCG 1K, shipped under public/textures/terrain).
// Kicked off at module import and registered with the preload gate, so by the
// time buildTerrain runs the resolved textures are available synchronously.
// ---------------------------------------------------------------------------

const TERRAIN_TEX: Record<string, THREE.Texture> = {};
const ALBEDO_ANISOTROPY = 8;
const NORMAL_ANISOTROPY = 4;

function kickTerrainTex(key: string, file: string, srgb: boolean): void {
  registerPreload(
    loadTexture(`/textures/terrain/${file}`, { srgb, repeat: true }).then((tex) => {
      tex.anisotropy = srgb ? ALBEDO_ANISOTROPY : NORMAL_ANISOTROPY;
      TERRAIN_TEX[key] = tex;
      return tex;
    }),
  );
}

// ~15MB of JPEGs — skip when the URL already forces the Lambert tier (an
// auto-detected low tier still fetches them; the URL guess can't know yet)
if (GFX.terrainSplat) {
  kickTerrainTex('grassC', 'Grass001_Color.jpg', true);
  kickTerrainTex('grassN', 'Grass001_NormalGL.jpg', false);
  kickTerrainTex('dirtC', 'Ground048_Color.jpg', true);
  kickTerrainTex('dirtN', 'Ground048_NormalGL.jpg', false);
  kickTerrainTex('rockC', 'Rock051_Color.jpg', true);
  kickTerrainTex('rockN', 'Rock051_NormalGL.jpg', false);
  kickTerrainTex('sandC', 'Ground080_Color.jpg', true);
  kickTerrainTex('sandN', 'Ground080_NormalGL.jpg', false);
  kickTerrainTex('mudC', 'Ground071_Color.jpg', true); // marsh wet mud (dirt variant)
  kickTerrainTex('snowC', 'Snow010A_Color.jpg', true);
}

export function hasTerrainSplatAssets(): boolean {
  return Boolean(
    TERRAIN_TEX.grassC &&
      TERRAIN_TEX.grassN &&
      TERRAIN_TEX.dirtC &&
      TERRAIN_TEX.dirtN &&
      TERRAIN_TEX.rockC &&
      TERRAIN_TEX.rockN &&
      TERRAIN_TEX.sandC &&
      TERRAIN_TEX.sandN &&
      TERRAIN_TEX.mudC &&
      TERRAIN_TEX.snowC,
  );
}

// Per-layer constant roughness, eyeballed from the packs' roughness-map means
// (saves four samplers vs. real roughness maps; terrain is never glossy
// enough for the difference to read at gameplay camera distance).
const ROUGH_GRASS = 0.8;
const ROUGH_DIRT = 0.9;
const ROUGH_ROCK = 0.75;
const ROUGH_SAND = 0.85;
const ROUGH_MUD = 0.62; // wet sheen
const ROUGH_SNOW = 0.72;

// vertex spacing by distance from the nearest hub centre
const LOD_BANDS = {
  high: [
    { maxHubDist: 95, spacing: 1.2 },
    { maxHubDist: 185, spacing: 1.6 },
    { maxHubDist: Infinity, spacing: 2.6 },
  ],
  low: [
    { maxHubDist: 95, spacing: 3.0 },
    { maxHubDist: 185, spacing: 4.4 },
    { maxHubDist: Infinity, spacing: 6.5 },
  ],
} as const;

// Mountain-wall chunks are promoted to the densest LOD band. Half-widths
// mirror sim/world.ts: the ridge contribution lives within RIDGE_SIGMA*3
// (30yd) of each inter-zone ridge line, and the rim rise starts 30yd inside
// the world edge (plus crest-noise margin).
const WALL_LOD_RIDGE_HALF = 30;
const WALL_LOD_RIM_MARGIN = 40;

// Macro relief only needs to carry broad slopes: vertex normals and the four
// tiled material normals own close detail. The atlas spans the whole expanded
// world but is baked sparsely by zone, so keep it compact enough that entering
// a new region never turns tens of thousands of terrainHeight samples into a
// second boot. At the current bounds this is roughly 3yd/texel.
const NORMAL_TEX_W = 320;
const NORMAL_TEX_H = 960;
const NORMAL_TEX_STRENGTH = 1.35;

// Ground colors per biome; boundaries blend across the same window as the
// heightfield's shape blend. This is the tint layer the splat albedo
// multiplies into (splat textures are authored near mid-gray).
const BIOME_PALETTE: Record<
  BiomeId,
  { grass: number; grassDark: number; grassYellow: number; dirt: number; sand: number }
> = {
  vale: {
    grass: 0x548545,
    grassDark: 0x3e6635,
    grassYellow: 0x768c44,
    dirt: 0x8a6f47,
    sand: 0xc2b283,
  },
  marsh: {
    grass: 0x596d36,
    grassDark: 0x41522b,
    grassYellow: 0x71764a,
    dirt: 0x6e5a3e,
    sand: 0x8f7f5c,
  },
  peaks: {
    grass: 0x687a55,
    grassDark: 0x4d5c45,
    grassYellow: 0x8d9168,
    dirt: 0x7d6a50,
    sand: 0xb0a486,
  },
  // Paint-only biomes (editor brush): flat palettes, no zone-band blend.
  // Coastal green-blue, brighter sand than the desert's.
  beach: {
    grass: 0x9ab86a,
    grassDark: 0x7d9a5a,
    grassYellow: 0xb8c278,
    dirt: 0xc2a575,
    sand: 0xf0e4bc,
  },
  // Warmer and browner than the beach, less green. Pushed further orange
  // than a first pass to separate it clearly from the beach at a glance.
  desert: {
    grass: 0xcbaa5e,
    grassDark: 0xa88d48,
    grassYellow: 0xe0c070,
    dirt: 0xc08f4a,
    sand: 0xecc890,
  },
  // Dark, red-tinted ash rather than the cave's neutral grey. Pushed darker
  // still so it reads as scorched ground, not just "dirty".
  volcano: {
    grass: 0x3c2c28,
    grassDark: 0x281c18,
    grassYellow: 0x503830,
    dirt: 0x2c2018,
    sand: 0x4c342c,
  },
  // Neutral blue-grey stone, distinct from volcano's warm ash. Pushed cooler
  // and darker so it reads as underground rock, not daylight dirt.
  cave: {
    grass: 0x585e66,
    grassDark: 0x3e444c,
    grassYellow: 0x6a7078,
    dirt: 0x484e56,
    sand: 0x767c86,
  },
  // dusk: violet-cast glade greens with dusty rose soil
  dusk: {
    grass: 0x6d7566,
    grassDark: 0x4c4e58,
    grassYellow: 0x8c8078,
    dirt: 0x6e5a68,
    sand: 0xa593a2,
  },
  ember: {
    grass: 0xc9a86a,
    grassDark: 0xa8854f,
    grassYellow: 0xd8bc80,
    dirt: 0x9a6a44,
    sand: 0xe0c088,
  },
  frost: {
    grass: 0xeef4fa,
    grassDark: 0xd8e4f0,
    grassYellow: 0xcfdce8,
    dirt: 0x9fb0c0,
    sand: 0xdfe8f2,
  },
  amber: {
    grass: 0xc9a44e,
    grassDark: 0xa88438,
    grassYellow: 0xe0c060,
    dirt: 0x8a6a42,
    sand: 0xd8bc84,
  },
  fen: {
    grass: 0x7cab68,
    grassDark: 0x5c8a52,
    grassYellow: 0xa2c47a,
    dirt: 0x6e6448,
    sand: 0xb8bc8e,
  },
  // night: the Nightbloom dreams in violet. The splat textures are
  // green-authored, so these run hot and saturated or the meadow reads
  // green anyway (the amber realm's fire-orange needed the same push)
  night: {
    grass: 0xc06cf2,
    grassDark: 0x8f4ecc,
    grassYellow: 0xe08cf8,
    dirt: 0x8a5cb8,
    sand: 0xd8a8f0,
  },
  // haunt: dead mossy floor, cold wet earth, everything a shade too dark
  haunt: {
    grass: 0x46543e,
    grassDark: 0x2e382c,
    grassYellow: 0x5a6644,
    dirt: 0x453c34,
    sand: 0x6b6754,
  },
  // jungle: saturated tropical green over bright coral sand
  jungle: {
    grass: 0x3f9448,
    grassDark: 0x2c7038,
    grassYellow: 0x74b04e,
    dirt: 0x8a6e4a,
    sand: 0xf2e2b4,
  },
  // garden: mown lawn over warm gravel, tidy even where it has run wild
  garden: {
    grass: 0x58a04e,
    grassDark: 0x3f7e3c,
    grassYellow: 0x86b85c,
    dirt: 0x8a7a5a,
    sand: 0xd8cca8,
  },
  // gale: wind-dried sage downs over grey shingle
  gale: {
    grass: 0x6a9a62,
    grassDark: 0x4c7a4e,
    grassYellow: 0x9ab070,
    dirt: 0x7a6e58,
    sand: 0xd8d0b8,
  },
};

// rock starts creeping in at lower slopes in the peaks, later in the marsh
const ROCK_SLOPE_START: Record<BiomeId, number> = {
  vale: 0.55,
  marsh: 0.62,
  peaks: 0.45,
  beach: 0.7,
  desert: 0.55,
  volcano: 0.35,
  cave: 0.4,
  dusk: 0.52,
  ember: 0.5,
  frost: 0.5,
  amber: 0.52,
  fen: 0.6,
  night: 0.55,
  haunt: 0.58,
  jungle: 0.6,
  garden: 0.6,
  gale: 0.5, // the cliffs crag early
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

interface VertexSample {
  height: number;
  slope: number;
  normal: [number, number, number];
  color: [number, number, number];
  splat: [number, number, number, number]; // grass, dirt, rock, sand
  extra: [number, number, number, number]; // mud, snow, impact scorch, impact ash
}

// Shared scratch colors for the palette blend (hot loop, avoid allocation).
const cTmp = new THREE.Color();
const grassC = new THREE.Color(),
  grassDarkC = new THREE.Color(),
  grassYellowC = new THREE.Color();
const dirtC = new THREE.Color(),
  sandC = new THREE.Color();
const dirtDarkC = new THREE.Color(0x73592f);
const rockC = new THREE.Color(0x7a7a72);
const wetRockC = new THREE.Color(0x3f4442); // dark wet-rock shoreline (peaks/volcano/cave)
const impactAshC = new THREE.Color(0x18110d);
const impactScorchC = new THREE.Color(0x2a160c);
const hazyPeakC = new THREE.Color(0xa8bdd4); // world-rim mountains, atmospheric
const emberForestC = new THREE.Color(0x729a4e); // the Drakelands' green gatewood
const emberScorchC = new THREE.Color(0x6a4a40); // volcanic ground near the Drakemaw
const emberBasaltC = new THREE.Color(0x4e3c34); // the cones' dark volcanic rock
const cobbleC = new THREE.Color(0x8f8c86); // the Amberfall's laid stone
const cobbleDarkC = new THREE.Color(0x6e6b66); // ...its mortar-shadow cells
const duskCliffC = new THREE.Color(0x544d58); // dark weathered sea-cliff stone
const hedgeC = new THREE.Color(0x2e5c30); // the Great Maze's clipped hedge walls
const duskStrataC = new THREE.Color(0x8d7d76); // pale strata bands in the face
const snowCapC = new THREE.Color(0xedf3fa);
const lowSunC = new THREE.Color(0xe7d9a5);
const lowShadeC = new THREE.Color(0x60745b);
const blankGroundC = new THREE.Color(0x6f805d);
const paintMixC = new THREE.Color();
const zonePalettes = ZONES.map((zn) => {
  const p = BIOME_PALETTE[zn.biome];
  return {
    grass: new THREE.Color(p.grass),
    grassDark: new THREE.Color(p.grassDark),
    grassYellow: new THREE.Color(p.grassYellow),
    dirt: new THREE.Color(p.dirt),
    sand: new THREE.Color(p.sand),
  };
});

function paletteAt(x: number, z: number): void {
  const stripPalette = (zn: (typeof ZONES)[number]) =>
    zonePalettes[ZONES.indexOf(zn)] ?? zonePalettes[0];
  grassC.copy(stripPalette(STRIP_ZONES[0]).grass);
  grassDarkC.copy(stripPalette(STRIP_ZONES[0]).grassDark);
  grassYellowC.copy(stripPalette(STRIP_ZONES[0]).grassYellow);
  dirtC.copy(stripPalette(STRIP_ZONES[0]).dirt);
  sandC.copy(stripPalette(STRIP_ZONES[0]).sand);
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const b = STRIP_ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    const next = stripPalette(STRIP_ZONES[i + 1]);
    grassC.lerp(next.grass, tt);
    grassDarkC.lerp(next.grassDark, tt);
    grassYellowC.lerp(next.grassYellow, tt);
    dirtC.lerp(next.dirt, tt);
    sandC.lerp(next.sand, tt);
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t <= 0) continue;
    const p = stripPalette(col);
    grassC.lerp(p.grass, t);
    grassDarkC.lerp(p.grassDark, t);
    grassYellowC.lerp(p.grassYellow, t);
    dirtC.lerp(p.dirt, t);
    sandC.lerp(p.sand, t);
  }
}

// How "marsh" a given z is — mirrors the palette/heightfield blend windows so
// the mud texture fades in exactly where the marsh palette does.
function marshWeightAt(x: number, z: number): number {
  let w = STRIP_ZONES[0].biome === 'marsh' ? 1 : 0;
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const b = STRIP_ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    w += ((STRIP_ZONES[i + 1].biome === 'marsh' ? 1 : 0) - w) * tt;
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t > 0) w += ((col.biome === 'marsh' ? 1 : 0) - w) * t;
  }
  return w;
}

// blend the splat weight vector toward a single layer
function lerpSplat(w: [number, number, number, number], layer: 0 | 1 | 2 | 3, t: number): void {
  if (t <= 0) return;
  w[0] -= w[0] * t;
  w[1] -= w[1] * t;
  w[2] -= w[2] * t;
  w[3] -= w[3] * t;
  w[layer] += t;
}

// One terrain sample: height, analytic normal, legacy tint color and splat
// weights. Both tiers use the color; only the splat tier consumes weights.
// With `paintInFrag` (the splat tier) the painted tint/re-base/custom weights
// are NOT applied here — the fragment paint field carries them at paint-cell
// resolution — and the vertex keeps the paint weight only to suppress auto
// features (roads, shore sand, slope rock, snow) under strokes.
function sampleVertex(
  x: number,
  z: number,
  seed: number,
  paintInFrag: boolean,
  normalEps: number = SLOPE_EPS,
): VertexSample {
  const h = terrainHeight(x, z, seed);
  const hx = terrainHeight(x + SLOPE_EPS, z, seed) - terrainHeight(x - SLOPE_EPS, z, seed);
  const hz = terrainHeight(x, z + SLOPE_EPS, seed) - terrainHeight(x, z - SLOPE_EPS, seed);
  const slope = Math.sqrt(hx * hx + hz * hz) / (2 * SLOPE_EPS);
  // Lighting normal: sample at the mesh's own grid scale, not the fixed tint
  // epsilon. On steep sculpted cliffs a sub-grid epsilon makes adjacent vertex
  // normals step wildly, which Gouraud interpolation shows as dark banding.
  const ne = Math.max(SLOPE_EPS, normalEps);
  const nhx =
    ne === SLOPE_EPS ? hx : terrainHeight(x + ne, z, seed) - terrainHeight(x - ne, z, seed);
  const nhz =
    ne === SLOPE_EPS ? hz : terrainHeight(x, z + ne, seed) - terrainHeight(x, z - ne, seed);
  const invLen = 1 / Math.hypot(nhx / (2 * ne), 1, nhz / (2 * ne));
  const normal: [number, number, number] = [
    -(nhx / (2 * ne)) * invLen,
    invLen,
    -(nhz / (2 * ne)) * invLen,
  ];

  paletteAt(x, z);
  const biome = zoneBiomeAt(x, z);
  const w: [number, number, number, number] = [1, 0, 0, 0];
  const impact = impactCraterTerrainBlend(x, z);

  // base grass with patchy variation: a coarse fbm layer for dry/lush
  // patches plus a fine one for grain, replacing the old pure-sine tint
  // (sine repeats on a visible grid at a distance; noise reads as natural
  // ground cover instead).
  const v = fbm2(x * 0.045, z * 0.045, seed + 53, 3);
  cTmp.copy(grassC).lerp(grassDarkC, v);
  const v2 = fbm2(x * 0.16, z * 0.16, seed + 59, 2);
  cTmp.lerp(grassYellowC, v2 * 0.35);
  if (biome === 'ember') {
    // the gatewood is green in the south near Wyrmwatch and dries into sand
    // northward; the volcanic belt then darkens toward scorched basalt
    const forest = 1 - clamp01((z - 1925) / 145);
    if (forest > 0) cTmp.lerp(emberForestC, forest * 0.85);
    const sandT = clamp01((z - 1925) / 145);
    lerpSplat(w, 3, sandT * 0.75);
    // the Wyrmroad: a sheltered green corridor along x 404 through the
    // volcanic belt toward the south crossing, the realm's second gradient
    const passT = 1 - clamp01((Math.abs(x - 404) - 26) / 26);
    const valley = passT * clamp01((z - 2310) / 80);
    const scorch = clamp01((z - 2260) / 100) * (1 - valley);
    if (scorch > 0) {
      cTmp.lerp(emberScorchC, scorch * 0.55);
      lerpSplat(w, 2, scorch * 0.5);
    }
    if (valley > 0) {
      cTmp.lerp(emberForestC, valley * 0.8);
      lerpSplat(w, 0, valley * 0.6);
    }
  }
  // the marsh reads muddier: patches of wet dirt across the lowland
  if (biome === 'marsh') lerpSplat(w, 1, 0.3 * v2 * clamp01((4 - h) / 6));
  // shoreline blend, biome-specific: marsh has no sandy beach (wet mud
  // instead), rocky/ashen biomes get a darker wet-rock tint, everywhere else
  // keeps the classic sandy bank. Color and splat weight share one feathered
  // falloff so the shore blends out instead of cutting a razor-hard edge.
  const wl = WATER_LEVEL;
  const shore = clamp01((wl + 1.6 - h) / 1.6);
  if (biome === 'marsh') {
    cTmp.lerp(dirtDarkC, shore);
    lerpSplat(w, 1, shore);
  } else if (biome === 'peaks' || biome === 'volcano' || biome === 'cave') {
    cTmp.lerp(wetRockC, shore);
    lerpSplat(w, 2, shore);
  } else {
    cTmp.lerp(sandC, shore);
    lerpSplat(w, 3, shore);
  }
  // packed dirt at each hub settlement (same feather as the splat weight —
  // a constant lerp stamped a clean-edged brown disc on the grass)
  for (const zn of ZONES) {
    const dHub = Math.hypot(x - zn.hub.x, z - zn.hub.z);
    if (dHub < 14) {
      const hubT = clamp01((14 - dHub) / 3);
      if (zn.biome === 'amber') {
        // Lanternmere's plaza is paved like its roads
        const cell =
          (Math.sin(Math.floor(x * 1.6) * 12.9898 + Math.floor(z * 1.6) * 78.233) + 1) / 2;
        cTmp.lerp(cobbleC, 0.85 * hubT);
        cTmp.lerp(cobbleDarkC, cell * 0.45 * hubT);
        lerpSplat(w, 2, 0.75 * hubT);
      } else {
        cTmp.lerp(dirtDarkC, 0.7 * hubT);
        lerpSplat(w, 1, 0.75 * hubT);
      }
      break;
    }
  }
  const rd = roadDistance(x, z);
  // the Amberfall paves its ways: cobblestone, cell-jittered so the vertex
  // grid reads as laid stones rather than one grey ribbon (rock splat)
  const cobbles = biome === 'amber';
  if (rd < 2.0) {
    if (cobbles) {
      const cell = (Math.sin(Math.floor(x * 1.6) * 12.9898 + Math.floor(z * 1.6) * 78.233) + 1) / 2;
      cTmp.lerp(cobbleC, 0.9);
      cTmp.lerp(cobbleDarkC, cell * 0.5);
      lerpSplat(w, 2, 0.85);
    } else {
      cTmp.lerp(dirtC, 0.85);
      lerpSplat(w, 1, 0.85);
    }
  } else if (rd < 3.4) {
    const t = 0.85 * (1 - (rd - 2.0) / 1.4);
    cTmp.lerp(cobbles ? cobbleC : dirtC, t);
    lerpSplat(w, cobbles ? 2 : 1, t);
  }
  // Break up the rock/snow blend so cliffs read as striated stone and snow
  // reads as patchy drifts instead of a single flat tone / a clean cutoff.
  const rockStreak = fbm2(x * 0.09, z * 0.09, seed + 41, 3);
  const snowPatch = fbm2(x * 0.06, z * 0.06, seed + 47, 3);
  const rockStart = ROCK_SLOPE_START[biome];
  if (slopeRockOn && slope > rockStart && autoW > 0) {
    const t = Math.min(1, (slope - rockStart) * 2) * autoW;
    cTmp.lerp(rockC, t);
    cTmp.lerp(dirtDarkC, t * (rockStreak - 0.5) * 0.35);
    lerpSplat(w, 2, t);
    // the Great Maze's walls are hedges, not cliffs: inside the maze the
    // steep faces take clipped evergreen instead of rock
    if (biome === 'garden' && inGardenMaze(x, z)) {
      cTmp.lerp(hedgeC, t);
      lerpSplat(w, 0, t * 0.7); // lean back toward the grass splat
    }
    // dusk sea cliffs read as dark weathered stone with pale strata bands, so
    // the coast walls look like rugged wave-cut rock instead of smooth clay
    if (biome === 'dusk') {
      const nearSea = clamp01((16 - h) / 12);
      const band = (Math.sin(h * 1.7 + x * 0.06 + z * 0.045) + 1) / 2;
      cTmp.lerp(duskCliffC, t * nearSea * (0.45 + band * 0.35));
      cTmp.lerp(duskStrataC, t * nearSea * (1 - band) * 0.3);
    }
  }
  // high ground (ridges, peaks) goes rocky then snowy (the Drakelands' high
  // rock reads as dark basalt instead, and its peaks never take snow). The snow
  // ramp is wide (26u, over four terrace bands) with a strong patch-noise term:
  // the terraced heightfield steps 6u at a time, and a ramp comparable to the
  // step paints alternate treads fully white / fully bare, which reads as a
  // repetitive checkerboard from a distance. The grid world terraces too, so it
  // keeps the release's wide ramp; only the snow LINE (h - 34) stays tuned to
  // the grid's own peak heights.
  let snow = 0;
  if (biome === 'ember') {
    const t2 = Math.max(
      slope > rockStart ? Math.min(1, (slope - rockStart) * 2) : 0,
      clamp01((h - 18) / 8) * 0.75,
    );
    if (t2 > 0) cTmp.lerp(emberBasaltC, t2 * 0.85);
  }
  if (biome === 'frost') {
    // the Reach is snowbound from the shore up, not just on its crowns; the
    // Snowline and the Goldmelt (the sideways crossings) both sit at z 1890
    // on opposite borders, so the green valley floors fade under the snow
    // toward the interior instead of flipping white at the borders
    const passT = 1 - clamp01((Math.abs(z - 1890) - 26) / 26);
    const green = passT * clamp01((Math.abs(x) - 95) / 85);
    const snowline = 1 - green;
    if (green > 0) cTmp.lerp(emberForestC, green * 0.8);
    const blanket = clamp01((h - (WATER_LEVEL + 1.2)) / 3) * snowline;
    cTmp.lerp(snowCapC, 0.8 * blanket);
    snow = Math.max(snow, 0.85 * blanket);
  }
  if (h > 22) {
    const rockT = clamp01((h - 22) / 10) * (0.6 + rockStreak * 0.25);
    cTmp.lerp(biome === 'ember' ? emberBasaltC : rockC, rockT);
    snow = biome === 'ember' ? 0 : clamp01((h - 34 + (snowPatch - 0.5) * 14) / 26) * 0.85;
    cTmp.lerp(snowCapC, snow);
    lerpSplat(w, 2, clamp01((h - 22) / 10) * 0.8 * autoW);
  }
  if (impact.scorch > 0) {
    cTmp.lerp(impactScorchC, 0.88 * impact.scorch);
    cTmp.lerp(impactAshC, 0.58 * impact.ash);
    lerpSplat(w, 1, impact.dirt);
    lerpSplat(w, 2, impact.rock);
  }
  // the rim wall reads as distant sunlit peaks, not a black cliff. The haze
  // kicks in well before the wall itself (edge starts negative deep inland)
  // so from a zone's centre the rim reads as atmospheric haze rather than a
  // crisp silhouette, reinforcing the reduced BIOME_FOG draw distance.
  const edge = Math.max(
    Math.abs(x) - (WORLD_MAX_X - 70),
    WORLD_MIN_Z + 70 - z,
    z - (WORLD_MAX_Z - 70),
  );
  const rim = clamp01(edge / 64);
  if (rim > 0) {
    cTmp.lerp(hazyPeakC, rim * 0.95);
    // same wide, noise-broken ramp as the interior snow above: a pure
    // height threshold snowed every terrace tread above the line uniformly,
    // turning the rim's 2D terrace lattice into a white/grey checkerboard
    const rimSnow = clamp01((h - 21 + (snowPatch - 0.5) * 12) / 26) * rim * 0.8;
    cTmp.lerp(snowCapC, rimSnow);
    snow = Math.max(snow, rimSnow);
    lerpSplat(w, 2, rim * 0.85);
  }
  // mud rides the dirt layer wherever the marsh palette is active
  const mud = marshWeightAt(x, z);
  if (GFX.lowPlus && !GFX.terrainSplat) {
    const ridge = clamp01((slope - 0.22) * 1.6);
    const lowland = clamp01((wl + 7 - h) / 12);
    const upland = clamp01((h - 8) / 22);
    cTmp.lerp(lowShadeC, 0.07 * ridge + 0.05 * lowland * mud);
    cTmp.lerp(lowSunC, 0.035 * (1 - shore) + 0.045 * upland);
    cTmp.multiplyScalar(0.98 + upland * 0.04 - ridge * 0.025);
  }
  return {
    height: h,
    slope,
    normal,
    color: [cTmp.r, cTmp.g, cTmp.b],
    splat: w,
    extra: [mud, snow, impact.scorch, impact.ash],
  };
}

// ---------------------------------------------------------------------------
// Chunk geometry: interior (nx+1)x(nz+1) grid wrapped in a skirt ring whose
// vertices sit on the chunk border but 0.3u lower, hiding LOD cracks.
// ---------------------------------------------------------------------------

function buildChunkGeometry(
  x0: number,
  z0: number,
  sizeX: number,
  sizeZ: number,
  spacing: number,
  seed: number,
  withSplat: boolean,
  skirtSpan: number,
): THREE.BufferGeometry {
  // Sizes differ on the map's last row/column: chunks clamp to renderBounds
  // instead of overshooting up to a chunk beyond the map edge.
  const nx = Math.max(4, Math.round(sizeX / spacing));
  const nz = Math.max(4, Math.round(sizeZ / spacing));
  const stepX = sizeX / nx;
  const stepZ = sizeZ / nz;
  const gw = nx + 3; // grid width including the skirt ring
  const gh = nz + 3;
  const count = gw * gh;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const splats = withSplat ? new Float32Array(count * 4) : null;
  const extras = withSplat ? new Float32Array(count * 4) : null;

  const rb = renderBounds();
  const sampleCache = new Map<number, VertexSample>();
  for (let gj = 0; gj < gh; gj++) {
    for (let gi = 0; gi < gw; gi++) {
      const i = gi - 1,
        j = gj - 1; // interior indices; -1 / n+1 are skirt
      const ci = Math.max(0, Math.min(nx, i));
      const cj = Math.max(0, Math.min(nz, j));
      const isSkirt = i !== ci || j !== cj;
      const x = x0 + ci * stepX;
      const z = z0 + cj * stepZ;
      // skirt verts share the border sample — cache by clamped grid index
      const cacheKey = cj * gw + ci;
      let s = sampleCache.get(cacheKey);
      if (!s) {
        // The splat tier renders paint per fragment (withSplat doubles as the
        // paint-in-fragment flag); the Lambert tier keeps the vertex bake.
        s = sampleVertex(x, z, seed, withSplat, Math.max(stepX, stepZ));
        sampleCache.set(cacheKey, s);
      }
      const vi = gj * gw + gi;
      // Skirt depth scales with the local relief so steep sculpted cliffs
      // (tens of units between grid rows) can't open see-through seams.
      const skirtDrop = isSkirt
        ? Math.max(SKIRT_DROP, s.slope * Math.max(stepX, stepZ) * SKIRT_RELIEF_FACTOR)
        : 0;
      positions[vi * 3] = x;
      // Slope-aware drop: a T-junction hole under a coarse neighbor's chord is
      // bounded by the local gradient times that neighbor's vertex spacing, so
      // a flat cliff-side skirt must deepen with the slope or the hole shows
      // sky (skirtSpan is the coarsest spacing any neighbor can have).
      positions[vi * 3 + 1] = s.height - (isSkirt ? SKIRT_DROP + s.slope * skirtSpan : 0);
      positions[vi * 3 + 2] = z;
      normals[vi * 3] = s.normal[0];
      normals[vi * 3 + 1] = s.normal[1];
      normals[vi * 3 + 2] = s.normal[2];
      colors[vi * 3] = s.color[0];
      colors[vi * 3 + 1] = s.color[1];
      colors[vi * 3 + 2] = s.color[2];
      uvs[vi * 2] = (x - rb.minX) / rb.width;
      uvs[vi * 2 + 1] = (z - rb.minZ) / rb.depth;
      if (splats) {
        splats[vi * 4] = s.splat[0];
        splats[vi * 4 + 1] = s.splat[1];
        splats[vi * 4 + 2] = s.splat[2];
        splats[vi * 4 + 3] = s.splat[3];
      }
      if (extras) {
        extras[vi * 4] = s.extra[0];
        extras[vi * 4 + 1] = s.extra[1];
        extras[vi * 4 + 2] = s.extra[2];
        extras[vi * 4 + 3] = s.extra[3];
      }
    }
  }

  const quadsX = gw - 1,
    quadsZ = gh - 1;
  const indices = new Uint32Array(quadsX * quadsZ * 6);
  let k = 0;
  for (let gj = 0; gj < quadsZ; gj++) {
    for (let gi = 0; gi < quadsX; gi++) {
      const a = gj * gw + gi;
      const b = a + 1;
      const c = a + gw;
      const d = c + 1;
      // Split each quad along the diagonal whose endpoints are closest in
      // height, so the fold line follows a ridge/terrace edge instead of
      // cutting across it (a fixed diagonal saws terraced cliffs into
      // alternating shards). Both windings keep the +y face up.
      const ha = positions[a * 3 + 1];
      const hb = positions[b * 3 + 1];
      const hc = positions[c * 3 + 1];
      const hd = positions[d * 3 + 1];
      if (Math.abs(hb - hc) <= Math.abs(ha - hd)) {
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = d;
      } else {
        indices[k++] = a;
        indices[k++] = c;
        indices[k++] = d;
        indices[k++] = a;
        indices[k++] = d;
        indices[k++] = b;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (splats) geo.setAttribute('aSplat', new THREE.BufferAttribute(splats, 4));
  if (extras) geo.setAttribute('aExtra', new THREE.BufferAttribute(extras, 4));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------------------
// Macro relief: a DataTexture normal map baked from terrainHeight in
// strip-planar UV space — cliffs and ridges get per-pixel light response far
// beyond the vertex density.
// ---------------------------------------------------------------------------

// Bake the normal texels [i0..i1] x [j0..j1] (inclusive) into `data`, sampling
// the CURRENT terrainHeight. The full build and the editor's partial rebake
// share this one path so a partial rebake is byte-identical to a full one:
// heights are sampled one texel beyond the baked rect (clamped at the texture
// border, exactly like the full bake's clamped derivative stencil).
function bakeNormalRegion(
  data: Uint8Array,
  seed: number,
  i0: number,
  i1: number,
  j0: number,
  j1: number,
): void {
  const w = NORMAL_TEX_W,
    h = NORMAL_TEX_H;
  const rb = renderBounds();
  const stepX = rb.width / w;
  const stepZ = rb.depth / h;
  // height window: the baked rect plus the 1-texel derivative stencil
  const hi0 = Math.max(0, i0 - 1),
    hi1 = Math.min(w - 1, i1 + 1);
  const hj0 = Math.max(0, j0 - 1),
    hj1 = Math.min(h - 1, j1 + 1);
  const hw = hi1 - hi0 + 1;
  const heights = new Float32Array(hw * (hj1 - hj0 + 1));
  for (let j = hj0; j <= hj1; j++) {
    const z = rb.minZ + (j + 0.5) * stepZ;
    for (let i = hi0; i <= hi1; i++) {
      heights[(j - hj0) * hw + (i - hi0)] = terrainHeight(rb.minX + (i + 0.5) * stepX, z, seed);
    }
  }
  const hAt = (i: number, j: number): number => heights[(j - hj0) * hw + (i - hi0)];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const iw = Math.max(0, i - 1),
        ie = Math.min(w - 1, i + 1);
      const jn = Math.max(0, j - 1),
        js = Math.min(h - 1, j + 1);
      const dhdx = (hAt(ie, j) - hAt(iw, j)) / ((ie - iw) * stepX);
      const dhdz = (hAt(i, js) - hAt(i, jn)) / ((js - jn) * stepZ);
      // Fade the macro relief on steep sculpted faces: near-vertical cliffs
      // squash many world units into one strip-planar texel, and full-strength
      // 8-bit normals there quantize into hard light/dark banding stripes.
      const g = Math.hypot(dhdx, dhdz);
      const att = 1 / (1 + g * g * 0.15);
      const nx = -dhdx * NORMAL_TEX_STRENGTH * att;
      const nz = -dhdz * NORMAL_TEX_STRENGTH * att;
      const inv = 1 / Math.hypot(nx, 1, nz);
      const o = (j * w + i) * 4;
      data[o] = (nx * inv * 0.5 + 0.5) * 255;
      data[o + 1] = (nz * inv * 0.5 + 0.5) * 255; // green follows +v (+z)
      data[o + 2] = (inv * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
}

function terrainNormalTexture(): THREE.DataTexture {
  const data = new Uint8Array(NORMAL_TEX_W * NORMAL_TEX_H * 4);
  // Zone texels are baked on demand. Unloaded areas remain a flat normal and
  // have no geometry, so they cannot be sampled on screen.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, NORMAL_TEX_W, NORMAL_TEX_H, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  // Mipmapped minification (DataTexture defaults it off): the bake packs the
  // terraces' near-vertical risers next to flat treads at 0.56u/texel, and
  // sampling that unfiltered from a distant camera aliases the lighting into
  // shimmering checker patterns. Mips average the relief away smoothly with
  // distance instead. WebGL2 handles the NPOT mip chain; the editor's
  // rebakeNormalRegion re-upload regenerates it automatically.
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = NORMAL_ANISOTROPY;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

// Editor brush cursor: a soft additive ring projected onto the ground in world
// XZ space, injected into BOTH terrain materials so it reads identically on the
// splat and Lambert tiers. One shared uniform-value set per terrain view; the
// uniform objects are installed once at material build (onBeforeCompile) and
// per-frame updates only write .value, never rebuild a material. Radius 0
// disables (the default), so the shipped game pays one uniform branch and
// nothing else.
interface BrushUniforms {
  uBrushCenter: { value: THREE.Vector2 };
  uBrushRadius: { value: number };
  uBrushColor: { value: THREE.Color };
}

function makeBrushUniforms(): BrushUniforms {
  return {
    uBrushCenter: { value: new THREE.Vector2(0, 0) },
    uBrushRadius: { value: 0 },
    uBrushColor: { value: new THREE.Color(0x6fd2ff) },
  };
}

// Two smoothsteps: a feathered rise to the radius and a feathered fall past it.
const BRUSH_RING_GLSL = /* glsl */ `
uniform vec2 uBrushCenter;
uniform float uBrushRadius;
uniform vec3 uBrushColor;
vec3 wocBrushRing(vec2 p) {
  if (uBrushRadius <= 0.0) return vec3(0.0);
  float d = distance(p, uBrushCenter);
  float w = max(0.28, uBrushRadius * 0.055);
  float ring = smoothstep(uBrushRadius - w, uBrushRadius, d)
             * (1.0 - smoothstep(uBrushRadius, uBrushRadius + w, d));
  return uBrushColor * ring * 1.35;
}
`;

// ---------------------------------------------------------------------------
// Terrain holes (the editor's Hole tool): sphere cutouts through the ground
// sheet, discarded per FRAGMENT so the rim is a clean round curve on any
// slope at any chunk resolution. One shared uniform-value set feeds every
// terrain material tier (splat/Lambert/blank); hole edits only write .value.
// The sim shares the identical sphere test (sim/caves.ts inTerrainHole), so
// where the ground disappears is exactly where movers stop standing on it.
// ---------------------------------------------------------------------------

// xyz = sphere center, w = radius^2 (squared on upload; the shader compares
// squared distances only).
const holesUniform = { value: new Float32Array(MAX_TERRAIN_HOLES * 4) };
const holeCountUniform = { value: 0 };
// Patch spheres (Patch hole mode): ground inside a patch is NOT discarded,
// no matter how many holes overlap it.
const holePatchesUniform = { value: new Float32Array(MAX_HOLE_PATCHES * 4) };
const holePatchCountUniform = { value: 0 };

/** Re-upload the active world's terrain holes + patches to every terrain
 *  material. Call after any hole/patch edit (and on map load/terrain build). */
export function refreshTerrainHoles(): void {
  const content = getActiveWorldContent();
  const holes = content.holes ?? [];
  const arr = holesUniform.value;
  const n = Math.min(holes.length, MAX_TERRAIN_HOLES);
  for (let i = 0; i < n; i++) {
    const h = holes[i];
    arr[i * 4] = h.x;
    arr[i * 4 + 1] = h.y;
    arr[i * 4 + 2] = h.z;
    arr[i * 4 + 3] = h.radius * h.radius;
  }
  holeCountUniform.value = n;
  const patches = content.holePatches ?? [];
  const parr = holePatchesUniform.value;
  const pn = Math.min(patches.length, MAX_HOLE_PATCHES);
  for (let i = 0; i < pn; i++) {
    const p = patches[i];
    parr[i * 4] = p.x;
    parr[i * 4 + 1] = p.y;
    parr[i * 4 + 2] = p.z;
    parr[i * 4 + 3] = p.radius * p.radius;
  }
  holePatchCountUniform.value = pn;
}

const HOLES_GLSL = /* glsl */ `
uniform vec4 uWocHoles[${MAX_TERRAIN_HOLES}];
uniform int uWocHoleCount;
uniform vec4 uWocHolePatches[${MAX_HOLE_PATCHES}];
uniform int uWocHolePatchCount;
bool wocInHole(vec3 p) {
  bool cut = false;
  for (int i = 0; i < ${MAX_TERRAIN_HOLES}; i++) {
    if (i >= uWocHoleCount) break;
    vec3 d = p - uWocHoles[i].xyz;
    if (dot(d, d) < uWocHoles[i].w) { cut = true; break; }
  }
  if (!cut) return false;
  for (int i = 0; i < ${MAX_HOLE_PATCHES}; i++) {
    if (i >= uWocHolePatchCount) break;
    vec3 d = p - uWocHolePatches[i].xyz;
    if (dot(d, d) < uWocHolePatches[i].w) return false;
  }
  return true;
}
`;

/** Patch a compiled terrain shader with the hole discard. `worldPosExpr` is
 *  the material's world-position varying (each tier already carries one for
 *  the brush ring). Runs before lighting via the clipping-planes anchor. */
function injectHoleDiscard(
  sh: { uniforms: Record<string, unknown>; fragmentShader: string },
  worldPosExpr: string,
): void {
  sh.uniforms.uWocHoles = holesUniform;
  sh.uniforms.uWocHoleCount = holeCountUniform;
  sh.uniforms.uWocHolePatches = holePatchesUniform;
  sh.uniforms.uWocHolePatchCount = holePatchCountUniform;
  sh.fragmentShader = sh.fragmentShader
    .replace(
      '#include <clipping_planes_pars_fragment>',
      `#include <clipping_planes_pars_fragment>
      ${HOLES_GLSL}`,
    )
    .replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      if (uWocHoleCount > 0 && wocInHole(${worldPosExpr})) discard;`,
    );
}

function buildSplatMaterial(
  normalTex: THREE.DataTexture,
  brush: BrushUniforms,
): THREE.MeshStandardMaterial {
  // Legacy canvas splats are still generated (result unused): textures.ts
  // shares one LCG across all generators, so dropping this call would shift
  // the look of every texture generated after it (foliage, props, ...).
  groundSplatMaps();
  const macro = macroNoiseTexture();
  const t = TERRAIN_TEX;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0,
    normalMap: normalTex,
    normalScale: new THREE.Vector2(0.85, 0.85),
    // Near-vertical sculpted cliffs stretch quads until some face away from
    // the camera; culled backfaces read as transparent holes in the ground.
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, brush);
    injectHoleDiscard(sh, 'vWPos');
    ensureAtlas();
    Object.assign(sh.uniforms, {
      uCustomAtlas: customAtlasUniform,
      uCustomTile: customTileUniform,
      uCustomTileB: customTileUniformB,
      uPaintField: paintFieldUniform,
      uPaintRect: paintRectUniform,
      uGrass: { value: t.grassC },
      uGrassN: { value: t.grassN },
      uDirt: { value: t.dirtC },
      uDirtN: { value: t.dirtN },
      uRock: { value: t.rockC },
      uRockN: { value: t.rockN },
      uSand: { value: t.sandC },
      uSandN: { value: t.sandN },
      uMud: { value: t.mudC },
      uSnow: { value: t.snowC },
      uMacro: { value: macro },
    });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aSplat;
        attribute vec4 aExtra;
        varying vec4 vSplat;
        varying vec4 vExtra;
        varying vec3 vWPos;
        varying vec3 vWNorm;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSplat = aSplat;
        vExtra = aExtra;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWNorm = objectNormal; // terrain mesh is untransformed: object == world`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec4 vSplat;
        varying vec4 vExtra;
        varying vec3 vWPos;
        varying vec3 vWNorm;
        uniform sampler2D uGrass, uGrassN, uDirt, uDirtN, uRock, uRockN, uSand, uSandN, uMud, uSnow, uMacro;
        uniform sampler2D uCustomAtlas;
        uniform vec4 uCustomTile;
        uniform vec4 uCustomTileB;
        // One array texture (a single texture unit; this material sits at
        // MAX_TEXTURE_IMAGE_UNITS): layer 0 = premultiplied tint + coverage,
        // layer 1 = splat re-base + flat weight, layer 2 = custom slots 0-3,
        // layer 3 = swatch hue/light adjust, layer 4 = custom slots 4-7.
        uniform highp sampler2DArray uPaintField;
        uniform vec4 uPaintRect; // xy: paint-grid world origin, zw: 1/world size (0 = no paint)
        vec3 wocCustomTex(vec2 tiledUv, vec2 cell) {
          // fract() keeps the sample inside the slot's 4x2 atlas cell; a small
          // inset avoids linear-filter bleed across the cell seam.
          return texture2D(uCustomAtlas, (fract(tiledUv) * 0.996 + 0.002) * vec2(0.25, 0.5) + cell).rgb;
        }
        // Swatch hue adjust: rotate the albedo around the grey axis. Exact
        // identity at angle 0 (cos 0 == 1, sin 0 == 0), so unadjusted paint
        // stays bit-identical to today.
        vec3 wocHueRotate(vec3 c, float a) {
          vec3 k = vec3(0.5773502691896258);
          float ca = cos(a);
          return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
        }
        ${BRUSH_RING_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += wocBrushRing(vWPos.xz);`,
      )
      .replace(
        '#include <map_fragment>',
        `
        // Per-fragment paint field: painted tint / splat re-base / custom
        // texture weights resolve at paint-CELL resolution (GPU bilinear over
        // the baked grid + smoothstep shaping), so brush edges feather over
        // ~one paint cell instead of stair-stepping across mesh triangles.
        vec2 paintUv = (vWPos.xz - uPaintRect.xy) * uPaintRect.zw;
        vec4 pTint = texture(uPaintField, vec3(paintUv, 0.0));
        vec4 pData = texture(uPaintField, vec3(paintUv, 1.0));
        vec4 pCustomW = texture(uPaintField, vec3(paintUv, 2.0));
        vec4 pAdjust = texture(uPaintField, vec3(paintUv, 3.0));
        vec4 pCustomW2 = texture(uPaintField, vec3(paintUv, 4.0));
        // Coverage: the bake pre-blurs the grid into a smooth field, so shape
        // it and warp the midtones with world-space noise — the edge LINE
        // wanders organically (like the hand-authored roads) instead of
        // reading as a mathematically even airbrush ring. Extremes are gated,
        // so painted interiors stay full and unpainted ground stays clean.
        float pnoise = texture2D(uMacro, vWPos.xz * 0.045).r - 0.5;
        float pcov = clamp(pTint.a + pnoise * 0.5 * (1.0 - abs(2.0 * pTint.a - 1.0)), 0.0, 1.0);
        float pw = pcov * pcov * (3.0 - 2.0 * pcov);
        // Tint is premultiplied by coverage in the bake, so the divide never
        // bleeds dark halos in from unpainted neighbors.
        vec3 paintTint = pTint.rgb / max(pTint.a, 1e-3);
        // Re-base/custom/flat weights ride the SAME shaped+warped coverage
        // (they were blurred with it, so rescale by the shared ratio): the
        // splat texture, tint, and swatch edges all move as one line.
        float pmod = pw / max(pTint.a, 1e-3);
        pData *= pmod;
        pCustomW *= pmod;
        pCustomW2 *= pmod;
        pAdjust *= pmod;
        float pFlat = pData.a;
        // Auto features (slope rock, shore sand, road/hub dirt, snow) are
        // baked UNSUPPRESSED into the vertex attributes; fade them here by the
        // SAME pw the paint arrives with, so the crossfade is exact at every
        // fragment. (Suppressing at vertex resolution against fragment-res
        // paint left a halo of resurfacing snow/sand around every stroke.)
        vec4 wAuto = mix(vSplat, vec4(1.0, 0.0, 0.0, 0.0), pw);
        // Re-base toward the painted biome's texture layer (dirt/rock/sand in
        // pData.rgb, pre-scaled by the biome's strength).
        float rebaseSum = min(1.0, pData.r + pData.g + pData.b);
        vec4 wSplat = vec4(
          wAuto.x * (1.0 - rebaseSum),
          wAuto.y * (1.0 - rebaseSum) + pData.r,
          wAuto.z * (1.0 - rebaseSum) + pData.g,
          wAuto.w * (1.0 - rebaseSum) + pData.b);
        vec2 tuv = vWPos.xz * 0.22;
        // grass blends two scales so the 1K photo source never reads as tile
        vec3 grassAlb = mix(texture2D(uGrass, tuv).rgb, texture2D(uGrass, tuv * 0.31).rgb, 0.42);
        // marsh swaps packed dirt for wet mud (roads, hub discs included)
        vec3 dirtAlb = mix(texture2D(uDirt, tuv * 0.8).rgb, texture2D(uMud, tuv * 0.8).rgb, vExtra.x);
        // rock: top-down projection smears into vertical streaks on cliffs,
        // so steep faces blend toward wall-planar (world XY/ZY) samples
        vec3 an = abs(normalize(vWNorm));
        float wallW = clamp(1.0 - an.y * 1.45, 0.0, 1.0);
        float axisW = an.x / max(1e-4, an.x + an.z);
        vec3 rockFlat = texture2D(uRock, tuv * 0.6).rgb;
        vec3 rockWall = mix(
          texture2D(uRock, vWPos.xy * 0.132).rgb,
          texture2D(uRock, vWPos.zy * 0.132).rgb,
          axisW);
        vec3 rockAlb = mix(rockFlat, rockWall, wallW);
        vec3 alb = grassAlb * wSplat.x
                 + dirtAlb * wSplat.y
                 + rockAlb * wSplat.z
                 + texture2D(uSand, tuv).rgb * wSplat.w;
        // snow cover on the peaks/rim, by baked per-vertex weight — faded by
        // the fragment paint coverage like every other auto feature
        alb = mix(alb, texture2D(uSnow, tuv * 0.7).rgb, vExtra.y * (1.0 - pw));
        // gentle macro brightness swing breaks distant tiling
        float macro = mix(0.92, 1.08, texture2D(uMacro, vWPos.xz * 0.012).r);
        // Meteor impact terrain is authored by the same crater profile as the
        // heightfield. Apply it in albedo space so the PBR textures do not wash
        // the crater floor back toward marsh sand.
        vec3 impactAlb = mix(vec3(0.20, 0.08, 0.035), vec3(0.055, 0.040, 0.032), vExtra.w);
        alb = mix(alb, impactAlb, clamp(vExtra.z * 0.86 + vExtra.w * 0.18, 0.0, 0.96));
        // very-low-frequency hue drift (~100u wavelength) keeps distant
        // hills from flattening into one uniform lawn green
        float macro2 = texture2D(uMacro, vWPos.xz * 0.0045 + 0.37).r;
        alb = mix(alb, alb * vec3(1.07, 1.03, 0.86), (macro2 - 0.5) * 0.5 * wSplat.x);
        // imported ground textures: painted swatch weights tile the maker's
        // own images over everything above (soft edges from the paint field).
        // Sampled unconditionally: texture2D inside a non-uniform branch has
        // undefined derivatives; weight 0 makes the mix identity.
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTile.x, vec2(0.0, 0.0)), pCustomW.x);
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTile.y, vec2(0.25, 0.0)), pCustomW.y);
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTile.z, vec2(0.5, 0.0)), pCustomW.z);
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTile.w, vec2(0.75, 0.0)), pCustomW.w);
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTileB.x, vec2(0.0, 0.5)), pCustomW2.x);
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTileB.y, vec2(0.25, 0.5)), pCustomW2.y);
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTileB.z, vec2(0.5, 0.5)), pCustomW2.z);
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTileB.w, vec2(0.75, 0.5)), pCustomW2.w);
        // color swatches HUE-TINT the ground: recolor the underlying texture
        // toward the painted hue while KEEPING its own light/dark detail AND its
        // overall brightness, so the texture reads exactly as it did below, only
        // color-shifted. (The old vColor*lum*2.2 overdrive multiplied the
        // texture's brightness back in, blowing bright detail past 1.0 to WHITE
        // and discarding the texture's real color, so it never truly kept it.)
        vec3 wocLumW = vec3(0.299, 0.587, 0.114);
        float wocTexLum = dot(alb, wocLumW);
        float wocPaintLum = max(dot(paintTint, wocLumW), 1e-4);
        vec3 wocHue = paintTint / wocPaintLum;                // hue direction (avg ~1)
        vec3 wocRecolor = alb * mix(vec3(1.0), wocHue, 0.85); // recolor around the texel
        // Snap the result back to the texture's OWN luminance so nothing bright-
        // ens or darkens overall -- only the hue moves.
        wocRecolor *= wocTexLum / max(dot(wocRecolor, wocLumW), 1e-4);
        // If a saturated hue drives a channel past 1.0, desaturate that texel
        // toward its own grey (never a hard white clamp), so bright areas keep
        // detail instead of blowing out.
        float wocPeak = max(max(wocRecolor.r, wocRecolor.g), wocRecolor.b);
        float wocFit = clamp((wocPeak - 1.0) / max(wocPeak - wocTexLum, 1e-4), 0.0, 1.0);
        wocRecolor = mix(wocRecolor, vec3(wocTexLum), wocFit);
        alb = mix(alb, wocRecolor, pFlat);
        // Swatch hue/light adjust (paint-field layer 3): signed values ride
        // two premultiplied channels each, so they blur linearly and fade to
        // zero (a bit-exact no-op) with the stroke's own coverage. Applied to
        // the FINAL albedo, so it recolors built-in biome textures, imported
        // textures, and flat swatches alike.
        float wocHueA = (pAdjust.x - pAdjust.y) * PI;
        alb = wocHueRotate(alb, wocHueA);
        float wocLightA = pAdjust.z - pAdjust.w;
        alb = mix(alb, vec3(1.0), max(wocLightA, 0.0) * 0.75);
        alb *= 1.0 + min(wocLightA, 0.0) * 0.75;
        // real albedo carries the hue now; the ground tint only modulates
        // gently so the biome painting (roads, hub discs, snowline) still
        // reads. The tint itself blends from the AUTO vertex color to the
        // painted tint by the fragment-resolution paint coverage, so painted
        // color arrives at paint-cell resolution too. (Both were authored as
        // full sRGB ground colors, so re-centre around 1.0 before multiplying.)
        vec3 groundTint = mix(vColor.rgb, paintTint, pw);
        vec3 vtint = clamp(groundTint * 2.0, 0.0, 2.0);
        diffuseColor.rgb *= alb * mix(vec3(1.0), vtint, 0.35 * (1.0 - pFlat)) * macro;`,
      )
      .replace(
        '#include <color_fragment>',
        `
        // vertex color already folded into the splat albedo above (gently);
        // the stock full multiply would re-tint the real textures to mush`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `
        float roughnessFactor = roughness * mix(
          dot(wSplat, vec4(${ROUGH_GRASS}, mix(${ROUGH_DIRT}, ${ROUGH_MUD}, vExtra.x), ${ROUGH_ROCK}, ${ROUGH_SAND})),
          ${ROUGH_SNOW}, vExtra.y * (1.0 - pw));`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // per-layer detail normals (GL-convention), weighted by splat
        vec3 gN = texture2D(uGrassN, tuv).xyz * 2.0 - 1.0;
        vec3 dN = texture2D(uDirtN, tuv * 0.8).xyz * 2.0 - 1.0;
        vec3 rN = texture2D(uRockN, tuv * 0.6).xyz * 2.0 - 1.0;
        vec3 sN = texture2D(uSandN, tuv).xyz * 2.0 - 1.0;
        vec2 detN = gN.xy * wSplat.x * 0.65
                  + dN.xy * wSplat.y * 0.8
                  + rN.xy * wSplat.z * 0.9 * (1.0 - wallW)
                  + sN.xy * wSplat.w * 0.55;
        detN *= 1.0 - vExtra.y * (1.0 - pw) * 0.7; // snow softens the relief beneath it
        normal = normalize(normal + tbn * vec3(detN, 0.0));
        // cliffs: wall-projected rock normal so steep faces get real relief
        // (approximate world-space tangent frames per projection plane; the
        // handedness flip on back faces is invisible on noisy rock)
        if (wSplat.z * wallW > 0.01) {
          vec3 rNx = texture2D(uRockN, vWPos.zy * 0.132).xyz * 2.0 - 1.0; // +-x faces
          vec3 rNz = texture2D(uRockN, vWPos.xy * 0.132).xyz * 2.0 - 1.0; // +-z faces
          vec3 wallPerturb = mix(vec3(rNz.x, rNz.y, 0.0), vec3(0.0, rNx.y, rNx.x), axisW);
          normal = normalize(normal + mat3(viewMatrix) * wallPerturb * (wSplat.z * wallW * 0.8));
        }`,
      );
  };
  return mat;
}

function buildLambertMaterial(brush: BrushUniforms): THREE.MeshLambertMaterial {
  const detail = groundDetailTexture();
  // strip-planar uv: keep the legacy ~2.25u texture period in both axes
  detail.repeat.set(160, 480);
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: detail,
    emissive: GFX.lowPlus ? 0x182014 : 0x000000,
    emissiveIntensity: GFX.lowPlus ? 0.08 : 1,
    side: THREE.DoubleSide,
  });
  // The Lambert tier has no world-position varying of its own, so the brush
  // patch carries one (r165 chunk names; same idiom as the splat patch above).
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, brush);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWocWPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWocWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWocWPos;
        ${BRUSH_RING_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += wocBrushRing(vWocWPos.xz);`,
      );
    injectHoleDiscard(sh, 'vWocWPos');
  };
  return mat;
}

function buildBlankMaterial(brush: BrushUniforms): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: GFX.lowPlus ? 0x11160f : 0x000000,
    emissiveIntensity: GFX.lowPlus ? 0.05 : 1,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, brush);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWocWPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWocWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWocWPos;
        ${BRUSH_RING_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += wocBrushRing(vWocWPos.xz);`,
      );
    injectHoleDiscard(sh, 'vWocWPos');
  };
  return mat;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface EnsureZoneOptions {
  /** Build the cells nearest this point first (e.g. the entry position).
   *  Falls back to buildTerrain's priorityPoint when omitted. */
  priority?: { x: number; z: number };
  /** 'fast' (default): the caller is gating on the result (boot, a teleport
   *  behind the loading screen), so yield only between small batches.
   *  'idle': a background prepare; every batch waits for a browser idle slot
   *  (requestIdleCallback with a forced-progress timeout) so the build never
   *  steals time an interactive frame needs. */
  pace?: 'fast' | 'idle';
}

export interface TerrainView {
  group: THREE.Group;
  /** Materialize one overworld zone. Repeated calls share the cached task. */
  ensureZone(
    zone: ZoneDef,
    onProgress?: (done: number, total: number) => void,
    opts?: EnsureZoneOptions,
  ): Promise<void>;
  isZoneLoaded(zoneId: string): boolean;
  /** hides chunks that sit entirely past the fog far plane */
  update(camX: number, camZ: number, fogFar: number): void;
  /**
   * Editor-only: re-mesh ONLY the chunks intersecting the world-space region
   * (a sculpt brush footprint), swapping each geometry in place on the existing
   * mesh (old geometry disposed, shared material kept). Cheap enough to run
   * several times per second during a brush drag; the stale macro normal
   * texture is NOT touched here (see rebakeNormalRegion, for stroke end).
   */
  rebuildRegion(minX: number, minZ: number, maxX: number, maxZ: number): void;
  /**
   * Editor-only: rebake the region's texels of the macro normal DataTexture
   * from the current terrainHeight and flag it for re-upload. Byte-identical
   * to a full bake over those texels. Call at stroke end, never per drag
   * sample. No-op on the Lambert tier (it has no normal map).
   */
  rebakeNormalRegion(minX: number, minZ: number, maxX: number, maxZ: number): void;
  /**
   * Editor-only: project the brush ring at world (x, z) with the given radius
   * (yards) onto both terrain materials. Writes uniform values only (no
   * material rebuild). Radius <= 0 hides the ring, as does clearBrush().
   */
  setBrush(x: number, z: number, radius: number, color?: THREE.ColorRepresentation): void;
  /** Editor-only: hide the brush ring. */
  clearBrush(): void;
  /**
   * Stops any in-flight ensureZone build from adding further chunks. Call
   * before discarding this view (see renderer rebuildTerrain), or the
   * abandoned zone builds keep running on a setTimeout chain.
   */
  cancelStreaming(): void;
}

export function buildTerrain(seed: number, priorityPoint?: { x: number; z: number }): TerrainView {
  const lowGfx = !GFX.terrainSplat || !hasTerrainSplatAssets();
  refreshCustomGroundTextures();
  // Hole cutouts ride shared uniforms: seed them from the active world before
  // the material build so a loaded map's holes show from the first frame.
  refreshTerrainHoles();
  // Full paint-field bake AFTER the custom-texture refresh (the bake reads the
  // textured-swatch slot order) and BEFORE the material build (the uniforms
  // are module-shared, so the swap lands in every past and future material).
  if (!lowGfx) refreshPaintField();
  const brush = makeBrushUniforms();
  const normalTex = lowGfx ? null : terrainNormalTexture();
  const mat = normalTex ? buildSplatMaterial(normalTex, brush) : buildLambertMaterial(brush);
  const bands = lowGfx ? LOD_BANDS.low : LOD_BANDS.high;
  const group = new THREE.Group();
  group.name = 'terrain';
  const rb = renderBounds();
  const chunksX = Math.ceil(rb.width / CHUNK_SIZE);
  const chunksZ = Math.ceil(rb.depth / CHUNK_SIZE);
  // x/z/half feed the per-frame fog cull; x0/z0/size/spacing are the exact
  // buildChunkGeometry inputs, kept so an editor rebuild re-runs the same build.
  const chunks: {
    mesh: THREE.Mesh;
    x: number;
    z: number;
    half: number;
    x0: number;
    z0: number;
    sizeX: number;
    sizeZ: number;
    spacing: number;
  }[] = [];

  // True when the chunk cell overlaps a mountain-wall band: an inter-zone
  // ridge line (ZONES[i].zMax) or the world rim. Those chunks always take the
  // densest band; the walls sit far from every hub, so hub-distance LOD alone
  // hands the steepest, most looked-at cliffs the coarsest grid.
  const wallChunkAt = (x0: number, z0: number, size: number): boolean => {
    if (x0 < -WORLD_MAX_X + WALL_LOD_RIM_MARGIN || x0 + size > WORLD_MAX_X - WALL_LOD_RIM_MARGIN) {
      return true;
    }
    if (z0 < WORLD_MIN_Z + WALL_LOD_RIM_MARGIN || z0 + size > WORLD_MAX_Z - WALL_LOD_RIM_MARGIN) {
      return true;
    }
    for (let i = 0; i + 1 < ZONES.length; i++) {
      const ridgeZ = ZONES[i].zMax;
      if (z0 - WALL_LOD_RIDGE_HALF < ridgeZ && z0 + size + WALL_LOD_RIDGE_HALF > ridgeZ) {
        return true;
      }
    }
    return false;
  };

  const bandIndexAt = (cx: number, cz: number): number => {
    const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
    const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
    if (wallChunkAt(x0, z0, CHUNK_SIZE)) return 0;
    const centerX = x0 + CHUNK_SIZE / 2;
    const centerZ = z0 + CHUNK_SIZE / 2;
    let hubDist = Infinity;
    for (const zn of ZONES) {
      hubDist = Math.min(hubDist, Math.hypot(centerX - zn.hub.x, centerZ - zn.hub.z));
    }
    const idx = bands.findIndex((b) => hubDist <= b.maxHubDist);
    return idx === -1 ? bands.length - 1 : idx;
  };

  // the coarsest spacing any neighbor chunk can have; sizes the slope-aware
  // skirt drop so a fine chunk's skirt always reaches past the coarsest
  // neighbor's chord (and vice versa)
  const skirtSpan = bands[bands.length - 1].spacing;

  const addChunk = (x0: number, z0: number, size: number, spacing: number): void => {
    const geo = buildChunkGeometry(x0, z0, size, spacing, seed, !lowGfx, skirtSpan);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    // A chunk's transform never changes after this point (its shape lives in
    // the geometry, not the mesh matrix), so it can freeze immediately rather
    // than waiting for the caller's group-wide freezeStaticMatrices pass.
    // That pass only runs once, right after the synchronous near ring returns,
    // so every chunk streamed in afterward (the majority, on the far bands)
    // would otherwise keep matrixAutoUpdate = true and recompose every frame
    // for the rest of the session.
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    chunks.push({
      mesh,
      x: x0 + sizeX / 2,
      z: z0 + sizeZ / 2,
      half: Math.max(sizeX, sizeZ) / 2,
      x0,
      z0,
      sizeX,
      sizeZ,
      spacing,
    });
  };

  // far-LOD cells merge 2x2 into super-chunks: the far field is where draw
  // count hurts and culling granularity matters least
  const farBand = bands.length - 1;
  const built = new Set<number>();
  const loadedZones = new Set<string>();
  const pendingZones = new Map<string, Promise<void>>();
  // Set by cancelStreaming(): every in-flight ensureZone loop bails at its next
  // yield point without marking its zone loaded, so a discarded view (see
  // renderer rebuildTerrain) stops adding chunks instead of building on a
  // setTimeout chain for the rest of the session.
  let cancelled = false;
  const cellOwnerId = (cx: number, cz: number): string | null => {
    const x = -WORLD_MAX_X + (cx + 0.5) * CHUNK_SIZE;
    const z = WORLD_MIN_Z + (cz + 0.5) * CHUNK_SIZE;
    // zoneAt deliberately clamps gaps/out-of-bounds positions to the nearest
    // playable zone. Terrain ownership must not: otherwise asking for one
    // column can accidentally materialize chunks in an empty neighbouring
    // column merely because that zone is the fallback for the same z band.
    return (
      ZONES.find(
        (candidate) =>
          z >= candidate.zMin &&
          z < candidate.zMax &&
          x >= (candidate.xMin ?? STRIP_MIN_X) &&
          x < (candidate.xMax ?? STRIP_MAX_X),
      )?.id ?? null
    );
  };
  const zoneCells = (zone: ZoneDef): [number, number][] => {
    const out: [number, number][] = [];
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        if (cellOwnerId(cx, cz) === zone.id) out.push([cx, cz]);
      }
    }
    return out;
  };
  const yieldBuild = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  // Background ('idle') builds advance one batch per idle slot instead: the
  // timeout still forces progress under sustained load, so a later gating
  // caller awaiting the same shared task is never starved indefinitely.
  const yieldIdle = (): Promise<void> => idleSlot(IDLE_BUILD_TIMEOUT_MS);
  const normalBoundsFor = (zone: ZoneDef) =>
    normalTexelBounds(
      zone.xMin ?? STRIP_MIN_X,
      zone.zMin,
      zone.xMax ?? STRIP_MAX_X,
      zone.zMax,
      -WORLD_MAX_X,
      WORLD_MIN_Z,
      WORLD_MAX_X * 2,
      WORLD_MAX_Z - WORLD_MIN_Z,
      NORMAL_TEX_W,
      NORMAL_TEX_H,
      1,
    );
  const ensureZone = (
    zone: ZoneDef,
    onProgress?: (done: number, total: number) => void,
    opts?: EnsureZoneOptions,
  ): Promise<void> => {
    if (loadedZones.has(zone.id)) {
      onProgress?.(1, 1);
      return Promise.resolve();
    }
    const pending = pendingZones.get(zone.id);
    if (pending) return pending;
    const idlePace = opts?.pace === 'idle';
    const yieldSlice = idlePace ? yieldIdle : yieldBuild;
    // An idle build works one cell per idle slot (a gating build races in
    // batches of four): measured on the walked-crossing harness, dense-band
    // 60 yd chunks cost ~75 ms of main-thread geometry each, so idle pace
    // additionally quarters them below (4 x 30 yd sub-chunks of ~20 ms).
    const cellsPerSlice = idlePace ? 1 : 4;
    const task = (async () => {
      const cells = zoneCells(zone);
      // A player can enter a zone anywhere, not just at its hub (a returning
      // character's logout spot, a walked boundary crossing), so row-major
      // order alone can leave them standing on not-yet-built terrain. Pull the
      // cells around the actual entry point (this call's priority, falling
      // back to the view's construction point) to the front, sorted by
      // distance, so the chunk directly underfoot builds first. Only that
      // bounded neighbourhood is reordered: the rest keeps row-major order so
      // the far-band 2x2 super-chunk merge still forms.
      const entryPoint = opts?.priority ?? priorityPoint;
      if (entryPoint) {
        const cellDist = ([cx, cz]: [number, number]): number =>
          Math.hypot(
            -WORLD_MAX_X + (cx + 0.5) * CHUNK_SIZE - entryPoint.x,
            WORLD_MIN_Z + (cz + 0.5) * CHUNK_SIZE - entryPoint.z,
          );
        const nearby = cells.filter((cell) => cellDist(cell) <= CHUNK_SIZE * 3);
        if (nearby.length > 0) {
          nearby.sort((a, b) => cellDist(a) - cellDist(b));
          const nearbySet = new Set(nearby);
          const rest = cells.filter((cell) => !nearbySet.has(cell));
          cells.length = 0;
          cells.push(...nearby, ...rest);
        }
      }
      const normalBounds = normalTex ? normalBoundsFor(zone) : null;
      const rowsPerSlice = 12;
      const normalSlices = normalBounds
        ? Math.ceil((normalBounds.j1 - normalBounds.j0 + 1) / rowsPerSlice)
        : 0;
      const total = Math.max(1, normalSlices + cells.length);
      let done = 0;
      if (normalTex && normalBounds) {
        for (let j = normalBounds.j0; j <= normalBounds.j1; j += rowsPerSlice) {
          if (cancelled) return;
          bakeNormalRegion(
            normalTex.image.data as Uint8Array,
            seed,
            normalBounds.i0,
            normalBounds.i1,
            j,
            Math.min(normalBounds.j1, j + rowsPerSlice - 1),
          );
          onProgress?.(++done, total);
          await yieldSlice();
        }
        normalTex.needsUpdate = true;
      }
      for (const [cx, cz] of cells) {
        if (cancelled) return;
        const cell = cz * chunksX + cx;
        // Idle pace splits a dense-band (near or mid LOD) cell into four
        // half-size sub-chunks, one per idle slot: a full dense 60 yd chunk
        // costs ~75 ms of geometry on the main thread (the walked-crossing
        // hitch), a 30 yd quarter ~20 ms. Skirts make the extra seams
        // invisible, exactly like the far-band super-chunk merge in reverse;
        // only the handful of dense cells per zone pay the extra draw calls.
        const bandIdx = bandIndexAt(cx, cz);
        if (idlePace && bandIdx < farBand && !built.has(cell)) {
          built.add(cell);
          const half = CHUNK_SIZE / 2;
          const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
          const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
          for (const [qx, qz] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ] as const) {
            if (cancelled) return;
            addChunk(x0 + qx * half, z0 + qz * half, half, bands[bandIdx].spacing);
            await yieldSlice();
          }
          onProgress?.(++done, total);
          continue;
        }
        if (!built.has(cell)) {
          const superCells = [
            [cx, cz],
            [cx + 1, cz],
            [cx, cz + 1],
            [cx + 1, cz + 1],
          ] as const;
          const superOk =
            cx % 2 === 0 &&
            cz % 2 === 0 &&
            cx + 1 < chunksX &&
            cz + 1 < chunksZ &&
            superCells.every(
              ([sx, sz]) =>
                cellOwnerId(sx, sz) === zone.id &&
                !built.has(sz * chunksX + sx) &&
                bandIndexAt(sx, sz) === farBand,
            );
          if (superOk) {
            for (const [sx, sz] of superCells) built.add(sz * chunksX + sx);
            addChunk(
              -WORLD_MAX_X + cx * CHUNK_SIZE,
              WORLD_MIN_Z + cz * CHUNK_SIZE,
              CHUNK_SIZE * 2,
              bands[farBand].spacing,
            );
          } else {
            built.add(cell);
            addChunk(
              -WORLD_MAX_X + cx * CHUNK_SIZE,
              WORLD_MIN_Z + cz * CHUNK_SIZE,
              CHUNK_SIZE,
              bands[bandIndexAt(cx, cz)].spacing,
            );
          }
        }
        onProgress?.(++done, total);
        if (done % cellsPerSlice === 0) await yieldSlice();
      }
      loadedZones.add(zone.id);
      onProgress?.(total, total);
    })().finally(() => pendingZones.delete(zone.id));
    pendingZones.set(zone.id, task);
    return task;
  };
  return {
    group,
    ensureZone,
    isZoneLoaded: (zoneId: string) => loadedZones.has(zoneId),
    cancelStreaming(): void {
      cancelled = true;
    },
    update(camX: number, camZ: number, fogFar: number): void {
      // fully-fogged chunks are pure overdraw; drop them before the frustum
      for (const chunk of chunks) {
        const dx = Math.max(Math.abs(camX - chunk.x) - chunk.half, 0);
        const dz = Math.max(Math.abs(camZ - chunk.z) - chunk.half, 0);
        chunk.mesh.visible = Math.hypot(dx, dz) < fogFar;
      }
    },
    rebuildRegion(minX: number, minZ: number, maxX: number, maxZ: number): void {
      // Paint edits land here per drag sample: rebake the region's paint-field
      // texels first (that is what the splat fragment path actually renders;
      // idempotent and cheap when the region only sculpted heights).
      if (!lowGfx) rebakePaintFieldRegion(minX, minZ, maxX, maxZ);
      // No allocation beyond the replacement geometries: the chunk list is
      // scanned in place and only intersecting chunks re-mesh.
      for (const chunk of chunks) {
        const maxSize = Math.max(chunk.sizeX, chunk.sizeZ);
        if (!chunkIntersectsRegion(chunk.x0, chunk.z0, maxSize, minX, minZ, maxX, maxZ)) {
          continue;
        }
        const geo = buildChunkGeometry(
          chunk.x0,
          chunk.z0,
          chunk.sizeX,
          chunk.sizeZ,
          chunk.spacing,
          seed,
          !lowGfx,
          skirtSpan,
        );
        chunk.mesh.geometry.dispose();
        chunk.mesh.geometry = geo; // bounding box/sphere already computed by the build
      }
    },
    rebakeNormalRegion(minX: number, minZ: number, maxX: number, maxZ: number): void {
      if (!normalTex) return; // Lambert tier: no macro normal map
      // margin 1: texels just outside the region read sculpted heights through
      // the derivative stencil, so they go stale too.
      const bounds = normalTexelBounds(
        minX,
        minZ,
        maxX,
        maxZ,
        rb.minX,
        rb.minZ,
        rb.width,
        rb.depth,
        NORMAL_TEX_W,
        NORMAL_TEX_H,
        1,
      );
      if (!bounds) return;
      bakeNormalRegion(
        normalTex.image.data as Uint8Array,
        seed,
        bounds.i0,
        bounds.i1,
        bounds.j0,
        bounds.j1,
      );
      normalTex.needsUpdate = true;
    },
    setBrush(x: number, z: number, radius: number, color?: THREE.ColorRepresentation): void {
      brush.uBrushCenter.value.set(x, z);
      brush.uBrushRadius.value = Math.max(0, radius);
      if (color !== undefined) brush.uBrushColor.value.set(color);
    },
    clearBrush(): void {
      brush.uBrushRadius.value = 0;
    },
  };
}
