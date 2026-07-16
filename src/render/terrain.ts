import * as THREE from 'three';
import { getActiveWorldContent, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z, ZONES } from '../sim/data';
import { fbm2 } from '../sim/rng';
import type { BiomeId, CustomPaintSwatch } from '../sim/types';
import {
  BIOME_BY_ID,
  biomeAt,
  paintedCellIdAt,
  roadDistance,
  terrainHeight,
  waterLevel,
  waterLevelAt,
  zoneBiomeAt,
} from '../sim/world';
import { groundImageFor } from './assets/ground_textures';
import { loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX } from './gfx';
import { runIdleQueue } from './idle_queue';
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

// terrain normal map resolution (~0.56u per texel over 360x1080)
const NORMAL_TEX_W = 640;
const NORMAL_TEX_H = 1920;
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
  // Darker, murkier and more desaturated than the vale so the swamp reads as
  // gloomy lowland rather than "vale but slightly duller". Pushed further
  // toward drab olive/brown than a first pass so it reads at a glance.
  marsh: {
    grass: 0x3f4d28,
    grassDark: 0x2c3a1e,
    grassYellow: 0x505c34,
    dirt: 0x4f4028,
    sand: 0x655741,
  },
  // Cooler and greyer than the vale/marsh's warm greens, pushing toward sage
  // and stone since altitude thins out the lush growth. Pushed further blue-
  // grey than a first pass so peaks are unmistakably a different biome.
  peaks: {
    grass: 0x7a8878,
    grassDark: 0x5c6862,
    grassYellow: 0x9aa192,
    dirt: 0x8a7d6a,
    sand: 0xbdb49c,
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
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

interface VertexSample {
  height: number;
  slope: number;
  normal: [number, number, number];
  color: [number, number, number];
  splat: [number, number, number, number]; // grass, dirt, rock, sand
  extra: [number, number, number, number]; // mud, snow, impact scorch, impact ash
  custom: [number, number, number, number]; // imported ground-texture weights (slots 0..3)
  // Flat-color swatch weight: 1 = the vertex color IS the ground color (the
  // splat textures are fully overridden by the painted flat color).
  flat: number;
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

// Per-biome palettes for painted cells (a flat lookup, no z-blend).
const biomePalettes: Record<BiomeId, (typeof zonePalettes)[number]> = {
  vale: makeBiomePalette('vale'),
  marsh: makeBiomePalette('marsh'),
  peaks: makeBiomePalette('peaks'),
  beach: makeBiomePalette('beach'),
  desert: makeBiomePalette('desert'),
  volcano: makeBiomePalette('volcano'),
  cave: makeBiomePalette('cave'),
};
function makeBiomePalette(b: BiomeId): (typeof zonePalettes)[number] {
  const p = BIOME_PALETTE[b];
  return {
    grass: new THREE.Color(p.grass),
    grassDark: new THREE.Color(p.grassDark),
    grassYellow: new THREE.Color(p.grassYellow),
    dirt: new THREE.Color(p.dirt),
    sand: new THREE.Color(p.sand),
  };
}

function isBlankSlateWorld(): boolean {
  return getActiveWorldContent().presentationMode === 'blank';
}

// The world rect the terrain mesh covers, derived from the ACTIVE content
// (custom maps carry their own zone bands and optional worldHalfX), so a sized
// blank map renders exactly its own ground and nothing beyond. For the
// built-in world these equal the WORLD_* constants (byte-identical build).
interface RenderBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
}
let renderBoundsCache: { content: unknown; b: RenderBounds } | null = null;
function renderBounds(): RenderBounds {
  const content = getActiveWorldContent();
  if (!renderBoundsCache || renderBoundsCache.content !== content) {
    const halfX = content.worldHalfX ?? WORLD_MAX_X;
    const zones = content.zones;
    const minZ = zones.length > 0 ? zones[0].zMin : WORLD_MIN_Z;
    const maxZ = zones.length > 0 ? zones[zones.length - 1].zMax : WORLD_MAX_Z;
    renderBoundsCache = {
      content,
      b: { minX: -halfX, maxX: halfX, minZ, maxZ, width: halfX * 2, depth: maxZ - minZ },
    };
  }
  return renderBoundsCache.b;
}

// Custom paint swatches (maker-defined palette colors): a flat palette derived
// from the one authored color, cached per color so the per-vertex loop stays
// allocation-free. Custom cells are color-only (shape and sim biome stay the
// zone band's; see sim/world.ts paintedBiomeAt).
const customPalettes = new Map<number, (typeof zonePalettes)[number]>();
function customPaletteFor(color: number): (typeof zonePalettes)[number] {
  let p = customPalettes.get(color);
  if (!p) {
    const base = new THREE.Color(color);
    p = {
      grass: base.clone(),
      grassDark: base.clone().multiplyScalar(0.72),
      grassYellow: base.clone().lerp(new THREE.Color(0xfff2c0), 0.25),
      dirt: base.clone().multiplyScalar(0.82),
      sand: base.clone().lerp(new THREE.Color(0xffffff), 0.3),
    };
    customPalettes.set(color, p);
  }
  return p;
}

// ---- imported ground textures (custom swatch splatting) ---------------------
//
// Up to four custom swatches with a textureSha get a REAL tiling texture in
// the splat material: sampleVertex bakes each one's smooth paint weight into
// the aCustom vec4 (slot = the swatch's order among textured swatches), and
// the fragment shader mixes `texture2D(uCustomN, worldXZ / tileSize)` in by
// that weight. Slots resolve from the ACTIVE content, so the editor and a
// playtest of the same map agree. Uniforms are module-shared: the material
// installs them once and refreshCustomGroundTextures() swaps values in place
// (no recompile) whenever a texture loads or the tiling changes.

export const MAX_CUSTOM_GROUND_TEXTURES = 4;

// One 2x2 ATLAS holds all four custom textures (the splat shader already sits
// near MAX_TEXTURE_IMAGE_UNITS, so per-slot samplers do not fit): each slot
// owns a quadrant, the shader wraps its tiling uv with fract() inside it.
// Mipmaps are disabled so quadrants never bleed into each other.
const ATLAS_CELL = 512;
let atlasCanvas: HTMLCanvasElement | null = null;
let atlasTexture: THREE.CanvasTexture | null = null;
const customAtlasUniform = { value: null as THREE.Texture | null };
const customTileUniform = { value: new THREE.Vector4(1 / 8, 1 / 8, 1 / 8, 1 / 8) };
let atlasRefreshGen = 0;

function ensureAtlas(): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  if (!atlasCanvas || !atlasTexture) {
    atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = ATLAS_CELL * 2;
    atlasCanvas.height = ATLAS_CELL * 2;
    atlasTexture = new THREE.CanvasTexture(atlasCanvas);
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
    atlasTexture.flipY = false; // uv y == canvas y, so quadrant math is direct
    atlasTexture.generateMipmaps = false;
    atlasTexture.minFilter = THREE.LinearFilter;
    atlasTexture.magFilter = THREE.LinearFilter;
    customAtlasUniform.value = atlasTexture;
  }
  return { canvas: atlasCanvas, texture: atlasTexture };
}

/** The textured custom swatches of the active content, in slot order. */
function texturedSwatches(): CustomPaintSwatch[] {
  const custom = getActiveWorldContent().biomePaint?.custom;
  if (!custom) return [];
  const out: CustomPaintSwatch[] = [];
  for (const sw of custom) {
    if (sw.textureSha) {
      out.push(sw);
      if (out.length >= MAX_CUSTOM_GROUND_TEXTURES) break;
    }
  }
  return out;
}

/** The custom-texture slot for a swatch id, or -1 (untextured / overflow). */
function customTextureSlotFor(id: number): number {
  const slots = texturedSwatches();
  for (let i = 0; i < slots.length; i++) if (slots[i].id === id) return i;
  return -1;
}

/**
 * Redraw the custom-texture atlas from the active content's textured swatches:
 * each slot's quadrant gets the flat fallback color immediately and the real
 * IndexedDB image when it resolves. Called at terrain build and by the editor
 * after importing a texture or changing a swatch's tile size.
 */
export function refreshCustomGroundTextures(): void {
  const slots = texturedSwatches();
  if (slots.length === 0) return; // nothing painted with textures yet
  const { canvas, texture } = ensureAtlas();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const gen = ++atlasRefreshGen;
  const tile = customTileUniform.value;
  const quad = (i: number): { x: number; y: number } => ({
    x: (i % 2) * ATLAS_CELL,
    y: Math.floor(i / 2) * ATLAS_CELL,
  });
  for (let i = 0; i < MAX_CUSTOM_GROUND_TEXTURES; i++) {
    const sw = slots[i];
    const q = quad(i);
    const size = sw?.tileSize && sw.tileSize > 0 ? sw.tileSize : 8;
    if (i === 0) tile.x = 1 / size;
    else if (i === 1) tile.y = 1 / size;
    else if (i === 2) tile.z = 1 / size;
    else tile.w = 1 / size;
    ctx.fillStyle = sw ? `#${sw.color.toString(16).padStart(6, '0')}` : '#000000';
    ctx.fillRect(q.x, q.y, ATLAS_CELL, ATLAS_CELL);
    if (sw?.textureSha) {
      const sha = sw.textureSha;
      const slot = i;
      void groundImageFor(sha).then((img) => {
        // Stale if another refresh ran (slots may have reshuffled).
        if (!img || gen !== atlasRefreshGen || !atlasCanvas || !atlasTexture) return;
        const c2 = atlasCanvas.getContext('2d');
        if (!c2) return;
        const p2 = quad(slot);
        c2.drawImage(img, p2.x, p2.y, ATLAS_CELL, ATLAS_CELL);
        atlasTexture.needsUpdate = true;
      });
    }
  }
  texture.needsUpdate = true;
}

/** The authored color for a custom swatch id, or null. */
function customColorFor(id: number): number | null {
  const custom = getActiveWorldContent().biomePaint?.custom;
  if (!custom) return null;
  for (const s of custom) if (s.id === id) return s.color;
  return null;
}

// Smooth paint sample at (x,z): bilinear over the four nearest paint cells
// (by cell center), yielding the DOMINANT painted id and its blended weight.
// This is what turns the 8yd cell grid into a soft brush: colors and splat
// textures feather across one cell instead of cutting hard block edges.
// Allocation-free (module scratch); weight 0 = unpainted.
const paintSample = { id: null as number | null, weight: 0 };
// Radius (in cells) of the soft-edge kernel: the painted/unpainted coverage is
// averaged over a disc this wide with smooth weights, so a brush stroke fades
// out over ~2 cells (Photoshop soft edge) instead of stair-stepping one cell
// at the terrain vertices. The dominant painted id is still the nearest cell,
// so painted biomes keep crisp boundaries between each other.
const PAINT_SMOOTH_RADIUS = 2;
function paintSmoothAt(x: number, z: number): { id: number | null; weight: number } {
  paintSample.id = null;
  paintSample.weight = 0;
  const bp = getActiveWorldContent().biomePaint;
  if (!bp) return paintSample;
  // Cell-center-relative fractional coordinates (cell centers at integers).
  const gx = (x - bp.originX) / bp.cell - 0.5;
  const gz = (z - bp.originZ) / bp.cell - 0.5;
  const cc = Math.round(gx);
  const cr = Math.round(gz);
  // Fast path: if the nearest cell and its 8 neighbors agree (all the same
  // painted id, or all unpainted), the kernel result is that value with no
  // feather to compute. This is the overwhelming majority of vertices.
  const nearId =
    cc >= 0 && cc < bp.cols && cr >= 0 && cr < bp.rows ? bp.ids[cr * bp.cols + cc] : 255;
  let uniform = true;
  for (let dr = -1; dr <= 1 && uniform; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = cc + dc;
      const r = cr + dr;
      const id = c >= 0 && c < bp.cols && r >= 0 && r < bp.rows ? bp.ids[r * bp.cols + c] : 255;
      if (id !== nearId) {
        uniform = false;
        break;
      }
    }
  }
  if (uniform) {
    if (nearId === 255) return paintSample;
    paintSample.id = nearId;
    paintSample.weight = 1;
    return paintSample;
  }
  // Boundary vertex: smooth-weighted coverage over the disc, with the dominant
  // painted id taken from the nearest painted cell.
  const R = PAINT_SMOOTH_RADIUS;
  let wSum = 0;
  let wPainted = 0;
  let domId: number | null = null;
  let domD2 = Infinity;
  for (let dr = -R; dr <= R; dr++) {
    for (let dc = -R; dc <= R; dc++) {
      const c = cc + dc;
      const r = cr + dr;
      const ddx = c - gx;
      const ddz = r - gz;
      const d2 = ddx * ddx + ddz * ddz;
      // Smooth radial falloff (quadratic), zero past the kernel radius + 0.5.
      const rr = R + 0.5;
      if (d2 >= rr * rr) continue;
      const wght = 1 - d2 / (rr * rr);
      wSum += wght;
      if (c < 0 || c >= bp.cols || r < 0 || r >= bp.rows) continue;
      const id = bp.ids[r * bp.cols + c];
      if (id === 255) continue;
      wPainted += wght;
      if (d2 < domD2) {
        domD2 = d2;
        domId = id;
      }
    }
  }
  paintSample.id = domId;
  // The uniform fast path returns exactly 0 / 1, but the raw kernel ratio
  // asymptotes to ~1/6 (fully-unpainted seam) / ~5/6 (fully-painted seam), so a
  // straight edge would show a hard ~0.33 step where the two meet. Remap the
  // ratio through a smoothstep anchored on those seam bounds: it hits 0 and 1
  // exactly at the seam (matching the fast path, C1-smooth), and keeps a soft
  // interior fade.
  const ratio = wSum > 0 ? wPainted / wSum : 0;
  const SEAM_LO = 1 / 6;
  const SEAM_HI = 5 / 6;
  const tt = clamp01((ratio - SEAM_LO) / (SEAM_HI - SEAM_LO));
  paintSample.weight = tt * tt * (3 - 2 * tt);
  return paintSample;
}

// Palette at a point. A painted cell (biome differs from its zone band) uses that
// biome's flat palette; otherwise the smooth zone-band blend. With no paint layer
// `biome === zoneBiomeAt(z)` always, so this is the original z-blend exactly.
function paletteAt(_x: number, z: number, biome: BiomeId): void {
  if (biome !== zoneBiomeAt(z)) {
    const p = biomePalettes[biome];
    grassC.copy(p.grass);
    grassDarkC.copy(p.grassDark);
    grassYellowC.copy(p.grassYellow);
    dirtC.copy(p.dirt);
    sandC.copy(p.sand);
    return;
  }
  grassC.copy(zonePalettes[0].grass);
  grassDarkC.copy(zonePalettes[0].grassDark);
  grassYellowC.copy(zonePalettes[0].grassYellow);
  dirtC.copy(zonePalettes[0].dirt);
  sandC.copy(zonePalettes[0].sand);
  for (let i = 0; i + 1 < ZONES.length; i++) {
    const b = ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    grassC.lerp(zonePalettes[i + 1].grass, tt);
    grassDarkC.lerp(zonePalettes[i + 1].grassDark, tt);
    grassYellowC.lerp(zonePalettes[i + 1].grassYellow, tt);
    dirtC.lerp(zonePalettes[i + 1].dirt, tt);
    sandC.lerp(zonePalettes[i + 1].sand, tt);
  }
}

// How "marsh" a given z is — mirrors the palette/heightfield blend windows so
// the mud texture fades in exactly where the marsh palette does.
function marshWeightAt(z: number): number {
  let w = ZONES[0].biome === 'marsh' ? 1 : 0;
  for (let i = 0; i + 1 < ZONES.length; i++) {
    const b = ZONES[i].zMax;
    const t = clamp01((z - (b - 30)) / 65);
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    w += ((ZONES[i + 1].biome === 'marsh' ? 1 : 0) - w) * tt;
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
function sampleVertex(x: number, z: number, seed: number): VertexSample {
  const h = terrainHeight(x, z, seed);
  const hx = terrainHeight(x + SLOPE_EPS, z, seed) - terrainHeight(x - SLOPE_EPS, z, seed);
  const hz = terrainHeight(x, z + SLOPE_EPS, seed) - terrainHeight(x, z - SLOPE_EPS, seed);
  const slope = Math.sqrt(hx * hx + hz * hz) / (2 * SLOPE_EPS);
  const invLen = 1 / Math.hypot(hx / (2 * SLOPE_EPS), 1, hz / (2 * SLOPE_EPS));
  const normal: [number, number, number] = [
    -(hx / (2 * SLOPE_EPS)) * invLen,
    invLen,
    -(hz / (2 * SLOPE_EPS)) * invLen,
  ];

  // Smooth paint: the bilinear sample feathers painted color and splat
  // textures across a cell (soft brush edges) instead of hard block cuts.
  // Paint never touches the geometry (see sim/world.ts shapeAt).
  const paint = paintSmoothAt(x, z);
  const blank = isBlankSlateWorld();
  if (blank && paint.weight <= 0) {
    cTmp.copy(blankGroundC);
    return {
      height: h,
      slope,
      normal,
      color: [cTmp.r, cTmp.g, cTmp.b],
      splat: [1, 0, 0, 0],
      extra: [0, 0, 0, 0],
      custom: [0, 0, 0, 0],
      flat: 0,
    };
  }

  const zoneBiome = zoneBiomeAt(z);
  let paintedBiome: BiomeId | null = null;
  let customPaint: number | null = null;
  const customW: [number, number, number, number] = [0, 0, 0, 0];
  let flatW = 0;
  if (paint.id !== null) {
    if (paint.id < BIOME_BY_ID.length) paintedBiome = BIOME_BY_ID[paint.id];
    else {
      customPaint = customColorFor(paint.id);
      // An imported-texture swatch bakes its smooth weight into its slot; the
      // shader tiles the real image there (color fallback until it loads).
      // A COLOR-ONLY swatch bakes a HUE-TINT weight instead: the shader keeps
      // the underlying ground texture's luminance detail and recolors it with
      // the painted hue (vColor), so picking a color never flattens the
      // ground into a solid fill.
      const slot = customTextureSlotFor(paint.id);
      if (slot >= 0) customW[slot] = paint.weight;
      else flatW = paint.weight;
    }
  }
  const pw = paintedBiome !== null || customPaint !== null ? paint.weight : 0;
  // Discrete biome for the threshold-style rules below (rock slope, marsh mud):
  // the painted biome once it dominates the blend.
  const biome = pw > 0.5 && paintedBiome ? paintedBiome : zoneBiome;
  // Auto-texturing rules: per-map toggles (absent = all on, the shipped look),
  // and painted ground always suppresses them (what you paint is what you
  // get), so cliffs and snow caps stop eating brush strokes.
  const style = getActiveWorldContent().terrainStyle;
  const slopeRockOn = style?.slopeRock !== false;
  const snowCapsOn = style?.snowCaps !== false;
  const rimOn = style?.rimMountains !== false;
  const shoreSandOn = style?.shoreSand !== false;
  const autoW = 1 - pw;
  paletteAt(x, z, zoneBiome);
  if (paintedBiome !== null && pw > 0) {
    const p = biomePalettes[paintedBiome];
    grassC.lerp(p.grass, pw);
    grassDarkC.lerp(p.grassDark, pw);
    grassYellowC.lerp(p.grassYellow, pw);
    dirtC.lerp(p.dirt, pw);
    sandC.lerp(p.sand, pw);
  } else if (customPaint !== null && pw > 0) {
    const p = customPaletteFor(customPaint);
    grassC.lerp(p.grass, pw);
    grassDarkC.lerp(p.grassDark, pw);
    grassYellowC.lerp(p.grassYellow, pw);
    dirtC.lerp(p.dirt, pw);
    sandC.lerp(p.sand, pw);
  }
  const w: [number, number, number, number] = [1, 0, 0, 0];
  // Painted ground re-bases the splat mix toward its biome's dominant texture
  // layer, scaled by the smooth paint weight so the texture feathers in.
  if (paintedBiome !== null && pw > 0) {
    if (paintedBiome === 'marsh' || paintedBiome === 'cave') lerpSplat(w, 1, 0.8 * pw);
    else if (paintedBiome === 'peaks' || paintedBiome === 'volcano') lerpSplat(w, 2, 0.75 * pw);
    else if (paintedBiome === 'beach' || paintedBiome === 'desert') lerpSplat(w, 3, 0.9 * pw);
  }
  const impact = impactCraterTerrainBlend(x, z);

  // base grass with patchy variation: a coarse fbm layer for dry/lush
  // patches plus a fine one for grain, replacing the old pure-sine tint
  // (sine repeats on a visible grid at a distance; noise reads as natural
  // ground cover instead).
  const v = fbm2(x * 0.045, z * 0.045, seed + 53, 3);
  cTmp.copy(grassC).lerp(grassDarkC, v);
  const v2 = fbm2(x * 0.16, z * 0.16, seed + 59, 2);
  cTmp.lerp(grassYellowC, v2 * 0.35);
  // the marsh reads muddier: patches of wet dirt across the lowland
  if (biome === 'marsh') lerpSplat(w, 1, 0.3 * v2 * clamp01((4 - h) / 6));
  // shoreline blend, biome-specific: marsh has no sandy beach (wet mud
  // instead), rocky/ashen biomes get a darker wet-rock tint, everywhere else
  // keeps the classic sandy bank. Color and splat weight share one feathered
  // falloff so the shore blends out instead of cutting a razor-hard edge.
  // waterLevelAt(x, z) (not the flat const) so the beach only tracks water inside
  // a declared lake's footprint (and a custom map's authored water); a dry
  // sunken feature elsewhere gets no shore tint. Optional per map (shoreSand
  // toggle) and suppressed by paint (autoW), so a painted texture stays put
  // when the ground dips toward the water instead of snapping to sand.
  const wl = waterLevelAt(x, z);
  const shore = clamp01((wl + 1.6 - h) / 1.6);
  const shoreW = shore * autoW;
  if (shoreSandOn && biome === 'marsh') {
    cTmp.lerp(dirtDarkC, shoreW);
    lerpSplat(w, 1, shoreW);
  } else if (shoreSandOn && (biome === 'peaks' || biome === 'volcano' || biome === 'cave')) {
    cTmp.lerp(wetRockC, shoreW);
    lerpSplat(w, 2, shoreW);
  } else if (shoreSandOn) {
    cTmp.lerp(sandC, shoreW);
    lerpSplat(w, 3, shoreW);
  }
  // packed dirt at each hub settlement (same feather as the splat weight —
  // a constant lerp stamped a clean-edged brown disc on the grass). Skipped
  // outright on blank authoring maps (the spawn must not force a brown patch)
  // and attenuated by the paint weight everywhere: painted ground always wins.
  if (!blank) {
    for (const zn of ZONES) {
      const dHub = Math.hypot(x - zn.hub.x, z - zn.hub.z);
      if (dHub < 14) {
        const hubT = clamp01((14 - dHub) / 3) * (1 - pw);
        cTmp.lerp(dirtDarkC, 0.7 * hubT);
        lerpSplat(w, 1, 0.75 * hubT);
        break;
      }
    }
  }
  const rd = roadDistance(x, z);
  const roadW = 1 - pw; // painted ground overrides the road dirt too
  if (rd < 2.0) {
    cTmp.lerp(dirtC, 0.85 * roadW);
    lerpSplat(w, 1, 0.85 * roadW);
  } else if (rd < 3.4) {
    const t = 0.85 * (1 - (rd - 2.0) / 1.4) * roadW;
    cTmp.lerp(dirtC, t);
    lerpSplat(w, 1, t);
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
  }
  // high ground (ridges, peaks) goes rocky then snowy. The snow ramp is wide
  // (26u, over four terrace bands) with a strong patch-noise term: the terraced
  // heightfield steps 6u at a time, and a ramp comparable to the step paints
  // alternate treads fully white / fully bare, which reads as a repetitive
  // checkerboard from a distance.
  let snow = 0;
  if (snowCapsOn && h > 22 && autoW > 0) {
    const rockT = clamp01((h - 22) / 10) * (0.6 + rockStreak * 0.25) * autoW;
    cTmp.lerp(rockC, rockT);
    snow = clamp01((h - 28 + (snowPatch - 0.5) * 14) / 26) * 0.85 * autoW;
    cTmp.lerp(snowCapC, snow);
    lerpSplat(w, 2, clamp01((h - 22) / 10) * 0.8 * autoW);
  }
  if (impact.scorch > 0) {
    cTmp.lerp(impactScorchC, 0.88 * impact.scorch);
    cTmp.lerp(impactAshC, 0.58 * impact.ash);
    lerpSplat(w, 1, impact.dirt);
    lerpSplat(w, 2, impact.rock);
  }
  // Blank slate: unpainted stays the uniform pale ground; painted color fades
  // in from it by the smooth paint weight.
  if (blank) {
    paintMixC.copy(cTmp);
    cTmp.copy(blankGroundC).lerp(paintMixC, pw);
  }
  // the rim wall reads as distant sunlit peaks, not a black cliff. The haze
  // kicks in well before the wall itself (edge starts negative deep inland)
  // so from a zone's centre the rim reads as atmospheric haze rather than a
  // crisp silhouette, reinforcing the reduced BIOME_FOG draw distance.
  // Optional per map, sized from the live render bounds (custom maps), and
  // painted ground wins here too (the perimeter used to force rock over any
  // stroke near the world edge).
  if (rimOn) {
    const rb = renderBounds();
    const edge = Math.max(Math.abs(x) - (rb.maxX - 70), rb.minZ + 70 - z, z - (rb.maxZ - 70));
    const rim = clamp01(edge / 64) * autoW;
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
  }
  // mud rides the dirt layer wherever the marsh palette is active; painted
  // ground blends the band weight toward its own (painted marsh goes fully
  // wet, any other painted biome fades band mud out) by the paint weight.
  const bandMud = marshWeightAt(z);
  const mud = pw > 0 ? bandMud + ((paintedBiome === 'marsh' ? 1 : 0) - bandMud) * pw : bandMud;
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
    custom: customW,
    flat: flatW,
  };
}

// ---------------------------------------------------------------------------
// Chunk geometry: interior (nx+1)x(nz+1) grid wrapped in a skirt ring whose
// vertices sit on the chunk border but 0.3u lower, hiding LOD cracks.
// ---------------------------------------------------------------------------

function buildChunkGeometry(
  x0: number,
  z0: number,
  size: number,
  spacing: number,
  seed: number,
  withSplat: boolean,
  skirtSpan: number,
): THREE.BufferGeometry {
  const nx = Math.max(4, Math.round(size / spacing));
  const nz = nx;
  const stepX = size / nx;
  const stepZ = size / nz;
  const gw = nx + 3; // grid width including the skirt ring
  const gh = nz + 3;
  const count = gw * gh;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const splats = withSplat ? new Float32Array(count * 4) : null;
  const extras = withSplat ? new Float32Array(count * 4) : null;
  const customs = withSplat ? new Float32Array(count * 4) : null;
  const flats = withSplat ? new Float32Array(count) : null;

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
        s = sampleVertex(x, z, seed);
        sampleCache.set(cacheKey, s);
      }
      const vi = gj * gw + gi;
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
      if (customs) {
        customs[vi * 4] = s.custom[0];
        customs[vi * 4 + 1] = s.custom[1];
        customs[vi * 4 + 2] = s.custom[2];
        customs[vi * 4 + 3] = s.custom[3];
      }
      if (extras) {
        extras[vi * 4] = s.extra[0];
        extras[vi * 4 + 1] = s.extra[1];
        extras[vi * 4 + 2] = s.extra[2];
        extras[vi * 4 + 3] = s.extra[3];
      }
      if (flats) flats[vi] = s.flat;
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
  if (customs) geo.setAttribute('aCustom', new THREE.BufferAttribute(customs, 4));
  if (flats) geo.setAttribute('aFlat', new THREE.BufferAttribute(flats, 1));
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
      const nx = -dhdx * NORMAL_TEX_STRENGTH;
      const nz = -dhdz * NORMAL_TEX_STRENGTH;
      const inv = 1 / Math.hypot(nx, 1, nz);
      const o = (j * w + i) * 4;
      data[o] = (nx * inv * 0.5 + 0.5) * 255;
      data[o + 1] = (nz * inv * 0.5 + 0.5) * 255; // green follows +v (+z)
      data[o + 2] = (inv * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
}

function terrainNormalTexture(seed: number): THREE.DataTexture {
  const data = new Uint8Array(NORMAL_TEX_W * NORMAL_TEX_H * 4);
  bakeNormalRegion(data, seed, 0, NORMAL_TEX_W - 1, 0, NORMAL_TEX_H - 1);
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
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, brush);
    ensureAtlas();
    Object.assign(sh.uniforms, {
      uCustomAtlas: customAtlasUniform,
      uCustomTile: customTileUniform,
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
        attribute vec4 aCustom;
        attribute float aFlat;
        varying vec4 vSplat;
        varying vec4 vExtra;
        varying vec4 vCustom;
        varying float vFlat;
        varying vec3 vWPos;
        varying vec3 vWNorm;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSplat = aSplat;
        vExtra = aExtra;
        vCustom = aCustom;
        vFlat = aFlat;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWNorm = objectNormal; // terrain mesh is untransformed: object == world`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec4 vSplat;
        varying vec4 vExtra;
        varying vec4 vCustom;
        varying float vFlat;
        varying vec3 vWPos;
        varying vec3 vWNorm;
        uniform sampler2D uGrass, uGrassN, uDirt, uDirtN, uRock, uRockN, uSand, uSandN, uMud, uSnow, uMacro;
        uniform sampler2D uCustomAtlas;
        uniform vec4 uCustomTile;
        vec3 wocCustomTex(vec2 tiledUv, vec2 quadrant) {
          // fract() keeps the sample inside the slot's atlas quadrant; a small
          // inset avoids linear-filter bleed across the quadrant seam.
          return texture2D(uCustomAtlas, (fract(tiledUv) * 0.996 + 0.002) * 0.5 + quadrant).rgb;
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
        vec3 alb = grassAlb * vSplat.x
                 + dirtAlb * vSplat.y
                 + rockAlb * vSplat.z
                 + texture2D(uSand, tuv).rgb * vSplat.w;
        // snow cover on the peaks/rim, by baked per-vertex weight
        alb = mix(alb, texture2D(uSnow, tuv * 0.7).rgb, vExtra.y);
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
        alb = mix(alb, alb * vec3(1.07, 1.03, 0.86), (macro2 - 0.5) * 0.5 * vSplat.x);
        // imported ground textures: painted swatch weights tile the maker's
        // own images over everything above (soft edges from the paint bake).
        // Sampled unconditionally: texture2D inside a non-uniform branch has
        // undefined derivatives; weight 0 makes the mix identity.
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTile.x, vec2(0.0, 0.0)), vCustom.x);
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTile.y, vec2(0.5, 0.0)), vCustom.y);
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTile.z, vec2(0.0, 0.5)), vCustom.z);
        alb = mix(alb, wocCustomTex(vWPos.xz * uCustomTile.w, vec2(0.5, 0.5)), vCustom.w);
        // color swatches HUE-TINT the ground: recolor the underlying texture
        // toward the painted hue while KEEPING its own light/dark detail AND its
        // overall brightness, so the texture reads exactly as it did below, only
        // color-shifted. (The old vColor*lum*2.2 overdrive multiplied the
        // texture's brightness back in, blowing bright detail past 1.0 to WHITE
        // and discarding the texture's real color, so it never truly kept it.)
        vec3 wocLumW = vec3(0.299, 0.587, 0.114);
        float wocTexLum = dot(alb, wocLumW);
        float wocPaintLum = max(dot(vColor.rgb, wocLumW), 1e-4);
        vec3 wocHue = vColor.rgb / wocPaintLum;               // hue direction (avg ~1)
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
        alb = mix(alb, wocRecolor, vFlat);
        // real albedo carries the hue now; vertex color only modulates gently
        // so the biome painting (roads, hub discs, snowline) still reads.
        // (vColor was authored as a full sRGB ground color, so re-centre it
        // around 1.0 before using it as a multiplier.)
        vec3 vtint = clamp(vColor.rgb * 2.0, 0.0, 2.0);
        diffuseColor.rgb *= alb * mix(vec3(1.0), vtint, 0.35 * (1.0 - vFlat)) * macro;`,
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
          dot(vSplat, vec4(${ROUGH_GRASS}, mix(${ROUGH_DIRT}, ${ROUGH_MUD}, vExtra.x), ${ROUGH_ROCK}, ${ROUGH_SAND})),
          ${ROUGH_SNOW}, vExtra.y);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // per-layer detail normals (GL-convention), weighted by splat
        vec3 gN = texture2D(uGrassN, tuv).xyz * 2.0 - 1.0;
        vec3 dN = texture2D(uDirtN, tuv * 0.8).xyz * 2.0 - 1.0;
        vec3 rN = texture2D(uRockN, tuv * 0.6).xyz * 2.0 - 1.0;
        vec3 sN = texture2D(uSandN, tuv).xyz * 2.0 - 1.0;
        vec2 detN = gN.xy * vSplat.x * 0.65
                  + dN.xy * vSplat.y * 0.8
                  + rN.xy * vSplat.z * 0.9 * (1.0 - wallW)
                  + sN.xy * vSplat.w * 0.55;
        detN *= 1.0 - vExtra.y * 0.7; // snow softens the relief beneath it
        normal = normalize(normal + tbn * vec3(detN, 0.0));
        // cliffs: wall-projected rock normal so steep faces get real relief
        // (approximate world-space tangent frames per projection plane; the
        // handedness flip on back faces is invisible on noisy rock)
        if (vSplat.z * wallW > 0.01) {
          vec3 rNx = texture2D(uRockN, vWPos.zy * 0.132).xyz * 2.0 - 1.0; // +-x faces
          vec3 rNz = texture2D(uRockN, vWPos.xy * 0.132).xyz * 2.0 - 1.0; // +-z faces
          vec3 wallPerturb = mix(vec3(rNz.x, rNz.y, 0.0), vec3(0.0, rNx.y, rNx.x), axisW);
          normal = normalize(normal + mat3(viewMatrix) * wallPerturb * (vSplat.z * wallW * 0.8));
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
  };
  return mat;
}

function buildBlankMaterial(brush: BrushUniforms): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: GFX.lowPlus ? 0x11160f : 0x000000,
    emissiveIntensity: GFX.lowPlus ? 0.05 : 1,
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
  };
  return mat;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface TerrainView {
  group: THREE.Group;
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
   * Resolves once every streamed-in far chunk (see buildTerrain) has been
   * added to `group`. Only the near ring around the world's zone hubs is
   * built synchronously; everything else streams in across idle slots so
   * first paint isn't gated on the whole map's geometry. Most callers don't
   * need this - `chunks` is a live array shared with update()/rebuildRegion(),
   * so those already see streamed chunks as they arrive. Use this only when a
   * caller needs the FULL map built before doing something else (e.g. a
   * screenshot tour), and call cancelStreaming() before discarding this view.
   */
  streamingDone: Promise<void>;
  /** Stops any in-flight far-chunk streaming. Call before discarding this view (see rebuildTerrain). */
  cancelStreaming(): void;
}

// Chunks farther than the near ring stream in this many at a time per idle
// slot, forced forward even under sustained load by the timeout.
const STREAM_BATCH_SIZE = 4;
const STREAM_TIMEOUT_MS = 200;

export function buildTerrain(seed: number, priorityPoint?: { x: number; z: number }): TerrainView {
  // Blank authoring maps use the FULL textured splat material too, so biome
  // paint lays down real ground textures (the flat blank material made paint
  // read as untextured vertex tint). Only the true low tier falls back.
  const lowGfx = !GFX.terrainSplat || !hasTerrainSplatAssets();
  refreshCustomGroundTextures();
  const brush = makeBrushUniforms();
  const normalTex = lowGfx ? null : terrainNormalTexture(seed);
  const mat = normalTex
    ? buildSplatMaterial(normalTex, brush)
    : isBlankSlateWorld()
      ? buildBlankMaterial(brush)
      : buildLambertMaterial(brush);
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
    size: number;
    spacing: number;
  }[] = [];

  // True when the chunk cell overlaps a mountain-wall band: an inter-zone
  // ridge line (ZONES[i].zMax) or the world rim. Those chunks always take the
  // densest band; the walls sit far from every hub, so hub-distance LOD alone
  // hands the steepest, most looked-at cliffs the coarsest grid.
  const wallChunkAt = (x0: number, z0: number, size: number): boolean => {
    if (x0 < rb.minX + WALL_LOD_RIM_MARGIN || x0 + size > rb.maxX - WALL_LOD_RIM_MARGIN) {
      return true;
    }
    if (z0 < rb.minZ + WALL_LOD_RIM_MARGIN || z0 + size > rb.maxZ - WALL_LOD_RIM_MARGIN) {
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
    const x0 = rb.minX + cx * CHUNK_SIZE;
    const z0 = rb.minZ + cz * CHUNK_SIZE;
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
      x: x0 + size / 2,
      z: z0 + size / 2,
      half: size / 2,
      x0,
      z0,
      size,
      spacing,
    });
  };

  // Collect every chunk to build as a job first, instead of building inline,
  // so the near ring (around the zone hubs, i.e. where a fresh character
  // actually stands) can build synchronously while the rest streams in
  // across idle slots below. bandIndexAt returns 0 only for the densest,
  // closest-to-a-hub band, which is what we treat as "near".
  interface ChunkJob {
    x0: number;
    z0: number;
    size: number;
    spacing: number;
    near: boolean;
  }
  const jobs: ChunkJob[] = [];

  // far-LOD cells merge 2x2 into super-chunks: the far field is where draw
  // count hurts and culling granularity matters least
  const farBand = bands.length - 1;
  const built = new Set<number>();
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      if (built.has(cz * chunksX + cx)) continue;
      const superOk =
        cx % 2 === 0 &&
        cz % 2 === 0 &&
        cx + 1 < chunksX &&
        cz + 1 < chunksZ &&
        bandIndexAt(cx, cz) === farBand &&
        bandIndexAt(cx + 1, cz) === farBand &&
        bandIndexAt(cx, cz + 1) === farBand &&
        bandIndexAt(cx + 1, cz + 1) === farBand;
      if (superOk) {
        for (const [dx, dz] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          built.add((cz + dz) * chunksX + (cx + dx));
        }
        // a merged super-chunk only forms from four far-band cells, so it's
        // never near
        jobs.push({
          x0: rb.minX + cx * CHUNK_SIZE,
          z0: rb.minZ + cz * CHUNK_SIZE,
          size: CHUNK_SIZE * 2,
          spacing: bands[farBand].spacing,
          near: false,
        });
      } else {
        built.add(cz * chunksX + cx);
        const bandIdx = bandIndexAt(cx, cz);
        jobs.push({
          x0: rb.minX + cx * CHUNK_SIZE,
          z0: rb.minZ + cz * CHUNK_SIZE,
          size: CHUNK_SIZE,
          spacing: bands[bandIdx].spacing,
          near: bandIdx === 0,
        });
      }
    }
  }

  for (const job of jobs) {
    if (job.near) addChunk(job.x0, job.z0, job.size, job.spacing);
  }
  const farJobs = jobs.filter((job) => !job.near);
  // A returning character can log out anywhere, not just at a zone hub, so
  // the near ring alone can leave them standing on not-yet-streamed terrain.
  // Ordering the far queue by distance to the actual entry point (falling
  // back to world center when none is given) guarantees the chunk directly
  // underfoot streams in first rather than landing wherever row-major order
  // happens to reach it.
  if (priorityPoint) {
    const centerX = (job: (typeof farJobs)[number]): number => job.x0 + job.size / 2;
    const centerZ = (job: (typeof farJobs)[number]): number => job.z0 + job.size / 2;
    farJobs.sort(
      (a, b) =>
        Math.hypot(centerX(a) - priorityPoint.x, centerZ(a) - priorityPoint.z) -
        Math.hypot(centerX(b) - priorityPoint.x, centerZ(b) - priorityPoint.z),
    );
  }
  let cancelled = false;
  const streamingDone = runIdleQueue(
    farJobs,
    (job) => {
      addChunk(job.x0, job.z0, job.size, job.spacing);
    },
    {
      batchSize: STREAM_BATCH_SIZE,
      timeoutMs: STREAM_TIMEOUT_MS,
      cancelled: () => cancelled,
    },
  );

  return {
    group,
    streamingDone,
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
      // No allocation beyond the replacement geometries: the chunk list is
      // scanned in place and only intersecting chunks re-mesh.
      for (const chunk of chunks) {
        if (!chunkIntersectsRegion(chunk.x0, chunk.z0, chunk.size, minX, minZ, maxX, maxZ)) {
          continue;
        }
        const geo = buildChunkGeometry(
          chunk.x0,
          chunk.z0,
          chunk.size,
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
