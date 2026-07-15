// The map-editor application coordinator. Thin by design: layout assembly,
// tool state, the undo stack, and event routing live here; everything with a
// nameable responsibility is a sibling module (topbar, toolbar, inspector,
// asset_browser, map_drawer, map_io, net, toasts, undo_core, stamp_core,
// user_assets, the 3D viewport, and the 2D canvas/view/model trio).
//
// Ownership of the ACTIVE world content: the app builds ONE WorldContent whose
// terrainEdits / biomePaint / zones / camps tables SHARE references with the
// working document, registers it via setActiveWorldContent, and every terrain
// sample (renderer chunks, procgen, smooth/flatten sampling) reads through it.

import { audio } from '../game/audio';
import { music } from '../game/music';
import { Settings } from '../game/settings';
import {
  groundTextureUrl,
  loadGroundTextureBytes,
  storeGroundTexture,
} from '../render/assets/ground_textures';
import { loadSkyboxBytes, resolveSkyboxUrl, storeSkybox } from '../render/assets/skyboxes';
import {
  EDITOR_LIGHTING_DAY,
  EDITOR_LIGHTING_PRESETS,
  type EditorLightingProfile,
} from '../render/editor_lighting';
import {
  DEFAULT_TEXTURE_TILE_YD,
  rebakePaintFieldSwatches,
  refreshCustomGroundTextures,
  refreshTerrainHoles,
} from '../render/terrain';
import {
  CAVE_MAX_MULT,
  CAVE_MAX_RADIUS,
  CAVE_MIN_MULT,
  CAVE_MIN_RADIUS,
  CAVE_SPIKE_SIZE_MAX,
  CAVE_SPIKE_SIZE_MIN,
  caveBounds,
  HOLE_MAX_RADIUS,
  HOLE_MIN_RADIUS,
  holeBounds,
  MAX_CAVES,
  MAX_HOLE_PATCHES,
  MAX_TERRAIN_HOLES,
} from '../sim/caves';

// Reserved marker assetIds for the cave rig flow. Ordinary placements
// (gizmo-movable, undoable, saved); placement.name carries the shared cave id.
const CAVE_ENTRANCE_ASSET_ID = 'cave/entrance';
const CAVE_EXIT_ASSET_ID = 'cave/exit';
// Blue rig waypoint between the entrance and the exit (Caves tool clicks
// after the first). The rig's LAST point acts as the exit.
const CAVE_POINT_ASSET_ID = 'cave/point';
// Control-point cap per rig (the generated node chain has its own sim cap).
const MAX_CAVE_RIG_POINTS = 24;
// Organic wobble a fresh cave generates with (Cave card slider re-bores).
const DEFAULT_CAVE_VARIANCE = 0.35;

/** Deterministic per-cave wobble seed from its id (stable across regens). */
function caveWobbleSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100000;
  return h;
}

import { rockSeed } from '../render/rock_gen';
import { builtinShaFor, terrainTextureSet } from '../render/terrain_texture_sets';
import { ASSET_COLLISION } from '../sim/asset_collision.generated';
import {
  COLLIDER_ASSET_IDS,
  type ColliderVolumeKind,
  colliderKindFor,
  colliderVolumeFromPlacement,
} from '../sim/collider_volumes';
import { invalidateStaticColliders } from '../sim/colliders';
import { BUILTIN_WORLD, MOBS, PLAYER_START, setActiveWorldContent } from '../sim/data';
import {
  FLUID_ASSET_IDS,
  FLUID_DEFAULT_OFFSET_Y,
  FLUID_DEFAULT_SIZE,
  type FluidKind,
  fluidKindFor,
  fluidVolumesFromPlacements,
} from '../sim/fluid_volumes';
import {
  type CollisionMode,
  CUSTOM_PAINT_ID_MAX,
  CUSTOM_PAINT_ID_MIN,
  clampBlockerSegment,
  collideRadiusFor,
  DEFAULT_ASSET_VIEW_DISTANCE,
  effectiveCollisionMode,
  GRASS_PATCH_ASSET_ID,
  MAX_ASSET_COLLISION_MESH_BOXES,
  MAX_ASSET_VIEW_DISTANCE,
  MAX_AXIS_SCALE,
  MAX_BLOCKERS,
  MAX_COLLIDE_RADIUS,
  MAX_COLLIDER_SIZE,
  MAX_COLLIDER_SIZE_Y,
  MAX_CUSTOM_PAINT_SWATCHES,
  MAX_LIGHTS,
  MAX_LOCATION_NAME,
  MAX_LOCATIONS,
  MAX_MARKERS,
  MAX_MUSIC_AREAS,
  MAX_PLACEMENT_HITBOXES,
  MAX_PLACEMENT_NAME_LENGTH,
  MAX_PLACEMENT_Y_OFFSET,
  MAX_PLACEMENTS,
  MAX_POINT_SOUNDS,
  MAX_ROCK_NODES,
  MAX_SWATCH_LABEL_LENGTH,
  MAX_TERRAIN_EDITS,
  MAX_TIME_SCALE,
  MAX_WEATHER_SCHEDULE,
  type MapHitbox,
  MIN_ASSET_VIEW_DISTANCE,
  MIN_AXIS_SCALE,
  MIN_COLLIDE_RADIUS,
  MIN_COLLIDER_SIZE,
  MIN_COLLIDER_SIZE_Y,
  MIN_TIME_SCALE,
  ROCK_ASSET_ID,
  ROCK_POINT_ASSET_ID,
  ROCK_RIDGE_ASSET_ID,
  WATERFALL_ASSET_ID,
} from '../sim/map_doc';
import {
  type BiomePaint,
  type BlockerDef,
  type CampDef,
  type CaveDef,
  type CaveNode,
  type CustomPaintSwatch,
  emptyZoneProps,
  type HeightStamp,
  type MapWeather,
  type TerrainHole,
  type TerrainStyle,
  type WorldContent,
} from '../sim/types';
import { invalidateTerrainEditIndex, terrainHeight, WATER_LEVEL, waterLevel } from '../sim/world';
import { tEntity } from '../ui/entity_i18n';
import { formatNumber, t } from '../ui/i18n';
import { Editor3DViewport, type GizmoHitboxChange } from './3d/viewport';
import { AssetBrowser } from './asset_browser';
import { ASSET_CATALOG, assetById } from './asset_catalog.generated';
import { finestPaintCell, resampleBiomePaint } from './biome_paint_core';
import { nearestBlockerIndex } from './blocker_core';
import { brushAlphaById, importBrushAlpha, sampleBrushAlpha } from './brush_alphas';
import { buildMapBundle, zipStore } from './bundle';
import { draw } from './canvas';
import { generateCaveRigNodes } from './cave_gen_core';
import {
  type AssetPlacement,
  CUSTOM_MAP_VERSION,
  type CustomMap,
  customMapToWorldContent,
  effectiveCollideRadius,
  newCustomMap,
  newFlatCustomMap,
} from './custom_map';
import { button, checkbox, el, slider } from './dom';
import { clampToCap } from './edit_caps_core';
import {
  isMovableEntity,
  pickMovableEntity,
  splitCampIntoIndividuals,
  toggledMobSelection,
} from './entity_edit_core';
import { downloadMap, pickMapOrBundle } from './file_io';
import { bakeImportedModelCollision, bakeTrueModelCollision } from './import_collision';
import {
  BIOME_OPTIONS,
  Inspector,
  type PlacementSelection,
  type ResolvedWeather,
} from './inspector';
import {
  isLocalAssetId,
  localAssetIdFor,
  localAssetLabel,
  localAssetUrl,
  registerLocalAsset,
} from './local_assets';
import { loadStoredLocalAssets, storeLocalAssetBytes } from './local_assets_db';
import { MapDrawer } from './map_drawer';
import { MapIO } from './map_io';
import {
  buildEntities,
  type EditorEntity,
  type EntityKind,
  snapshot,
  type ZoneContent,
} from './model';
import { EditorApiError, forkMap, type MapFullWire, signedIn, uploadAsset } from './net';
import { newMapSizeDialog } from './new_map_dialog';
import { parseMap } from './persist';
import {
  CommitCoalescer,
  groupMemberPoint,
  NORTH_UP_YAW,
  NUDGE_STEP_BIG_YD,
  NUDGE_STEP_YD,
  type NudgeKey,
  nudgeDelta,
  PLACEMENT_SCALE_MAX,
  PLACEMENT_SCALE_MIN,
  rotateStep,
  scaleStep,
  wrapAngle,
} from './placement_transform_core';
import {
  clearPlaytestRecoveryDraft,
  DEFAULT_PLAYTEST_SEED,
  launchPlaytest,
  loadPlaytestRecoveryDraft,
  PLAYTEST_RESUME_KEY,
  savePlaytestRecoveryDraft,
} from './playtest';
import { DEFAULT_POINT_SOUND } from './point_sounds';
import { type Bounds, makeRng, scatterHills, scatterPlacements } from './procgen';
import { EditGeneration, shouldAutosave } from './save_lifecycle_core';
import { editorErrorKey } from './server_errors_core';
import { createShippedMap } from './shipped_maps';
import { appendSpan, removeSpan } from './span_core';
import {
  erasePlacementIndex,
  flattenStamp,
  SCULPT_POWER_SCALE,
  smoothStamp,
  stampRegion,
  unionRegion,
} from './stamp_core';
import { buildModal, confirmDialog, promptDialog, Toasts } from './toasts';
import { type EditorTool, TOOL_BY_KEY, Toolbar } from './toolbar';
import { Topbar } from './topbar';
import { EditorTutorial } from './tutorial';
import { UndoStack } from './undo_core';
import {
  isUserAssetId,
  registerUserAssets,
  userAssetIdFor,
  userAssetLabel,
  userAssetPath,
} from './user_assets';
import { Camera, pickHandle, type ScreenPoint, type Vec2, type Viewport } from './view';
import { promoteMajorWorldProps, withoutMajorWorldProps } from './world_prop_placements';

const KINDS: EntityKind[] = ['hub', 'graveyard', 'lake', 'poi', 'camp', 'npc', 'object'];

/** The Blender-style transform trio; they keep (and require) a selection, and
 *  drive it through the same drag machinery as Select-mode direct move. */
function isTransformTool(tool: EditorTool): tool is 'move' | 'rotate' | 'scale' {
  return tool === 'move' || tool === 'rotate' || tool === 'scale';
}

/** Tools that select and manipulate placements (Select is pick-only). */
function isSelectionTool(tool: EditorTool): boolean {
  return tool === 'select' || isTransformTool(tool);
}

/** The terrain sculpt family: these route to the stroke pipeline, and holding
 *  Shift while stroking applies the OPPOSITE sub-mode (raise<->lower,
 *  smooth<->flatten). */
function isSculptTool(tool: EditorTool): boolean {
  return tool === 'raise' || tool === 'lower' || tool === 'smooth' || tool === 'flatten';
}
// The built-in meadow grass's perceived blade hue/lightness (render
// grass_patch.ts DEFAULT_HUE / TINT_L): the foliage brush's defaults, so
// painted grass matches ambient until the maker themes it. Lightness is a
// percent for the slider; clump is tufts per patch.
const GRASS_DEFAULT_HUE = 105;
const GRASS_DEFAULT_LIGHT = 55;
const GRASS_DEFAULT_CLUMP = 16;
const AUTOSAVE_MS = 30_000;
// Unconditional periodic full save of the current map's stored JSON (the
// local map store), independent of the opt-in autosave toggle.
const LOCAL_SAVE_MS = 600_000;
const AUTOSAVE_PREF_KEY = 'woc_editor_autosave';
const FREE_FLY_PREF_KEY = 'woc_editor_freefly';
const SHOW_BOUNDARY_PREF_KEY = 'woc_editor_show_boundary';
const BIRDS_PREF_KEY = 'woc_editor_birds';
const INVERT_PAN_PREF_KEY = 'woc_editor_invert_pan';
const SHOW_PLAYER_PREF_KEY = 'woc_editor_show_player';
const LIGHTING_PREF_KEY = 'woc_editor_lighting';
const CAMERA_SPEEDS_PREF_KEY = 'woc_editor_camera_speeds';
const HIDE_COLLIDERS_PREF_KEY = 'woc_editor_hide_colliders';
const HIDE_LOCATIONS_PREF_KEY = 'woc_editor_hide_locations';
const PERF_OVERLAY_PREF_KEY = 'woc_editor_perf_overlay';
const WIREFRAME_PREF_KEY = 'woc_editor_wireframe';
// Collision hitbox overlay: ON by default (a stored '0' keeps it off).
const FOOTPRINTS_PREF_KEY = 'woc_editor_show_hitboxes';
// Per-asset hand-edited hitbox presets (this device only): new placements of
// an asset copy its saved boxes.
const HITBOX_PRESETS_PREF_KEY = 'woc_editor_hitbox_presets';
const WATER_DEBOUNCE_MS = 100;

/** Boolean editor preference read; blocked storage reads as off. */
function readPref(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Boolean preference that defaults ON: only an explicit stored '0' turns it
 *  off (unset or blocked storage reads as on). */
function readPrefDefaultOn(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

/** Boolean editor preference write; blocked storage keeps the session value. */
function writePref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Blocked storage: the toggle still works for this session.
  }
}

/** JSON preference write; blocked storage keeps the setting session-only. */
function writeJsonPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* session-only */
  }
}

/** JSON preference read, or null on blocked storage / malformed value. */
function readJsonPref<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

interface RegionBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
interface Clipboard {
  placements: AssetPlacement[]; // relative to center
  edits: HeightStamp[]; // relative to center
}

interface PlaytestRestore {
  map: CustomMap;
  dirty: boolean;
}

const LAYER_KEYS: Record<EntityKind, string> = {
  hub: 'editor.layers.hub',
  graveyard: 'editor.layers.graveyard',
  lake: 'editor.layers.lake',
  poi: 'editor.layers.poi',
  camp: 'editor.layers.camp',
  npc: 'editor.layers.npc',
  object: 'editor.layers.object',
};

const BRUSH_COLOR: Partial<Record<EditorTool, number>> = {
  raise: 0xffd100,
  lower: 0x5aa0ff,
  smooth: 0x9fdc7f,
  flatten: 0xd8c27a,
  erase: 0xe0503c,
  place: 0x3fd0ff,
  foliage: 0x69d84f,
  collider: 0x3ddc6a,
  camp: 0xd9534f,
  spawn: 0x3fd0ff,
};

export class EditorApp {
  // ---- document + active world ------------------------------------------------
  private map: CustomMap;
  private activeWorld!: WorldContent;
  private content: ZoneContent;
  private entities: EditorEntity[];
  private base: Map<string, Vec2>;

  // ---- chrome -------------------------------------------------------------------
  private readonly topbar: Topbar;
  private readonly toolbar: Toolbar;
  private readonly inspector: Inspector;
  private readonly assets: AssetBrowser;
  private readonly drawer: MapDrawer;
  private readonly toasts: Toasts;
  private readonly tutorial: EditorTutorial;

  // ---- stage -----------------------------------------------------------------
  private readonly stage2d: HTMLElement;
  private readonly stage3dEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cam = new Camera({ x: 0, z: 0 }, 2);
  private viewMode: '3d' | '2d' = '3d';
  private viewport3d: Editor3DViewport | null = null;
  private markerMovedWhile2d = false;

  // ---- editing state -----------------------------------------------------------
  private tool: EditorTool = 'select';
  private brushRadius = 18;
  // Sculpt strength SLIDER value (1..50). The height math consumes it divided
  // by BRUSH_STRENGTH_SCALE, so every step is a fifth of the legacy 1..30
  // scale's ? fine control at the low end without losing the old ceiling
  // (50/5 = 10; the default 30/5 = 6 matches the legacy default of 6).
  private brushStrength = 30;
  private paintBiome = 1;
  private flattenHardEdge = false;
  private placeAssetId: string | null = null;
  private placeAssetLabel: string | null = null;
  private placeScale = 1;
  // Placed assets collide by default (baked hitboxes); uncheck to opt out.
  private placeCollide = true;
  private placeRandomRot = true;
  private scatterCount = 80;
  private campMobId: string = Object.keys(MOBS)[0] ?? 'boar';
  private colliderShape: ColliderVolumeKind = 'box';
  // Foliage brush settings + per-stroke buffer (one undo entry per stroke).
  private foliage = {
    density: 3,
    minScale: 0.7,
    maxScale: 1.6,
    collide: false,
    // Animated grass-tuft patches (the built-in world's grass cards) + their
    // theme color (hue in degrees, lightness in percent) and clump size
    // (tufts per patch, 1 = single strands); the GLB families follow.
    grass: true,
    grassHue: GRASS_DEFAULT_HUE,
    grassLight: GRASS_DEFAULT_LIGHT,
    grassClump: GRASS_DEFAULT_CLUMP,
    ferns: true,
    bushes: true,
    trees: true,
    rocks: false,
  };
  // Custom foliage brush asset: when set, the foliage brush scatters ONLY this
  // catalogue/uploaded asset (with the same density/scale/collide controls)
  // instead of the built-in group pool. Null = the built-in behaviour.
  private foliageCustom: { assetId: string; label: string } | null = null;
  private foliageStroke: AssetPlacement[] = [];
  private foliageStart = 0;
  private foliageLast: Vec2 | null = null;
  private foliageCapWarned = false;
  private foliagePoolWarned = false;
  /** The user's MANUAL footprint-overlay toggle; the effective overlay also
   *  forces on while authoring collision (see syncFootprintOverlay). ON by
   *  default and persisted (Options): placed hitboxes are visible out of the
   *  box so collision is never a surprise. */
  private footprintsOn = readPrefDefaultOn(FOOTPRINTS_PREF_KEY);
  // Per-asset hitbox presets (localStorage): assetId -> normalized boxes.
  private hitboxPresets: Record<string, MapHitbox[]> =
    readJsonPref<Record<string, MapHitbox[]>>(HITBOX_PRESETS_PREF_KEY) ?? {};
  // Hitbox edit mode: individual baked boxes of ONE placement become
  // selectable/transformable objects (Shift/Ctrl+click multi-select).
  private hitboxEdit: { index: number; selected: Set<number> } | null = null;
  // Snapshot of the boxes at gizmo-gesture start (one undo entry per gesture).
  private hitboxDragBase: MapHitbox[] | null = null;
  // Assets whose "true collision" fine bake is currently running.
  private readonly meshBakesInFlight = new Set<string>();
  // Camera preferences (persisted): Free-Fly navigation and inverted drag-pan.
  // Free-Fly is ON by default (WASD/QE fly + mouse-look is the default editor
  // feel); a stored '0' keeps a maker who turned it off, off.
  private freeFlyOn = readPrefDefaultOn(FREE_FLY_PREF_KEY);
  private invertPanOn = readPrefDefaultOn(INVERT_PAN_PREF_KEY);
  // The playtest player stand-in model; removed by default (game-editor feel).
  private showPlayerOn = readPref(SHOW_PLAYER_PREF_KEY);
  // Map-limit wall overlays; OFF by default (uncluttered viewport), shown when a
  // maker explicitly turns them on from the Camera tab.
  private showBoundaryOn = readPref(SHOW_BOUNDARY_PREF_KEY);
  // Collision-volume overlays; shown by default, hideable from the Collider tab.
  private collidersHiddenOn = readPref(HIDE_COLLIDERS_PREF_KEY);
  // Named-location area boxes; shown by default, hideable from the Zone tool.
  private locationsHiddenOn = readPref(HIDE_LOCATIONS_PREF_KEY);
  // "Scale all copies" range (Selection panel): a random scale in [min, max] is
  // rolled onto every placement of the selected asset. Session state, not saved.
  private cloneScaleMin = 0.8;
  private cloneScaleMax = 1.5;
  // Wireframe render mode (Camera tab); OFF by default, persisted per maker.
  private wireframeOn = readPref(WIREFRAME_PREF_KEY);
  // Editor camera speed multipliers (persisted): 1 = the shipped feel. Applied
  // to the viewport camera's move/look/pan rates.
  private cameraSpeeds = { move: 1, look: 1, pan: 1 };
  // Performance overlay (persisted): a live viewport readout the maker can turn
  // on and configure (which stats show). ON by default; a stored pref overrides.
  private perfOverlay = {
    enabled: true,
    fps: true,
    frameMs: true,
    assets: true,
    terrain: true,
  };
  // Editor lighting override (persisted): null = the shipped Day rig.
  private lighting: EditorLightingProfile | null = null;
  private lightingPreset: string = 'day';

  // blocker walls (drag-drawn invisible colliders)
  private blockerStart: Vec2 | null = null;
  private blockerPreview: BlockerDef | null = null;
  private drawingBlocker2d = false;
  private blockersVisible2d = true;

  private readonly undo = new UndoStack();
  private dirty = false;
  private saving = false;
  // Autosave (full save, not the draft backup): user-toggled, default OFF,
  // persisted; disabled again by setAutosave(false) on any autosave error so a
  // failing server can never loop toasts or hide that saving is broken.
  private autosaveOn = false;
  // True while a pointer gesture (stroke / placement drag) is mutating the
  // document; autosave must never serialize mid-gesture.
  private pointerEditActive = false;
  // Edits made while a save is in flight bump this; finishSave only clears the
  // dirty flag / draft when the generation it snapshotted is still current.
  private readonly editGen = new EditGeneration();
  private autosaveWarned = false;

  // selection
  private selectedPlacement: number | null = null;
  // Multi-selection (Blender Shift+click): every selected placement index,
  // ALWAYS including selectedPlacement (the active one) when non-null. Any
  // structural placement change collapses it back to the single active.
  private selectedSet = new Set<number>();
  private selectedCamp: number | null = null;
  private selectedKey: string | null = null; // 2D marker
  // Entity-tool mob selection uses live Sim ids so a rendered mob, rather than
  // its whole authored camp, is the unit of selection and movement.
  private selectedMobIds = new Set<number>();
  private selectedMobCamps = new Map<number, CampDef>();
  private mobDragStart: {
    pointer: Vec2;
    camps: Map<number, { camp: CampDef; point: Vec2 }>;
    dx: number;
    dz: number;
  } | null = null;
  // Selected map point light (Light tool click or Select-tool bulb click).
  private selectedLight: number | null = null;
  // Selected map point sound (Sound tool click or Select-tool badge click).
  private selectedSound: number | null = null;
  private hoverKey: string | null = null;
  // Pre-drag placement value for slider undo (waterBase pattern): captured on
  // the first LIVE change so the trailing commit diffs against the real prev.
  private placementDragBase: { index: number; prev: AssetPlacement } | null = null;
  // Wheel/nudge bursts coalesce into ONE undo commit (against placementDragBase).
  private readonly transformCoalescer = new CommitCoalescer();
  private transformTimer = 0;
  // A 3D drag-move is in flight: single-key tool shortcuts stay suppressed.
  private placementDragging = false;
  // Preview mode (topbar toggle): in-game look, editor overlays hidden.
  private previewOn = false;
  // Rotate/Scale drag reference (captured on the first drag sample): the
  // placement's pre-drag transform plus the cursor's angle/distance around the
  // pivot, so the whole drag applies deltas against one stable baseline.
  private transformDragRef: {
    angle: number;
    dist: number;
    rotY: number;
    scale: number;
  } | null = null;
  // Pre-gesture snapshots of the OTHER multi-selection members during a group
  // transform (move/rotate/scale; the active one is covered by
  // placementDragBase). Full snapshots: every live sample re-derives each
  // member from its snapshot, and the commit's undo restores it wholesale.
  private groupDragBase: Map<number, AssetPlacement> | null = null;

  // stroke state
  // Merged-tool modes: Sculpt lowers instead of raising; Level smooths
  // instead of flattening.
  private sculptLower = false;
  // Sculpt Grab mode (snake hook): press grabs the ground under the brush,
  // and the drag pulls that spot ALONG the drag direction ? in 3D the cursor
  // motion maps onto the camera's view plane (sideways slides the grabbed
  // bump across the map, up/down on screen pulls it out of / into the
  // ground); in 2D top-down only the height pull applies (one live stamp per
  // gesture either way).
  private sculptGrab = false;
  private grabSession: {
    stamp: HeightStamp;
    startClientX: number;
    startClientY: number;
    // Where the stamp was planted (world): lateral drags offset from here.
    startX: number;
    startZ: number;
    // World yards per screen pixel at the grab point (camera-scaled).
    wpp: number;
    // Camera view-plane basis at grab time (3D only; null in 2D).
    axes: {
      right: { x: number; y: number; z: number };
      up: { x: number; y: number; z: number };
    } | null;
    region: RegionBox;
  } | null = null;
  // The Fluid tool's armed pool kind (preset).
  private fluidKind: FluidKind = 'lava';
  // Caves tool sub-mode: lay cave rig nodes, punch terrain holes, or patch
  // ground back over unwanted parts of the cuts.
  private tunnelMode: 'dig' | 'hole' | 'patch' = 'dig';
  // Rock Generator tool: the sliders shaping the NEXT rock. Chain mode lays
  // blue waypoint PLACEMENTS (rock/point, grouped by the chain id in
  // placement.name, exactly like the cave rigs), so the nodes survive tool
  // switches, move/scale with the ordinary gizmos, and undo/save.
  private rockParams = {
    size: 3,
    noise: 0.5,
    detail: 0.5,
    sharp: 0.3,
    tex: 0,
    walkable: true,
    height: 1,
    depth: 0,
    jag: 0,
    texId: '',
    texTile: DEFAULT_TEXTURE_TILE_YD,
  };
  private rockChainMode = false;
  private caveEditBase: {
    cave: CaveDef;
    width: number;
    height: number;
    variance: number;
    floorVariance: number;
    stalactites: number;
    stalagmites: number;
    spikeSize: number;
    startOpen: boolean;
    endOpen: boolean;
    tex: string | null;
    texTile: number | null;
    // Pre-edit node chain: a variance drag re-bores, so undo restores nodes too.
    nodes: CaveNode[];
  } | null = null;
  // Pre-drag radius per hole/patch (live sliders; same pattern as caves).
  private holeEditBase: { index: number; radius: number } | null = null;
  private holePatchEditBase: { index: number; radius: number } | null = null;
  private flattenSmooth = false;
  // Paint brush edge hardness (percent; 100 = the legacy hard brush) and the
  // one-shot bucket fill arm state.
  private paintHardness = 70;
  // Selected brush alpha (mask) for the paint tool; null = plain round brush.
  private paintAlphaId: string | null = null;
  // Track the music tool assigns to the NEXT dragged area.
  private musicAreaTrack: string = 'vale';
  // Selected music area (Music tool click on a rect, or a panel row click).
  private selectedMusicArea: number | null = null;
  private bucketArmed = false;
  // Slope-based auto texture for the sculpt tools: when enabled, every stroke
  // repaints its region by ground angle (flat id below the threshold, steep id
  // above; -1 leaves that band's paint untouched).
  private autoTexture = { enabled: false, angle: 38, flatId: -1, steepId: 2 };
  // Which paint cells the slope auto-texture currently OWNS (cell index -> the
  // id the cell held BEFORE auto first painted it). Lets a later stroke that
  // reshapes the ground back to flat RESTORE the original texture instead of
  // leaving the "locked in" cliff paint. Session-only, keyed to one grid; it
  // resets when the paint grid is swapped (resample) since indices change.
  private autoTexOwned = new Map<number, number>();
  private autoTexOwnedGrid: BiomePaint | null = null;
  // Zone tool drag box (named locations) + spawn-tool marker placement mode.
  private zoneStart: Vec2 | null = null;
  private spawnAreaStart: Vec2 | null = null;
  private spawnAreaPreview: { minX: number; minZ: number; maxX: number; maxZ: number } | null =
    null;
  private zoneBox: RegionBox | null = null;
  private markerPlaceMode = false;
  private markerKind: 'npc' | 'object' = 'npc';
  private strokeStamps: HeightStamp[] = [];
  private strokeStartIndex = 0;
  private strokeCapWarned = false;
  private strokeRegion: RegionBox | null = null;
  // Shift held during the current sculpt stroke: apply the OPPOSITE sub-mode
  // (raise<->lower, smooth<->flatten). Set from the pointer event per stamp.
  private strokeInvert = false;
  private paintChanges = new Map<number, { prev: number; next: number }>();
  private paintCreatedGrid = false;
  private lastStamp: Vec2 | null = null;
  private flattenTarget = 0;
  private eraseLast: Vec2 | null = null;

  // water
  private waterBase = WATER_LEVEL;
  private waterTimer = 0;

  // region clipboard
  private regionBox: RegionBox | null = null;
  private regionStart: Vec2 | null = null;
  private selectingRegion = false;
  private clipboard: Clipboard | null = null;

  // 2D pointer state
  private panning = false;
  private dragKey: string | null = null;
  private markerDragStart: { key: string; x: number; z: number } | null = null;
  private grab: Vec2 = { x: 0, z: 0 };
  private npcFacingDragBase: { key: string; facing: number } | null = null;
  private lastPointer: ScreenPoint = { sx: 0, sy: 0 };
  private painting2d = false;
  /** Pixels dragged since the 2D paint press; gates jitter, see pointermove. */
  private paint2dDragPx = 0;
  private cursorWorld: Vec2 | null = null;
  private canvasDirty = true;

  private readonly io = new MapIO();
  // The shared game settings store (localStorage-backed): the editor's Settings
  // dialog writes graphics/sound here, so a playtest boots with the same values.
  private readonly gameSettings = new Settings();
  private readonly visible = new Set<EntityKind>(KINDS);

  // Lighting-tab birds preference (editor preview, persisted like lighting).
  // The skybox is NOT a preference: it lives on the map document (map.skybox)
  // so playtest renders it in-game.
  private birds = { enabled: true, count: 14, formation: true };

  constructor(
    private readonly root: HTMLElement,
    content: ZoneContent,
  ) {
    this.content = content;
    this.map = {
      version: CUSTOM_MAP_VERSION,
      meta: {
        id: mintId(),
        name: t('editor.untitledMap'),
        description: '',
        createdAt: now(),
        updatedAt: now(),
        seed: DEFAULT_PLAYTEST_SEED,
        parentId: '',
      },
      content,
      terrainEdits: [],
      placements: [],
    };
    // Returning from a playtest in this tab: reopen the map that launched it.
    // Prefer the newest copy across the full save, the launch draft, and the
    // session recovery slot so a failed navigation cannot strand a blank editor.
    const restored = this.restorePlaytestMap();
    const resumed = restored?.map ?? null;
    // Fresh page (nothing to resume): reopen the most recently saved local map
    // so a maker lands back in their last work instead of the built-in world. A
    // first-time visitor with no saves still gets the built-in world as before.
    const autoloaded = resumed ? null : this.loadMostRecentSave();
    const opened = resumed ?? autoloaded;
    if (opened) {
      this.map = opened;
      this.content = opened.content;
      this.waterBase = opened.waterLevel ?? WATER_LEVEL;
    }
    promoteMajorWorldProps(this.map as CustomMap);
    this.entities = buildEntities(this.content);
    this.base = snapshot(this.entities);
    this.rebuildActiveWorld();

    // ---- layout ------------------------------------------------------------------
    this.root.innerHTML = '';
    this.root.classList.add('ed-root');

    this.topbar = new Topbar(this.root, {
      onNameChange: (name) => {
        this.map.meta.name = name;
        this.markDirty();
      },
      onNew: () => void this.newMap(),
      onNewFlat: () => void this.newFlatMap(),
      onOpen: () => this.drawer.open(),
      onSave: () => void this.save(),
      onSaveAs: () => void this.saveAs(),
      onAutosaveToggle: () => this.setAutosave(!this.autosaveOn),
      onFork: () => void this.forkCurrent(),
      onImport: () => void this.importFile(),
      onExport: () => this.exportFile(),
      onUploadAsset: () => void this.uploadAsset(),
      onImportModel: () => this.importModel(),
      onSettings: () => this.openGameSettings(),
      onPlaytest: () => this.playtest(),
      onViewMode: (mode) => this.setViewMode(mode),
      onPreviewToggle: () => this.setPreviewMode(!this.previewOn),
      onUndo: () => this.doUndo(),
      onRedo: () => this.doRedo(),
      onHelp: () => this.tutorial.openHelp(),
    });
    // Autosave preference: default off; a blocked storage read stays off.
    try {
      this.autosaveOn = localStorage.getItem(AUTOSAVE_PREF_KEY) === '1';
    } catch {
      this.autosaveOn = false;
    }
    // Lighting preference: {preset, profile}; malformed/blocked storage = Day.
    try {
      const raw = localStorage.getItem(LIGHTING_PREF_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          preset?: string;
          profile?: EditorLightingProfile;
        };
        if (saved.profile && typeof saved.profile.sunIntensity === 'number') {
          this.lighting = saved.profile;
          this.lightingPreset = typeof saved.preset === 'string' ? saved.preset : 'custom';
        }
      }
    } catch {
      this.lighting = null;
    }
    this.topbar.setAutosave(this.autosaveOn);

    const main = el('div', 'ed-main');
    this.root.appendChild(main);
    this.toolbar = new Toolbar(main, (tool) => this.setTool(tool));

    const stageWrap = el('div', 'ed-stage');
    stageWrap.setAttribute('aria-label', t('editor.a11y.stage'));
    this.stage3dEl = el('div', 'editor-3d-host');
    this.stage2d = el('div', 'editor-2d-host');
    this.canvas = document.createElement('canvas');
    this.stage2d.appendChild(this.canvas);
    stageWrap.append(this.stage3dEl, this.stage2d);
    main.appendChild(stageWrap);

    this.inspector = new Inspector(main, this.inspectorDeps());

    this.assets = new AssetBrowser(stageWrap, {
      onPick: (assetId, label) => {
        // On the Foliage tool, a pick arms the CUSTOM brush asset instead of the
        // Place tool, so makers can scatter their own trees/bushes.
        if (this.tool === 'foliage') {
          this.foliageCustom = { assetId, label };
          this.inspector.refresh();
          return;
        }
        this.placeAssetId = assetId;
        this.placeAssetLabel = label;
        if (this.tool !== 'place') this.setTool('place');
        else this.inspector.refresh();
      },
      confirm: (title, body) => confirmDialog(this.root, { title, body, danger: true }),
      toastError: (m) => this.toasts.error(m),
    });

    this.toasts = new Toasts(this.root);
    this.drawer = new MapDrawer(this.root, {
      listLocal: () => this.io.store.list(),
      hasDraft: () => this.io.draftLoad() !== null,
      onOpenShipped: async (mapId) => {
        if (!(await this.confirmDiscard())) return;
        const map = await createShippedMap(mapId, mintId(), now());
        this.loadMap(map);
        // Dense kit maps turn the global footprint overlay into one solid
        // screen-sized wash. Open them clean; the toggle remains available.
        this.footprintsOn = false;
        writePref(FOOTPRINTS_PREF_KEY, false);
        this.syncFootprintOverlay();
        this.inspector.refresh();
        this.toasts.info(t('editor.status.shippedMapOpened', { name: map.meta.name }));
      },
      onOpenLocal: async (id) => {
        if (!(await this.confirmDiscard())) return;
        const loaded = this.io.store.load(id);
        if (loaded) this.loadMap(loaded);
      },
      onOpenDraft: async () => {
        if (!(await this.confirmDiscard())) return;
        const draft = this.io.draftLoad();
        if (draft) {
          this.loadMap(draft);
          this.toasts.info(t('editor.status.draftRestored'));
        }
      },
      onDeleteLocal: async (id) => {
        this.io.store.remove(id);
        this.io.setLink(id, null);
      },
      onOpenServer: (full, mine) => void this.openServerMap(full, mine),
      confirm: (title, body, confirmLabel) =>
        confirmDialog(this.root, { title, body, confirmLabel, danger: true }),
      toastError: (m) => this.toasts.error(m),
      toastSuccess: (m) => this.toasts.success(m),
    });

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    this.ctx = ctx;

    this.attach2dEvents(this.stage2d);
    window.addEventListener('keydown', this.onKeyDown);
    // Unsaved work guard: the browser shows its leave-confirmation while the
    // document is dirty (closing the tab was silent data loss before).
    window.addEventListener('beforeunload', (ev) => {
      if (!this.dirty) return;
      ev.preventDefault();
      ev.returnValue = '';
    });
    this.resize();
    this.frameAll();
    requestAnimationFrame(this.tick2d);
    window.setInterval(() => this.autosave(), AUTOSAVE_MS);
    window.setInterval(() => this.localBackupSave(), LOCAL_SAVE_MS);

    this.topbar.setMapName(this.map.meta.name);
    this.topbar.setOffline(!signedIn());
    this.topbar.setForkEnabled(opened !== null && this.io.linkFor(this.map.meta.id) !== null);
    if (opened) this.toasts.info(t('editor.status.opened', { name: this.map.meta.name }));
    if (restored?.dirty) {
      this.dirty = true;
      this.topbar.setDirty(true);
    }
    this.topbar.setViewMode(this.viewMode);
    this.toolbar.setActive(this.tool);

    // Sky/birds preferences (applied through the viewport once it boots).
    const savedBirds = readJsonPref<{
      enabled: boolean;
      count: number;
      formation: boolean;
    }>(BIRDS_PREF_KEY);
    if (savedBirds && typeof savedBirds.enabled === 'boolean') {
      this.birds = {
        enabled: savedBirds.enabled,
        count: Number.isFinite(savedBirds.count) ? savedBirds.count : 14,
        formation: savedBirds.formation !== false,
      };
    }
    // Camera-speed multipliers (persisted): clamp to the slider range on load.
    const savedSpeeds = readJsonPref<{
      move: number;
      look: number;
      pan: number;
    }>(CAMERA_SPEEDS_PREF_KEY);
    if (savedSpeeds) {
      const clampSpeed = (v: unknown): number =>
        Number.isFinite(v) ? Math.min(4, Math.max(0.1, v as number)) : 1;
      this.cameraSpeeds = {
        move: clampSpeed(savedSpeeds.move),
        look: clampSpeed(savedSpeeds.look),
        pan: clampSpeed(savedSpeeds.pan),
      };
    }
    // Performance-overlay preferences (persisted): merge onto the defaults so a
    // partial/old stored object keeps every field a valid boolean.
    const savedPerf = readJsonPref<Partial<EditorApp['perfOverlay']>>(PERF_OVERLAY_PREF_KEY);
    if (savedPerf && typeof savedPerf === 'object') {
      for (const key of Object.keys(this.perfOverlay) as (keyof EditorApp['perfOverlay'])[]) {
        if (typeof savedPerf[key] === 'boolean') this.perfOverlay[key] = savedPerf[key];
      }
    }
    this.applyViewMode();
    this.boot3d();
    this.applyBirds();
    this.applySkybox();
    this.viewport3d?.setShowBoundaryWalls(this.showBoundaryOn);
    this.viewport3d?.setWireframe(this.wireframeOn);

    // Help modal + first-run tour (auto-starts once; Help > Begin tutorial
    // replays it any time).
    this.tutorial = new EditorTutorial(this.root);
    this.tutorial.maybeAutoStart();

    // Restore imported models persisted in IndexedDB, so 'local/<sha>'
    // placements in saved maps resolve without re-importing the files.
    void this.ensureStoredLocalAssets().then((added) => {
      if (added) this.viewport3d?.rebuildPlacements();
    });
  }

  private restorePlaytestMap(): PlaytestRestore | null {
    let resumeId: string | null = null;
    try {
      resumeId = sessionStorage.getItem(PLAYTEST_RESUME_KEY);
    } catch {
      resumeId = null;
    }

    const candidates: {
      map: CustomMap;
      source: 'store' | 'draft' | 'recovery';
    }[] = [];
    if (resumeId) {
      const stored = this.io.store.load(resumeId);
      const draft = this.io.draftLoadById(resumeId);
      if (stored) candidates.push({ map: stored, source: 'store' });
      if (draft) candidates.push({ map: draft, source: 'draft' });
    }
    const recovery = loadPlaytestRecoveryDraft();
    if (recovery && (!resumeId || recovery.meta.id === resumeId)) {
      candidates.push({ map: recovery, source: 'recovery' });
    }
    if (candidates.length === 0) {
      if (resumeId) {
        try {
          sessionStorage.removeItem(PLAYTEST_RESUME_KEY);
        } catch {
          // Blocked storage: ignore the stale marker.
        }
      }
      return null;
    }

    candidates.sort((a, b) => b.map.meta.updatedAt - a.map.meta.updatedAt);
    const picked = candidates[0];
    const saved = picked.source === 'store' ? true : this.io.saveLocal(picked.map);
    if (saved) {
      this.io.draftClear(picked.map.meta.id);
      clearPlaytestRecoveryDraft(picked.map.meta.id);
    }
    try {
      sessionStorage.removeItem(PLAYTEST_RESUME_KEY);
    } catch {
      // Blocked storage: the stale marker can only point back to this map.
    }
    return { map: picked.map, dirty: !saved };
  }

  /**
   * Reopen the most recently saved local map (newest by `updatedAt`), or null if
   * this browser has none. `store.list()` is already sorted newest-first, so the
   * head is the last map the maker touched. Called on a fresh launch (no playtest
   * to resume) so the editor reopens their work instead of a blank world.
   */
  private loadMostRecentSave(): CustomMap | null {
    const latest = this.io.store.list()[0];
    return latest ? this.io.store.load(latest.id) : null;
  }

  /**
   * Register every imported model saved in this browser's IndexedDB (bundle
   * imports and past sessions) as a session object URL, so a loaded/opened map
   * that references 'local/<sha>' placements resolves them. Idempotent: an id
   * already registered is skipped (never re-minting a URL, which would leak the
   * old blob). Resolves true when at least one NEW asset was registered, so the
   * caller knows to re-instance placements that were holes. Best effort: a
   * blocked/empty store resolves false. Also feeds the asset browser's Imported
   * tab (it lists the registry).
   */
  private async ensureStoredLocalAssets(): Promise<boolean> {
    let added = false;
    try {
      for (const a of await loadStoredLocalAssets()) {
        const id = localAssetIdFor(a.sha256);
        if (localAssetUrl(id) !== null) continue; // already registered this session
        registerLocalAsset({
          id,
          name: a.name,
          url: URL.createObjectURL(new Blob([a.bytes], { type: a.mime })),
          byteSize: a.byteSize,
        });
        added = true;
      }
    } catch {
      // Blocked storage: the session keeps whatever is already registered.
    }
    return added;
  }

  // ---- active world -------------------------------------------------------------

  /**
   * Build the ACTIVE WorldContent over SHARED references into the working
   * document (terrainEdits, biomePaint, zones/camps/roads), so every edit is
   * immediately visible to terrainHeight()/waterLevel() without cloning.
   */
  private rebuildActiveWorld(): void {
    const map = this.map;
    const world: WorldContent = {
      zones: map.content.zones as WorldContent['zones'],
      camps: map.content.camps as WorldContent['camps'],
      npcs: map.content.npcs as WorldContent['npcs'],
      groundObjects: map.content.objects as WorldContent['groundObjects'],
      roads: (map.content.roads ?? BUILTIN_WORLD.roads) as WorldContent['roads'],
      props:
        map.propsMode === 'empty'
          ? emptyZoneProps()
          : map.propsMode === 'editable-major'
            ? withoutMajorWorldProps(BUILTIN_WORLD.props)
            : BUILTIN_WORLD.props,
      playerStart: map.playerStart ? { ...map.playerStart } : { ...PLAYER_START },
      terrainEdits: map.terrainEdits,
      placements: [],
      biomePaint: map.biomePaint,
    };
    if (map.playerSpawnArea) world.playerSpawnArea = { ...map.playerSpawnArea };
    if (map.blockers) world.blockers = map.blockers;
    if (map.caves) world.caves = map.caves;
    if (map.holes) world.holes = map.holes;
    if (map.holePatches) world.holePatches = map.holePatches;
    if (map.waterLevel !== undefined) world.waterLevel = map.waterLevel;
    if (map.waterHue !== undefined) world.waterHue = map.waterHue;
    if (map.waterLum !== undefined) world.waterLum = map.waterLum;
    const fluids = fluidVolumesFromPlacements(map.placements);
    if (fluids.length > 0) world.fluids = fluids;
    if (map.worldHalfX !== undefined) world.worldHalfX = map.worldHalfX;
    if (map.decorationsMode === 'empty') world.decorationsMode = 'empty';
    if (map.presentationMode !== undefined) world.presentationMode = map.presentationMode;
    if (map.skybox !== undefined) world.skybox = map.skybox;
    if (map.terrainStyle) world.terrainStyle = map.terrainStyle;
    if (map.timeScale !== undefined) world.timeScale = map.timeScale;
    if (map.assetViewDistance !== undefined) world.assetViewDistance = map.assetViewDistance;
    if (map.weather) world.weather = map.weather;
    if (map.music) world.music = map.music;
    this.activeWorld = world;
    setActiveWorldContent(world);
    // The whole terrainEdits array was swapped: every derived cache is stale.
    this.terrainEditsMutated();
  }

  /** The document's blocker list, lazily created and SHARED with the active
   *  WorldContent so the sim's colliders always read the live array. */
  private blockersRef(): BlockerDef[] {
    if (!this.map.blockers) this.map.blockers = [];
    if (this.activeWorld.blockers !== this.map.blockers) {
      this.activeWorld.blockers = this.map.blockers;
    }
    return this.map.blockers;
  }

  /** The document's cave list, lazily created and SHARED with the active
   *  WorldContent so terrainHeight()/groundHeightNear() read the live array. */
  private cavesRef(): CaveDef[] {
    if (!this.map.caves) this.map.caves = [];
    if (this.activeWorld.caves !== this.map.caves) {
      this.activeWorld.caves = this.map.caves;
    }
    return this.map.caves;
  }

  /** The document's terrain-hole list, lazily created and SHARED with the
   *  active WorldContent (same contract as cavesRef). */
  private holesRef(): TerrainHole[] {
    if (!this.map.holes) this.map.holes = [];
    if (this.activeWorld.holes !== this.map.holes) {
      this.activeWorld.holes = this.map.holes;
    }
    return this.map.holes;
  }

  /** The document's hole-patch list (same contract as holesRef). */
  private holePatchesRef(): TerrainHole[] {
    if (!this.map.holePatches) this.map.holePatches = [];
    if (this.activeWorld.holePatches !== this.map.holePatches) {
      this.activeWorld.holePatches = this.map.holePatches;
    }
    return this.map.holePatches;
  }

  /** EVERY blocker mutation (add, erase, undo/redo) funnels here: the cached
   *  static-collider grid is stale and the overlays must repaint. */
  private blockersMutated(): void {
    invalidateStaticColliders();
    this.viewport3d?.rebuildBlockers();
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
  }

  private syncWaterToActive(): void {
    if (this.map.waterLevel !== undefined) this.activeWorld.waterLevel = this.map.waterLevel;
    else delete this.activeWorld.waterLevel;
  }

  // ---- 3D viewport ---------------------------------------------------------------

  // Full-stage overlay while the 3D engine loads its assets (the stage is
  // otherwise a black canvas for several seconds on first boot).
  private show3dLoading(): void {
    if (this.stage3dEl.querySelector('.ed-3d-loading')) return;
    const overlay = el('div', 'ed-3d-loading');
    overlay.setAttribute('role', 'status');
    overlay.append(el('div', 'ed-3d-loading-spin'), el('div', 'ed-3d-loading-text'));
    (overlay.lastChild as HTMLElement).textContent = t('editor.status.loading3d');
    this.stage3dEl.appendChild(overlay);
  }

  private hide3dLoading(): void {
    this.stage3dEl.querySelector('.ed-3d-loading')?.remove();
  }

  private boot3d(): void {
    if (this.viewport3d) return;
    this.show3dLoading();
    try {
      this.viewport3d = new Editor3DViewport(this.stage3dEl, this.map, {
        toolActive: () => this.toolWantsPointer(),
        shiftEditsTool: () => isSculptTool(this.tool),
        onEditStart: (w, ev) => this.editStart(w, ev),
        onEditMove: (w, ev) => this.editMove(w, ev),
        onEditEnd: () => this.editEnd(),
        onHover: (w) => this.hover3d(w),
        onTap: (cx, cy, w, additive) => this.tap3d(cx, cy, w, additive),
        placementDragEnabled: () => isSelectionTool(this.tool) && !this.hitboxEdit,
        onPlacementDragStart: (index) => this.beginPlacementDrag(index),
        onPlacementDragMove: (w) => this.placementDragMove(w),
        onPlacementDragEnd: () => this.endPlacementDrag(),
        onBoxSelect: (indices) => this.selectPlacements(indices),
        onTransformWheel: (kind, deltaY) => this.transformWheel(kind, deltaY),
        gizmoMode: () =>
          isTransformTool(this.tool) && this.selectedPlacement !== null ? this.tool : null,
        onGizmoChange: (change) =>
          this.updateSelectedPlacement(change, false, { detachOnMove: true }),
        onHitboxGizmoChange: (change) => this.applyHitboxGizmo(change),
        onGizmoEnd: () => {
          if (this.hitboxDragBase) this.commitHitboxes();
          else this.updateSelectedPlacement({}, true);
          this.inspector.refresh();
        },
      });
      this.viewport3d.setFreeFly(this.freeFlyOn);
      this.viewport3d.setInvertPan(this.invertPanOn);
      this.viewport3d.setShowPlayer(this.showPlayerOn);
      this.viewport3d.setCollidersHidden(this.collidersHiddenOn);
      this.viewport3d.setLocationsHidden(this.locationsHiddenOn);
      this.viewport3d.setWireframe(this.wireframeOn);
      this.viewport3d.setCameraSpeeds(this.cameraSpeeds);
      this.viewport3d.setPerfOverlay(this.perfOverlay);
      this.viewport3d.setWorldSpeed(this.map.timeScale ?? 1);
      this.viewport3d.setAssetViewDistance(
        this.map.assetViewDistance ?? DEFAULT_ASSET_VIEW_DISTANCE,
      );
      this.viewport3d.setLighting(this.lighting);
      void this.viewport3d
        .start()
        .then(() => {
          this.hide3dLoading();
          this.syncFootprintOverlay();
          // Node guides are always-on chrome now: sync them at boot/load too,
          // not just on tool switches.
          this.refreshCaveGuides();
          this.refreshRockGuides();
        })
        .catch((e) => {
          console.error('3D viewport failed; falling back to 2D', e);
          this.hide3dLoading();
          this.viewMode = '2d';
          this.applyViewMode();
        });
    } catch (e) {
      console.error('3D viewport unavailable; using 2D', e);
      this.hide3dLoading();
      this.viewMode = '2d';
      this.applyViewMode();
    }
  }

  private setViewMode(mode: '3d' | '2d'): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.applyViewMode();
    if (mode === '3d') {
      this.boot3d();
      // 2D marker drags reshape hubs/zones: re-mesh once when returning to 3D.
      if (this.markerMovedWhile2d) {
        this.viewport3d?.rebuildTerrainFull();
        this.markerMovedWhile2d = false;
      }
    }
    this.inspector.refresh();
  }

  private applyViewMode(): void {
    const is3d = this.viewMode === '3d';
    this.stage3dEl.style.display = is3d ? '' : 'none';
    this.stage2d.style.display = is3d ? 'none' : '';
    // Pause the hidden 3D render loop (it refreshes itself on show).
    this.viewport3d?.setVisible(is3d);
    this.topbar.setViewMode(this.viewMode);
    if (!is3d) {
      this.resize();
      this.canvasDirty = true;
    }
  }

  // ---- tool state ----------------------------------------------------------------

  private setTool(tool: EditorTool): void {
    // Music-area rects are authoring chrome: draw them only for the tool.
    this.viewport3d?.setMusicPreview(tool === 'music');
    // Point-sound radius spheres likewise show all only while the tool is active.
    this.viewport3d?.setSoundPreview(tool === 'sound');
    if (this.viewport3d?.grabFollowing) {
      this.viewport3d.cancelGrabFollow();
      this.endPlacementDrag();
    }
    this.tool = tool;
    // Cave + rock node guides stay visible in EVERY tool: the blue points are
    // real placements the Move/Scale gizmos can grab, so hiding them on tool
    // switch read as "my nodes disappeared". setTool only re-syncs them.
    // Hole rings show only while the Caves tool is up (refreshHoleGuides gates).
    this.refreshCaveGuides();
    this.refreshRockGuides();
    this.refreshHoleGuides();
    this.toolbar.setActive(tool);
    this.inspector.showToolTab();
    // The asset browser backs the Place tool and the Foliage tool's custom brush.
    this.assets.setVisible(tool === 'place' || tool === 'foliage');
    // The placement selection survives switching among Select/Move/Rotate/Scale
    // (Blender flow: pick, then G/R/S); any other tool drops it.
    if (!isSelectionTool(tool)) this.setSelectedPlacement(null);
    if (tool !== 'select' && tool !== 'entity') this.selectedKey = null;
    if (tool !== 'entity') {
      this.clearMobSelection();
      this.npcFacingDragBase = null;
    }
    if (tool !== 'camp') this.selectedCamp = null;
    if (tool !== 'select' && tool !== 'light' && this.selectedLight !== null) {
      this.selectedLight = null;
      this.viewport3d?.setSelectedLight(null);
    }
    if (tool !== 'music' && this.selectedMusicArea !== null) {
      this.selectedMusicArea = null;
      this.viewport3d?.setSelectedMusicArea(null);
    }
    if (tool !== 'select' && tool !== 'sound' && this.selectedSound !== null) {
      this.selectedSound = null;
      this.viewport3d?.setSelectedSound(null);
    }
    if (tool !== 'blocker') this.clearBlockerDraft();
    if (tool === 'spawn') this.viewport3d?.setZonePreview(this.map.playerSpawnArea ?? null);
    else if (this.tool !== 'zone' && this.tool !== 'music') this.viewport3d?.setZonePreview(null);
    this.viewport3d?.clearBrush();
    this.syncFootprintOverlay();
    this.inspector.refresh();
    this.canvasDirty = true;
  }

  /**
   * Effective footprint overlay = the user's manual toggle OR a collision-
   * authoring context that forces it on (the Place tool with collide checked,
   * or the Blocker tool). Leaving those contexts falls back to the manual
   * setting untouched, so the toggle's semantics never change.
   */
  private syncFootprintOverlay(): void {
    const forced = this.tool === 'blocker' || (this.tool === 'place' && this.placeCollide);
    // Preview mode wins: no editor chrome, whatever the tool wants.
    this.viewport3d?.showFootprints((this.footprintsOn || forced) && !this.previewOn);
  }

  /** Preview mode (topbar): the map as it looks in-game ? every editor-only
   *  overlay hidden. Purely a view state; nothing in the document changes. */
  private setPreviewMode(on: boolean): void {
    if (this.previewOn === on) return;
    this.previewOn = on;
    this.topbar.setPreview(on);
    this.viewport3d?.setPreviewMode(on);
    this.syncFootprintOverlay();
  }

  /** Tools that claim the left pointer in the 3D viewport. The transform trio
   *  goes through the placement-drag path instead, so empty ground still orbits. */
  private toolWantsPointer(): boolean {
    return this.tool !== 'select' && this.tool !== 'water' && !isTransformTool(this.tool);
  }

  private isDragTool(): boolean {
    return (
      this.tool === 'raise' ||
      this.tool === 'lower' ||
      this.tool === 'smooth' ||
      this.tool === 'flatten' ||
      this.tool === 'paint' ||
      this.tool === 'foliage' ||
      this.tool === 'entity' ||
      this.tool === 'spawn' ||
      this.tool === 'zone' ||
      this.tool === 'music' ||
      this.tool === 'erase'
    );
  }

  // ---- shared edit routing (3D hooks + 2D pointer both land here) -----------------

  private editStart(w: Vec2, ev?: PointerEvent): void {
    this.pointerEditActive = true;
    switch (this.tool) {
      case 'raise':
      case 'lower':
      case 'smooth':
      case 'flatten':
        if (this.tool === 'raise' && this.sculptGrab && ev) {
          this.grabBegin(w, ev);
          break;
        }
        this.strokeInvert = ev?.shiftKey === true;
        this.strokeBegin(w);
        break;
      case 'tunnel':
        this.tunnelBegin(w);
        break;
      case 'paint':
        if (this.bucketArmed) {
          this.bucketFill(w);
          break;
        }
        this.paintBegin(w);
        break;
      case 'erase':
        this.eraseLast = null;
        this.eraseAt(w);
        break;
      case 'place':
        this.placeAt(w);
        break;
      case 'foliage':
        this.foliageBegin(w);
        break;
      case 'collider':
        this.insertColliderAt(w);
        break;
      case 'fluid':
        this.insertFluidAt(w);
        break;
      case 'blocker':
        this.blockerStart = { ...w };
        this.blockerPreview = null;
        break;
      case 'camp':
        this.campClick(w);
        break;
      case 'entity': {
        const runtimeMob = ev ? this.viewport3d?.pickRuntimeMob(ev.clientX, ev.clientY) : null;
        if (runtimeMob) {
          const camp = this.individualCampForRuntimeMob(runtimeMob.id);
          if (camp) {
            this.selectedMobIds = toggledMobSelection(
              this.selectedMobIds,
              runtimeMob.id,
              ev?.ctrlKey === true,
            );
            if (this.selectedMobIds.has(runtimeMob.id)) {
              this.selectedMobCamps.set(runtimeMob.id, camp);
            } else {
              this.selectedMobCamps.delete(runtimeMob.id);
            }
            for (const id of [...this.selectedMobCamps.keys()]) {
              if (!this.selectedMobIds.has(id)) this.selectedMobCamps.delete(id);
            }
            this.viewport3d?.setSelectedRuntimeMobs(this.selectedMobIds);
            this.selectedKey = null;
            this.markerDragStart = null;
            this.mobDragStart = this.selectedMobIds.has(runtimeMob.id)
              ? {
                  pointer: { ...w },
                  camps: new Map(
                    [...this.selectedMobCamps].map(([id, selectedCamp]) => [
                      id,
                      { camp: selectedCamp, point: { ...selectedCamp.center } },
                    ]),
                  ),
                  dx: 0,
                  dz: 0,
                }
              : null;
            this.inspector.refresh();
            this.canvasDirty = true;
            break;
          }
        }
        this.clearMobSelection();
        const hit = pickMovableEntity(this.entities, w);
        this.selectedKey = hit?.key ?? null;
        if (hit) {
          this.markerDragStart = { key: hit.key, x: hit.point.x, z: hit.point.z };
          this.grab = { x: w.x - hit.point.x, z: w.z - hit.point.z };
        }
        this.inspector.refresh();
        this.canvasDirty = true;
        break;
      }
      case 'spawn':
        if (this.markerPlaceMode) this.addMarker(w);
        else {
          this.spawnAreaStart = { ...w };
          this.spawnAreaPreview = { minX: w.x, minZ: w.z, maxX: w.x, maxZ: w.z };
        }
        break;
      case 'zone':
      case 'music':
        this.zoneStart = { ...w };
        this.zoneBox = { minX: w.x, minZ: w.z, maxX: w.x, maxZ: w.z };
        break;
      case 'light': {
        // A click on an existing bulb selects it (edit/delete); empty ground
        // places a new light.
        const hit = ev ? (this.viewport3d?.pickMapLight(ev.clientX, ev.clientY) ?? null) : null;
        if (hit !== null) this.setSelectedLight(hit);
        else this.placeLight(w);
        break;
      }
      case 'sound': {
        // A click on an existing sound badge selects it; empty ground places one.
        const hit = ev ? (this.viewport3d?.pickMapSound(ev.clientX, ev.clientY) ?? null) : null;
        if (hit !== null) this.setSelectedSound(hit);
        else this.placeSound(w);
        break;
      }
      case 'rock':
        this.rockClick(w);
        break;
      case 'region':
        this.regionStart = { ...w };
        this.regionBox = { minX: w.x, minZ: w.z, maxX: w.x, maxZ: w.z };
        this.canvasDirty = true;
        break;
      default:
        break;
    }
  }

  private editMove(w: Vec2, ev?: PointerEvent): void {
    switch (this.tool) {
      case 'raise':
      case 'lower':
      case 'smooth':
      case 'flatten':
        if (this.grabSession) {
          if (ev) this.grabStep(ev);
          this.brushRing(w);
          break;
        }
        // Live: pressing/releasing Shift mid-stroke flips the sub-mode from
        // the next stamp on (matching how sculpt modifiers feel elsewhere).
        if (ev) this.strokeInvert = ev.shiftKey;
        this.strokeStep(w);
        this.brushRing(w);
        break;
      case 'tunnel':
        // Click-only tool; the ring previews the node/hole size while aiming.
        this.brushRing(w);
        break;
      case 'paint':
        this.paintStep(w);
        this.brushRing(w);
        break;
      case 'erase':
        this.eraseAt(w);
        this.brushRing(w);
        break;
      case 'foliage':
        this.foliageStep(w);
        this.brushRing(w);
        break;
      case 'blocker':
        if (this.blockerStart) {
          const s = this.blockerStart;
          // Same clamp the sanitizer applies: too short previews nothing, and
          // a drag past 200yd truncates live, so the preview IS the stored wall.
          this.blockerPreview = clampBlockerSegment(s.x, s.z, w.x, w.z);
          this.viewport3d?.setBlockerPreview(this.blockerPreview);
          this.canvasDirty = true;
        }
        break;
      case 'entity': {
        if (this.mobDragStart) {
          const drag = this.mobDragStart;
          const dx = w.x - drag.pointer.x;
          const dz = w.z - drag.pointer.z;
          this.viewport3d?.moveRuntimeMobs(this.selectedMobIds, dx - drag.dx, dz - drag.dz);
          drag.dx = dx;
          drag.dz = dz;
          for (const { camp, point } of drag.camps.values()) {
            camp.center.x = point.x + dx;
            camp.center.z = point.z + dz;
          }
          this.entities = buildEntities(this.content);
          this.canvasDirty = true;
          break;
        }
        if (!this.selectedKey) break;
        const entity = this.entities.find((candidate) => candidate.key === this.selectedKey);
        if (!entity || !isMovableEntity(entity)) break;
        const from = { x: entity.point.x, z: entity.point.z };
        const to = { x: w.x - this.grab.x, z: w.z - this.grab.z };
        entity.point.x = to.x;
        entity.point.z = to.z;
        this.viewport3d?.moveMapEntity(entity.key, from, to);
        this.canvasDirty = true;
        break;
      }
      case 'spawn':
        if (this.spawnAreaStart && !this.markerPlaceMode) {
          this.spawnAreaPreview = {
            minX: Math.min(this.spawnAreaStart.x, w.x),
            minZ: Math.min(this.spawnAreaStart.z, w.z),
            maxX: Math.max(this.spawnAreaStart.x, w.x),
            maxZ: Math.max(this.spawnAreaStart.z, w.z),
          };
          this.viewport3d?.setZonePreview(this.spawnAreaPreview);
          this.canvasDirty = true;
        }
        break;
      case 'zone':
      case 'music':
        if (this.zoneStart) {
          this.zoneBox = {
            minX: Math.min(this.zoneStart.x, w.x),
            minZ: Math.min(this.zoneStart.z, w.z),
            maxX: Math.max(this.zoneStart.x, w.x),
            maxZ: Math.max(this.zoneStart.z, w.z),
          };
          this.viewport3d?.setZonePreview(this.zoneBox);
          this.canvasDirty = true;
        }
        break;
      case 'region':
        if (this.regionStart) {
          this.regionBox = {
            minX: Math.min(this.regionStart.x, w.x),
            minZ: Math.min(this.regionStart.z, w.z),
            maxX: Math.max(this.regionStart.x, w.x),
            maxZ: Math.max(this.regionStart.z, w.z),
          };
          this.canvasDirty = true;
        }
        break;
      default:
        break;
    }
  }

  private editEnd(): void {
    this.pointerEditActive = false;
    switch (this.tool) {
      case 'raise':
      case 'lower':
      case 'smooth':
      case 'flatten':
        if (this.grabSession) {
          this.grabCommit();
          this.inspector.refresh();
          break;
        }
        this.strokeCommit();
        // The stroke mutated terrainEdits in place on the ACTIVE content.
        this.terrainEditsMutated();
        this.inspector.refresh(); // the brush panel's edit-count readout
        break;
      case 'erase':
        this.inspector.refresh();
        break;
      case 'foliage':
        this.foliageCommit();
        break;
      case 'blocker':
        this.commitBlocker();
        break;
      case 'zone':
        void this.finishZoneBox();
        break;
      case 'music':
        this.finishMusicBox();
        break;
      case 'paint':
        this.paintCommit();
        break;
      case 'entity': {
        const mobDrag = this.mobDragStart;
        this.mobDragStart = null;
        if (mobDrag && (mobDrag.dx !== 0 || mobDrag.dz !== 0)) {
          const moves = new Map(
            [...mobDrag.camps].map(([id, entry]) => [
              id,
              {
                camp: entry.camp,
                prev: entry.point,
                next: { x: entry.camp.center.x, z: entry.camp.center.z },
              },
            ]),
          );
          const apply = (side: 'prev' | 'next'): void => {
            for (const [id, move] of moves) {
              const target = move[side];
              const dx = target.x - move.camp.center.x;
              const dz = target.z - move.camp.center.z;
              this.viewport3d?.moveRuntimeMobs(new Set([id]), dx, dz);
              move.camp.center.x = target.x;
              move.camp.center.z = target.z;
            }
            this.entities = buildEntities(this.content);
            this.canvasDirty = true;
          };
          this.pushUndo({
            label: 'move-mobs',
            undo: () => apply('prev'),
            redo: () => apply('next'),
          });
          this.map.meta.updatedAt = now();
          this.markDirty();
          this.inspector.refresh();
          break;
        }
        const start = this.markerDragStart;
        const entity = start
          ? this.entities.find((candidate) => candidate.key === start.key)
          : null;
        this.markerDragStart = null;
        if (start && entity && (entity.point.x !== start.x || entity.point.z !== start.z)) {
          this.pushMarkerUndo(
            start.key,
            { x: start.x, z: start.z },
            { x: entity.point.x, z: entity.point.z },
          );
          this.map.meta.updatedAt = now();
          this.markDirty();
        }
        this.inspector.refresh();
        break;
      }
      case 'spawn':
        if (!this.markerPlaceMode) this.finishSpawnArea();
        break;
      case 'region': {
        // A click (no real drag) with a clipboard pastes at the click point.
        const b = this.regionBox;
        if (
          b &&
          this.clipboard &&
          Math.abs(b.maxX - b.minX) < 1.5 &&
          Math.abs(b.maxZ - b.minZ) < 1.5
        ) {
          this.pasteAt({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
          this.regionBox = null;
        }
        this.regionStart = null;
        this.canvasDirty = true;
        break;
      }
      default:
        break;
    }
  }

  private hover3d(w: Vec2 | null): void {
    if (!w) {
      this.viewport3d?.clearBrush();
      return;
    }
    this.brushRing(w);
  }

  private brushRing(w: Vec2): void {
    if (!this.viewport3d) return;
    let radius = this.brushRadius;
    let color = BRUSH_COLOR[this.tool];
    if (this.tool === 'paint') {
      // The erase option's swatch is 'transparent'; fall back to the accent.
      const custom = this.map.biomePaint?.custom?.find((s) => s.id === this.paintBiome);
      const swatch = BIOME_OPTIONS.find((b) => b.id === this.paintBiome)?.swatch ?? '';
      color = custom
        ? custom.color
        : /^#[0-9a-f]{6}$/i.test(swatch)
          ? Number.parseInt(swatch.slice(1), 16)
          : 0xffd100;
    } else if (this.tool === 'place') {
      radius = Math.max(0.8, this.placeScale * 0.9);
    } else if (this.tool === 'collider') {
      radius = 2;
    } else if (this.tool === 'camp') {
      radius = this.selectedCampDef()?.radius ?? 10;
    } else if (this.tool === 'spawn') {
      radius = 1.6;
    } else if (
      isSelectionTool(this.tool) ||
      this.tool === 'water' ||
      this.tool === 'region' ||
      this.tool === 'blocker' // the wall preview box is the cursor
    ) {
      this.viewport3d.clearBrush();
      return;
    }
    this.viewport3d.setBrush(w.x, w.z, radius, color);
  }

  private tap3d(clientX: number, clientY: number, w: Vec2 | null, additive: boolean): void {
    if (!isSelectionTool(this.tool) || !this.viewport3d) return;
    // Hitbox edit mode captures every Select-mode tap: clicks pick individual
    // hitboxes (Shift/Ctrl+click toggles them in the multi-selection); empty
    // clicks clear the box selection but stay in edit mode.
    if (this.hitboxEdit) {
      const bi = this.viewport3d.pickHitbox(clientX, clientY);
      const sel = this.hitboxEdit.selected;
      if (bi !== null) {
        if (additive) {
          if (sel.has(bi)) sel.delete(bi);
          else sel.add(bi);
        } else {
          sel.clear();
          sel.add(bi);
        }
      } else if (!additive) {
        sel.clear();
      }
      this.syncHitboxEditView();
      this.inspector.refresh();
      return;
    }
    // Bulb badges pick first: a light's sprite is tiny next to placement
    // anchors, so the placement slack radius would otherwise swallow the tap.
    const light = additive ? null : this.viewport3d.pickMapLight(clientX, clientY);
    if (light !== null) {
      this.setSelectedLight(light);
      return;
    }
    // Plain tap cycles through overlapping objects on repeated clicks; Shift+click
    // (additive) keeps the plain nearest pick so toggling stays predictable.
    const idx = additive
      ? this.viewport3d.pickPlacement(clientX, clientY)
      : this.viewport3d.pickPlacementCycling(clientX, clientY);
    if (additive) {
      // Blender Shift+click: toggle in the multi-selection; an empty additive
      // click keeps the selection.
      if (idx !== null) this.togglePlacementInSelection(idx);
      return;
    }
    if (this.selectedLight !== null) this.setSelectedLight(null);
    this.setSelectedPlacement(idx);
    if (idx === null && w) {
      // No placement under the cursor: nothing else is selectable in 3D.
      this.setSelectedPlacement(null);
    }
    this.inspector.refresh();
  }

  // ---- sculpt strokes --------------------------------------------------------------

  private strokeBegin(w: Vec2): void {
    this.strokeStamps = [];
    this.strokeStartIndex = this.map.terrainEdits.length;
    this.strokeCapWarned = false;
    this.strokeRegion = null;
    this.lastStamp = null;
    // Captured for EVERY sculpt tool: a Shift-inverted Smooth stroke becomes
    // Flatten mid-gesture and needs the press-point height as its target.
    this.flattenTarget = terrainHeight(w.x, w.z, this.map.meta.seed);
    this.strokeStep(w);
  }

  // ---- tunnel (cave) strokes -------------------------------------------------------

  /** The bore radius: the shared brush radius clamped to the cave bounds. */
  private tunnelRadius(): number {
    return Math.min(CAVE_MAX_RADIUS, Math.max(CAVE_MIN_RADIUS, this.brushRadius * 0.5));
  }

  /** EVERY cave mutation (stroke, undo/redo) funnels here: the carve changed
   *  terrainHeight, so colliders reseat and the region re-meshes. */
  private cavesMutated(region: RegionBox | null): void {
    invalidateStaticColliders();
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    if (region) {
      this.viewport3d?.rebuildTerrainRegion(region);
      this.viewport3d?.finishTerrainStroke(region);
    }
    this.refreshCaveGuides();
    this.inspector.refresh();
  }

  // ---- Rock Generator tool -----------------------------------------------------

  private rockClick(w: Vec2): void {
    if (this.rockChainMode) {
      const pending = this.pendingRockRig();
      if (pending && pending.points.length >= MAX_ROCK_NODES) {
        this.toasts.error(t('editor.status.caveCapReached', { max: MAX_ROCK_NODES }));
        return;
      }
      this.appendPlacements(
        [
          {
            assetId: ROCK_POINT_ASSET_ID,
            name: pending?.id ?? mintId(),
            x: w.x,
            z: w.z,
            rotY: 0,
            scale: 1,
            collide: false,
          },
        ],
        'rock-point',
      );
      this.refreshRockGuides();
      this.inspector.refresh();
      return;
    }
    this.appendPlacements([this.rockRecord(w.x, w.z, this.rockParams.size)], 'rock');
    this.inspector.refresh();
  }

  /** A generated-rock placement carrying the CURRENT panel sliders. */
  private rockRecord(x: number, z: number, scale: number): AssetPlacement {
    const rec: AssetPlacement = {
      assetId: ROCK_ASSET_ID,
      x,
      z,
      rotY: 0,
      scale,
      collide: false,
      rockSeed: rockSeed(x, z),
      rockNoise: this.rockParams.noise,
      rockDetail: this.rockParams.detail,
      rockSharp: this.rockParams.sharp,
      rockTex: this.rockParams.tex,
    };
    if (this.rockParams.height !== 1) rec.rockHeight = this.rockParams.height;
    if (this.rockParams.depth > 0) rec.rockDepth = this.rockParams.depth;
    if (this.rockParams.jag > 0) rec.rockJag = this.rockParams.jag;
    if (this.rockParams.texId) {
      rec.rockTexId = this.rockParams.texId;
      if (this.rockParams.texTile !== DEFAULT_TEXTURE_TILE_YD) {
        rec.rockTexTile = this.rockParams.texTile;
      }
    }
    return rec;
  }

  /** Every rock chain rig on the map (rock/point placements grouped by the
   *  chain id in placement.name, in document order). */
  private rockRigs(): { id: string; points: AssetPlacement[] }[] {
    const byId = new Map<string, { id: string; points: AssetPlacement[] }>();
    for (const p of this.map.placements) {
      if (p.assetId !== ROCK_POINT_ASSET_ID) continue;
      const id = p.name ?? '';
      if (!id) continue;
      let rig = byId.get(id);
      if (!rig) {
        rig = { id, points: [] };
        byId.set(id, rig);
      }
      rig.points.push(p);
    }
    return [...byId.values()];
  }

  /** The rig still being laid out: the first one with no generated ridge. */
  private pendingRockRig(): { id: string; points: AssetPlacement[] } | null {
    return (
      this.rockRigs().find(
        (r) =>
          !this.map.placements.some((p) => p.assetId === ROCK_RIDGE_ASSET_ID && p.name === r.id),
      ) ?? null
    );
  }

  /** Blue node markers + dotted connectors for every rock rig (all tools). */
  private refreshRockGuides(): void {
    const rigs = this.rockRigs().map((r) => ({
      points: r.points.map((p) => ({ x: p.x, z: p.z, dy: p.y ?? 0 })),
    }));
    this.viewport3d?.setRockChainGuide(rigs.length ? rigs : null);
  }

  /**
   * Ridge mode Generate: ONE merged solid body lofted along the rig's points
   * (buildRockChainModel), replacing the old overlapping-boulder pile. The
   * body's top follows a straight DECK line from the first point's ground to
   * the last point's (spanning dips like a bridge); per-node girth/height come
   * from each point placement's gizmo scale. The rig points stay after
   * Generate: moving or scaling one live-regenerates the ridge.
   */
  private generateRockChain(): void {
    let generated = 0;
    for (const rig of this.rockRigs()) {
      if (rig.points.length < 2) continue;
      if (this.generateRockRidgeForRig(rig, true)) generated++;
    }
    if (generated === 0) this.toasts.error(t('editor.rock.chainTooShort'));
    this.refreshRockGuides();
    this.inspector.refresh();
  }

  /** Build the merged-ridge nodes for a rig (deck line + per-point scale). */
  private rockRidgeNodes(rig: {
    id: string;
    points: AssetPlacement[];
  }): { dx: number; dz: number; dy: number; r: number; h: number }[] | null {
    const pts = rig.points;
    if (pts.length < 2) return null;
    const seed = this.map.meta.seed;
    const lens: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      lens.push(L);
      total += L;
    }
    if (total < 1) return null;
    const anchor = pts[0];
    const anchorGround = terrainHeight(anchor.x, anchor.z, seed);
    const h0 = anchorGround;
    const h1 = terrainHeight(pts[pts.length - 1].x, pts[pts.length - 1].z, seed);
    const size = this.rockParams.size;
    const nodes: {
      dx: number;
      dz: number;
      dy: number;
      r: number;
      h: number;
    }[] = [];
    let arc = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) arc += lens[i - 1];
      const p = pts[i];
      const t01 = arc / total;
      const deckY = h0 + (h1 - h0) * t01;
      const ground = terrainHeight(p.x, p.z, seed);
      // Girth from the point's gizmo scale (uniform * per-axis XZ), height
      // multiplier from its Y scale, both on top of the panel size slider.
      const sxz = p.scale * (((p.scaleX ?? 1) + (p.scaleZ ?? 1)) / 2);
      const sy = p.scale * (p.scaleY ?? 1);
      const r = Math.max(0.5, size * 0.55 * sxz);
      const h = Math.max(0.3, Math.min(3, this.rockParams.height * sy));
      // Ride the deck line where the ground drops away (bridge span); stay
      // ground-seated where the terrain runs higher. The node's Y gizmo adds
      // an authored lift/sink on top (floating arches, buried spans).
      const seatY = Math.max(ground, deckY - r * h * 0.4) + (p.y ?? 0);
      nodes.push({
        dx: p.x - anchor.x,
        dz: p.z - anchor.z,
        dy: seatY - anchorGround,
        r,
        h,
      });
    }
    return nodes;
  }

  /** Create or live-update the merged ridge placement for a rig. */
  private generateRockRidgeForRig(
    rig: { id: string; points: AssetPlacement[] },
    withUndo: boolean,
  ): boolean {
    const nodes = this.rockRidgeNodes(rig);
    if (!nodes) return false;
    const anchor = rig.points[0];
    const existingIndex = this.map.placements.findIndex(
      (p) => p.assetId === ROCK_RIDGE_ASSET_ID && p.name === rig.id,
    );
    if (existingIndex >= 0) {
      // Live regeneration: rebuild the body in place (no undo per drag sample).
      const existing = this.map.placements[existingIndex];
      existing.x = anchor.x;
      existing.z = anchor.z;
      existing.rockNodes = nodes;
      this.map.meta.updatedAt = now();
      this.canvasDirty = true;
      this.viewport3d?.placementAdded(existingIndex);
      return true;
    }
    const seed = this.map.meta.seed;
    const ridge: AssetPlacement = {
      assetId: ROCK_RIDGE_ASSET_ID,
      name: rig.id,
      x: anchor.x,
      z: anchor.z,
      rotY: 0,
      scale: 1,
      collide: false,
      rockSeed: rockSeed(anchor.x, anchor.z),
      rockNoise: this.rockParams.noise,
      rockDetail: this.rockParams.detail,
      rockSharp: this.rockParams.sharp,
      rockTex: this.rockParams.tex,
      rockNodes: nodes,
    };
    if (this.rockParams.jag > 0) ridge.rockJag = this.rockParams.jag;
    if (this.rockParams.texId) {
      ridge.rockTexId = this.rockParams.texId;
      if (this.rockParams.texTile !== DEFAULT_TEXTURE_TILE_YD) {
        ridge.rockTexTile = this.rockParams.texTile;
      }
    }
    const placements: AssetPlacement[] = [ridge];
    // Optional walkable deck: one plane collider per rig segment, following
    // the ridge tops so the span can actually be crossed.
    if (this.rockParams.walkable) {
      const anchorGround = terrainHeight(anchor.x, anchor.z, seed);
      for (let i = 1; i < rig.points.length; i++) {
        const a = rig.points[i - 1];
        const b = rig.points[i];
        const na = nodes[i - 1];
        const nb = nodes[i];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 1) continue;
        const midX = (a.x + b.x) / 2;
        const midZ = (a.z + b.z) / 2;
        const topA = anchorGround + na.dy + na.r * na.h * 1.35;
        const topB = anchorGround + nb.dy + nb.r * nb.h * 1.35;
        placements.push({
          assetId: COLLIDER_ASSET_IDS.plane,
          x: midX,
          z: midZ,
          rotY: Math.atan2(b.x - a.x, b.z - a.z),
          scale: 1,
          collide: true,
          sizeX: Math.max(2, (na.r + nb.r) * 0.9),
          sizeZ: L + Math.min(na.r, nb.r),
          sizeY: (topA + topB) / 2 - terrainHeight(midX, midZ, seed) - 0.4,
          rotX: -Math.atan2(topB - topA, L),
        });
      }
    }
    if (withUndo) this.appendPlacements(placements, 'rock-ridge');
    return true;
  }

  /** Live ridge regeneration while a rig point is dragged/scaled. */
  private regenerateRockRidgeForPoint(p: AssetPlacement): void {
    const id = p.name ?? '';
    if (!id) return;
    const rig = this.rockRigs().find((r) => r.id === id);
    if (rig) this.generateRockRidgeForRig(rig, false);
  }

  /** Clear the pending rig's blue points (one undoable step). */
  private clearRockChain(): void {
    const pending = this.pendingRockRig();
    if (!pending) return;
    const removed: { index: number; placement: AssetPlacement }[] = [];
    for (let i = this.map.placements.length - 1; i >= 0; i--) {
      const p = this.map.placements[i];
      if (p.assetId === ROCK_POINT_ASSET_ID && p.name === pending.id) {
        removed.push({ index: i, placement: p });
        this.map.placements.splice(i, 1);
      }
    }
    if (removed.length === 0) return;
    this.setSelectedPlacement(null);
    this.viewport3d?.rebuildPlacements();
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.refreshRockGuides();
    this.pushUndo({
      label: 'rock-clear-points',
      undo: () => {
        // Reverse order restores ascending indices correctly.
        for (let i = removed.length - 1; i >= 0; i--) {
          this.map.placements.splice(removed[i].index, 0, removed[i].placement);
        }
        this.viewport3d?.rebuildPlacements();
        this.refreshRockGuides();
        this.canvasDirty = true;
      },
      redo: () => {
        for (const r of removed) {
          const at = this.map.placements.indexOf(r.placement);
          if (at >= 0) this.map.placements.splice(at, 1);
        }
        this.viewport3d?.rebuildPlacements();
        this.refreshRockGuides();
        this.canvasDirty = true;
      },
    });
  }

  private tunnelBegin(w: Vec2): void {
    if (this.tunnelMode === 'hole') {
      this.placeTerrainHole(w);
      return;
    }
    if (this.tunnelMode === 'patch') {
      this.placeHolePatch(w);
      return;
    }
    this.placeCaveEndpoint(w);
  }

  /** A rig point's ABSOLUTE floor height. Cave markers are ANCHORED (frozen
   *  ground captured at drop): re-sculpting the terrain under them never
   *  reshapes the cave, and a group Y-lift moves the whole cave rigidly. */
  private rigPointY(p: AssetPlacement): number {
    const anchor = p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.map.meta.seed);
    return anchor + (p.y ?? 0);
  }

  /** The rig flow: the first click drops the ENTRANCE marker; every further
   *  click (until the rig generates) appends a BLUE waypoint. The rig's last
   *  point acts as the exit. All are ordinary placements (gizmo-movable);
   *  Generate (or moving any point of a generated cave) builds the tube. */
  private placeCaveEndpoint(w: Vec2): void {
    const caves = this.map.caves ?? [];
    if (caves.length >= MAX_CAVES) {
      this.toasts.error(t('editor.status.caveCapReached', { max: MAX_CAVES }));
      return;
    }
    // A rig with no generated cave yet is the pending one being laid out.
    const pending = this.caveRigs().find((r) => !caves.some((c) => c.id === r.id));
    if (pending && pending.points.length >= MAX_CAVE_RIG_POINTS) {
      this.toasts.error(t('editor.status.caveCapReached', { max: MAX_CAVE_RIG_POINTS }));
      return;
    }
    // Anchored at the CURRENT surface height: the node keeps this elevation
    // (gizmo Y adjusts it) no matter what happens to the terrain later.
    const placement: AssetPlacement = {
      assetId: pending ? CAVE_POINT_ASSET_ID : CAVE_ENTRANCE_ASSET_ID,
      name: pending ? pending.id : mintId(),
      x: w.x,
      z: w.z,
      rotY: 0,
      scale: 1,
      collide: false,
      detached: true,
      groundY: terrainHeight(w.x, w.z, this.map.meta.seed),
    };
    this.appendPlacements([placement], 'cave-point');
    this.inspector.refresh();
    this.refreshCaveGuides();
  }

  /** Every cave rig on the map, keyed by the shared cave id carried in
   *  placement.name: the ORDERED control points (entrance first, waypoints in
   *  document order, a legacy exit marker last). */
  private caveRigs(): { id: string; points: AssetPlacement[] }[] {
    const byId = new Map<
      string,
      {
        id: string;
        entrance: AssetPlacement[];
        mid: AssetPlacement[];
        exit: AssetPlacement[];
      }
    >();
    for (const p of this.map.placements) {
      if (
        p.assetId !== CAVE_ENTRANCE_ASSET_ID &&
        p.assetId !== CAVE_EXIT_ASSET_ID &&
        p.assetId !== CAVE_POINT_ASSET_ID
      ) {
        continue;
      }
      const id = p.name ?? '';
      if (!id) continue;
      let rig = byId.get(id);
      if (!rig) {
        rig = { id, entrance: [], mid: [], exit: [] };
        byId.set(id, rig);
      }
      if (p.assetId === CAVE_ENTRANCE_ASSET_ID) rig.entrance.push(p);
      else if (p.assetId === CAVE_EXIT_ASSET_ID) rig.exit.push(p);
      else rig.mid.push(p);
    }
    return [...byId.values()].map((r) => ({
      id: r.id,
      points: [...r.entrance, ...r.mid, ...r.exit],
    }));
  }

  /** Generated tubes' flow lines plus every rig's blue control points and
   *  dotted connector. Always visible (every tool): the rig points are real
   *  placements the Move/Scale gizmos edit, so hiding them outside the Caves
   *  tool made in-progress rigs read as lost. */
  private refreshCaveGuides(): void {
    this.viewport3d?.setCaveGuides(
      this.map.caves ?? [],
      this.caveRigs().map((r) => ({
        points: r.points.map((p) => ({ x: p.x, y: this.rigPointY(p), z: p.z })),
      })),
    );
  }

  /** Generate (or re-generate) the cave for a rig. Keeps the existing cave's
   *  width/height/variance/spike sliders across regenerations. TERRAIN-BLIND:
   *  the tube runs exactly through the rig points at exactly their authored
   *  girth, so nothing about the surrounding ground can squish or reshape it. */
  private generateCaveForRig(
    rig: { id: string; points: AssetPlacement[] },
    withUndo: boolean,
  ): void {
    if (rig.points.length < 2) return;
    const seed = this.map.meta.seed;
    const caves = this.cavesRef();
    const existing = caves.find((c) => c.id === rig.id);
    // The bore radius is AUTHORED at first generate and stored on the cave:
    // regenerating (a node move) must never pick up the live brush slider, or
    // the cave silently changes girth mid-edit.
    const radius = existing?.radius ?? this.tunnelRadius();
    const nodes = generateCaveRigNodes(
      // Each rig point's gizmo scale sets the bore girth THERE (uniform scale
      // times the XZ per-axis average); its anchored elevation + Y offset IS
      // the cave floor there (rigPointY), interpolated along the path.
      rig.points.map((p) => ({
        x: p.x,
        y: this.rigPointY(p),
        z: p.z,
        r: p.scale * (((p.scaleX ?? 1) + (p.scaleZ ?? 1)) / 2),
      })),
      radius,
      {
        variance: existing?.variance ?? DEFAULT_CAVE_VARIANCE,
        seed: seed + caveWobbleSeed(rig.id),
      },
    );
    if (nodes.length < 2) {
      this.toasts.error(t('editor.tunnel.tooShort'));
      return;
    }
    const prevNodes = existing ? existing.nodes : null;
    const oldRegion = existing ? this.caveRegion(existing) : null;
    let cave: CaveDef;
    if (existing) {
      existing.nodes = nodes;
      if (existing.radius === undefined) existing.radius = radius;
      cave = existing;
    } else {
      cave = { id: rig.id, nodes, radius, variance: DEFAULT_CAVE_VARIANCE };
      caves.push(cave);
    }
    const region = this.caveRegion(cave);
    const union: RegionBox = oldRegion
      ? {
          minX: Math.min(oldRegion.minX, region.minX),
          minZ: Math.min(oldRegion.minZ, region.minZ),
          maxX: Math.max(oldRegion.maxX, region.maxX),
          maxZ: Math.max(oldRegion.maxZ, region.maxZ),
        }
      : region;
    this.cavesMutated(union);
    if (!withUndo) return;
    this.pushUndo({
      label: 'cave-generate',
      undo: () => {
        if (prevNodes) cave.nodes = prevNodes;
        else {
          const i = caves.indexOf(cave);
          if (i >= 0) caves.splice(i, 1);
        }
        this.cavesMutated(union);
      },
      redo: () => {
        if (prevNodes) cave.nodes = nodes;
        else caves.push(cave);
        this.cavesMutated(union);
      },
    });
  }

  /** The Tunnel panel's Generate button: build every rig with at least two
   *  points that has no cave yet (each as its own undo step). */
  private generatePendingCaves(): void {
    const caves = this.map.caves ?? [];
    for (const rig of this.caveRigs()) {
      if (rig.points.length < 2) continue;
      if (caves.some((c) => c.id === rig.id)) continue;
      this.generateCaveForRig(rig, true);
    }
    this.inspector.refresh();
  }

  /** Live regeneration while any rig point is dragged/moved. */
  private regenerateCaveForEndpoint(p: AssetPlacement): void {
    const id = p.name ?? '';
    if (!id) return;
    if (!this.map.caves?.some((c) => c.id === id)) return; // not generated yet
    const rig = this.caveRigs().find((q) => q.id === id);
    if (rig) this.generateCaveForRig(rig, false);
  }

  /** EVERY hole mutation (punch, resize, delete, undo/redo) funnels here:
   *  the shader cutout uniforms re-upload and the grass/dressing over the
   *  cutout re-scatter. Terrain heights are untouched (holes only remove the
   *  sheet), so no chunk re-mesh is needed ? just the region's decor. */
  private holesMutated(region: RegionBox | null): void {
    refreshTerrainHoles();
    invalidateStaticColliders();
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    if (region) {
      this.viewport3d?.rebuildTerrainRegion(region);
      this.viewport3d?.finishTerrainStroke(region);
    }
    this.refreshHoleGuides();
    this.inspector.refresh();
  }

  private refreshHoleGuides(): void {
    const show = this.tool === 'tunnel';
    this.viewport3d?.setHoleGuides(
      show ? (this.map.holes ?? []) : null,
      show ? (this.map.holePatches ?? []) : null,
    );
  }

  private holeRegion(hole: TerrainHole): RegionBox {
    const b = holeBounds(hole);
    return {
      minX: b.minX - 2,
      minZ: b.minZ - 2,
      maxX: b.maxX + 2,
      maxZ: b.maxZ + 2,
    };
  }

  /** Hole mode: one click punches a sphere cutout through the terrain sheet
   *  (brush radius wide) ? a real opening you can drop or walk through when a
   *  cave tube runs underneath. */
  private placeTerrainHole(w: Vec2): void {
    const holes = this.holesRef();
    if (holes.length >= MAX_TERRAIN_HOLES) {
      this.toasts.error(t('editor.status.holeCapReached', { max: MAX_TERRAIN_HOLES }));
      return;
    }
    const hole: TerrainHole = {
      x: w.x,
      y: terrainHeight(w.x, w.z, this.map.meta.seed),
      z: w.z,
      radius: Math.min(HOLE_MAX_RADIUS, Math.max(HOLE_MIN_RADIUS, this.brushRadius)),
    };
    holes.push(hole);
    const region = this.holeRegion(hole);
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-punch',
      undo: () => {
        const i = holes.indexOf(hole);
        if (i >= 0) holes.splice(i, 1);
        this.holesMutated(region);
      },
      redo: () => {
        holes.push(hole);
        this.holesMutated(region);
      },
    });
  }

  /** Hole panel edits: the per-hole radius slider (live while dragging, one
   *  undo step at commit). */
  private updateHole(index: number, change: { radius?: number }, commit: boolean): void {
    const hole = this.map.holes?.[index];
    if (!hole) return;
    const base =
      this.holeEditBase?.index === index ? this.holeEditBase : { index, radius: hole.radius };
    this.holeEditBase = base;
    if (change.radius !== undefined) {
      hole.radius = Math.min(HOLE_MAX_RADIUS, Math.max(HOLE_MIN_RADIUS, change.radius));
    }
    const region = this.holeRegion({
      ...hole,
      radius: Math.max(hole.radius, base.radius),
    });
    // Live: uniforms only (cheap). Commit: full region refresh + undo.
    refreshTerrainHoles();
    this.canvasDirty = true;
    if (!commit) return;
    this.holeEditBase = null;
    const prev = base.radius;
    const next = hole.radius;
    if (prev === next) return;
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-size',
      undo: () => {
        hole.radius = prev;
        this.holesMutated(region);
      },
      redo: () => {
        hole.radius = next;
        this.holesMutated(region);
      },
    });
  }

  private deleteHole(index: number): void {
    const holes = this.holesRef();
    const hole = holes[index];
    if (!hole) return;
    const region = this.holeRegion(hole);
    holes.splice(index, 1);
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-delete',
      undo: () => {
        holes.splice(index, 0, hole);
        this.holesMutated(region);
      },
      redo: () => {
        const i = holes.indexOf(hole);
        if (i >= 0) holes.splice(i, 1);
        this.holesMutated(region);
      },
    });
  }

  /** Patch mode: one click drops a patch sphere (brush radius wide) that
   *  RESTORES the ground inside any hole cutouts it overlaps ? fills in the
   *  unwanted blank parts around the cuts. */
  private placeHolePatch(w: Vec2): void {
    const patches = this.holePatchesRef();
    if (patches.length >= MAX_HOLE_PATCHES) {
      this.toasts.error(t('editor.status.holeCapReached', { max: MAX_HOLE_PATCHES }));
      return;
    }
    const patch: TerrainHole = {
      x: w.x,
      y: terrainHeight(w.x, w.z, this.map.meta.seed),
      z: w.z,
      radius: Math.min(HOLE_MAX_RADIUS, Math.max(HOLE_MIN_RADIUS, this.brushRadius)),
    };
    patches.push(patch);
    const region = this.holeRegion(patch);
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-patch',
      undo: () => {
        const i = patches.indexOf(patch);
        if (i >= 0) patches.splice(i, 1);
        this.holesMutated(region);
      },
      redo: () => {
        patches.push(patch);
        this.holesMutated(region);
      },
    });
  }

  /** Patch panel edits: the per-patch radius slider (live while dragging,
   *  one undo step at commit). */
  private updateHolePatch(index: number, change: { radius?: number }, commit: boolean): void {
    const patch = this.map.holePatches?.[index];
    if (!patch) return;
    const base =
      this.holePatchEditBase?.index === index
        ? this.holePatchEditBase
        : { index, radius: patch.radius };
    this.holePatchEditBase = base;
    if (change.radius !== undefined) {
      patch.radius = Math.min(HOLE_MAX_RADIUS, Math.max(HOLE_MIN_RADIUS, change.radius));
    }
    const region = this.holeRegion({
      ...patch,
      radius: Math.max(patch.radius, base.radius),
    });
    refreshTerrainHoles();
    this.canvasDirty = true;
    if (!commit) return;
    this.holePatchEditBase = null;
    const prev = base.radius;
    const next = patch.radius;
    if (prev === next) return;
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-patch-size',
      undo: () => {
        patch.radius = prev;
        this.holesMutated(region);
      },
      redo: () => {
        patch.radius = next;
        this.holesMutated(region);
      },
    });
  }

  private deleteHolePatch(index: number): void {
    const patches = this.holePatchesRef();
    const patch = patches[index];
    if (!patch) return;
    const region = this.holeRegion(patch);
    patches.splice(index, 1);
    this.holesMutated(region);
    this.pushUndo({
      label: 'hole-patch-delete',
      undo: () => {
        patches.splice(index, 0, patch);
        this.holesMutated(region);
      },
      redo: () => {
        const i = patches.indexOf(patch);
        if (i >= 0) patches.splice(i, 1);
        this.holesMutated(region);
      },
    });
  }

  /** "Select whole cave": multi-select every rig marker of the cave and arm
   *  the Move tool, so the existing group gizmo translates the entire tube
   *  rigidly (XZ drag and Y lift both move every node by the same delta; the
   *  regenerated chain is translation-covariant, so the shape is preserved
   *  exactly while you line the mouth up with a hole). */
  private selectWholeCave(index: number): void {
    const cave = this.map.caves?.[index];
    if (!cave) return;
    const indices: number[] = [];
    for (let i = 0; i < this.map.placements.length; i++) {
      const p = this.map.placements[i];
      if (
        (p.assetId === CAVE_ENTRANCE_ASSET_ID ||
          p.assetId === CAVE_EXIT_ASSET_ID ||
          p.assetId === CAVE_POINT_ASSET_ID) &&
        p.name === cave.id
      ) {
        indices.push(i);
      }
    }
    if (indices.length === 0) {
      this.toasts.error(t('editor.tunnel.noRig'));
      return;
    }
    this.setTool('move');
    this.selectPlacements(indices);
  }

  /** Cave panel edits: width/height multipliers, organic variance (re-bores
   *  through the rig), spike densities, reverse A<->B, delete. */
  private updateCave(
    index: number,
    change: {
      width?: number;
      height?: number;
      variance?: number;
      floorVariance?: number;
      stalactites?: number;
      stalagmites?: number;
      spikeSize?: number;
      startOpen?: boolean;
      endOpen?: boolean;
      tex?: string | null;
      texTile?: number | null;
    },
    commit: boolean,
  ): void {
    const cave = this.map.caves?.[index];
    if (!cave) return;
    const base =
      this.caveEditBase?.cave === cave
        ? this.caveEditBase
        : {
            cave,
            width: cave.width ?? 1,
            height: cave.height ?? 1,
            variance: cave.variance ?? 0,
            floorVariance: cave.floorVariance ?? 0,
            stalactites: cave.stalactites ?? 0,
            stalagmites: cave.stalagmites ?? 0,
            spikeSize: cave.spikeSize ?? 1,
            startOpen: cave.startOpen !== false,
            endOpen: cave.endOpen !== false,
            tex: cave.tex ?? null,
            texTile: cave.texTile ?? null,
            nodes: cave.nodes,
          };
    this.caveEditBase = base;
    if (change.width !== undefined)
      cave.width = Math.min(CAVE_MAX_MULT, Math.max(CAVE_MIN_MULT, change.width));
    if (change.height !== undefined)
      cave.height = Math.min(CAVE_MAX_MULT, Math.max(CAVE_MIN_MULT, change.height));
    // Floor bumps live in the shared sampler (sim sheet + mesh): no re-bore
    // needed, the region rebuild below refreshes the mesh.
    if (change.floorVariance !== undefined)
      cave.floorVariance = Math.min(1, Math.max(0, change.floorVariance));
    if (change.stalactites !== undefined)
      cave.stalactites = Math.min(1, Math.max(0, change.stalactites));
    if (change.stalagmites !== undefined)
      cave.stalagmites = Math.min(1, Math.max(0, change.stalagmites));
    if (change.spikeSize !== undefined) {
      cave.spikeSize = Math.min(
        CAVE_SPIKE_SIZE_MAX,
        Math.max(CAVE_SPIKE_SIZE_MIN, change.spikeSize),
      );
    }
    // Mouth toggles: open is the default; store only an explicit seal.
    if (change.startOpen !== undefined) {
      if (change.startOpen) delete cave.startOpen;
      else cave.startOpen = false;
    }
    if (change.endOpen !== undefined) {
      if (change.endOpen) delete cave.endOpen;
      else cave.endOpen = false;
    }
    if (change.tex !== undefined) {
      if (change.tex === null) delete cave.tex;
      else cave.tex = change.tex;
    }
    if (change.texTile !== undefined) {
      if (change.texTile === null) delete cave.texTile;
      else cave.texTile = Math.min(64, Math.max(1, change.texTile));
    }
    if (change.variance !== undefined) {
      cave.variance = Math.min(1, Math.max(0, change.variance));
      // Variance shapes the tube itself: re-generate through the rig live.
      const rig = this.caveRigs().find((r) => r.id === cave.id);
      if (rig && rig.points.length >= 2) this.generateCaveForRig(rig, false);
    }
    const region = this.caveRegion(cave);
    invalidateStaticColliders();
    this.viewport3d?.rebuildTerrainRegion(region);
    this.canvasDirty = true;
    if (!commit) return;
    this.caveEditBase = null;
    const snapshot = (): {
      width: number;
      height: number;
      variance: number;
      floorVariance: number;
      stalactites: number;
      stalagmites: number;
      spikeSize: number;
      startOpen: boolean;
      endOpen: boolean;
      tex: string | null;
      texTile: number | null;
      nodes: CaveNode[];
    } => ({
      width: cave.width ?? 1,
      height: cave.height ?? 1,
      variance: cave.variance ?? 0,
      floorVariance: cave.floorVariance ?? 0,
      stalactites: cave.stalactites ?? 0,
      stalagmites: cave.stalagmites ?? 0,
      spikeSize: cave.spikeSize ?? 1,
      startOpen: cave.startOpen !== false,
      endOpen: cave.endOpen !== false,
      tex: cave.tex ?? null,
      texTile: cave.texTile ?? null,
      nodes: cave.nodes,
    });
    const prev = {
      width: base.width,
      height: base.height,
      variance: base.variance,
      floorVariance: base.floorVariance,
      stalactites: base.stalactites,
      stalagmites: base.stalagmites,
      spikeSize: base.spikeSize,
      startOpen: base.startOpen,
      endOpen: base.endOpen,
      tex: base.tex,
      texTile: base.texTile,
      nodes: base.nodes,
    };
    const next = snapshot();
    this.viewport3d?.finishTerrainStroke(region);
    this.map.meta.updatedAt = now();
    const apply = (v: typeof prev): void => {
      cave.width = v.width;
      cave.height = v.height;
      cave.variance = v.variance;
      cave.floorVariance = v.floorVariance;
      cave.stalactites = v.stalactites;
      cave.stalagmites = v.stalagmites;
      cave.spikeSize = v.spikeSize;
      if (v.startOpen) delete cave.startOpen;
      else cave.startOpen = false;
      if (v.endOpen) delete cave.endOpen;
      else cave.endOpen = false;
      if (v.tex === null) delete cave.tex;
      else cave.tex = v.tex;
      if (v.texTile === null) delete cave.texTile;
      else cave.texTile = v.texTile;
      cave.nodes = v.nodes;
      this.cavesMutated(this.caveRegion(cave));
    };
    this.pushUndo({
      label: 'cave-size',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
  }

  private reverseCave(index: number): void {
    const cave = this.map.caves?.[index];
    if (!cave) return;
    cave.nodes.reverse();
    this.map.meta.updatedAt = now();
    this.refreshCaveGuides();
    this.inspector.refresh();
    this.pushUndo({
      label: 'cave-reverse',
      undo: () => {
        cave.nodes.reverse();
        this.refreshCaveGuides();
        this.inspector.refresh();
      },
      redo: () => {
        cave.nodes.reverse();
        this.refreshCaveGuides();
        this.inspector.refresh();
      },
    });
  }

  private deleteCave(index: number): void {
    const caves = this.cavesRef();
    const cave = caves[index];
    if (!cave) return;
    const region = this.caveRegion(cave);
    caves.splice(index, 1);
    // The cave's rig points go with it (they exist to regenerate it).
    const markers = this.map.placements.filter(
      (p) =>
        (p.assetId === CAVE_ENTRANCE_ASSET_ID ||
          p.assetId === CAVE_EXIT_ASSET_ID ||
          p.assetId === CAVE_POINT_ASSET_ID) &&
        p.name === cave.id,
    );
    const markerIndices = markers.map((m) => this.map.placements.indexOf(m)).sort((a, b) => b - a);
    for (const mi of markerIndices) this.map.placements.splice(mi, 1);
    this.setSelectedPlacement(null);
    this.viewport3d?.rebuildPlacements();
    this.cavesMutated(region);
    this.pushUndo({
      label: 'cave-delete',
      undo: () => {
        caves.splice(index, 0, cave);
        this.map.placements.push(...markers);
        this.viewport3d?.rebuildPlacements();
        this.cavesMutated(this.caveRegion(cave));
      },
      redo: () => {
        const i = caves.indexOf(cave);
        if (i >= 0) caves.splice(i, 1);
        for (const m of markers) {
          const mi = this.map.placements.indexOf(m);
          if (mi >= 0) this.map.placements.splice(mi, 1);
        }
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.cavesMutated(this.caveRegion(cave));
      },
    });
  }

  private caveRegion(cave: CaveDef): RegionBox {
    const b = caveBounds(cave);
    return {
      minX: b.minX - 4,
      minZ: b.minZ - 4,
      maxX: b.maxX + 4,
      maxZ: b.maxZ + 4,
    };
  }

  // ---- Grab sculpt (snake hook) ---------------------------------------------------

  /** Press: plant ONE live stamp under the brush; the drag pulls it. */
  private grabBegin(w: Vec2, ev: PointerEvent): void {
    if (this.map.terrainEdits.length >= MAX_TERRAIN_EDITS) {
      this.warnTerrainCap();
      return;
    }
    const stamp: HeightStamp = {
      x: w.x,
      z: w.z,
      radius: this.brushRadius,
      delta: 0,
      falloff: 'smooth',
    };
    this.map.terrainEdits.push(stamp);
    const wpp =
      this.viewMode === '3d'
        ? (this.viewport3d?.worldPerPixel(w.x, w.z) ?? 0.1)
        : 1 / Math.max(1e-3, this.cam.pxPerYard);
    const pad = stamp.radius + 2;
    this.grabSession = {
      stamp,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      startX: w.x,
      startZ: w.z,
      wpp,
      axes: this.viewMode === '3d' ? (this.viewport3d?.viewPlaneAxes() ?? null) : null,
      region: {
        minX: w.x - pad,
        minZ: w.z - pad,
        maxX: w.x + pad,
        maxZ: w.z + pad,
      },
    };
  }

  /** Drag: the cursor motion (camera-scaled) IS the pull. In 3D it maps onto
   *  the camera's view plane, so the grabbed ground follows the drag in all
   *  three axes ? sideways slides the bump, up on screen lifts it, down
   *  shoves it in. In 2D top-down only the height pull applies. */
  private grabStep(ev: PointerEvent): void {
    const g = this.grabSession;
    if (!g) return;
    const dxPx = ev.clientX - g.startClientX;
    const dyPx = g.startClientY - ev.clientY; // up-screen positive
    const s = g.stamp;
    const pad = s.radius + 2;
    const prevMinX = s.x - pad;
    const prevMinZ = s.z - pad;
    const prevMaxX = s.x + pad;
    const prevMaxZ = s.z + pad;
    if (g.axes) {
      const { right, up } = g.axes;
      const wx = (right.x * dxPx + up.x * dyPx) * g.wpp;
      const wy = (right.y * dxPx + up.y * dyPx) * g.wpp;
      const wz = (right.z * dxPx + up.z * dyPx) * g.wpp;
      s.x = g.startX + wx;
      s.z = g.startZ + wz;
      s.delta = Math.max(-200, Math.min(200, wy));
    } else {
      s.delta = Math.max(-200, Math.min(200, dyPx * g.wpp));
    }
    // Rebuild the union of the stamp's previous and current footprints (it
    // moves under a lateral drag); the session region keeps the union of the
    // whole gesture for the commit/undo rebuilds.
    const step: RegionBox = {
      minX: Math.min(prevMinX, s.x - pad),
      minZ: Math.min(prevMinZ, s.z - pad),
      maxX: Math.max(prevMaxX, s.x + pad),
      maxZ: Math.max(prevMaxZ, s.z + pad),
    };
    g.region = {
      minX: Math.min(g.region.minX, step.minX),
      minZ: Math.min(g.region.minZ, step.minZ),
      maxX: Math.max(g.region.maxX, step.maxX),
      maxZ: Math.max(g.region.maxZ, step.maxZ),
    };
    this.terrainEditsMutated();
    this.viewport3d?.rebuildTerrainRegion(step);
    this.canvasDirty = true;
  }

  /** Release: keep the pulled shape as one undoable stamp (a no-op pull is
   *  dropped silently). */
  private grabCommit(): void {
    const g = this.grabSession;
    this.grabSession = null;
    if (!g) return;
    const edits = this.map.terrainEdits;
    const region = g.region;
    if (Math.abs(g.stamp.delta) < 0.05) {
      const i = edits.indexOf(g.stamp);
      if (i >= 0) edits.splice(i, 1);
      this.terrainEditsMutated();
      this.viewport3d?.rebuildTerrainRegion(region);
      return;
    }
    const stamp = g.stamp;
    this.terrainEditsMutated();
    this.viewport3d?.finishTerrainStroke(region);
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.pushUndo({
      label: 'sculpt-grab',
      undo: () => {
        const i = edits.indexOf(stamp);
        if (i >= 0) edits.splice(i, 1);
        this.terrainEditsMutated();
        this.viewport3d?.rebuildTerrainRegion(region);
        this.viewport3d?.finishTerrainStroke(region);
        this.canvasDirty = true;
      },
      redo: () => {
        edits.push(stamp);
        this.terrainEditsMutated();
        this.viewport3d?.rebuildTerrainRegion(region);
        this.viewport3d?.finishTerrainStroke(region);
        this.canvasDirty = true;
      },
    });
  }

  /** One warning per stroke/action when the terrain-edit cap swallows stamps. */
  private warnTerrainCap(): void {
    if (this.strokeCapWarned) return;
    this.strokeCapWarned = true;
    this.toasts.error(t('editor.status.terrainCapReached', { max: MAX_TERRAIN_EDITS }));
  }

  /**
   * EVERY mutation of map.content.terrainEdits (stroke, erase, paste, hills,
   * and each undo/redo closure over them) funnels here: the cached collider
   * grid and the sim's terrain-edit spatial index are both stale.
   */
  private terrainEditsMutated(): void {
    invalidateStaticColliders();
    invalidateTerrainEditIndex();
  }

  private strokeStep(w: Vec2): void {
    const spacing = this.brushRadius * 0.5;
    if (this.lastStamp) {
      const dx = w.x - this.lastStamp.x;
      const dz = w.z - this.lastStamp.z;
      if (dx * dx + dz * dz < spacing * spacing) return;
    }
    if (this.map.terrainEdits.length >= MAX_TERRAIN_EDITS) {
      this.warnTerrainCap();
      return;
    }
    const seed = this.map.meta.seed;
    let stamp: HeightStamp;
    // The rail merged raise+lower into one Sculpt tool (direction checkbox)
    // and flatten+smooth into one Level tool (mode checkbox); the legacy tool
    // ids still route here for safety. Holding Shift (strokeInvert) flips the
    // active sub-mode for this stamp: raise<->lower and smooth<->flatten.
    const isLevelTool = this.tool === 'smooth' || this.tool === 'flatten';
    if (isLevelTool) {
      // Base mode: Smooth tool smooths; Flatten tool smooths only when its
      // "smooth mode" checkbox is on. Shift inverts that choice.
      let smoothing = this.tool === 'smooth' || (this.tool === 'flatten' && this.flattenSmooth);
      if (this.strokeInvert) smoothing = !smoothing;
      if (smoothing) {
        stamp = smoothStamp(w.x, w.z, this.brushRadius, this.effectiveBrushStrength(), (x, z) =>
          terrainHeight(x, z, seed),
        );
      } else {
        // Flatten eases toward the captured target by SCULPT_POWER_SCALE (a
        // fifth of the way from the current surface per stamp), the 5x-gentler
        // twin of the Smooth reduction above.
        stamp = flattenStamp(
          w.x,
          w.z,
          this.brushRadius,
          this.flattenTarget,
          this.flattenHardEdge,
          terrainHeight(w.x, w.z, seed),
          SCULPT_POWER_SCALE,
        );
      }
    } else {
      // Raise/Lower: base direction from the tool + the "lower" checkbox, then
      // Shift flips it (a Shift-click on Raise lowers, and vice versa).
      let down = this.tool === 'lower' || (this.tool === 'raise' && this.sculptLower);
      if (this.strokeInvert) down = !down;
      const strength = this.effectiveBrushStrength();
      stamp = {
        x: w.x,
        z: w.z,
        radius: this.brushRadius,
        delta: down ? -strength : strength,
        falloff: 'smooth',
      };
    }
    this.map.terrainEdits.push(stamp);
    this.strokeStamps.push(stamp);
    this.lastStamp = { x: w.x, z: w.z };
    const region = stampRegion(stamp);
    this.strokeRegion = unionRegion(this.strokeRegion, region);
    this.viewport3d?.rebuildTerrainRegion(region);
    this.canvasDirty = true;
  }

  private strokeCommit(): void {
    if (this.strokeStamps.length === 0) return;
    const stamps = this.strokeStamps;
    const start = this.strokeStartIndex;
    const region = this.strokeRegion;
    this.strokeStamps = [];
    this.strokeRegion = null;
    if (region) this.viewport3d?.finishTerrainStroke(region);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'sculpt-stroke',
      undo: () => {
        removeSpan(this.map.terrainEdits, start, stamps);
        this.terrainEditsMutated();
        this.refreshTerrain(region);
      },
      redo: () => {
        this.map.terrainEdits.push(...stamps);
        this.terrainEditsMutated();
        this.refreshTerrain(region);
      },
    });
    if (this.autoTexture.enabled && region) this.autoTexturize(region);
  }

  /**
   * Slope-based auto texture (its own undo step, right after the stroke): every
   * paint cell in the sculpted region gets the flat or steep texture by the
   * ground angle at its center. A band id of -1 leaves that band's paint alone,
   * so "rock the cliffs, keep my meadows" works without repainting everything.
   */
  private autoTexturize(region: RegionBox): void {
    const cfg = this.autoTexture;
    // Did WE create the paint grid here? If so, its whole lifetime must be tied
    // to this undo step: a bare ensureBiomeGrid that then paints nothing (or is
    // undone) would otherwise leave a phantom all-255 grid behind.
    const createdGrid = this.map.biomePaint == null;
    this.ensureBiomeGrid();
    const bp = this.map.biomePaint;
    if (!bp) return;
    // The ownership map is keyed by cell index into ONE grid. If the grid was
    // swapped (resampled to a finer cell), the indices no longer line up, so
    // drop ownership: reshaping still updates paint going forward, we just lose
    // "restore the pre-auto texture" for cells painted before the resample.
    if (this.autoTexOwnedGrid !== bp) {
      this.autoTexOwned.clear();
      this.autoTexOwnedGrid = bp;
    }
    // Both bands "leave as is" still needs the loop: cells this tool previously
    // owned whose band is now "leave as is" must be RESTORED, not skipped.
    const owned = this.autoTexOwned;
    const seed = this.map.meta.seed;
    const threshold = Math.tan((Math.min(85, Math.max(5, cfg.angle)) * Math.PI) / 180);
    const c0 = Math.max(0, Math.floor((region.minX - bp.originX) / bp.cell));
    const c1 = Math.min(bp.cols - 1, Math.floor((region.maxX - bp.originX) / bp.cell));
    const r0 = Math.max(0, Math.floor((region.minZ - bp.originZ) / bp.cell));
    const r1 = Math.min(bp.rows - 1, Math.floor((region.maxZ - bp.originZ) / bp.cell));
    // Each change records the id delta AND the ownership delta so undo/redo keep
    // the ownership map consistent with the paint grid.
    const changes: {
      idx: number;
      prev: number;
      next: number;
      ownPrev: number | undefined;
      ownNext: number | undefined;
    }[] = [];
    const eps = bp.cell / 2;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cx = bp.originX + (col + 0.5) * bp.cell;
        const cz = bp.originZ + (row + 0.5) * bp.cell;
        const hx = terrainHeight(cx + eps, cz, seed) - terrainHeight(cx - eps, cz, seed);
        const hz = terrainHeight(cx, cz + eps, seed) - terrainHeight(cx, cz - eps, seed);
        const slope = Math.hypot(hx, hz) / (2 * eps);
        const desired = slope > threshold ? cfg.steepId : cfg.flatId;
        const idx = row * bp.cols + col;
        const cur = bp.ids[idx];
        const ownPrev = owned.get(idx);
        if (desired >= 0) {
          // Paint the band's texture; remember the cell's ORIGINAL (pre-auto)
          // id so a later reshape can undo the auto paint.
          if (cur === desired) continue;
          const base = ownPrev !== undefined ? ownPrev : cur;
          changes.push({
            idx,
            prev: cur,
            next: desired,
            ownPrev,
            ownNext: base,
          });
          bp.ids[idx] = desired;
          owned.set(idx, base);
        } else if (ownPrev !== undefined) {
          // "Leave as is" band, but this tool painted here before: restore the
          // pre-auto texture and release ownership (this is the reshape fix).
          if (cur === ownPrev) {
            owned.delete(idx);
            continue;
          }
          changes.push({
            idx,
            prev: cur,
            next: ownPrev,
            ownPrev,
            ownNext: undefined,
          });
          bp.ids[idx] = ownPrev;
          owned.delete(idx);
        }
      }
    }
    if (changes.length === 0) {
      // Nothing to auto-paint: tear a freshly-created grid back down so it does
      // not linger as an un-undoable empty grid.
      if (createdGrid) {
        this.map.biomePaint = undefined;
        this.activeWorld.biomePaint = undefined;
        this.autoTexOwnedGrid = null;
      }
      return;
    }
    const grid = bp;
    this.refreshTerrain(region);
    this.pushUndo({
      label: 'auto-texture',
      undo: () => {
        for (const ch of changes) {
          grid.ids[ch.idx] = ch.prev;
          if (ch.ownPrev === undefined) owned.delete(ch.idx);
          else owned.set(ch.idx, ch.ownPrev);
        }
        // Detach the grid we created here so undo fully reverses it.
        if (createdGrid) {
          this.map.biomePaint = undefined;
          this.activeWorld.biomePaint = undefined;
        }
        this.refreshTerrain(region);
      },
      redo: () => {
        if (createdGrid) {
          this.map.biomePaint = grid;
          this.activeWorld.biomePaint = grid;
        }
        for (const ch of changes) {
          grid.ids[ch.idx] = ch.next;
          if (ch.ownNext === undefined) owned.delete(ch.idx);
          else owned.set(ch.idx, ch.ownNext);
        }
        this.refreshTerrain(region);
      },
    });
  }

  // ---- named locations / AI markers / point lights ---------------------------------

  /** Overlay + panel refresh shared by every authored-list mutation. */
  private authoredListsChanged(): void {
    this.viewport3d?.refreshAuthoredOverlays();
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.inspector.refresh();
    this.canvasDirty = true;
  }

  /** Zone tool release: name the dragged box and store it as a location. */
  private async finishZoneBox(): Promise<void> {
    const box = this.zoneBox;
    this.zoneStart = null;
    this.zoneBox = null;
    this.viewport3d?.setZonePreview(null);
    if (!box || box.maxX - box.minX < 2 || box.maxZ - box.minZ < 2) return;
    if ((this.map.locations?.length ?? 0) >= MAX_LOCATIONS) return;
    const name = await promptDialog(
      this.root,
      t('editor.zoneTool.namePrompt'),
      t('editor.zoneTool.namePrompt'),
      '',
    );
    if (!name || !name.trim()) return;
    const loc = { name: name.trim().slice(0, MAX_LOCATION_NAME), ...box };
    if (!this.map.locations) this.map.locations = [];
    const list = this.map.locations;
    list.push(loc);
    this.authoredListsChanged();
    this.pushUndo({
      label: 'add-location',
      undo: () => {
        const i = list.indexOf(loc);
        if (i >= 0) list.splice(i, 1);
        this.authoredListsChanged();
      },
      redo: () => {
        list.push(loc);
        this.authoredListsChanged();
      },
    });
  }

  /** Select a map light: bulb badge enlarges + range ring shows in 3D, the
   *  panel highlights the row. Exclusive with the placement selection. */
  private setSelectedLight(index: number | null): void {
    if (index !== null) {
      this.setSelectedPlacement(null);
      if (this.selectedSound !== null) {
        this.selectedSound = null;
        this.viewport3d?.setSelectedSound(null);
      }
    }
    this.selectedLight = index;
    this.viewport3d?.setSelectedLight(index);
    this.inspector.refresh();
  }

  private deleteMapLight(index: number): void {
    const list = this.map.lights;
    const light = list?.[index];
    if (!list || !light) return;
    list.splice(index, 1);
    if (this.selectedLight !== null) {
      this.selectedLight =
        this.selectedLight === index
          ? null
          : this.selectedLight > index
            ? this.selectedLight - 1
            : this.selectedLight;
      this.viewport3d?.setSelectedLight(this.selectedLight);
    }
    this.authoredListsChanged();
    this.pushUndo({
      label: 'delete-light',
      undo: () => {
        list.splice(Math.min(index, list.length), 0, light);
        this.authoredListsChanged();
      },
      redo: () => {
        const i = list.indexOf(light);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedLight !== null) {
          this.selectedLight = null;
          this.viewport3d?.setSelectedLight(null);
        }
        this.authoredListsChanged();
      },
    });
  }

  /** Music tool release: assign the panel's selected track to the dragged box
   *  (a click without a real drag does nothing; the map-wide track lives in
   *  the panel). One undoable step. A plain CLICK (no real drag) instead
   *  picks the smallest existing area under the cursor, so rects can be
   *  selected and deleted in-world. */
  private finishMusicBox(): void {
    const box = this.zoneBox;
    this.zoneStart = null;
    this.zoneBox = null;
    this.viewport3d?.setZonePreview(null);
    if (!box) return;
    if (box.maxX - box.minX < 2 || box.maxZ - box.minZ < 2) {
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      this.setSelectedMusicArea(this.musicAreaAt(cx, cz));
      return;
    }
    if (!this.map.music) this.map.music = {};
    const music = this.map.music;
    if (!music.areas) music.areas = [];
    const list = music.areas;
    if (list.length >= MAX_MUSIC_AREAS) {
      this.toasts.error(t('editor.music.areaCap', { max: MAX_MUSIC_AREAS }));
      return;
    }
    const area = { ...box, track: this.musicAreaTrack };
    list.push(area);
    this.setSelectedMusicArea(list.length - 1);
    this.musicChanged();
    this.pushUndo({
      label: 'add-music-area',
      undo: () => {
        const i = list.indexOf(area);
        if (i >= 0) list.splice(i, 1);
        this.setSelectedMusicArea(null);
        this.musicChanged();
      },
      redo: () => {
        list.push(area);
        this.musicChanged();
      },
    });
  }

  /** The smallest music area containing (x, z), or null (matches the game's
   *  smallest-rect-wins playback rule, so you pick what you hear). */
  private musicAreaAt(x: number, z: number): number | null {
    const areas = this.map.music?.areas;
    if (!areas) return null;
    let best: number | null = null;
    let bestSize = Number.POSITIVE_INFINITY;
    for (let i = 0; i < areas.length; i++) {
      const a = areas[i];
      if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
      const size = (a.maxX - a.minX) * (a.maxZ - a.minZ);
      if (size < bestSize) {
        bestSize = size;
        best = i;
      }
    }
    return best;
  }

  /** Select a music area: its rect brightens in 3D, the panel row highlights. */
  private setSelectedMusicArea(index: number | null): void {
    this.selectedMusicArea = index;
    this.viewport3d?.setSelectedMusicArea(index);
    this.inspector.refresh();
  }

  /** Remove one music area (panel x, or Delete/X with one selected): one
   *  undoable step, with the selection kept coherent across the index shift. */
  private deleteMusicArea(index: number): void {
    const list = this.map.music?.areas;
    const area = list?.[index];
    if (!list || !area) return;
    list.splice(index, 1);
    if (this.selectedMusicArea !== null) {
      this.selectedMusicArea =
        this.selectedMusicArea === index
          ? null
          : this.selectedMusicArea > index
            ? this.selectedMusicArea - 1
            : this.selectedMusicArea;
      this.viewport3d?.setSelectedMusicArea(this.selectedMusicArea);
    }
    this.musicChanged();
    this.pushUndo({
      label: 'delete-music-area',
      undo: () => {
        // The list may have been pruned off the document while empty: reattach.
        if (!this.map.music) this.map.music = {};
        if (!this.map.music.areas) this.map.music.areas = list;
        list.splice(Math.min(index, list.length), 0, area);
        this.musicChanged();
      },
      redo: () => {
        const i = list.indexOf(area);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedMusicArea !== null) {
          this.selectedMusicArea = null;
          this.viewport3d?.setSelectedMusicArea(null);
        }
        this.musicChanged();
      },
    });
  }

  /** Every music mutation funnels here: prune empty structures so a default
   *  map stays field-free, then refresh overlays + panel. */
  private musicChanged(): void {
    const m = this.map.music;
    if (m) {
      if (m.areas && m.areas.length === 0) delete m.areas;
      if (!m.zoneTrack && !m.areas) this.map.music = undefined;
    }
    if (this.map.music) this.activeWorld.music = this.map.music;
    else delete this.activeWorld.music;
    this.authoredListsChanged();
  }

  private placeLight(w: Vec2): void {
    if (!this.map.lights) this.map.lights = [];
    const list = this.map.lights;
    if (list.length >= MAX_LIGHTS) {
      this.toasts.error(t('editor.lightTool.capReached', { max: MAX_LIGHTS }));
      return;
    }
    // Bright enough to read clearly against the day rig (decay 1.8 falls off
    // fast, so a timid default just vanished into the sunlight). Campfires run
    // ~12; an authored lamp starts a touch hotter so placing one visibly DOES
    // something even at noon.
    const light = {
      x: Math.round(w.x * 10) / 10,
      z: Math.round(w.z * 10) / 10,
      y: 2,
      color: 0xffb46a,
      intensity: 14,
      range: 32,
    };
    list.push(light);
    this.selectedLight = list.length - 1;
    this.viewport3d?.setSelectedLight(this.selectedLight);
    this.authoredListsChanged();
    this.pushUndo({
      label: 'add-light',
      undo: () => {
        const i = list.indexOf(light);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedLight !== null) {
          this.selectedLight = null;
          this.viewport3d?.setSelectedLight(null);
        }
        this.authoredListsChanged();
      },
      redo: () => {
        list.push(light);
        this.authoredListsChanged();
      },
    });
  }

  /** Select a map point sound: its badge enlarges + radius sphere shows in 3D,
   *  the panel highlights the row. Exclusive with the placement/light selection. */
  private setSelectedSound(index: number | null): void {
    if (index !== null) {
      this.setSelectedPlacement(null);
      if (this.selectedLight !== null) {
        this.selectedLight = null;
        this.viewport3d?.setSelectedLight(null);
      }
    }
    this.selectedSound = index;
    this.viewport3d?.setSelectedSound(index);
    this.inspector.refresh();
  }

  private placeSound(w: Vec2): void {
    if (!this.map.pointSounds) this.map.pointSounds = [];
    const list = this.map.pointSounds;
    if (list.length >= MAX_POINT_SOUNDS) {
      this.toasts.error(t('editor.soundTool.capReached', { max: MAX_POINT_SOUNDS }));
      return;
    }
    const sound = {
      x: Math.round(w.x * 10) / 10,
      z: Math.round(w.z * 10) / 10,
      y: 2,
      sound: DEFAULT_POINT_SOUND,
      volume: 0.6,
      radius: 24,
    };
    list.push(sound);
    this.selectedSound = list.length - 1;
    this.viewport3d?.setSelectedSound(this.selectedSound);
    this.authoredListsChanged();
    this.pushUndo({
      label: 'add-point-sound',
      undo: () => {
        const i = list.indexOf(sound);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedSound !== null) {
          this.selectedSound = null;
          this.viewport3d?.setSelectedSound(null);
        }
        this.authoredListsChanged();
      },
      redo: () => {
        list.push(sound);
        this.authoredListsChanged();
      },
    });
  }

  private deleteMapSound(index: number): void {
    const list = this.map.pointSounds;
    const sound = list?.[index];
    if (!list || !sound) return;
    list.splice(index, 1);
    if (this.selectedSound !== null) {
      this.selectedSound =
        this.selectedSound === index
          ? null
          : this.selectedSound > index
            ? this.selectedSound - 1
            : this.selectedSound;
      this.viewport3d?.setSelectedSound(this.selectedSound);
    }
    this.authoredListsChanged();
    this.pushUndo({
      label: 'delete-point-sound',
      undo: () => {
        list.splice(Math.min(index, list.length), 0, sound);
        this.authoredListsChanged();
      },
      redo: () => {
        const i = list.indexOf(sound);
        if (i >= 0) list.splice(i, 1);
        if (this.selectedSound !== null) {
          this.selectedSound = null;
          this.viewport3d?.setSelectedSound(null);
        }
        this.authoredListsChanged();
      },
    });
  }

  private addMarker(w: Vec2): void {
    if (!this.map.markers) this.map.markers = [];
    const list = this.map.markers;
    if (list.length >= MAX_MARKERS) {
      this.toasts.error(t('editor.markerTool.capReached', { max: MAX_MARKERS }));
      return;
    }
    const kindLabel = t(
      this.markerKind === 'object' ? 'editor.markerTool.object' : 'editor.markerTool.npc',
    );
    const marker = {
      name: t('editor.markerTool.defaultName', {
        kind: kindLabel,
        num: formatNumber(list.length + 1, { useGrouping: false }),
      }),
      kind: this.markerKind,
      x: Math.round(w.x * 10) / 10,
      z: Math.round(w.z * 10) / 10,
    };
    list.push(marker);
    this.authoredListsChanged();
    this.pushUndo({
      label: 'add-marker',
      undo: () => {
        const i = list.indexOf(marker);
        if (i >= 0) list.splice(i, 1);
        this.authoredListsChanged();
      },
      redo: () => {
        list.push(marker);
        this.authoredListsChanged();
      },
    });
  }

  private refreshTerrain(region: RegionBox | null): void {
    if (region) {
      this.viewport3d?.rebuildTerrainRegion(region);
      this.viewport3d?.finishTerrainStroke(region);
    } else {
      this.viewport3d?.rebuildTerrainFull();
    }
    this.canvasDirty = true;
  }

  // ---- biome paint --------------------------------------------------------------

  private ensureBiomeGrid(): void {
    if (this.map.biomePaint) return;
    const b = this.worldBounds();
    // Adaptive cell: as fine as this map's extent affords (1yd for small maps,
    // 2yd for world-size ones), so strokes stop reading as chunky blocks.
    const cell = finestPaintCell(b.maxX - b.minX, b.maxZ - b.minZ);
    const cols = Math.ceil((b.maxX - b.minX) / cell) + 1;
    const rows = Math.ceil((b.maxZ - b.minZ) / cell) + 1;
    this.map.biomePaint = {
      cell,
      cols,
      rows,
      originX: b.minX,
      originZ: b.minZ,
      ids: new Array(cols * rows).fill(255),
    };
    this.activeWorld.biomePaint = this.map.biomePaint;
    this.paintCreatedGrid = true;
  }

  /** Maps saved with the old coarse 4yd grid upsample (losslessly, nearest
   *  neighbor) to today's finest cell the moment a new stroke starts, so they
   *  get the smooth brush too. One undoable step, pushed BEFORE the stroke. */
  private refineBiomeGridForPainting(): void {
    const coarse = this.map.biomePaint;
    if (!coarse) return;
    const b = this.worldBounds();
    const fine = resampleBiomePaint(coarse, finestPaintCell(b.maxX - b.minX, b.maxZ - b.minZ));
    if (!fine) return;
    this.map.biomePaint = fine;
    this.activeWorld.biomePaint = fine;
    this.map.meta.updatedAt = now();
    // Visually identical (same painted footprint), so no terrain rebuild here;
    // the stroke that follows rebuilds its own region.
    this.pushUndo({
      label: 'paint-refine',
      undo: () => {
        this.map.biomePaint = coarse;
        this.activeWorld.biomePaint = coarse;
        this.refreshTerrain(null);
      },
      redo: () => {
        this.map.biomePaint = fine;
        this.activeWorld.biomePaint = fine;
        this.refreshTerrain(null);
      },
    });
  }

  /** Sculpt strength in HEIGHT units: the 1..50 slider over a 5x finer scale
   *  than the legacy 1..30 one (slider 5 == legacy 1), for gentle grading. */
  private effectiveBrushStrength(): number {
    return this.brushStrength / 5;
  }

  private paintBegin(w: Vec2): void {
    this.refineBiomeGridForPainting();
    this.paintChanges = new Map();
    this.paintCreatedGrid = false;
    this.strokeRegion = null;
    this.paintStep(w);
  }

  private paintStep(w: Vec2): void {
    this.ensureBiomeGrid();
    const bp = this.map.biomePaint;
    if (!bp) return;
    const r = this.brushRadius;
    // Photoshop-style hardness: inside hardness*r every cell paints; across
    // the rim the paint DITHERS out with a quadratic falloff (a deterministic
    // per-cell gate, so re-strokes never flicker). The renderer's bilinear
    // feather then melts the dithered rim into a genuinely soft edge.
    const hard = Math.min(1, Math.max(0, this.paintHardness / 100));
    // Optional brush alpha: a grayscale mask across the brush footprint that
    // modulates the stamp coverage (splatter, streaks, ...).
    const alphaMask = brushAlphaById(this.paintAlphaId);
    const c0 = Math.floor((w.x - r - bp.originX) / bp.cell);
    const c1 = Math.floor((w.x + r - bp.originX) / bp.cell);
    const r0 = Math.floor((w.z - r - bp.originZ) / bp.cell);
    const r1 = Math.floor((w.z + r - bp.originZ) / bp.cell);
    let touched = false;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (col < 0 || col >= bp.cols || row < 0 || row >= bp.rows) continue;
        const cx = bp.originX + (col + 0.5) * bp.cell;
        const cz = bp.originZ + (row + 0.5) * bp.cell;
        const dx = cx - w.x;
        const dz = cz - w.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        // Stamp coverage at this cell: the alpha mask value (1 with none),
        // faded by the quadratic hardness falloff across the rim; one
        // deterministic per-cell gate decides, so undo/redo never flickers.
        let coverage = alphaMask ? sampleBrushAlpha(alphaMask, dx / r, dz / r) : 1;
        if (hard < 1) {
          const d = Math.sqrt(d2) / r;
          if (d > hard) {
            const t = (d - hard) / Math.max(0.001, 1 - hard);
            coverage *= 1 - t * t;
          }
        }
        if (coverage <= 0) continue;
        if (coverage < 1) {
          const gate = ((((col * 73856093) ^ (row * 19349663)) >>> 0) % 997) / 997;
          if (gate >= coverage) continue;
        }
        const idx = row * bp.cols + col;
        if (bp.ids[idx] === this.paintBiome) continue;
        const change = this.paintChanges.get(idx);
        if (change) change.next = this.paintBiome;
        else
          this.paintChanges.set(idx, {
            prev: bp.ids[idx],
            next: this.paintBiome,
          });
        bp.ids[idx] = this.paintBiome;
        touched = true;
      }
    }
    if (touched) {
      const region = {
        minX: w.x - r,
        minZ: w.z - r,
        maxX: w.x + r,
        maxZ: w.z + r,
      };
      this.strokeRegion = unionRegion(this.strokeRegion, region);
      this.viewport3d?.rebuildTerrainRegion(region);
      this.canvasDirty = true;
    }
  }

  /**
   * Paint bucket: replace EVERY cell painted with the texture under the
   * cursor by the currently selected swatch, map-wide, as one undo step.
   * Clicking unpainted ground floods the whole unpainted base.
   */
  private bucketFill(w: Vec2): void {
    this.refineBiomeGridForPainting();
    this.ensureBiomeGrid();
    const bp = this.map.biomePaint;
    if (!bp) return;
    const col = Math.floor((w.x - bp.originX) / bp.cell);
    const row = Math.floor((w.z - bp.originZ) / bp.cell);
    if (col < 0 || col >= bp.cols || row < 0 || row >= bp.rows) return;
    const target = bp.ids[row * bp.cols + col];
    if (target === this.paintBiome) return;
    const changes = new Map<number, { prev: number; next: number }>();
    for (let i = 0; i < bp.ids.length; i++) {
      if (bp.ids[i] !== target) continue;
      changes.set(i, { prev: target, next: this.paintBiome });
      bp.ids[i] = this.paintBiome;
    }
    this.bucketArmed = false;
    if (changes.size === 0) {
      this.inspector.refresh();
      return;
    }
    const grid = bp;
    this.refreshTerrain(null);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'paint-bucket',
      undo: () => {
        for (const [idx, ch] of changes) grid.ids[idx] = ch.prev;
        this.refreshTerrain(null);
      },
      redo: () => {
        for (const [idx, ch] of changes) grid.ids[idx] = ch.next;
        this.refreshTerrain(null);
      },
    });
    this.inspector.refresh();
    this.toasts.success(
      t('editor.biome.bucketDone', {
        count: formatNumber(changes.size, { useGrouping: false }),
      }),
    );
  }

  private paintCommit(): void {
    if (this.paintChanges.size === 0 && !this.paintCreatedGrid) return;
    const changes = this.paintChanges;
    const createdGrid = this.paintCreatedGrid;
    const region = this.strokeRegion;
    const grid = this.map.biomePaint;
    this.paintChanges = new Map();
    this.paintCreatedGrid = false;
    this.strokeRegion = null;
    if (region) this.viewport3d?.finishTerrainStroke(region);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'paint-stroke',
      undo: () => {
        if (createdGrid) {
          this.map.biomePaint = undefined;
          this.activeWorld.biomePaint = undefined;
        } else if (grid) {
          for (const [idx, ch] of changes) grid.ids[idx] = ch.prev;
        }
        this.refreshTerrain(region);
      },
      redo: () => {
        if (createdGrid && grid) {
          this.map.biomePaint = grid;
          this.activeWorld.biomePaint = grid;
        }
        if (grid) for (const [idx, ch] of changes) grid.ids[idx] = ch.next;
        this.refreshTerrain(region);
      },
    });
  }

  /**
   * Add a maker-defined color swatch to the paint palette (stored on the
   * document's biomePaint layer, so it saves/exports with the map) and select
   * it for painting.
   */
  /** Pick a built-in library texture: reuse the map's existing swatch for it
   *  or materialize a new one (builtin: pseudo-sha resolves from the bundle on
   *  every machine, so these default textures always load). */
  private pickBuiltinTexture(key: string): void {
    const set = terrainTextureSet(key);
    if (!set) return;
    const sha = builtinShaFor(key);
    const existing = this.map.biomePaint?.custom?.find((c) => c.textureSha === sha);
    if (existing) {
      this.paintBiome = existing.id;
      this.inspector.refresh();
      return;
    }
    this.addCustomSwatch(set.color, set.name, sha);
  }

  private addCustomSwatch(
    color: number,
    label: string,
    textureSha?: string,
    baseBiome?: number,
  ): CustomPaintSwatch | null {
    this.ensureBiomeGrid();
    const bp = this.map.biomePaint;
    if (!bp) return null;
    if (!bp.custom) bp.custom = [];
    const list = bp.custom;
    if (list.length >= MAX_CUSTOM_PAINT_SWATCHES) {
      this.toasts.error(t('editor.biome.customFull', { max: MAX_CUSTOM_PAINT_SWATCHES }));
      return null;
    }
    const used = new Set(list.map((s) => s.id));
    let id = CUSTOM_PAINT_ID_MIN;
    while (used.has(id) && id <= CUSTOM_PAINT_ID_MAX) id++;
    if (id > CUSTOM_PAINT_ID_MAX) return null;
    const trimmed = label.trim().slice(0, MAX_SWATCH_LABEL_LENGTH);
    const swatch: CustomPaintSwatch = trimmed ? { id, color, label: trimmed } : { id, color };
    if (textureSha) {
      swatch.textureSha = textureSha;
      swatch.tileSize = DEFAULT_TEXTURE_TILE_YD;
    }
    if (baseBiome !== undefined) swatch.baseBiome = baseBiome;
    list.push(swatch);
    this.paintBiome = id;
    this.map.meta.updatedAt = now();
    this.markDirty();
    // A textured swatch claims a splat slot: (re)load the material uniforms.
    if (textureSha) refreshCustomGroundTextures();
    this.inspector.refresh();
    return swatch;
  }

  /**
   * Hue/light adjust of the ACTIVE paint texture. A custom swatch (imported
   * texture or biome variant) edits its own fields; a built-in biome routes
   * through a custom VARIANT swatch (created on first use, reused after) so
   * the adjust persists in the map document, which stores only swatch ids in
   * the paint grid. Already-painted cells update live via a paint-field
   * rebake, coalesced to one per frame.
   */
  private setPaintAdjust(change: { hueShift?: number; light?: number }): void {
    let createdNow = false;
    let sw = this.map.biomePaint?.custom?.find((c) => c.id === this.paintBiome);
    if (!sw) {
      const base = this.paintBiome;
      const opt = BIOME_OPTIONS.find((o) => o.id === base && o.id !== 255);
      if (!opt) return; // not a paintable built-in and not a custom swatch
      const existing = this.map.biomePaint?.custom?.find((c) => c.baseBiome === base && !c.saved);
      if (existing) {
        sw = existing;
        this.paintBiome = existing.id;
        createdNow = true; // selection changed: refresh AFTER the values land
      } else {
        const label = `${t(opt.labelKey as Parameters<typeof t>[0])} *`;
        const created = this.addCustomSwatch(
          Number.parseInt(opt.swatch.slice(1), 16),
          label,
          undefined,
          base,
        );
        if (!created) return;
        sw = created;
        createdNow = true;
      }
    }
    if (change.hueShift !== undefined) {
      const v = Math.max(-180, Math.min(180, change.hueShift));
      if (v === 0) delete sw.hueShift;
      else sw.hueShift = v;
    }
    if (change.light !== undefined) {
      const v = Math.max(-1, Math.min(1, change.light));
      if (v === 0) delete sw.light;
      else sw.light = v;
    }
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.schedulePaintAdjustRebake();
    // A variant created THIS call was refreshed (inside addCustomSwatch)
    // before the slider value landed on it; refresh again so the panel
    // renders the actual adjust rather than a centered slider.
    if (createdNow) this.inspector.refresh();
  }

  /**
   * Copy the ACTIVE adjusted swatch (biome variant or tinted import) into its
   * own saved swatch, so the tint can be reused after the working sliders
   * move on. The copy is selected for painting; `saved` keeps the biome
   * sliders' auto-variant reuse from ever mutating it.
   */
  private saveAdjustedSwatch(): void {
    const sw = this.map.biomePaint?.custom?.find((c) => c.id === this.paintBiome);
    if (!sw || (!sw.hueShift && !sw.light)) return;
    const base = (sw.label ?? '').replace(/ \*$/, '');
    const hue = sw.hueShift ?? 0;
    const light = Math.round((sw.light ?? 0) * 100);
    const parts = [
      hue !== 0 ? `${hue > 0 ? '+' : ''}${hue}?` : '',
      light !== 0 ? `${light > 0 ? '+' : ''}${light}` : '',
    ];
    const label = `${base} ${parts.filter(Boolean).join(' ')}`.trim();
    const created = this.addCustomSwatch(sw.color, label, sw.textureSha, sw.baseBiome);
    if (!created) return;
    created.saved = true;
    if (sw.hueShift !== undefined) created.hueShift = sw.hueShift;
    if (sw.light !== undefined) created.light = sw.light;
    if (sw.tileSize !== undefined) created.tileSize = sw.tileSize;
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.schedulePaintAdjustRebake();
    this.inspector.refresh();
    this.toasts.info(t('editor.biome.swatchSaved', { name: label }));
  }

  // Coalesce slider ticks into one full paint-field rebake per frame (the
  // rebake is the expensive part; range inputs can fire far faster).
  private paintAdjustRebakeQueued = false;
  private schedulePaintAdjustRebake(): void {
    if (this.paintAdjustRebakeQueued) return;
    this.paintAdjustRebakeQueued = true;
    requestAnimationFrame(() => {
      this.paintAdjustRebakeQueued = false;
      rebakePaintFieldSwatches();
      this.canvasDirty = true;
    });
  }

  /** Tile size (yards per repeat) of a textured custom swatch. */
  private setSwatchTileSize(id: number, tileSize: number): void {
    const sw = this.map.biomePaint?.custom?.find((c) => c.id === id);
    if (!sw) return;
    sw.tileSize = Math.min(64, Math.max(1, tileSize));
    this.map.meta.updatedAt = now();
    this.markDirty();
    refreshCustomGroundTextures();
  }

  /** Update the per-map auto-texturing rules; only explicit FALSE flags are
   *  stored so a default map keeps no terrainStyle field at all. */
  private setTerrainStyle(
    change: Partial<{
      slopeRock: boolean;
      snowCaps: boolean;
      rimMountains: boolean;
      shoreSand: boolean;
    }>,
  ): void {
    const merged = { ...(this.map.terrainStyle ?? {}), ...change };
    const next: TerrainStyle = {};
    if (merged.slopeRock === false) next.slopeRock = false;
    if (merged.snowCaps === false) next.snowCaps = false;
    if (merged.rimMountains === false) next.rimMountains = false;
    if (merged.shoreSand === false) next.shoreSand = false;
    this.map.terrainStyle = Object.keys(next).length > 0 ? next : undefined;
    if (this.map.terrainStyle) this.activeWorld.terrainStyle = this.map.terrainStyle;
    else delete this.activeWorld.terrainStyle;
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.refreshTerrain(null);
    this.inspector.refresh();
  }

  /** Ambience "world speed" (cosmetic motion only): stored on the document (so
   *  playtest inherits it) and pushed live to the editor preview. 1 = normal. */
  private setWorldSpeed(v: number): void {
    const clamped = Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, v));
    if (clamped === 1) delete this.map.timeScale;
    else this.map.timeScale = clamped;
    if (clamped === 1) delete this.activeWorld.timeScale;
    else this.activeWorld.timeScale = clamped;
    this.viewport3d?.setWorldSpeed(clamped);
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.inspector.refresh();
  }

  /** Placed-asset view distance (render-only perf knob): stored on the document
   *  so playtest inherits it, and pushed live to the editor preview. */
  private setAssetViewDistance(v: number): void {
    const clamped = Math.min(MAX_ASSET_VIEW_DISTANCE, Math.max(MIN_ASSET_VIEW_DISTANCE, v));
    if (clamped === DEFAULT_ASSET_VIEW_DISTANCE) delete this.map.assetViewDistance;
    else this.map.assetViewDistance = clamped;
    if (clamped === DEFAULT_ASSET_VIEW_DISTANCE) delete this.activeWorld.assetViewDistance;
    else this.activeWorld.assetViewDistance = clamped;
    this.viewport3d?.setAssetViewDistance(clamped);
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.inspector.refresh();
  }

  /** Clearing every painted cell is destructive: confirm before firing. */
  private async confirmClearBiomePaint(): Promise<void> {
    if (!this.map.biomePaint) return;
    const ok = await confirmDialog(this.root, {
      title: t('editor.biome.clear'),
      body: t('editor.biome.clearConfirm'),
      danger: true,
    });
    if (ok) this.clearBiomePaint();
  }

  private clearBiomePaint(): void {
    const grid = this.map.biomePaint;
    if (!grid) return;
    this.map.biomePaint = undefined;
    this.activeWorld.biomePaint = undefined;
    this.map.meta.updatedAt = now();
    this.refreshTerrain(null);
    this.pushUndo({
      label: 'clear-biome-paint',
      undo: () => {
        this.map.biomePaint = grid;
        this.activeWorld.biomePaint = grid;
        this.refreshTerrain(null);
      },
      redo: () => {
        this.map.biomePaint = undefined;
        this.activeWorld.biomePaint = undefined;
        this.refreshTerrain(null);
      },
    });
  }

  // ---- blocker walls ---------------------------------------------------------------

  private clearBlockerDraft(): void {
    this.blockerStart = null;
    if (this.blockerPreview) {
      this.blockerPreview = null;
      this.viewport3d?.setBlockerPreview(null);
      this.canvasDirty = true;
    }
  }

  /** Release of a blocker drag: store the previewed segment (already length-
   *  clamped by the preview step); a sub-minimum drag cancels silently. */
  private commitBlocker(): void {
    const seg = this.blockerPreview;
    this.clearBlockerDraft();
    if (!seg) return;
    const blockers = this.blockersRef();
    if (blockers.length >= MAX_BLOCKERS) {
      this.toasts.error(t('editor.status.blockerCapReached', { max: MAX_BLOCKERS }));
      return;
    }
    blockers.push(seg);
    this.blockersMutated();
    this.inspector.refresh(); // the blocker panel's count readout
    this.pushUndo({
      label: 'add-blocker',
      undo: () => {
        const list = this.blockersRef();
        const i = list.indexOf(seg);
        if (i >= 0) list.splice(i, 1);
        this.blockersMutated();
        this.inspector.refresh();
      },
      redo: () => {
        this.blockersRef().push(seg);
        this.blockersMutated();
        this.inspector.refresh();
      },
    });
  }

  private removeBlockerAt(index: number): void {
    const blockers = this.blockersRef();
    const seg = blockers[index];
    if (!seg) return;
    blockers.splice(index, 1);
    this.blockersMutated();
    this.inspector.refresh();
    this.pushUndo({
      label: 'erase-blocker',
      undo: () => {
        this.blockersRef().splice(index, 0, seg);
        this.blockersMutated();
        this.inspector.refresh();
      },
      redo: () => {
        this.blockersRef().splice(index, 1);
        this.blockersMutated();
        this.inspector.refresh();
      },
    });
  }

  // ---- erase -----------------------------------------------------------------------

  private eraseAt(w: Vec2): void {
    // Throttle drag erasing so one sweep does not delete a whole cluster at once.
    if (this.eraseLast) {
      const dx = w.x - this.eraseLast.x;
      const dz = w.z - this.eraseLast.z;
      if (dx * dx + dz * dz < 4) return;
    }
    this.eraseLast = { x: w.x, z: w.z };
    const pi = erasePlacementIndex(this.map.placements, w.x, w.z, this.brushRadius);
    if (pi >= 0) {
      this.removePlacementAt(pi);
      return;
    }
    // Blocker walls next, with a tight threshold. Erase deliberately never
    // touches terrain stamps: on flat authoring maps the flatness itself is
    // leveling stamps, so a stamp eraser quietly cratered the landscape.
    // Sculpt mistakes are what Undo is for.
    const bi = nearestBlockerIndex(this.map.blockers ?? [], w.x, w.z);
    if (bi >= 0) this.removeBlockerAt(bi);
  }

  // ---- placements ----------------------------------------------------------------

  private placeAt(w: Vec2): void {
    if (!this.placeAssetId) {
      this.toasts.info(t('editor.status.assetPlacedFirst'));
      return;
    }
    const placement: AssetPlacement = {
      assetId: this.placeAssetId,
      x: w.x,
      z: w.z,
      rotY: this.placeRandomRot ? Math.random() * Math.PI * 2 : 0,
      scale: this.placeScale,
      collide: this.placeCollide,
    };
    // A saved hitbox preset for this asset (this device) is the maker's word:
    // every fresh placement copies those boxes.
    const preset = this.hitboxPresets[this.placeAssetId];
    if (this.placeCollide && preset && preset.length > 0) {
      placement.hitboxes = preset.map((b) => ({ ...b }));
    }
    this.appendPlacements([placement], 'place-asset');
    // A fresh placement lands selected under the Move gizmo (Blender flow);
    // the cap may have rejected it, so only when it actually landed.
    const index = this.map.placements.lastIndexOf(placement);
    if (index >= 0) {
      this.setSelectedPlacement(index);
      this.setTool('move');
    }
  }

  private appendPlacements(placements: AssetPlacement[], label: string): void {
    const clamp = clampToCap(placements, this.map.placements.length, MAX_PLACEMENTS);
    if (clamp.truncated) {
      this.toasts.error(t('editor.status.placementCapReached', { max: MAX_PLACEMENTS }));
    }
    const accepted = clamp.accepted;
    if (accepted.length === 0) return;
    const start = appendSpan(this.map.placements, accepted);
    for (let i = 0; i < accepted.length; i++) this.viewport3d?.placementAdded(start + i);
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.pushUndo({
      label,
      undo: () => {
        removeSpan(this.map.placements, start, accepted);
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.refreshCaveGuides();
        this.refreshRockGuides();
        this.canvasDirty = true;
      },
      redo: () => {
        this.map.placements.push(...accepted);
        this.viewport3d?.rebuildPlacements();
        this.refreshCaveGuides();
        this.refreshRockGuides();
        this.canvasDirty = true;
      },
    });
    this.refreshCaveGuides();
    this.refreshRockGuides();
  }

  private removePlacementAt(index: number): void {
    const placement = this.map.placements[index];
    if (!placement) return;
    this.map.placements.splice(index, 1);
    this.setSelectedPlacement(null);
    // Surgical single removal: the view drops one slot, no full re-clone.
    this.viewport3d?.placementRemoved(index);
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.pushUndo({
      label: 'remove-placement',
      undo: () => {
        // Mid-list insert shifts every later index: full re-instance.
        this.map.placements.splice(index, 0, placement);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
      redo: () => {
        this.map.placements.splice(index, 1);
        this.setSelectedPlacement(null);
        this.viewport3d?.placementRemoved(index);
        this.canvasDirty = true;
      },
    });
    this.inspector.refresh();
  }

  private setSelectedPlacement(index: number | null): void {
    // Switching objects (or clearing) leaves hitbox-edit mode.
    if (this.hitboxEdit && this.hitboxEdit.index !== index) this.exitHitboxEdit();
    if (this.selectedPlacement !== index) {
      // An open wheel/nudge burst on the OLD selection commits now, or its
      // live changes would silently drop out of the undo history.
      this.flushTransformCommit();
      this.placementDragBase = null;
      this.groupDragBase = null;
    }
    this.selectedPlacement = index;
    // Single-select semantics: the set collapses to the new active. Additive
    // callers (Shift+click, group drags) restore their wider set afterward.
    this.selectedSet = index === null ? new Set() : new Set([index]);
    this.viewport3d?.setSelectedPlacement(index);
    this.syncMultiSelectionView();
  }

  /** The orange member rings in the 3D view (active excluded: it has the
   *  renderer's gold ring). */
  private syncMultiSelectionView(): void {
    this.viewport3d?.setMultiSelection(
      [...this.selectedSet].filter((i) => i !== this.selectedPlacement),
    );
  }

  /** Ctrl+drag box select (3D marquee): select every placement in the box. */
  private selectPlacements(indices: number[]): void {
    if (indices.length === 0) {
      this.setSelectedPlacement(null);
      this.inspector.refresh();
      this.canvasDirty = true;
      return;
    }
    this.selectedKey = null;
    this.selectedCamp = null;
    this.setSelectedPlacement(indices[0]);
    this.selectedSet = new Set(indices);
    this.syncMultiSelectionView();
    this.inspector.refresh();
    this.canvasDirty = true;
  }

  /** Blender Shift+click: toggle a placement in the multi-selection. */
  private togglePlacementInSelection(index: number): void {
    if (this.selectedSet.has(index)) {
      const rest = new Set(this.selectedSet);
      rest.delete(index);
      const nextActive =
        this.selectedPlacement === index ? ([...rest].pop() ?? null) : this.selectedPlacement;
      this.setSelectedPlacement(nextActive);
      this.selectedSet = nextActive === null ? new Set() : rest;
    } else {
      const keep = new Set(this.selectedSet);
      keep.add(index);
      this.setSelectedPlacement(index);
      this.selectedSet = keep;
    }
    this.selectedKey = null;
    this.syncMultiSelectionView();
    this.inspector.refresh();
    this.canvasDirty = true;
  }

  private placementLabel(assetId: string): string {
    if (assetId === GRASS_PATCH_ASSET_ID) return t('editor.foliageTool.grass');
    const kind = colliderKindFor(assetId);
    if (kind) return t(`editor.collider.${kind}` as Parameters<typeof t>[0]);
    if (isLocalAssetId(assetId)) return localAssetLabel(assetId);
    if (isUserAssetId(assetId)) return userAssetLabel(assetId);
    return assetById(assetId)?.label ?? assetId;
  }

  // ---- collider volumes -------------------------------------------------------

  /** Collider tool click: insert the picked shape, select it, and hand it to
   *  the Move gizmo so it can be shaped immediately. */
  private insertColliderAt(w: Vec2): void {
    const placement: AssetPlacement = {
      assetId: COLLIDER_ASSET_IDS[this.colliderShape],
      x: w.x,
      z: w.z,
      rotY: 0,
      scale: 1,
      collide: true,
    };
    this.appendPlacements([placement], 'add-collider');
    const index = this.map.placements.lastIndexOf(placement);
    if (index >= 0) {
      this.setSelectedPlacement(index);
      this.setTool('move');
    }
    this.inspector.refresh();
  }

  private insertFluidAt(w: Vec2): void {
    const placement: AssetPlacement = {
      assetId: FLUID_ASSET_IDS[this.fluidKind],
      x: w.x,
      z: w.z,
      rotY: 0,
      scale: 1,
      collide: false,
      sizeX: FLUID_DEFAULT_SIZE.x,
      sizeZ: FLUID_DEFAULT_SIZE.z,
      sizeY: FLUID_DEFAULT_OFFSET_Y,
    };
    this.appendPlacements([placement], 'add-fluid');
    const index = this.map.placements.lastIndexOf(placement);
    if (index >= 0) {
      this.setSelectedPlacement(index);
      this.setTool('move');
    }
    this.inspector.refresh();
  }

  // ---- foliage brush ------------------------------------------------------------

  /** The enabled foliage asset ids (catalog 'foliage' category by family),
   *  plus the reserved animated-grass patch id when Grass is on. */
  private foliagePool(): string[] {
    // A picked custom asset overrides the built-in groups entirely: scatter
    // only that asset (with the same density/scale/collide controls).
    if (this.foliageCustom) return [this.foliageCustom.assetId];
    const f = this.foliage;
    const pool: string[] = [];
    if (f.grass) pool.push(GRASS_PATCH_ASSET_ID);
    for (const a of ASSET_CATALOG) {
      if (a.category !== 'foliage') continue;
      const name = a.id.slice('foliage/'.length);
      const isRock = name.startsWith('rock');
      const isBush = name.startsWith('bush');
      const isFern = name.startsWith('fern') || name.startsWith('mushroom');
      const isTree = !isRock && !isBush && !isFern;
      if (
        (isRock && f.rocks) ||
        (isBush && f.bushes) ||
        (isFern && f.ferns) ||
        (isTree && f.trees)
      ) {
        pool.push(a.id);
      }
    }
    return pool;
  }

  private foliageBegin(w: Vec2): void {
    this.foliageStroke = [];
    this.foliageStart = this.map.placements.length;
    this.foliageLast = null;
    this.foliageCapWarned = false;
    this.foliagePoolWarned = false;
    this.foliageStep(w);
  }

  /** One brush stamp: scatter `density` random pool assets inside the radius,
   *  live-added to the document; the whole stroke commits as ONE undo entry. */
  private foliageStep(w: Vec2): void {
    const spacing = Math.max(2, this.brushRadius * 0.55);
    if (this.foliageLast) {
      const dx = w.x - this.foliageLast.x;
      const dz = w.z - this.foliageLast.z;
      if (dx * dx + dz * dz < spacing * spacing) return;
    }
    const pool = this.foliagePool();
    if (pool.length === 0) {
      if (!this.foliagePoolWarned) {
        this.foliagePoolWarned = true;
        this.toasts.info(t('editor.foliageTool.noneSelected'));
      }
      return;
    }
    this.foliageLast = { x: w.x, z: w.z };
    const f = this.foliage;
    for (let k = 0; k < f.density; k++) {
      if (this.map.placements.length >= MAX_PLACEMENTS) {
        if (!this.foliageCapWarned) {
          this.foliageCapWarned = true;
          this.toasts.error(t('editor.status.placementCapReached', { max: MAX_PLACEMENTS }));
        }
        return;
      }
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * this.brushRadius;
      const scale =
        Math.round((f.minScale + Math.random() * Math.max(0, f.maxScale - f.minScale)) * 100) / 100;
      const assetId = pool[Math.floor(Math.random() * pool.length)];
      const isGrass = assetId === GRASS_PATCH_ASSET_ID;
      const placement: AssetPlacement = {
        assetId,
        x: w.x + Math.sin(ang) * rad,
        z: w.z + Math.cos(ang) * rad,
        rotY: Math.random() * Math.PI * 2,
        scale,
        // Grass is walk-through by design, like the built-in world's.
        collide: isGrass ? false : f.collide,
      };
      if (isGrass) {
        placement.hue = Math.round(f.grassHue);
        placement.lum = Math.round(f.grassLight) / 100;
        placement.clump = Math.round(f.grassClump);
      }
      const index = this.map.placements.push(placement) - 1;
      this.foliageStroke.push(placement);
      this.viewport3d?.placementAdded(index);
    }
    this.canvasDirty = true;
  }

  private foliageCommit(): void {
    if (this.foliageStroke.length === 0) return;
    const placed = this.foliageStroke;
    const start = this.foliageStart;
    this.foliageStroke = [];
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'paint-foliage',
      undo: () => {
        removeSpan(this.map.placements, start, placed);
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
      redo: () => {
        this.map.placements.push(...placed);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
    });
    this.inspector.refresh();
  }

  /** Detach a placement from its terrain seat (Move tool): freeze the ground
   *  height at its CURRENT position so the model floats there instead of
   *  re-snapping as it moves. No-op once already detached; pushes the flag to the
   *  render view immediately so the live drag renders in free-float mode. */
  private detachPlacement(index: number): void {
    const p = this.map.placements[index];
    if (!p || p.detached) return;
    p.detached = true;
    p.groundY = terrainHeight(p.x, p.z, this.map.meta.seed);
    this.viewport3d?.placementUpdated(index, {
      detached: true,
      groundY: p.groundY,
    });
  }

  // ---- hitbox editing (baked-collision boxes as first-class objects) ------------

  /** The hitboxes the RENDER footprint should draw for a placement (what the
   *  sim will block with): fine mesh bake, hand-edited boxes, or null (the
   *  generated baked set / legacy footprint applies). */
  private resolvedHitboxesFor(p: AssetPlacement): MapHitbox[] | null {
    const mode = effectiveCollisionMode(p);
    if (mode === 'mesh') {
      const fine = this.map.assetCollisionMesh?.[p.assetId];
      return fine && fine.length > 0 ? fine.map((b) => ({ ...b })) : null;
    }
    if (mode === 'baked' && p.hitboxes && p.hitboxes.length > 0) {
      return p.hitboxes.map((b) => ({ ...b }));
    }
    return null;
  }

  /** Enter hitbox-edit mode for the selected placement: materialize the baked
   *  boxes onto the placement (one undo entry) so they become editable. */
  private enterHitboxEdit(): void {
    const index = this.selectedPlacement;
    if (index === null) return;
    const p = this.map.placements[index];
    if (!p) return;
    if (!p.hitboxes || p.hitboxes.length === 0) {
      this.setHitboxes(index, this.materializeHitboxes(p), 'edit-hitboxes');
    }
    this.hitboxEdit = { index, selected: new Set() };
    this.syncFootprintOverlay();
    this.syncHitboxEditView();
    this.inspector.refresh();
  }

  private exitHitboxEdit(): void {
    if (!this.hitboxEdit) return;
    this.hitboxEdit = null;
    this.hitboxDragBase = null;
    this.viewport3d?.setHitboxEdit(null);
    this.syncFootprintOverlay();
    this.inspector.refresh();
  }

  /** The starting editable box set: the asset's baked boxes (catalogue or
   *  imported), else one crate-sized box derived from the collide radius. */
  private materializeHitboxes(p: AssetPlacement): MapHitbox[] {
    const baked = ASSET_COLLISION[p.assetId] ?? this.map.assetCollision?.[p.assetId];
    if (baked && baked.length > 0) return baked.map((b) => ({ ...b }));
    const r = Math.max(0.3, collideRadiusFor(1, p.assetId));
    return [{ x: 0, y: r, z: 0, hx: r, hy: r, hz: r }];
  }

  /** Push the current edit state (boxes + selection) to the 3D overlay. */
  private syncHitboxEditView(): void {
    if (!this.hitboxEdit) {
      this.viewport3d?.setHitboxEdit(null);
      return;
    }
    const p = this.map.placements[this.hitboxEdit.index];
    if (!p || !p.hitboxes || p.hitboxes.length === 0) {
      this.exitHitboxEdit();
      return;
    }
    // Undo can shrink the box list under a live selection: drop strays.
    for (const i of [...this.hitboxEdit.selected]) {
      if (i >= p.hitboxes.length) this.hitboxEdit.selected.delete(i);
    }
    this.viewport3d?.setHitboxEdit({
      index: this.hitboxEdit.index,
      boxes: p.hitboxes,
      selected: [...this.hitboxEdit.selected],
    });
  }

  /** One live gizmo sample over the selected hitboxes: apply the world-space
   *  gesture delta to the gesture-start snapshot in model space. */
  private applyHitboxGizmo(change: GizmoHitboxChange): void {
    const he = this.hitboxEdit;
    if (!he) return;
    const p = this.map.placements[he.index];
    if (!p || !p.hitboxes || he.selected.size === 0) return;
    if (!this.hitboxDragBase) this.hitboxDragBase = p.hitboxes.map((b) => ({ ...b }));
    const base = this.hitboxDragBase;
    const s = p.scale > 0 ? p.scale : 1;
    const sx = s * (p.scaleX ?? 1);
    const sy = s * (p.scaleY ?? 1);
    const sz = s * (p.scaleZ ?? 1);
    // Pivot: the selection's centroid in model space (rotate/scale anchor).
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    for (const i of he.selected) {
      const b = base[i];
      if (!b) continue;
      cx += b.x;
      cy += b.y;
      cz += b.z;
      n++;
    }
    if (n === 0) return;
    cx /= n;
    cy /= n;
    cz /= n;
    const clampC = (v: number): number => Math.max(-100, Math.min(100, v));
    const clampH = (v: number): number => Math.max(0.05, Math.min(60, v));
    const boxes = base.map((b) => ({ ...b }));
    const cos = Math.cos(p.rotY);
    const sin = Math.sin(p.rotY);
    for (const i of he.selected) {
      const b = boxes[i];
      const b0 = base[i];
      if (!b || !b0) continue;
      if (change.dx !== undefined || change.dz !== undefined || change.dy !== undefined) {
        const dx = change.dx ?? 0;
        const dz = change.dz ?? 0;
        // World delta -> model space: rotate by -rotY (three.js Y convention),
        // then divide out the per-axis world scale.
        const lx = (dx * cos - dz * sin) / (sx || 1);
        const lz = (dx * sin + dz * cos) / (sz || 1);
        b.x = clampC(b0.x + lx);
        b.z = clampC(b0.z + lz);
        if (change.dy !== undefined) b.y = clampC(b0.y + change.dy / (sy || 1));
      }
      if (change.dRotY !== undefined) {
        // Orbit the centroid and spin the box itself (per-box yaw).
        const ox = b0.x - cx;
        const oz = b0.z - cz;
        const cd = Math.cos(change.dRotY);
        const sd = Math.sin(change.dRotY);
        b.x = clampC(cx + ox * cd + oz * sd);
        b.z = clampC(cz - ox * sd + oz * cd);
        const ry = wrapAngle((b0.ry ?? 0) + change.dRotY);
        if (ry === 0) delete b.ry;
        else b.ry = ry;
      }
      if (change.ratio !== undefined) {
        const r = Math.max(0.02, Math.min(50, change.ratio));
        const axis = change.axis ?? 'uniform';
        if (axis === 'uniform') {
          b.hx = clampH(b0.hx * r);
          b.hy = clampH(b0.hy * r);
          b.hz = clampH(b0.hz * r);
          b.x = clampC(cx + (b0.x - cx) * r);
          b.y = clampC(cy + (b0.y - cy) * r);
          b.z = clampC(cz + (b0.z - cz) * r);
        } else if (axis === 'x') {
          b.hx = clampH(b0.hx * r);
          b.x = clampC(cx + (b0.x - cx) * r);
        } else if (axis === 'y') {
          b.hy = clampH(b0.hy * r);
          b.y = clampC(cy + (b0.y - cy) * r);
        } else {
          b.hz = clampH(b0.hz * r);
          b.z = clampC(cz + (b0.z - cz) * r);
        }
      }
    }
    p.hitboxes = boxes;
    this.viewport3d?.placementUpdated(he.index, {
      hitboxes: boxes.map((b) => ({ ...b })),
    });
    this.syncHitboxEditView();
    this.canvasDirty = true;
  }

  /** End-of-gesture commit for a hitbox gizmo drag: ONE undo entry. */
  private commitHitboxes(): void {
    const he = this.hitboxEdit;
    const prev = this.hitboxDragBase;
    this.hitboxDragBase = null;
    if (!he || !prev) return;
    const index = he.index;
    const p = this.map.placements[index];
    if (!p || !p.hitboxes) return;
    const next = p.hitboxes.map((b) => ({ ...b }));
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.pushUndo({
      label: 'edit-hitboxes',
      undo: () => this.restoreHitboxes(index, prev),
      redo: () => this.restoreHitboxes(index, next),
    });
  }

  private restoreHitboxes(index: number, boxes: MapHitbox[] | undefined): void {
    const p = this.map.placements[index];
    if (!p) return;
    if (boxes && boxes.length > 0) p.hitboxes = boxes.map((b) => ({ ...b }));
    else delete p.hitboxes;
    this.afterHitboxesChanged(index);
  }

  private afterHitboxesChanged(index: number): void {
    const p = this.map.placements[index];
    this.viewport3d?.placementUpdated(index, {
      hitboxes: p ? this.resolvedHitboxesFor(p) : null,
    });
    if (this.hitboxEdit?.index === index) this.syncHitboxEditView();
    this.canvasDirty = true;
  }

  /** Replace a placement's hitboxes outright (add/delete/reset/preset paths):
   *  ONE undo entry. `next` undefined clears back to the baked set. */
  private setHitboxes(index: number, next: MapHitbox[] | undefined, label: string): void {
    const p = this.map.placements[index];
    if (!p) return;
    const prev = p.hitboxes ? p.hitboxes.map((b) => ({ ...b })) : undefined;
    const clamped = next?.slice(0, MAX_PLACEMENT_HITBOXES);
    this.restoreHitboxes(index, clamped);
    this.map.meta.updatedAt = now();
    this.markDirty();
    this.pushUndo({
      label,
      undo: () => this.restoreHitboxes(index, prev),
      redo: () => this.restoreHitboxes(index, clamped),
    });
  }

  private addHitbox(): void {
    const he = this.hitboxEdit;
    if (!he) return;
    const p = this.map.placements[he.index];
    if (!p) return;
    const boxes = p.hitboxes ? p.hitboxes.map((b) => ({ ...b })) : [];
    if (boxes.length >= MAX_PLACEMENT_HITBOXES) {
      this.toasts.error(t('editor.selection.hitboxCap', { max: MAX_PLACEMENT_HITBOXES }));
      return;
    }
    boxes.push({ x: 0, y: 1, z: 0, hx: 1, hy: 1, hz: 1 });
    this.setHitboxes(he.index, boxes, 'add-hitbox');
    he.selected.clear();
    he.selected.add(boxes.length - 1);
    this.syncHitboxEditView();
    this.inspector.refresh();
  }

  private deleteSelectedHitboxes(): void {
    const he = this.hitboxEdit;
    if (!he || he.selected.size === 0) return;
    const p = this.map.placements[he.index];
    if (!p || !p.hitboxes) return;
    const boxes = p.hitboxes.filter((_, i) => !he.selected.has(i)).map((b) => ({ ...b }));
    he.selected.clear();
    if (boxes.length === 0) {
      // Deleting every box = no collision left to edit: fall back to 'none'.
      this.setHitboxes(he.index, undefined, 'delete-hitbox');
      this.updateSelectedPlacement({ collisionMode: 'none' }, true);
      this.exitHitboxEdit();
      return;
    }
    this.setHitboxes(he.index, boxes, 'delete-hitbox');
    this.syncHitboxEditView();
    this.inspector.refresh();
  }

  /** Discard the hand-edits: back to the asset's baked box set. */
  private resetHitboxes(): void {
    const index = this.hitboxEdit?.index ?? this.selectedPlacement;
    if (index === null) return;
    this.exitHitboxEdit();
    this.setHitboxes(index, undefined, 'reset-hitboxes');
    this.inspector.refresh();
  }

  // ---- hitbox presets (localStorage, per asset) ---------------------------------

  private saveHitboxPreset(): void {
    const index = this.selectedPlacement;
    const p = index === null ? undefined : this.map.placements[index];
    if (!p || !p.hitboxes || p.hitboxes.length === 0) return;
    this.hitboxPresets[p.assetId] = p.hitboxes.map((b) => ({ ...b }));
    writeJsonPref(HITBOX_PRESETS_PREF_KEY, this.hitboxPresets);
    this.toasts.info(
      t('editor.selection.hitboxPresetSaved', {
        name: this.placementLabel(p.assetId),
      }),
    );
    this.inspector.refresh();
  }

  private clearHitboxPreset(): void {
    const index = this.selectedPlacement;
    const p = index === null ? undefined : this.map.placements[index];
    if (!p || !this.hitboxPresets[p.assetId]) return;
    delete this.hitboxPresets[p.assetId];
    writeJsonPref(HITBOX_PRESETS_PREF_KEY, this.hitboxPresets);
    this.toasts.info(t('editor.selection.hitboxPresetCleared'));
    this.inspector.refresh();
  }

  /** Copy one placement's collision block (type, shape, hitbox edits) onto
   *  another, SIZED to the target's own scale so a small copy never inherits a
   *  big copy's oversized footprint. Hitboxes are mesh-space (the sim multiplies
   *  them by each placement's scale) so they copy verbatim; the ABSOLUTE
   *  basic-radius override is rescaled by the target/source scale ratio to keep
   *  the source's collision-to-model proportion. Deletes fields the source does
   *  not carry, so the target ends up a match rather than a merge. */
  private copyCollisionSettings(src: AssetPlacement, dst: AssetPlacement): void {
    if (src.collisionMode !== undefined) dst.collisionMode = src.collisionMode;
    else delete dst.collisionMode;
    dst.collide = src.collide;
    if (src.collideRadius !== undefined) {
      const srcScale = src.scale > 0 ? src.scale : 1;
      const ratio = (dst.scale > 0 ? dst.scale : 1) / srcScale;
      dst.collideRadius = Math.min(
        MAX_COLLIDE_RADIUS,
        Math.max(MIN_COLLIDE_RADIUS, src.collideRadius * ratio),
      );
    } else delete dst.collideRadius;
    if (src.collideShape !== undefined) dst.collideShape = src.collideShape;
    else delete dst.collideShape;
    if (src.hitboxes !== undefined) dst.hitboxes = src.hitboxes.map((b) => ({ ...b }));
    else delete dst.hitboxes;
  }

  /** "Copy collision to all {asset}" from the bottom of the collision menu:
   *  after an in-app confirm, give every OTHER placement of the active asset the
   *  active one's whole collision setup, as a single undo step. */
  private async copyCollisionToSameAsset(): Promise<void> {
    const index = this.selectedPlacement;
    const src = index === null ? undefined : this.map.placements[index];
    if (index === null || !src) return;
    const targets = this.map.placements
      .map((_, i) => i)
      .filter((i) => i !== index && this.map.placements[i].assetId === src.assetId);
    if (targets.length === 0) return;
    const name = this.placementLabel(src.assetId);
    const count = formatNumber(targets.length, { useGrouping: false });
    const ok = await confirmDialog(this.root, {
      title: t('editor.selection.collisionCopyConfirmTitle', { name }),
      body: t('editor.selection.collisionCopyConfirmBody', { name, count }),
      confirmLabel: t('editor.selection.collisionCopyConfirm'),
    });
    if (!ok) return;
    // The dialog is modal, but guard the async gap: bail if the active placement
    // is no longer the same object at the same index.
    if (this.selectedPlacement !== index || this.map.placements[index] !== src) return;
    const prev = new Map(targets.map((i) => [i, { ...this.map.placements[i] }]));
    for (const i of targets) this.copyCollisionSettings(src, this.map.placements[i]);
    const next = new Map(targets.map((i) => [i, { ...this.map.placements[i] }]));
    const applyAll = (snaps: Map<number, AssetPlacement>): void => {
      for (const [i, snap] of snaps) this.restorePlacementSnapshot(i, snap);
      this.viewport3d?.rebuildPlacements();
      this.canvasDirty = true;
    };
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'copy-collision-to-asset',
      undo: () => applyAll(prev),
      redo: () => applyAll(next),
    });
    this.viewport3d?.rebuildPlacements();
    this.canvasDirty = true;
    this.markDirty();
    this.toasts.success(t('editor.selection.collisionCopied', { name, count }));
  }

  /** "Scale all copies" from the Selection panel: after an in-app confirm, roll a
   *  random scale in [cloneScaleMin, cloneScaleMax] onto EVERY placement of the
   *  selected asset (the active one included), as a single undo step. min==max
   *  gives a uniform scale; a wider range adds natural size variation. */
  private async scaleAllSameAsset(): Promise<void> {
    const index = this.selectedPlacement;
    const src = index === null ? undefined : this.map.placements[index];
    if (index === null || !src) return;
    const targets = this.map.placements
      .map((_, i) => i)
      .filter((i) => this.map.placements[i].assetId === src.assetId);
    if (targets.length === 0) return;
    const lo = Math.max(PLACEMENT_SCALE_MIN, Math.min(this.cloneScaleMin, this.cloneScaleMax));
    const hi = Math.min(PLACEMENT_SCALE_MAX, Math.max(this.cloneScaleMin, this.cloneScaleMax));
    const name = this.placementLabel(src.assetId);
    const count = formatNumber(targets.length, { useGrouping: false });
    const fmt = (v: number): string =>
      formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const ok = await confirmDialog(this.root, {
      title: t('editor.selection.scaleAllConfirmTitle', { name }),
      body: t('editor.selection.scaleAllConfirmBody', {
        name,
        count,
        min: fmt(lo),
        max: fmt(hi),
      }),
      confirmLabel: t('editor.selection.scaleAllConfirm'),
    });
    if (!ok) return;
    if (this.selectedPlacement !== index || this.map.placements[index] !== src) return;
    const prev = new Map(targets.map((i) => [i, { ...this.map.placements[i] }]));
    // Seeded editor PRNG (never the sim Rng): deterministic per map, so the same
    // range re-rolls the same look until the maker widens it.
    const rng = makeRng(this.map.meta.seed);
    for (const i of targets) {
      const q = this.map.placements[i];
      const s = lo >= hi ? lo : lo + rng() * (hi - lo);
      q.scale = Math.min(PLACEMENT_SCALE_MAX, Math.max(PLACEMENT_SCALE_MIN, s));
    }
    const next = new Map(targets.map((i) => [i, { ...this.map.placements[i] }]));
    const applyAll = (snaps: Map<number, AssetPlacement>): void => {
      for (const [i, snap] of snaps) this.restorePlacementSnapshot(i, snap);
      this.viewport3d?.rebuildPlacements();
      this.canvasDirty = true;
      this.inspector.refresh();
    };
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'scale-all-asset',
      undo: () => applyAll(prev),
      redo: () => applyAll(next),
    });
    this.viewport3d?.rebuildPlacements();
    this.canvasDirty = true;
    this.markDirty();
    this.inspector.refresh();
    this.toasts.success(t('editor.selection.scaleAllDone', { name, count }));
  }

  // ---- "true collision" fine bake -------------------------------------------------

  /** Bake (once per asset, cached on the doc) the fine mesh-hugging box set
   *  'mesh' collision mode blocks with. Async; placements fall back to the
   *  standard baked boxes until it lands. */
  private ensureMeshCollision(assetId: string): void {
    if (this.map.assetCollisionMesh?.[assetId] || this.meshBakesInFlight.has(assetId)) return;
    const url = localAssetUrl(assetId) ?? userAssetPath(assetId) ?? assetById(assetId)?.path;
    if (!url) {
      this.toasts.error(t('editor.selection.meshBakeFailed'));
      return;
    }
    this.meshBakesInFlight.add(assetId);
    this.toasts.info(t('editor.selection.meshBaking'));
    void bakeTrueModelCollision(url)
      .then((boxes) => {
        this.meshBakesInFlight.delete(assetId);
        if (!boxes || boxes.length === 0) {
          this.toasts.error(t('editor.selection.meshBakeFailed'));
          this.inspector.refresh();
          return;
        }
        if (!this.map.assetCollisionMesh) this.map.assetCollisionMesh = {};
        this.map.assetCollisionMesh[assetId] = boxes.slice(0, MAX_ASSET_COLLISION_MESH_BOXES);
        this.map.meta.updatedAt = now();
        this.markDirty();
        // Re-project every placement so mesh-mode ones pick up the fine boxes.
        this.viewport3d?.rebuildPlacements();
        this.toasts.info(
          t('editor.selection.meshBakeDone', {
            count: formatNumber(this.map.assetCollisionMesh[assetId].length, {
              useGrouping: false,
            }),
          }),
        );
        this.inspector.refresh();
      })
      .catch(() => {
        this.meshBakesInFlight.delete(assetId);
        this.toasts.error(t('editor.selection.meshBakeFailed'));
        this.inspector.refresh();
      });
  }

  private updateSelectedPlacement(
    change: {
      x?: number;
      z?: number;
      y?: number;
      rotY?: number;
      rotX?: number;
      rotZ?: number;
      scale?: number;
      scaleX?: number;
      scaleY?: number;
      scaleZ?: number;
      collide?: boolean;
      collideRadius?: number | null;
      collideShape?: 'square' | null;
      collisionMode?: CollisionMode;
      sizeX?: number;
      sizeY?: number;
      sizeZ?: number;
      tint?: number | null;
      opacity?: number | null;
      glow?: number | null;
      glowStrength?: number | null;
      fire?: boolean | null;
      hue?: number | null;
      lum?: number | null;
      fluidDps?: number | null;
      fluidFx?: number | null;
      rockSeed?: number;
      rockNoise?: number;
      rockDetail?: number;
      rockSharp?: number;
      rockTex?: number;
      rockHeight?: number;
      rockDepth?: number;
      rockJag?: number;
      rockTexId?: string | null;
      rockTexTile?: number;
    },
    commit: boolean,
    opts?: { detachOnMove?: boolean },
  ): void {
    const index = this.selectedPlacement;
    if (index === null) return;
    const p = this.map.placements[index];
    if (!p) return;
    // Capture the PRE-DRAG value before the first mutation (waterBase pattern):
    // live slider events mutate p on every input, so a prev taken at commit time
    // would equal next and make undo a no-op.
    const base =
      this.placementDragBase?.index === index ? this.placementDragBase : { index, prev: { ...p } };
    this.placementDragBase = base;
    // Feature: once you MOVE a placement with the Move tool it stops respecting
    // the terrain (free-float anywhere). Detach on the first horizontal drag
    // sample, AFTER the undo base is captured, so one Ctrl+Z restores the
    // grounded state, freezing the ground at the pre-move position so it does
    // not jump. A pure Y lift, rotate, or scale never detaches.
    //
    // Rig markers re-derive their bore/ridge from their transform: XZ moves
    // the path, the Y gizmo lifts/dives the node, gizmo scale sets its girth.
    const isCaveMarker =
      p.assetId === CAVE_ENTRANCE_ASSET_ID ||
      p.assetId === CAVE_EXIT_ASSET_ID ||
      p.assetId === CAVE_POINT_ASSET_ID;
    const isRigMarker = isCaveMarker || p.assetId === ROCK_POINT_ASSET_ID;
    // Cave markers are ANCHORED (frozen ground): their elevation is absolute
    // so the tube ignores whatever the terrain does. Heal markers from older
    // sessions on first touch by freezing the CURRENT surface under them ?
    // their y offset keeps meaning the same height it did before the freeze.
    if (isCaveMarker && !p.detached) {
      p.detached = true;
      p.groundY = terrainHeight(p.x, p.z, this.map.meta.seed);
    }
    // Rock ridge markers keep the legacy terrain-relative behavior.
    if (p.assetId === ROCK_POINT_ASSET_ID && p.detached) {
      delete p.detached;
      delete p.groundY;
    }
    const detachMove =
      opts?.detachOnMove === true &&
      !isRigMarker &&
      (change.x !== undefined || change.z !== undefined);
    if (detachMove) this.detachPlacement(index);
    // Group transform: moving/rotating/scaling the active placement carries the
    // other multi-selection members along (Blender-style). The group translates
    // by the same delta and rotates/scales as a unit about the active
    // placement's gesture-start pivot, each member also spinning/scaling in
    // place to match. Deltas are taken against the active's pre-gesture base
    // and applied to per-member snapshots, so every live sample re-derives the
    // members from one stable baseline (no incremental drift).
    const groupIndices = [...this.selectedSet].filter(
      (gi) => gi !== index && this.map.placements[gi],
    );
    const groupChange =
      change.x !== undefined ||
      change.z !== undefined ||
      change.y !== undefined ||
      change.rotY !== undefined ||
      change.scale !== undefined;
    if (groupChange && groupIndices.length > 0) {
      if (!this.groupDragBase) {
        this.groupDragBase = new Map(
          groupIndices.map((gi) => [gi, { ...this.map.placements[gi] }]),
        );
      }
      const prev = base.prev;
      const dx = change.x !== undefined ? change.x - prev.x : 0;
      const dz = change.z !== undefined ? change.z - prev.z : 0;
      // Vertical lifts ride along too (the gizmo's Y arrow): same clamp as the
      // active placement below.
      const dy = change.y !== undefined ? change.y - (prev.y ?? 0) : 0;
      const dRot = change.rotY !== undefined ? change.rotY - prev.rotY : 0;
      const ratio = change.scale !== undefined && prev.scale > 0 ? change.scale / prev.scale : 1;
      for (const gi of groupIndices) {
        const snap = this.groupDragBase.get(gi);
        const q = this.map.placements[gi];
        if (!snap || !q) continue;
        // Detach each member too (before moving it, so the frozen ground is the
        // pre-move height), the whole group floats free consistently.
        if (detachMove) this.detachPlacement(gi);
        const pt = groupMemberPoint(snap.x, snap.z, prev.x, prev.z, dx, dz, dRot, ratio);
        q.x = pt.x;
        q.z = pt.z;
        if (change.y !== undefined) {
          q.y = Math.min(
            MAX_PLACEMENT_Y_OFFSET,
            Math.max(-MAX_PLACEMENT_Y_OFFSET, (snap.y ?? 0) + dy),
          );
        }
        if (change.rotY !== undefined) q.rotY = wrapAngle(snap.rotY + dRot);
        if (change.scale !== undefined) {
          q.scale = Math.min(
            PLACEMENT_SCALE_MAX,
            Math.max(PLACEMENT_SCALE_MIN, snap.scale * ratio),
          );
        }
        this.viewport3d?.placementUpdated(gi, {
          x: q.x,
          z: q.z,
          y: change.y !== undefined ? q.y : undefined,
          rotY: change.rotY !== undefined ? q.rotY : undefined,
          scale: change.scale !== undefined ? q.scale : undefined,
          collideRadius: q.collide ? effectiveCollideRadius(q) : 0,
        });
      }
      this.syncMultiSelectionView();
    }
    if (change.x !== undefined) p.x = change.x;
    if (change.z !== undefined) p.z = change.z;
    if (change.rotY !== undefined) p.rotY = change.rotY;
    if (change.rotX !== undefined) p.rotX = wrapAngle(change.rotX);
    if (change.rotZ !== undefined) p.rotZ = wrapAngle(change.rotZ);
    if (change.scale !== undefined) p.scale = change.scale;
    if (change.scaleX !== undefined) {
      p.scaleX = Math.min(MAX_AXIS_SCALE, Math.max(MIN_AXIS_SCALE, change.scaleX));
    }
    if (change.scaleY !== undefined) {
      p.scaleY = Math.min(MAX_AXIS_SCALE, Math.max(MIN_AXIS_SCALE, change.scaleY));
    }
    if (change.scaleZ !== undefined) {
      p.scaleZ = Math.min(MAX_AXIS_SCALE, Math.max(MIN_AXIS_SCALE, change.scaleZ));
    }
    if (change.y !== undefined) {
      p.y = Math.min(MAX_PLACEMENT_Y_OFFSET, Math.max(-MAX_PLACEMENT_Y_OFFSET, change.y));
    }
    // Collision block (type dropdown, basic radius/shape, collide toggle). With
    // several placements selected it edits EVERY selected one, not just the
    // active: snapshot the other members up front so the commit path records a
    // single group undo (the same move-placements machinery used for transforms).
    const collisionChange =
      change.collide !== undefined ||
      change.collisionMode !== undefined ||
      change.collideRadius !== undefined ||
      change.collideShape !== undefined;
    if (collisionChange && this.selectedSet.size > 1 && !this.groupDragBase) {
      const members = [...this.selectedSet].filter((gi) => gi !== index && this.map.placements[gi]);
      if (members.length > 0) {
        this.groupDragBase = new Map(members.map((gi) => [gi, { ...this.map.placements[gi] }]));
      }
    }
    this.applyCollisionFields(p, change, index);
    if (collisionChange && this.groupDragBase) {
      for (const gi of this.groupDragBase.keys()) {
        const q = this.map.placements[gi];
        if (!q || gi === index) continue;
        this.applyCollisionFields(q, change, gi);
        this.viewport3d?.placementUpdated(gi, {
          collideRadius: effectiveCollisionMode(q) !== 'none' ? effectiveCollideRadius(q) : 0,
          collideShape: q.collideShape ?? null,
          collideCustom: effectiveCollisionMode(q) === 'basic',
          hitboxes: change.collisionMode !== undefined ? this.resolvedHitboxesFor(q) : undefined,
        });
      }
    }
    for (const key of ['tint', 'opacity', 'glow', 'glowStrength'] as const) {
      const v = change[key];
      if (v === undefined) continue;
      if (v === null) delete p[key];
      else p[key] = v;
    }
    if (change.fire !== undefined) {
      if (change.fire) p.fire = true;
      else delete p.fire;
    }
    // Fluid-pool fields (hue/lum shared with grass; DPS + effect bits fluid-only).
    if (change.hue !== undefined) {
      if (change.hue === null) delete p.hue;
      else p.hue = Math.min(360, Math.max(0, change.hue));
    }
    if (change.lum !== undefined) {
      if (change.lum === null) delete p.lum;
      else p.lum = Math.min(1, Math.max(0, change.lum));
    }
    if (change.fluidDps !== undefined) {
      if (change.fluidDps === null) delete p.fluidDps;
      else p.fluidDps = Math.min(50, Math.max(0, change.fluidDps));
    }
    if (change.fluidFx !== undefined) {
      if (change.fluidFx === null) delete p.fluidFx;
      else p.fluidFx = Math.round(Math.min(15, Math.max(0, change.fluidFx)));
    }
    // Collider-volume dimensions (same clamps as the shared sanitizer).
    if (change.sizeX !== undefined) {
      p.sizeX = Math.min(MAX_COLLIDER_SIZE, Math.max(MIN_COLLIDER_SIZE, change.sizeX));
    }
    if (change.sizeY !== undefined) {
      p.sizeY = Math.min(MAX_COLLIDER_SIZE_Y, Math.max(MIN_COLLIDER_SIZE_Y, change.sizeY));
    }
    if (change.sizeZ !== undefined) {
      p.sizeZ = Math.min(MAX_COLLIDER_SIZE, Math.max(MIN_COLLIDER_SIZE, change.sizeZ));
    }
    // Generated-rock shape edits: clamp, then rebuild the procedural mesh in
    // the view (the record is the source of truth; the model re-derives).
    let rockChanged = false;
    if (change.rockSeed !== undefined) {
      p.rockSeed = Math.max(0, Math.round(change.rockSeed));
      rockChanged = true;
    }
    if (change.rockNoise !== undefined) {
      p.rockNoise = Math.min(1, Math.max(0, change.rockNoise));
      rockChanged = true;
    }
    if (change.rockDetail !== undefined) {
      p.rockDetail = Math.min(1, Math.max(0, change.rockDetail));
      rockChanged = true;
    }
    if (change.rockSharp !== undefined) {
      p.rockSharp = Math.min(1, Math.max(0, change.rockSharp));
      rockChanged = true;
    }
    if (change.rockTex !== undefined) {
      p.rockTex = Math.min(2, Math.max(0, Math.round(change.rockTex)));
      // Picking a legacy look clears any texture-set override.
      delete p.rockTexId;
      rockChanged = true;
    }
    if (change.rockHeight !== undefined) {
      p.rockHeight = Math.min(3, Math.max(0.3, change.rockHeight));
      rockChanged = true;
    }
    if (change.rockDepth !== undefined) {
      p.rockDepth = Math.min(1, Math.max(0, change.rockDepth));
      rockChanged = true;
    }
    if (change.rockJag !== undefined) {
      p.rockJag = Math.min(1, Math.max(0, change.rockJag));
      rockChanged = true;
    }
    if (change.rockTexId !== undefined) {
      if (change.rockTexId === null || change.rockTexId === '') delete p.rockTexId;
      else p.rockTexId = change.rockTexId;
      rockChanged = true;
    }
    if (change.rockTexTile !== undefined) {
      p.rockTexTile = Math.min(64, Math.max(1, change.rockTexTile));
      rockChanged = true;
    }
    if (rockChanged && (p.assetId === ROCK_ASSET_ID || p.assetId === ROCK_RIDGE_ASSET_ID)) {
      this.viewport3d?.placementAdded(index);
      // placementAdded rebuilds via remove+add, which drops the gold ring.
      this.viewport3d?.setSelectedPlacement(index);
    }
    // Cave rig points regenerate their bore live as they move, scale, or
    // lift: gizmo scale sets that node's bore girth, the Y gizmo its authored
    // depth (the rig's dotted guide follows even before the cave generates).
    if (
      (p.assetId === CAVE_ENTRANCE_ASSET_ID ||
        p.assetId === CAVE_EXIT_ASSET_ID ||
        p.assetId === CAVE_POINT_ASSET_ID) &&
      (change.x !== undefined ||
        change.z !== undefined ||
        change.y !== undefined ||
        change.scale !== undefined ||
        change.scaleX !== undefined ||
        change.scaleY !== undefined ||
        change.scaleZ !== undefined)
    ) {
      this.regenerateCaveForEndpoint(p);
      this.refreshCaveGuides();
    }
    // Rock rig points likewise live-regenerate their merged ridge.
    if (
      p.assetId === ROCK_POINT_ASSET_ID &&
      (change.x !== undefined ||
        change.z !== undefined ||
        change.y !== undefined ||
        change.scale !== undefined ||
        change.scaleX !== undefined ||
        change.scaleY !== undefined ||
        change.scaleZ !== undefined)
    ) {
      this.regenerateRockRidgeForPoint(p);
      this.refreshRockGuides();
    }
    // The render view gets the transform change plus the EFFECTIVE footprint
    // radius (0 = walk-through), so collide toggles, radius drags, and scale
    // changes all repaint the footprint ring live.
    this.viewport3d?.placementUpdated(index, {
      x: change.x,
      z: change.z,
      y: change.y !== undefined ? p.y : undefined,
      rotY: change.rotY,
      rotX: change.rotX !== undefined ? p.rotX : undefined,
      rotZ: change.rotZ !== undefined ? p.rotZ : undefined,
      scale: change.scale,
      scaleX: change.scaleX !== undefined ? p.scaleX : undefined,
      scaleY: change.scaleY !== undefined ? p.scaleY : undefined,
      scaleZ: change.scaleZ !== undefined ? p.scaleZ : undefined,
      collideRadius: effectiveCollisionMode(p) !== 'none' ? effectiveCollideRadius(p) : 0,
      collideShape: p.collideShape ?? null,
      collideCustom:
        change.collisionMode !== undefined ||
        change.collideRadius !== undefined ||
        change.collideShape !== undefined ||
        change.collide !== undefined
          ? effectiveCollisionMode(p) === 'basic'
          : undefined,
      hitboxes: change.collisionMode !== undefined ? this.resolvedHitboxesFor(p) : undefined,
      tint: change.tint !== undefined ? (p.tint ?? null) : undefined,
      opacity: change.opacity !== undefined ? (p.opacity ?? null) : undefined,
      glow: change.glow !== undefined ? (p.glow ?? null) : undefined,
      glowStrength: change.glowStrength !== undefined ? (p.glowStrength ?? null) : undefined,
      fire: change.fire !== undefined ? (p.fire ?? null) : undefined,
    });
    this.canvasDirty = true;
    if (!commit) return;
    const prev = base.prev;
    this.placementDragBase = null;
    const groupPrev = this.groupDragBase;
    this.groupDragBase = null;
    const next = { ...p };
    if (
      prev.x === next.x &&
      prev.z === next.z &&
      prev.y === next.y &&
      prev.rotY === next.rotY &&
      prev.scale === next.scale &&
      prev.collide === next.collide &&
      prev.collideRadius === next.collideRadius &&
      prev.collideShape === next.collideShape &&
      prev.collisionMode === next.collisionMode &&
      prev.tint === next.tint &&
      prev.opacity === next.opacity &&
      prev.glow === next.glow &&
      prev.glowStrength === next.glowStrength &&
      prev.fire === next.fire &&
      prev.sizeX === next.sizeX &&
      prev.sizeY === next.sizeY &&
      prev.sizeZ === next.sizeZ &&
      prev.rotX === next.rotX &&
      prev.rotZ === next.rotZ &&
      prev.scaleX === next.scaleX &&
      prev.scaleY === next.scaleY &&
      prev.scaleZ === next.scaleZ &&
      // A Move grab that detaches then returns to its start x/z still changed
      // state (grounded -> floating): it must record an undo entry.
      prev.detached === next.detached &&
      prev.groundY === next.groundY
    ) {
      return; // drag ended where it started: no undoable change
    }
    this.map.meta.updatedAt = now();
    if (groupPrev && groupPrev.size > 0) {
      // One undo entry for the whole group transform (move/rotate/scale).
      const groupNext = new Map<number, AssetPlacement>();
      for (const gi of groupPrev.keys()) {
        const q = this.map.placements[gi];
        if (q) groupNext.set(gi, { ...q });
      }
      const applyGroup = (snaps: Map<number, AssetPlacement>): void => {
        for (const [gi, snap] of snaps) this.restorePlacementSnapshot(gi, snap);
      };
      this.pushUndo({
        label: 'move-placements',
        undo: () => {
          this.restorePlacementSnapshot(index, prev);
          applyGroup(groupPrev);
          this.viewport3d?.rebuildPlacements();
          this.syncMultiSelectionView();
        },
        redo: () => {
          this.restorePlacementSnapshot(index, next);
          applyGroup(groupNext);
          this.viewport3d?.rebuildPlacements();
          this.syncMultiSelectionView();
        },
      });
      return;
    }
    this.pushUndo({
      label: 'edit-placement',
      undo: () => this.restorePlacementSnapshot(index, prev),
      redo: () => this.restorePlacementSnapshot(index, next),
    });
  }

  /** Apply the collision-block fields of an inspector change to ONE placement.
   *  Shared by the active selection and, for a multi-selection, every other
   *  selected member so the collision dropdown/sliders retarget the whole group
   *  in one edit. `index` is the placement's own index (for the hitbox-edit
   *  guard); `p` is that placement. */
  private applyCollisionFields(
    p: AssetPlacement,
    change: {
      collide?: boolean;
      collisionMode?: CollisionMode;
      collideRadius?: number | null;
      collideShape?: 'square' | null;
    },
    index: number,
  ): void {
    if (change.collide !== undefined) p.collide = change.collide;
    if (change.collisionMode !== undefined) {
      p.collisionMode = change.collisionMode;
      // `collide` mirrors the mode so legacy consumers (2D overlay, playtest
      // projection) keep working; 'none' is the only walk-through mode.
      p.collide = change.collisionMode !== 'none';
      if (change.collisionMode !== 'baked' && this.hitboxEdit?.index === index) {
        this.exitHitboxEdit();
      }
      if (change.collisionMode === 'mesh') this.ensureMeshCollision(p.assetId);
    }
    if (change.collideRadius !== undefined) {
      // number = set the override (clamped), null = back to the derived auto.
      if (change.collideRadius === null) delete p.collideRadius;
      else {
        p.collideRadius = Math.min(
          MAX_COLLIDE_RADIUS,
          Math.max(MIN_COLLIDE_RADIUS, change.collideRadius),
        );
      }
    }
    if (change.collideShape !== undefined) {
      if (change.collideShape === 'square') p.collideShape = 'square';
      else delete p.collideShape;
    }
  }

  /** Undo/redo restore of a full placement snapshot. Object.assign alone would
   *  leave a since-added optional collideRadius behind, so clear it explicitly
   *  when the snapshot never carried one. */
  private restorePlacementSnapshot(index: number, snap: AssetPlacement): void {
    const p = this.map.placements[index];
    if (!p) return;
    Object.assign(p, snap);
    if (snap.collideRadius === undefined) delete p.collideRadius;
    if (snap.collideShape === undefined) delete p.collideShape;
    if (snap.tint === undefined) delete p.tint;
    if (snap.opacity === undefined) delete p.opacity;
    if (snap.glow === undefined) delete p.glow;
    if (snap.glowStrength === undefined) delete p.glowStrength;
    if (snap.fire === undefined) delete p.fire;
    if (snap.sizeX === undefined) delete p.sizeX;
    if (snap.sizeY === undefined) delete p.sizeY;
    if (snap.sizeZ === undefined) delete p.sizeZ;
    if (snap.rotX === undefined) delete p.rotX;
    if (snap.rotZ === undefined) delete p.rotZ;
    if (snap.scaleX === undefined) delete p.scaleX;
    if (snap.scaleY === undefined) delete p.scaleY;
    if (snap.scaleZ === undefined) delete p.scaleZ;
    if (snap.y === undefined) delete p.y;
    // Detach state is part of the transform gesture (a Move-tool grab flips it),
    // so undo/redo must restore the exact grounded/floating state, name and hide.
    if (snap.detached === undefined) delete p.detached;
    if (snap.groundY === undefined) delete p.groundY;
    if (snap.name === undefined) delete p.name;
    if (snap.hidden === undefined) delete p.hidden;
    if (snap.collisionMode === undefined) delete p.collisionMode;
    if (snap.hitboxes === undefined) delete p.hitboxes;
    if (this.hitboxEdit?.index === index) this.syncHitboxEditView();
    this.viewport3d?.rebuildPlacements();
    this.canvasDirty = true;
  }

  // ---- direct manipulation (Select mode: drag-move, wheel, nudge) ------------------

  /** A 3D left-press landed on a pickable placement; claim it in Select mode
   *  or any transform tool. */
  private beginPlacementDrag(index: number): boolean {
    if (!isSelectionTool(this.tool)) return false;
    this.selectedKey = null;
    if (this.selectedSet.has(index)) {
      // Dragging a member of the multi-selection: keep the group, make the
      // grabbed one active.
      const keep = new Set(this.selectedSet);
      this.setSelectedPlacement(index);
      this.selectedSet = keep;
      this.syncMultiSelectionView();
    } else {
      this.setSelectedPlacement(index);
    }
    this.placementDragging = true;
    this.transformDragRef = null;
    this.inspector.refresh();
    this.canvasDirty = true;
    return true;
  }

  /**
   * One drag sample over the ground while a placement drag is held. Select and
   * Move reposition; Rotate spins the placement to follow the cursor around its
   * pivot; Scale resizes by the cursor's distance ratio from the pivot. Rotate
   * and Scale capture their baseline from the FIRST sample, so the drag applies
   * pure deltas and never snaps on pickup.
   */
  private placementDragMove(w: Vec2): void {
    const i = this.selectedPlacement;
    const p = i === null ? undefined : this.map.placements[i];
    if (!p) return;
    if (this.tool === 'rotate' || this.tool === 'scale') {
      const dx = w.x - p.x;
      const dz = w.z - p.z;
      const dist = Math.max(0.5, Math.hypot(dx, dz));
      const angle = Math.atan2(dx, dz);
      const ref = this.transformDragRef;
      if (!ref) {
        this.transformDragRef = { angle, dist, rotY: p.rotY, scale: p.scale };
        return;
      }
      if (this.tool === 'rotate') {
        this.updateSelectedPlacement({ rotY: wrapAngle(ref.rotY + (angle - ref.angle)) }, false);
      } else {
        const next = ref.scale * (dist / ref.dist);
        const clamped = Math.min(PLACEMENT_SCALE_MAX, Math.max(PLACEMENT_SCALE_MIN, next));
        this.updateSelectedPlacement({ scale: Math.round(clamped * 100) / 100 }, false);
      }
      return;
    }
    this.updateSelectedPlacement({ x: w.x, z: w.z }, false, {
      detachOnMove: true,
    });
  }

  /** Release: ONE commit diffed against the pre-drag base (single Ctrl+Z). */
  private endPlacementDrag(): void {
    this.placementDragging = false;
    this.transformDragRef = null;
    this.updateSelectedPlacement({}, true);
    this.inspector.refresh();
  }

  /** Shift+wheel rotates, Alt+wheel scales; a burst commits once at the end. */
  private transformWheel(kind: 'rotate' | 'scale', deltaY: number): boolean {
    if (!isSelectionTool(this.tool) || this.selectedPlacement === null) return false;
    const p = this.map.placements[this.selectedPlacement];
    if (!p) return false;
    if (kind === 'rotate')
      this.updateSelectedPlacement({ rotY: rotateStep(p.rotY, deltaY) }, false);
    else this.updateSelectedPlacement({ scale: scaleStep(p.scale, deltaY) }, false);
    this.scheduleTransformCommit();
    return true;
  }

  /** Arrow-key nudge on the ground plane, relative to the camera yaw. */
  private nudgeSelected(key: NudgeKey, big: boolean): void {
    const i = this.selectedPlacement;
    const p = i === null ? undefined : this.map.placements[i];
    if (!p) return;
    const yaw =
      this.viewMode === '3d' ? (this.viewport3d?.cameraYaw() ?? NORTH_UP_YAW) : NORTH_UP_YAW;
    const d = nudgeDelta(key, yaw, big ? NUDGE_STEP_BIG_YD : NUDGE_STEP_YD);
    this.updateSelectedPlacement({ x: p.x + d.dx, z: p.z + d.dz }, false, {
      detachOnMove: true,
    });
    this.scheduleTransformCommit();
  }

  /** Debounce the burst commit: one undo entry per wheel spin / key volley. */
  private scheduleTransformCommit(): void {
    this.transformCoalescer.tick(performance.now());
    window.clearTimeout(this.transformTimer);
    this.transformTimer = window.setTimeout(() => {
      if (this.transformCoalescer.due(performance.now())) {
        this.updateSelectedPlacement({}, true);
        this.inspector.refresh();
      }
    }, this.transformCoalescer.windowMs);
  }

  /** Commit an open burst NOW (selection change, undo/redo). */
  private flushTransformCommit(): void {
    if (!this.transformCoalescer.pending) return;
    this.transformCoalescer.cancel();
    window.clearTimeout(this.transformTimer);
    this.updateSelectedPlacement({}, true);
  }

  private duplicateSelectedPlacement(): void {
    // Duplicates the whole multi-selection (box select / Shift+click), offset
    // together so the copies keep their relative layout.
    const indices = [...this.selectedSet].sort((a, b) => a - b);
    if (indices.length === 0 && this.selectedPlacement !== null) {
      indices.push(this.selectedPlacement);
    }
    const copies = indices
      .map((i) => this.map.placements[i])
      .filter((p): p is AssetPlacement => !!p)
      .map((p) => ({ ...p, x: p.x + 2, z: p.z + 2 }));
    if (copies.length === 0) return;
    const start = this.map.placements.length;
    this.appendPlacements(copies, 'duplicate-placement');
    this.setSelectedPlacement(start);
    this.selectedSet = new Set(copies.map((_, k) => start + k));
    this.syncMultiSelectionView();
    this.inspector.refresh();
  }

  /**
   * Blender Shift+D: duplicate the WHOLE multi-selection in place, select the
   * copies, and let them follow the cursor until a click drops them (Escape
   * drops them where they are).
   */
  private duplicateAndGrab(): void {
    const indices = [...this.selectedSet].sort((a, b) => a - b);
    const members = indices
      .map((i) => this.map.placements[i])
      .filter((q): q is AssetPlacement => q !== undefined);
    if (members.length === 0) return;
    const startLen = this.map.placements.length;
    this.appendPlacements(
      members.map((q) => ({ ...q })),
      'duplicate-placement',
    );
    const added = this.map.placements.length - startLen;
    if (added === 0) return;
    const newIndices = Array.from({ length: added }, (_, k) => startLen + k);
    this.setSelectedPlacement(newIndices[newIndices.length - 1]);
    this.selectedSet = new Set(newIndices);
    this.syncMultiSelectionView();
    this.inspector.refresh();
    this.placementDragging = true; // single-key tool shortcuts stay quiet
    this.viewport3d?.startGrabFollow();
  }

  /** Delete every selected placement as ONE undo entry. */
  private removeSelectedPlacements(): void {
    if (this.selectedSet.size <= 1) {
      if (this.selectedPlacement !== null) this.removePlacementAt(this.selectedPlacement);
      return;
    }
    const pairs = [...this.selectedSet]
      .sort((a, b) => a - b)
      .map((i) => [i, this.map.placements[i]] as const)
      .filter((pair): pair is readonly [number, AssetPlacement] => pair[1] !== undefined);
    if (pairs.length === 0) return;
    const removeAll = (): void => {
      for (let k = pairs.length - 1; k >= 0; k--) this.map.placements.splice(pairs[k][0], 1);
      this.setSelectedPlacement(null);
      this.viewport3d?.rebuildPlacements();
      this.canvasDirty = true;
    };
    removeAll();
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'remove-placements',
      undo: () => {
        for (const [i, q] of pairs) this.map.placements.splice(i, 0, q);
        this.viewport3d?.rebuildPlacements();
        this.canvasDirty = true;
      },
      redo: removeAll,
    });
    this.inspector.refresh();
  }

  // ---- camps ----------------------------------------------------------------------

  private camps(): CampDef[] {
    return this.map.content.camps as CampDef[];
  }

  private selectedCampDef(): CampDef | null {
    return this.selectedCamp === null ? null : (this.camps()[this.selectedCamp] ?? null);
  }

  private campClick(w: Vec2): void {
    const camps = this.camps();
    // Click inside an existing camp's radius selects it (nearest wins).
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < camps.length; i++) {
      const c = camps[i];
      const dx = w.x - c.center.x;
      const dz = w.z - c.center.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d <= Math.max(4, c.radius) && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    if (best >= 0) {
      this.selectedCamp = best;
      this.campMobId = camps[best].mobId;
      this.inspector.refresh();
      this.canvasDirty = true;
      return;
    }
    // New camps APPEND to content.camps (never reorder); spawns appear in playtest.
    const camp: CampDef = {
      mobId: this.campMobId,
      center: { x: w.x, z: w.z },
      radius: 10,
      count: 3,
    };
    camps.push(camp);
    this.selectedCamp = camps.length - 1;
    this.afterCampsChanged();
    this.pushUndo({
      label: 'add-camp',
      undo: () => {
        const i = this.camps().indexOf(camp);
        if (i >= 0) this.camps().splice(i, 1);
        this.selectedCamp = null;
        this.afterCampsChanged();
      },
      redo: () => {
        this.camps().push(camp);
        this.afterCampsChanged();
      },
    });
    this.inspector.refresh();
  }

  private updateSelectedCamp(change: { mobId?: string; count?: number; radius?: number }): void {
    const camp = this.selectedCampDef();
    if (!camp) return;
    const prev = { mobId: camp.mobId, count: camp.count, radius: camp.radius };
    if (change.mobId !== undefined) {
      camp.mobId = change.mobId;
      this.campMobId = change.mobId;
    }
    if (change.count !== undefined) camp.count = Math.max(1, Math.min(8, Math.round(change.count)));
    if (change.radius !== undefined) camp.radius = Math.max(4, Math.min(30, change.radius));
    const next = { mobId: camp.mobId, count: camp.count, radius: camp.radius };
    this.afterCampsChanged();
    this.pushUndo({
      label: 'edit-camp',
      undo: () => {
        Object.assign(camp, prev);
        this.afterCampsChanged();
      },
      redo: () => {
        Object.assign(camp, next);
        this.afterCampsChanged();
      },
    });
  }

  private deleteSelectedCamp(): void {
    const index = this.selectedCamp;
    if (index === null) return;
    const camp = this.camps()[index];
    if (!camp) return;
    this.camps().splice(index, 1);
    this.selectedCamp = null;
    this.afterCampsChanged();
    this.pushUndo({
      label: 'delete-camp',
      undo: () => {
        this.camps().splice(index, 0, camp);
        this.afterCampsChanged();
      },
      redo: () => {
        this.camps().splice(index, 1);
        this.selectedCamp = null;
        this.afterCampsChanged();
      },
    });
  }

  private afterCampsChanged(): void {
    this.map.meta.updatedAt = now();
    this.entities = buildEntities(this.content);
    this.base = snapshot(this.entities);
    this.canvasDirty = true;
    this.markDirty();
  }

  private clearMobSelection(): void {
    this.selectedMobIds.clear();
    this.selectedMobCamps.clear();
    this.mobDragStart = null;
    this.viewport3d?.setSelectedRuntimeMobs(this.selectedMobIds);
  }

  /** Live-facing slider for selected NPCs, committed as one undo entry. */
  private updateNpcFacing(key: string, facing: number, commit: boolean): void {
    if (!key.startsWith('npc:') || !Number.isFinite(facing)) return;
    const npcId = key.slice('npc:'.length);
    const npc = this.map.content.npcs[npcId];
    if (!npc) return;
    if (!this.npcFacingDragBase || this.npcFacingDragBase.key !== key) {
      this.npcFacingDragBase = { key, facing: npc.facing };
    }
    npc.facing = facing;
    this.viewport3d?.setMapNpcFacing(key, facing);
    this.canvasDirty = true;
    if (!commit) return;

    const previous = this.npcFacingDragBase.facing;
    this.npcFacingDragBase = null;
    if (previous === facing) return;
    const apply = (value: number): void => {
      npc.facing = value;
      this.viewport3d?.setMapNpcFacing(key, value);
      this.canvasDirty = true;
    };
    this.pushUndo({
      label: 'rotate-npc',
      undo: () => apply(previous),
      redo: () => apply(facing),
    });
    this.map.meta.updatedAt = now();
  }

  /**
   * Turn the picked mob's group camp into compatible one-mob camps. This is
   * what makes an individual selection survive JSON export and a later import.
   */
  private individualCampForRuntimeMob(entityId: number): CampDef | null {
    const runtime = this.viewport3d?.runtimeMobCamp(entityId);
    if (!runtime) return null;
    const camps = this.camps();
    const original = camps[runtime.campIndex];
    if (!original) return null;
    if (original.count === 1) return original;

    const individuals = splitCampIntoIndividuals(
      original,
      runtime.members.map((member) => ({ x: member.x, z: member.z })),
    );
    if (individuals.length === 0) return null;
    const campByMobId = new Map(
      runtime.members
        .slice(0, individuals.length)
        .map((member, index) => [member.id, individuals[index]]),
    );
    const selected = campByMobId.get(entityId);
    if (!selected) return null;

    const insertionIndex = runtime.campIndex;
    camps.splice(insertionIndex, 1, ...individuals);
    this.selectedCamp = null;
    this.afterCampsChanged();
    const clearAndRefresh = (): void => {
      this.clearMobSelection();
      this.afterCampsChanged();
      this.inspector.refresh();
    };
    this.pushUndo({
      label: 'split-mob-camp',
      undo: () => {
        const first = this.camps().indexOf(individuals[0]);
        if (first >= 0) this.camps().splice(first, individuals.length, original);
        clearAndRefresh();
      },
      redo: () => {
        const index = this.camps().indexOf(original);
        this.camps().splice(
          index >= 0 ? index : insertionIndex,
          index >= 0 ? 1 : 0,
          ...individuals,
        );
        clearAndRefresh();
      },
    });
    return selected;
  }

  // ---- spawn -----------------------------------------------------------------------

  private finishSpawnArea(): void {
    const start = this.spawnAreaStart;
    const area = this.spawnAreaPreview;
    this.spawnAreaStart = null;
    if (!start || !area) return;
    const width = area.maxX - area.minX;
    const height = area.maxZ - area.minZ;
    if (width < 2 || height < 2) {
      this.spawnAreaPreview = null;
      this.viewport3d?.setZonePreview(null);
      this.setSpawn(start);
      return;
    }
    const prev = this.map.playerSpawnArea ? { ...this.map.playerSpawnArea } : null;
    const next = {
      minX: Math.round(area.minX * 10) / 10,
      minZ: Math.round(area.minZ * 10) / 10,
      maxX: Math.round(area.maxX * 10) / 10,
      maxZ: Math.round(area.maxZ * 10) / 10,
    };
    const apply = (value: typeof next | null): void => {
      if (value) this.map.playerSpawnArea = { ...value };
      else delete this.map.playerSpawnArea;
      if (value) this.activeWorld.playerSpawnArea = { ...value };
      else delete this.activeWorld.playerSpawnArea;
      this.spawnAreaPreview = value ? { ...value } : null;
      this.viewport3d?.setZonePreview(value);
      this.canvasDirty = true;
    };
    apply(next);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'set-spawn-area',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
    this.markDirty();
    this.inspector.refresh();
  }

  private setSpawn(w: Vec2): void {
    const prev = this.map.playerStart ? { ...this.map.playerStart } : null;
    const prevArea = this.map.playerSpawnArea ? { ...this.map.playerSpawnArea } : null;
    const next = { x: Math.round(w.x * 10) / 10, z: Math.round(w.z * 10) / 10 };
    const apply = (
      v: { x: number; z: number } | null,
      area: CustomMap['playerSpawnArea'] | null,
    ): void => {
      if (v) this.map.playerStart = { ...v };
      else delete this.map.playerStart;
      if (area) this.map.playerSpawnArea = { ...area };
      else delete this.map.playerSpawnArea;
      this.activeWorld.playerStart = v ? { ...v } : { ...PLAYER_START };
      if (area) this.activeWorld.playerSpawnArea = { ...area };
      else delete this.activeWorld.playerSpawnArea;
      this.viewport3d?.setSpawnMarker(v);
      this.viewport3d?.setZonePreview(area ?? null);
      this.canvasDirty = true;
    };
    apply(next, null);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'set-spawn',
      undo: () => apply(prev, prevArea),
      redo: () => apply(next, null),
    });
    this.inspector.refresh();
  }

  private clearSpawn(): void {
    if (!this.map.playerStart && !this.map.playerSpawnArea) return;
    const prev = this.map.playerStart ? { ...this.map.playerStart } : null;
    const prevArea = this.map.playerSpawnArea ? { ...this.map.playerSpawnArea } : null;
    const apply = (
      v: { x: number; z: number } | null,
      area: CustomMap['playerSpawnArea'] | null,
    ): void => {
      if (v) this.map.playerStart = { ...v };
      else delete this.map.playerStart;
      if (area) this.map.playerSpawnArea = { ...area };
      else delete this.map.playerSpawnArea;
      this.activeWorld.playerStart = v ? { ...v } : { ...PLAYER_START };
      if (area) this.activeWorld.playerSpawnArea = { ...area };
      else delete this.activeWorld.playerSpawnArea;
      this.viewport3d?.setSpawnMarker(v);
      this.viewport3d?.setZonePreview(area ?? null);
      this.canvasDirty = true;
    };
    apply(null, null);
    this.pushUndo({
      label: 'clear-spawn',
      undo: () => apply(prev, prevArea),
      redo: () => apply(null, null),
    });
  }

  // ---- water ------------------------------------------------------------------------

  private previewWater(v: number): void {
    this.map.waterLevel = v === WATER_LEVEL ? undefined : v;
    this.syncWaterToActive();
    window.clearTimeout(this.waterTimer);
    this.waterTimer = window.setTimeout(() => this.viewport3d?.rebuildWater(), WATER_DEBOUNCE_MS);
  }

  private commitWater(v: number): void {
    const prev = this.waterBase;
    if (prev === v) return;
    this.waterBase = v;
    const apply = (level: number): void => {
      this.map.waterLevel = level === WATER_LEVEL ? undefined : level;
      this.syncWaterToActive();
      this.viewport3d?.rebuildWater();
    };
    apply(v);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'water-level',
      undo: () => {
        this.waterBase = prev;
        apply(prev);
      },
      redo: () => {
        this.waterBase = v;
        apply(v);
      },
    });
  }

  private applyWaterTint(hue: number | null, lum: number | null): void {
    if (hue === null) this.map.waterHue = undefined;
    else this.map.waterHue = Math.min(360, Math.max(0, hue));
    if (lum === null) this.map.waterLum = undefined;
    else this.map.waterLum = Math.min(1, Math.max(0, lum));
    if (this.map.waterHue !== undefined) this.activeWorld.waterHue = this.map.waterHue;
    else delete this.activeWorld.waterHue;
    if (this.map.waterLum !== undefined) this.activeWorld.waterLum = this.map.waterLum;
    else delete this.activeWorld.waterLum;
  }

  private previewWaterTint(hue: number | null, lum: number | null): void {
    this.applyWaterTint(hue, lum);
    window.clearTimeout(this.waterTimer);
    this.waterTimer = window.setTimeout(() => this.viewport3d?.rebuildWater(), WATER_DEBOUNCE_MS);
  }

  private commitWaterTint(hue: number | null, lum: number | null): void {
    const prevHue = this.map.waterHue ?? null;
    const prevLum = this.map.waterLum ?? null;
    if (prevHue === hue && prevLum === lum) return;
    const apply = (h: number | null, l: number | null): void => {
      this.applyWaterTint(h, l);
      this.viewport3d?.rebuildWater();
    };
    apply(hue, lum);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'water-tint',
      undo: () => apply(prevHue, prevLum),
      redo: () => apply(hue, lum),
    });
  }

  // ---- region clipboard ---------------------------------------------------------------

  private copyRegion(): void {
    if (!this.regionBox) {
      this.toasts.info(t('editor.region.needBox'));
      return;
    }
    const b = this.regionBox;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const inBox = (x: number, z: number): boolean =>
      x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
    const placements = this.map.placements
      .filter((p) => inBox(p.x, p.z))
      .map((p) => ({ ...p, x: p.x - cx, z: p.z - cz }));
    const edits = this.map.terrainEdits
      .filter((e) => inBox(e.x, e.z))
      .map((e) => ({ ...e, x: e.x - cx, z: e.z - cz }));
    this.clipboard = { placements, edits };
    this.toasts.success(
      t('editor.region.copied', {
        assets: placements.length,
        edits: edits.length,
      }),
    );
  }

  private pasteAt(world: Vec2): void {
    if (!this.clipboard) return;
    const pClamp = clampToCap(
      this.clipboard.placements,
      this.map.placements.length,
      MAX_PLACEMENTS,
    );
    const eClamp = clampToCap(
      this.clipboard.edits,
      this.map.terrainEdits.length,
      MAX_TERRAIN_EDITS,
    );
    if (pClamp.truncated) {
      this.toasts.error(t('editor.status.placementCapReached', { max: MAX_PLACEMENTS }));
    }
    if (eClamp.truncated) {
      this.toasts.error(t('editor.status.terrainCapReached', { max: MAX_TERRAIN_EDITS }));
    }
    const placements = pClamp.accepted.map((p) => ({
      ...p,
      x: p.x + world.x,
      z: p.z + world.z,
    }));
    const edits = eClamp.accepted.map((e) => ({
      ...e,
      x: e.x + world.x,
      z: e.z + world.z,
    }));
    if (placements.length === 0 && edits.length === 0) return;
    let region: RegionBox | null = null;
    for (const e of edits) region = unionRegion(region, stampRegion(e));
    const pStart = appendSpan(this.map.placements, placements);
    for (let i = 0; i < placements.length; i++) this.viewport3d?.placementAdded(pStart + i);
    const eStart = appendSpan(this.map.terrainEdits, edits);
    if (edits.length > 0) this.terrainEditsMutated();
    if (region) this.refreshTerrain(region);
    this.map.meta.updatedAt = now();
    this.canvasDirty = true;
    this.pushUndo({
      label: 'paste-region',
      undo: () => {
        removeSpan(this.map.placements, pStart, placements);
        removeSpan(this.map.terrainEdits, eStart, edits);
        if (edits.length > 0) this.terrainEditsMutated();
        this.setSelectedPlacement(null);
        this.viewport3d?.rebuildPlacements();
        this.refreshTerrain(region);
      },
      redo: () => {
        this.map.placements.push(...placements);
        this.map.terrainEdits.push(...edits);
        if (edits.length > 0) this.terrainEditsMutated();
        this.viewport3d?.rebuildPlacements();
        this.refreshTerrain(region);
      },
    });
    this.toasts.success(t('editor.region.pasted', { count: placements.length + edits.length }));
  }

  private pasteBeside(): void {
    if (!this.clipboard || !this.regionBox) {
      this.toasts.info(t('editor.region.needClipboard'));
      return;
    }
    const b = this.regionBox;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    this.pasteAt({ x: cx + (b.maxX - b.minX) + 4, z: cz });
  }

  // ---- procgen ----------------------------------------------------------------------

  private worldBounds(): Bounds {
    const zones = this.map.content.zones;
    const minZ = Math.min(...zones.map((z) => z.zMin));
    const maxZ = Math.max(...zones.map((z) => z.zMax));
    const halfX = (this.map.worldHalfX ?? 180) - 4;
    return { minX: -halfX, maxX: halfX, minZ: minZ + 8, maxZ: maxZ - 8 };
  }

  private avoidPredicate(): (x: number, z: number) => boolean {
    const seed = this.map.meta.seed;
    const zones = this.map.content.zones;
    const water = waterLevel();
    return (x: number, z: number): boolean => {
      if (terrainHeight(x, z, seed) < water + 1) return true;
      for (const zn of zones) {
        const dx = x - zn.hub.x;
        const dz = z - zn.hub.z;
        if (Math.sqrt(dx * dx + dz * dz) < zn.hub.radius + 6) return true;
      }
      return false;
    };
  }

  private runScatter(): void {
    const category =
      this.assets.selectedAssetId && isUserAssetId(this.assets.selectedAssetId)
        ? null
        : (assetById(this.assets.selectedAssetId ?? '')?.category ?? 'foliage');
    const pool = category
      ? ASSET_CATALOG.filter((a) => a.category === category).map((a) => a.id)
      : this.placeAssetId
        ? [this.placeAssetId]
        : [];
    if (pool.length === 0) {
      this.toasts.info(t('editor.procgen.noAssets'));
      return;
    }
    const seed = (this.map.meta.seed ^ (this.map.placements.length * 2654435761)) >>> 0;
    const placed = scatterPlacements({
      assetIds: pool,
      count: this.scatterCount,
      bounds: this.worldBounds(),
      seed,
      minScale: 0.7,
      maxScale: 1.6,
      avoid: this.avoidPredicate(),
    });
    if (placed.length === 0) {
      this.toasts.info(t('editor.procgen.noAssets'));
      return;
    }
    this.appendPlacements(placed, 'procgen-scatter');
    this.toasts.success(
      t('editor.procgen.scattered', {
        count: placed.length,
        category: category ?? '',
      }),
    );
  }

  private runHills(): void {
    const seed = (this.map.meta.seed ^ (this.map.terrainEdits.length * 40503)) >>> 0;
    const hills = scatterHills({
      count: Math.max(6, Math.round(this.scatterCount / 6)),
      bounds: this.worldBounds(),
      seed,
      minRadius: 14,
      maxRadius: 40,
      minHeight: 4,
      maxHeight: 16,
      avoid: this.avoidPredicate(),
    });
    if (hills.length === 0) return;
    const clamp = clampToCap(hills, this.map.terrainEdits.length, MAX_TERRAIN_EDITS);
    if (clamp.truncated) {
      this.toasts.error(t('editor.status.terrainCapReached', { max: MAX_TERRAIN_EDITS }));
    }
    const accepted = clamp.accepted;
    if (accepted.length === 0) return;
    let region: RegionBox | null = null;
    for (const h of accepted) region = unionRegion(region, stampRegion(h));
    const start = appendSpan(this.map.terrainEdits, accepted);
    this.terrainEditsMutated();
    this.refreshTerrain(region);
    this.map.meta.updatedAt = now();
    this.pushUndo({
      label: 'procgen-hills',
      undo: () => {
        removeSpan(this.map.terrainEdits, start, accepted);
        this.terrainEditsMutated();
        this.refreshTerrain(region);
      },
      redo: () => {
        this.map.terrainEdits.push(...accepted);
        this.terrainEditsMutated();
        this.refreshTerrain(region);
      },
    });
    this.toasts.success(t('editor.procgen.hillsAdded', { count: accepted.length }));
  }

  // ---- undo plumbing ---------------------------------------------------------------

  private syncUndoUi(): void {
    this.topbar.setUndoDepth(this.undo.depth);
    this.topbar.setUndoState(this.undo.canUndo, this.undo.canRedo);
  }

  private pushUndo(cmd: { label: string; undo(): void; redo(): void }): void {
    this.undo.push(cmd);
    this.markDirty();
    this.syncUndoUi();
  }

  private doUndo(): void {
    // An open transform burst commits first, so Ctrl+Z reverts THAT burst.
    this.flushTransformCommit();
    if (this.undo.undo()) {
      this.markDirty();
      this.inspector.refresh();
    }
    this.syncUndoUi();
  }

  private doRedo(): void {
    this.flushTransformCommit();
    if (this.undo.redo()) {
      this.markDirty();
      this.inspector.refresh();
    }
    this.syncUndoUi();
  }

  private markDirty(): void {
    this.dirty = true;
    this.editGen.bump();
    this.topbar.setDirty(true);
    this.canvasDirty = true;
  }

  // ---- save / open / import / export -----------------------------------------------

  /**
   * Save locally + to the server. `auto` = fired by the autosave tick: it must
   * stay silent on success (no toast per tick) and must NEVER open a dialog;
   * any failure (conflict included) turns autosave off with one explanatory
   * toast, so a broken save path cannot loop.
   */
  private async save(auto = false): Promise<void> {
    if (this.saving) return;
    this.map.meta.updatedAt = now();
    // Snapshot the edit generation the payload covers: edits made while the
    // network call is in flight must keep the doc dirty and the draft alive.
    const generation = this.editGen.current;
    const okLocal = this.io.saveLocal(this.map);
    // A blocked local save warns but never blocks the server save.
    if (!okLocal) {
      if (auto) {
        this.autosaveErrored(t('editor.status.saveFailedLocal'));
        return;
      }
      this.toasts.error(t('editor.status.saveFailedLocal'));
    }
    if (!signedIn()) {
      if (okLocal) {
        this.finishSave(
          t('editor.status.savedLocalOnly', { name: this.map.meta.name }),
          null,
          generation,
          auto,
        );
      }
      return;
    }
    this.saving = true;
    this.topbar.setSaving(true);
    try {
      const link = await this.io.saveServer(this.map);
      this.finishSave(
        t('editor.status.savedServer', {
          name: this.map.meta.name,
          version: link.version,
        }),
        link.version,
        generation,
        auto,
      );
    } catch (err) {
      if (auto) {
        this.autosaveErrored(
          t(
            err instanceof EditorApiError
              ? editorErrorKey(err.code, err.status)
              : editorErrorKey(null),
          ),
        );
        this.topbar.setSaveState(t('editor.topbar.savedLocal'));
      } else if (err instanceof EditorApiError && err.code === 'version_conflict') {
        await this.resolveConflict(err.serverVersion ?? 0);
      } else {
        const key =
          err instanceof EditorApiError
            ? editorErrorKey(err.code, err.status)
            : editorErrorKey(null);
        this.toasts.error(t(key));
        this.topbar.setSaveState(t('editor.topbar.savedLocal'));
      }
    } finally {
      this.saving = false;
      this.topbar.setSaving(false);
    }
  }

  /** An automatic save failed: turn the feature off and say why, once. */
  private autosaveErrored(reason: string): void {
    this.setAutosave(false);
    this.toasts.error(t('editor.status.autosaveOff', { reason }));
  }

  private finishSave(
    message: string,
    serverVersion: number | null,
    generation: number,
    quiet = false,
  ): void {
    const fin = this.editGen.finalize(generation);
    if (fin.clearDirty) {
      this.dirty = false;
      this.topbar.setDirty(false);
    }
    this.topbar.setSaveState(
      serverVersion === null
        ? t('editor.topbar.savedLocal')
        : t('editor.topbar.savedServer', { version: serverVersion }),
    );
    this.topbar.setForkEnabled(this.io.linkFor(this.map.meta.id) !== null);
    // Only clear THIS map's draft, and only when no mid-save edits landed.
    if (fin.clearDraft) this.io.draftClear(this.map.meta.id);
    // Autosaves succeed silently: one toast per 30s tick would be noise.
    if (!quiet) this.toasts.success(message);
  }

  private async resolveConflict(serverVersion: number): Promise<void> {
    const copy = await confirmDialog(this.root, {
      title: t('editor.confirm.conflictTitle'),
      body: t('editor.confirm.conflictBody', { version: serverVersion }),
      confirmLabel: t('editor.confirm.conflictSaveCopy'),
    });
    if (!copy) {
      this.topbar.setSaveState(t('editor.topbar.savedLocal'));
      return;
    }
    // A copy is a new document identity: new meta.id, no server link yet.
    this.io.setLink(this.map.meta.id, null);
    this.map.meta.id = mintId();
    try {
      // Re-snapshot: the payload serialized below includes every edit made up
      // to this point (including any made while the conflict dialog was open).
      const generation = this.editGen.current;
      const link = await this.io.saveServerAsCopy(this.map);
      this.io.saveLocal(this.map);
      this.finishSave(
        t('editor.status.savedServer', {
          name: this.map.meta.name,
          version: link.version,
        }),
        link.version,
        generation,
      );
    } catch (err) {
      const key =
        err instanceof EditorApiError ? editorErrorKey(err.code, err.status) : editorErrorKey(null);
      this.toasts.error(t(key));
    }
  }

  private async saveAs(): Promise<void> {
    const name = await promptDialog(
      this.root,
      t('editor.prompt.saveAsTitle'),
      t('editor.prompt.nameLabel'),
      this.map.meta.name,
    );
    if (!name) return;
    this.map.meta.name = name;
    this.map.meta.id = mintId();
    this.map.meta.createdAt = now();
    this.topbar.setMapName(name);
    this.topbar.setForkEnabled(false);
    await this.save();
  }

  private async forkCurrent(): Promise<void> {
    const link = this.io.linkFor(this.map.meta.id);
    if (!link) return;
    try {
      const forked = await forkMap(link.serverId);
      this.toasts.success(t('editor.status.forked', { name: forked.name }));
      this.openServerMap(forked, true);
    } catch (err) {
      const key =
        err instanceof EditorApiError ? editorErrorKey(err.code, err.status) : editorErrorKey(null);
      this.toasts.error(t(key));
    }
  }

  /** True when it is safe to replace the working document (confirms if dirty). */
  private async confirmDiscard(): Promise<boolean> {
    if (!this.dirty) return true;
    return confirmDialog(this.root, {
      title: t('editor.confirm.discardTitle'),
      body: t('editor.confirm.discardBody', { name: this.map.meta.name }),
      confirmLabel: t('editor.confirm.discard'),
      danger: true,
    });
  }

  private async openServerMap(full: MapFullWire, mine: boolean): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    // Re-run the shared sanitizer over the wire document (defense in depth; the
    // server stores sanitizer output, but the editor never trusts a wire byte).
    const parsed = parseMap(full.doc);
    if (!parsed) {
      this.toasts.error(t('editor.serverError.invalid_map_doc'));
      return;
    }
    parsed.meta.name = full.name;
    this.loadMap(parsed);
    if (mine) {
      this.io.setLink(parsed.meta.id, {
        serverId: full.id,
        version: full.version,
      });
      this.topbar.setForkEnabled(true);
      this.topbar.setSaveState(t('editor.topbar.savedServer', { version: full.version }));
    } else {
      this.io.setLink(parsed.meta.id, null);
      this.topbar.setForkEnabled(false);
    }
    this.toasts.success(t('editor.status.opened', { name: full.name }));
  }

  private async newMap(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.loadMap(newCustomMap(t('editor.untitledMap'), mintId(), now()));
    this.toasts.info(t('editor.status.newMap'));
  }

  private async newFlatMap(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const size = await newMapSizeDialog(this.root);
    if (!size) return;
    this.loadMap(newFlatCustomMap(t('editor.flatMapName'), mintId(), now(), size));
    this.toasts.info(t('editor.status.newFlatMap'));
  }

  private async importFile(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const outcome = await pickMapOrBundle();
    // A dismissed file dialog is not a failure: stay silent rather than flash an
    // error the maker did not cause.
    if (outcome.status === 'cancelled') return;
    if (outcome.status === 'invalid') {
      this.toasts.error(t('editor.status.importFailed'));
      return;
    }
    const map = outcome.map;
    // loadMap now restores saved 'local/<sha>' models on every load path
    // (see ensureStoredLocalAssets); a bundle's freshly-restored bytes are in
    // the store by now, so they register here too. Ground textures + skybox
    // still need a nudge since the bundle may have added new ones.
    this.loadMap(map);
    refreshCustomGroundTextures();
    this.applySkybox();
    this.toasts.success(t('editor.status.imported', { name: map.meta.name }));
    // A plain map.json (or a .json downloaded on its own) carries no dependency
    // BYTES, so a map that uses imported models / custom ground textures / an
    // uploaded skybox re-imports as an empty-looking world in a fresh browser.
    // Detect that and tell the maker to use the .wocmap.zip instead, so the
    // silent "it didn't load my map" becomes an actionable message.
    void this.warnMissingImportDeps(map);
  }

  /**
   * After an import, count the map's dependencies whose BYTES are missing from
   * THIS browser: imported local models ('local/<sha>' placements), custom
   * ground-texture swatches, and an uploaded ('custom:<sha>') skybox. A bundle
   * (.wocmap.zip) restores these before load; a bare map.json cannot carry
   * them, so such a map re-imports as an empty-looking world with a misleading
   * success toast. When any are missing, surface an actionable warning pointing
   * at the .wocmap.zip. Best effort: a failed probe never affects the import.
   */
  private async warnMissingImportDeps(map: CustomMap): Promise<void> {
    try {
      let missing = 0;
      const localShas = new Set<string>();
      for (const p of map.placements) {
        if (isLocalAssetId(p.assetId)) localShas.add(p.assetId.slice('local/'.length));
      }
      if (localShas.size > 0) {
        const stored = new Set((await loadStoredLocalAssets()).map((a) => a.sha256));
        for (const sha of localShas) if (!stored.has(sha)) missing++;
      }
      for (const sw of map.biomePaint?.custom ?? []) {
        if (sw.textureSha && !(await loadGroundTextureBytes(sw.textureSha))) missing++;
      }
      if (map.skybox?.startsWith('custom:')) {
        if (!(await loadSkyboxBytes(map.skybox.slice('custom:'.length)))) missing++;
      }
      if (missing > 0) {
        this.toasts.error(t('editor.status.importMissingDeps', { count: missing }));
      }
    } catch {
      // Blocked/absent storage: skip the probe rather than block the import.
    }
  }

  private exportFile(): void {
    void this.exportBundle();
  }

  /**
   * Bundle export: the map JSON plus every browser-stored dependency (imported
   * models, ground textures, uploaded skybox). Prefers a real folder via the
   * File System Access API (pick Documents and a "<name> map bundle" folder is
   * created inside); falls back to downloading one .wocmap.zip. Both carry the
   * zip, which Import reads back on any computer.
   */
  private async exportBundle(): Promise<void> {
    this.map.meta.updatedAt = now();
    const safe = this.map.meta.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'map';
    try {
      const files = await buildMapBundle(this.map);
      const zip = zipStore(files);
      const picker = (
        window as unknown as {
          showDirectoryPicker?: (opts?: { mode?: string }) => Promise<{
            getDirectoryHandle: (
              name: string,
              opts: { create: boolean },
            ) => Promise<{
              getFileHandle: (
                name: string,
                opts: { create: boolean },
              ) => Promise<{
                createWritable: () => Promise<{
                  write: (data: Uint8Array) => Promise<void>;
                  close: () => Promise<void>;
                }>;
              }>;
            }>;
          }>;
        }
      ).showDirectoryPicker;
      if (picker) {
        try {
          const root = await picker.call(window, { mode: 'readwrite' });
          const dir = await root.getDirectoryHandle(`${safe} map bundle`, {
            create: true,
          });
          const writeFile = async (name: string, data: Uint8Array): Promise<void> => {
            const fh = await dir.getFileHandle(name, { create: true });
            const w = await fh.createWritable();
            await w.write(data);
            await w.close();
          };
          for (const f of files) {
            // Skip the bare map.json: the .wocmap.zip below is the ONE
            // importable artifact, and a loose map.json sitting in the folder is
            // exactly what a maker picks by mistake, importing it drops every
            // model/texture/skybox (they live only in the zip). The remaining
            // entries (models_*/textures_*/skybox_*) are flattened for human
            // inspection, not for Import.
            if (f.path === 'map.json') continue;
            // Flatten subpaths into the folder ('models/x.glb' -> 'models_x.glb'
            // stays readable without nested handle plumbing).
            await writeFile(f.path.replace(/\//g, '_'), f.bytes);
          }
          await writeFile(`${safe}.wocmap.zip`, zip);
          this.toasts.success(t('editor.status.bundleExported', { name: this.map.meta.name }));
          return;
        } catch (err) {
          // Cancelled picker falls back to the zip download below.
          if ((err as Error)?.name === 'AbortError') return;
        }
      }
      const blob = new Blob([zip as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}.wocmap.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.toasts.success(t('editor.status.bundleExported', { name: this.map.meta.name }));
    } catch {
      // Bundle build failed (blocked storage?): at least export the JSON.
      downloadMap(this.map);
      this.toasts.success(t('editor.status.exported', { name: this.map.meta.name }));
    }
  }

  /**
   * In-game settings dialog (More > Settings): graphics quality + sound, written
   * to the SHARED game settings store so a playtest boots with the same values.
   * Sound applies live to the audio/music singletons; the graphics preset is
   * read at engine boot, so it takes effect on the next playtest or editor
   * reload (offered inline). This is a focused editor surface, not the full
   * in-game options menu (which needs the running game HUD).
   */
  private openGameSettings(): void {
    const s = this.gameSettings;
    const modal = buildModal(this.root, t('editor.settings.title'), () => {});
    const panel = modal.panel;
    panel.appendChild(el('p', 'ed-modal-body', t('editor.settings.hint')));

    // ---- graphics quality preset (Low/Medium/High/Ultra) --------------------
    panel.appendChild(el('h3', 'ed-subtitle', t('editor.settings.graphicsTitle')));
    const presets: { value: number; labelKey: string }[] = [
      { value: 1, labelKey: 'editor.settings.graphicsLow' },
      { value: 2, labelKey: 'editor.settings.graphicsMedium' },
      { value: 3, labelKey: 'editor.settings.graphicsHigh' },
      { value: 4, labelKey: 'editor.settings.graphicsUltra' },
    ];
    const row = el('div', 'ed-row ed-wrap');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('editor.settings.graphicsTitle'));
    const currentPreset = () => Math.round(s.get('graphicsPreset'));
    for (const p of presets) {
      const b = button(
        t(p.labelKey as Parameters<typeof t>[0]),
        () => {
          s.set('graphicsPreset', p.value);
          for (const other of row.querySelectorAll('button')) other.classList.remove('active');
          b.classList.add('active');
        },
        'small',
      );
      b.setAttribute('role', 'radio');
      const active = currentPreset() === p.value;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', active ? 'true' : 'false');
      row.appendChild(b);
    }
    panel.appendChild(row);
    panel.appendChild(el('p', 'ed-hint', t('editor.settings.graphicsHint')));
    panel.appendChild(
      button(t('editor.settings.applyGraphics'), () => window.location.reload(), 'small'),
    );

    // ---- sound --------------------------------------------------------------
    panel.appendChild(el('h3', 'ed-subtitle', t('editor.settings.soundTitle')));
    const pct = (v: number): string => `${Math.round(v)}%`;
    panel.appendChild(
      slider(t('editor.settings.sfxVolume'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(s.get('sfxVolume') * 100),
        onInput: (v) => {
          const vol = s.set('sfxVolume', v / 100);
          try {
            audio.setVolume(vol);
          } catch {
            // Audio context not up in this editor session: the value still persists.
          }
        },
        format: pct,
      }).root,
    );
    panel.appendChild(
      slider(t('editor.settings.musicVolume'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(s.get('musicVolume') * 100),
        onInput: (v) => {
          const vol = s.set('musicVolume', v / 100);
          try {
            music.setVolume(vol);
          } catch {
            // Music not initialized in the editor: the value still persists.
          }
        },
        format: pct,
      }).root,
    );
    panel.appendChild(
      checkbox(t('editor.settings.music'), music.enabled, (on) => {
        try {
          music.setEnabled(on);
        } catch {
          // No-op if music is not running in this editor session.
        }
      }).root,
    );

    const actions = el('div', 'ed-modal-actions');
    actions.appendChild(button(t('editor.settings.close'), () => modal.close(), 'primary'));
    panel.appendChild(actions);
  }

  private playtest(): void {
    // Playtest navigates away; fully save the document to the local JSON
    // store first and leave a resume marker, so the game's "Back to Editor"
    // button reopens this exact map with nothing lost.
    this.map.meta.updatedAt = now();
    const generation = this.editGen.current;
    if (this.io.saveLocal(this.map)) {
      clearPlaytestRecoveryDraft(this.map.meta.id);
      this.finishSave(
        t('editor.status.savedLocalOnly', { name: this.map.meta.name }),
        null,
        generation,
        true,
      );
    } else {
      // Blocked store: require a launch draft before leaving the editor, so the
      // browser Back button can recover this exact document even if playtest
      // navigation fails before the game boots.
      const draftSaved = this.io.draftSave(this.map);
      const recoverySaved = draftSaved || savePlaytestRecoveryDraft(this.map);
      if (!recoverySaved) {
        this.dirty = true;
        this.topbar.setDirty(true);
        this.toasts.error(t('editor.status.playtestFailed'));
        return;
      }
    }
    try {
      sessionStorage.setItem(PLAYTEST_RESUME_KEY, this.map.meta.id);
    } catch {
      /* blocked storage: the return trip lands on a blank editor as before */
    }
    const world = customMapToWorldContent(this.map);
    this.toasts.info(t('editor.status.playtestLaunch'));
    const ok = launchPlaytest(world, {
      seed: this.map.meta.seed,
      playerClass: 'warrior',
      playerName: t('editor.playtestPlayerName'),
    });
    if (!ok) this.toasts.error(t('editor.status.playtestFailed'));
  }

  private async uploadAsset(): Promise<void> {
    if (!signedIn()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,model/gltf-binary';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.glb')) {
        this.toasts.error(t('editor.upload.notGlb'));
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        this.toasts.error(t('editor.upload.tooLarge'));
        return;
      }
      this.toasts.info(t('editor.upload.uploading'));
      try {
        const bytes = await file.arrayBuffer();
        const name = file.name.replace(/\.glb$/i, '');
        const { asset, existing } = await uploadAsset(bytes, name);
        registerUserAssets([
          {
            id: asset.id,
            sha256: asset.sha256,
            name: asset.name,
            byteSize: asset.byteSize,
          },
        ]);
        const assetId = userAssetIdFor(asset.sha256);
        // One-time collision bake from the just-uploaded bytes (the server
        // copy is identical): the boxes ride the map doc keyed by the user id.
        const bakeUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
        void bakeImportedModelCollision(bakeUrl)
          .then((boxes) => {
            if (!boxes || boxes.length === 0) return;
            if (!this.map.assetCollision) this.map.assetCollision = {};
            this.map.assetCollision[assetId] = boxes;
            this.viewport3d?.setAssetCollisionOverrides();
            this.markDirty();
          })
          .finally(() => URL.revokeObjectURL(bakeUrl));
        this.placeAssetId = assetId;
        this.placeAssetLabel = asset.name ?? asset.sha256.slice(0, 8);
        this.setTool('place');
        this.assets.showUploaded(assetId);
        this.toasts.success(
          existing
            ? t('editor.upload.uploadedExisting')
            : t('editor.upload.uploaded', { name: this.placeAssetLabel }),
        );
      } catch (err) {
        const key =
          err instanceof EditorApiError
            ? editorErrorKey(err.code, err.status)
            : editorErrorKey(null);
        this.toasts.error(t(key));
      }
    };
    input.click();
  }

  /**
   * Import a .glb/.gltf model straight from disk, fully offline: the file is
   * content-hashed into a 'local/<sha256>' id, served to the GLB loader via an
   * object URL, and placed like any catalog asset. Session-scoped (a reload
   * drops the blob); re-importing the same file rebinds saved placements
   * because the id is the content hash.
   */
  /** Paint panel: import an image; its average color becomes a custom swatch
   *  (full image splatting is not supported; the swatch label keeps the file
   *  name so the source is traceable). */
  private importTextureSwatch(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        try {
          const c = document.createElement('canvas');
          c.width = 24;
          c.height = 24;
          const ctx = c.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          ctx.drawImage(img, 0, 0, 24, 24);
          const data = ctx.getImageData(0, 0, 24, 24).data;
          let rSum = 0;
          let gSum = 0;
          let bSum = 0;
          const n = data.length / 4;
          for (let i = 0; i < data.length; i += 4) {
            rSum += data[i];
            gSum += data[i + 1];
            bSum += data[i + 2];
          }
          const color =
            (Math.round(rSum / n) << 16) | (Math.round(gSum / n) << 8) | Math.round(bSum / n);
          const label = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, MAX_SWATCH_LABEL_LENGTH);
          // Persist the image (content-addressed) so painting tiles the REAL
          // texture; the average color stays as the no-texture fallback. The
          // stored bytes are the COMPRESSED encoding (downscale + WebP), so
          // the sha is computed on exactly what IndexedDB keeps.
          let sha: string | undefined;
          try {
            const stored = await compressGroundTextureImport(img, file);
            const digest = await crypto.subtle.digest('SHA-256', stored.bytes);
            sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
            await storeGroundTexture({
              sha256: sha,
              name: label,
              mime: stored.mime,
              bytes: stored.bytes,
            });
          } catch {
            sha = undefined; // insecure context: color-only swatch
          }
          this.addCustomSwatch(color, label, sha);
        } catch {
          this.toasts.error(t('editor.biome.importTextureFailed'));
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        this.toasts.error(t('editor.biome.importTextureFailed'));
      };
      img.src = url;
    };
    input.click();
  }

  private importModel(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf,model/gltf-binary,model/gltf+json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const lower = file.name.toLowerCase();
      const isGlb = lower.endsWith('.glb');
      if (!isGlb && !lower.endsWith('.gltf')) {
        this.toasts.error(t('editor.importModel.notModel'));
        return;
      }
      if (file.size > 64 * 1024 * 1024) {
        this.toasts.error(t('editor.importModel.tooLarge'));
        return;
      }
      try {
        const bytes = await file.arrayBuffer();
        let sha: string;
        try {
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        } catch {
          // Insecure context: fall back to a session-unique id (no rebinding).
          sha = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
        }
        const url = URL.createObjectURL(
          new Blob([bytes], {
            type: isGlb ? 'model/gltf-binary' : 'model/gltf+json',
          }),
        );
        const name = file.name.replace(/\.(glb|gltf)$/i, '');
        const assetId = registerLocalAsset({
          id: localAssetIdFor(sha),
          name,
          url,
          byteSize: file.size,
        });
        // Persist the bytes so the import survives reloads (restored at boot).
        void storeLocalAssetBytes({
          sha256: sha,
          name,
          mime: isGlb ? 'model/gltf-binary' : 'model/gltf+json',
          bytes,
          byteSize: file.size,
        });
        // One-time collision bake (type-aware): the boxes ride the map doc so
        // playtests and exports collide with the model's real silhouette.
        void bakeImportedModelCollision(url).then((boxes) => {
          if (!boxes || boxes.length === 0) return;
          if (!this.map.assetCollision) this.map.assetCollision = {};
          this.map.assetCollision[assetId] = boxes;
          this.viewport3d?.setAssetCollisionOverrides();
          this.markDirty();
        });
        this.placeAssetId = assetId;
        this.placeAssetLabel = name;
        this.setTool('place');
        this.assets.showImported(assetId);
        this.toasts.success(t('editor.importModel.imported', { name }));
      } catch {
        this.toasts.error(t('editor.importModel.failed'));
      }
    };
    input.click();
  }

  private setAutosave(on: boolean): void {
    this.autosaveOn = on;
    this.topbar.setAutosave(on);
    try {
      localStorage.setItem(AUTOSAVE_PREF_KEY, on ? '1' : '0');
    } catch {
      // Blocked storage: the toggle still works for this session.
    }
  }

  private autosave(): void {
    if (!this.dirty) return;
    const ok = this.io.draftSave(this.map);
    if (ok) {
      this.autosaveWarned = false;
    } else if (!this.autosaveWarned) {
      // Surface a silent autosave failure once per failure episode: the user
      // believes a draft backup exists when it does not.
      this.autosaveWarned = true;
      this.toasts.error(t('editor.status.autosaveFailed'));
    }
    // The opt-in FULL autosave rides the same tick, strictly gated: never over
    // an in-flight save and never mid-gesture (it would serialize a half-drawn
    // stroke's undo state).
    if (
      shouldAutosave({
        enabled: this.autosaveOn,
        dirty: this.dirty,
        saving: this.saving,
        editing: this.pointerEditActive || this.placementDragging,
      })
    ) {
      void this.save(true);
    }
  }

  /**
   * The 10-minute tick: a full LOCAL save of the current map's stored JSON,
   * always on (unlike the opt-in autosave toggle, and local-only so it can
   * never surprise the user with a server version bump). Same gesture/in-flight
   * gates as autosave; silent on success, silent on failure (the 30s draft
   * backup already warns when storage is broken).
   */
  private localBackupSave(): void {
    if (!this.dirty || this.saving || this.pointerEditActive || this.placementDragging) return;
    this.map.meta.updatedAt = now();
    const generation = this.editGen.current;
    if (this.io.saveLocal(this.map)) {
      this.finishSave(
        t('editor.status.savedLocalOnly', { name: this.map.meta.name }),
        null,
        generation,
        true,
      );
    }
  }

  // Replace the whole working document and rebuild the editor over its content.
  private loadMap(map: CustomMap): void {
    promoteMajorWorldProps(map as CustomMap);
    this.map = map;
    this.content = map.content;
    this.entities = buildEntities(map.content);
    this.base = snapshot(this.entities);
    this.undo.clear();
    this.dirty = false;
    this.selectedKey = null;
    this.clearMobSelection();
    this.npcFacingDragBase = null;
    this.hoverKey = null;
    this.selectedPlacement = null;
    this.placementDragBase = null;
    this.transformCoalescer.cancel();
    window.clearTimeout(this.transformTimer);
    this.placementDragging = false;
    this.transformDragRef = null;
    this.markerDragStart = null;
    this.selectedCamp = null;
    this.regionBox = null;
    this.clipboard = null;
    this.blockerStart = null;
    this.blockerPreview = null;
    this.drawingBlocker2d = false;
    this.waterBase = map.waterLevel ?? WATER_LEVEL;
    this.rebuildActiveWorld();
    this.applySkybox();
    this.topbar.setMapName(map.meta.name);
    this.topbar.setDirty(false);
    this.syncUndoUi();
    this.topbar.setForkEnabled(this.io.linkFor(map.meta.id) !== null);
    this.topbar.setSaveState(t('editor.topbar.neverSaved'));
    this.frameAll();
    this.canvasDirty = true;
    this.inspector.refresh();
    // The reload rebuilds the render view, which resets its footprint flag:
    // reapply the effective overlay once the fresh engine is up.
    if (this.viewport3d) {
      this.show3dLoading();
      void this.viewport3d.reload(map).then(() => {
        this.hide3dLoading();
        this.syncFootprintOverlay();
      });
    }
    // Make this map's saved extra assets (imported 'local/<sha>' models kept in
    // IndexedDB) resolve on EVERY load path: open-from-store, draft, server, and
    // import all funnel here. Bundle import restores its own bytes into the
    // store first (file_io.pickMapOrBundle), so this picks those up too. When it
    // registers anything new, re-instance the placements that were holes.
    void this.ensureStoredLocalAssets().then((added) => {
      if (added) {
        this.viewport3d?.rebuildPlacements();
        this.inspector.refresh();
      }
    });
  }

  // ---- keyboard -----------------------------------------------------------------------

  private onKeyDown = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) this.doRedo();
      else this.doUndo();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      this.doRedo();
      return;
    }
    if (mod && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      void this.save();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'd') {
      if (this.selectedPlacement !== null) {
        ev.preventDefault();
        this.duplicateSelectedPlacement();
      }
      return;
    }
    if (mod) return;
    if (ev.key === 'Escape') {
      if (this.drawer.isOpen) {
        this.drawer.close();
        return;
      }
      // Hitbox edit mode: first Escape leaves the mode, keeping the selection.
      if (this.hitboxEdit) {
        this.exitHitboxEdit();
        return;
      }
      // A Shift+D grab in flight: drop the copies where they are.
      if (this.viewport3d?.grabFollowing) {
        this.viewport3d.cancelGrabFollow();
        this.endPlacementDrag();
        return;
      }
      if (
        this.selectedPlacement !== null ||
        this.selectedKey ||
        this.selectedCamp !== null ||
        this.selectedLight !== null ||
        this.selectedMusicArea !== null
      ) {
        this.setSelectedPlacement(null);
        this.selectedKey = null;
        this.selectedCamp = null;
        if (this.selectedLight !== null) this.setSelectedLight(null);
        if (this.selectedMusicArea !== null) this.setSelectedMusicArea(null);
        this.inspector.refresh();
        this.canvasDirty = true;
        return;
      }
      if (this.tool !== 'select') this.setTool('select');
      return;
    }
    if (ev.key === 'Delete') {
      if (this.hitboxEdit && this.hitboxEdit.selected.size > 0) this.deleteSelectedHitboxes();
      else if (this.selectedPlacement !== null) this.removeSelectedPlacements();
      else if (this.selectedLight !== null) this.deleteMapLight(this.selectedLight);
      else if (this.selectedMusicArea !== null) this.deleteMusicArea(this.selectedMusicArea);
      else if (this.selectedCamp !== null) this.deleteSelectedCamp();
      return;
    }
    if (
      (ev.key === 'ArrowUp' ||
        ev.key === 'ArrowDown' ||
        ev.key === 'ArrowLeft' ||
        ev.key === 'ArrowRight') &&
      this.selectedPlacement !== null
    ) {
      ev.preventDefault();
      this.nudgeSelected(ev.key, ev.shiftKey);
      return;
    }
    if (ev.key === '[' || ev.key === '{') {
      if (ev.shiftKey) this.brushStrength = Math.max(1, this.brushStrength - 1);
      // Proportional steps so the keys stay useful across the whole 0.4-300yd
      // range (matching the log brush slider).
      else this.brushRadius = Math.max(0.4, Math.round((this.brushRadius / 1.12) * 100) / 100);
      this.inspector.refresh();
      return;
    }
    if (ev.key === ']' || ev.key === '}') {
      if (ev.shiftKey) this.brushStrength = Math.min(50, this.brushStrength + 1);
      else this.brushRadius = Math.min(300, Math.round(this.brushRadius * 1.12 * 100) / 100);
      this.inspector.refresh();
      return;
    }
    // Shift+F toggles Free-Fly camera navigation (before the tool shortcuts,
    // which would otherwise read Shift+F as Flatten).
    if (ev.shiftKey && ev.key.toLowerCase() === 'f') {
      this.setFreeFly(!this.freeFlyOn);
      return;
    }
    // Shift+D: Blender duplicate + grab (the copies follow the cursor).
    if (ev.shiftKey && ev.key.toLowerCase() === 'd') {
      if (this.selectedPlacement !== null) {
        ev.preventDefault();
        this.duplicateAndGrab();
      }
      return;
    }
    // Period focuses the selection (Blender's numpad-period): the orbit pivot
    // snaps to it; with nothing selected, the whole map.
    if (ev.key === '.') {
      this.focusSelection();
      return;
    }
    // Single-key tool shortcuts; suppressed while the 3D viewport owns the key
    // (navigation drag, or Free-Fly's WASD/QE) and during a placement drag.
    if (this.viewport3d?.capturesKey(ev.key.toLowerCase()) || this.placementDragging) return;
    // X deletes the selection (Blender-style), same as the Delete key. The
    // region tool deliberately lost this shortcut: it is click-only now.
    if (ev.key.toLowerCase() === 'x' && !ev.altKey) {
      if (this.selectedPlacement !== null) this.removeSelectedPlacements();
      else if (this.selectedLight !== null) this.deleteMapLight(this.selectedLight);
      else if (this.selectedMusicArea !== null) this.deleteMusicArea(this.selectedMusicArea);
      else if (this.selectedCamp !== null) this.deleteSelectedCamp();
      return;
    }
    const tool = TOOL_BY_KEY.get(ev.key.toLowerCase());
    if (tool && !ev.altKey) this.setTool(tool);
  };

  // ---- camera preferences ---------------------------------------------------------

  private setFreeFly(on: boolean): void {
    this.freeFlyOn = on;
    this.viewport3d?.setFreeFly(on);
    writePref(FREE_FLY_PREF_KEY, on);
    this.inspector.refresh();
  }

  private setInvertPan(on: boolean): void {
    this.invertPanOn = on;
    this.viewport3d?.setInvertPan(on);
    writePref(INVERT_PAN_PREF_KEY, on);
  }

  private setShowPlayer(on: boolean): void {
    this.showPlayerOn = on;
    this.viewport3d?.setShowPlayer(on);
    writePref(SHOW_PLAYER_PREF_KEY, on);
  }

  /**
   * Blender-style focus (period key / Camera panel button): put the orbit
   * pivot on the selection so the camera revolves around it; with nothing
   * selected, frame the whole map.
   */
  private focusSelection(): void {
    if (!this.viewport3d) return;
    const i = this.selectedPlacement;
    const p = i === null ? undefined : this.map.placements[i];
    if (p) {
      const volume = colliderKindFor(p.assetId)
        ? colliderVolumeFromPlacement({ ...p, collide: true })
        : null;
      const extent = volume
        ? Math.max(volume.sizeX, volume.sizeY, volume.sizeZ) / 2
        : Math.max(1.5, p.scale * 2);
      this.viewport3d.focusOn(p.x, p.z, extent);
      return;
    }
    const b = this.worldBounds();
    const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    this.viewport3d.focusOn((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, extent * 0.5);
  }

  // ---- lighting ---------------------------------------------------------------

  /** The profile the lighting controls edit (Day when no override is active). */
  private effectiveLighting(): EditorLightingProfile {
    return this.lighting ?? EDITOR_LIGHTING_DAY;
  }

  /** Push the birds preference to the renderer (null = the shipped default). */
  private applyBirds(): void {
    const b = this.birds;
    const isDefault = b.enabled && b.count === 14 && b.formation;
    this.viewport3d?.setBirds(isDefault ? null : { ...b });
  }

  /** Resolve the map's skybox token to a URL and push it to the renderer. */
  private applySkybox(): void {
    const v = this.map.skybox ?? null;
    void resolveSkyboxUrl(v).then((url) => {
      // Stale resolve: the map changed while IndexedDB loaded.
      if ((this.map.skybox ?? null) !== v) return;
      this.viewport3d?.setSkybox(url);
      if (v && !url) this.toasts.error(t('editor.lighting.skyboxMissing'));
    });
  }

  /** Upload an equirect sky image: content-hashed into IndexedDB, stored on
   *  the MAP (so playtest shows it in-game and the bundle export carries it). */
  private importSkybox(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 24 * 1024 * 1024) {
        this.toasts.error(t('editor.lighting.skyboxTooLarge'));
        return;
      }
      try {
        const bytes = await file.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const sha = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        await storeSkybox({
          sha256: sha,
          name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40),
          mime: file.type || 'image/jpeg',
          bytes,
        });
        this.map.skybox = `custom:${sha}`;
        this.markDirty();
        this.applySkybox();
        this.inspector.refresh();
        this.toasts.success(t('editor.lighting.skyboxImported'));
      } catch {
        this.toasts.error(t('editor.lighting.skyboxImportFailed'));
      }
    };
    input.click();
  }

  private applyLighting(preset: string, profile: EditorLightingProfile | null): void {
    this.lightingPreset = preset;
    this.lighting = profile;
    this.viewport3d?.setLighting(profile);
    try {
      localStorage.setItem(LIGHTING_PREF_KEY, JSON.stringify({ preset, profile }));
    } catch {
      // Blocked storage: the override still applies for this session.
    }
  }

  /** Preset click: Day restores the shipped rig (no override at all). */
  private setLightingPreset(key: string): void {
    if (key === 'day') {
      this.applyLighting('day', null);
      return;
    }
    const preset = EDITOR_LIGHTING_PRESETS.find((p) => p.key === key);
    if (preset) this.applyLighting(key, { ...preset.profile });
  }

  /** Any manual control change forks the current profile into Custom. */
  private updateLighting(change: Partial<EditorLightingProfile>): void {
    this.applyLighting('custom', { ...this.effectiveLighting(), ...change });
  }

  /** The map's weather resolved with defaults for the panel. */
  private resolvedWeather(): ResolvedWeather {
    const w = this.map.weather;
    return {
      mode: w?.mode ?? 'auto',
      intensity: w?.intensity ?? 1,
      clouds: w?.clouds ? { ...w.clouds } : { coverage: 0, height: 60 },
      schedule: w?.schedule ? w.schedule.map((s) => ({ ...s })) : [],
    };
  }

  /** Store the panel's weather, keeping only non-default fields (a default
   *  map stays field-free), and push it live to the viewport. */
  private setMapWeather(w: ResolvedWeather): void {
    const out: MapWeather = {};
    if (w.mode !== 'auto') out.mode = w.mode;
    const intensity = Math.min(1, Math.max(0, w.intensity));
    if (intensity !== 1) out.intensity = intensity;
    if (w.clouds.coverage > 0.005) {
      out.clouds = {
        coverage: Math.min(1, Math.max(0, w.clouds.coverage)),
        height: Math.min(200, Math.max(0, w.clouds.height)),
      };
    }
    if (w.schedule.length > 0) {
      out.schedule = w.schedule.slice(0, MAX_WEATHER_SCHEDULE).map((s) => ({
        mode: s.mode,
        minutes: Math.min(120, Math.max(0.1, s.minutes)),
      }));
    }
    this.map.weather = Object.keys(out).length > 0 ? out : undefined;
    if (this.map.weather) this.activeWorld.weather = this.map.weather;
    else delete this.activeWorld.weather;
    this.viewport3d?.setWeather(this.map.weather ?? null);
    this.map.meta.updatedAt = now();
    this.markDirty();
  }

  // ---- inspector deps -------------------------------------------------------------------

  private inspectorDeps(): ConstructorParameters<typeof Inspector>[1] {
    return {
      getTool: () => this.tool,
      getViewMode: () => this.viewMode,
      getBrushRadius: () => this.brushRadius,
      setBrushRadius: (v) => {
        this.brushRadius = v;
        this.canvasDirty = true;
      },
      getBrushStrength: () => this.brushStrength,
      setBrushStrength: (v) => {
        this.brushStrength = v;
      },
      getTerrainEditStats: () => ({
        count: this.map.terrainEdits.length,
        max: MAX_TERRAIN_EDITS,
      }),
      getPaintBiome: () => this.paintBiome,
      getPaintHardness: () => this.paintHardness,
      setPaintHardness: (v) => {
        this.paintHardness = v;
      },
      getPaintAlpha: () => this.paintAlphaId,
      setPaintAlpha: (id) => {
        this.paintAlphaId = id;
      },
      importPaintAlpha: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const alpha = await importBrushAlpha(file);
            this.paintAlphaId = alpha.id;
            this.inspector.refresh();
          } catch {
            this.toasts.error(t('editor.biome.alphaImportFailed'));
          }
        };
        input.click();
      },
      getBucketArmed: () => this.bucketArmed,
      setBucketArmed: (on) => {
        this.bucketArmed = on;
      },
      getLocations: () => this.map.locations ?? [],
      renameLocation: (index, name) => {
        const loc = this.map.locations?.[index];
        if (!loc || !name.trim()) return;
        loc.name = name.trim().slice(0, MAX_LOCATION_NAME);
        this.authoredListsChanged();
      },
      deleteLocation: (index) => {
        this.map.locations?.splice(index, 1);
        this.authoredListsChanged();
      },
      getMapLights: () => this.map.lights ?? [],
      getSelectedLight: () => this.selectedLight,
      setSelectedLight: (index) => this.setSelectedLight(index),
      updateMapLight: (index, change) => {
        const l = this.map.lights?.[index];
        if (!l) return;
        Object.assign(l, change);
        this.authoredListsChanged();
      },
      deleteMapLight: (index) => this.deleteMapLight(index),
      getMapSounds: () => this.map.pointSounds ?? [],
      getSelectedSound: () => this.selectedSound,
      setSelectedSound: (index) => this.setSelectedSound(index),
      updateMapSound: (index, change) => {
        const sfxNode = this.map.pointSounds?.[index];
        if (!sfxNode) return;
        Object.assign(sfxNode, change);
        this.authoredListsChanged();
      },
      deleteMapSound: (index) => this.deleteMapSound(index),
      getMarkers: () => this.map.markers ?? [],
      getMarkerMode: () => ({
        placing: this.markerPlaceMode,
        kind: this.markerKind,
      }),
      setMarkerMode: (change) => {
        if (change.placing !== undefined) this.markerPlaceMode = change.placing;
        if (change.kind !== undefined) this.markerKind = change.kind;
      },
      renameMarker: (index, name) => {
        const m = this.map.markers?.[index];
        if (!m || !name.trim()) return;
        m.name = name.trim().slice(0, MAX_LOCATION_NAME);
        this.authoredListsChanged();
      },
      deleteMarker: (index) => {
        this.map.markers?.splice(index, 1);
        this.authoredListsChanged();
      },
      setPaintBiome: (id) => {
        this.paintBiome = id;
      },
      getCustomSwatches: () => this.map.biomePaint?.custom ?? [],
      pickBuiltinTexture: (key) => this.pickBuiltinTexture(key),
      setPaintAdjust: (change) => this.setPaintAdjust(change),
      saveAdjustedSwatch: () => this.saveAdjustedSwatch(),
      clearBiomePaint: () => void this.confirmClearBiomePaint(),
      getAutoTexture: () => ({ ...this.autoTexture }),
      setAutoTexture: (change) => {
        Object.assign(this.autoTexture, change);
      },
      getSculptLower: () => this.sculptLower,
      setSculptLower: (on) => {
        this.sculptLower = on;
      },
      getSculptGrab: () => this.sculptGrab,
      setSculptGrab: (on) => {
        this.sculptGrab = on;
      },
      getFlattenSmooth: () => this.flattenSmooth,
      setFlattenSmooth: (on) => {
        this.flattenSmooth = on;
      },
      getFlattenHardEdge: () => this.flattenHardEdge,
      setFlattenHardEdge: (on) => {
        this.flattenHardEdge = on;
      },
      placeWaterfall: () => {
        this.placeAssetId = WATERFALL_ASSET_ID;
        this.placeAssetLabel = t('editor.water.waterfallLabel');
        this.setTool('place');
      },
      getWaterLevel: () => this.map.waterLevel ?? WATER_LEVEL,
      previewWaterLevel: (v) => this.previewWater(v),
      commitWaterLevel: (v) => this.commitWater(v),
      resetWaterLevel: () => this.commitWater(WATER_LEVEL),
      getWaterTint: () => ({
        hue: this.map.waterHue ?? null,
        lum: this.map.waterLum ?? null,
      }),
      previewWaterTint: (hue, lum) => this.previewWaterTint(hue, lum),
      commitWaterTint: (hue, lum) => this.commitWaterTint(hue, lum),
      resetWaterTint: () => this.commitWaterTint(null, null),
      getFluidKind: () => this.fluidKind,
      setFluidKind: (kind) => {
        this.fluidKind = kind;
      },
      getRockParams: () => ({ ...this.rockParams }),
      setRockParams: (change) => {
        Object.assign(this.rockParams, change);
      },
      getRockChainState: () => ({
        mode: this.rockChainMode,
        count: this.pendingRockRig()?.points.length ?? 0,
      }),
      setRockChainMode: (on) => {
        this.rockChainMode = on;
        // Leaving chain mode keeps any laid points: they are real placements
        // now (movable, undoable); Clear removes them explicitly.
      },
      generateRockChain: () => this.generateRockChain(),
      clearRockChain: () => {
        this.clearRockChain();
        this.inspector.refresh();
      },
      getTunnelMode: () => this.tunnelMode,
      setTunnelMode: (mode) => {
        this.tunnelMode = mode;
        this.refreshHoleGuides();
      },
      getCaves: () =>
        (this.map.caves ?? []).map((c, i) => ({
          index: i,
          nodes: c.nodes.length,
          width: c.width ?? 1,
          height: c.height ?? 1,
          variance: c.variance ?? 0,
          floorVariance: c.floorVariance ?? 0,
          stalactites: c.stalactites ?? 0,
          stalagmites: c.stalagmites ?? 0,
          spikeSize: c.spikeSize ?? 1,
          startOpen: c.startOpen !== false,
          endOpen: c.endOpen !== false,
          tex: c.tex ?? null,
          texTile: c.texTile ?? null,
        })),
      getHoles: () =>
        (this.map.holes ?? []).map((h, i) => ({
          index: i,
          radius: h.radius,
        })),
      getHolePatches: () =>
        (this.map.holePatches ?? []).map((h, i) => ({
          index: i,
          radius: h.radius,
        })),
      getCavePairState: () => {
        const caves = this.map.caves ?? [];
        const pending = this.caveRigs().filter((r) => !caves.some((c) => c.id === r.id));
        return {
          // A rig still needs points while it has only its entrance.
          pendingExit: pending.some((r) => r.points.length === 1),
          readyToGenerate: pending.filter((r) => r.points.length >= 2).length,
        };
      },
      generateCaves: () => this.generatePendingCaves(),
      updateCave: (index, change, commit) => this.updateCave(index, change, commit),
      reverseCave: (index) => this.reverseCave(index),
      deleteCave: (index) => this.deleteCave(index),
      selectWholeCave: (index) => this.selectWholeCave(index),
      updateHole: (index, change, commit) => this.updateHole(index, change, commit),
      deleteHole: (index) => this.deleteHole(index),
      updateHolePatch: (index, change, commit) => this.updateHolePatch(index, change, commit),
      deleteHolePatch: (index) => this.deleteHolePatch(index),
      getPlaceScale: () => this.placeScale,
      setPlaceScale: (v) => {
        this.placeScale = v;
      },
      getPlaceCollide: () => this.placeCollide,
      setPlaceCollide: (on) => {
        this.placeCollide = on;
        // Authoring collision: surface the footprints so radii are visible.
        this.syncFootprintOverlay();
      },
      getPlaceRandomRot: () => this.placeRandomRot,
      setPlaceRandomRot: (on) => {
        this.placeRandomRot = on;
      },
      getPlaceAssetLabel: () => this.placeAssetLabel,
      mobOptions: () =>
        Object.keys(MOBS).map((id) => ({
          id,
          label: tEntity({ kind: 'mob', id, field: 'name' }),
        })),
      getSelectedCamp: () => {
        const camp = this.selectedCampDef();
        return camp && this.selectedCamp !== null
          ? {
              index: this.selectedCamp,
              mobId: camp.mobId,
              count: camp.count,
              radius: camp.radius,
            }
          : null;
      },
      updateCamp: (change) => this.updateSelectedCamp(change),
      deleteCamp: () => this.deleteSelectedCamp(),
      getSelectedMovableEntity: () => {
        if (this.selectedMobIds.size > 0) {
          const count = this.selectedMobIds.size;
          return {
            key: `mobs:${[...this.selectedMobIds].join(',')}`,
            name: count === 1 ? '1 mob' : `${count} mobs`,
            facing: null,
          };
        }
        const entity = this.entities.find((candidate) => candidate.key === this.selectedKey);
        if (!entity || !isMovableEntity(entity)) return null;
        const npcId = entity.key.startsWith('npc:') ? entity.key.slice('npc:'.length) : null;
        return {
          key: entity.key,
          name: entity.label,
          facing: npcId ? (this.map.content.npcs[npcId]?.facing ?? null) : null,
        };
      },
      updateMovableEntityFacing: (key, facing, commit) => this.updateNpcFacing(key, facing, commit),
      getSpawn: () => this.map.playerStart ?? null,
      getSpawnArea: () => this.map.playerSpawnArea ?? null,
      clearSpawn: () => this.clearSpawn(),
      copyRegion: () => this.copyRegion(),
      pasteBeside: () => this.pasteBeside(),
      getBlockerStats: () => ({
        count: this.map.blockers?.length ?? 0,
        max: MAX_BLOCKERS,
      }),
      getFoliage: () => ({ ...this.foliage }),
      setFoliage: (change) => {
        Object.assign(this.foliage, change);
      },
      getFoliageCustom: () => (this.foliageCustom ? { ...this.foliageCustom } : null),
      pickFoliageCustom: () => {
        // Reuse the currently-selected asset in the browser (same id the Place
        // tool consumes). Nothing selected: nudge the maker to pick one.
        const id = this.assets.selectedAssetId;
        if (!id) {
          this.toasts.info(t('editor.foliageTool.customNeedsPick'));
          this.assets.setVisible(true);
          return;
        }
        this.foliageCustom = { assetId: id, label: this.placementLabel(id) };
        this.inspector.refresh();
      },
      clearFoliageCustom: () => {
        this.foliageCustom = null;
        this.inspector.refresh();
      },
      importTextureSwatch: () => this.importTextureSwatch(),
      swatchTextureUrl: (sha) => groundTextureUrl(sha),
      setSwatchTileSize: (id, size) => this.setSwatchTileSize(id, size),
      getTerrainStyle: () => ({
        slopeRock: this.map.terrainStyle?.slopeRock !== false,
        snowCaps: this.map.terrainStyle?.snowCaps !== false,
        rimMountains: this.map.terrainStyle?.rimMountains !== false,
        shoreSand: this.map.terrainStyle?.shoreSand !== false,
      }),
      setTerrainStyle: (change) => this.setTerrainStyle(change),
      getColliderShape: () => this.colliderShape,
      setColliderShape: (kind) => {
        this.colliderShape = kind;
      },
      getSelection: (): PlacementSelection | null => {
        const i = this.selectedPlacement;
        const p = i === null ? undefined : this.map.placements[i];
        if (i === null || !p) return null;
        const kind = colliderKindFor(p.assetId);
        return {
          index: i,
          assetId: p.assetId,
          assetLabel: this.placementLabel(p.assetId),
          x: p.x,
          y: p.y ?? null,
          z: p.z,
          rotY: p.rotY,
          scale: p.scale,
          collide: p.collide,
          collideRadius: p.collideRadius ?? null,
          collideShape: p.collideShape ?? null,
          collisionMode: effectiveCollisionMode(p),
          hitboxCount:
            p.hitboxes?.length ??
            ASSET_COLLISION[p.assetId]?.length ??
            this.map.assetCollision?.[p.assetId]?.length ??
            0,
          hasHitboxEdits: (p.hitboxes?.length ?? 0) > 0,
          hasHitboxPreset: !!this.hitboxPresets[p.assetId],
          sameAssetCount: this.map.placements.reduce(
            (n, q, qi) => (qi !== i && q.assetId === p.assetId ? n + 1 : n),
            0,
          ),
          meshBakeReady: !!this.map.assetCollisionMesh?.[p.assetId],
          meshBakePending: this.meshBakesInFlight.has(p.assetId),
          colliderKind: kind,
          tint: p.tint ?? null,
          opacity: p.opacity ?? null,
          glow: p.glow ?? null,
          glowStrength: p.glowStrength ?? null,
          fire: p.fire === true,
          sizeX: p.sizeX ?? null,
          sizeY: p.sizeY ?? null,
          sizeZ: p.sizeZ ?? null,
          fluidKind: fluidKindFor(p.assetId),
          hue: p.hue ?? null,
          lum: p.lum ?? null,
          fluidDps: p.fluidDps ?? null,
          fluidFx: p.fluidFx ?? null,
          rockSeed: p.rockSeed ?? null,
          rockNoise: p.rockNoise ?? null,
          rockDetail: p.rockDetail ?? null,
          rockSharp: p.rockSharp ?? null,
          rockTex: p.rockTex ?? null,
          rockHeight: p.rockHeight ?? null,
          rockDepth: p.rockDepth ?? null,
          rockJag: p.rockJag ?? null,
          rockTexId: p.rockTexId ?? null,
          rockTexTile: p.rockTexTile ?? null,
        };
      },
      updateSelection: (change, commit) => this.updateSelectedPlacement(change, commit),
      duplicateSelection: () => this.duplicateSelectedPlacement(),
      deleteSelection: () => this.removeSelectedPlacements(),
      getSelectionCount: () => this.selectedSet.size,
      getBakedCollisionCount: (assetId) =>
        ASSET_COLLISION[assetId]?.length ?? this.map.assetCollision?.[assetId]?.length ?? 0,
      getFreeFly: () => this.freeFlyOn,
      setFreeFly: (on) => this.setFreeFly(on),
      getInvertPan: () => this.invertPanOn,
      setInvertPan: (on) => this.setInvertPan(on),
      getShowPlayer: () => this.showPlayerOn,
      setShowPlayer: (on) => this.setShowPlayer(on),
      getShowBoundaryWalls: () => this.showBoundaryOn,
      setShowBoundaryWalls: (on) => {
        this.showBoundaryOn = on;
        this.viewport3d?.setShowBoundaryWalls(on);
        writePref(SHOW_BOUNDARY_PREF_KEY, on);
      },
      getWireframe: () => this.wireframeOn,
      setWireframe: (on) => {
        this.wireframeOn = on;
        this.viewport3d?.setWireframe(on);
        writePref(WIREFRAME_PREF_KEY, on);
      },
      // ---- Scene Collection (Blender-style placed-object list) ----------------
      getSceneObjects: () =>
        this.map.placements
          .map((p, index) => ({
            index,
            name: p.name?.trim() ? p.name : this.placementLabel(p.assetId),
            hidden: p.hidden === true,
            selected: this.selectedSet.has(index),
          }))
          // Grass patches are procedural foliage-brush strokes, not authored
          // objects, keep them out of the Scene Collection so it stays readable.
          .filter((row) => this.map.placements[row.index].assetId !== GRASS_PATCH_ASSET_ID),
      selectSceneObject: (index) => {
        if (!this.map.placements[index]) return;
        this.setSelectedPlacement(index);
        this.inspector.refresh();
      },
      pinSceneObject: (index) => {
        const p = this.map.placements[index];
        if (!p) return;
        this.setSelectedPlacement(index);
        if (this.viewport3d) {
          const volume = colliderKindFor(p.assetId)
            ? colliderVolumeFromPlacement({ ...p, collide: true })
            : null;
          const extent = volume
            ? Math.max(volume.sizeX, volume.sizeY, volume.sizeZ) / 2
            : Math.max(1.5, p.scale * 2);
          const targetY =
            (p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, this.map.meta.seed)) +
            (p.y ?? 0);
          this.viewport3d.focusClose(p.x, p.z, extent, targetY);
        }
        this.inspector.refresh();
      },
      renameSceneObject: (index, name) => {
        const p = this.map.placements[index];
        if (!p) return;
        const trimmed = name.trim();
        if (trimmed) p.name = trimmed.slice(0, MAX_PLACEMENT_NAME_LENGTH);
        else delete p.name;
        this.map.meta.updatedAt = now();
        this.markDirty();
        this.inspector.refresh();
      },
      toggleSceneObjectHidden: (index) => {
        const p = this.map.placements[index];
        if (!p) return;
        if (p.hidden) delete p.hidden;
        else p.hidden = true;
        // Re-feed the render (hideHidden nulls the slot) + repaint the 2D overlay.
        this.viewport3d?.rebuildPlacements();
        this.map.meta.updatedAt = now();
        this.markDirty();
        this.inspector.refresh();
      },
      getCollidersHidden: () => this.collidersHiddenOn,
      setCollidersHidden: (on) => {
        this.collidersHiddenOn = on;
        this.viewport3d?.setCollidersHidden(on);
        writePref(HIDE_COLLIDERS_PREF_KEY, on);
      },
      getLocationsHidden: () => this.locationsHiddenOn,
      setLocationsHidden: (on) => {
        this.locationsHiddenOn = on;
        this.viewport3d?.setLocationsHidden(on);
        writePref(HIDE_LOCATIONS_PREF_KEY, on);
      },
      getCameraSpeeds: () => ({ ...this.cameraSpeeds }),
      setCameraSpeeds: (change) => {
        Object.assign(this.cameraSpeeds, change);
        this.viewport3d?.setCameraSpeeds(this.cameraSpeeds);
        writeJsonPref(CAMERA_SPEEDS_PREF_KEY, this.cameraSpeeds);
      },
      getPerfOverlay: () => ({ ...this.perfOverlay }),
      setPerfOverlay: (change) => {
        Object.assign(this.perfOverlay, change);
        this.viewport3d?.setPerfOverlay(this.perfOverlay);
        writeJsonPref(PERF_OVERLAY_PREF_KEY, this.perfOverlay);
      },
      focusSelection: () => this.focusSelection(),
      getWeather: () => this.resolvedWeather(),
      setWeather: (w) => this.setMapWeather(w),
      getMusic: () => ({
        zoneTrack: this.map.music?.zoneTrack ?? null,
        areas: this.map.music?.areas ?? [],
        areaTrack: this.musicAreaTrack,
      }),
      getSelectedMusicArea: () => this.selectedMusicArea,
      setSelectedMusicArea: (index) => this.setSelectedMusicArea(index),
      setZoneTrack: (track) => {
        if (!this.map.music) this.map.music = {};
        if (track) this.map.music.zoneTrack = track;
        else delete this.map.music.zoneTrack;
        this.musicChanged();
      },
      setAreaTrack: (track) => {
        this.musicAreaTrack = track;
      },
      updateMusicArea: (index, track) => {
        const a = this.map.music?.areas?.[index];
        if (!a) return;
        a.track = track;
        this.musicChanged();
      },
      deleteMusicArea: (index) => this.deleteMusicArea(index),
      getLighting: () => ({
        preset: this.lightingPreset,
        profile: this.effectiveLighting(),
      }),
      setLightingPreset: (key) => this.setLightingPreset(key),
      updateLighting: (change) => this.updateLighting(change),
      getBirds: () => ({ ...this.birds }),
      setBirds: (change) => {
        Object.assign(this.birds, change);
        this.applyBirds();
        writeJsonPref(BIRDS_PREF_KEY, this.birds);
      },
      getWorldSpeed: () => this.map.timeScale ?? 1,
      setWorldSpeed: (v) => this.setWorldSpeed(v),
      getAssetViewDistance: () => this.map.assetViewDistance ?? DEFAULT_ASSET_VIEW_DISTANCE,
      setAssetViewDistance: (v) => this.setAssetViewDistance(v),
      getSkybox: () => this.map.skybox ?? null,
      setSkybox: (v) => {
        if (v === null) delete this.map.skybox;
        else this.map.skybox = v;
        this.markDirty();
        this.applySkybox();
      },
      importSkybox: () => this.importSkybox(),
      getFootprints: () => this.footprintsOn,
      setFootprints: (on) => {
        this.footprintsOn = on;
        writePref(FOOTPRINTS_PREF_KEY, on);
        this.syncFootprintOverlay();
      },
      // ---- collision hitbox editing + presets --------------------------------
      getHitboxEdit: () => {
        const he = this.hitboxEdit;
        if (!he) return null;
        const p = this.map.placements[he.index];
        return {
          count: p?.hitboxes?.length ?? 0,
          selectedCount: he.selected.size,
        };
      },
      enterHitboxEdit: () => this.enterHitboxEdit(),
      exitHitboxEdit: () => this.exitHitboxEdit(),
      addHitbox: () => this.addHitbox(),
      deleteSelectedHitboxes: () => this.deleteSelectedHitboxes(),
      resetHitboxes: () => this.resetHitboxes(),
      saveHitboxPreset: () => this.saveHitboxPreset(),
      clearHitboxPreset: () => this.clearHitboxPreset(),
      copyCollisionToSameAsset: () => void this.copyCollisionToSameAsset(),
      getCloneScaleRange: () => ({
        min: this.cloneScaleMin,
        max: this.cloneScaleMax,
      }),
      setCloneScaleRange: (change) => {
        if (change.min !== undefined) {
          this.cloneScaleMin = Math.min(
            PLACEMENT_SCALE_MAX,
            Math.max(PLACEMENT_SCALE_MIN, change.min),
          );
        }
        if (change.max !== undefined) {
          this.cloneScaleMax = Math.min(
            PLACEMENT_SCALE_MAX,
            Math.max(PLACEMENT_SCALE_MIN, change.max),
          );
        }
      },
      scaleAllSameAsset: () => void this.scaleAllSameAsset(),
      getMarkerSelection: () => {
        const e = this.entities.find((x) => x.key === this.selectedKey);
        return e ? { label: e.label, x: e.point.x, z: e.point.z } : null;
      },
      updateMarker: (axis, v) => {
        const e = this.entities.find((x) => x.key === this.selectedKey);
        if (e && e.point[axis] !== v) {
          const prev = { x: e.point.x, z: e.point.z };
          e.point[axis] = v;
          this.markerMovedWhile2d = true;
          this.pushMarkerUndo(e.key, prev, { x: e.point.x, z: e.point.z });
        }
      },
      resetMarker: () => {
        const e = this.entities.find((x) => x.key === this.selectedKey);
        const o = e ? this.base.get(e.key) : undefined;
        if (e && o && (e.point.x !== o.x || e.point.z !== o.z)) {
          const prev = { x: e.point.x, z: e.point.z };
          e.point.x = o.x;
          e.point.z = o.z;
          this.markerMovedWhile2d = true;
          this.pushMarkerUndo(e.key, prev, { x: o.x, z: o.z });
        }
      },
      getScatterCount: () => this.scatterCount,
      setScatterCount: (v) => {
        this.scatterCount = v;
      },
      runScatter: () => this.runScatter(),
      runHills: () => this.runHills(),
      layers: () => [
        ...KINDS.map((kind) => ({
          kind: kind as string,
          label: t(LAYER_KEYS[kind] as Parameters<typeof t>[0]),
          visible: this.visible.has(kind),
        })),
        // Blocker walls are a document layer, not a marker entity kind.
        {
          kind: 'blocker',
          label: t('editor.layers.blocker'),
          visible: this.blockersVisible2d,
        },
      ],
      toggleLayer: (kind, on) => {
        if (kind === 'blocker') this.blockersVisible2d = on;
        else if (on) this.visible.add(kind as EntityKind);
        else this.visible.delete(kind as EntityKind);
        this.canvasDirty = true;
      },
      frameAll: () => this.frameAll(),
      zones: () => this.map.content.zones.map((z) => ({ id: z.id, name: z.name })),
      frameZone: (id) => this.frameZone(id),
    };
  }

  // ---- 2D view ----------------------------------------------------------------------

  /**
   * Undo entry for a marker move (2D drag, coord field, or reset). Both sides
   * re-resolve the entity by key (entities can be rebuilt) and mutate the LIVE
   * point reference into the zone content, then flag the 3D re-mesh.
   */
  private pushMarkerUndo(key: string, prev: Vec2, next: Vec2): void {
    const apply = (v: Vec2): void => {
      const e = this.entities.find((x) => x.key === key);
      if (!e) return;
      const from = { x: e.point.x, z: e.point.z };
      e.point.x = v.x;
      e.point.z = v.z;
      if (isMovableEntity(e)) this.viewport3d?.moveMapEntity(e.key, from, v);
      this.markerMovedWhile2d = true;
      this.canvasDirty = true;
    };
    this.pushUndo({
      label: 'move-marker',
      undo: () => apply(prev),
      redo: () => apply(next),
    });
  }

  private vp(): Viewport {
    return { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
  }

  private visibleEntities(): EditorEntity[] {
    return this.entities.filter((e) => this.visible.has(e.kind));
  }

  private pickEntity(s: ScreenPoint): EditorEntity | null {
    const list = this.visibleEntities();
    const handles = list.map((e) => ({
      id: e.key,
      x: e.point.x,
      z: e.point.z,
      radius: e.radius,
    }));
    const hit = pickHandle(handles, s, this.cam, this.vp());
    return hit ? (list.find((e) => e.key === hit.id) ?? null) : null;
  }

  private resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.canvasDirty = true;
  };

  private tick2d = (): void => {
    if (this.canvasDirty && this.viewMode === '2d') {
      draw(this.ctx, this.cam, this.vp(), {
        entities: this.visibleEntities(),
        roads: this.map.content.roads ?? [],
        selectedKey: this.selectedKey,
        hoverKey: this.hoverKey,
        terrainEdits: this.map.terrainEdits,
        caves: this.map.caves ?? [],
        holes: this.map.holes ?? [],
        holePatches: this.map.holePatches ?? [],
        placements: this.map.placements,
        biomePaint: this.map.biomePaint ?? null,
        blockers: this.blockersVisible2d ? (this.map.blockers ?? []) : [],
        blockerPreview: this.blockerPreview,
        region: this.tool === 'region' ? this.regionBox : null,
        spawn: this.map.playerStart ?? null,
        spawnArea: this.spawnAreaPreview ?? this.map.playerSpawnArea ?? null,
        brush:
          this.isDragTool() && this.cursorWorld
            ? {
                x: this.cursorWorld.x,
                z: this.cursorWorld.z,
                radius: this.brushRadius,
                raise: this.tool !== 'lower',
              }
            : null,
      });
      this.canvasDirty = false;
    }
    requestAnimationFrame(this.tick2d);
  };

  private pointerAt(ev: { clientX: number; clientY: number }): ScreenPoint {
    const r = this.canvas.getBoundingClientRect();
    return { sx: ev.clientX - r.left, sy: ev.clientY - r.top };
  }

  private attach2dEvents(stage: HTMLElement): void {
    window.addEventListener('resize', this.resize);

    stage.addEventListener('pointerdown', (ev) => {
      const s = this.pointerAt(ev);
      this.lastPointer = s;
      const w = this.cam.screenToWorld(s, this.vp());
      if (ev.button !== 0) {
        this.panning = true;
        stage.setPointerCapture(ev.pointerId);
        return;
      }
      if (this.tool === 'region') {
        this.selectingRegion = true;
        this.editStart(w);
        stage.setPointerCapture(ev.pointerId);
        return;
      }
      if (this.tool === 'blocker') {
        this.drawingBlocker2d = true;
        this.editStart(w);
        stage.setPointerCapture(ev.pointerId);
        return;
      }
      if (this.isDragTool()) {
        this.painting2d = true;
        this.paint2dDragPx = 0;
        this.editStart(w);
        stage.setPointerCapture(ev.pointerId);
        return;
      }
      if (this.tool === 'place' || this.tool === 'camp' || this.tool === 'spawn') {
        this.editStart(w);
        this.canvasDirty = true;
        return;
      }
      // Select: markers first, then placements.
      const hit = this.pickEntity(s);
      if (hit) {
        this.dragKey = hit.key;
        // Drag-start position, so release can push a single undo entry.
        this.markerDragStart = { key: hit.key, x: hit.point.x, z: hit.point.z };
        this.selectedKey = hit.key;
        this.setSelectedPlacement(null);
        this.grab = { x: w.x - hit.point.x, z: w.z - hit.point.z };
        this.inspector.refresh();
      } else {
        const pi = erasePlacementIndex(this.map.placements, w.x, w.z, 2);
        if (pi >= 0) {
          this.selectedKey = null;
          this.setSelectedPlacement(pi);
          this.inspector.refresh();
        } else {
          this.panning = true;
          if (this.selectedKey || this.selectedPlacement !== null) {
            this.selectedKey = null;
            this.setSelectedPlacement(null);
            this.inspector.refresh();
          }
        }
      }
      stage.setPointerCapture(ev.pointerId);
      this.canvasDirty = true;
    });

    stage.addEventListener('pointermove', (ev) => {
      const s = this.pointerAt(ev);
      const dx = s.sx - this.lastPointer.sx;
      const dy = s.sy - this.lastPointer.sy;
      this.lastPointer = s;
      this.cursorWorld = this.cam.screenToWorld(s, this.vp());
      if (this.selectingRegion || this.drawingBlocker2d) {
        this.editMove(this.cursorWorld);
      } else if (this.painting2d) {
        // Queued moves arriving after the physical release must not stroke on
        // (same trailing-event gate as the 3D viewport). Click jitter must not
        // either: the world-space spacing gate is no protection zoomed out, so
        // require a real drag before moves may stroke (the press already did).
        this.paint2dDragPx += Math.abs(dx) + Math.abs(dy);
        if (ev.buttons !== 0 && this.paint2dDragPx > 5) this.editMove(this.cursorWorld);
      } else if (this.dragKey) {
        const e = this.entities.find((x) => x.key === this.dragKey);
        if (e) {
          e.point.x = this.cursorWorld.x - this.grab.x;
          e.point.z = this.cursorWorld.z - this.grab.z;
          this.markerMovedWhile2d = true;
          this.canvasDirty = true;
        }
      } else if (this.panning) {
        this.cam.panByPixels(dx, dy);
        this.canvasDirty = true;
      } else if (this.tool !== 'select') {
        this.canvasDirty = true; // refresh the brush cursor preview
      } else {
        const hit = this.pickEntity(s);
        const key = hit ? hit.key : null;
        if (key !== this.hoverKey) {
          this.hoverKey = key;
          stage.style.cursor = key ? 'grab' : 'default';
          this.canvasDirty = true;
        }
      }
    });

    const end = (ev: PointerEvent): void => {
      this.panning = false;
      if (this.dragKey) {
        const key = this.dragKey;
        const start = this.markerDragStart;
        this.dragKey = null;
        this.markerDragStart = null;
        const e = this.entities.find((x) => x.key === key);
        if (e && start && start.key === key && (e.point.x !== start.x || e.point.z !== start.z)) {
          this.pushMarkerUndo(key, { x: start.x, z: start.z }, { x: e.point.x, z: e.point.z });
          this.inspector.refresh();
        }
      }
      if (this.selectingRegion) {
        this.selectingRegion = false;
        this.editEnd();
      }
      if (this.drawingBlocker2d) {
        this.drawingBlocker2d = false;
        this.editEnd();
      }
      if (this.painting2d) {
        this.painting2d = false;
        this.editEnd();
        this.map.meta.updatedAt = now();
      }
      try {
        stage.releasePointerCapture(ev.pointerId);
      } catch {
        // pointer capture may already be gone; ignore.
      }
      this.canvasDirty = true;
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    // Non-left buttons pan the 2D view; keep the browser menu off the stage
    // (the 3D canvas already suppresses it).
    stage.addEventListener('contextmenu', (ev) => ev.preventDefault());

    stage.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const factor = Math.exp(-ev.deltaY * 0.0015);
        this.cam.zoomAt(this.pointerAt(ev), factor, this.vp());
        this.canvasDirty = true;
      },
      { passive: false },
    );
  }

  private frameAll(): void {
    const pts = this.entities.map((e) => e.point);
    if (pts.length === 0) return;
    const min = {
      x: Math.min(...pts.map((p) => p.x)),
      z: Math.min(...pts.map((p) => p.z)),
    };
    const max = {
      x: Math.max(...pts.map((p) => p.x)),
      z: Math.max(...pts.map((p) => p.z)),
    };
    this.cam.frame(min, max, this.vp());
    this.canvasDirty = true;
  }

  private frameZone(zoneId: string): void {
    const own = this.entities.filter((e) => e.zoneId === zoneId);
    const zone = this.map.content.zones.find((z) => z.id === zoneId);
    if (!zone || own.length === 0) return;
    const xs = own.map((e) => e.point.x);
    const min = { x: Math.min(...xs), z: zone.zMin };
    const max = { x: Math.max(...xs), z: zone.zMax };
    this.cam.frame(min, max, this.vp());
    this.canvasDirty = true;
  }
}

// Editor UI helpers (not sim code): wall-clock + ids are fine here.
function now(): number {
  return Date.now();
}
function mintId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `map-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

// Imported ground textures are stored compressed: downscaled to fit 1024
// (the splat atlas samples 512 per slot, so 1024 keeps headroom) and
// re-encoded as WebP q0.9 (visually lossless at these sizes; the base game's
// terrain sources are 1K jpg). Falls back to JPEG q0.92 where the browser
// cannot encode WebP (Safari), except for PNGs that actually use alpha; and
// keeps the ORIGINAL bytes whenever the re-encode is not smaller.
async function compressGroundTextureImport(
  img: HTMLImageElement,
  file: File,
): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const original = async (): Promise<{ bytes: ArrayBuffer; mime: string }> => ({
    bytes: await file.arrayBuffer(),
    mime: file.type || 'image/png',
  });
  const scale = Math.min(1, 1024 / Math.max(1, img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return original();
  ctx.drawImage(img, 0, 0, w, h);
  const encode = (type: string, quality: number): Promise<Blob | null> =>
    new Promise((res) => c.toBlob(res, type, quality));
  let blob = await encode('image/webp', 0.9);
  if (blob?.type !== 'image/webp') {
    // No WebP encoder: JPEG drops alpha, so a PNG that uses transparency
    // keeps its original bytes instead.
    const isPng = (file.type || '').includes('png') || /\.png$/i.test(file.name);
    let hasAlpha = false;
    if (isPng) {
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] < 255) {
          hasAlpha = true;
          break;
        }
      }
    }
    blob = hasAlpha ? null : await encode('image/jpeg', 0.92);
    if (blob && blob.type !== 'image/jpeg') blob = null;
  }
  if (!blob || blob.size >= file.size) return original();
  return { bytes: await blob.arrayBuffer(), mime: blob.type };
}
