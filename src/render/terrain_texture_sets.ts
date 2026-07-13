// Built-in terrain PBR texture sets (public/textures/terrain/<Key>_*.jpg), the
// single registry behind every "pick a ground texture" UI: the Paint tool's
// built-in swatch library, the Rock tool's base-texture picker, and the Cave
// panel's interior-texture picker. Each set follows the AmbientCG-style file
// convention (Color / NormalGL / Roughness / AmbientOcclusion); `maps` lists
// which files actually exist so loaders never 404-probe.
//
// A paint swatch references a built-in set through the pseudo content hash
// `builtin:<Key>` (see ground_textures.ts): unlike an imported texture's
// sha256, a builtin sha resolves from the app bundle on EVERY machine, so
// maps painted with these swatches never lose their ground art.

export interface TerrainTextureSet {
  /** File-name stem under public/textures/terrain/ (e.g. 'Sand001'). */
  key: string;
  /** Display name (editor UI is English-only; see i18n deferral note). */
  name: string;
  /** Average albedo (0xRRGGBB): swatch fallback color + palette chip. */
  color: number;
  /** Which map files exist for this set. */
  maps: { color: true; normal?: true; rough?: true; ao?: true };
  /** Listed in the Paint tool's built-in texture library (default swatches). */
  paintDefault?: true;
}

const ALL4 = { color: true, normal: true, rough: true, ao: true } as const;
const CN = { color: true, normal: true } as const;

export const TERRAIN_TEXTURE_SETS: readonly TerrainTextureSet[] = [
  // The default texture library: always-available paint swatches.
  { key: 'Grass002', name: 'Meadow Moss', color: 0x4f6b1c, maps: ALL4, paintDefault: true },
  { key: 'Grass003', name: 'Spring Sward', color: 0x637d21, maps: ALL4, paintDefault: true },
  { key: 'Sand001', name: 'Dune Ripples', color: 0x997957, maps: ALL4, paintDefault: true },
  { key: 'Sand002', name: 'Golden Dunes', color: 0xa47a42, maps: ALL4, paintDefault: true },
  { key: 'Sand003', name: 'Smooth Wastes', color: 0xa97348, maps: ALL4, paintDefault: true },
  { key: 'Sand004', name: 'Pebbled Sand', color: 0x985f3a, maps: ALL4, paintDefault: true },
  { key: 'Cliff001', name: 'Red Cliff', color: 0x5f4c38, maps: ALL4, paintDefault: true },
  { key: 'Cliff002', name: 'Mossy Crag', color: 0x3c3f37, maps: ALL4, paintDefault: true },
  // Second Yoge import: 2 more sets per source volume (grass / sand x2 / cliff /
  // ground / rock x2), compressed the same way as the paint sets above (1024
  // JPEG, GL-flipped normals, height-derived roughness). All paintable defaults.
  { key: 'Grass004', name: 'Wild Grass', color: 0x456624, maps: ALL4, paintDefault: true },
  { key: 'Grass005', name: 'Verdant Turf', color: 0x4e6b1c, maps: ALL4, paintDefault: true },
  { key: 'Sand005', name: 'Rippled Dune', color: 0xa9844d, maps: ALL4, paintDefault: true },
  { key: 'Sand006', name: 'Sunlit Sand', color: 0x9b7d42, maps: ALL4, paintDefault: true },
  { key: 'Sand007', name: 'Desert Drift', color: 0xa66c46, maps: ALL4, paintDefault: true },
  { key: 'Sand008', name: 'Amber Sand', color: 0x9d683e, maps: ALL4, paintDefault: true },
  { key: 'Cliff003', name: 'Craggy Rock', color: 0x65533e, maps: ALL4, paintDefault: true },
  { key: 'Cliff004', name: 'Weathered Bluff', color: 0x675340, maps: ALL4, paintDefault: true },
  { key: 'Ground100', name: 'Dark Earth', color: 0x27221e, maps: ALL4, paintDefault: true },
  { key: 'Ground101', name: 'Loam Bed', color: 0x20160d, maps: ALL4, paintDefault: true },
  { key: 'Rock052', name: 'Rugged Stone', color: 0x442b28, maps: ALL4, paintDefault: true },
  { key: 'Rock053', name: 'Ironrock', color: 0x422f2a, maps: ALL4, paintDefault: true },
  { key: 'Rock054', name: 'Sandstone Face', color: 0x7b5b48, maps: ALL4, paintDefault: true },
  { key: 'Rock055', name: 'Rust Rock', color: 0x936235, maps: ALL4, paintDefault: true },
  // Existing shipped sets (the splat/biome textures), pickable for rocks and
  // cave interiors; not repeated in the paint library (the biomes cover them).
  { key: 'Grass001', name: 'Vale Grass', color: 0x445b28, maps: ALL4 },
  { key: 'Ground048', name: 'Rich Soil', color: 0x533e32, maps: ALL4 },
  { key: 'Ground071', name: 'Marsh Mud', color: 0x806649, maps: ALL4 },
  { key: 'Ground080', name: 'Beach Sand', color: 0xb49e70, maps: ALL4 },
  { key: 'Rock029', name: 'Weathered Rock', color: 0x7a5337, maps: CN },
  { key: 'Rock035', name: 'Layered Stone', color: 0x0f191d, maps: CN },
  { key: 'Rock051', name: 'Granite', color: 0x757261, maps: ALL4 },
  { key: 'Gravel024', name: 'Gravel', color: 0x4b4946, maps: CN },
  { key: 'Lava004', name: 'Lava Rock', color: 0xac442e, maps: CN },
  { key: 'Snow010A', name: 'Snow', color: 0xdeeefb, maps: ALL4 },
  { key: 'PavingStones046', name: 'Paving Stones', color: 0x999b99, maps: ALL4 },
];

const BY_KEY = new Map(TERRAIN_TEXTURE_SETS.map((s) => [s.key, s]));

export function terrainTextureSet(key: string): TerrainTextureSet | null {
  return BY_KEY.get(key) ?? null;
}

/** The always-available paint-library sets (built-in default swatches). */
export function paintDefaultSets(): readonly TerrainTextureSet[] {
  return TERRAIN_TEXTURE_SETS.filter((s) => s.paintDefault);
}

// ---- builtin pseudo content hashes (see ground_textures.ts) -----------------

export const BUILTIN_SHA_PREFIX = 'builtin:';

export function builtinShaFor(key: string): string {
  return `${BUILTIN_SHA_PREFIX}${key}`;
}

/** The set key of a builtin pseudo-sha, or null for a real content hash. */
export function builtinKeyOf(sha: string): string | null {
  if (!sha.startsWith(BUILTIN_SHA_PREFIX)) return null;
  const key = sha.slice(BUILTIN_SHA_PREFIX.length);
  return BY_KEY.has(key) ? key : null;
}

/** Relative asset path of one of a set's map files (under the media root). */
export function terrainTexturePath(
  key: string,
  map: 'color' | 'normal' | 'rough' | 'ao',
): string | null {
  const set = BY_KEY.get(key);
  if (!set) return null;
  const suffix =
    map === 'color'
      ? 'Color'
      : map === 'normal'
        ? 'NormalGL'
        : map === 'rough'
          ? 'Roughness'
          : 'AmbientOcclusion';
  const has =
    map === 'color'
      ? set.maps.color
      : map === 'normal'
        ? set.maps.normal
        : map === 'rough'
          ? set.maps.rough
          : set.maps.ao;
  if (!has) return null;
  return `textures/terrain/${key}_${suffix}.jpg`;
}
