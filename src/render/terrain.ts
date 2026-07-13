import * as THREE from 'three';
import { MAX_HOLE_PATCHES, MAX_TERRAIN_HOLES } from '../sim/caves';
import { getActiveWorldContent, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z, ZONES } from '../sim/data';
import type { BiomeId, BiomePaint, CustomPaintSwatch } from '../sim/types';
import {
  BIOME_BY_ID,
  biomeAt,
  paintedCellIdAt,
  roadDistance,
  terrainHeight,
  waterLevel,
  zoneBiomeAt,
} from '../sim/world';
import { groundImageFor } from './assets/ground_textures';
import { loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX } from './gfx';
import { impactCraterTerrainBlend } from './impact_terrain';
import { chunkIntersectsRegion, normalTexelBounds } from './terrain_region_core';
import { groundDetailTexture, groundSplatMaps, macroNoiseTexture } from './textures';

// Chunked terrain across the whole 360x1080 zone strip.
//
// - ~60u chunks with their own bounding volumes so frustum culling actually
//   works (the old single-plane-per-zone terrain was always fully submitted).
// - LOD by distance from the nearest hub at build time: settlements (where
//   the camera lingers) get dense vertices, the wilderness gets coarse ones.
// - 0.3u skirts hang from every chunk edge to hide LOD cracks.
// - High tier: MeshStandardMaterial + splat shading (grass/dirt/rock/sand
//   weights precomputed per vertex from slope/height/roadDistance into a vec4
//   attribute) over the biome vertex-color tint, plus a world-space macro
//   normal map baked from terrainHeight.
// - Low tier: the legacy vertex-color Lambert look, still chunked for culling.

const CHUNK_SIZE = 60;
const SKIRT_DROP = 0.3;
const SLOPE_EPS = 1.5; // matches the legacy color pass so tints don't shift
// Steep sculpted cliffs can drop tens of units between adjacent grid rows; a
// skirt must cover the worst local relief or backface-culled seams read as
// transparent holes. Scaled per-vertex in buildChunkGeometry.
const SKIRT_RELIEF_FACTOR = 1.25;

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
    { maxHubDist: 185, spacing: 2.0 },
    { maxHubDist: Infinity, spacing: 3.5 },
  ],
  low: [
    { maxHubDist: 95, spacing: 3.0 },
    { maxHubDist: 185, spacing: 4.4 },
    { maxHubDist: Infinity, spacing: 6.5 },
  ],
} as const;

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
  beach: {
    grass: 0x9aa55e,
    grassDark: 0x7a8a4e,
    grassYellow: 0xb5b06a,
    dirt: 0xb59a6b,
    sand: 0xe2d3a4,
  },
  desert: {
    grass: 0xb0a060,
    grassDark: 0x8f8350,
    grassYellow: 0xc4b070,
    dirt: 0xa87f4f,
    sand: 0xd8b581,
  },
  volcano: {
    grass: 0x5a4a42,
    grassDark: 0x40332e,
    grassYellow: 0x6e5a4a,
    dirt: 0x4a3a32,
    sand: 0x6a5548,
  },
  cave: {
    grass: 0x6a6a62,
    grassDark: 0x50504a,
    grassYellow: 0x7a7a6e,
    dirt: 0x5a5248,
    sand: 0x8a8274,
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
// Up to EIGHT custom swatches with a textureSha get a REAL tiling texture in
// the splat material: the paint field bakes each one's coverage into its slot
// of the custom-weight layers (slot = the swatch's order among textured
// swatches), and the fragment shader mixes `texture2D(uCustomN, worldXZ /
// tileSize)` in by that weight. Slots resolve from the ACTIVE content, so the
// editor and a playtest of the same map agree. Uniforms are module-shared: the material
// installs them once and refreshCustomGroundTextures() swaps values in place
// (no recompile) whenever a texture loads or the tiling changes.

export const MAX_CUSTOM_GROUND_TEXTURES = 8;
// Default texture tiling in yards per repeat (used when a swatch carries no
// tileSize of its own — new swatches are minted at this too).
export const DEFAULT_TEXTURE_TILE_YD = 28;

// One 4x2 ATLAS holds all eight custom textures (the splat shader already sits
// near MAX_TEXTURE_IMAGE_UNITS, so per-slot samplers do not fit): each slot
// owns a cell, the shader wraps its tiling uv with fract() inside it.
// Mipmaps are disabled so cells never bleed into each other.
const ATLAS_CELL = 512;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 2;
let atlasCanvas: HTMLCanvasElement | null = null;
let atlasTexture: THREE.CanvasTexture | null = null;
const customAtlasUniform = { value: null as THREE.Texture | null };
const TILE0 = 1 / DEFAULT_TEXTURE_TILE_YD;
const customTileUniform = { value: new THREE.Vector4(TILE0, TILE0, TILE0, TILE0) };
const customTileUniformB = { value: new THREE.Vector4(TILE0, TILE0, TILE0, TILE0) };
let atlasRefreshGen = 0;

function ensureAtlas(): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  if (!atlasCanvas || !atlasTexture) {
    atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = ATLAS_CELL * ATLAS_COLS;
    atlasCanvas.height = ATLAS_CELL * ATLAS_ROWS;
    atlasTexture = new THREE.CanvasTexture(atlasCanvas);
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
    atlasTexture.flipY = false; // uv y == canvas y, so cell math is direct
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
 * each slot's cell gets the flat fallback color immediately and the real
 * image (IndexedDB or bundled builtin) when it resolves. Called at terrain
 * build and by the editor after importing a texture or changing tile size.
 */
export function refreshCustomGroundTextures(): void {
  const slots = texturedSwatches();
  if (slots.length === 0) return; // nothing painted with textures yet
  const { canvas, texture } = ensureAtlas();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const gen = ++atlasRefreshGen;
  const quad = (i: number): { x: number; y: number } => ({
    x: (i % ATLAS_COLS) * ATLAS_CELL,
    y: Math.floor(i / ATLAS_COLS) * ATLAS_CELL,
  });
  for (let i = 0; i < MAX_CUSTOM_GROUND_TEXTURES; i++) {
    const sw = slots[i];
    const q = quad(i);
    const size = sw?.tileSize && sw.tileSize > 0 ? sw.tileSize : DEFAULT_TEXTURE_TILE_YD;
    const tile = i < 4 ? customTileUniform.value : customTileUniformB.value;
    const c = i % 4;
    if (c === 0) tile.x = 1 / size;
    else if (c === 1) tile.y = 1 / size;
    else if (c === 2) tile.z = 1 / size;
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

/** The custom swatch for a painted id, or null. */
function customSwatchFor(id: number): CustomPaintSwatch | null {
  const custom = getActiveWorldContent().biomePaint?.custom;
  if (!custom) return null;
  for (const s of custom) if (s.id === id) return s;
  return null;
}

// ---------------------------------------------------------------------------
// Per-fragment paint field
//
// The biome-paint grid baked into DataTextures the splat material samples per
// FRAGMENT, so painted edges resolve at paint-CELL resolution (0.5-1yd) with
// the GPU's bilinear feather — independent of the terrain mesh's vertex
// spacing (1.2-3.5yd), which used to quantize every brush edge into visible
// stair-steps across whole triangles. The vertex path keeps the paint only to
// SUPPRESS auto features under strokes (roads, shore sand, slope rock) and for
// the Lambert/blank low tier, which has no fragment field and renders the
// legacy per-vertex bake.
//
// ONE DataArrayTexture (a sampler2DArray costs a single texture unit — the
// splat material already sits at MAX_TEXTURE_IMAGE_UNITS, so three separate
// samplers do not link) with an RGBA8 layer per concern, one texel per cell:
// - layer 0: painted ground tint (LINEAR bytes, PREMULTIPLIED by coverage) +
//            coverage in alpha. Per-texel coverage is binary (a cell is
//            painted or not), so the shader's un-premultiply divide is exact
//            and bilinear never bleeds black halos in from unpainted cells.
// - layer 1: dirt/rock/sand splat re-base weights in rgb (pre-scaled by the
//            biome's strength) + the color-only-swatch hue-tint weight in a.
// - layer 2: the four imported-ground-texture slot weights (atlas quadrants).
// - layer 3: swatch hue/light adjust. Signed values ride two premultiplied
//            channels each (r/g = hue +/-, b/a = light +/-) so the Gaussian
//            blur stays a plain linear average; all-zero bytes make the
//            shader's adjust a bit-exact no-op.
// ---------------------------------------------------------------------------

// Splat re-base strength per painted biome family — shared by the fragment
// bake and the Lambert tier's vertex bake so the two tiers agree.
const PAINT_REBASE_DIRT = 0.8;
const PAINT_REBASE_ROCK = 0.75;
const PAINT_REBASE_SAND = 0.9;

// WebGL guarantees 4096 on every device this ships to; a grid axis past it
// (extreme skinny maps) bakes nearest-sampled into the clamped texture.
const PAINT_TEX_MAX = 4096;

// Layer indices into the field array texture (tint is layer 0).
const PAINT_LAYER_REBASE = 1;
const PAINT_LAYER_CUSTOM = 2;
const PAINT_LAYER_ADJUST = 3;
// Custom-texture slots 4-7 (the atlas' second row) ride their own layer.
const PAINT_LAYER_CUSTOM2 = 4;
const PAINT_LAYERS = 5;

interface PaintField {
  texW: number;
  texH: number;
  // Grid identity the last bake ran against; any change forces a full rebake
  // (a resample/new-map swaps the whole grid object, never mutates in place).
  cols: number;
  rows: number;
  cell: number;
  originX: number;
  originZ: number;
  tex: THREE.DataArrayTexture;
}

function makePaintTexture(w: number, h: number): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(
    new Uint8Array(w * h * 4 * PAINT_LAYERS),
    w,
    h,
    PAINT_LAYERS,
  );
  tex.format = THREE.RGBAFormat;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// 1x1 all-zero stand-in for maps with no paint layer (coverage 0 everywhere).
// Recreated per terrain build like the real field (see refreshPaintField).
let paintEmptyField = makePaintTexture(1, 1);

// Module-shared uniforms (same pattern as the custom atlas): the material
// installs them once, refreshPaintField swaps .value in place — no recompile.
const paintFieldUniform = { value: paintEmptyField as THREE.Texture };
// xy: grid world origin; zw: 1 / grid world size (zw = 0 disables the field).
const paintRectUniform = { value: new THREE.Vector4(0, 0, 0, 0) };

let paintField: PaintField | null = null;

const paintTintC = new THREE.Color();

// The painted-edge feather width in YARDS, matched to the road falloff (the
// smoothest transition the shipped map has). The bake blurs the binary cell
// grid with a separable Gaussian this wide, so the shader samples a genuinely
// SMOOTH coverage field: no cell structure survives — a hard-edged stroke gets
// a road-quality gradient and a dithered soft rim melts into it — instead of
// the raw grid's one-cell bilinear ramp reading as pixelated dots up close.
const PAINT_FEATHER_YD = 1.6;

// Float channels carried through the blur, per texel:
// 0 coverage; 1-3 tint rgb (premultiplied by coverage); 4-6 dirt/rock/sand
// re-base; 7 flat (color-swatch hue-tint); 8-11 custom-texture slots 0-3;
// 12-15 swatch hue/light adjust (hue +/-, light +/-); 16-19 custom slots 4-7.
const PAINT_CH = 20;

// Gaussian sized so the 10%..90% coverage ramp spans ~PAINT_FEATHER_YD.
function paintBlurSigma(cell: number): number {
  return Math.max(0.4, PAINT_FEATHER_YD / cell / 2.56);
}
/** Kernel radius in texels — also how far one edited cell's influence reaches. */
function paintBlurRadius(cell: number): number {
  return Math.min(4, Math.max(1, Math.ceil(paintBlurSigma(cell) * 2.5)));
}

// Blur scratch, grown on demand and reused across strokes (a full bake on a
// 0.5yd-cell map peaks around 16MB; drag rebakes touch a few hundred texels).
let paintBlurScratch = new Float32Array(0);
let paintAttrScratch = new Float32Array(0);

/** The un-blurred field channels of ONE texel (nearest grid cell). */
function paintCellAttr(
  bp: BiomePaint,
  f: PaintField,
  i: number,
  j: number,
  out: Float32Array,
  o: number,
): void {
  for (let ch = 0; ch < PAINT_CH; ch++) out[o + ch] = 0;
  // Clamp reads into the grid so strokes painted flush against the map border
  // keep full coverage there instead of fading into the void.
  const ti = Math.max(0, Math.min(f.texW - 1, i));
  const tj = Math.max(0, Math.min(f.texH - 1, j));
  const c =
    f.texW === bp.cols ? ti : Math.min(bp.cols - 1, Math.floor(((ti + 0.5) * bp.cols) / f.texW));
  const r =
    f.texH === bp.rows ? tj : Math.min(bp.rows - 1, Math.floor(((tj + 0.5) * bp.rows) / f.texH));
  const id = bp.ids[r * bp.cols + c];
  if (id === 255) return;
  if (id < BIOME_BY_ID.length) {
    const biome = BIOME_BY_ID[id];
    const p = biomePalettes[biome];
    // Same patchy palette noise as the vertex bake, at the cell center, so
    // painted interiors keep their exact shipped look. Palette colors are
    // LINEAR (like the vertex colors were) and the bytes stay linear.
    const x = bp.originX + (c + 0.5) * bp.cell;
    const z = bp.originZ + (r + 0.5) * bp.cell;
    const v = (Math.sin(x * 0.21) * Math.cos(z * 0.17) + 1) / 2;
    const v2 = (Math.sin(x * 0.043 + 5) * Math.cos(z * 0.05 + 2) + 1) / 2;
    paintTintC
      .copy(p.grass)
      .lerp(p.grassDark, v)
      .lerp(p.grassYellow, v2 * 0.35);
    out[o] = 1;
    out[o + 1] = paintTintC.r;
    out[o + 2] = paintTintC.g;
    out[o + 3] = paintTintC.b;
    if (biome === 'marsh' || biome === 'cave') out[o + 4] = PAINT_REBASE_DIRT;
    else if (biome === 'peaks' || biome === 'volcano') out[o + 5] = PAINT_REBASE_ROCK;
    else if (biome === 'beach' || biome === 'desert') out[o + 6] = PAINT_REBASE_SAND;
  } else {
    const sw = customSwatchFor(id);
    if (!sw) return; // stale swatch id: renders unpainted
    // A biome VARIANT swatch (hue/light tweak of a built-in) bakes the base
    // biome's own palette and splat re-base, so at zero adjust it looks
    // exactly like the stock biome.
    const baseBiome =
      sw.baseBiome !== undefined && sw.baseBiome < BIOME_BY_ID.length
        ? BIOME_BY_ID[sw.baseBiome]
        : null;
    // The DERIVED palette with the same patchy noise as painted biomes — NOT
    // the raw hex. The raw hex of a dark saturated swatch makes a wildly
    // saturated hue direction for the flat recolor path (near-black red
    // rendered as neon salmon); the palette mix (grassDark/grassYellow
    // lerps) is what the legacy vertex bake tinted with, so interiors keep
    // their shipped look.
    const p = baseBiome ? biomePalettes[baseBiome] : customPaletteFor(sw.color);
    const x = bp.originX + (c + 0.5) * bp.cell;
    const z = bp.originZ + (r + 0.5) * bp.cell;
    const v = (Math.sin(x * 0.21) * Math.cos(z * 0.17) + 1) / 2;
    const v2 = (Math.sin(x * 0.043 + 5) * Math.cos(z * 0.05 + 2) + 1) / 2;
    paintTintC
      .copy(p.grass)
      .lerp(p.grassDark, v)
      .lerp(p.grassYellow, v2 * 0.35);
    out[o] = 1;
    out[o + 1] = paintTintC.r;
    out[o + 2] = paintTintC.g;
    out[o + 3] = paintTintC.b;
    if (baseBiome) {
      if (baseBiome === 'marsh' || baseBiome === 'cave') out[o + 4] = PAINT_REBASE_DIRT;
      else if (baseBiome === 'peaks' || baseBiome === 'volcano') out[o + 5] = PAINT_REBASE_ROCK;
      else if (baseBiome === 'beach' || baseBiome === 'desert') out[o + 6] = PAINT_REBASE_SAND;
    } else {
      const slot = customTextureSlotFor(id);
      if (slot >= 0 && slot < 4) out[o + 8 + slot] = 1;
      else if (slot >= 4) out[o + 16 + (slot - 4)] = 1;
      else out[o + 7] = 1; // color-only swatch: hue-tint (flat) weight
    }
    // Hue/light adjust: signed values split into +/- channel pairs so the
    // blur (a plain linear average) never has to mix around a bias point.
    const hs = sw.hueShift ?? 0;
    const lt = sw.light ?? 0;
    if (hs > 0) out[o + 12] = Math.min(1, hs / 180);
    else if (hs < 0) out[o + 13] = Math.min(1, -hs / 180);
    if (lt > 0) out[o + 14] = Math.min(1, lt);
    else if (lt < 0) out[o + 15] = Math.min(1, -lt);
  }
}

/**
 * Bake the texel window [i0..i1] x [j0..j1] (inclusive) from the grid, blurred
 * by the separable Gaussian feather. A pure function of the grid ids (and the
 * swatch list), so a partial rebake is byte-identical to the full bake over
 * the same texels.
 */
function bakePaintTexels(
  bp: BiomePaint,
  f: PaintField,
  i0: number,
  i1: number,
  j0: number,
  j1: number,
): void {
  const sigma = paintBlurSigma(bp.cell);
  const R = paintBlurRadius(bp.cell);
  const K = 2 * R + 1;
  const kw = new Float32Array(K);
  let kSum = 0;
  for (let k = 0; k < K; k++) {
    kw[k] = Math.exp(-0.5 * ((k - R) / sigma) ** 2);
    kSum += kw[k];
  }
  for (let k = 0; k < K; k++) kw[k] /= kSum;

  // Horizontal pass over the padded window (R extra texels each side feed the
  // vertical pass), reading cell attributes straight from the grid.
  const pi0 = i0 - R;
  const pi1 = i1 + R;
  const pj0 = j0 - R;
  const pj1 = j1 + R;
  const pw = pi1 - pi0 + 1;
  const ph = pj1 - pj0 + 1;
  if (paintBlurScratch.length < pw * ph * PAINT_CH) {
    paintBlurScratch = new Float32Array(pw * ph * PAINT_CH);
  }
  const aw = pw + 2 * R;
  if (paintAttrScratch.length < aw * PAINT_CH) paintAttrScratch = new Float32Array(aw * PAINT_CH);
  const hBlur = paintBlurScratch;
  const attrRow = paintAttrScratch;
  for (let j = pj0; j <= pj1; j++) {
    for (let i = 0; i < aw; i++) paintCellAttr(bp, f, pi0 - R + i, j, attrRow, i * PAINT_CH);
    const rowBase = (j - pj0) * pw * PAINT_CH;
    for (let i = 0; i < pw; i++) {
      const oOut = rowBase + i * PAINT_CH;
      for (let ch = 0; ch < PAINT_CH; ch++) {
        let acc = 0;
        for (let k = 0; k < K; k++) acc += kw[k] * attrRow[(i + k) * PAINT_CH + ch];
        hBlur[oOut + ch] = acc;
      }
    }
  }

  // Vertical pass straight into the texture bytes.
  const data = f.tex.image.data as Uint8Array;
  const layerStride = f.texW * f.texH * 4;
  const oRebase = PAINT_LAYER_REBASE * layerStride;
  const oCustom = PAINT_LAYER_CUSTOM * layerStride;
  const oAdjust = PAINT_LAYER_ADJUST * layerStride;
  const oCustom2 = PAINT_LAYER_CUSTOM2 * layerStride;
  const px = new Float32Array(PAINT_CH);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      px.fill(0);
      for (let k = 0; k < K; k++) {
        const src = ((j - pj0 + k - R) * pw + (i - pi0)) * PAINT_CH;
        const w = kw[k];
        for (let ch = 0; ch < PAINT_CH; ch++) px[ch] += w * hBlur[src + ch];
      }
      const o = (j * f.texW + i) * 4;
      data[o] = Math.round(px[1] * 255);
      data[o + 1] = Math.round(px[2] * 255);
      data[o + 2] = Math.round(px[3] * 255);
      data[o + 3] = Math.round(px[0] * 255);
      data[oRebase + o] = Math.round(px[4] * 255);
      data[oRebase + o + 1] = Math.round(px[5] * 255);
      data[oRebase + o + 2] = Math.round(px[6] * 255);
      data[oRebase + o + 3] = Math.round(px[7] * 255);
      data[oCustom + o] = Math.round(px[8] * 255);
      data[oCustom + o + 1] = Math.round(px[9] * 255);
      data[oCustom + o + 2] = Math.round(px[10] * 255);
      data[oCustom + o + 3] = Math.round(px[11] * 255);
      data[oAdjust + o] = Math.round(px[12] * 255);
      data[oAdjust + o + 1] = Math.round(px[13] * 255);
      data[oAdjust + o + 2] = Math.round(px[14] * 255);
      data[oAdjust + o + 3] = Math.round(px[15] * 255);
      data[oCustom2 + o] = Math.round(px[16] * 255);
      data[oCustom2 + o + 1] = Math.round(px[17] * 255);
      data[oCustom2 + o + 2] = Math.round(px[18] * 255);
      data[oCustom2 + o + 3] = Math.round(px[19] * 255);
    }
  }
  f.tex.needsUpdate = true;
}

/**
 * Full rebake (or clear) of the paint field from the ACTIVE content. Called at
 * every terrain build.
 *
 * The GL texture object is NEVER reused across builds: the editor's viewport
 * reload (map load/import) force-loses the old WebGL context and boots a fresh
 * renderer, and a DataArrayTexture that was already uploaded under the dead
 * context renders stale, unfiltered-looking data in the new one (three does
 * not re-upload it — observed on map import: every painted edge went back to
 * blocky). buildTerrain runs exactly once per renderer, so allocating fresh
 * here guarantees every context uploads its own copy; the per-drag region
 * rebakes still update the current build's texture in place.
 */
function refreshPaintField(): void {
  const bp = getActiveWorldContent().biomePaint;
  if (paintField) {
    paintField.tex.dispose();
    paintField = null;
  }
  if (!bp) {
    // Fresh 1x1 stand-in per build, for the same cross-context reason.
    paintEmptyField.dispose();
    paintEmptyField = makePaintTexture(1, 1);
    paintFieldUniform.value = paintEmptyField;
    paintRectUniform.value.set(0, 0, 0, 0);
    return;
  }
  const texW = Math.min(bp.cols, PAINT_TEX_MAX);
  const texH = Math.min(bp.rows, PAINT_TEX_MAX);
  paintField = {
    texW,
    texH,
    cols: bp.cols,
    rows: bp.rows,
    cell: bp.cell,
    originX: bp.originX,
    originZ: bp.originZ,
    tex: makePaintTexture(texW, texH),
  };
  bakePaintTexels(bp, paintField, 0, texW - 1, 0, texH - 1);
  paintFieldUniform.value = paintField.tex;
  // Texel centers sit exactly on cell centers: cell c spans
  // origin + [c, c+1) * cell, so the grid rect is cell * cols wide.
  paintRectUniform.value.set(
    bp.originX,
    bp.originZ,
    1 / (bp.cell * bp.cols),
    1 / (bp.cell * bp.rows),
  );
}

/**
 * Rebake only the texels under a world-space region (a brush footprint) and
 * flag the textures for re-upload. Falls back to the full refresh whenever the
 * grid identity changed since the last bake (created, removed, resampled).
 */
function rebakePaintFieldRegion(minX: number, minZ: number, maxX: number, maxZ: number): void {
  const bp = getActiveWorldContent().biomePaint;
  const f = paintField;
  if (
    !bp ||
    !f ||
    f.cols !== bp.cols ||
    f.rows !== bp.rows ||
    f.cell !== bp.cell ||
    f.originX !== bp.originX ||
    f.originZ !== bp.originZ
  ) {
    if (bp || f) refreshPaintField();
    return;
  }
  // World rect -> texel window. Margin: the blur radius (an edited cell moves
  // texels up to R away) plus one texel for downsample rounding.
  const m = paintBlurRadius(bp.cell) + 1;
  const sx = f.texW / (bp.cell * bp.cols);
  const sz = f.texH / (bp.cell * bp.rows);
  const i0 = Math.max(0, Math.floor((minX - bp.originX) * sx) - m);
  const i1 = Math.min(f.texW - 1, Math.ceil((maxX - bp.originX) * sx) + m);
  const j0 = Math.max(0, Math.floor((minZ - bp.originZ) * sz) - m);
  const j1 = Math.min(f.texH - 1, Math.ceil((maxZ - bp.originZ) * sz) + m);
  if (i0 > i1 || j0 > j1) return;
  bakePaintTexels(bp, f, i0, i1, j0, j1);
}

/**
 * Editor-only: rebake the whole paint field in place after a swatch's LOOK
 * changed (hue/light slider edits recolor already-painted cells without any
 * grid change). No-op on the low tier and before the first terrain build.
 */
export function rebakePaintFieldSwatches(): void {
  const bp = getActiveWorldContent().biomePaint;
  if (!bp || !paintField) return;
  rebakePaintFieldRegion(
    bp.originX,
    bp.originZ,
    bp.originX + bp.cell * bp.cols,
    bp.originZ + bp.cell * bp.rows,
  );
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

// Wider paint-coverage kernel for AUTO-FEATURE suppression on the splat tier:
// snow caps / slope rock / shore sand / road dirt must be fully gone before
// the fragment paint has thinned to nothing, or they resurface as a bright
// halo hugging every stroke on high or shore ground (the auto rock/snow is
// often at FULL strength right at a stroke's edge — think a painted plateau
// whose rim sits above the snow line). ~4yd of reach with a saturating remap:
// 1 well past the paint's visual edge, easing back to 0 beyond the fragment
// feather, so the natural feature fades back in gradually instead of ringing
// the stroke. The radius is in CELLS, so it scales with the grid's cell size
// (capped: at 0.25yd cells an 8-cell kernel already covers the feather).
const PAINT_SUPPRESS_REACH_YD = 4;
function paintSuppressRadius(cell: number): number {
  return Math.min(8, Math.max(2, Math.round(PAINT_SUPPRESS_REACH_YD / cell)));
}
function paintSuppressAt(x: number, z: number): number {
  const bp = getActiveWorldContent().biomePaint;
  if (!bp) return 0;
  const gx = (x - bp.originX) / bp.cell - 0.5;
  const gz = (z - bp.originZ) / bp.cell - 0.5;
  const cc = Math.round(gx);
  const cr = Math.round(gz);
  // Fast path: a fully-painted 3x3 short-circuits to full suppression. Exact
  // for radius <= 4 (the 3x3's weight share alone exceeds 1/3); for the finer
  // grids' wider kernels it slightly over-suppresses only on sub-2yd painted
  // islands, where the paint itself covers the ground anyway.
  let uniformPainted = true;
  for (let dr = -1; dr <= 1 && uniformPainted; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = cc + dc;
      const r = cr + dr;
      const id = c >= 0 && c < bp.cols && r >= 0 && r < bp.rows ? bp.ids[r * bp.cols + c] : 255;
      if (id === 255) {
        uniformPainted = false;
        break;
      }
    }
  }
  if (uniformPainted) return 1;
  const R = paintSuppressRadius(bp.cell);
  const rr = R + 0.5;
  let wSum = 0;
  let wPainted = 0;
  for (let dr = -R; dr <= R; dr++) {
    for (let dc = -R; dc <= R; dc++) {
      const c = cc + dc;
      const r = cr + dr;
      const ddx = c - gx;
      const ddz = r - gz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 >= rr * rr) continue;
      const wght = 1 - d2 / (rr * rr);
      wSum += wght;
      if (c < 0 || c >= bp.cols || r < 0 || r >= bp.rows) continue;
      if (bp.ids[r * bp.cols + c] !== 255) wPainted += wght;
    }
  }
  const ratio = wSum > 0 ? wPainted / wSum : 0;
  return clamp01(ratio * 3);
}

// Palette at a point. A painted cell (biome differs from its zone band) uses that
// biome's flat palette; otherwise the smooth zone-band blend. With no paint layer
// `biome === zoneBiomeAt(z)` always, so this is the original z-blend exactly.
function paletteAt(x: number, z: number, biome: BiomeId): void {
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
    };
  }

  const zoneBiome = zoneBiomeAt(z);
  let paintedBiome: BiomeId | null = null;
  let customPaint: number | null = null;
  if (paint.id !== null) {
    if (paint.id < BIOME_BY_ID.length) {
      paintedBiome = BIOME_BY_ID[paint.id];
    } else {
      const sw = customSwatchFor(paint.id);
      // A biome-variant swatch behaves like its base biome on the vertex
      // path (auto-feature suppression + the Lambert tier's legacy bake).
      if (sw && sw.baseBiome !== undefined && sw.baseBiome < BIOME_BY_ID.length) {
        paintedBiome = BIOME_BY_ID[sw.baseBiome];
      } else {
        customPaint = sw ? sw.color : null;
      }
    }
  }
  const pw = paintedBiome !== null || customPaint !== null ? paint.weight : 0;
  // Paint weight for COLOR/SPLAT application: zero on the splat tier (the
  // fragment field owns the painted look).
  const pwVert = paintInFrag ? 0 : pw;
  // Auto-feature suppression weight. Splat tier: a WIDER kernel than the
  // paint itself, so snow caps / slope rock / shore sand / road dirt are
  // fully cleared under the whole fragment feather (and slightly beyond) —
  // otherwise a stroke on high or shore ground wears a bright halo of the
  // resurfacing auto feature. Lambert tier: the paint weight, the legacy
  // exact vertex crossfade.
  const sup = paintInFrag ? paintSuppressAt(x, z) : pw;
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
  const autoW = 1 - sup;
  paletteAt(x, z, zoneBiome);
  if (paintedBiome !== null && pwVert > 0) {
    const p = biomePalettes[paintedBiome];
    grassC.lerp(p.grass, pwVert);
    grassDarkC.lerp(p.grassDark, pwVert);
    grassYellowC.lerp(p.grassYellow, pwVert);
    dirtC.lerp(p.dirt, pwVert);
    sandC.lerp(p.sand, pwVert);
  } else if (customPaint !== null && pwVert > 0) {
    const p = customPaletteFor(customPaint);
    grassC.lerp(p.grass, pwVert);
    grassDarkC.lerp(p.grassDark, pwVert);
    grassYellowC.lerp(p.grassYellow, pwVert);
    dirtC.lerp(p.dirt, pwVert);
    sandC.lerp(p.sand, pwVert);
  }
  const w: [number, number, number, number] = [1, 0, 0, 0];
  // Painted ground re-bases the splat mix toward its biome's dominant texture
  // layer, scaled by the smooth paint weight so the texture feathers in.
  // (Lambert tier only; the splat tier re-bases per fragment.)
  if (paintedBiome !== null && pwVert > 0) {
    if (paintedBiome === 'marsh' || paintedBiome === 'cave') {
      lerpSplat(w, 1, PAINT_REBASE_DIRT * pwVert);
    } else if (paintedBiome === 'peaks' || paintedBiome === 'volcano') {
      lerpSplat(w, 2, PAINT_REBASE_ROCK * pwVert);
    } else if (paintedBiome === 'beach' || paintedBiome === 'desert') {
      lerpSplat(w, 3, PAINT_REBASE_SAND * pwVert);
    }
  }
  // Blank maps carry no built-in crater, so no scorch/ash tint over the ground
  // (the height bowl is likewise gated in world.ts terrainHeight).
  const impact = blank ? { ash: 0, scorch: 0, dirt: 0, rock: 0 } : impactCraterTerrainBlend(x, z);

  // base grass with patchy variation
  const v = (Math.sin(x * 0.21) * Math.cos(z * 0.17) + 1) / 2;
  cTmp.copy(grassC).lerp(grassDarkC, v);
  const v2 = (Math.sin(x * 0.043 + 5) * Math.cos(z * 0.05 + 2) + 1) / 2;
  cTmp.lerp(grassYellowC, v2 * 0.35);
  // the marsh reads muddier: patches of wet dirt across the lowland
  if (biome === 'marsh') lerpSplat(w, 1, 0.3 * v2 * clamp01((4 - h) / 6));
  // shoreline sand — color and splat weight share one feathered falloff so
  // the beach blends out instead of cutting a razor-hard grass/sand line.
  // waterLevel() (not the const) so the beach tracks a custom map's water.
  // Optional per map (shoreSand toggle) and suppressed by paint (autoW), so a
  // painted texture stays put when the ground dips toward the water instead of
  // snapping to sand.
  const wl = waterLevel();
  const shore = clamp01((wl + 1.6 - h) / 1.6);
  if (shoreSandOn) {
    const shoreW = shore * autoW;
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
        const hubT = clamp01((14 - dHub) / 3) * (1 - sup);
        cTmp.lerp(dirtDarkC, 0.7 * hubT);
        lerpSplat(w, 1, 0.75 * hubT);
        break;
      }
    }
  }
  const rd = roadDistance(x, z);
  const roadW = 1 - sup; // painted ground overrides the road dirt too
  if (rd < 2.0) {
    cTmp.lerp(dirtC, 0.85 * roadW);
    lerpSplat(w, 1, 0.85 * roadW);
  } else if (rd < 3.4) {
    const t = 0.85 * (1 - (rd - 2.0) / 1.4) * roadW;
    cTmp.lerp(dirtC, t);
    lerpSplat(w, 1, t);
  }
  const rockStart = ROCK_SLOPE_START[biome];
  if (slopeRockOn && slope > rockStart && autoW > 0) {
    const t = Math.min(1, (slope - rockStart) * 2) * autoW;
    cTmp.lerp(rockC, t);
    lerpSplat(w, 2, t);
  }
  // high ground (ridges, peaks) goes rocky then snowy
  let snow = 0;
  if (snowCapsOn && h > 22 && autoW > 0) {
    cTmp.lerp(rockC, clamp01((h - 22) / 10) * 0.7 * autoW);
    snow = clamp01((h - 34) / 14) * 0.85 * autoW;
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
    cTmp.copy(blankGroundC).lerp(paintMixC, pwVert);
  }
  // the rim wall reads as distant sunlit peaks, not a black cliff. Optional
  // per map, and painted ground wins here too (the perimeter used to force
  // rock over any stroke near the world edge).
  if (rimOn) {
    const rb = renderBounds();
    const edge = Math.max(Math.abs(x) - (rb.maxX - 32), rb.minZ + 32 - z, z - (rb.maxZ - 32));
    const rim = clamp01(edge / 26) * autoW;
    if (rim > 0) {
      cTmp.lerp(hazyPeakC, rim * 0.9);
      const rimSnow = clamp01((h - 26) / 16) * rim * 0.8;
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
      positions[vi * 3 + 1] = s.height - skirtDrop;
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
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
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

function terrainNormalTexture(seed: number): THREE.DataTexture {
  const data = new Uint8Array(NORMAL_TEX_W * NORMAL_TEX_H * 4);
  bakeNormalRegion(data, seed, 0, NORMAL_TEX_W - 1, 0, NORMAL_TEX_H - 1);
  const tex = new THREE.DataTexture(data, NORMAL_TEX_W, NORMAL_TEX_H, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
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
}

export function buildTerrain(seed: number): TerrainView {
  // Blank authoring maps use the FULL textured splat material too, so biome
  // paint lays down real ground textures (the flat blank material made paint
  // read as untextured vertex tint). Only the true low tier falls back.
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
    sizeX: number;
    sizeZ: number;
    spacing: number;
  }[] = [];

  const bandIndexAt = (cx: number, cz: number): number => {
    const centerX = rb.minX + cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centerZ = rb.minZ + cz * CHUNK_SIZE + CHUNK_SIZE / 2;
    let hubDist = Infinity;
    for (const zn of ZONES) {
      hubDist = Math.min(hubDist, Math.hypot(centerX - zn.hub.x, centerZ - zn.hub.z));
    }
    const idx = bands.findIndex((b) => hubDist <= b.maxHubDist);
    return idx === -1 ? bands.length - 1 : idx;
  };

  const addChunk = (x0: number, z0: number, size: number, spacing: number): void => {
    // Clamp to the render bounds: the grid loop rounds the chunk count UP, so
    // without this the last row/column would render up to a whole chunk of
    // out-of-bounds ground (on blank maps, a junk strip past the map edge).
    const sizeX = Math.min(size, rb.minX + rb.width - x0);
    const sizeZ = Math.min(size, rb.minZ + rb.depth - z0);
    if (sizeX <= 0 || sizeZ <= 0) return;
    const geo = buildChunkGeometry(x0, z0, sizeX, sizeZ, spacing, seed, !lowGfx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
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
        addChunk(
          rb.minX + cx * CHUNK_SIZE,
          rb.minZ + cz * CHUNK_SIZE,
          CHUNK_SIZE * 2,
          bands[farBand].spacing,
        );
      } else {
        built.add(cz * chunksX + cx);
        const band = bands[bandIndexAt(cx, cz)];
        addChunk(rb.minX + cx * CHUNK_SIZE, rb.minZ + cz * CHUNK_SIZE, CHUNK_SIZE, band.spacing);
      }
    }
  }
  return {
    group,
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
