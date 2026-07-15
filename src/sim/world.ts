import { type CaveSample, caveFloorAt, caveSampleAt, HOLE_WALL_RISE, inTerrainHole } from './caves';
import {
  CAMPS,
  COLUMN_ZONES,
  columnBlendAt,
  DUNGEON_FLOOR_Y,
  DUNGEON_X_THRESHOLD,
  getActiveWorldContent,
  ROADS,
  STRIP_MAX_X,
  STRIP_MIN_X,
  STRIP_ZONES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  worldXBoundsAt,
  ZONES,
} from './data';
import { dockLocalPoint, dockSectionAtLocal, dockSurfaceLine, dockSurfaceYAt } from './dock_layout';
import { isAuthoredMapPresentation } from './map_presentation';
import { placementRampFloorAt } from './placement_ramps';
import { fbm2, hash2, noise2 } from './rng';
import type { BiomeId, HeightStamp, ZoneDef } from './types';
import { isInSowfieldShell, SOWFIELD_FLAT, sowfieldStandLift } from './vale_cup_layout';

// Terrain is a pure function of (x, z, seed): both the sim (ground clamping)
// and the renderer (mesh) sample the same heightfield, so they always agree.
//
// The world is a north-running strip of zone bands (see ZONES in data.ts).
// Each biome shapes the heightfield differently — the vale rolls, the marsh
// lies low and flat, the peaks tower — with smooth blends at the boundaries
// and a mountain ridge wall between zones, pierced by a road pass.

const HILL_SCALE = 0.013;
const DETAIL_SCALE = 0.05;

export const WATER_LEVEL = -4.5;

// The ACTIVE water surface height: the custom map's level if one is loaded, else
// the built-in constant. Cheap (identity-cached content lookup), safe in hot
// paths. For the built-in world getActiveWorldContent() has no waterLevel, so
// this equals WATER_LEVEL.
export function waterLevel(): number {
  return getActiveWorldContent().waterLevel ?? WATER_LEVEL;
}

// A declared lake's footprint reaches this multiple past its authored radius
// (the same soft-edge basin blend baseHeight uses below), so the render plane,
// the walkable-depth floor, and the terrain basin itself all agree on where a
// lake actually ends.
export const LAKE_BLEND_RADIUS_MULT = 1.6;

// True when (x,z) falls inside a declared lake's footprint (any active zone's
// `lakes` list). Terrain outside every declared water body is never "water", no
// matter how far its height dips below waterLevel(): a content author's sunken
// feature (crater, sinkhole, tunnel) stays dry and walkable as long as it isn't
// inside one of these footprints. (dems's open seas are handled separately by
// the coastal appliers and inHollowOpenSea; this covers only declared lakes.)
export function isInWaterBody(x: number, z: number): boolean {
  for (const zone of getActiveWorldContent().zones) {
    for (const lake of zone.lakes) {
      const dSq = (x - lake.x) ** 2 + (z - lake.z) ** 2;
      const rMax = lake.radius * LAKE_BLEND_RADIUS_MULT;
      if (dSq < rMax * rMax) return true;
    }
  }
  return false;
}

// The water surface height AT this location: waterLevel() inside a declared
// lake's footprint, else -Infinity (there is no water surface here, so nothing
// reads as flooded and no swim-depth floor applies). Callers that need "is there
// water here at all" should prefer this over a flat global constant.
export function waterLevelAt(x: number, z: number): number {
  return isInWaterBody(x, z) ? waterLevel() : -Infinity;
}

// Every declared lake across the active content's zones, in render/authoring
// footprint (radius already includes the basin blend margin). Used to draw
// water only where it is actually declared.
export function waterBodies(): { x: number; z: number; radius: number }[] {
  const out: { x: number; z: number; radius: number }[] = [];
  for (const zone of getActiveWorldContent().zones) {
    for (const lake of zone.lakes) {
      out.push({ x: lake.x, z: lake.z, radius: lake.radius * LAKE_BLEND_RADIUS_MULT });
    }
  }
  return out;
}

// Hill amplitude / base elevation / hub plateau height per biome.
const BIOME_SHAPE: Record<BiomeId, { hill: number; base: number; hubHeight: number }> = {
  vale: { hill: 26, base: 0, hubHeight: 1.5 },
  marsh: { hill: 11, base: -1.0, hubHeight: 1.2 },
  peaks: { hill: 34, base: 7, hubHeight: 9 },
  // The Veiled Hollow: a sheltered valley, gentler than the peaks that hide it.
  dusk: { hill: 14, base: 2, hubHeight: 2.5 },
  ember: { hill: 16, base: 2.5, hubHeight: 2.5 },
  frost: { hill: 26, base: 6, hubHeight: 3 },
  // the Amberfall: rolling autumn weald around the Great Mere
  amber: { hill: 15, base: 2, hubHeight: 2.5 },
  // the Willowfen: low, wet, and gentle
  fen: { hill: 8, base: -0.3, hubHeight: 2 },
  // the Nightbloom: soft moonlit downs, a touch more rolling than the fen
  night: { hill: 12, base: 1, hubHeight: 2.5 },
  // the Wraithwood: low haunted forest floor under the giant canopies
  haunt: { hill: 13, base: 1.5, hubHeight: 2.5 },
  // the Palmreach: low tropical relief, the coasts flattened to beach by
  // the jungle coast applier
  jungle: { hill: 11, base: 1.2, hubHeight: 2 },
  // the Evergarden: groomed parkland, gentle as a lawn
  garden: { hill: 9, base: 1.8, hubHeight: 2 },
  // the Galecrest: rolling wind-scoured headland downs over sea cliffs
  gale: { hill: 14, base: 2.4, hubHeight: 2.5 },
  // Paint-only biomes (the editor's biome brush): never a zone band in the
  // built-in world, so these rows only shape painted cells on custom maps.
  beach: { hill: 5, base: -2.4, hubHeight: 0.8 },
  desert: { hill: 15, base: 2.5, hubHeight: 2 },
  volcano: { hill: 42, base: 9, hubHeight: 6 },
  cave: { hill: 9, base: 1, hubHeight: 1 },
};

// Ridge walls along every shared zone edge, each opened by a road pass. A
// zone with sealedSouthBorder instead gets a taller, narrower wall with NO
// pass, its crest shifted into the sealed zone's own band so the southern
// neighbor's border content keeps (nearly) its original ground. Sealed
// zones are entered only through a portal (see portals content).
//
// The world is a GRID of zone rectangles (see data.ts zoneAt): horizontal
// edges separate north-south neighbors (the classic band borders) and
// vertical edges separate east-west columns with the same math rotated a
// quarter turn. An edge that spans its whole world row keeps the classic
// unbounded ridge (byte-identical to the strip era); a partial edge
// feathers to nothing past its span ends.
export interface BorderEdge {
  kind: 'h' | 'v';
  at: number; // the edge line: z for 'h', x for 'v'
  lo: number; // span start along the edge (x for 'h', z for 'v')
  hi: number; // span end
  fullRow: boolean; // spans the whole world row: no end feather
  passAt: number; // pass coordinate along the span
  sealed: boolean;
}

/** All shared edges between adjacent zone rects (pure; exported for tests). */
export function computeBorderEdges(zones: readonly ZoneDef[]): BorderEdge[] {
  const zx0 = (zn: ZoneDef) => zn.xMin ?? STRIP_MIN_X;
  const zx1 = (zn: ZoneDef) => zn.xMax ?? STRIP_MAX_X;
  const edges: BorderEdge[] = [];
  for (const a of zones) {
    for (const b of zones) {
      // horizontal edge: b sits directly north of a, rects overlapping in x
      if (a.zMax === b.zMin) {
        const lo = Math.max(zx0(a), zx0(b));
        const hi = Math.min(zx1(a), zx1(b));
        if (hi - lo > 1) {
          const sealed = b.sealedSouthBorder === true;
          // full row = nothing that touches or crosses the border line lies
          // beyond this span (a column zone whose band SPANS the line counts
          // too: its interior must not inherit the row wall)
          const fullRow = zones.every(
            (zn) => zn.zMax < a.zMax || zn.zMin > a.zMax || (zx0(zn) >= lo && zx1(zn) <= hi),
          );
          edges.push({
            kind: 'h',
            at: a.zMax + (sealed ? 15 : 0),
            lo,
            hi,
            fullRow,
            passAt: b.southPassX ?? 0,
            sealed,
          });
        }
      }
      // vertical edge: b sits directly east of a, rects overlapping in z
      if (zx1(a) === zx0(b)) {
        const lo = Math.max(a.zMin, b.zMin);
        const hi = Math.min(a.zMax, b.zMax);
        if (hi - lo > 1) {
          edges.push({
            kind: 'v',
            at: zx1(a),
            lo,
            hi,
            fullRow: false, // a column border never spans the world's full z
            passAt: b.westPassZ ?? a.eastPassZ ?? (lo + hi) / 2,
            sealed: false,
          });
        }
      }
    }
  }
  return edges;
}

const BORDER_EDGES: readonly BorderEdge[] = computeBorderEdges(ZONES);
// Low, broad border ranges: steep enough to read as a border, gentle
// enough that ANY land contact between two maps is walkable over (the
// pass roads stay the easy way; the hills are never a hard wall). Only
// the sealed border is a true barrier.
const RIDGE_HEIGHT = 15;
const RIDGE_SIGMA = 26; // gaussian width of the wall
// Sealed walls: tall and steep enough that the straight-approach gradient
// beats PLAYER_MAX_CLIMB_SLOPE everywhere along the border. The slope gate
// alone cannot seal a smooth wall (it projects rise along the movement
// direction, so a shallow-enough diagonal always sneaks under it); the crest
// line is therefore ALSO a hard movement wall in colliders.resolveMovement
// via crossesSealedBorder below. The terrain steepness is the fiction; the
// crossing check is the guarantee (guarded by tests/veiled_hollow.test.ts).
const SEALED_RIDGE_HEIGHT = 60;
const SEALED_RIDGE_SIGMA = 12;

// Crest z of every sealed border: an uncrossable line for swept movement
// within the edge's x span (plus its feather). Portal teleports assign
// positions directly and are unaffected; the column realms whose bands
// span the same z live outside the span and walk freely.
export const SEALED_BORDERS: readonly { at: number; lo: number; hi: number }[] =
  BORDER_EDGES.filter((e) => e.kind === 'h' && e.sealed).map((e) => ({
    at: e.at,
    lo: e.lo - 24,
    hi: e.hi + 24,
  }));

export function crossesSealedBorder(x: number, z0: number, z1: number): boolean {
  for (const b of SEALED_BORDERS) {
    if (x >= b.lo && x <= b.hi && (z0 - b.at) * (z1 - b.at) < 0) return true;
  }
  return false;
}
const PASS_HALF_WIDTH = 10; // flat opening around the road
const PASS_SHOULDER = 34; // ...rising to full wall by this far from the pass

// The Veiled Hollow's organic relief, layered over the base FBM hills the
// same way the Mirefen crater is: gentle radial features that break the
// band's uniformity into highlands, a meadow bowl, and the falls terrace
// whose steep southern lip pours into Starfall Basin (the lake carve and the
// terrace overlap; the height step between them IS the waterfall cliff,
// dressed by render/realm_flora.ts).
export const HOLLOW_FALLS = {
  terrace: { x: 128, z: 1008, radius: 22, height: 9 },
  // where the lip meets the basin: the render waterfall hangs here
  lip: { x: 118, z: 995 },
} as const;
const HOLLOW_SHAPING = [
  {
    x: HOLLOW_FALLS.terrace.x,
    z: HOLLOW_FALLS.terrace.z,
    r: HOLLOW_FALLS.terrace.radius,
    h: HOLLOW_FALLS.terrace.height,
  },
  { x: -135, z: 1090, r: 45, h: 7 }, // western highlands (the Mirrormere sits in them)
  { x: 20, z: 1005, r: 35, h: -2.2 }, // soft meadow bowl south of the town road
  { x: -110, z: 1210, r: 28, h: 6 }, // a crescent knoll sheltering the Deep's north rings
  // the Tablecrag's bulk (its flat crown is leveled after the rims, below)
  { x: -170, z: 1195, r: 46, h: 12 },
  // ...and its southern sister over the old inlet
  { x: -168, z: 1075, r: 38, h: 10 },
] as const;

// ---------------------------------------------------------------------------
// The Hollow's coastline. The realm is an organic landmass in a dusk sea:
// a union of soft land lobes (peninsulas for the cave arrival, the western
// highlands, the Gleaming Deep, the northeast monument arm, the Starfall
// headland) minus carved bays. Terrain outside the coast sinks to a seabed,
// and the full-band water plane plus the map painter's blue do the rest, so
// the world map reads like a real continent silhouette instead of a square.
// Every fixed content point (camps, town, roads, ruins) sits on a lobe with
// margin; tests/veiled_hollow.test.ts asserts it stays that way.
// ---------------------------------------------------------------------------
// Keep in sync with REALM_ZONE.zMax (content/realm.ts): the band's northern
// stretch past the coast is open ocean.
const HOLLOW_ZMAX = 1440;
const HOLLOW_LAND_LOBES = [
  { x: 0, z: 1060, r: 155 }, // main body: town, meadow, court's west edge
  { x: -125, z: 1010, r: 85 }, // southwest: the Duskfall arrival and overlook
  { x: -140, z: 925, r: 55 }, // the sealed range's western shoulder
  { x: 10, z: 935, r: 90 }, // the sealed range's center and Elder Grove
  { x: 140, z: 925, r: 60 }, // the sealed range's eastern shoulder
  { x: -125, z: 1150, r: 75 }, // western highlands and the Mirrormere
  { x: -55, z: 1200, r: 75 }, // the Gleaming Deep's north rings
  { x: 95, z: 1150, r: 75 }, // the Crystalline Shallows
  { x: 20, z: 1172, r: 38 }, // the Deep road's shoulder (organic-warp dip)
  { x: 150, z: 1215, r: 62 }, // the northeast arm (the forgotten monument)
  { x: 120, z: 995, r: 72 }, // the Starfall headland and falls terrace
  { x: 130, z: 1082, r: 48 }, // the Sunken Court peninsula
  // the Pale Causeway: a winding isthmus rooted in the north coast and
  // running across the ocean to the band edge, where a future realm will
  // one day connect (adjacent lobes overlap deeply so the spine is one
  // continuous, walkable landmass)
  { x: 0, z: 1250, r: 48 }, // the root, fused with the mainland coast
  { x: 30, z: 1300, r: 44 },
  { x: 48, z: 1355, r: 40 },
  { x: 44, z: 1420, r: 48 },
  // the western edge arm: a low coastal ridge along the map border that
  // encloses the old open water as the Mirrorshallow lake
  { x: 184, z: 1000, r: 50 },
  { x: 186, z: 1075, r: 52 },
  { x: 184, z: 1150, r: 50 },
  // the eastern highland shoulder: the old bay is filled and the Tablecrag
  // (a flat-topped mesa, see HOLLOW_SHAPING) rises over the Deep's flank
  { x: -178, z: 1190, r: 60 },
  { x: -180, z: 1255, r: 48 },
  { x: -176, z: 1080, r: 55 }, // ...and its southern reach over the old inlet
  { x: -180, z: 1412, r: 46 }, // the corner arm carrying the Snowline cap's footing to the sound
  { x: -118, z: 1420, r: 44 }, // the sound's north shore under the Gatewood's new west reach
] as const;
const HOLLOW_BAYS = [
  // (the old bight at {182,1038} became the Mirrorshallow: see the edge arm
  // lobes below, which enclose that water as a lake)
  { x: -62, z: 1270, r: 50 }, // the north sound, west of the causeway root
] as const;
const HOLLOW_SEA_FLOOR = WATER_LEVEL - 5;

// >0 on land, <0 at sea; the coast is the soft zero crossing. One metaball
// evaluator shared by every northern realm's coastline (same math the Hollow
// shipped with, extracted verbatim when the Drakelands and the Frostveil
// added their own lobe tables).
type CoastBlob = { readonly x: number; readonly z: number; readonly r: number };
// One terrainHeight sample evaluates SEVERAL realms' landness at the same
// (x, z) (its own coast, seam neighbours, the border seaGate, the open-sea
// check), and the three fixed-seed fbm terms below depend only on (x, z),
// never on the lobe tables. A last-point memo shares them across those calls:
// pure caching of identical inputs, so every result stays bit-identical.
let mbMemoX = Number.NaN;
let mbMemoZ = Number.NaN;
let mbMemoWX = 0;
let mbMemoWZ = 0;
let mbMemoRag = 0;
// Per-table bounding box of every blob's reach, cached by array identity. A
// warped point outside the box contributes zero from every blob (all d2 >= 1),
// so the whole loop can be skipped bit-identically. terrainHeight consults
// far realms' landness on most samples (border seaGates, the open-sea check),
// which is exactly the always-outside case this gate removes.
interface BlobBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
const blobBoundsCache = new WeakMap<readonly CoastBlob[], BlobBounds>();
function blobBounds(blobs: readonly CoastBlob[]): BlobBounds {
  let b = blobBoundsCache.get(blobs);
  if (!b) {
    b = {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minZ: Number.POSITIVE_INFINITY,
      maxZ: Number.NEGATIVE_INFINITY,
    };
    for (const blob of blobs) {
      b.minX = Math.min(b.minX, blob.x - blob.r);
      b.maxX = Math.max(b.maxX, blob.x + blob.r);
      b.minZ = Math.min(b.minZ, blob.z - blob.r);
      b.maxZ = Math.max(b.maxZ, blob.z + blob.r);
    }
    blobBoundsCache.set(blobs, b);
  }
  return b;
}
function metaballLandness(
  lobes: readonly CoastBlob[],
  bays: readonly CoastBlob[],
  x: number,
  z: number,
): number {
  // Organic coastlines: the raw metaball union reads as connecting circles,
  // so the sample position is domain-warped by fixed-seed fbm (bending the
  // blobs into peninsulas and coves) and the result gets a higher-frequency
  // raggedness term (small capes and inlets). The seeds are CONSTANTS, not
  // the world seed: landness must stay a pure fn of (x, z) because content
  // tables, tests, and the sim's open-sea check were all placed against it.
  if (x !== mbMemoX || z !== mbMemoZ) {
    mbMemoX = x;
    mbMemoZ = z;
    mbMemoWX = x + (fbm2(x * 0.015, z * 0.015, 9101, 3) - 0.5) * 46;
    mbMemoWZ = z + (fbm2(x * 0.015 + 73, z * 0.015 - 41, 9103, 3) - 0.5) * 46;
    mbMemoRag = (fbm2(x * 0.05, z * 0.05, 9107, 2) - 0.5) * 0.2;
  }
  const wx = mbMemoWX;
  const wz = mbMemoWZ;
  let land = 0;
  const lb = blobBounds(lobes);
  if (wx >= lb.minX && wx <= lb.maxX && wz >= lb.minZ && wz <= lb.maxZ) {
    for (const b of lobes) {
      // |dx| >= r means d2 >= 1 regardless of dz: skip the divisions early
      const dx = wx - b.x;
      if (dx >= b.r || -dx >= b.r) continue;
      const d2 = (dx / b.r) ** 2 + ((wz - b.z) / b.r) ** 2;
      if (d2 < 1) land += (1 - d2) ** 2;
    }
  }
  if (bays.length > 0) {
    const bb = blobBounds(bays);
    if (wx >= bb.minX && wx <= bb.maxX && wz >= bb.minZ && wz <= bb.maxZ) {
      for (const b of bays) {
        const dx = wx - b.x;
        if (dx >= b.r || -dx >= b.r) continue;
        const d2 = (dx / b.r) ** 2 + ((wz - b.z) / b.r) ** 2;
        if (d2 < 1) land -= 1.4 * (1 - d2) ** 2;
      }
    }
  }
  land += mbMemoRag;
  return land - 0.06;
}

export function hollowLandness(x: number, z: number): number {
  return metaballLandness(HOLLOW_LAND_LOBES, HOLLOW_BAYS, x, z);
}

// ---------------------------------------------------------------------------
// The Drakelands' landmass: a gatewood shore fused to the causeway landing,
// widening into the desert body, then a broad volcanic belt spanning the far
// north (the Drakemaw range doubles as the sealed wall's footing where it
// meets land; over the flanks the range simply runs into the sea).
// ---------------------------------------------------------------------------
const DRAKE_ZMIN = 1820; // keep in sync with DRAKELANDS_ZONE.zMin (east column)
const DRAKE_ZMAX = 2420; // ...and zMax
const EMBER_LAND_LOBES = [
  { x: 404, z: 1825, r: 40 }, // the causeway landing, fused across the border
  { x: 404, z: 1858, r: 52 }, // the Wyrmgate shore and Wyrmwatch
  { x: 360, z: 1900, r: 70 }, // the Gatewood
  { x: 450, z: 1920, r: 55 }, // eastern gatewood shore
  { x: 455, z: 1995, r: 55 }, // the Last Spring headland
  { x: 290, z: 1940, r: 60 }, // western gatewood shore
  { x: 380, z: 2030, r: 90 }, // the drying midlands
  { x: 280, z: 2080, r: 65 }, // Mirage Hollow's dune shelf
  { x: 262, z: 2020, r: 46 }, // ...its southern shoulder under the dune road
  { x: 274, z: 2170, r: 48 }, // ...and the shelf road's western shoulder
  { x: 470, z: 2070, r: 70 }, // eastern dunes
  { x: 465, z: 2150, r: 60 }, // Trollmoot's rise
  { x: 405, z: 2170, r: 55 }, // the dune saddle carrying the Trollmoot fork
  { x: 340, z: 2160, r: 85 }, // the Cinder Dunes' heart
  { x: 420, z: 2260, r: 80 }, // approach to the Drakemaw
  { x: 360, z: 2238, r: 45 }, // the saddle carrying the Snowline road
  { x: 290, z: 2250, r: 75 }, // the Bloodglass shelf
  { x: 360, z: 2355, r: 95 }, // the Drakemaw belt
  { x: 490, z: 2330, r: 60 }, // eastern volcanic spur
  { x: 220, z: 2340, r: 55 }, // western volcanic spur
  { x: 450, z: 2400, r: 70 }, // the rim belt, wide under the sealed range
  { x: 270, z: 2400, r: 70 },
  { x: 360, z: 2410, r: 80 },
  { x: 242, z: 2080, r: 42 }, // the Snowline crossing's waste-side shoulder
  { x: 208, z: 2080, r: 40 }, // ...carried to the column border
  { x: 216, z: 1930, r: 44 }, // the Snowline's waste-side shoulder
  { x: 236, z: 1972, r: 46 }, // ...rising onto the dune shelf road
  { x: 376, z: 1952, r: 42 }, // the town road's western shoulder
  { x: 242, z: 1858, r: 46 }, // the cap's shore joining the Gatewood...
  { x: 264, z: 1908, r: 44 }, // ...so no channel runs behind it to the sound
  { x: 492, z: 2390, r: 48 }, // the Goldmelt Water's east cap, waste side
] as const;
const EMBER_BAYS = [
  { x: 195, z: 1980, r: 50 }, // the west bight
  { x: 535, z: 2180, r: 55 }, // the east reach
  { x: 205, z: 2230, r: 40 }, // a western cove under the spur
] as const;

export function emberLandness(x: number, z: number): number {
  return metaballLandness(EMBER_LAND_LOBES, EMBER_BAYS, x, z);
}

// ---------------------------------------------------------------------------
// The Frostveil Reach: a snowbound island massif. Its south rim carries the
// sealed wall's footing (the Heartfrost side), the body climbs in terraced
// benches (frost shaping below), and the north coast meets the world's edge
// sea like the Hollow's does.
// ---------------------------------------------------------------------------
const FROST_ZMAX = 1960; // keep in sync with FROSTVEIL_ZONE.zMax (the strip's north end)
const FROST_LAND_LOBES = [
  { x: 0, z: 1460, r: 95 }, // the south rim: Heartfrost Cavern's shelf
  { x: -120, z: 1475, r: 60 }, // western wall footing
  { x: 120, z: 1475, r: 60 }, // eastern wall footing
  { x: 0, z: 1500, r: 85 }, // the rim benches
  { x: -40, z: 1630, r: 90 }, // the Icemantle massif
  { x: -30, z: 1558, r: 45 }, // the town shelf under Icemantle itself
  { x: 80, z: 1600, r: 75 }, // Glacier Tarn's shoulder
  { x: 30, z: 1670, r: 65 }, // the inner valley joining the tarn to the Steps
  { x: 20, z: 1750, r: 95 }, // the Aurora Steps
  { x: -100, z: 1720, r: 70 }, // the Shiverfen shelf
  { x: -68, z: 1806, r: 46 }, // the Goldmelt road's first shoulder off the Steps
  { x: -120, z: 1820, r: 48 }, // the west shore's rise under the Goldmelt road
  { x: -132, z: 1856, r: 40 }, // ...its mid rise
  { x: -158, z: 1872, r: 44 }, // the Goldmelt's ice-side shoulder
  { x: -162, z: 1930, r: 48 }, // the Palewater's north cap, ice side
  { x: 120, z: 1790, r: 65 }, // the Howling Terraces
  { x: 158, z: 1852, r: 44 }, // the Snowline's ice-side shoulder
  { x: 116, z: 1744, r: 42 }, // the tarn road's eastern shoulder
  { x: 0, z: 1870, r: 80 }, // the north crown
  { x: 10, z: 1945, r: 50 }, // the Goldmelt corridor's south footing
  { x: 146, z: 1700, r: 44 }, // the Snowline crossing's ice-side shoulder
  { x: 108, z: 1700, r: 42 }, // ...rising onto the benches
  { x: 54, z: 1638, r: 42 }, // the crossing road's bench shoulder
  { x: 98, z: 1672, r: 40 }, // ...stepping down toward the border
  { x: 86, z: 1824, r: 42 }, // the terrace road's north shoulder
  { x: 42, z: 1674, r: 40 }, // the tarn road's southern loop
  { x: 78, z: 1694, r: 38 }, // ...meeting the crossing shoulder
  { x: 162, z: 1468, r: 48 }, // the Meltwater's south cap, ice side
  { x: 162, z: 1930, r: 48 }, // the Meltwater's north cap, ice side
  { x: 102, z: 1888, r: 46 }, // the shore between the Terraces and the crown, closing the cap
  { x: -60, z: 1958, r: 40 }, // the north crown's headlands push into the bay...
  { x: 44, z: 1962, r: 36 }, // ...and a second, so the north shore is lobed
  { x: -30, z: 1452, r: 46 }, // the south shore's rise east of the Wyrmgate
  { x: 70, z: 1450, r: 42 }, // ...and its east headland over the sound
  { x: 52, z: 1974, r: 26 }, // a north-center headland east of the new cove
] as const;
const FROST_BAYS = [
  { x: 165, z: 1660, r: 55 }, // the east sound
  { x: -165, z: 1580, r: 50 }, // the west inlet
  { x: 60, z: 1945, r: 50 }, // the north cove
  { x: -108, z: 1952, r: 40 }, // ...and a second cove, west of the crown
  { x: 8, z: 1470, r: 40 }, // a south cove biting the shore east of the Wyrmgate
  { x: 24, z: 1976, r: 34 }, // a cove splitting the flat north-center headland
] as const;

export function frostLandness(x: number, z: number): number {
  return metaballLandness(FROST_LAND_LOBES, FROST_BAYS, x, z);
}

// ---------------------------------------------------------------------------
// The Amberfall: an autumn weald around the Great Mere, its south fringe
// carrying the sealed wall's footing, meadow shelves east and west, and a
// north crown meeting the world's end sea.
// ---------------------------------------------------------------------------
const AMBER_ZMIN = 1820; // keep in sync with AMBERFALL_ZONE.zMin (west column)
const AMBER_ZMAX = 2380; // ...and zMax
const AMBER_LAND_LOBES = [
  { x: -350, z: 1850, r: 60 }, // the Goldmelt pass mouth
  { x: -420, z: 1880, r: 70 }, // the arrival shelf west of the pass
  { x: -340, z: 1910, r: 80 }, // the south weald
  { x: -260, z: 1950, r: 65 }, // Harvest Hollow's shelf
  { x: -305, z: 1985, r: 50 }, // the harvest road's field saddle
  { x: -450, z: 2010, r: 75 }, // the Gilded Orchard
  { x: -400, z: 1950, r: 55 }, // the Rootway road's meadow saddle
  { x: -360, z: 2040, r: 90 }, // Lanternmere's shore
  { x: -360, z: 2130, r: 95 }, // the Great Mere basin
  { x: -440, z: 2210, r: 70 }, // Cindermaple Rise
  { x: -265, z: 2220, r: 70 }, // the Monolith heath
  { x: -360, z: 2300, r: 85 }, // the north crown
  { x: -380, z: 2355, r: 55 }, // the Amberfen Steps' northern footing
  { x: -268, z: 2232, r: 40 }, // the mere lurkers' reeded shore
  { x: -306, z: 2160, r: 44 }, // the east mere road's shoulder
  { x: -490, z: 1852, r: 48 }, // the Goldmelt Water's west cap, amber side
  { x: -230, z: 1852, r: 48 }, // the Goldmelt Water's east cap, amber side
  { x: -210, z: 1896, r: 46 }, // ...joined to Harvest Hollow's shelf
  { x: -492, z: 2344, r: 50 }, // the Amber Broads' west cap, amber side
  { x: -465, z: 2290, r: 46 }, // ...joined to the north crown and Cindermaple Rise
  { x: -198, z: 2352, r: 50 }, // the southeast corner knot, amber quarter
  { x: -225, z: 2280, r: 48 }, // ...joined to the Monolith heath
] as const;
const AMBER_BAYS = [
  { x: -190, z: 2080, r: 55 }, // the east sound
  { x: -530, z: 2120, r: 55 }, // the west reach
  { x: -320, z: 2375, r: 45 }, // the north cove
] as const;

export function amberLandness(x: number, z: number): number {
  return metaballLandness(AMBER_LAND_LOBES, AMBER_BAYS, x, z);
}

// ---------------------------------------------------------------------------
// The Willowfen: a low green wetland platter, widest of the north realms,
// its coasts gentle everywhere (no cliffs in a fen).
// ---------------------------------------------------------------------------
const FEN_ZMIN = 180; // keep in sync with WILLOWFEN_ZONE.zMin (west column)
const FEN_ZMAX = 700; // ...and zMax
const FEN_LAND_LOBES = [
  { x: -380, z: 210, r: 65 }, // the Amberfen Steps' shelf
  { x: -400, z: 662, r: 46 }, // the Tanglemouth's fen-side shoulder
  { x: -330, z: 260, r: 80 }, // the eastern fen
  { x: -430, z: 300, r: 85 }, // the Lilymoors' platter
  { x: -360, z: 360, r: 90 }, // Bridgemere's wetland heart
  { x: -270, z: 320, r: 65 }, // Bogshine's shelf
  { x: -420, z: 460, r: 85 }, // Willowweep
  { x: -320, z: 490, r: 80 }, // the Drowsy Flats
  { x: -360, z: 590, r: 85 }, // the north fen
  { x: -470, z: 390, r: 60 },
  { x: -250, z: 440, r: 60 },
  { x: -390, z: 660, r: 55 }, // the Nightgate's southern footing
  { x: -402, z: 538, r: 40 }, // the north track's shoulder (organic-warp dip)
  { x: -390, z: 694, r: 38 }, // the border footing right under the Nightgate
  { x: -240, z: 440, r: 45 }, // the Windway road's fen-side shoulder
  { x: -200, z: 440, r: 42 }, // ...carried right up to the column border
  { x: -300, z: 405, r: 42 }, // the east track's moor
  { x: -492, z: 218, r: 50 }, // the Amber Broads' west cap, fen side
  { x: -198, z: 210, r: 50 }, // the corner knot, fen quarter: seals the Windmere's mouth
  { x: -456, z: 640, r: 44 }, // ...joined to the north fen
  { x: -198, z: 672, r: 48 }, // the Four Corners, fen quarter
] as const;
const FEN_BAYS = [
  { x: -190, z: 360, r: 55 }, // the east sound
  { x: -530, z: 510, r: 55 }, // the west reach
  { x: -330, z: 695, r: 50 }, // the north cove
] as const;

export function fenLandness(x: number, z: number): number {
  return metaballLandness(FEN_LAND_LOBES, FEN_BAYS, x, z);
}

// Gentle everywhere: the fen's shelf is wider and its floor shallower than
// the other realms' (bog country, not sea cliffs).
function applyFenCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(FEN_ZMIN - 8, FEN_ZMIN + 8, z) * (1 - smoothstep(FEN_ZMAX - 8, FEN_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the west column: cross-fade toward the marsh at the border (a step in
  // terrainHeight along the border line buries walkers; the render mesh
  // interpolates across it, the sim does not)
  if (x < -566) return h; // nothing west of the world
  const seam = 1 - smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x);
  if (seam <= 0) return h;
  const land = fenLandness(x, z);
  const t = Math.max(greenSeamT(x, z), smoothstep(0.02, 0.34, land));
  const shelf = smoothstep(-0.5, 0.06, land);
  const floor = WATER_LEVEL - 3.4 + (WATER_LEVEL - 1 - (WATER_LEVEL - 3.4)) * shelf;
  let out = floor + (h - floor) * t;
  // the Mirewalk: a flat floor easing onto the marsh across the border
  const passE = (1 - smoothstep(26, 52, Math.abs(z - 440))) * smoothstep(-260, -215, x);
  if (passE > 0) out = out + (6 + (out - 6) * 0.15 - out) * passE;
  // ...and the Tanglemouth's south ramp, meeting the jungle's pass cap
  const passN = (1 - smoothstep(26, 52, Math.abs(x + 400))) * smoothstep(640, 685, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// ---------------------------------------------------------------------------
// The Nightbloom: moonlit downs under permanent night, the world's current
// northern end. Gentle coasts like the fen's; the north shore looks out over
// open starlit sea.
// ---------------------------------------------------------------------------
const NIGHT_ZMIN = 1260; // keep in sync with NIGHTBLOOM_ZONE.zMin (west column)
const NIGHT_ZMAX = 1820; // ...and zMax
const NIGHT_LAND_LOBES = [
  { x: -390, z: 1300, r: 60 }, // the Nightgate's shelf
  { x: -330, z: 1298, r: 46 }, // ...and the crossing's dark-side shoulder
  { x: -340, z: 1380, r: 90 }, // the realm's heart: Moonrest and the Moonwell
  { x: -440, z: 1480, r: 80 }, // Gloamfield's flower downs
  { x: -280, z: 1550, r: 70 }, // the Standing Vigil's rise
  { x: -360, z: 1660, r: 85 }, // the barrow downs
  { x: -365, z: 1520, r: 80 }, // the midrealm saddle: bridges heart to barrow
  { x: -372, z: 1448, r: 42 }, // the saddle's south seam, under the barrow road
  { x: -360, z: 1588, r: 45 }, // ...and its north seam at the barrow's foot
  { x: -325, z: 1485, r: 55 }, // the Vigil road's shoulder
  { x: -480, z: 1570, r: 55 }, // the west arm
  { x: -230, z: 1380, r: 50 }, // the east arm
  { x: -330, z: 1780, r: 48 }, // the Crowgate's southern footing
  { x: -350, z: 1720, r: 50 }, // the dream road's shoulder past the Barrowmere
  { x: -300, z: 1600, r: 62 }, // the Dreamer's Rise: dry footing under the caldera
  { x: -228, z: 1540, r: 44 }, // the Dreamsedge crossing's dream-side shoulder
  { x: -492, z: 1550, r: 44 }, // the Tanglemouth crossing's dream-side shoulder
  { x: -528, z: 1550, r: 40 }, // ...to the jungle's border
  { x: -330, z: 1808, r: 40 }, // the Garden Gate's southern footing
  { x: -522, z: 1288, r: 48 }, // the Tanglewater's south cap, dream side
  { x: -522, z: 1782, r: 48 }, // the Tanglewater's north cap, dream side
  { x: -522, z: 1800, r: 44 }, // ...and its west twin
] as const;
const NIGHT_BAYS = [
  { x: -190, z: 1520, r: 55 }, // the east sound
  { x: -530, z: 1380, r: 55 }, // the west reach
  { x: -420, z: 1770, r: 50 }, // the north bight, open to the starlit sea
] as const;

export function nightLandness(x: number, z: number): number {
  return metaballLandness(NIGHT_LAND_LOBES, NIGHT_BAYS, x, z);
}

// Gentle everywhere, the fen's recipe: soft downs easing into a dark sea.
function applyNightCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(NIGHT_ZMIN - 8, NIGHT_ZMIN + 8, z) *
    (1 - smoothstep(NIGHT_ZMAX - 8, NIGHT_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the west column: cross-fade toward the strip at the border
  if (x < -566) return h; // nothing west of the world
  const seam = 1 - smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x);
  if (seam <= 0) return h;
  const land = nightLandness(x, z);
  const t = smoothstep(0.02, 0.32, land);
  const shelf = smoothstep(-0.5, 0.06, land);
  const floor = WATER_LEVEL - 3.6 + (WATER_LEVEL - 1 - (WATER_LEVEL - 3.6)) * shelf;
  let out = floor + (h - floor) * t;
  // the Nightgate: flat pass floor across the border with the jungle
  const passT = (1 - smoothstep(26, 52, Math.abs(x + 330))) * (1 - smoothstep(1310, 1360, z));
  if (passT > 0) out = out + (6 + (out - 6) * 0.15 - out) * passT;
  // ...and the gold road's south ramp, meeting the Amberfall's pass cap
  const passN = (1 - smoothstep(26, 52, Math.abs(x + 350))) * smoothstep(1760, 1805, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// ---------------------------------------------------------------------------
// The Wraithwood: the haunted forest at the world's current northern end.
// A broad wooded platter whose shores sink into a drowned grey sea.
// ---------------------------------------------------------------------------
const WOOD_ZMIN = 1260; // keep in sync with WRAITHWOOD_ZONE.zMin (east column)
const WOOD_ZMAX = 1820; // ...and zMax
const WOOD_LAND_LOBES = [
  { x: 390, z: 1300, r: 55 }, // the Crowgate's shelf
  { x: 398, z: 1742, r: 46 }, // the Wyrmroad's wood-side shoulder...
  { x: 404, z: 1790, r: 46 }, // ...carried to the waste's border
  { x: 360, z: 1420, r: 90 }, // the realm's heart: Gallowmere under the eaves
  { x: 280, z: 1490, r: 80 }, // Widow's Thicket
  { x: 440, z: 1530, r: 75 }, // the Hanging Glade
  { x: 410, z: 1488, r: 40 }, // the glade road's shoulder
  { x: 300, z: 1620, r: 70 }, // the Mournstone rise
  { x: 370, z: 1690, r: 80 }, // the Huntsman's clearing
  { x: 350, z: 1540, r: 70 }, // the midwood saddle: bridges hamlet to chapel
  { x: 374, z: 1600, r: 50 }, // the clearing road's shoulder
  { x: 230, z: 1560, r: 55 }, // the west arm
  { x: 490, z: 1440, r: 50 }, // the east arm
  { x: 470, z: 1700, r: 48 }, // ...running down to the Ashmere's cap
  { x: 300, z: 1770, r: 48 }, // the Tanglemouth's southern footing
  { x: 308, z: 1705, r: 45 }, // the west track's shoulder toward the pass
  { x: 300, z: 1800, r: 42 }, // the border footing right under the pass
  { x: 250, z: 1540, r: 42 }, // ...under the first black eaves
  { x: 252, z: 1792, r: 44 }, // ...joined to the Tanglemouth road's footing
  { x: 508, z: 1364, r: 48 }, // the east eaves' shore, closing the coast under the corner
  { x: 502, z: 1288, r: 48 }, // the Crowmere's east cap, wood side
] as const;
const WOOD_BAYS = [
  { x: 548, z: 1520, r: 42 }, // the east sound, pushed off the coast
  { x: 190, z: 1400, r: 55 }, // the west reach
  { x: 300, z: 1795, r: 50 }, // the north bight, now a basin of the Ashmere
] as const;

export function woodLandness(x: number, z: number): number {
  return metaballLandness(WOOD_LAND_LOBES, WOOD_BAYS, x, z);
}

// Gentle shores under the murk, the fen recipe again.
function applyWoodCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(WOOD_ZMIN - 8, WOOD_ZMIN + 8, z) * (1 - smoothstep(WOOD_ZMAX - 8, WOOD_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the east column: cross-fade toward the strip at the border
  if (x > 566) return h; // nothing east of the world (instance space far beyond)
  const seam = smoothstep(STRIP_MAX_X - 8, STRIP_MAX_X + 8, x);
  if (seam <= 0) return h;
  const land = woodLandness(x, z);
  const t = smoothstep(0.02, 0.32, land);
  const shelf = smoothstep(-0.5, 0.06, land);
  const floor = WATER_LEVEL - 3.6 + (WATER_LEVEL - 1 - (WATER_LEVEL - 3.6)) * shelf;
  let out = floor + (h - floor) * t;
  // the Crowgate: flat pass floor up from the garden's lawns
  const passT = (1 - smoothstep(26, 52, Math.abs(x - 390))) * (1 - smoothstep(1310, 1360, z));
  if (passT > 0) out = out + (6 + (out - 6) * 0.15 - out) * passT;
  // ...and the Wyrmgate road's north ramp, meeting the waste's pass cap
  const passN = (1 - smoothstep(26, 52, Math.abs(x - 404))) * smoothstep(1760, 1805, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// ---------------------------------------------------------------------------
// The Palmreach: the tropical realm at the world's current northern end.
// Its signature is the coast: every shore is flattened into a wide, gently
// sloped beach shelf, so the land meets a turquoise sea over sand instead of
// bluffs. The eastern arm cups the Sapphire Lagoon.
// ---------------------------------------------------------------------------
const REACH_ZMIN = 700; // keep in sync with PALMREACH_ZONE.zMin (west column)
const REACH_ZMAX = 1260; // ...and zMax
const REACH_LAND_LOBES = [
  { x: -420, z: 740, r: 55 }, // the Tanglemouth's shelf
  { x: -402, z: 736, r: 44 }, // ...and the crossing's jungle-side shoulder
  { x: -332, z: 1222, r: 46 }, // the Nightgate's jungle-side shoulder
  { x: -460, z: 890, r: 75 }, // the Palmstrand's long beach arm
  { x: -360, z: 940, r: 95 }, // the Emerald Tangle: the realm's green heart
  { x: -300, z: 830, r: 70 }, // Drifthaven's strand
  { x: -265, z: 895, r: 60 }, // the lagoon's northern arm...
  { x: -235, z: 990, r: 55 }, // ...curling east around the water
  { x: -242, z: 948, r: 40 }, // the idol road's shoulder on the lagoon's rim
  { x: -260, z: 1080, r: 60 }, // the Sunken Idol's headland
  { x: -400, z: 1080, r: 80 }, // the Vinefall
  { x: -340, z: 1170, r: 70 }, // the north cape
  { x: -480, z: 1020, r: 55 }, // the west arm
  { x: -400, z: 1000, r: 55 }, // the Tangle's western shoulder
  { x: -330, z: 1060, r: 50 }, // ...and its northeastern one
  { x: -340, z: 800, r: 55 }, // the shore road's back-beach
  { x: -384, z: 770, r: 45 }, // ...its western reach out of the pass
  { x: -366, z: 865, r: 45 }, // the Palmstrand road's shoulder
  { x: -210, z: 820, r: 42 }, // the offshore islet
  { x: -242, z: 826, r: 38 }, // ...and its sandbar back to the strand
  { x: -282, z: 1145, r: 45 }, // the gate road's saddle over the cape's neck
  { x: -294, z: 1185, r: 38 }, // ...and its rise to the gate footing
  { x: -310, z: 1220, r: 45 }, // the Garden Gate road's northern footing
  { x: -310, z: 1256, r: 42 }, // ...carried right up to the border
  { x: -252, z: 1015, r: 44 }, // ...back to the idol road
  { x: -198, z: 726, r: 48 }, // the Tanglewater's south cap, jungle side
  { x: -248, z: 740, r: 46 }, // ...joined to the shore road's back-beach
  { x: -290, z: 752, r: 46 }, // ...and carried onto the back-beach itself
  { x: -198, z: 1220, r: 48 }, // the Tanglewater's north cap, jungle side
  { x: -252, z: 1214, r: 44 }, // ...joined to the gate road's saddle
] as const;
const REACH_BAYS = [
  { x: -530, z: 950, r: 50 }, // the west reach
  { x: -182, z: 940, r: 45 }, // the east sound
  { x: -390, z: 1252, r: 50 }, // the north bight, open to the warm sea
] as const;

export function reachLandness(x: number, z: number): number {
  return metaballLandness(REACH_LAND_LOBES, REACH_BAYS, x, z);
}

// The Palmreach strand: the three shipped beach-palm models scattered on a
// deterministic grid over the beach shelf. The renderer draws them
// (render/jungle_features.ts) and the sim gives each a trunk collider
// (sim/colliders.ts) from THIS one list, so what you bump into is exactly the
// trunk you see. Pure function of the world seed, memoized (both hosts call it
// with the same seed and must agree byte-for-byte).
export interface ReachPalm {
  x: number;
  z: number;
  y: number; // trunk base, sunk slightly into the sand
  rot: number; // yaw
  variant: number; // 0..2 -> beach_palm_{1,2,3}
  scale: number; // uniform world scale applied to the model
  r: number; // trunk collider radius, world units
}

// Native trunk heights of beach_palm_{1,2,3}.glb (pivot on the ground) and the
// native trunk radius near the base, measured from the shipped GLBs. The
// per-variant height normalizes all three to PALM_TARGET_H before the
// per-spot size jitter, so the strand reads as one canopy height like the
// neighbouring pines rather than three different species sizes.
const PALM_NATIVE_H = [2.685, 2.689, 3.587];
const PALM_TRUNK_R = 0.17; // native trunk radius (all three ~equal)
const PALM_TARGET_H = 9; // rendered trunk height at size factor 1.0

let reachPalmCache: { seed: number; spots: ReachPalm[] } | null = null;

export function reachPalmSpots(seed: number): ReachPalm[] {
  if (reachPalmCache && reachPalmCache.seed === seed) return reachPalmCache.spots;
  const spots: ReachPalm[] = [];
  for (let gx = -536; gx <= -184; gx += 8) {
    for (let gz = REACH_ZMIN + 10; gz <= REACH_ZMAX - 10; gz += 8) {
      if (hash2(gx, gz, seed + 5101) > 0.62) continue; // thin the grid (~38% kept)
      const x = gx + (hash2(gx, gz, seed + 5111) - 0.5) * 7;
      const z = gz + (hash2(gz, gx, seed + 5121) - 0.5) * 7;
      const land = reachLandness(x, z);
      if (land < 0.045 || land > 0.24) continue; // the beach band only
      const y = terrainHeight(x, z, seed);
      if (y < WATER_LEVEL + 0.5 || y > 3.6) continue; // out of the surf, off the bluff
      const variant = Math.floor(hash2(x, z, seed + 5151) * 3);
      const scale =
        (PALM_TARGET_H / PALM_NATIVE_H[variant]) * (0.85 + hash2(x, z, seed + 5131) * 0.5);
      spots.push({
        x,
        z,
        y: y - 0.15,
        rot: hash2(z, x, seed + 5141) * Math.PI * 2,
        variant,
        scale,
        r: PALM_TRUNK_R * scale,
      });
    }
  }
  reachPalmCache = { seed, spots };
  return spots;
}

// The tropical coast: the fen recipe, then every low shore flattened into a
// broad sand shelf (the beach cap) so the strand runs wide and walkable.
function applyReachCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(REACH_ZMIN - 8, REACH_ZMIN + 8, z) *
    (1 - smoothstep(REACH_ZMAX - 8, REACH_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the west column: cross-fade toward the strip at the border
  if (x < -566) return h; // nothing west of the world
  const seam = 1 - smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x);
  if (seam <= 0) return h;
  const land = reachLandness(x, z);
  const t = Math.max(greenSeamT(x, z), smoothstep(0.02, 0.32, land));
  const shelf = smoothstep(-0.5, 0.06, land);
  const floor = WATER_LEVEL - 3.2 + (WATER_LEVEL - 0.8 - (WATER_LEVEL - 3.2)) * shelf;
  let out = floor + (h - floor) * t;
  // the beach cap: the coastal band is pressed flat and low, a long sandy
  // apron instead of the other realms' bluff shores
  const beachT = 1 - smoothstep(0.05, 0.3, land);
  if (beachT > 0 && out > 1.4) out = out + (1.4 + (out - 1.4) * 0.2 - out) * beachT;
  // the Sunway: a flat floor off the heights, down into the sun
  const passT = (1 - smoothstep(26, 52, Math.abs(z - 820))) * smoothstep(-260, -215, x);
  if (passT > 0) out = out + (6 + (out - 6) * 0.15 - out) * passT;
  // the Tanglemouth: flat pass floor across the border with the fen
  const passS = (1 - smoothstep(26, 52, Math.abs(x + 400))) * (1 - smoothstep(750, 800, z));
  if (passS > 0) out = out + (6 + (out - 6) * 0.15 - out) * passS;
  // ...and the Nightgate's south ramp, meeting the dream's pass cap
  const passN = (1 - smoothstep(26, 52, Math.abs(x + 330))) * smoothstep(1200, 1245, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// ---------------------------------------------------------------------------
// The Evergarden: the formal garden at the world's current northern end. The
// lawns are one broad organic landmass; its signature is the Great Maze, a
// true hedge labyrinth grown from the heightfield itself (walls are terrain,
// so sim collision, the renderer, and the map all read the same hedges).
// ---------------------------------------------------------------------------
const GARDEN_ZMIN = 700; // keep in sync with EVERGARDEN_ZONE.zMin (east column)
const GARDEN_ZMAX = 1260; // ...and zMax
const GARDEN_LAND_LOBES = [
  { x: 410, z: 710, r: 42 }, // the Garden Gate's border footing
  { x: 410, z: 740, r: 55 }, // the Garden Gate's approach lawn
  { x: 378, z: 765, r: 45 }, // the gate road's lawn, bridging to the hub
  { x: 320, z: 810, r: 70 }, // Hedgewick and the gate lawns
  { x: 360, z: 880, r: 80 }, // the Statuary Walk
  { x: 440, z: 850, r: 55 }, // the Petal Pond's basin
  { x: 290, z: 870, r: 40 }, // the rose road's shoulder
  { x: 270, z: 910, r: 60 }, // the Rose Wilds
  { x: 360, z: 1016, r: 95 }, // the Great Maze's terrace...
  { x: 305, z: 960, r: 60 }, // ...and its four corners, kept well ashore
  { x: 415, z: 960, r: 60 },
  { x: 305, z: 1075, r: 60 },
  { x: 415, z: 1075, r: 60 },
  { x: 340, z: 1170, r: 65 }, // the north lawn and the Lily Basin
  { x: 420, z: 1140, r: 55 }, // the east walk's long lawn
  { x: 448, z: 895, r: 40 }, // the east walk's south shoulder
  { x: 460, z: 960, r: 55 }, // the east walk's shoulder
  { x: 452, z: 924, r: 44 }, // ...and its south rise off the pond
  { x: 262, z: 1000, r: 44 }, // the gnomes' west lawn kept dry
  { x: 458, z: 1010, r: 40 }, // the east walk's midpoint lawn
  { x: 460, z: 1060, r: 50 }, // the eastern border beds
  { x: 250, z: 1030, r: 55 }, // the western wilds
  { x: 390, z: 1230, r: 50 }, // the far hedgerow under the north rim
  { x: 264, z: 848, r: 38 }, // the west lawn's elder stands dry
  { x: 314, z: 1124, r: 36 }, // the north lawn's elder too
  { x: 430, z: 854, r: 46 }, // the pond road's east shoulder
  { x: 198, z: 726, r: 50 }, // the Moonmere's west cap, garden side
  { x: 240, z: 782, r: 46 }, // ...joined to Hedgewick's lawns
  { x: 522, z: 726, r: 50 }, // the Moonmere's east cap, garden side
  { x: 488, z: 786, r: 46 }, // ...joined to the Petal Pond's basin
] as const;
const GARDEN_BAYS = [
  { x: 190, z: 940, r: 50 }, // the west water
  { x: 535, z: 860, r: 45 }, // the east water
  { x: 522, z: 1105, r: 40 }, // the east bight, mid-coast
] as const;

export function gardenLandness(x: number, z: number): number {
  return metaballLandness(GARDEN_LAND_LOBES, GARDEN_BAYS, x, z);
}

// The garden coast: the fen recipe over lawn instead of reeds.
function applyGardenCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(GARDEN_ZMIN - 8, GARDEN_ZMIN + 8, z) *
    (1 - smoothstep(GARDEN_ZMAX - 8, GARDEN_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the east column: cross-fade toward the strip at the border
  if (x > 566) return h; // nothing east of the world (instance space far beyond)
  const seam = smoothstep(STRIP_MAX_X - 8, STRIP_MAX_X + 8, x);
  if (seam <= 0) return h;
  const land = gardenLandness(x, z);
  const t = Math.max(greenSeamT(x, z), smoothstep(0.02, 0.3, land));
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = WATER_LEVEL - 3.2 + (WATER_LEVEL - 0.9 - (WATER_LEVEL - 3.2)) * shelf;
  let out = floor + (h - floor) * t;
  // the Garden Gate: flat pass floor across the border with the headlands
  const passT = (1 - smoothstep(26, 52, Math.abs(x - 400))) * (1 - smoothstep(750, 800, z));
  if (passT > 0) out = out + (6 + (out - 6) * 0.15 - out) * passT;
  // the Gardenwalk: a flat floor easing onto the heights across the border
  const passW = (1 - smoothstep(26, 52, Math.abs(z - 800))) * (1 - smoothstep(230, 280, x));
  if (passW > 0) out = out + (6 + (out - 6) * 0.15 - out) * passW;
  // ...and the Crowgate's south ramp, up into the haunted wood
  const passN = (1 - smoothstep(26, 52, Math.abs(x - 390))) * smoothstep(1200, 1245, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// The Great Maze. '#' cells are hedge walls raised straight out of the
// heightfield; '.' cells are gravel corridors. Row 0 is the NORTH row (the
// map's top), the entrance is the gap in the south row, and the open 3x3
// court at the center is the Fountain Court. Solvability (entrance to
// court) is asserted by tests/evergarden.test.ts, so an edit here that
// bricks the maze fails CI instead of stranding players.
const GARDEN_MAZE = [
  '###############',
  '#.....#.......#',
  '#.###.#####.###',
  '#.#.#.....#...#',
  '#.#.#####.#.#.#',
  '#.#.#.....#.#.#',
  '#.#.#.#####.#.#',
  '#.#.......#.#.#',
  '#.#.##....###.#',
  '#.#.#.........#',
  '#.###.#######.#',
  '#.#...#.....#.#',
  '#.#.#####.#.#.#',
  '#.#.....#.#.#.#',
  '#.#####.#.###.#',
  '#.......#.....#',
  '#######.#######',
] as const;
export const GARDEN_MAZE_GRID: readonly string[] = GARDEN_MAZE;
export const MAZE_CELL = 9; // yd per maze cell
export const MAZE_COLS = 15;
export const MAZE_ROWS = 17;
export const MAZE_X0 = 360 - (MAZE_COLS * MAZE_CELL) / 2; // west edge, x 292.5
export const MAZE_Z1 = 1093; // north edge (row 0); south edge z 940
export const MAZE_Z0 = MAZE_Z1 - MAZE_ROWS * MAZE_CELL;
const MAZE_WALL_H = 12;
const MAZE_SKIRT = 2.2; // yd of wall flank beyond the inset face
const MAZE_FACE_INSET = 1.2; // corridor-facing faces pull into the wall cell

/** Inside the maze footprint (small margin), where dressing must not spawn. */
export function inGardenMaze(x: number, z: number): boolean {
  return (
    x > MAZE_X0 - 3 && x < MAZE_X0 + MAZE_COLS * MAZE_CELL + 3 && z > MAZE_Z0 - 3 && z < MAZE_Z1 + 3
  );
}

// Is a grid position open ground? Out-of-bounds counts as open (the lawn
// beyond the maze), so the outer wall's outward face behaves like any other.
function mazeOpenAt(c: number, r: number): boolean {
  if (r < 0 || r >= MAZE_ROWS || c < 0 || c >= MAZE_COLS) return true;
  return GARDEN_MAZE[r].charCodeAt(c) === 46; // '.'
}

// How much hedge stands at a point, 0..1 of full height. Each wall cell is
// a square block whose corridor-facing faces are inset into the cell (so
// lanes stay wide) while wall-facing edges are NOT inset (so runs tile with
// no seam), and the union is a MAX over blocks: a shared edge inside a run
// is interior to both blocks and stays at full height. Chebyshev distance
// gives square height contours, so a run's END keeps its corners tall
// right to the block edge instead of tapering into the see-through notch a
// round distance field cuts at every junction corner.
function gardenMazeHedgeFactor(x: number, z: number): number {
  const w = MAZE_COLS * MAZE_CELL;
  if (x < MAZE_X0 - 1 || x > MAZE_X0 + w + 1) return 0;
  if (z < MAZE_Z0 - 1 || z > MAZE_Z1 + 1) return 0;
  const ci = Math.floor((x - MAZE_X0) / MAZE_CELL);
  const ri = Math.floor((MAZE_Z1 - z) / MAZE_CELL);
  let best = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = ri + dr;
      const c = ci + dc;
      if (r < 0 || r >= MAZE_ROWS || c < 0 || c >= MAZE_COLS) continue;
      if (GARDEN_MAZE[r].charCodeAt(c) !== 35) continue; // '#' wall cells
      const x0 = MAZE_X0 + c * MAZE_CELL + (mazeOpenAt(c - 1, r) ? MAZE_FACE_INSET : 0);
      const x1 = MAZE_X0 + (c + 1) * MAZE_CELL - (mazeOpenAt(c + 1, r) ? MAZE_FACE_INSET : 0);
      const zTop = MAZE_Z1 - r * MAZE_CELL - (mazeOpenAt(c, r - 1) ? MAZE_FACE_INSET : 0);
      const zBot = MAZE_Z1 - (r + 1) * MAZE_CELL + (mazeOpenAt(c, r + 1) ? MAZE_FACE_INSET : 0);
      const ddx = Math.max(x0 - x, x - x1, 0);
      const ddz = Math.max(zBot - z, z - zTop, 0);
      const d = Math.max(ddx, ddz); // Chebyshev: square contours
      const f = 1 - smoothstep(0, MAZE_SKIRT, d);
      if (f > best) best = f;
    }
  }
  return best;
}

// A hedge tall enough to block: movement treats it as a hard wall (see
// colliders.resolveMovement); the slope gate alone is not enough, a shallow
// diagonal walk sneaks over any gradient. Knee height, just inside the face.
const MAZE_WALL_SOLID = 0.12; // of full hedge height
export function inGardenMazeWall(x: number, z: number): boolean {
  return gardenMazeHedgeFactor(x, z) > MAZE_WALL_SOLID;
}

// Does the segment pass through hedge? The endpoint test alone is not
// enough: a mover stalled at a wall face keeps its interpolated target
// advancing, and the moment the target lands on open ground beyond the
// wall an endpoint-only check would teleport it across. Sampled finer than
// the wall's solid core so no step can straddle it.
export function crossesGardenHedge(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): boolean {
  // fast reject: segment nowhere near the maze
  const w = MAZE_COLS * MAZE_CELL;
  if (Math.max(fromZ, toZ) < MAZE_Z0 || Math.min(fromZ, toZ) > MAZE_Z1) return false;
  if (Math.max(fromX, toX) < MAZE_X0 || Math.min(fromX, toX) > MAZE_X0 + w) return false;
  const len = Math.hypot(toX - fromX, toZ - fromZ);
  const steps = Math.max(1, Math.ceil(len / 0.3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (inGardenMazeWall(fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t)) return true;
  }
  return false;
}

// The hedge heightfield: sheer faces (well past the climb gate) whose skirt
// mostly eats into the wall cells, not the corridors.
function gardenMazeOffset(x: number, z: number): number {
  return MAZE_WALL_H * gardenMazeHedgeFactor(x, z);
}

// ---------------------------------------------------------------------------
// The Galecrest: the world's first east-column realm, a wind-scoured
// headland landmass in its own grid cell beside the Willowfen. Its west
// border is the vertical ridge the border-edge machinery raises along the
// shared column edge, opened at the Windway (westPassZ 3380).
// ---------------------------------------------------------------------------
const GALE_XMIN = 180; // keep in sync with GALECREST_ZONE.xMin
const GALE_ZMIN = 180;
const GALE_ZMAX = 700;
const GALE_LAND_LOBES = [
  { x: 210, z: 440, r: 48 }, // the Windway's shelf at the border
  { x: 268, z: 405, r: 55 }, // the road's rise onto the downs
  { x: 290, z: 340, r: 70 }, // the Howling Downs
  { x: 340, z: 380, r: 65 }, // the mid downs
  { x: 425, z: 360, r: 70 }, // Wickharbor's headland
  { x: 492, z: 315, r: 45 }, // the Old Beacon's head
  { x: 448, z: 522, r: 55 }, // the Shear's cliff tops
  { x: 300, z: 555, r: 58 }, // the Mirror Tarn plateau
  { x: 355, z: 620, r: 60 }, // the Wreckfields' back downs
  { x: 380, z: 480, r: 60 }, // the connective heart of the headland
  { x: 240, z: 510, r: 50 }, // the west downs above the border range
  { x: 435, z: 450, r: 45 }, // the cliff road's first shoulder
  { x: 428, z: 565, r: 48 }, // ...and its long run above the Shear
  { x: 345, z: 515, r: 42 }, // the tarn road's saddle
  { x: 366, z: 566, r: 40 }, // the wisp hollows
  { x: 300, z: 510, r: 42 }, // the upper downs west of the saddle
  { x: 390, z: 658, r: 44 }, // the Crowgate climb's south footing
  { x: 388, z: 692, r: 38 }, // the Crowgate climb's border footing
  { x: 200, z: 212, r: 50 }, // the corner knot, gale quarter
  { x: 250, z: 264, r: 48 }, // the knot's shore rising onto the Howling Downs
  { x: 200, z: 674, r: 48 }, // the Four Corners, gale quarter
  { x: 474, z: 638, r: 44 }, // the east downs above the wrecks: the Crowmere's south neck
  { x: 428, z: 624, r: 44 }, // ...joined to the Wreckfields' back downs
] as const;
const GALE_BAYS = [
  { x: 470, z: 390, r: 24 }, // the harbor cove in Wickharbor's lee
  { x: 530, z: 600, r: 50 }, // the south sound
  { x: 272, z: 676, r: 34 }, // the north bight, now a cove of the Crowmere
  { x: 535, z: 210, r: 45 }, // the northeast water past the beacon
] as const;

export function galeLandness(x: number, z: number): number {
  return metaballLandness(GALE_LAND_LOBES, GALE_BAYS, x, z);
}

// The headland coast: the fen recipe cut steeper (sea cliffs, not bog), a
// flat pass floor at the Windway meeting the fen's east ramp.
function applyGaleCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(GALE_ZMIN - 8, GALE_ZMIN + 8, z) * (1 - smoothstep(GALE_ZMAX - 8, GALE_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the seam twin of applyFenCoast's gate: cross-fade, never a hard cut
  if (x > 566) return h; // nothing east of the world (instance space far beyond)
  const seam = smoothstep(STRIP_MAX_X - 8, STRIP_MAX_X + 8, x);
  if (seam <= 0) return h;
  const land = galeLandness(x, z);
  const t = Math.max(greenSeamT(x, z), smoothstep(0.02, 0.28, land));
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = WATER_LEVEL - 3.6 + (WATER_LEVEL - 1.2 - (WATER_LEVEL - 3.6)) * shelf;
  let out = floor + (h - floor) * t;
  // the Windway: flat pass floor across the column border
  const passT = (1 - smoothstep(26, 52, Math.abs(z - 440))) * (1 - smoothstep(230, 280, x));
  if (passT > 0) out = out + (6 + (out - 6) * 0.15 - out) * passT;
  // ...and the Garden Gate's south ramp, up onto the lawns
  const passN = (1 - smoothstep(26, 52, Math.abs(x - 400))) * smoothstep(640, 685, z);
  if (passN > 0) out = out + (6 + (out - 6) * 0.15 - out) * passN;
  return h + (out - h) * seam * zSeam;
}

// ---------------------------------------------------------------------------
// Eastbrook Vale's organic coast. The starter map meets open sea on its
// east, south, and west edges (its north edge is the land border with the
// Mirefen). A metaball landness field gives it a lobed, bayed shoreline
// instead of a square rim; the interior sits at high landness, so the coast
// applier returns it untouched and every seed-pinned fixture keeps its exact
// ground. Only the far edges (low landness) become shore and water.
// ---------------------------------------------------------------------------
const VALE_LAND_LOBES = [
  { x: 0, z: 30, r: 128 }, // the heartland: the town, the roads, the fields
  { x: 0, z: 155, r: 100 }, // the north reach to the Mirefen border
  { x: -95, z: 170, r: 52 }, // ...its northwest fill (the border stays land)
  { x: 95, z: 170, r: 52 }, // ...and northeast fill
  { x: -168, z: 172, r: 42 }, // the northwest border corner
  { x: 168, z: 172, r: 42 }, // the northeast border corner
  { x: -100, z: 85, r: 70 }, // the western downs and Mirror Lake's shore
  { x: -95, z: -55, r: 70 }, // the southwest pastures (Grix's tunnel)
  { x: 45, z: -85, r: 84 }, // the south fields (the bandit camp)
  { x: 108, z: -52, r: 60 }, // the southeast rise (mogger's hollow)
  { x: 100, z: 70, r: 62 }, // the east meadows
  { x: 60, z: 138, r: 55 }, // Brightwood Glade's north wood
  { x: 150, z: -46, r: 44 }, // the east point: the causeway's mainland root
] as const;
const VALE_BAYS = [
  { x: -192, z: 25, r: 60 }, // the west bay
  { x: 30, z: -196, r: 66 }, // the south bay
  { x: 196, z: 104, r: 56 }, // the east bay, north of the causeway
  { x: -142, z: -152, r: 48 }, // the southwest cove
  { x: 178, z: -128, r: 42 }, // the south cove, east of the point
] as const;

export function valeLandness(x: number, z: number): number {
  return metaballLandness(VALE_LAND_LOBES, VALE_BAYS, x, z);
}

// The vale coast: gentle green shores meeting the sea. Runs on the vale's own
// band only (its north edge stays the Mirefen land border, untouched).
function applyValeCoast(x: number, z: number, h: number): number {
  if (z > 178 || z < -215 || x > 178) return h;
  const land = valeLandness(x, z);
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = WATER_LEVEL - 3.4 + (WATER_LEVEL - 1 - (WATER_LEVEL - 3.4)) * shelf;
  return h + (floor + (h - floor) * t - h);
}

// The Ferrywalk: a natural sandbar causeway from the vale's east point across
// the strait to the Farshore's Landing, so the island is reached on foot (no
// teleport). A curving spit of low ground raised out of the shallows; the
// deeper water to either side keeps its swim fatigue.
const CAUSEWAY = [
  { x: 150, z: -46 },
  { x: 173, z: -30 },
  { x: 195, z: -14 },
  { x: 217, z: 1 },
  { x: 238, z: 12 },
  { x: 256, z: 16 },
] as const;
function causewayDistance(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < CAUSEWAY.length; i++) {
    const a = CAUSEWAY[i];
    const b = CAUSEWAY[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}
export function onCauseway(x: number, z: number): boolean {
  return z < 60 && z > -80 && x > 140 && x < 262 && causewayDistance(x, z) < 22;
}
function applyCauseway(x: number, z: number, h: number): number {
  if (!onCauseway(x, z)) return h;
  const d = causewayDistance(x, z);
  const w = 1 - smoothstep(9, 22, d);
  if (w <= 0) return h;
  // a low sandbar (walkable ~2.2), roughened so it reads as drifted sand
  const bar = 2.2 + (noise2(x * 0.09, z * 0.09, 613) - 0.5) * 1.2;
  const lifted = Math.max(h, bar);
  return h + (lifted - h) * w;
}

// Clean open water framing the Farshore: the island touches the mainland
// only at the causeway, so its shared edges read as sea, with no border
// ridge or neighbour coast bleeding into the island's map. A channel to the
// north (the Galecrest, no crossing there) and open sea below its south
// headland; the causeway's z-window sits between the two, untouched.
function applyStarterMoat(x: number, z: number, h: number): number {
  // the vale/island border strait (x~177..190): clear any crest sitting on
  // the border line over the open water on either side of the Ferrywalk, so
  // the only dry link is the causeway. Skipped on the causeway itself and
  // north of z150 (the vale's own north-corner land).
  if (x >= 177 && x <= 194 && z < 150 && z > -184 && !onCauseway(x, z)) {
    const wb = smoothstep(177, 182, x) * (1 - smoothstep(188, 196, x));
    if (wb > 0) {
      const sea2 = Math.min(h, WATER_LEVEL - 5);
      h = h + (sea2 - h) * wb;
    }
  }
  if (x < 184 || x > 548) return h;
  // the north channel: the border band with the Galecrest (z 164..186),
  // fading back to the Galecrest's own coast north of z 200
  const north = smoothstep(150, 164, z) * (1 - smoothstep(186, 200, z));
  // the south: open sea below the island's headland, out to the map edge
  const south = smoothstep(-150, -166, z);
  const w = Math.max(north, south);
  if (w <= 0) return h;
  const sea = Math.min(h, WATER_LEVEL - 5);
  return h + (sea - h) * w;
}

// ---------------------------------------------------------------------------
// The Farshore: a small island in the starter sea east of Eastbrook Vale
// (map-left of it, under the compass mirror). No land border and no pass:
// the only way over is the ferry portal, and swim fatigue guards the
// strait. Beaches all around, rising to the Crown Meadow inland.
// ---------------------------------------------------------------------------
const ISLE_LAND_LOBES = [
  { x: 375, z: -5, r: 95 }, // the island's heart, rising to the Crown Meadow
  { x: 305, z: 70, r: 55 }, // Gullhaven's shelf on the northwest strand
  { x: 256, z: 15, r: 42 }, // the Landing's shelf
  { x: 430, z: 55, r: 65 }, // the east downs
  { x: 400, z: -70, r: 70 }, // the south headland
  { x: 320, z: -55, r: 55 }, // the coves' shoulder
  { x: 356, z: 88, r: 60 }, // the north point
  { x: 275, z: 44, r: 42 }, // the ferry road's rise
] as const;
const ISLE_BAYS = [
  { x: 292, z: -108, r: 40 }, // the south cove
  { x: 472, z: -30, r: 40 }, // the east bight
] as const;

export function isleLandness(x: number, z: number): number {
  return metaballLandness(ISLE_LAND_LOBES, ISLE_BAYS, x, z);
}

// The island coast: beaches all around, and the interior climbs with the
// landness field itself, so the highest ground is the farthest inland.
function applyIsleCoast(x: number, z: number, h: number): number {
  if (x < 166 || x > 566) return h;
  const zSeam = smoothstep(-188, -172, z) * (1 - smoothstep(172, 188, z));
  if (zSeam <= 0) return h;
  const seam = smoothstep(172, 188, x);
  if (seam <= 0) return h;
  const land = isleLandness(x, z);
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = WATER_LEVEL - 3.2 + (WATER_LEVEL - 0.8 - (WATER_LEVEL - 3.2)) * shelf;
  let out = floor + (h - floor) * t;
  // the beach apron: low shores pressed flat, the Palmreach recipe
  const beachT = 1 - smoothstep(0.05, 0.28, land);
  if (beachT > 0 && out > 1.4) out = out + (1.4 + (out - 1.4) * 0.2 - out) * beachT;
  // higher land more inland: a broad dome under the Crown Meadow, so the
  // shore is always the low ground and the center the high
  const dCrown = Math.hypot(x - 375, z + 5);
  out += 14 * (1 - smoothstep(18, 128, dCrown)) * smoothstep(0.02, 0.2, land);
  return h + (out - h) * seam * zSeam;
}

// The border meres between columns: the seam blend of two adjacent coasts
// leaves each border line hovering at the waterline (a mushy mudflat neither
// walkable nor swimmable); these carve every column border into honest
// water, leaving each crossing's corridor untouched. Since the corner caps
// landed, each carve is also windowed to its lake basin (lakeLo..lakeHi) and
// fades out into the cap land at both ends, so the water is a landlocked
// mere, not a sea strait.
const COLUMN_STRAITS = [
  // east: the Hollow's moat running north into the Reach's flank, crossed
  // only by the Snowline's isthmus at the fire and ice border
  { borderX: STRIP_MAX_X, passZ: 1890, zLo: 900, zHi: 1960, lakeLo: 940, lakeHi: 1925 },
  // west: the same moat mirrored, crossed by the Goldmelt's isthmus
  { borderX: STRIP_MIN_X, passZ: 1890, zLo: 900, zHi: 1960, lakeLo: 940, lakeHi: 1925 },
] as const;
function applyColumnStraits(x: number, z: number, h: number): number {
  let out = h;
  for (const st of COLUMN_STRAITS) {
    if (z <= st.zLo || z > st.zHi) continue;
    const strait =
      (1 - smoothstep(2, 12, Math.abs(x - st.borderX))) *
      smoothstep(26, 52, Math.abs(z - st.passZ)) *
      smoothstep(st.lakeLo - 20, st.lakeLo + 20, z) *
      (1 - smoothstep(st.lakeHi - 20, st.lakeHi + 20, z));
    // The moat's fixed central channel keeps the Hollow enclosed. On top of it,
    // scallop the INNER (Hollow-side) bank so the shore is not a ruled vertical
    // moat wall: coves bite inland from the moat where the Hollow's own coast
    // recedes (low landness), headlands stand proud where it swells. This only
    // ever LOWERS the near-shore strip toward water, never raises the channel,
    // so the moat stays continuous at every z (no bridge possible).
    const zGate =
      smoothstep(26, 52, Math.abs(z - st.passZ)) *
      smoothstep(st.lakeLo - 20, st.lakeLo + 20, z) *
      (1 - smoothstep(st.lakeHi - 20, st.lakeHi + 20, z));
    let scallop = 0;
    if (zGate > 0) {
      // distance inland from the border (positive going into the Hollow)
      const inland = st.borderX > 0 ? st.borderX - x : x - st.borderX;
      if (inland > 8 && inland < 46) {
        const land = hollowLandness(x, z);
        // low landness -> deep cove; taper the band's inner lip so coves ease
        // into the shore instead of ending in a step
        const cove = 1 - smoothstep(-0.16, 0.1, land);
        const lip = smoothstep(8, 16, inland) * (1 - smoothstep(34, 46, inland));
        // only deepen ground that is ALREADY near the waterline, so the coves
        // extend genuine shore into the moat and never bite a marginal sliver
        // out of an elevated ridge foot (e.g. the z1440 border foot).
        const lowGate = 1 - smoothstep(1, 8, out);
        scallop = cove * lip * zGate * lowGate;
      }
    }
    const carve = Math.max(strait, scallop);
    if (carve <= 0) continue;
    const channel = Math.min(out, WATER_LEVEL - 2.5);
    out = out + (channel - out) * carve;
  }
  return out;
}

// The row meres: the six column-row borders carved into honest lakes
// between their green or capped ends, each crossed only by its pass road's
// isthmus (the h-border twin of COLUMN_STRAITS).
// xLo/xHi span the mere's water. The z700 row sits in the peaks green-seam
// row, so its INNER cap (the x=+-180 seam) stays dry land; the z1260/z1820
// rows sit against the Hollow/Frost moats, so their inner caps are water
// too. All rows carve out to the world edge (x=+-540) so no cap sliver is
// left proud at the map corners.
const ROW_MERES = [
  { borderZ: 700, passX: 400, xLo: 240, xHi: 552 }, // the Lawnmere
  { borderZ: 1260, passX: 390, xLo: 168, xHi: 552 }, // the Gravemere
  { borderZ: 1820, passX: 404, xLo: 168, xHi: 552 }, // the Ashmere
  { borderZ: 700, passX: -400, xLo: -552, xHi: -240 }, // the Palmere
  { borderZ: 1260, passX: -330, xLo: -552, xHi: -168 }, // the Duskmere
  { borderZ: 1820, passX: -350, xLo: -552, xHi: -168 }, // the Goldmere
] as const;
function applyRowMeres(x: number, z: number, h: number): number {
  let out = h;
  for (const m of ROW_MERES) {
    if (x <= m.xLo - 20 || x > m.xHi + 20) continue;
    const mere =
      (1 - smoothstep(2, 12, Math.abs(z - m.borderZ))) *
      smoothstep(26, 52, Math.abs(x - m.passX)) *
      smoothstep(m.xLo - 20, m.xLo + 20, x) *
      (1 - smoothstep(m.xHi - 20, m.xHi + 20, x));
    if (mere <= 0) continue;
    const basin = Math.min(out, WATER_LEVEL - 2.5);
    out = out + (basin - out) * mere;
  }
  return out;
}

// The north bay: the open water between the columns' shoulders, north of
// the Reach's coast. No zone owns that gap, and untouched it would
// soft-floor into dry mudflats instead of sea.
function applyNorthBay(x: number, z: number, h: number): number {
  if (z <= FROST_ZMAX - 20 || Math.abs(x) > STRIP_MAX_X + 8) return h;
  // follow the Reach's own coastline north of the cap: the frost lobes that
  // poke past z1960 stay dry headlands, the gaps between them open as coves,
  // so the north shore is lobed, not a ruled z-parallel line
  const land = frostLandness(x, z);
  const shoreT = 1 - smoothstep(-0.04, 0.14, land);
  const t =
    smoothstep(FROST_ZMAX - 20, FROST_ZMAX + 44, z) *
    (1 - smoothstep(172, 188, Math.abs(x))) *
    shoreT;
  if (t <= 0) return h;
  const sea = Math.min(h, WATER_LEVEL - 6);
  return h + (sea - h) * t;
}

// The northern grid's outer edges are OPEN OCEAN. After all land shaping and
// the rims, a sea margin is carved around the true world perimeter (the
// columns' outer x-flanks and the north cap) so no realm's land hugs the map
// edge. The margin's inner shoreline wanders with fixed-seed noise, so land
// meets the sea as a natural coast, never a ruled edge with land on one side
// and water on the other. The playable world only (instance space past |x|560
// keeps its own containment); the starter/mid realms south of z1250 already
// end in open coast, so they are left to their own appliers.
function applyWorldEdgeSea(x: number, z: number, h: number): number {
  if (z <= 1250 || Math.abs(x) > 560) return h;
  const xb = worldXBoundsAt(z);
  const dEdge = Math.min(x - xb.min, xb.max - x, WORLD_MAX_Z - z);
  if (dEdge > 100) return h;
  // two octaves of fixed-seed noise bend the shoreline into deep coves and
  // headlands so the ocean margin reads as a natural coast, not a ruled band
  const wob =
    (fbm2(x * 0.015, z * 0.015, 9311, 3) - 0.5) * 54 +
    (fbm2(x * 0.044, z * 0.044, 9313, 2) - 0.5) * 18;
  const band = 50 + wob;
  const seaT = 1 - smoothstep(band - 34, band, dEdge);
  if (seaT <= 0) return h;
  const floor = Math.min(h, WATER_LEVEL - 6);
  return h + (floor - h) * seaT;
}

// The strip's flanks (the Hollow and the Reach beside the moat) are NATURAL
// COAST, not walls: pull their land back from the x=+-180 boundary with a wavy
// shoreline so the moat reads as a sound the land slopes into, never a ruled
// edge with land one side and water the other. Confined to the strip side and
// gated to low ground (a lowGate) so it only widens the near-shore into the
// moat, never cuts a marginal sliver out of interior land or the Tablecrag;
// the isthmus crossings at z1890 are left as land bridges.
function applyStripFlankCoast(x: number, z: number, h: number): number {
  if (z < 940 || z > 1925) return h;
  const ax = Math.abs(x);
  if (ax > 180 || ax < 132) return h;
  const dEdge = 180 - ax;
  const nearPass = 1 - smoothstep(20, 48, Math.abs(z - 1890));
  const wob =
    (fbm2(z * 0.02, Math.sign(x) * 70, 9321, 3) - 0.5) * 34 +
    (fbm2(z * 0.05, Math.sign(x) * 31, 9323, 2) - 0.5) * 12;
  const band = 28 + wob;
  const lowGate = 1 - smoothstep(6, 22, h);
  const seaT = (1 - smoothstep(band - 22, band, dEdge)) * (1 - nearPass) * lowGate;
  if (seaT <= 0) return h;
  const floor = Math.min(h, WATER_LEVEL - 5);
  return h + (floor - h) * seaT;
}

// The green seams: along the marsh and peaks rows the columns join the
// strip as dry rolling land (the sketch's land borders). The coast
// appliers stand down inside the seam band so no shoreline forms there,
// and the border ridge still rises over it (seaGate reads this too).
function greenSeamT(x: number, z: number): number {
  if (z < 170 || z > 910) return 0;
  const d = Math.abs(Math.abs(x) - STRIP_MAX_X);
  return (1 - smoothstep(50, 90, d)) * (1 - smoothstep(870, 910, z));
}

// Same coast recipe; holds the sealed wall's footing at the south fringe.
function applyAmberCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(AMBER_ZMIN - 8, AMBER_ZMIN + 8, z) *
    (1 - smoothstep(AMBER_ZMAX - 8, AMBER_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the west column: cross-fade toward the strip at the border
  if (x < -566) return h; // nothing west of the world
  const seam = 1 - smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x);
  if (seam <= 0) return h;
  const land = amberLandness(x, z);
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = HOLLOW_SEA_FLOOR + (WATER_LEVEL - 1.1 - HOLLOW_SEA_FLOOR) * shelf;
  let out = floor + (h - floor) * t;
  // the Goldmelt: a flat floor at the fire and ice border's autumn side
  const passT = (1 - smoothstep(26, 52, Math.abs(z - 1890))) * smoothstep(-260, -215, x);
  if (passT > 0) out = out + (7 + (out - 7) * 0.15 - out) * passT;
  // ...and the gold road's south cap, meeting the dream's ramp at the border
  const passS = (1 - smoothstep(26, 52, Math.abs(x + 350))) * (1 - smoothstep(1870, 1920, z));
  if (passS > 0) out = out + (6 + (out - 6) * 0.15 - out) * passS;
  return h + (out - h) * seam * zSeam;
}

// Sink everything beyond the coast to the seabed. The outer 10yd of the band
// keeps the containment rim (it rises from the water as border cliffs), and
// the sealed border band is fully inside land lobes so the wall never wets.
function applyHollowCoast(x: number, z: number, h: number): number {
  // the sea starts north of the sealed range: the realm's south is mountain,
  // its other shores are coast (and the wall never wets). The south limit
  // wanders to z940 (well clear of the sealed crest at z900-915 and its
  // feather) so the south shoreline is organic, not a horizontal chop; the
  // z925-935 land lobes keep the whole wall band dry.
  if (z < 940) return h;
  const southEase = smoothstep(940, 968, z);
  const zSeam = 1 - smoothstep(HOLLOW_ZMAX - 8, HOLLOW_ZMAX + 8, z);
  if (zSeam <= 0) return h;
  // the moat columns flank the Hollow now: its coast owns only the strip,
  // cross-fading toward the lawns and the wood at the border meres
  const seam =
    smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x) *
    (1 - smoothstep(STRIP_MAX_X + 8, STRIP_MAX_X + 30, x));
  if (seam <= 0) return h;
  const land = hollowLandness(x, z);
  // a wide, gentle transition: a shallow near-shore shelf slopes into the
  // deep, so beaches ease into the water instead of dropping off a cliff
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = HOLLOW_SEA_FLOOR + (WATER_LEVEL - 1.1 - HOLLOW_SEA_FLOOR) * shelf;
  let out = floor + (h - floor) * t;
  // The northern lowlands: everything past the mainland's north coast rides
  // low (dune country), so no bluff line interrupts the view over the open
  // sea. The rims add AFTER this, so the causeway tip's gate cap at the band
  // edge still rises as the one distant landmark.
  if (z > 1245) {
    const cap = 6.5;
    const ease = smoothstep(1245, 1268, z); // mainland shore eases into it
    if (out > cap) out = out + (cap + (out - cap) * 0.12 - out) * ease;
  }
  // Wave-cut ledges: coastal rock above the beach line breaks into stepped
  // terraces with noise-jittered edges, so bluffs meet the sea as rigid
  // cliff faces instead of smooth mounds. Confined to the shore band (the
  // interior fades out by landness) south of the northern lowlands; beaches
  // and the water itself sit below the height gate and stay gentle.
  if (z < 1245) {
    const coastW = smoothstep(0.02, 0.1, land) * (1 - smoothstep(0.3, 0.48, land));
    if (coastW > 0) {
      const lift = smoothstep(WATER_LEVEL + 1.5, WATER_LEVEL + 6, out);
      const fade = 1 - smoothstep(WATER_LEVEL + 20, WATER_LEVEL + 28, out);
      const w = 0.62 * coastW * lift * fade;
      if (w > 0) {
        const step = 4.2;
        const jit = (noise2(x * 0.13, z * 0.13, 77) - 0.5) * 2.2;
        const hh = out + jit;
        const base = Math.floor(hh / step) * step;
        const frac = (hh - base) / step;
        const ledge = base + step * Math.min(1, Math.max(0, (frac - 0.3) / 0.4));
        out = out + (ledge - out) * w;
      }
    }
  }
  return h + (out - h) * seam * zSeam * southEase;
}

// The Drakelands' coast, same recipe as the Hollow's. It fades OUT toward
// the volcanic rim belt (z past ~2010) so the Drakemaw range keeps its
// footing all the way across the band: over the flanks the sealed range
// simply runs down into the sea instead of being sunk by the coast.
function applyEmberCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(DRAKE_ZMIN - 8, DRAKE_ZMIN + 8, z) *
    (1 - smoothstep(DRAKE_ZMAX - 8, DRAKE_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the east column: cross-fade toward the strip at the border
  if (x > 566) return h; // nothing east of the world (instance space far beyond)
  const emberSeam = smoothstep(STRIP_MAX_X - 8, STRIP_MAX_X + 8, x);
  if (emberSeam <= 0) return h;
  const land = emberLandness(x, z);
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = HOLLOW_SEA_FLOOR + (WATER_LEVEL - 1.1 - HOLLOW_SEA_FLOOR) * shelf;
  let out = floor + (h - floor) * t;
  // the Wyrmgate road's south cap, meeting the wood's ramp at the border
  const passS = (1 - smoothstep(26, 52, Math.abs(x - 404))) * (1 - smoothstep(1870, 1920, z));
  if (passS > 0) out = out + (6 + (out - 6) * 0.15 - out) * passS;
  // ...and the Snowline's east floor, fire cooling into ice at the border
  const passW = (1 - smoothstep(26, 52, Math.abs(z - 1890))) * (1 - smoothstep(230, 280, x));
  if (passW > 0) out = out + (6 + (out - 6) * 0.15 - out) * passW;
  return h + (out - h) * emberSeam * zSeam;
}

// The Frostveil's coast. Fades IN north of the sealed wall's footing for the
// same reason (the wall crest sits at the band's south fringe).
function applyFrostCoast(x: number, z: number, h: number): number {
  const zSeam =
    smoothstep(HOLLOW_ZMAX - 8, HOLLOW_ZMAX + 8, z) *
    (1 - smoothstep(FROST_ZMAX - 8, FROST_ZMAX + 8, z));
  if (zSeam <= 0) return h;
  // the Reach holds the strip's north end: cross-fade toward both columns
  const seam =
    smoothstep(STRIP_MIN_X - 8, STRIP_MIN_X + 8, x) *
    (1 - smoothstep(STRIP_MAX_X - 8, STRIP_MAX_X + 8, x));
  if (seam <= 0) return h;
  const land = frostLandness(x, z);
  const t = smoothstep(0.02, 0.3, land);
  const shelf = smoothstep(-0.4, 0.06, land);
  const floor = HOLLOW_SEA_FLOOR + (WATER_LEVEL - 1.1 - HOLLOW_SEA_FLOOR) * shelf;
  let out = floor + (h - floor) * t;
  // Continue the Hollow's northern-lowlands cap across the border (same
  // formula, easing off northward), so the Wyrmgate shore meets the causeway
  // at matching height and the road rises gradually into the snow.
  const capEase = 1 - smoothstep(1442, 1495, z);
  if (capEase > 0 && out > 6.5) out = out + (6.5 + (out - 6.5) * 0.12 - out) * capEase;
  // the Snowline's west ramp: ice warming toward the waste at the border...
  const passE = (1 - smoothstep(26, 52, Math.abs(z - 1890))) * smoothstep(100, 145, x);
  if (passE > 0) out = out + (7 + (out - 7) * 0.15 - out) * passE;
  // ...and the Goldmelt's east ramp, toward the autumn on the west border
  const passW = (1 - smoothstep(26, 52, Math.abs(z - 1890))) * (1 - smoothstep(-145, -100, x));
  if (passW > 0) out = out + (7 + (out - 7) * 0.15 - out) * passW;
  return h + (out - h) * seam * zSeam;
}

// The Drakemaw's volcano cones: raised shields with crater dips. The caldera
// floors sit well above the sea so they stay dry; the render layer pours the
// lava (ember features module).
export const EMBER_VOLCANOES = [
  { x: 390, z: 2320, r: 62, h: 27, craterR: 16, craterD: 13 }, // Drakemaw Caldera
  { x: 270, z: 2282, r: 40, h: 20, craterR: 8, craterD: 8 },
  { x: 500, z: 2370, r: 36, h: 18, craterR: 7, craterD: 7 },
  { x: 318, z: 2392, r: 30, h: 14, craterR: 0, craterD: 0 },
] as const;
// the Snowline crossing's drake-side footing (appended to the ember lobes
// below via EMBER_GATE_LOBES; the fire road to the ice)

// Open lava pools out in the wastes (shaped as shallow flat-floored basins;
// the render lava surface sits just above each floor).
export const EMBER_LAVA_POOLS = [
  { x: 390, z: 2320, r: 14, floor: 12 }, // the vent inside the Drakemaw crater
  { x: 446, z: 2220, r: 11, floor: -0.5 },
  { x: 302, z: 2328, r: 11, floor: 0 },
  // crater pools high in the two smaller cones
  { x: 270, z: 2282, r: 7, floor: 11.5 },
  { x: 500, z: 2370, r: 6, floor: 9.5 },
  // the Moltenmaw: an open lava-lake field east of the caldera
  { x: 418, z: 2342, r: 16, floor: -1.2 },
  { x: 438, z: 2326, r: 10, floor: -1.2 },
] as const;

function emberShapingOffset(x: number, z: number, seed: number): number {
  if (z < DRAKE_ZMIN - 10 || z > DRAKE_ZMAX + 40) return 0;
  if (x < STRIP_MAX_X - 30) return 0; // the waste lives in the east column
  let dh = 0;
  for (const v of EMBER_VOLCANOES) {
    const d = Math.hypot(x - v.x, z - v.z);
    if (d < v.r) {
      dh += v.h * (1 - smoothstep(v.r * 0.22, v.r, d));
      if (v.craterR > 0 && d < v.craterR * 1.5)
        dh -= v.craterD * (1 - smoothstep(v.craterR * 0.55, v.craterR * 1.5, d));
    }
  }
  // long low dune ridges across the open waste (stretched noise, north only)
  const duneT =
    smoothstep(2000, 2140, z) *
    (1 - smoothstep(2310, 2370, z)) *
    smoothstep(STRIP_MAX_X - 4, STRIP_MAX_X + 26, x);
  if (duneT > 0) dh += (fbm2(x * 0.018, z * 0.085, seed + 41, 2) - 0.5) * 5 * duneT;
  return dh;
}

// Real craters, carved after the cones: a raised rock lip rings each pool
// and the floor sinks genuinely below the surrounding ground, so the melt
// sits down INSIDE its bowl the way lake water does (the floors stay above
// WATER_LEVEL so the zone water plane never floods a vent).
function applyEmberLavaBasins(x: number, z: number, h: number): number {
  if (z < DRAKE_ZMIN || z > DRAKE_ZMAX) return h;
  let out = h;
  for (const pool of EMBER_LAVA_POOLS) {
    const d = Math.hypot(x - pool.x, z - pool.z);
    if (d < pool.r * 2.2) {
      // the lip: rises from the bowl edge, falls away outward
      const lip =
        2.4 *
        smoothstep(pool.r * 0.7, pool.r * 1.05, d) *
        (1 - smoothstep(pool.r * 1.05, pool.r * 2.2, d));
      // the bowl: flat melt floor inside, blending up to the lip
      const blend = smoothstep(pool.r * 0.55, pool.r * 1.05, d);
      out = out * blend + pool.floor * (1 - blend) + lip;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Signature landforms: one distinctive terrain idea per northern realm, so
// no two maps read alike. All of them yield to roads (every marked route
// stays a walkable pass) and are placed clear of hubs, lakes, and camps.
// ---------------------------------------------------------------------------

// The Veilspires: the Frostveil's central massif. The terrace applier below
// steps its flanks into benched paths; the plateau tables are cut flat at
// the end of terrainHeight (mesa-style, after the rims).
const FROST_MASSIF = [
  { x: -6, z: 1710, r: 46, h: 24 }, // the south spire, over the road fork
  { x: -40, z: 1810, r: 46, h: 28 }, // the crown massif
  { x: 30, z: 1870, r: 44, h: 22 }, // the north spire at the pass road
  { x: 66, z: 1720, r: 40, h: 18 }, // the east shoulder above the tarn
] as const;
const FROST_PLATEAUS = [
  { x: -18, z: 1752, r: 20, h: 12 }, // the low shelf
  { x: -2, z: 1786, r: 15, h: 19 }, // the mid shelf
  { x: -26, z: 1820, r: 12, h: 26 }, // the crown table
] as const;
function frostMassifOffset(x: number, z: number): number {
  if (z < 1500 || z > FROST_ZMAX - 20) return 0;
  if (x < STRIP_MIN_X + 4 || x > STRIP_MAX_X - 4) return 0; // the Reach holds the strip's center
  let dh = 0;
  for (const m of FROST_MASSIF) {
    const d = Math.hypot(x - m.x, z - m.z);
    if (d < m.r) dh += m.h * (1 - smoothstep(m.r * 0.3, m.r, d));
  }
  if (dh <= 0) return 0;
  // roads pierce the range as valley passes
  return dh * smoothstep(7, 16, roadDistance(x, z));
}

// The Golden Shelf: the Amberfall's raised northeast tableland, an amber
// escarpment overlooking the Great Mere.
const AMBER_SHELF = [
  { x: -236, z: 1960, r: 55, h: 13 },
  { x: -264, z: 1896, r: 42, h: 9 },
  { x: -220, z: 2050, r: 48, h: 11 },
] as const;
function amberShelfOffset(x: number, z: number): number {
  if (z < 1860 || z > 2160) return 0;
  let dh = 0;
  for (const m of AMBER_SHELF) {
    const d = Math.hypot(x - m.x, z - m.z);
    if (d < m.r) dh += m.h * (1 - smoothstep(m.r * 0.35, m.r, d));
  }
  if (dh <= 0) return 0;
  return dh * smoothstep(7, 16, roadDistance(x, z));
}

// The Dreamer's Bowl: the Nightbloom's caldera. A climbable ring with a
// notch entrance on its road-facing side, a sunken dream-meadow floor, and
// a knoll at the very center.
const BOWL_X = -300;
const BOWL_Z = 1600;
function nightCalderaOffset(x: number, z: number): number {
  const d = Math.hypot(x - BOWL_X, z - BOWL_Z);
  if (d > 68) return 0;
  // the ring: a rounded rampart at radius 40, tall enough that its crest
  // takes the night biome's violet crag tint on the map (h > 20) instead
  // of reading as mid-slope rock
  const ring = 17 * (1 - smoothstep(0, 18, Math.abs(d - 40)));
  // the notch: the rampart parts on the southwest, toward Moonrest's road
  const ang = Math.atan2(x - BOWL_X, z - BOWL_Z);
  const notch = 1 - smoothstep(0.28, 0.62, Math.abs(ang + 2.3));
  // the floor: the bowl sinks gently inside the ring
  const bowl = -3.5 * (1 - smoothstep(10, 34, d));
  // the knoll: the dream stands centered
  const knoll = 7 * (1 - smoothstep(0, 10, d));
  // a gentle pedestal lifts the whole formation, so the rampart's crest
  // clears the caret and crag bands all the way around the circle
  const pedestal = 4 * (1 - smoothstep(30, 58, d));
  return ring * (1 - notch) + bowl + knoll + pedestal;
}

// The Firemount: the Palmreach's volcano, a climbable cone over the deep
// jungle with a cupped summit crater.
const CONE_X = -344;
const CONE_Z = 1002;
function palmConeOffset(x: number, z: number): number {
  const d = Math.hypot(x - CONE_X, z - CONE_Z);
  if (d > 36) return 0;
  // crest ~25: above the map's crown stipple (22) so the summit reads as
  // bare volcanic rock and carets, below the snow-cap band (26)
  const cone = 22 * (1 - smoothstep(4, 32, d));
  const crater = -8 * (1 - smoothstep(0, 9, d));
  return (cone + crater) * smoothstep(7, 14, roadDistance(x, z));
}

// The Braids: the Willowfen's east water-meadows dissolve into winding
// channels and grassy islets. Channels follow the valleys of a ridged
// noise field; roads, the hub, camps (which flattened first), and the
// border pass caps are all left dry.
function applyFenBraids(x: number, z: number, h: number): number {
  if (z < 240 || z > 620 || x < -380 || x > STRIP_MIN_X - 4) return h;
  if (h < WATER_LEVEL + 0.5 || h > 5.5) return h;
  const ridge = Math.abs(fbm2(x * 0.021, z * 0.021, 9301, 3) - 0.5) * 2;
  let channel = 1 - smoothstep(0.05, 0.17, ridge);
  if (channel <= 0) return h;
  // feathered region edges: a hard gate would print a straight hillshade
  // seam across the fen
  channel *= smoothstep(-380, -356, x) * (1 - smoothstep(STRIP_MIN_X - 30, STRIP_MIN_X - 6, x));
  channel *= smoothstep(240, 275, z) * (1 - smoothstep(585, 620, z));
  const roadGate = smoothstep(8, 15, roadDistance(x, z));
  let campGate = 1;
  for (const camp of CAMPS) {
    if (camp.center.z < 200 || camp.center.z > 660) continue;
    const d = Math.hypot(x - camp.center.x, z - camp.center.z);
    campGate = Math.min(campGate, smoothstep(camp.radius * 1.6, camp.radius * 2.4, d));
  }
  const depth = (WATER_LEVEL - 1.4 - h) * channel * roadGate * campGate;
  return depth < 0 ? h + depth : h;
}

// The Frostveil's terraced benches: the whole massif steps into flats,
// ramps, and short steep risers (multi-level mountain ground). Suppressed
// near roads so every marked route stays climbable, and below the shore
// line so beaches ease into the sea.
function applyFrostTerraces(x: number, z: number, h: number): number {
  if (z <= 1460 || z > FROST_ZMAX) return h;
  if (x < STRIP_MIN_X + 2 || x > STRIP_MAX_X - 2) return h; // the benches stay in the strip
  if (Math.abs(z - 1890) < 34 && Math.abs(x) > 92) return h; // the crossings' corridors stay smooth
  if (h < WATER_LEVEL + 2) return h;
  const road = roadDistance(x, z);
  if (road < 5) return h;
  const step = 6.5;
  const jit = (noise2(x * 0.045, z * 0.045, 88) - 0.5) * 3.4;
  const hh = h + jit;
  const base = Math.floor(hh / step) * step;
  const frac = (hh - base) / step;
  const ledge = base + step * Math.min(1, Math.max(0, (frac - 0.26) / 0.42));
  const w = 0.55 * smoothstep(WATER_LEVEL + 2, WATER_LEVEL + 5.5, h) * smoothstep(5, 12, road);
  return h + (ledge - h) * w;
}

// The continent's interior border meres: the landlocked lakes between the
// realms' corner caps, one basin span per interior border. Ocean rules
// (swim fatigue, rim suppression) must never treat them as open sea.
const BORDER_LAKES = [
  // the Hollow's moats: the border ribbon itself is a swimmable mere, but
  // the rects stay narrow so the wider water past them keeps the classic
  // swim-fatigue turnback (the Hollow stays a place you arrive at on
  // purpose, not by drifting)
  { x0: 168, x1: 212, z0: 950, z1: 1450 }, // the east moat
  { x0: -212, x1: -168, z0: 950, z1: 1450 }, // the west moat
  { x0: 136, x1: 224, z0: 1450, z1: 1935 }, // the Veilmelt, with the Snowline's isthmus
  { x0: -224, x1: -136, z0: 1450, z1: 1935 }, // the Palewater, with the Goldmelt's isthmus
  // (the six row-border waters between the column realms open westward or
  // eastward into the outer sea as natural inlets, so they are NOT listed:
  // their mouths keep the ocean rules)
] as const;
export function inBorderLake(x: number, z: number): boolean {
  for (const l of BORDER_LAKES) {
    if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return true;
  }
  return false;
}

// The northern realms' open sea (swim fatigue + rim suppression): far enough
// offshore that no land lobe reaches, near a true map border edge. The
// Hollow's north edge stopped being a border when the Drakelands landed
// beyond it, so only the x flanks bite there now; the Frostveil's far north
// is the world's actual end again.
export function inHollowOpenSea(x: number, z: number): boolean {
  if (x > DUNGEON_X_THRESHOLD) return false;
  // the Mirrorshallow: enclosed lake water, never open sea
  if (Math.hypot(x - 152, z - 1112) < 42) return false;
  // the interior border meres are landlocked, never open sea (the Hollow's
  // moat sections are deliberately NOT on that list)
  if (inBorderLake(x, z)) return false;
  const seaXb = worldXBoundsAt(z);
  if (z < 180) {
    // the starter sea: open water past the vale's and the island's organic
    // shores carries the fatigue turnback. The Ferrywalk sandbar is land you
    // walk, never open sea.
    if (Math.abs(x) > 620 || z < -215) return false; // the far void keeps legacy rules
    if (onCauseway(x, z)) return false;
    return valeLandness(x, z) < 0.02 && isleLandness(x, z) < 0.02;
  }
  if (z <= 960) {
    // the columns' southern outer coasts: open ocean to the world edge
    // (the strip center sits hundreds of yards from the row bounds here,
    // so this only ever bites the fen, gale, jungle, and garden flanks)
    const dRim = Math.min(x - seaXb.min, seaXb.max - x);
    return (
      dRim < 48 &&
      Math.max(fenLandness(x, z), galeLandness(x, z), reachLandness(x, z), gardenLandness(x, z)) <
        0.02
    );
  }
  if (z <= HOLLOW_ZMAX + 2) {
    // the moat: within reach of the sealed realm's OWN rect edges, open
    // water stays open sea however wide the row has grown, so no swimmer
    // slips into the Hollow sideways around the wall; the columns' outer
    // flanks keep the classic world-edge rule
    const dMoat = Math.min(x - STRIP_MIN_X, STRIP_MAX_X - x);
    const dRim = Math.min(x - seaXb.min, seaXb.max - x);
    if (dMoat >= 48 && dRim >= 48) return false;
    return (
      Math.max(
        hollowLandness(x, z),
        gardenLandness(x, z),
        reachLandness(x, z),
        woodLandness(x, z),
        nightLandness(x, z),
      ) < 0.02
    );
  }
  if (z <= FROST_ZMAX + 2) {
    const dMoat = Math.min(x - STRIP_MIN_X, STRIP_MAX_X - x);
    const dRim = Math.min(x - seaXb.min, seaXb.max - x);
    if (dMoat >= 48 && dRim >= 48) return false;
    return (
      Math.max(
        frostLandness(x, z),
        woodLandness(x, z),
        nightLandness(x, z),
        emberLandness(x, z),
        amberLandness(x, z),
      ) < 0.02
    );
  }
  if (z <= DRAKE_ZMAX + 2) {
    // the north bay between the columns' shoulders, and their outer flanks
    if (Math.abs(x) < 188) {
      return Math.max(frostLandness(x, z), emberLandness(x, z), amberLandness(x, z)) < 0.02;
    }
    const dRim = Math.min(x - seaXb.min, seaXb.max - x);
    return dRim < 48 && Math.max(emberLandness(x, z), amberLandness(x, z)) < 0.02;
  }
  return false;
}

// Border pockets the mountain fringe must not swallow.
function hollowShapingOffset(x: number, z: number, _seed: number): number {
  if (z < 905 || z > HOLLOW_ZMAX) return 0;
  if (x < STRIP_MIN_X - 20 || x > STRIP_MAX_X + 20) return 0; // strip only
  let dh = 0;
  for (const f of HOLLOW_SHAPING) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r) dh += f.h * (1 - smoothstep(f.r * 0.35, f.r, d));
  }
  // The x-flanks are natural coast now, not a mountain ring: the Hollow's land
  // simply slopes into the moat (the coast applier and the moat's scalloped
  // banks do the shaping), so its shores read as an organic coastline rather
  // than a walled bowl. Only the interior HOLLOW_SHAPING landforms remain.
  return dh;
}

export const MIREFEN_IMPACT_CRATER = {
  x: 149.5,
  z: 295,
  bowlRadius: 20,
  radius: 30,
  depth: 2.6,
  rimHeight: 0.95,
} as const;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Pure pass mask used by border ridges. Exported for the performance invariant
// test: a zero mask makes the skipped crest-noise contribution exactly +0.
export function ridgePassWeight(distanceFromPass: number): number {
  return smoothstep(PASS_HALF_WIDTH, PASS_SHOULDER, Math.abs(distanceFromPass));
}

// North-rim profile for the multi-row world. The rim can wander at most 23yd
// south of its nominal onset, so every point at or below this bound is provably
// outside it. Returning before the two fbm2 calls preserves the exact +0 result.
export function northRimWeight(x: number, z: number): number {
  if (z <= WORLD_MAX_Z - 53) return 0;
  const wobble = (fbm2(x * 0.008, 60.1, 9207, 2) - 0.5) * 46;
  return (
    smoothstep(WORLD_MAX_Z - 30 + wobble, WORLD_MAX_Z + wobble, z) *
    (0.32 + 0.68 * fbm2(x * 0.013, 60.2, 9209, 2))
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mirefenImpactCraterOffset(x: number, z: number): number {
  const dx = x - MIREFEN_IMPACT_CRATER.x;
  const dz = z - MIREFEN_IMPACT_CRATER.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= MIREFEN_IMPACT_CRATER.radius) return 0;

  const bowlT = d / MIREFEN_IMPACT_CRATER.bowlRadius;
  const bowl =
    d < MIREFEN_IMPACT_CRATER.bowlRadius
      ? -MIREFEN_IMPACT_CRATER.depth * (1 - smoothstep(0, 1, bowlT))
      : 0;

  const rimStart = MIREFEN_IMPACT_CRATER.bowlRadius * 0.82;
  if (d <= rimStart) return bowl;
  const rimT = (d - rimStart) / (MIREFEN_IMPACT_CRATER.radius - rimStart);
  const rim =
    MIREFEN_IMPACT_CRATER.rimHeight * smoothstep(0, 0.35, rimT) * (1 - smoothstep(0.72, 1, rimT));
  return bowl + rim;
}

// Blended biome shape at a position. Zone interiors keep their exact shape;
// blends happen across the same -30/+35yd windows at every border: the
// strip's band boundaries cascade by z as they always did, and column zones
// blend in sideways (columnBlendAt), so an east map's hills arrive across
// its border pass exactly like a northern realm's do.
function shapeAt(x: number, z: number): { hill: number; base: number } {
  let hill = BIOME_SHAPE[STRIP_ZONES[0].biome].hill;
  let base = BIOME_SHAPE[STRIP_ZONES[0].biome].base;
  for (let i = 0; i + 1 < STRIP_ZONES.length; i++) {
    const boundary = STRIP_ZONES[i].zMax;
    const t = smoothstep(boundary - 30, boundary + 35, z);
    const next = BIOME_SHAPE[STRIP_ZONES[i + 1].biome];
    hill = lerp(hill, next.hill, t);
    base = lerp(base, next.base, t);
  }
  for (const col of COLUMN_ZONES) {
    const t = columnBlendAt(col, x, z);
    if (t <= 0) continue;
    const shape = BIOME_SHAPE[col.biome];
    hill = lerp(hill, shape.hill, t);
    base = lerp(base, shape.base, t);
  }
  return { hill, base };
}

function baseHeight(x: number, z: number, seed: number): number {
  const shape = shapeAt(x, z);
  let h =
    (fbm2(x * HILL_SCALE + 100, z * HILL_SCALE + 100, seed, 4) - 0.5) * shape.hill + shape.base;
  h += (fbm2(x * DETAIL_SCALE, z * DETAIL_SCALE, seed + 7, 2) - 0.5) * 2.2;
  // Flatten each zone's hub settlement into a plateau
  for (const zone of ZONES) {
    const dx = x - zone.hub.x,
      dz = z - zone.hub.z;
    // Conservative squared-distance gate (one spare yard of margin) before
    // the sqrt: a point past it can never pass the dHub < radius*1.6 test
    // below, so skipping it is bit-identical. This loop runs for EVERY
    // terrainHeight sample, and sqrt per zone per sample was real cost.
    const hubGate = zone.hub.radius * 1.6 + 1;
    if (dx * dx + dz * dz >= hubGate * hubGate) continue;
    const dHub = Math.sqrt(dx * dx + dz * dz);
    if (dHub < zone.hub.radius * 1.6) {
      const blend = smoothstep(zone.hub.radius * 0.7, zone.hub.radius * 1.6, dHub);
      h = h * blend + BIOME_SHAPE[zone.biome].hubHeight * (1 - blend);
    }
  }
  // Keep dry land everywhere: soft-floor low dips above the water level...
  const minLand = WATER_LEVEL + 1.4;
  if (h < minLand) h = minLand - (minLand - h) * 0.12;
  // ...except the carved lake basins
  for (const zone of ZONES) {
    for (const lake of zone.lakes) {
      // Conservative squared-distance gate before the noise + sqrt: the shore
      // wobble is bounded by radius*0.225 (|noise2 - 0.5| <= 0.5), so a point
      // farther than radius*1.84 can never pass the dLake < radius*1.6 carve
      // test below. Skipping it is bit-identical, and it matters: the wobble
      // noise used to run for every lake in the WORLD on every height sample.
      const ldx = x - lake.x,
        ldz = z - lake.z;
      const lakeGate = lake.radius * 1.84;
      if (ldx * ldx + ldz * ldz >= lakeGate * lakeGate) continue;
      // organic shores: the carve distance wobbles with fixed-seed noise so
      // lakes read as real waterbodies instead of stamped discs. Northern
      // realms only (z > 900): the three original zones keep their exact
      // shorelines, and with them every seed-pinned fixture placed on them.
      const wob = lake.z > 900 ? (noise2(x * 0.12, z * 0.12, 9109) - 0.5) * lake.radius * 0.45 : 0;
      const dLake = Math.sqrt((x - lake.x) ** 2 + (z - lake.z) ** 2) + wob;
      if (dLake < lake.radius * 1.6) {
        const lakeBlend = smoothstep(lake.radius * 0.55, lake.radius * 1.6, dLake);
        h = h * lakeBlend + (WATER_LEVEL - 4) * (1 - lakeBlend);
      }
    }
  }
  return h;
}

// ---------------------------------------------------------------------------
// The custom-map edit layer (the sculpt brushes), applied to the height computed
// so far. Stamps apply in array order; pure data, no RNG, so the sim and renderer
// agree. `add` stamps add a falloff-weighted delta; `level` stamps pull the height
// toward the absolute height `delta` (flatten/plateau/terrace). The built-in world
// has no terrainEdits, so the heightfield is unchanged.
//
// Stamps are looked up through a coarse spatial bucket index (cell 32yd; each
// stamp registered in every cell its radius's bounding box touches) instead of a
// linear scan: the render chunk rebuilder samples the height 5x per vertex, so
// with the 4000-stamp cap the linear scan grows editor brush cost with session
// length. Determinism contract: candidates for a query point are iterated in
// ascending original array index (each bucket is built in index order and a stamp
// appears at most once per bucket), so float addition order is bit-identical to
// the linear scan. The index is a pure cache keyed by the terrainEdits array
// reference + length; it is rebuilt when either differs and cleared by
// invalidateTerrainEditIndex() for same-length in-place mutations.
// ---------------------------------------------------------------------------

const EDIT_INDEX_CELL = 32; // yards per bucket cell
// A stamp this large would touch an unbounded number of cells; index none and
// fall back to the (bit-identical) linear scan. The document sanitizer caps
// stamp radius at 200, so this only guards hostile in-memory content.
const EDIT_INDEX_MAX_RADIUS = 4096;

interface TerrainEditIndex {
  length: number;
  linear: boolean; // true = do not use buckets, scan the array
  buckets: Map<string, number[]>; // "cx,cz" -> ascending stamp indices
}

let terrainEditIndexCache = new WeakMap<HeightStamp[], TerrainEditIndex>();

// Clears the edit-layer index cache. The editor MUST call this after a
// splice-style in-place mutation that keeps the array reference and length
// (e.g. replacing a stamp); push/pop/reassignment are picked up automatically
// via the length + reference key. The exact export name is a contract with the
// editor lane: do not rename.
export function invalidateTerrainEditIndex(): void {
  terrainEditIndexCache = new WeakMap();
}

function buildTerrainEditIndex(edits: HeightStamp[]): TerrainEditIndex {
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    if (e.radius <= 0) continue; // the scan skips these too; no cell to register
    // A non-finite stamp (NaN poisons the scan; Infinity reaches everywhere)
    // or an absurd radius cannot be bucketed: reproduce the linear scan's
    // exact semantics by not indexing at all.
    if (
      !Number.isFinite(e.radius) ||
      e.radius > EDIT_INDEX_MAX_RADIUS ||
      !Number.isFinite(e.x) ||
      !Number.isFinite(e.z)
    ) {
      return { length: edits.length, linear: true, buckets: new Map() };
    }
    // One guard cell on every side: sqrt rounding can put a point with
    // d < radius up to ~1 ulp outside the bbox cells at an exact cell
    // boundary. Extra candidates are harmless (applyStamp re-checks d).
    const c0 = Math.floor((e.x - e.radius) / EDIT_INDEX_CELL) - 1;
    const c1 = Math.floor((e.x + e.radius) / EDIT_INDEX_CELL) + 1;
    const r0 = Math.floor((e.z - e.radius) / EDIT_INDEX_CELL) - 1;
    const r1 = Math.floor((e.z + e.radius) / EDIT_INDEX_CELL) + 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = `${c},${r}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(i); // outer loop is ascending i, so each bucket stays sorted
      }
    }
  }
  return { length: edits.length, linear: false, buckets };
}

// One stamp's contribution, shared verbatim by the indexed and linear paths so
// they are bit-identical.
function applyStamp(e: HeightStamp, x: number, z: number, h: number): number {
  if (e.radius <= 0) return h;
  const dx = x - e.x;
  const dz = z - e.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= e.radius) return h;
  const t = d / e.radius; // 0 at centre, 1 at edge
  // 'flat' = full delta out to the edge; 'smooth' = eased taper to 0.
  const w = e.falloff === 'flat' ? 1 : 1 - smoothstep(0, 1, t);
  if (e.mode === 'level') return lerp(h, e.delta, w);
  return h + e.delta * w;
}

function applyEditLayer(x: number, z: number, h0: number): number {
  const edits = getActiveWorldContent().terrainEdits;
  if (!edits || edits.length === 0) return h0;
  let index = terrainEditIndexCache.get(edits);
  if (!index || index.length !== edits.length) {
    index = buildTerrainEditIndex(edits);
    terrainEditIndexCache.set(edits, index);
  }
  let h = h0;
  if (index.linear) {
    for (const e of edits) h = applyStamp(e, x, z, h);
    return h;
  }
  const key = `${Math.floor(x / EDIT_INDEX_CELL)},${Math.floor(z / EDIT_INDEX_CELL)}`;
  const bucket = index.buckets.get(key);
  if (!bucket) return h0;
  // Any stamp with d < radius has |x - e.x| < radius, so its bounding-box cells
  // cover the query cell: the bucket holds every contributing stamp, in
  // ascending array index, exactly once.
  for (const i of bucket) h = applyStamp(edits[i], x, z, h);
  return h;
}

// The Sowfield boarball ground (docs/prd/vale-cup.md): the southern Eastbrook
// basin leveled into a crisp rectangular plateau with a smoothstep apron ring.
// Blend weight of the flatten at (x, z): 1 inside the rectangle, easing to 0
// over SOWFIELD_FLAT.falloff yards outside it. Height stamps are circles-only,
// so like MIREFEN_IMPACT_CRATER this is a bespoke hand-authored arm; it applies
// for ANY active content. The apron's influence ends at z = SOWFIELD_FLAT.zMin -
// falloff (-149), north of the world rim's z = -150 onset, so the rim wall is
// untouched by construction (tests/terrain_walls.test.ts sweeps that band).
export function sowfieldFlattenWeight(x: number, z: number): number {
  const f = SOWFIELD_FLAT;
  const dx = Math.max(0, f.xMin - x, x - f.xMax);
  const dz = Math.max(0, f.zMin - z, z - f.zMax);
  if (dx === 0 && dz === 0) return 1;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d >= f.falloff) return 0;
  return 1 - smoothstep(0, 1, d / f.falloff);
}

// The renderer seats each dock section relative to its shore anchor, then uses
// the plank top as a raised walkable surface. Return the matching absolute
// surface height, or -Infinity outside every deck footprint.
function dockSurfaceHeight(x: number, z: number, seed: number): number {
  let surface = -Infinity;
  for (const dock of getActiveWorldContent().props.docks) {
    const local = dockLocalPoint(dock, x, z);
    if (dockSectionAtLocal(local.x, local.z) < 0) continue;
    const line = dockSurfaceLine(dock, (sampleX, sampleZ) => terrainHeight(sampleX, sampleZ, seed));
    surface = Math.max(surface, dockSurfaceYAt(line, local.z));
  }
  return surface;
}

// Ground height including instanced dungeon floors (flat, far off-world), the
// walkable Vale Cup grandstand lift, raised docks, and custom-map sculpt edits.
export function groundHeight(x: number, z: number, seed: number): number {
  if (x > DUNGEON_X_THRESHOLD) return DUNGEON_FLOOR_Y;
  // The Vale Cup grandstands are walkable: the ground steps up in seated tiers so
  // players can climb the bleachers (raised WALKABLE ground is the heightfield).
  // This lives in groundHeight, NOT terrainHeight, so the render's flat terrain
  // baseline (and the wooden deck geometry that seats on it) is unchanged; the
  // ramp just raises where the player stands. Zero outside the stand footprints,
  // so the pitch stays flat. (The custom-map edit layer is applied inside
  // terrainHeight, so it never touches the flat instance/rift floor above.)
  let h = terrainHeight(x, z, seed) + sowfieldStandLift(x, z);
  const content = getActiveWorldContent();
  const rampFloor = placementRampFloorAt(content, seed, x, z);
  if (rampFloor > h) h = rampFloor;
  for (const v of content.colliderVolumes ?? []) {
    if (v.kind !== 'plane') continue;
    const dx = x - v.x;
    const dz = z - v.z;
    if (!v.rotX && !v.rotZ) {
      const c = Math.cos(v.rotY);
      const s = Math.sin(v.rotY);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) > v.sizeX / 2 || Math.abs(lz) > v.sizeZ / 2) continue;
      const floor = terrainHeight(v.x, v.z, seed) + v.sizeY;
      if (floor > h) h = floor;
      continue;
    }
    const ca = Math.cos(v.rotX ?? 0);
    const sa = Math.sin(v.rotX ?? 0);
    const cb = Math.cos(v.rotY);
    const sb = Math.sin(v.rotY);
    const cg = Math.cos(v.rotZ ?? 0);
    const sg = Math.sin(v.rotZ ?? 0);
    const ux = cb * cg;
    const uy = ca * sg + sa * sb * cg;
    const uz = sa * sg - ca * sb * cg;
    const wx = sb;
    const wy = -sa * cb;
    const wz = ca * cb;
    const det = ux * wz - wx * uz;
    if (Math.abs(det) < 1e-6) continue;
    const lx = (dx * wz - wx * dz) / det;
    const lz = (ux * dz - dx * uz) / det;
    if (Math.abs(lx) > v.sizeX / 2 || Math.abs(lz) > v.sizeZ / 2) continue;
    const floor = terrainHeight(v.x, v.z, seed) + v.sizeY + lx * uy + lz * wy;
    if (floor > h) h = floor;
  }
  return Math.max(h, dockSurfaceHeight(x, z, seed));
}

/** The cave floor sheet at a point, or null when no authored cave crosses it. */
export function caveSheetAt(x: number, z: number): CaveSample | null {
  const caves = getActiveWorldContent().caves;
  if (!caves || caves.length === 0 || x > DUNGEON_X_THRESHOLD) return null;
  return caveFloorAt(caves, x, z);
}

/** Whether editor-authored terrain holes remove the surface sheet at a point. */
export function terrainCutAt(x: number, z: number, seed: number): boolean {
  const content = getActiveWorldContent();
  const holes = content.holes;
  if (!holes || holes.length === 0) return false;
  return inTerrainHole(holes, x, z, terrainHeight(x, z, seed), content.holePatches);
}

/** Resolve the walkable sheet closest to the mover's previous height. */
export function groundHeightNear(x: number, z: number, seed: number, prevY: number): number {
  const h = groundHeight(x, z, seed);
  const sheet = caveSheetAt(x, z);
  const content = getActiveWorldContent();
  if (content.holes && content.holes.length > 0) {
    const terrain = terrainHeight(x, z, seed);
    if (inTerrainHole(content.holes, x, z, terrain, content.holePatches)) {
      const surfaceFloor = h > terrain + 0.01 ? h : null;
      if (sheet && surfaceFloor === null) return sheet.floor;
      if (sheet && surfaceFloor !== null) {
        return Math.abs(prevY - sheet.floor) <= Math.abs(prevY - surfaceFloor)
          ? sheet.floor
          : surfaceFloor;
      }
      if (surfaceFloor !== null) return surfaceFloor;
      return terrain + HOLE_WALL_RISE;
    }
  }
  if (!sheet) return h;
  return Math.abs(prevY - sheet.floor) <= Math.abs(prevY - h) ? sheet.floor : h;
}

export function onCaveSheet(x: number, z: number, seed: number, prevY: number): boolean {
  const sheet = caveSheetAt(x, z);
  if (!sheet) return false;
  if (terrainCutAt(x, z, seed)) return true;
  return Math.abs(prevY - sheet.floor) <= Math.abs(prevY - groundHeight(x, z, seed));
}

const CAVE_WALK_HEADROOM = 1.8;

function caveWallAt(x: number, z: number, seed: number, prevY: number): boolean {
  const caves = getActiveWorldContent().caves;
  if (!caves || caves.length === 0 || x > DUNGEON_X_THRESHOLD) return false;
  const sample = caveSampleAt(caves, x, z);
  if (!sample || sample.mouth) return false;
  const needed = Math.min(CAVE_WALK_HEADROOM, sample.clearance * 0.55);
  if (sample.ceiling - sample.floor >= needed) return false;
  if (terrainCutAt(x, z, seed)) return true;
  return Math.abs(prevY - sample.floor) <= Math.abs(prevY - groundHeight(x, z, seed));
}

/** Prevent a movement segment from crossing an authored cave wall. */
export function caveWallBlocksStep(
  seed: number,
  fromX: number,
  fromZ: number,
  prevY: number,
  toX: number,
  toZ: number,
): boolean {
  if (caveWallAt(fromX, fromZ, seed, prevY)) return false;
  return (
    caveWallAt(toX, toZ, seed, prevY) ||
    caveWallAt((fromX + toX) / 2, (fromZ + toZ) / 2, seed, prevY)
  );
}

const CAVE_MOUTH_STEP_UP = 1.1;

/** Allow a small upward step only when moving between surface and cave sheets. */
export function caveMouthStepOk(
  seed: number,
  fromX: number,
  fromZ: number,
  prevY: number,
  toX: number,
  toZ: number,
  h0: number,
  h1: number,
): boolean {
  const rise = h1 - h0;
  if (rise <= 0 || rise > CAVE_MOUTH_STEP_UP) return false;
  return onCaveSheet(fromX, fromZ, seed, prevY) !== onCaveSheet(toX, toZ, seed, prevY);
}

// Caves no longer deform the heightfield: a cave is a standalone tube volume
// (sim/caves.ts) and surface openings are TerrainHole cutouts (terrainCutAt),
// so terrainHeight is the pure surface pipeline.
export function terrainHeight(x: number, z: number, seed: number): number {
  if (isAuthoredMapPresentation(getActiveWorldContent().presentationMode)) {
    return applyEditLayer(x, z, 0);
  }
  let h = baseHeight(x, z, seed);

  // Flatten each camp a little so mobs don't stand on cliffs. The squared
  // gate (one spare yard) before the sqrt is bit-identical: a point past it
  // can never pass the d < radius*1.8 test, and this loop runs over all 150
  // camps for EVERY height sample.
  for (const camp of CAMPS) {
    const dx = x - camp.center.x,
      dz = z - camp.center.z;
    const campGate = camp.radius * 1.8 + 1;
    if (dx * dx + dz * dz >= campGate * campGate) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < camp.radius * 1.8) {
      const ch = baseHeight(camp.center.x, camp.center.z, seed);
      const blend = smoothstep(camp.radius * 0.8, camp.radius * 1.8, d);
      h = h * blend + ch * (1 - blend);
    }
  }

  // Mountain ridge walls along shared zone edges, pierced by the road pass
  // (sealed walls have no pass and only ever grow past their base height,
  // so no crest dip opens a climbable notch)
  let wallAdd = 0;
  for (const edge of BORDER_EDGES) {
    const sigma = edge.sealed ? SEALED_RIDGE_SIGMA : RIDGE_SIGMA;
    const dPerp = Math.abs((edge.kind === 'h' ? z : x) - edge.at);
    if (dPerp < sigma * 3) {
      const along = edge.kind === 'h' ? x : z;
      let profile = Math.exp(-(dPerp * dPerp) / (2 * sigma * sigma));
      const pass = edge.sealed ? 1 : ridgePassWeight(along - edge.passAt);
      // Inside a road pass, the final wall term is exactly +0. Skip the crest
      // noise and shaping work while keeping the heightfield bit-identical.
      if (pass === 0) continue;
      // jagged crest so the wall reads as mountains, not a berm
      // Thornpeak's edges carry real peaks: the mountain realm's borders
      // are taller and craggier than the rest of the grid's low ranges
      // (the Sunway and Gardenwalk passes still open through them)
      const peaksEdge =
        (edge.kind === 'v' && edge.lo >= 540 && edge.hi <= 900) ||
        (edge.kind === 'h' && edge.at === 540);
      // Thornpeak's range wanders instead of running dead straight: its crest
      // LINE meanders +-16yd with low-frequency noise along its length, and
      // its height swells and saddles over long runs, so the mountain front
      // reads as an organic range, not a ruled berm. Placement (mean z540 /
      // the column lines) is unchanged.
      // The sealed south wall's VISIBLE crest also meanders so it reads as an
      // organic range, not a ruled band, on the map. This moves only the
      // terrain crest line; the movement seal (crossesSealedBorder / SEALED_
      // BORDERS) is a separate, independent wall fixed at the border, so
      // weaving the mountains never opens a gap the player can walk through.
      let dPerpEdge = dPerp;
      if (peaksEdge || edge.sealed) {
        const amp = edge.sealed ? 14 : 32;
        const amp2 = edge.sealed ? 6 : 10;
        const wob =
          (fbm2(along * 0.006, edge.at * 0.006, seed + 31, 2) - 0.5) * amp +
          (fbm2(along * 0.02, edge.at * 0.02, seed + 33, 2) - 0.5) * amp2;
        dPerpEdge = Math.abs((edge.kind === 'h' ? z : x) - (edge.at + wob));
        profile = Math.exp(-(dPerpEdge * dPerpEdge) / (2 * sigma * sigma));
      }
      const crestNoise =
        edge.kind === 'h'
          ? (fbm2(x * 0.03, edge.at * 0.03, seed + 19, 2) - 0.5) * (peaksEdge ? 1.0 : 0.7)
          : (fbm2(edge.at * 0.03, z * 0.03, seed + 19, 2) - 0.5) * (peaksEdge ? 1.0 : 0.7);
      // a coarse height swell for peaks so the wall has big shoulders and
      // saddles over long runs (broken silhouette, not uniform teeth)
      const peaksSwell = peaksEdge
        ? 0.55 + 0.9 * fbm2(along * 0.009, edge.at * 0.009, seed + 37, 2)
        : 1;
      const crest = (1 + (edge.sealed ? Math.abs(crestNoise) : crestNoise)) * peaksSwell;
      // the marsh's mountain range (the z540 marsh|peaks wall) sits a little
      // lower than the peaks' inner crags
      const peaksHeight = edge.kind === 'h' && edge.at === 540 ? 27 : 34;
      const height = edge.sealed ? SEALED_RIDGE_HEIGHT : peaksEdge ? peaksHeight : RIDGE_HEIGHT;
      // The Hollow/Drakelands boundary ridge rises only where there is land
      // to carry it (the Wyrmgate mountains around the causeway head); over
      // the open sea the two realms' waters simply meet. Sealed walls are
      // never gated: the Drakemaw range runs down into the sea at its flanks.
      let seaGate = 1;
      // seaGate the northern realms' edges AND every column-row border (an
      // east/west column h-edge, lo>=strip or hi<=-strip): those are mere
      // crossings whose ridge must not rise over the open water at the mere
      // caps. The classic full-strip land borders (vale/marsh, marsh/peaks)
      // keep their ungated mountain range.
      const columnRow = edge.kind === 'h' && (edge.lo >= STRIP_MAX_X || edge.hi <= STRIP_MIN_X);
      const northern = (edge.kind === 'h' ? edge.at >= HOLLOW_ZMAX : true) || columnRow;
      if (!edge.sealed && northern) {
        seaGate = smoothstep(
          0.005,
          0.06,
          Math.max(
            greenSeamT(x, z) * 0.2,
            hollowLandness(x, z),
            emberLandness(x, z),
            frostLandness(x, z),
            amberLandness(x, z),
            fenLandness(x, z),
            nightLandness(x, z),
            woodLandness(x, z),
            reachLandness(x, z),
            gardenLandness(x, z),
            galeLandness(x, z),
          ),
        );
      }
      // a partial edge (a column border, or a band split by columns) fades
      // out past its span; a full-row edge keeps the classic unbounded wall
      let end = 1;
      if (!edge.fullRow) {
        const outside = Math.max(edge.lo - along, along - edge.hi, 0);
        end = 1 - smoothstep(0, 24, outside);
      }
      // the Mirefen crater is a seed-pinned fixture 30yd from the marsh's
      // east border: the wall's gaussian tail must not lean into its bowl
      const dCrater = Math.hypot(x - MIREFEN_IMPACT_CRATER.x, z - MIREFEN_IMPACT_CRATER.z);
      const craterGate = smoothstep(34, 56, dCrater);
      // where two borders meet, the TALLER range wins instead of stacking
      // (summed corners built unclimbable knots at every junction)
      wallAdd = Math.max(wallAdd, height * crest * profile * pass * seaGate * end * craterGate);
    }
  }
  h += wallAdd;

  h += mirefenImpactCraterOffset(x, z);
  h += hollowShapingOffset(x, z, seed);
  h += emberShapingOffset(x, z, seed);
  h += frostMassifOffset(x, z);
  h += amberShelfOffset(x, z);
  h += nightCalderaOffset(x, z);
  h += palmConeOffset(x, z);
  h = applyHollowCoast(x, z, h);
  h = applyEmberCoast(x, z, h);
  h = applyFrostCoast(x, z, h);
  h = applyAmberCoast(x, z, h);
  h = applyFenCoast(x, z, h);
  h = applyNightCoast(x, z, h);
  h = applyWoodCoast(x, z, h);
  h = applyReachCoast(x, z, h);
  h = applyGardenCoast(x, z, h);
  h = applyGaleCoast(x, z, h);
  h = applyValeCoast(x, z, h);
  h = applyIsleCoast(x, z, h);
  h = applyCauseway(x, z, h);
  h = applyStarterMoat(x, z, h);
  h = applyColumnStraits(x, z, h);
  h = applyStripFlankCoast(x, z, h);
  h = applyRowMeres(x, z, h);
  h = applyNorthBay(x, z, h);
  h = applyEmberLavaBasins(x, z, h);
  h = applyFrostTerraces(x, z, h);
  h = applyFenBraids(x, z, h);
  // The Great Maze rises out of the finished lawn: walls are pure additive
  // hedge over whatever the garden terrain does beneath them, so corridors
  // follow the ground and the walls stay a constant unclimbable height.
  h += gardenMazeOffset(x, z);
  // World rims AFTER the coast, so the border ranges rise out of the sea
  // (mountains dipping into the ocean at the flanks) instead of being sunk
  // by it. The NORTH rim is suppressed over the Hollow's open sea: looking
  // out from the shore reads as water meeting sky, and swim fatigue (not a
  // wall) turns swimmers back before the band edge.
  const xb = worldXBoundsAt(z);
  let rimX = Math.max(smoothstep(xb.max - 30, xb.max, x), smoothstep(-xb.min - 30, -xb.min, -x));
  let rimS = smoothstep(WORLD_MIN_Z + 30, WORLD_MIN_Z, z);
  // The north rim (the Drakelands' Ashen Reach along the world's top edge)
  // wanders and saddles so it reads as an organic mountain coast, not a ruled
  // horizontal wall: its onset line meanders +-23yd in z with low-frequency
  // noise along x, and its height swells and drops to near-nothing over long
  // runs (broken massifs and passes, not a uniform berm).
  let rimN = northRimWeight(x, z);
  // the southern realms end in open coast, not a rim range: the vale, the
  // Farshore, the fen, the headlands, the jungle, and the lawns all meet
  // the sea at their outer edges, and swim fatigue does the containment
  // (bounded to the playable world: far instance-space x keeps its rim)
  if (z <= 1260 && Math.abs(x) <= 600) {
    rimX = 0;
    rimS = 0;
  }
  if (inHollowOpenSea(x, z)) {
    // no ranges over the open sea: the flanks read as water to the map edge
    // (swim fatigue, not a wall, turns swimmers back out there)
    rimX = 0;
    rimN = 0;
  }
  // the northern grid's outer edges are open ocean (applyWorldEdgeSea carves
  // them below), so no rim range rises there; instance space past |x|560 keeps
  // its containment wall
  if (z > 1250 && Math.abs(x) <= 560) {
    rimX = 0;
    rimN = 0;
  }
  // inside the northern realms the remaining land rims stay softer than the
  // world's (their coasts and ranges do the framing; the old causeway gate
  // cap is now the Wyrmgate ridge with a real pass through it)
  const rimScale = z > 960 && z <= WORLD_MAX_Z ? 0.6 : 1;
  h += Math.max(rimX, rimS, rimN) * 40 * rimScale;
  // Brother Aldric's wall: the Mirefen keeps a relic of its old east rim
  // beside the crater fixture (the green seam replaced the rest of that rim
  // with the Windway's approach downs), so the impact site still reads as a
  // strike into the wall's base and every seed-pinned sample holds
  h +=
    40 *
    smoothstep(150, 180, x) *
    (1 - smoothstep(184, 214, x)) *
    (1 - smoothstep(45, 75, Math.abs(z - MIREFEN_IMPACT_CRATER.z))) *
    // ...with a walkable breach at the wall's north end, so the relic is a
    // landmark to route around, not a shut border
    (1 - 0.85 * (1 - smoothstep(10, 26, Math.abs(z - 348))));
  // the Tablecrag's crown: a level table cut into the eastern border range
  // (flattened AFTER the rims so the top is a true plateau, not rim noise)
  const dMesa = Math.hypot(x + 168, z - 1195);
  if (dMesa < 30) {
    const t = smoothstep(14, 30, dMesa);
    h = h * t + 34 * (1 - t);
  }
  const dMesaS = Math.hypot(x + 166, z - 1072);
  if (dMesaS < 26) {
    const t = smoothstep(11, 26, dMesaS);
    h = h * t + 30 * (1 - t);
  }
  // Beyond a row's own columns the world is open water: past the rim range
  // the ground dives to the sea floor, so rows without an east or west
  // column read as coast, not as an endless mountain shelf. Two gates keep
  // it honest: it only exists where the world is genuinely wider than this
  // row (inert in a one-column world), and never past the world bounds
  // themselves (instance space far east keeps its untouched heights).
  if (
    (WORLD_MAX_X > xb.max || WORLD_MIN_X < xb.min) &&
    x <= WORLD_MAX_X + 60 &&
    x >= WORLD_MIN_X - 60
  ) {
    const beyond = Math.max(x - (xb.max + 26), xb.min - 26 - x);
    if (beyond > 0) {
      const t = smoothstep(0, 44, beyond);
      h = h * (1 - t) + (WATER_LEVEL - 6) * t;
    }
  }
  // The Veilspires' plateau tables: level shelves cut into the massif at
  // rising heights (flattened after the rims and terraces, so each top is
  // a true plateau).
  if (z > 1680 && z < 1880 && x > STRIP_MIN_X + 4 && x < STRIP_MAX_X - 4) {
    for (const p of FROST_PLATEAUS) {
      const dP = Math.hypot(x - p.x, z - p.z);
      if (dP < p.r) {
        const t = smoothstep(p.r * 0.55, p.r, dP);
        h = h * t + p.h * (1 - t);
      }
    }
  }
  // The Huntsman's Bluff: the Pale Huntsman's clearing sits on a flat-top
  // rise; his road from Gallowmere climbs the blended rim as the ramp.
  if (z > 1620 && z < 1750) {
    const dBluff = Math.hypot(x - 380, z - 1680);
    if (dBluff < 32) {
      const t = smoothstep(17, 32, dBluff);
      h = h * t + 14 * (1 - t);
    }
  }
  // Last: the northern grid's outer edges dive to open ocean with a wavy
  // coast, after every land-raising pass, so no realm's land hugs the map edge.
  h = applyWorldEdgeSea(x, z, h);
  // The Sowfield plateau (Vale Cup) is the LAST word on the southern-vale
  // terrain: a LEVEL pull toward the pitch height applied AFTER every coast, rim,
  // and sea pass (like the Tablecrag / Veilspires bespoke plateaus above), so the
  // football pitch stays dead flat and dry no matter what the grid's vale coast
  // does beneath it. Its influence ends north of the world-rim onset (z >= -149,
  // see sowfieldFlattenWeight), so it never fights the rim wall.
  const sow = sowfieldFlattenWeight(x, z);
  if (sow > 0) h = lerp(h, SOWFIELD_FLAT.height, sow);
  // The custom-map sculpt edits are the LAST word over the finished overworld
  // height (the editor's height stamps; a no-op for the built-in world, which has
  // no terrainEdits). Kept in terrainHeight so the render mesh (which samples
  // terrainHeight) and the sim's groundHeight both see the edited ground.
  return applyEditLayer(x, z, h);
}

// Steepest local rise/run of the walkable heightfield at (x, z), independent of
// travel direction. Movement gates on this (not just the slope along the step)
// so a diagonal switchback approach cannot beat the straight-line climb limit.
const STEEPNESS_SAMPLE = 0.35; // yards; about one movement tick of run
export function terrainSteepness(x: number, z: number, seed: number): number {
  const e = STEEPNESS_SAMPLE;
  const hx = (groundHeight(x + e, z, seed) - groundHeight(x - e, z, seed)) / (2 * e);
  const hz = (groundHeight(x, z + e, seed) - groundHeight(x, z - e, seed)) / (2 * e);
  return Math.hypot(hx, hz);
}

// Memoized 1-yard-cell view of terrainSteepness for the per-tick movement gates
// (every moving mob evaluates its step fan every tick; the exact helper costs
// four heightfield samples). A cache over a pure function of (cell, seed) stays
// fully deterministic; the cap just bounds memory on long-running hosts. Cell
// granularity only shifts a gate line by under a yard, far inside the walls'
// steepness margin (tests/terrain_walls.test.ts).
const steepnessCache = new Map<number, Map<number, number>>(); // seed -> cell -> steepness
const STEEPNESS_CACHE_MAX = 400_000; // cells per seed; ~the whole overworld
const STEEPNESS_CACHE_MAX_SEEDS = 4; // hosts run one seed; only test runs see more
const STEEPNESS_CELL_SPAN = 16384; // cells per axis in the packed key
export function terrainSteepnessAt(x: number, z: number, seed: number): number {
  // Instanced interiors (dungeons/arena/delves/rifts) are flat floors; skip the
  // cache entirely so their far-off coordinates never enter (or overflow) the
  // packed key space, which is sized for the overworld.
  if (x > DUNGEON_X_THRESHOLD) return 0;
  const cx = Math.round(x);
  const cz = Math.round(z);
  let bySeed = steepnessCache.get(seed);
  if (!bySeed) {
    if (steepnessCache.size >= STEEPNESS_CACHE_MAX_SEEDS) steepnessCache.clear();
    bySeed = new Map();
    steepnessCache.set(seed, bySeed);
  }
  const key = (cx + STEEPNESS_CELL_SPAN / 2) * STEEPNESS_CELL_SPAN + (cz + STEEPNESS_CELL_SPAN / 2);
  let v = bySeed.get(key);
  if (v === undefined) {
    if (bySeed.size >= STEEPNESS_CACHE_MAX) bySeed.clear();
    v = terrainSteepness(cx, cz, seed);
    bySeed.set(key, v);
  }
  return v;
}

// True inside the terrain bands that hold the deliberate unwalkable walls: the
// inter-zone border ridges and the world rim (with margin). The per-tick mob
// movement gate screens with this so the steepness memo never runs over the open
// world; rare interior steep spots (calderas, massifs, mesas) stay mob-walkable,
// exactly as they were before the gate (players get the full gate everywhere in
// sim.ts). Adapted to dems's BORDER_EDGES + rim (the strip-era ZONE_RIDGES this
// once screened are gone).
export function nearSteepWalls(x: number, z: number): boolean {
  if (x > DUNGEON_X_THRESHOLD) return false; // instanced interiors: flat floors
  if (
    x > WORLD_MAX_X - 40 ||
    x < WORLD_MIN_X + 40 ||
    z < WORLD_MIN_Z + 40 ||
    z > WORLD_MAX_Z - 40
  ) {
    return true; // within the world rim's margin
  }
  for (const edge of BORDER_EDGES) {
    const sigma = edge.sealed ? SEALED_RIDGE_SIGMA : RIDGE_SIGMA;
    if (Math.abs((edge.kind === 'h' ? z : x) - edge.at) >= sigma * 4) continue;
    const along = edge.kind === 'h' ? x : z;
    if (edge.fullRow || (along >= edge.lo - 24 && along <= edge.hi + 24)) return true;
  }
  return false;
}

// Unit downhill direction at (x, z), or null on (near-)flat ground. Drives the
// slide that carries a player off ground steeper than the climb limit.
export function terrainDownhill(
  x: number,
  z: number,
  seed: number,
): { x: number; z: number } | null {
  const e = STEEPNESS_SAMPLE;
  const hx = (groundHeight(x + e, z, seed) - groundHeight(x - e, z, seed)) / (2 * e);
  const hz = (groundHeight(x, z + e, seed) - groundHeight(x, z - e, seed)) / (2 * e);
  const mag = Math.hypot(hx, hz);
  if (mag < 1e-6) return null;
  return { x: -hx / mag, z: -hz / mag };
}

// Ring samples for the wall standoff below. 8 covers the body circle evenly
// without being a hot-loop cost (the caller only runs it for grounded overworld
// players).
const WALL_STANDOFF_SAMPLES = 8;

// A single ring-sample-and-nudge pass, capped at one body radius of push (see
// `terrainWallStandoff` below for why it must be iterated rather than trusted
// to converge in one call, and why the caller must accept a push that only
// REDUCES steepness rather than requiring it clear `maxSlope` outright).
export function terrainWallStandoffPass(
  x: number,
  z: number,
  seed: number,
  radius: number,
  maxSlope: number,
): { x: number; z: number } {
  const h0 = groundHeight(x, z, seed);
  const wallRise = radius * maxSlope; // the most a climbable slope rises over `radius`
  let pushX = 0;
  let pushZ = 0;
  for (let k = 0; k < WALL_STANDOFF_SAMPLES; k++) {
    const a = (k / WALL_STANDOFF_SAMPLES) * Math.PI * 2;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const rise = groundHeight(x + sx * radius, z + sz * radius, seed) - h0;
    if (rise > wallRise) {
      // horizontal setback that would make this direction merely climbable,
      // capped at the body radius (a face closer than `radius` reads as a huge
      // rise; one exactly at `radius` contributes nothing)
      const setback = Math.min((rise - wallRise) / maxSlope, radius);
      pushX -= sx * setback;
      pushZ -= sz * setback;
    }
  }
  if (pushX === 0 && pushZ === 0) return { x, z };
  const mag = Math.hypot(pushX, pushZ);
  const scale = Math.min(mag, radius) / mag; // total nudge never exceeds one body radius
  return { x: x + pushX * scale, z: z + pushZ * scale };
}

// The most passes `terrainWallStandoff` will take to converge. Mirrors the
// 3-iteration prop/OBB push-out loop in `colliders.ts`'s `resolveAgainst`.
const WALL_STANDOFF_ITERATIONS = 3;

// Push a body of `radius` out of terrain steeper than `maxSlope` so the
// character model does not sink into a cliff face. Movement collision samples
// only the center point (the climb gate blocks the center from CLIMBING a wall,
// but nothing keeps the body's WIDTH clear of one), so standing at or strafing
// along the foot of a near-vertical wall buries the model's near side. This
// samples the heightfield on a ring at the body radius; any direction rising
// faster than a climbable slope is a wall within reach, and the center is nudged
// directly away from it, toward the lower walkable side. Pure and deterministic;
// returns the input unchanged on open or merely-sloped ground (no ring sample
// exceeds a climbable rise there), so it is a near-no-op away from the walls.
//
// A single pass can leave the pushed point still reading as a wall in a
// CONCAVE pocket (a ridge/rim corner or a coastline notch wrapping more than
// half the sample ring): one pass's push, capped at one body radius, is not
// always enough to clear it. The caller (`stepPlayerMotion`) only ever
// committed the result when it stopped reading as steep, so an unconverged
// single pass silently no-ops right where standoff is needed most, leaving
// the player permanently wedged. Iterating a few passes lets each subsequent
// ring sample, now centered on the partially-pushed point, see less of the
// wall, converging out of the pocket instead of stalling on it.
export function terrainWallStandoff(
  x: number,
  z: number,
  seed: number,
  radius: number,
  maxSlope: number,
): { x: number; z: number } {
  let cx = x;
  let cz = z;
  for (let iter = 0; iter < WALL_STANDOFF_ITERATIONS; iter++) {
    const next = terrainWallStandoffPass(cx, cz, seed, radius, maxSlope);
    if (next.x === cx && next.z === cz) break;
    cx = next.x;
    cz = next.z;
  }
  return { x: cx, z: cz };
}

// ---------------------------------------------------------------------------
// Natural roads. The authored ROADS are sparse waypoint polylines; drawn raw
// they read as ruler segments with kinks at every joint. Each road is
// densified ONCE through a centripetal-flavored Catmull-Rom spline so it
// flows as a curve through its waypoints (shared endpoints stay shared, so
// junctions remain seamless), and the query point gets a gentle fixed-seed
// meander so long reaches wander like a worn track instead of a survey line.
// Everything that reads roadDistance (the terrain splat, the map painter,
// decoration/terrace suppression) inherits the same curves together.
// ---------------------------------------------------------------------------
interface SmoothRoad {
  pts: { x: number; z: number }[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const ROAD_SAMPLE_STEP = 5; // yd between densified points
const ROAD_MEANDER = 7; // full meander swing of the query warp (yd)
const ROAD_BBOX_MARGIN = 24; // covers the meander plus every consumer's reach

function catmullRom(
  p0: { x: number; z: number },
  p1: { x: number; z: number },
  p2: { x: number; z: number },
  p3: { x: number; z: number },
  t: number,
): { x: number; z: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z:
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
}

const SMOOTH_ROADS: SmoothRoad[] = ROADS.map((road) => {
  const pts: { x: number; z: number }[] = [];
  if (road.length < 2) {
    pts.push(...road);
  } else {
    for (let i = 0; i < road.length - 1; i++) {
      const p0 = road[Math.max(0, i - 1)];
      const p1 = road[i];
      const p2 = road[i + 1];
      const p3 = road[Math.min(road.length - 1, i + 2)];
      const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const steps = Math.max(1, Math.ceil(segLen / ROAD_SAMPLE_STEP));
      for (let k = 0; k < steps; k++) pts.push(catmullRom(p0, p1, p2, p3, k / steps));
    }
    pts.push(road[road.length - 1]);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return {
    pts,
    minX: minX - ROAD_BBOX_MARGIN,
    maxX: maxX + ROAD_BBOX_MARGIN,
    minZ: minZ - ROAD_BBOX_MARGIN,
    maxZ: maxZ + ROAD_BBOX_MARGIN,
  };
});

// Distance from (x,z) to the nearest road curve.
export function roadDistance(x: number, z: number): number {
  // cheap first: most queries are nowhere near a road, so gate on the raw
  // bboxes (their margin already covers the meander) before paying for the
  // warp noise or any segment math
  let anyNear = false;
  for (const road of SMOOTH_ROADS) {
    if (x >= road.minX && x <= road.maxX && z >= road.minZ && z <= road.maxZ) {
      anyNear = true;
      break;
    }
  }
  if (!anyNear) return Infinity;
  // the meander: warp the query, and the whole road wanders in response
  const wx = x + (fbm2(x * 0.045, z * 0.045, 9203, 2) - 0.5) * ROAD_MEANDER;
  const wz = z + (fbm2(x * 0.045 + 37, z * 0.045 - 11, 9205, 2) - 0.5) * ROAD_MEANDER;
  let best2 = Infinity;
  for (const road of SMOOTH_ROADS) {
    if (wx < road.minX || wx > road.maxX || wz < road.minZ || wz > road.maxZ) continue;
    const pts = road.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const apx = wx - a.x;
      const apz = wz - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apz * abz) / len2)) : 0;
      const dx = apx - abx * t;
      const dz = apz - abz * t;
      const d2 = dx * dx + dz * dz;
      if (d2 < best2) best2 = d2;
    }
  }
  return Math.sqrt(best2);
}

// Deterministic decoration placement (trees, rocks) — used by the renderer,
// kept here so it shares the seed and stays out of mob camps / hubs / roads /
// lakes. Density and mix vary by biome: the vale is wooded, the marsh sparse
// and scrubby, the peaks rocky with hardy pines.
export interface Decoration {
  kind: 'tree' | 'tree2' | 'rock';
  x: number;
  z: number;
  scale: number;
  variant: number;
  biome: BiomeId;
}

const DECORATION_EXCLUSION_RADIUS = 1.2;
const DECORATION_EXCLUSIONS = [{ x: 2.456450840458274, z: 211.33819991815835 }];

function isExcludedDecoration(x: number, z: number): boolean {
  return DECORATION_EXCLUSIONS.some(
    (p) => Math.hypot(x - p.x, z - p.z) < DECORATION_EXCLUSION_RADIUS,
  );
}

export function zoneBiomeAt(x: number, z: number): BiomeId {
  let fallback: { biome: BiomeId; zMax: number } | null = null;
  let northmost = ZONES[0];
  for (const zone of ZONES) {
    if (zone.zMax > northmost.zMax) northmost = zone;
    if (z >= zone.zMax) continue;
    if (fallback === null || zone.zMax < fallback.zMax) {
      fallback = { biome: zone.biome, zMax: zone.zMax }; // southmost band containing z
    }
    const x0 = zone.xMin ?? STRIP_MIN_X;
    const x1 = zone.xMax ?? STRIP_MAX_X;
    if (z >= zone.zMin && x >= x0 && x < x1) return zone.biome;
  }
  return fallback ? fallback.biome : northmost.biome;
}

// Paint grid id -> biome. APPEND-ONLY: the id is persisted in map documents.
export const BIOME_BY_ID: BiomeId[] = [
  'vale',
  'marsh',
  'peaks',
  'beach',
  'desert',
  'volcano',
  'cave',
];

// The persisted paint id at (x,z), including custom swatches. Renderers that
// support custom textures need the raw id rather than the built-in biome below.
export function paintedCellIdAt(x: number, z: number): number | null {
  const bp = getActiveWorldContent().biomePaint;
  if (!bp) return null;
  const c = Math.floor((x - bp.originX) / bp.cell);
  const r = Math.floor((z - bp.originZ) / bp.cell);
  if (c < 0 || c >= bp.cols || r < 0 || r >= bp.rows) return null;
  const id = bp.ids[r * bp.cols + c];
  return id === 255 ? null : id;
}

// The painted biome at (x,z), or null if unpainted / no paint layer. Cheap grid
// lookup; absent for the built-in world (getActiveWorldContent has no biomePaint).
function paintedBiomeAt(x: number, z: number): BiomeId | null {
  const id = paintedCellIdAt(x, z);
  if (id === null) return null;
  return id >= 0 && id < BIOME_BY_ID.length ? BIOME_BY_ID[id] : null;
}

// Biome at a world point: the painted override if any (map editor), else the
// zone-band biome. This is the 2D biome the renderer colours by; zoneBiomeAt
// stays the grid version. With no paint layer this equals zoneBiomeAt(x, z).
export function biomeAt(x: number, z: number): BiomeId {
  return paintedBiomeAt(x, z) ?? zoneBiomeAt(x, z);
}

// Scatter props (trees, boulders) are anchored to terrainHeight at their exact
// (x, z). On a near-vertical rim/ridge wall a prop juts out of the face and
// reads as floating, and (via colliders.ts) a large rock or trunk there is also
// an invisible collider on the cliff. Reject any candidate whose local terrain
// is steeper than this: it matches PLAYER_MAX_CLIMB_SLOPE (the impassable-wall
// gate), so only genuine walls are cleared and rolling interior hills keep
// their props. Grass and ground dressing already refuse cliffs the same way
// (foliage.ts tooSteep / GRASS_MAX_SLOPE); this brings the big props in line.
// Pinned as a literal by tests/fixes.test.ts.
export const DECORATION_MAX_SLOPE = 1.5;

const DECORATION_STEP = 10;
const DECORATION_X_START = -(WORLD_MAX_X - 14);
const DECORATION_X_END = WORLD_MAX_X - 14;
const DECORATION_Z_START = WORLD_MIN_Z + 14;
const DECORATION_Z_END = WORLD_MAX_Z - 14;
const DECORATION_JITTER = DECORATION_STEP / 2;

// Evaluate one stable decoration-grid anchor. Keeping every gate in this one
// function lets the renderer enumerate the whole field while collision asks
// only for the handful of anchors near a queried spatial cell. The latter is
// important now that the world spans multiple columns: eagerly rebuilding the
// entire field in every isolated test worker made the first Sim in each file
// pay for thousands of terrain samples it never touched.
function decorationAt(seed: number, gx: number, gz: number): Decoration | null {
  const r = hash2(Math.round(gx), Math.round(gz), seed + 31);
  const biome = zoneBiomeAt(gx, gz);
  // density gate + kind mix per biome
  let kind: Decoration['kind'] | null = null;
  if (biome === 'vale') {
    if (r > 0.48) return null;
    kind = r < 0.3 ? 'tree' : r < 0.4 ? 'tree2' : 'rock';
  } else if (biome === 'marsh') {
    if (r > 0.34) return null;
    kind = r < 0.08 ? 'tree' : r < 0.26 ? 'tree2' : 'rock';
  } else if (biome === 'dusk') {
    // the hollow is a glade: sparse pines, more twisted elders and stone;
    // the dense mushroom flora comes from ground dressing and realm props
    if (r > 0.38) return null;
    kind = r < 0.14 ? 'tree' : r < 0.28 ? 'tree2' : 'rock';
  } else if (biome === 'ember') {
    // the gatewood thins mile by mile into open waste: trees fade out
    // northward, scorched rock takes over
    const t = Math.max(0, Math.min(1, (gz - 1560) / 170));
    const treeGate = 0.36 * (1 - t) + 0.05 * t;
    if (r > treeGate + 0.12 + t * 0.1) return null; // rockier as the waste opens
    kind = r < treeGate * 0.55 ? 'tree' : r < treeGate ? 'tree2' : 'rock';
  } else if (biome === 'frost') {
    // hardy pines and broken stone on the snow benches
    if (r > 0.36) return null;
    kind = r < 0.18 ? 'tree' : r < 0.23 ? 'tree2' : 'rock';
  } else if (biome === 'amber') {
    // a dense fire-colored weald, broadleaf-heavy
    if (r > 0.5) return null;
    kind = r < 0.12 ? 'tree' : r < 0.42 ? 'tree2' : 'rock';
  } else if (biome === 'fen') {
    // open and soft: scattered broadleafs, very little stone
    if (r > 0.3) return null;
    kind = r < 0.06 ? 'tree' : r < 0.26 ? 'tree2' : 'rock';
  } else if (biome === 'night') {
    // open moon meadows: sparse silvered groves, standing stones between
    if (r > 0.28) return null;
    kind = r < 0.08 ? 'tree' : r < 0.2 ? 'tree2' : 'rock';
  } else if (biome === 'haunt') {
    // the densest forest in the world: the canopy is the realm
    if (r > 0.62) return null;
    kind = r < 0.3 ? 'tree' : r < 0.54 ? 'tree2' : 'rock';
  } else if (biome === 'jungle') {
    // wall-to-wall broadleaf inland; the palms on the beaches are the
    // render module's (this grid skips the low sand shelf below)
    if (terrainHeight(gx, gz, seed) < 3) return null;
    if (r > 0.58) return null;
    kind = r < 0.1 ? 'tree' : r < 0.5 ? 'tree2' : 'rock';
  } else if (biome === 'garden') {
    // open parkland: sparse specimen trees on the lawns, and the maze
    // keeps its corridors clear (the hedges are terrain, not dressing)
    if (inGardenMaze(gx, gz)) return null;
    if (r > 0.3) return null;
    kind = r < 0.16 ? 'tree' : r < 0.2 ? 'tree2' : 'rock';
  } else if (biome === 'gale') {
    // wind-scoured downs: rock outcrops everywhere, trees almost never
    // (what survives grows stunted in the render dressing)
    if (r > 0.22) return null;
    kind = r < 0.04 ? 'tree' : r < 0.07 ? 'tree2' : 'rock';
  } else {
    if (r > 0.44) return null;
    kind = r < 0.2 ? 'tree' : r < 0.24 ? 'tree2' : 'rock';
  }
  // grid cells outside every zone rect are open sea between columns
  let inRect = false;
  for (const zn of ZONES) {
    if (gz < zn.zMin || gz >= zn.zMax) continue;
    if (gx < (zn.xMin ?? STRIP_MIN_X) || gx >= (zn.xMax ?? STRIP_MAX_X)) continue;
    inRect = true;
    break;
  }
  if (!inRect) return null;
  const ox = (hash2(Math.round(gx), Math.round(gz), seed + 57) - 0.5) * DECORATION_STEP;
  const oz = (hash2(Math.round(gx), Math.round(gz), seed + 91) - 0.5) * DECORATION_STEP;
  const x = gx + ox,
    z = gz + oz;
  if (isExcludedDecoration(x, z)) return null;
  // The Sowfield stadium footprint grows no trees or rocks (hash-based
  // placement, so skipping here shifts no other decoration or rng draw).
  if (isInSowfieldShell(x, z)) return null;
  for (const zone of ZONES) {
    const dx = x - zone.hub.x,
      dz = z - zone.hub.z;
    if (Math.sqrt(dx * dx + dz * dz) < zone.hub.radius + 4) return null;
  }
  if (terrainHeight(x, z, seed) < WATER_LEVEL + 1) return null;
  if (roadDistance(x, z) < 5) return null;
  for (const c of CAMPS) {
    const dx = x - c.center.x,
      dz = z - c.center.z;
    if (Math.sqrt(dx * dx + dz * dz) < c.radius + 3) return null;
  }
  // no scatter on cliff faces: a prop anchored to the surface here floats
  // off the wall (and large ones would be phantom colliders). Checked last,
  // after the cheaper gates, so the four-sample steepness only runs for
  // candidates that survive everything else.
  if (terrainSteepness(x, z, seed) > DECORATION_MAX_SLOPE) return null;
  return {
    kind,
    x,
    z,
    scale: 0.7 + hash2(Math.round(gx), Math.round(gz), seed + 13) * 0.9,
    variant: Math.floor(hash2(Math.round(gx), Math.round(gz), seed + 77) * 3),
    biome,
  };
}

function decorationAnchorCount(start: number, end: number): number {
  return Math.max(0, Math.ceil((end - start) / DECORATION_STEP));
}

function appendDecorationRange(
  out: Decoration[],
  seed: number,
  xFirst: number,
  xEnd: number,
  zFirst: number,
  zEnd: number,
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number },
): void {
  for (let xi = xFirst; xi < xEnd; xi++) {
    const gx = DECORATION_X_START + xi * DECORATION_STEP;
    for (let zi = zFirst; zi < zEnd; zi++) {
      const gz = DECORATION_Z_START + zi * DECORATION_STEP;
      const decoration = decorationAt(seed, gx, gz);
      if (!decoration) continue;
      if (
        bounds &&
        (decoration.x < bounds.minX ||
          decoration.x > bounds.maxX ||
          decoration.z < bounds.minZ ||
          decoration.z > bounds.maxZ)
      ) {
        continue;
      }
      out.push(decoration);
    }
  }
}

/**
 * Return the exact subset of the deterministic decoration field whose centers
 * fall inside `bounds`. Candidate anchors include the full placement jitter,
 * so filtering this result is byte-for-byte equivalent to filtering
 * `generateDecorations(seed)` without paying to evaluate the other realms.
 */
export function generateDecorationsInBounds(
  seed: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): Decoration[] {
  if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) return [];
  const xCount = decorationAnchorCount(DECORATION_X_START, DECORATION_X_END);
  const zCount = decorationAnchorCount(DECORATION_Z_START, DECORATION_Z_END);
  const first = (value: number, start: number, count: number): number =>
    Math.max(0, Math.min(count, Math.ceil((value - DECORATION_JITTER - start) / DECORATION_STEP)));
  const end = (value: number, start: number, count: number): number =>
    Math.max(
      0,
      Math.min(count, Math.floor((value + DECORATION_JITTER - start) / DECORATION_STEP) + 1),
    );
  const xFirst = first(bounds.minX, DECORATION_X_START, xCount);
  const xEnd = end(bounds.maxX, DECORATION_X_START, xCount);
  const zFirst = first(bounds.minZ, DECORATION_Z_START, zCount);
  const zEnd = end(bounds.maxZ, DECORATION_Z_START, zCount);
  const out: Decoration[] = [];
  appendDecorationRange(out, seed, xFirst, xEnd, zFirst, zEnd, bounds);
  return out;
}

export function generateDecorations(seed: number): Decoration[] {
  if (getActiveWorldContent().decorationsMode === 'empty') return [];
  const out: Decoration[] = [];
  appendDecorationRange(
    out,
    seed,
    0,
    decorationAnchorCount(DECORATION_X_START, DECORATION_X_END),
    0,
    decorationAnchorCount(DECORATION_Z_START, DECORATION_Z_END),
  );
  return out;
}
