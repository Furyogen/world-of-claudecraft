// The right-hand context inspector: per-tool option panels (brush, biome
// palette, water level, placement options, camp editor, spawn point, region
// clipboard, erase help), the Select-mode placement/marker editors, the
// procedural generators, and the 2D layer/frame controls. Owns no state: it
// reads and writes through the injected deps and re-renders on refresh().

import { MUSIC_ZONES } from '../game/music';
import { assetUrl } from '../render/assets/media';
import { BUILTIN_SKYBOXES } from '../render/assets/skyboxes';
import type { EditorLightingProfile } from '../render/editor_lighting';
import { DEFAULT_TEXTURE_TILE_YD } from '../render/terrain';
import {
  builtinShaFor,
  paintDefaultSets,
  TERRAIN_TEXTURE_SETS,
} from '../render/terrain_texture_sets';
import { COLLIDER_DEFAULT_SIZE, type ColliderVolumeKind } from '../sim/collider_volumes';
import { FLUID_PRESETS, type FluidKind } from '../sim/fluid_volumes';
import {
  type CollisionMode,
  collideRadiusFor,
  MAX_COLLIDE_RADIUS,
  MAX_WATER_LEVEL,
  MIN_COLLIDE_RADIUS,
  MIN_WATER_LEVEL,
  ROCK_ASSET_ID,
} from '../sim/map_doc';
import type { CustomPaintSwatch } from '../sim/types';
import { formatNumber, t } from '../ui/i18n';
import { brushAlphaThumb, listBrushAlphas, removeBrushAlpha } from './brush_alphas';
import { button, checkbox, el, iconButton, selectRow, slider } from './dom';
import { PLACEMENT_SCALE_MAX, PLACEMENT_SCALE_MIN } from './placement_transform_core';
import { POINT_SOUND_CLIPS, pointSoundLabel } from './point_sounds';
import { adjustedSwatchColor } from './swatch_color';
import type { EditorTool } from './toolbar';

// Scene Collection row glyphs (24x24 stroke paths, Feather-style) painted via
// iconButton so the panel carries no emoji.
const ICON_EYE =
  'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z';
const ICON_EYE_OFF =
  'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.06 6.06A18.45 18.45 0 0 0 2 12s3 8 10 8a10.07 10.07 0 0 0 5.94-1.94M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20';
const ICON_PIN =
  'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';

export interface CampSelection {
  index: number;
  mobId: string;
  count: number;
  radius: number;
}

export interface PlacementSelection {
  index: number;
  assetId: string;
  assetLabel: string;
  x: number;
  /** Vertical offset above the terrain seat (yards), null = seated (0). */
  y: number | null;
  z: number;
  rotY: number;
  scale: number;
  collide: boolean;
  /** Authored collision-radius override (yards), or null = derived from scale. */
  collideRadius: number | null;
  /** Footprint shape: null = circle (default), 'square' = yaw-following box. */
  collideShape: 'square' | null;
  /** The effective collision type (the dropdown's value). */
  collisionMode: CollisionMode;
  /** Boxes the baked mode would block with (edited count when edited). */
  hitboxCount: number;
  /** The placement carries hand-edited hitboxes. */
  hasHitboxEdits: boolean;
  /** A hitbox preset for this asset exists on this device. */
  hasHitboxPreset: boolean;
  /** How many OTHER placements on the map share this asset id (0 = unique). */
  sameAssetCount: number;
  /** "True collision" fine-bake state for this asset. */
  meshBakeReady: boolean;
  meshBakePending: boolean;
  /** Non-null when the selection is a collider volume placement. */
  colliderKind: ColliderVolumeKind | null;
  /** Shader tweaks (null = not overridden). */
  tint: number | null;
  opacity: number | null;
  glow: number | null;
  glowStrength: number | null;
  /** Animated fire effect at the model's top. */
  fire: boolean;
  /** Authored collider dimensions (yards at scale 1), null = kind default. */
  sizeX: number | null;
  sizeY: number | null;
  sizeZ: number | null;
  /** Non-null when the selection is a fluid pool placement. */
  fluidKind: FluidKind | null;
  /** Fluid tint overrides (null = the kind preset). */
  hue: number | null;
  lum: number | null;
  fluidDps: number | null;
  fluidFx: number | null;
  /** Generated-rock shape params (null = defaults / not a generated rock). */
  rockSeed: number | null;
  rockNoise: number | null;
  rockDetail: number | null;
  rockSharp: number | null;
  rockTex: number | null;
  rockHeight: number | null;
  rockDepth: number | null;
  rockJag: number | null;
  rockTexId: string | null;
  rockTexTile: number | null;
}

export interface MarkerSelection {
  label: string;
  x: number;
  z: number;
}

/** Map weather with every field resolved (defaults filled), for the panel. */
export interface ResolvedWeather {
  mode: 'auto' | 'clear' | 'rain' | 'snow' | 'sparkle';
  intensity: number;
  clouds: { coverage: number; height: number };
  schedule: { mode: 'clear' | 'rain' | 'snow' | 'sparkle'; minutes: number }[];
}

export interface InspectorDeps {
  getTool(): EditorTool;
  getViewMode(): '3d' | '2d';

  getBrushRadius(): number;
  setBrushRadius(v: number): void;
  getBrushStrength(): number;
  setBrushStrength(v: number): void;
  getTerrainEditStats(): { count: number; max: number };

  getPaintBiome(): number;
  setPaintBiome(id: number): void;
  getPaintHardness(): number;
  setPaintHardness(v: number): void;
  /** Selected brush alpha id (null = plain round brush). */
  getPaintAlpha(): string | null;
  setPaintAlpha(id: string | null): void;
  importPaintAlpha(): void;
  /** Bucket fill: armed = the next terrain click replaces the clicked texture
   *  map-wide with the selected swatch. */
  getBucketArmed(): boolean;
  setBucketArmed(on: boolean): void;

  getLocations(): readonly {
    name: string;
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
  }[];
  renameLocation(index: number, name: string): void;
  deleteLocation(index: number): void;
  getMapLights(): readonly {
    x: number;
    z: number;
    y: number;
    color: number;
    intensity: number;
    range: number;
  }[];
  /** Selected map light (viewport bulb click or panel row click), or null. */
  getSelectedLight(): number | null;
  setSelectedLight(index: number | null): void;
  updateMapLight(
    index: number,
    change: Partial<{ y: number; color: number; intensity: number; range: number }>,
  ): void;
  deleteMapLight(index: number): void;
  getMapSounds(): readonly {
    x: number;
    z: number;
    y: number;
    sound: string;
    volume: number;
    radius: number;
  }[];
  /** Selected map point sound (viewport badge click or panel row click), null. */
  getSelectedSound(): number | null;
  setSelectedSound(index: number | null): void;
  updateMapSound(
    index: number,
    change: Partial<{ y: number; sound: string; volume: number; radius: number }>,
  ): void;
  deleteMapSound(index: number): void;
  getMarkers(): readonly { name: string; kind: 'npc' | 'object'; x: number; z: number }[];
  getMarkerMode(): { placing: boolean; kind: 'npc' | 'object' };
  setMarkerMode(change: Partial<{ placing: boolean; kind: 'npc' | 'object' }>): void;
  renameMarker(index: number, name: string): void;
  deleteMarker(index: number): void;
  getCustomSwatches(): readonly CustomPaintSwatch[];
  /** Auto-texturing rules for this map (resolved: absent flags read true). */
  getTerrainStyle(): {
    slopeRock: boolean;
    snowCaps: boolean;
    rimMountains: boolean;
    shoreSand: boolean;
  };
  setTerrainStyle(
    change: Partial<{
      slopeRock: boolean;
      snowCaps: boolean;
      rimMountains: boolean;
      shoreSand: boolean;
    }>,
  ): void;
  /** Hue/light adjust of the active paint texture (built-in biomes get or
   *  reuse a custom variant swatch; custom swatches edit their own fields). */
  setPaintAdjust(change: { hueShift?: number; light?: number }): void;
  saveAdjustedSwatch(): void;
  importTextureSwatch(): void;
  /** Pick a built-in library texture set (materializes a swatch on first use). */
  pickBuiltinTexture(key: string): void;
  /** Object URL of an imported ground texture (for swatch thumbnails), or
   *  null while it has not resolved from IndexedDB yet. */
  swatchTextureUrl(sha: string): string | null;
  setSwatchTileSize(id: number, tileSize: number): void;
  clearBiomePaint(): void;

  getFoliage(): {
    density: number;
    minScale: number;
    maxScale: number;
    collide: boolean;
    grass: boolean;
    grassHue: number;
    grassLight: number;
    grassClump: number;
    ferns: boolean;
    bushes: boolean;
    trees: boolean;
    rocks: boolean;
  };
  setFoliage(
    change: Partial<{
      density: number;
      minScale: number;
      maxScale: number;
      collide: boolean;
      grass: boolean;
      grassHue: number;
      grassLight: number;
      grassClump: number;
      ferns: boolean;
      bushes: boolean;
      trees: boolean;
      rocks: boolean;
    }>,
  ): void;
  /** Custom foliage-brush asset (scatter a chosen asset instead of the built-in
   *  groups), or null for the built-in behaviour. */
  getFoliageCustom(): { assetId: string; label: string } | null;
  pickFoliageCustom(): void;
  clearFoliageCustom(): void;

  getSculptLower(): boolean;
  setSculptLower(on: boolean): void;
  /** Grab (snake hook) mode for the Sculpt tool: press grabs the ground and
   *  the drag pulls it up/down with the cursor. */
  getSculptGrab(): boolean;
  setSculptGrab(on: boolean): void;
  /** Slope-based auto texture for the sculpt tools: band ids are paint ids
   *  (biome / custom swatch), -1 = leave that band's paint untouched. */
  getAutoTexture(): { enabled: boolean; angle: number; flatId: number; steepId: number };
  setAutoTexture(
    change: Partial<{ enabled: boolean; angle: number; flatId: number; steepId: number }>,
  ): void;
  getFlattenSmooth(): boolean;
  setFlattenSmooth(on: boolean): void;
  getFlattenHardEdge(): boolean;
  setFlattenHardEdge(on: boolean): void;

  getWaterLevel(): number;
  previewWaterLevel(v: number): void;
  commitWaterLevel(v: number): void;
  resetWaterLevel(): void;
  getWaterTint(): { hue: number | null; lum: number | null };
  previewWaterTint(hue: number | null, lum: number | null): void;
  commitWaterTint(hue: number | null, lum: number | null): void;
  resetWaterTint(): void;
  getFluidKind(): FluidKind;
  setFluidKind(kind: FluidKind): void;
  getRockParams(): {
    size: number;
    noise: number;
    detail: number;
    sharp: number;
    tex: number;
    walkable: boolean;
    height: number;
    depth: number;
    jag: number;
    texId: string;
    texTile: number;
  };
  setRockParams(change: {
    size?: number;
    noise?: number;
    detail?: number;
    sharp?: number;
    tex?: number;
    walkable?: boolean;
    height?: number;
    depth?: number;
    jag?: number;
    texId?: string;
    texTile?: number;
  }): void;
  getRockChainState(): { mode: boolean; count: number };
  setRockChainMode(on: boolean): void;
  generateRockChain(): void;
  clearRockChain(): void;
  getTunnelMode(): 'dig' | 'hole' | 'patch';
  setTunnelMode(mode: 'dig' | 'hole' | 'patch'): void;
  getCaves(): {
    index: number;
    nodes: number;
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
  }[];
  getHoles(): { index: number; radius: number }[];
  getHolePatches(): { index: number; radius: number }[];
  getCavePairState(): { pendingExit: boolean; readyToGenerate: number };
  generateCaves(): void;
  updateCave(
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
  ): void;
  reverseCave(index: number): void;
  deleteCave(index: number): void;
  /** Multi-select every rig node of a cave and arm the Move tool, so the
   *  group gizmo translates the whole tube rigidly into place. */
  selectWholeCave(index: number): void;
  updateHole(index: number, change: { radius?: number }, commit: boolean): void;
  deleteHole(index: number): void;
  updateHolePatch(index: number, change: { radius?: number }, commit: boolean): void;
  deleteHolePatch(index: number): void;
  /** Arm the Place tool with the procedural waterfall asset. */
  placeWaterfall(): void;

  getPlaceScale(): number;
  setPlaceScale(v: number): void;
  getPlaceCollide(): boolean;
  setPlaceCollide(on: boolean): void;
  getPlaceRandomRot(): boolean;
  setPlaceRandomRot(on: boolean): void;
  getPlaceAssetLabel(): string | null;

  mobOptions(): { id: string; label: string }[];
  getSelectedCamp(): CampSelection | null;
  updateCamp(change: { mobId?: string; count?: number; radius?: number }): void;
  deleteCamp(): void;

  getSpawn(): { x: number; z: number } | null;
  clearSpawn(): void;

  copyRegion(): void;
  pasteBeside(): void;

  getBlockerStats(): { count: number; max: number };

  getColliderShape(): ColliderVolumeKind;
  setColliderShape(kind: ColliderVolumeKind): void;

  getSelection(): PlacementSelection | null;
  /** Live update (slider drag); commit=false does not push an undo entry.
   *  collideRadius: number sets the override, null clears it (back to auto). */
  updateSelection(
    change: {
      x?: number;
      y?: number;
      z?: number;
      rotY?: number;
      scale?: number;
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
  ): void;
  duplicateSelection(): void;
  deleteSelection(): void;
  /** Multi-selection size (1 = just the active placement). */
  getSelectionCount(): number;
  /** Baked collision box count for an asset id (0 = legacy circle only). */
  getBakedCollisionCount(assetId: string): number;
  getFootprints(): boolean;
  setFootprints(on: boolean): void;
  /** Hitbox edit mode (baked boxes as movable objects): null = not editing. */
  getHitboxEdit(): { count: number; selectedCount: number } | null;
  enterHitboxEdit(): void;
  exitHitboxEdit(): void;
  addHitbox(): void;
  deleteSelectedHitboxes(): void;
  resetHitboxes(): void;
  /** Per-asset hitbox presets (this device): copy on future placements. */
  saveHitboxPreset(): void;
  clearHitboxPreset(): void;
  /** Copy the active placement's whole collision setup (type, radius, shape,
   *  hitbox edits) onto every other placement of the same asset on the map,
   *  after an in-app confirm. */
  copyCollisionToSameAsset(): void;
  /** "Scale all copies" range: roll a random scale in [min, max] onto every
   *  placement of the selected asset (after an in-app confirm). */
  getCloneScaleRange(): { min: number; max: number };
  setCloneScaleRange(change: { min?: number; max?: number }): void;
  scaleAllSameAsset(): void;

  getFreeFly(): boolean;
  setFreeFly(on: boolean): void;
  getInvertPan(): boolean;
  setInvertPan(on: boolean): void;
  getShowPlayer(): boolean;
  setShowPlayer(on: boolean): void;
  getShowBoundaryWalls(): boolean;
  setShowBoundaryWalls(on: boolean): void;
  /** Wireframe render mode (map geometry as raw polygons, no textures). */
  getWireframe(): boolean;
  setWireframe(on: boolean): void;
  /** Scene Collection: every placed object with its display name + state. */
  getSceneObjects(): { index: number; name: string; hidden: boolean; selected: boolean }[];
  selectSceneObject(index: number): void;
  pinSceneObject(index: number): void;
  renameSceneObject(index: number, name: string): void;
  toggleSceneObjectHidden(index: number): void;
  getCollidersHidden(): boolean;
  setCollidersHidden(on: boolean): void;
  /** Hide the blue named-location area boxes (Zone tool toggle). */
  getLocationsHidden(): boolean;
  setLocationsHidden(on: boolean): void;
  /** Editor camera speed multipliers (Camera tab sliders); 1 = shipped feel. */
  getCameraSpeeds(): { move: number; look: number; pan: number };
  setCameraSpeeds(change: Partial<{ move: number; look: number; pan: number }>): void;
  /** Viewport performance overlay config (Camera tab). */
  getPerfOverlay(): {
    enabled: boolean;
    fps: boolean;
    frameMs: boolean;
    assets: boolean;
    terrain: boolean;
  };
  setPerfOverlay(
    change: Partial<{
      enabled: boolean;
      fps: boolean;
      frameMs: boolean;
      assets: boolean;
      terrain: boolean;
    }>,
  ): void;
  focusSelection(): void;

  getLighting(): { preset: string; profile: EditorLightingProfile };
  setLightingPreset(key: string): void;
  updateLighting(change: Partial<EditorLightingProfile>): void;
  /** Map weather, resolved with defaults (mode auto, intensity 1, no clouds). */
  getWeather(): ResolvedWeather;
  setWeather(w: ResolvedWeather): void;

  /** Authored soundtrack: map-wide track, area rects, next-area pick. */
  getMusic(): {
    zoneTrack: string | null;
    areas: readonly { minX: number; minZ: number; maxX: number; maxZ: number; track: string }[];
    areaTrack: string;
  };
  setZoneTrack(track: string | null): void;
  setAreaTrack(track: string): void;
  updateMusicArea(index: number, track: string): void;
  deleteMusicArea(index: number): void;
  /** Selected music area (in-world rect click or panel row click), or null. */
  getSelectedMusicArea(): number | null;
  setSelectedMusicArea(index: number | null): void;
  getBirds(): { enabled: boolean; count: number; formation: boolean };
  setBirds(change: Partial<{ enabled: boolean; count: number; formation: boolean }>): void;
  /** Ambience animation speed (cosmetic world motion); 1 = normal. */
  getWorldSpeed(): number;
  setWorldSpeed(v: number): void;
  /** Placed-asset view distance in yards (how far decor renders before it culls). */
  getAssetViewDistance(): number;
  setAssetViewDistance(v: number): void;
  /** Active skybox: 'builtin:<id>' | 'custom:<sha>' | null (procedural sky). */
  getSkybox(): string | null;
  setSkybox(v: string | null): void;
  importSkybox(): void;

  getMarkerSelection(): MarkerSelection | null;
  updateMarker(axis: 'x' | 'z', v: number): void;
  resetMarker(): void;

  getScatterCount(): number;
  setScatterCount(v: number): void;
  runScatter(): void;
  runHills(): void;

  layers(): { kind: string; label: string; visible: boolean }[];
  toggleLayer(kind: string, on: boolean): void;
  frameAll(): void;
  zones(): { id: string; name: string }[];
  frameZone(id: string): void;
}

export const BIOME_OPTIONS: { id: number; labelKey: string; swatch: string }[] = [
  { id: 0, labelKey: 'editor.biome.vale', swatch: '#5aa850' },
  { id: 1, labelKey: 'editor.biome.marsh', swatch: '#786037' },
  { id: 2, labelKey: 'editor.biome.peaks', swatch: '#969ba5' },
  { id: 3, labelKey: 'editor.biome.beach', swatch: '#d8c27a' },
  { id: 4, labelKey: 'editor.biome.desert', swatch: '#cf9040' },
  { id: 5, labelKey: 'editor.biome.volcano', swatch: '#b04030' },
  { id: 6, labelKey: 'editor.biome.cave', swatch: '#4a4a55' },
  { id: 255, labelKey: 'editor.biome.erase', swatch: 'transparent' },
];

// Texture-picker thumbnails: the REAL ground texture each biome paints with
// (the splat shader's dominant layer), tinted toward the biome palette so the
// row previews what actually lands on the ground.
const BIOME_THUMBS: Record<number, { file: string; tint?: string }> = {
  0: { file: 'Grass001_Color.jpg', tint: 'rgba(90, 168, 80, 0.35)' },
  1: { file: 'Ground071_Color.jpg', tint: 'rgba(120, 96, 55, 0.3)' },
  2: { file: 'Rock051_Color.jpg', tint: 'rgba(150, 155, 165, 0.25)' },
  3: { file: 'Ground080_Color.jpg', tint: 'rgba(216, 194, 122, 0.3)' },
  4: { file: 'Ground080_Color.jpg', tint: 'rgba(207, 144, 64, 0.45)' },
  5: { file: 'Rock051_Color.jpg', tint: 'rgba(176, 64, 48, 0.45)' },
  6: { file: 'Rock051_Color.jpg', tint: 'rgba(74, 74, 85, 0.5)' },
};

function hexWithAlpha(hex: string, alpha: number): string {
  const v = Number.parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function num1(v: number): string {
  return formatNumber(v, { useGrouping: false, maximumFractionDigits: 1 });
}

function section(title: string): HTMLElement {
  const s = el('section', 'ed-section');
  s.appendChild(el('h2', 'ed-section-title', title));
  return s;
}

function hint(text: string): HTMLElement {
  return el('p', 'ed-hint', text);
}

export class Inspector {
  readonly root: HTMLElement;
  /** Which inspector tab is showing (3D only; Lighting lives on its own tab). */
  private panelTab: 'tool' | 'camera' | 'lighting' | 'scene' = 'tool';

  constructor(
    parent: HTMLElement,
    private readonly deps: InspectorDeps,
  ) {
    this.root = el('aside', 'ed-inspector');
    this.root.setAttribute('aria-label', t('editor.inspector.label'));
    parent.appendChild(this.root);
    this.refresh();
  }

  /** Picking any tool jumps the panel back to the Tool tab, so the new tool's
   *  options are visible even if Camera/Lighting was open. */
  showToolTab(): void {
    this.panelTab = 'tool';
  }

  refresh(): void {
    const d = this.deps;
    this.root.innerHTML = '';
    const tool = d.getTool();
    // Drives the per-tool hue (--tool-hue) shared with the tool rail, so the
    // panel header chip and slider accents match the active tool's color.
    this.root.dataset.tool = tool;

    const is3d = d.getViewMode() === '3d';
    if (is3d) this.panelTabs();
    if (is3d && this.panelTab === 'lighting') {
      this.lightingPanel();
      return;
    }
    if (is3d && this.panelTab === 'camera') {
      this.cameraPanel();
      return;
    }
    if (is3d && this.panelTab === 'scene') {
      this.sceneCollectionPanel();
      return;
    }

    switch (tool) {
      case 'select':
        // A bulb-badge click selects a map light (or a sound badge a point
        // sound): edit it right here without hopping to that tool.
        if (d.getSelectedLight() !== null) this.lightPanel();
        else if (d.getSelectedSound() !== null) this.soundPanel();
        else this.selectPanel();
        break;
      case 'move':
      case 'rotate':
      case 'scale':
        this.transformPanel(tool);
        this.selectPanel();
        break;
      case 'raise':
      case 'lower':
        this.brushPanel(true);
        this.sculptPanel();
        break;
      case 'smooth':
        this.brushPanel(true);
        break;
      case 'flatten':
        this.brushPanel(this.deps.getFlattenSmooth());
        this.flattenPanel();
        break;
      case 'tunnel':
        this.brushPanel(false);
        this.tunnelPanel();
        break;
      case 'rock':
        this.rockPanel();
        break;
      case 'paint':
        this.brushPanel(false);
        this.biomePanel();
        break;
      case 'water':
        this.waterPanel();
        break;
      case 'fluid':
        this.fluidToolPanel();
        break;
      case 'place':
        this.placePanel();
        this.procgenPanel();
        break;
      case 'foliage':
        this.brushPanel(false);
        this.foliagePanel();
        break;
      case 'blocker':
        this.blockerPanel();
        break;
      case 'collider':
        this.colliderPanel();
        this.selectPanel();
        break;
      case 'camp':
        this.campPanel();
        break;
      case 'spawn':
        this.spawnPanel();
        this.markerPanel();
        break;
      case 'zone':
        this.zonePanel();
        break;
      case 'light':
        this.lightPanel();
        break;
      case 'music':
        this.musicPanel();
        break;
      case 'sound':
        this.soundPanel();
        break;
      case 'region':
        this.regionPanel();
        break;
      case 'erase':
        this.brushPanel(false);
        this.erasePanel();
        break;
    }

    if (!is3d) this.layersPanel();
    this.navHint();
  }

  private panelTabs(): void {
    const bar = el('div', 'ed-inspector-tabs');
    bar.setAttribute('role', 'tablist');
    for (const tab of ['tool', 'camera', 'lighting', 'scene'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-inspector-tab';
      b.setAttribute('role', 'tab');
      const active = this.panelTab === tab;
      b.setAttribute('aria-selected', active ? 'true' : 'false');
      b.classList.toggle('active', active);
      b.textContent = t(
        tab === 'tool'
          ? 'editor.inspector.toolTab'
          : tab === 'camera'
            ? 'editor.inspector.cameraTab'
            : tab === 'lighting'
              ? 'editor.inspector.lightingTab'
              : 'editor.inspector.sceneTab',
      );
      b.addEventListener('click', () => {
        this.panelTab = tab;
        this.refresh();
      });
      bar.appendChild(b);
    }
    this.root.appendChild(bar);
  }

  // ---- panels -----------------------------------------------------------------

  private brushPanel(withStrength: boolean): void {
    const d = this.deps;
    const s = section(t('editor.brush.title'));
    // Brush size on a LOG scale: fine sub-yard steps at the small end
    // (0.4yd, 10x smaller than the old minimum) through region-sized 300yd
    // sweeps at the top, all on one comfortable track.
    const SIZE_MIN = 0.4;
    const SIZE_MAX = 300;
    const SIZE_LOG_SPAN = Math.log(SIZE_MAX / SIZE_MIN);
    const sizeFromT = (tv: number): number =>
      Math.round(SIZE_MIN * Math.exp((tv / 100) * SIZE_LOG_SPAN) * 10) / 10;
    const tFromSize = (r: number): number =>
      (Math.log(Math.min(SIZE_MAX, Math.max(SIZE_MIN, r)) / SIZE_MIN) / SIZE_LOG_SPAN) * 100;
    s.appendChild(
      slider(t('editor.brush.size'), {
        min: 0,
        max: 100,
        step: 0.5,
        value: tFromSize(d.getBrushRadius()),
        onInput: (v) => d.setBrushRadius(sizeFromT(v)),
        format: (v) => num1(sizeFromT(v)),
      }).root,
    );
    if (withStrength) {
      s.appendChild(
        slider(t('editor.brush.strength'), {
          // 1..50 on a 5x finer scale than the legacy 1..30 (5 == legacy 1):
          // gentle grading at the low end, same ceiling (50 == legacy 10).
          min: 1,
          max: 50,
          step: 1,
          value: d.getBrushStrength(),
          onInput: (v) => d.setBrushStrength(v),
          format: num1,
        }).root,
      );
    }
    s.appendChild(hint(t('editor.brush.sizeHint')));
    const stats = d.getTerrainEditStats();
    s.appendChild(
      hint(
        t('editor.brush.editCount', {
          count: formatNumber(stats.count, { useGrouping: false }),
          max: formatNumber(stats.max, { useGrouping: false }),
        }),
      ),
    );
    this.root.appendChild(s);
  }

  /** Small labelled text input for list renames. */
  private nameInput(value: string, onCommit: (v: string) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.maxLength = 40;
    input.addEventListener('change', () => onCommit(input.value));
    return input;
  }

  private zonePanel(): void {
    const d = this.deps;
    const s = section(t('editor.zoneTool.title'));
    s.appendChild(hint(t('editor.zoneTool.hint')));
    s.appendChild(
      checkbox(t('editor.zoneTool.hideBoxes'), d.getLocationsHidden(), (on) =>
        d.setLocationsHidden(on),
      ).root,
    );
    const locs = d.getLocations();
    if (locs.length === 0) s.appendChild(el('p', 'ed-muted', t('editor.zoneTool.none')));
    locs.forEach((loc, i) => {
      const row = el('div', 'ed-row');
      row.appendChild(this.nameInput(loc.name, (v) => d.renameLocation(i, v)));
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteLocation(i);
            this.refresh();
          },
          'danger small',
          t('editor.zoneTool.deleteTitle'),
        ),
      );
      s.appendChild(row);
    });
    this.root.appendChild(s);
  }

  private lightPanel(): void {
    const d = this.deps;
    const s = section(t('editor.lightTool.title'));
    s.appendChild(hint(t('editor.lightTool.hint', { max: 24 })));
    const lights = d.getMapLights();
    const selected = d.getSelectedLight();
    if (lights.length === 0) s.appendChild(el('p', 'ed-muted', t('editor.lightTool.none')));
    lights.forEach((l, i) => {
      const card = el('div', 'ed-light-card');
      card.classList.toggle('active', i === selected);
      const row = el('div', 'ed-row');
      const name = button(
        t('editor.lightTool.lightN', { num: formatNumber(i + 1, { useGrouping: false }) }),
        () => {
          d.setSelectedLight(i === selected ? null : i);
        },
        'small',
        t('editor.lightTool.selectTitle'),
      );
      name.classList.toggle('active', i === selected);
      row.appendChild(name);
      row.appendChild(
        this.colorInput(t('editor.lightTool.color'), l.color, (hex) =>
          d.updateMapLight(i, { color: hex }),
        ),
      );
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteMapLight(i);
            this.refresh();
          },
          'danger small',
          t('editor.lightTool.deleteTitle'),
        ),
      );
      card.appendChild(row);
      card.appendChild(
        slider(t('editor.lightTool.intensity'), {
          min: 0.2,
          max: 30,
          step: 0.2,
          value: l.intensity,
          onInput: (v) => d.updateMapLight(i, { intensity: v }),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.lightTool.range'), {
          min: 4,
          max: 120,
          step: 1,
          value: l.range,
          onInput: (v) => d.updateMapLight(i, { range: v }),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.lightTool.height'), {
          min: 0,
          max: 20,
          step: 0.5,
          value: l.y,
          onInput: (v) => d.updateMapLight(i, { y: v }),
          format: num1,
        }).root,
      );
      s.appendChild(card);
    });
    this.root.appendChild(s);
  }

  /** A dropdown of the loopable SFX clips a point sound can play on repeat. */
  private soundClipSelect(value: string, onChange: (id: string) => void): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', t('editor.soundTool.clip'));
    for (const id of POINT_SOUND_CLIPS) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = pointSoundLabel(id);
      opt.selected = value === id;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  private soundPanel(): void {
    const d = this.deps;
    const s = section(t('editor.soundTool.title'));
    s.appendChild(hint(t('editor.soundTool.hint')));
    const sounds = d.getMapSounds();
    const selected = d.getSelectedSound();
    if (sounds.length === 0) s.appendChild(el('p', 'ed-muted', t('editor.soundTool.none')));
    sounds.forEach((snd, i) => {
      const card = el('div', 'ed-light-card');
      card.classList.toggle('active', i === selected);
      const row = el('div', 'ed-row');
      const name = button(
        t('editor.soundTool.soundN', { num: formatNumber(i + 1, { useGrouping: false }) }),
        () => d.setSelectedSound(i === selected ? null : i),
        'small',
        t('editor.soundTool.selectTitle'),
      );
      name.classList.toggle('active', i === selected);
      row.appendChild(name);
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteMapSound(i);
            this.refresh();
          },
          'danger small',
          t('editor.soundTool.deleteTitle'),
        ),
      );
      card.appendChild(row);
      const clipRow = el('label', 'ed-field');
      clipRow.appendChild(el('span', undefined, t('editor.soundTool.clip')));
      clipRow.appendChild(
        this.soundClipSelect(snd.sound, (id) => d.updateMapSound(i, { sound: id })),
      );
      card.appendChild(clipRow);
      card.appendChild(
        slider(t('editor.soundTool.volume'), {
          min: 0,
          max: 1,
          step: 0.05,
          value: snd.volume,
          onInput: (v) => d.updateMapSound(i, { volume: v }),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.soundTool.radius'), {
          min: 2,
          max: 200,
          step: 1,
          value: snd.radius,
          onInput: (v) => d.updateMapSound(i, { radius: v }),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.soundTool.height'), {
          min: 0,
          max: 40,
          step: 0.5,
          value: snd.y,
          onInput: (v) => d.updateMapSound(i, { y: v }),
          format: num1,
        }).root,
      );
      s.appendChild(card);
    });
    this.root.appendChild(s);
  }

  /** A track select listing every shipped theme (plus a "biome default"). */
  private trackSelect(
    value: string | null,
    withDefault: boolean,
    ariaKey: 'editor.music.zoneTrack' | 'editor.music.areaTrack' | 'editor.music.rowTrack',
    onChange: (track: string | null) => void,
  ): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', t(ariaKey));
    if (withDefault) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t('editor.music.default');
      opt.selected = value === null;
      sel.appendChild(opt);
    }
    for (const id of MUSIC_ZONES) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = t(`editor.music.track.${id}` as Parameters<typeof t>[0]);
      opt.selected = value === id;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value === '' ? null : sel.value));
    return sel;
  }

  private musicPanel(): void {
    const d = this.deps;
    const s = section(t('editor.music.title'));
    s.appendChild(hint(t('editor.music.hint')));
    const m = d.getMusic();
    // Map-wide track.
    const zoneRow = el('label', 'ed-field');
    zoneRow.appendChild(el('span', undefined, t('editor.music.zoneTrack')));
    zoneRow.appendChild(
      this.trackSelect(m.zoneTrack, true, 'editor.music.zoneTrack', (track) => {
        d.setZoneTrack(track);
        this.refresh();
      }),
    );
    s.appendChild(zoneRow);
    // The track the NEXT dragged box gets.
    s.appendChild(el('h3', 'ed-subtitle', t('editor.music.areasTitle')));
    const areaRow = el('label', 'ed-field');
    areaRow.appendChild(el('span', undefined, t('editor.music.areaTrack')));
    areaRow.appendChild(
      this.trackSelect(m.areaTrack, false, 'editor.music.areaTrack', (track) => {
        if (track) d.setAreaTrack(track);
      }),
    );
    s.appendChild(areaRow);
    s.appendChild(hint(t('editor.music.dragHint')));
    if (m.areas.length === 0) {
      s.appendChild(el('p', 'ed-muted', t('editor.music.none')));
    }
    const selected = d.getSelectedMusicArea();
    m.areas.forEach((a, i) => {
      const row = el('div', 'ed-row ed-music-area');
      row.classList.toggle('active', i === selected);
      const name = button(
        t('editor.music.areaN', { num: formatNumber(i + 1, { useGrouping: false }) }),
        () => {
          d.setSelectedMusicArea(i === selected ? null : i);
        },
        'small',
        t('editor.music.selectArea'),
      );
      name.classList.toggle('active', i === selected);
      row.appendChild(name);
      row.appendChild(
        this.trackSelect(a.track, false, 'editor.music.rowTrack', (track) => {
          if (track) d.updateMusicArea(i, track);
        }),
      );
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteMusicArea(i);
            this.refresh();
          },
          'danger small',
          t('editor.music.removeArea'),
        ),
      );
      s.appendChild(row);
    });
    this.root.appendChild(s);
  }

  private markerPanel(): void {
    const d = this.deps;
    const s = section(t('editor.markerTool.title'));
    s.appendChild(hint(t('editor.markerTool.hint')));
    const mode = d.getMarkerMode();
    s.appendChild(
      checkbox(t('editor.markerTool.place'), mode.placing, (on) => {
        d.setMarkerMode({ placing: on });
        this.refresh();
      }).root,
    );
    if (mode.placing) {
      const row = el('label', 'ed-field');
      row.appendChild(el('span', undefined, t('editor.markerTool.kind')));
      const sel = document.createElement('select');
      for (const kind of ['npc', 'object'] as const) {
        const o = document.createElement('option');
        o.value = kind;
        o.textContent = t(`editor.markerTool.${kind}` as Parameters<typeof t>[0]);
        if (mode.kind === kind) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () =>
        d.setMarkerMode({ kind: sel.value === 'object' ? 'object' : 'npc' }),
      );
      row.appendChild(sel);
      s.appendChild(row);
    }
    const markers = d.getMarkers();
    if (markers.length === 0) s.appendChild(el('p', 'ed-muted', t('editor.markerTool.none')));
    markers.forEach((m, i) => {
      const row = el('div', 'ed-row');
      row.appendChild(this.nameInput(m.name, (v) => d.renameMarker(i, v)));
      row.appendChild(
        button(
          'x',
          () => {
            d.deleteMarker(i);
            this.refresh();
          },
          'danger small',
          t('editor.markerTool.deleteTitle'),
        ),
      );
      s.appendChild(row);
    });
    this.root.appendChild(s);
  }

  /** Tunnel tool: dig/patch mode, authoring hint, and the cave list with
   *  per-cave width/height sliders, reverse (swap A<->B) and delete. */
  private rockPanel(): void {
    const d = this.deps;
    const s = section(t('editor.rock.title'));
    const params = d.getRockParams();
    const chain = d.getRockChainState();
    s.appendChild(
      checkbox(t('editor.rock.chainMode'), chain.mode, (on) => {
        d.setRockChainMode(on);
        this.refresh();
      }).root,
    );
    s.appendChild(hint(chain.mode ? t('editor.rock.chainHint') : t('editor.rock.hint')));
    if (chain.mode) {
      if (chain.count > 0) {
        s.appendChild(
          el(
            'p',
            'ed-chosen',
            t('editor.rock.chainCount', {
              count: formatNumber(chain.count, { useGrouping: false }),
            }),
          ),
        );
      }
      const row = el('div', 'ed-row');
      row.appendChild(
        button(t('editor.rock.generateChain'), () => d.generateRockChain(), 'primary'),
      );
      if (chain.count > 0) {
        row.appendChild(button(t('editor.rock.clearChain'), () => d.clearRockChain(), 'small'));
      }
      s.appendChild(row);
      s.appendChild(
        checkbox(t('editor.rock.walkable'), params.walkable, (on) =>
          d.setRockParams({ walkable: on }),
        ).root,
      );
    }
    s.appendChild(
      slider(t('editor.rock.size'), {
        min: 0.5,
        max: 20,
        step: 0.5,
        value: params.size,
        onInput: (v) => d.setRockParams({ size: v }),
        onChange: (v) => d.setRockParams({ size: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.noise'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: params.noise,
        onInput: (v) => d.setRockParams({ noise: v }),
        onChange: (v) => d.setRockParams({ noise: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.detail'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: params.detail,
        onInput: (v) => d.setRockParams({ detail: v }),
        onChange: (v) => d.setRockParams({ detail: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.sharp'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: params.sharp,
        onInput: (v) => d.setRockParams({ sharp: v }),
        onChange: (v) => d.setRockParams({ sharp: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.jag'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: params.jag,
        onInput: (v) => d.setRockParams({ jag: v }),
        onChange: (v) => d.setRockParams({ jag: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.height'), {
        min: 0.3,
        max: 3,
        step: 0.1,
        value: params.height,
        onInput: (v) => d.setRockParams({ height: v }),
        onChange: (v) => d.setRockParams({ height: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.depth'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: params.depth,
        onInput: (v) => d.setRockParams({ depth: v }),
        onChange: (v) => d.setRockParams({ depth: v }),
        format: num1,
      }).root,
    );
    this.texSetPicker(
      s,
      t('editor.rock.baseTex'),
      this.rockTexOptions(),
      params.texId || `legacy:${params.tex}`,
      (v) => {
        if (v.startsWith('legacy:')) d.setRockParams({ tex: Number(v.slice(7)), texId: '' });
        else d.setRockParams({ texId: v });
      },
    );
    if (params.texId) {
      s.appendChild(
        slider(t('editor.biome.tileSize'), {
          min: 1,
          max: 64,
          step: 1,
          value: params.texTile,
          onInput: (v) => d.setRockParams({ texTile: v }),
          onChange: (v) => d.setRockParams({ texTile: v }),
          format: num1,
        }).root,
      );
    }
    this.root.appendChild(s);
  }

  /** Selected generated rock: reshape it live through updateSelection. */
  private rockControls(s: HTMLElement, sel: PlacementSelection): void {
    const d = this.deps;
    s.appendChild(el('h4', 'ed-sub-title', t('editor.rock.selTitle')));
    s.appendChild(
      slider(t('editor.rock.noise'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: sel.rockNoise ?? 0.5,
        onInput: (v) => d.updateSelection({ rockNoise: v }, false),
        onChange: (v) => d.updateSelection({ rockNoise: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.detail'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: sel.rockDetail ?? 0.5,
        onInput: (v) => d.updateSelection({ rockDetail: v }, false),
        onChange: (v) => d.updateSelection({ rockDetail: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.sharp'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: sel.rockSharp ?? 0.3,
        onInput: (v) => d.updateSelection({ rockSharp: v }, false),
        onChange: (v) => d.updateSelection({ rockSharp: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.jag'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: sel.rockJag ?? 0,
        onInput: (v) => d.updateSelection({ rockJag: v }, false),
        onChange: (v) => d.updateSelection({ rockJag: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.height'), {
        min: 0.3,
        max: 3,
        step: 0.1,
        value: sel.rockHeight ?? 1,
        onInput: (v) => d.updateSelection({ rockHeight: v }, false),
        onChange: (v) => d.updateSelection({ rockHeight: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.rock.depth'), {
        min: 0,
        max: 1,
        step: 0.05,
        value: sel.rockDepth ?? 0,
        onInput: (v) => d.updateSelection({ rockDepth: v }, false),
        onChange: (v) => d.updateSelection({ rockDepth: v }, true),
        format: num1,
      }).root,
    );
    this.texSetPicker(
      s,
      t('editor.rock.baseTex'),
      this.rockTexOptions(),
      sel.rockTexId || `legacy:${sel.rockTex ?? 0}`,
      (v) => {
        if (v.startsWith('legacy:')) d.updateSelection({ rockTex: Number(v.slice(7)) }, true);
        else d.updateSelection({ rockTexId: v }, true);
      },
    );
    if (sel.rockTexId) {
      s.appendChild(
        slider(t('editor.biome.tileSize'), {
          min: 1,
          max: 64,
          step: 1,
          value: sel.rockTexTile ?? DEFAULT_TEXTURE_TILE_YD,
          onInput: (v) => d.updateSelection({ rockTexTile: v }, false),
          onChange: (v) => d.updateSelection({ rockTexTile: v }, true),
          format: num1,
        }).root,
      );
    }
    s.appendChild(
      button(
        t('editor.rock.reroll'),
        () => {
          d.updateSelection({ rockSeed: ((sel.rockSeed ?? 0) + 7919) % 1_000_000_000 }, true);
          this.refresh();
        },
        'small',
      ),
    );
  }

  private tunnelPanel(): void {
    const d = this.deps;
    const mode = d.getTunnelMode();
    const s = section(t('editor.tool.tunnel'));
    // Mode switch: model a cave, or cut holes in the ground to connect it to.
    const modeRow = el('div', 'ed-row');
    modeRow.appendChild(
      button(
        t('editor.tunnel.modeDig'),
        () => {
          d.setTunnelMode('dig');
          this.refresh();
        },
        mode === 'dig' ? 'primary small' : 'small',
      ),
    );
    modeRow.appendChild(
      button(
        t('editor.tunnel.modeHole'),
        () => {
          d.setTunnelMode('hole');
          this.refresh();
        },
        mode === 'hole' ? 'primary small' : 'small',
      ),
    );
    modeRow.appendChild(
      button(
        t('editor.tunnel.modePatch'),
        () => {
          d.setTunnelMode('patch');
          this.refresh();
        },
        mode === 'patch' ? 'primary small' : 'small',
      ),
    );
    s.appendChild(modeRow);
    s.appendChild(
      hint(
        mode === 'hole'
          ? t('editor.tunnel.holeHint')
          : mode === 'patch'
            ? t('editor.tunnel.patchHint')
            : t('editor.tunnel.hint'),
      ),
    );
    if (mode === 'hole') {
      const holes = d.getHoles();
      if (holes.length > 0) s.appendChild(el('h3', 'ed-subtitle', t('editor.tunnel.holeList')));
      for (const hole of holes) {
        const card = el('div', 'ed-cave-card');
        card.appendChild(
          el(
            'p',
            'ed-chosen',
            t('editor.tunnel.holeLabel', {
              n: formatNumber(hole.index + 1, { useGrouping: false }),
            }),
          ),
        );
        card.appendChild(
          slider(t('editor.tunnel.holeRadius'), {
            min: 1,
            max: 40,
            step: 0.5,
            value: hole.radius,
            onInput: (v) => d.updateHole(hole.index, { radius: v }, false),
            onChange: (v) => d.updateHole(hole.index, { radius: v }, true),
            format: num1,
          }).root,
        );
        card.appendChild(
          button(t('editor.tunnel.holeDelete'), () => d.deleteHole(hole.index), 'danger small'),
        );
        s.appendChild(card);
      }
      this.root.appendChild(s);
      return;
    }
    if (mode === 'patch') {
      const patches = d.getHolePatches();
      if (patches.length > 0) {
        s.appendChild(el('h3', 'ed-subtitle', t('editor.tunnel.patchList')));
      }
      for (const patch of patches) {
        const card = el('div', 'ed-cave-card');
        card.appendChild(
          el(
            'p',
            'ed-chosen',
            t('editor.tunnel.patchLabel', {
              n: formatNumber(patch.index + 1, { useGrouping: false }),
            }),
          ),
        );
        card.appendChild(
          slider(t('editor.tunnel.holeRadius'), {
            min: 1,
            max: 40,
            step: 0.5,
            value: patch.radius,
            onInput: (v) => d.updateHolePatch(patch.index, { radius: v }, false),
            onChange: (v) => d.updateHolePatch(patch.index, { radius: v }, true),
            format: num1,
          }).root,
        );
        card.appendChild(
          button(
            t('editor.tunnel.patchDelete'),
            () => d.deleteHolePatch(patch.index),
            'danger small',
          ),
        );
        s.appendChild(card);
      }
      this.root.appendChild(s);
      return;
    }
    const pairState = d.getCavePairState();
    if (pairState.pendingExit) {
      s.appendChild(hint(t('editor.tunnel.needExit')));
    }
    if (pairState.readyToGenerate > 0) {
      s.appendChild(
        button(
          t('editor.tunnel.generate', {
            count: formatNumber(pairState.readyToGenerate, { useGrouping: false }),
          }),
          () => d.generateCaves(),
          'primary',
        ),
      );
    }
    const caves = d.getCaves();
    if (caves.length > 0) s.appendChild(el('h3', 'ed-subtitle', t('editor.tunnel.listTitle')));
    for (const cave of caves) {
      const card = el('div', 'ed-cave-card');
      card.appendChild(
        el(
          'p',
          'ed-chosen',
          t('editor.tunnel.caveLabel', {
            n: formatNumber(cave.index + 1, { useGrouping: false }),
            nodes: formatNumber(cave.nodes, { useGrouping: false }),
          }),
        ),
      );
      // Whole-cave move: group-select the rig and hand off to the Move gizmo.
      card.appendChild(
        button(t('editor.tunnel.selectCave'), () => d.selectWholeCave(cave.index), 'primary small'),
      );
      // Mouth toggles: each end is an open ring at exactly its authored size,
      // or a sealed rock cap.
      card.appendChild(
        checkbox(t('editor.tunnel.startOpen'), cave.startOpen, (on) => {
          d.updateCave(cave.index, { startOpen: on }, true);
        }).root,
      );
      card.appendChild(
        checkbox(t('editor.tunnel.endOpen'), cave.endOpen, (on) => {
          d.updateCave(cave.index, { endOpen: on }, true);
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.width'), {
          min: 0.5,
          max: 3,
          step: 0.1,
          value: cave.width,
          onInput: (v) => d.updateCave(cave.index, { width: v }, false),
          onChange: (v) => d.updateCave(cave.index, { width: v }, true),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.height'), {
          min: 0.5,
          max: 3,
          step: 0.1,
          value: cave.height,
          onInput: (v) => d.updateCave(cave.index, { height: v }, false),
          onChange: (v) => d.updateCave(cave.index, { height: v }, true),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.variance'), {
          min: 0,
          max: 1,
          step: 0.05,
          value: cave.variance,
          onInput: (v) => d.updateCave(cave.index, { variance: v }, false),
          onChange: (v) => d.updateCave(cave.index, { variance: v }, true),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.floorVariance'), {
          min: 0,
          max: 1,
          step: 0.05,
          value: cave.floorVariance,
          onInput: (v) => d.updateCave(cave.index, { floorVariance: v }, false),
          onChange: (v) => d.updateCave(cave.index, { floorVariance: v }, true),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.stalactites'), {
          min: 0,
          max: 1,
          step: 0.05,
          value: cave.stalactites,
          onInput: (v) => d.updateCave(cave.index, { stalactites: v }, false),
          onChange: (v) => d.updateCave(cave.index, { stalactites: v }, true),
          format: num1,
        }).root,
      );
      card.appendChild(
        slider(t('editor.tunnel.stalagmites'), {
          min: 0,
          max: 1,
          step: 0.05,
          value: cave.stalagmites,
          onInput: (v) => d.updateCave(cave.index, { stalagmites: v }, false),
          onChange: (v) => d.updateCave(cave.index, { stalagmites: v }, true),
          format: num1,
        }).root,
      );
      if (cave.stalactites > 0 || cave.stalagmites > 0) {
        card.appendChild(
          slider(t('editor.tunnel.spikeSize'), {
            min: 0.3,
            max: 3,
            step: 0.1,
            value: cave.spikeSize,
            onInput: (v) => d.updateCave(cave.index, { spikeSize: v }, false),
            onChange: (v) => d.updateCave(cave.index, { spikeSize: v }, true),
            format: num1,
          }).root,
        );
      }
      // Interior base texture: tiled over walls/floor; the Paint tool's vertex
      // tint still layers on top, so a re-textured cave stays fully paintable.
      this.texSetPicker(
        card,
        t('editor.tunnel.texture'),
        [
          { value: '', label: t('editor.tunnel.texDefault'), file: 'Rock051_Color.jpg' },
          ...TERRAIN_TEXTURE_SETS.map((set) => ({
            value: set.key,
            label: set.name,
            file: `${set.key}_Color.jpg`,
          })),
        ],
        cave.tex ?? '',
        (v) => d.updateCave(cave.index, { tex: v || null }, true),
      );
      if (cave.tex) {
        card.appendChild(
          slider(t('editor.biome.tileSize'), {
            min: 1,
            max: 64,
            step: 1,
            value: cave.texTile ?? DEFAULT_TEXTURE_TILE_YD,
            onInput: (v) => d.updateCave(cave.index, { texTile: v }, false),
            onChange: (v) => d.updateCave(cave.index, { texTile: v }, true),
            format: num1,
          }).root,
        );
      }
      const row = el('div', 'ed-row');
      row.appendChild(button(t('editor.tunnel.reverse'), () => d.reverseCave(cave.index), 'small'));
      row.appendChild(
        button(t('editor.tunnel.delete'), () => d.deleteCave(cave.index), 'danger small'),
      );
      card.appendChild(row);
      s.appendChild(card);
    }
    s.appendChild(hint(t('editor.tunnel.guideHint')));
    this.root.appendChild(s);
  }

  /** The merged Sculpt tool's direction toggle (raise by default). */
  private sculptPanel(): void {
    const d = this.deps;
    const s = section(t('editor.tool.raise'));
    s.appendChild(hint(t('editor.sculpt.hint')));
    s.appendChild(
      checkbox(t('editor.sculpt.lower'), d.getSculptLower(), (on) => d.setSculptLower(on)).root,
    );
    s.appendChild(
      checkbox(t('editor.sculpt.grab'), d.getSculptGrab(), (on) => {
        d.setSculptGrab(on);
        this.refresh();
      }).root,
    );
    if (d.getSculptGrab()) s.appendChild(hint(t('editor.sculpt.grabHint')));
    s.appendChild(hint(t('editor.sculpt.shiftHint')));
    this.autoTextureControls(s);
    this.root.appendChild(s);
  }

  /** One paint-id dropdown for the auto-texture bands: built-in biomes plus
   *  the map's custom swatches, with "Leave as is" = -1. */
  private paintIdSelect(value: number, onChange: (id: number) => void): HTMLElement {
    const row = el('label', 'ed-field');
    const sel = document.createElement('select');
    const add = (v: number, label: string): void => {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = label;
      if (v === value) o.selected = true;
      sel.appendChild(o);
    };
    add(-1, t('editor.sculpt.autoTexNone'));
    for (const opt of BIOME_OPTIONS) {
      if (opt.id === 255) continue;
      add(opt.id, t(opt.labelKey as Parameters<typeof t>[0]));
    }
    for (const sw of this.deps.getCustomSwatches()) {
      add(sw.id, sw.label ?? `#${sw.color.toString(16).padStart(6, '0')}`);
    }
    sel.addEventListener('change', () => {
      const v = Number.parseInt(sel.value, 10);
      if (Number.isFinite(v)) onChange(v);
    });
    row.appendChild(sel);
    return row;
  }

  /** Slope-based auto texture: shared by the Sculpt and Flatten/Smooth panels. */
  private autoTextureControls(s: HTMLElement): void {
    const d = this.deps;
    const cfg = d.getAutoTexture();
    s.appendChild(
      checkbox(t('editor.sculpt.autoTex'), cfg.enabled, (on) => {
        d.setAutoTexture({ enabled: on });
        this.refresh();
      }).root,
    );
    if (!cfg.enabled) return;
    s.appendChild(hint(t('editor.sculpt.autoTexHint')));
    s.appendChild(
      slider(t('editor.sculpt.autoTexAngle'), {
        min: 10,
        max: 75,
        step: 1,
        value: cfg.angle,
        onInput: (v) => d.setAutoTexture({ angle: v }),
        format: num1,
      }).root,
    );
    s.appendChild(el('p', 'ed-hint', t('editor.sculpt.autoTexFlat')));
    s.appendChild(this.paintIdSelect(cfg.flatId, (id) => d.setAutoTexture({ flatId: id })));
    s.appendChild(el('p', 'ed-hint', t('editor.sculpt.autoTexSteep')));
    s.appendChild(this.paintIdSelect(cfg.steepId, (id) => d.setAutoTexture({ steepId: id })));
  }

  private flattenPanel(): void {
    const d = this.deps;
    const s = section(t('editor.tool.flatten'));
    s.appendChild(hint(t('editor.flatten.hint')));
    s.appendChild(
      checkbox(t('editor.flatten.smoothMode'), d.getFlattenSmooth(), (on) => {
        d.setFlattenSmooth(on);
        this.refresh(); // the strength slider / hard-edge toggle swap with the mode
      }).root,
    );
    if (!d.getFlattenSmooth()) {
      s.appendChild(
        checkbox(t('editor.flatten.hardEdge'), d.getFlattenHardEdge(), (on) =>
          d.setFlattenHardEdge(on),
        ).root,
      );
    }
    s.appendChild(hint(t('editor.flatten.shiftHint')));
    this.autoTextureControls(s);
    this.root.appendChild(s);
  }

  private biomePanel(): void {
    const d = this.deps;
    const s = section(t('editor.biome.title'));
    // Photoshop-style brush edge control + the bucket fill.
    s.appendChild(
      slider(t('editor.biome.hardness'), {
        min: 10,
        max: 100,
        step: 5,
        value: d.getPaintHardness(),
        onInput: (v) => d.setPaintHardness(v),
        format: num1,
      }).root,
    );
    const bucket = button(
      t('editor.biome.bucket'),
      () => {
        d.setBucketArmed(!d.getBucketArmed());
        this.refresh();
      },
      'small',
      t('editor.biome.bucketTitle'),
    );
    if (d.getBucketArmed()) bucket.classList.add('active');
    s.appendChild(bucket);
    if (d.getBucketArmed()) s.appendChild(hint(t('editor.biome.bucketArmedHint')));
    this.brushAlphaPicker(s);
    this.texturePicker(s);
    // Tile-size for the active imported-texture swatch (yards per repeat).
    const active = d.getCustomSwatches().find((sw) => sw.id === d.getPaintBiome());
    if (active?.textureSha) {
      s.appendChild(
        slider(t('editor.biome.tileSize'), {
          min: 1,
          max: 64,
          step: 1,
          value: active.tileSize ?? DEFAULT_TEXTURE_TILE_YD,
          onInput: (v) => d.setSwatchTileSize(active.id, v),
          format: num1,
        }).root,
      );
    }
    // Hue / light adjust of the selected texture. Centered = the texture
    // paints exactly as stock; moving a slider on a BUILT-IN biome creates
    // (or reuses) a custom variant swatch carrying the adjust, so the values
    // save with the map. Color-only swatches keep just their authored color.
    const isBuiltIn = BIOME_OPTIONS.some((o) => o.id === d.getPaintBiome() && o.id !== 255);
    if (isBuiltIn || active?.textureSha || active?.baseBiome !== undefined) {
      // A non-centered tint can be kept as its own reusable swatch. The button
      // lives in the panel permanently (panels don't re-render per slider
      // tick) and the slider handlers keep its enabled state current.
      const saveBtn = button(
        t('editor.biome.saveSwatch'),
        () => d.saveAdjustedSwatch(),
        'small',
        t('editor.biome.saveSwatchTitle'),
      );
      const syncSave = (): void => {
        const sw = d.getCustomSwatches().find((c) => c.id === d.getPaintBiome());
        saveBtn.disabled = !sw || ((sw.hueShift ?? 0) === 0 && (sw.light ?? 0) === 0);
      };
      s.appendChild(
        slider(t('editor.biome.hue'), {
          min: -180,
          max: 180,
          step: 1,
          value: active?.hueShift ?? 0,
          onInput: (v) => {
            d.setPaintAdjust({ hueShift: v });
            syncSave();
          },
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.biome.light'), {
          min: -100,
          max: 100,
          step: 1,
          value: Math.round((active?.light ?? 0) * 100),
          onInput: (v) => {
            d.setPaintAdjust({ light: v / 100 });
            syncSave();
          },
          format: num1,
        }).root,
      );
      syncSave();
      s.appendChild(saveBtn);
    }
    s.appendChild(
      button(
        t('editor.biome.importTexture'),
        () => d.importTextureSwatch(),
        'small',
        t('editor.biome.importTextureTitle'),
      ),
    );
    s.appendChild(hint(t('editor.biome.customHint')));
    s.appendChild(hint(t('editor.biome.hint')));
    this.terrainStyleControls(s);
    s.appendChild(button(t('editor.biome.clear'), () => d.clearBiomePaint(), 'small danger'));
    this.root.appendChild(s);
  }

  /** Brush alpha picker: None + the built-in masks + imports, as thumbnails. */
  private brushAlphaPicker(s: HTMLElement): void {
    const d = this.deps;
    const activeId = d.getPaintAlpha();
    s.appendChild(el('h3', 'ed-subtitle', t('editor.biome.alphaTitle')));
    const row = el('div', 'ed-alpha-row');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('editor.biome.alphaTitle'));
    const cell = (
      id: string | null,
      name: string,
      thumb: HTMLElement | null,
      removable: boolean,
    ): void => {
      const wrap = el('div', 'ed-alpha-cell');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-alpha';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', id === activeId ? 'true' : 'false');
      b.classList.toggle('active', id === activeId);
      b.title = name;
      b.setAttribute('aria-label', name);
      if (thumb) b.appendChild(thumb);
      else b.appendChild(el('span', 'ed-alpha-none', name));
      b.addEventListener('click', () => {
        d.setPaintAlpha(id);
        this.refresh();
      });
      wrap.appendChild(b);
      if (removable && id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ed-asset-del';
        del.textContent = 'x';
        del.title = t('editor.biome.alphaRemove');
        del.setAttribute('aria-label', t('editor.biome.alphaRemove'));
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          removeBrushAlpha(id);
          if (activeId === id) d.setPaintAlpha(null);
          this.refresh();
        });
        wrap.appendChild(del);
      }
      row.appendChild(wrap);
    };
    cell(null, t('editor.biome.alphaNone'), null, false);
    for (const a of listBrushAlphas()) {
      cell(a.id, a.name, brushAlphaThumb(a), a.imported === true);
    }
    s.appendChild(row);
    s.appendChild(
      button(
        t('editor.biome.alphaImport'),
        () => d.importPaintAlpha(),
        'small',
        t('editor.biome.alphaImportTitle'),
      ),
    );
  }

  /** Every paintable texture as one option row (thumbnail + name). Built-in
   *  library sets not yet materialized as map swatches ride along with a
   *  `builtinKey` instead of a paint id (picking one materializes it). */
  private textureOptions(): {
    id: number;
    label: string;
    thumb: { file?: string; url?: string; tint?: string; erase?: boolean };
    builtinKey?: string;
  }[] {
    const d = this.deps;
    const out: {
      id: number;
      label: string;
      thumb: { file?: string; url?: string; tint?: string; erase?: boolean };
      builtinKey?: string;
    }[] = [];
    for (const opt of BIOME_OPTIONS) {
      if (opt.id === 255) continue;
      out.push({
        id: opt.id,
        label: t(opt.labelKey as Parameters<typeof t>[0]),
        thumb: { ...BIOME_THUMBS[opt.id] },
      });
    }
    const swatches = d.getCustomSwatches();
    for (const sw of swatches) {
      const css = `#${adjustedSwatchColor(sw).toString(16).padStart(6, '0')}`;
      const texUrl = sw.textureSha ? d.swatchTextureUrl(sw.textureSha) : null;
      // A biome-variant swatch previews over its base biome's real texture.
      const baseThumb = sw.baseBiome !== undefined ? BIOME_THUMBS[sw.baseBiome] : BIOME_THUMBS[0];
      out.push({
        id: sw.id,
        label: sw.label ?? css,
        // A color swatch hue-tints the base grass texture, so its thumbnail
        // previews exactly that; an imported texture shows its own image.
        thumb: texUrl ? { url: texUrl } : { file: baseThumb?.file, tint: hexWithAlpha(css, 0.55) },
      });
    }
    // The built-in texture library: always-available default sets that ship
    // with the editor. One already materialized as a swatch is skipped (its
    // swatch row above covers it).
    for (const set of paintDefaultSets()) {
      const sha = builtinShaFor(set.key);
      if (swatches.some((sw) => sw.textureSha === sha)) continue;
      out.push({
        id: -1,
        label: set.name,
        thumb: { file: `${set.key}_Color.jpg` },
        builtinKey: set.key,
      });
    }
    out.push({ id: 255, label: t('editor.biome.erase'), thumb: { erase: true } });
    return out;
  }

  /** Small texture-set dropdown (the texturePicker look) for tools that pick a
   *  base texture: generated rocks and cave interiors. */
  private texSetPicker(
    parent: HTMLElement,
    label: string,
    options: { value: string; label: string; file?: string }[],
    activeValue: string,
    onPick: (value: string) => void,
  ): void {
    const wrap = el('div', 'ed-texpick-wrap');
    wrap.appendChild(el('span', 'ed-label', label));
    const active = options.find((o) => o.value === activeValue) ?? options[0];
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ed-texpick';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.append(
      this.textureThumb({ file: active.file }),
      el('span', 'ed-texpick-label', active.label),
      el('span', 'ed-texpick-caret', 'v'),
    );
    const menu = el('div', 'ed-texpick-menu');
    menu.setAttribute('role', 'listbox');
    menu.style.display = 'none';
    const closeOnOutside = (ev: PointerEvent): void => {
      if (!wrap.contains(ev.target as Node)) close();
    };
    const close = (): void => {
      menu.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', closeOnOutside, true);
    };
    trigger.addEventListener('click', () => {
      if (menu.style.display !== 'none') {
        close();
        return;
      }
      menu.style.display = '';
      trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', closeOnOutside, true);
    });
    for (const opt of options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ed-texpick-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', opt.value === active.value ? 'true' : 'false');
      item.classList.toggle('active', opt.value === active.value);
      item.append(this.textureThumb({ file: opt.file }), el('span', 'ed-texpick-label', opt.label));
      item.addEventListener('click', () => {
        close();
        onPick(opt.value);
        this.refresh();
      });
      menu.appendChild(item);
    }
    wrap.append(trigger, menu);
    parent.appendChild(wrap);
  }

  /** The Rock tool's base-texture options: legacy procedural looks plus every
   *  built-in terrain texture set. */
  private rockTexOptions(): { value: string; label: string; file?: string }[] {
    return [
      { value: 'legacy:0', label: t('editor.rock.texStone') },
      { value: 'legacy:1', label: t('editor.rock.texSandstone') },
      { value: 'legacy:2', label: t('editor.rock.texBare') },
      ...TERRAIN_TEXTURE_SETS.map((s) => ({
        value: s.key,
        label: s.name,
        file: `${s.key}_Color.jpg`,
      })),
    ];
  }

  private textureThumb(opt: {
    file?: string;
    url?: string;
    tint?: string;
    erase?: boolean;
  }): HTMLElement {
    const th = el('span', 'ed-texthumb');
    if (opt.erase) th.classList.add('ed-biome-erase');
    else if (opt.url) th.style.backgroundImage = `url(${opt.url})`;
    else if (opt.file)
      th.style.backgroundImage = `url(${assetUrl(`textures/terrain/${opt.file}`)})`;
    if (opt.tint) {
      const overlay = el('span', 'ed-texthumb-tint');
      overlay.style.background = opt.tint;
      th.appendChild(overlay);
    }
    return th;
  }

  /** Texture selection: one button showing the active texture; clicking opens
   *  a dropdown of every option with a real thumbnail of that texture. */
  private texturePicker(s: HTMLElement): void {
    const d = this.deps;
    const wrap = el('div', 'ed-texpick-wrap');
    const options = this.textureOptions();
    const active = options.find((o) => o.id === d.getPaintBiome()) ?? options[0];
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ed-texpick';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.title = t('editor.biome.pickTexture');
    trigger.append(
      this.textureThumb(active.thumb),
      el('span', 'ed-texpick-label', active.label),
      el('span', 'ed-texpick-caret', 'v'),
    );
    const menu = el('div', 'ed-texpick-menu');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', t('editor.biome.paletteLabel'));
    menu.style.display = 'none';
    const closeOnOutside = (ev: PointerEvent): void => {
      if (!wrap.contains(ev.target as Node)) close();
    };
    const close = (): void => {
      menu.style.display = 'none';
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', closeOnOutside, true);
    };
    trigger.addEventListener('click', () => {
      const open = menu.style.display !== 'none';
      if (open) {
        close();
        return;
      }
      menu.style.display = '';
      trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', closeOnOutside, true);
    });
    for (const opt of options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'ed-texpick-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', opt.id === active.id ? 'true' : 'false');
      item.classList.toggle('active', opt.id === active.id);
      item.append(this.textureThumb(opt.thumb), el('span', 'ed-texpick-label', opt.label));
      item.addEventListener('click', () => {
        close();
        // Library entries materialize (or reuse) their swatch on pick.
        if (opt.builtinKey) d.pickBuiltinTexture(opt.builtinKey);
        else d.setPaintBiome(opt.id);
        this.refresh();
      });
      menu.appendChild(item);
    }
    wrap.append(trigger, menu);
    s.appendChild(wrap);
  }

  /** Per-map auto-texturing rules (paint always wins over the enabled ones). */
  private terrainStyleControls(s: HTMLElement): void {
    const d = this.deps;
    const style = d.getTerrainStyle();
    s.appendChild(el('h3', 'ed-subtitle', t('editor.biome.autoTitle')));
    s.appendChild(
      checkbox(t('editor.biome.autoSlopeRock'), style.slopeRock, (on) =>
        d.setTerrainStyle({ slopeRock: on }),
      ).root,
    );
    s.appendChild(
      checkbox(t('editor.biome.autoSnowCaps'), style.snowCaps, (on) =>
        d.setTerrainStyle({ snowCaps: on }),
      ).root,
    );
    s.appendChild(
      checkbox(t('editor.biome.autoRim'), style.rimMountains, (on) =>
        d.setTerrainStyle({ rimMountains: on }),
      ).root,
    );
    s.appendChild(
      checkbox(t('editor.biome.autoShoreSand'), style.shoreSand, (on) =>
        d.setTerrainStyle({ shoreSand: on }),
      ).root,
    );
    s.appendChild(hint(t('editor.biome.autoHint')));
  }

  private waterPanel(): void {
    const d = this.deps;
    const s = section(t('editor.water.title'));
    s.appendChild(
      slider(t('editor.water.level'), {
        min: MIN_WATER_LEVEL,
        max: MAX_WATER_LEVEL,
        step: 0.5,
        value: d.getWaterLevel(),
        onInput: (v) => d.previewWaterLevel(v),
        onChange: (v) => d.commitWaterLevel(v),
        format: num1,
      }).root,
    );
    s.appendChild(
      hint(
        t('editor.water.hint', {
          min: num1(MIN_WATER_LEVEL),
          max: num1(MAX_WATER_LEVEL),
        }),
      ),
    );
    s.appendChild(
      button(
        t('editor.water.reset'),
        () => {
          d.resetWaterLevel();
          this.refresh();
        },
        'small',
      ),
    );
    {
      // Map-wide water tint: hue + lightness, the grass-slider authoring model.
      const tint = d.getWaterTint();
      const hue = tint.hue ?? 205;
      const lumPct = Math.round((tint.lum ?? 0.45) * 100);
      s.appendChild(el('h3', 'ed-subtitle', t('editor.water.tintTitle')));
      s.appendChild(
        slider(t('editor.water.hue'), {
          min: 0,
          max: 360,
          step: 1,
          value: hue,
          onInput: (v) => d.previewWaterTint(v, d.getWaterTint().lum),
          onChange: (v) => d.commitWaterTint(v, d.getWaterTint().lum),
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.water.light'), {
          min: 5,
          max: 90,
          step: 1,
          value: lumPct,
          onInput: (v) => d.previewWaterTint(d.getWaterTint().hue, v / 100),
          onChange: (v) => d.commitWaterTint(d.getWaterTint().hue, v / 100),
          format: num1,
        }).root,
      );
      s.appendChild(
        button(
          t('editor.water.tintReset'),
          () => {
            d.resetWaterTint();
            this.refresh();
          },
          'small',
        ),
      );
    }
    s.appendChild(el('h3', 'ed-subtitle', t('editor.water.waterfallTitle')));
    s.appendChild(
      button(
        t('editor.water.placeWaterfall'),
        () => d.placeWaterfall(),
        'small',
        t('editor.water.placeWaterfallTitle'),
      ),
    );
    s.appendChild(hint(t('editor.water.waterfallHint')));
    this.root.appendChild(s);
  }

  private placePanel(): void {
    const d = this.deps;
    const s = section(t('editor.place.title'));
    const label = d.getPlaceAssetLabel();
    s.appendChild(
      label
        ? el('p', 'ed-chosen', t('editor.place.chosen', { name: label }))
        : hint(t('editor.place.none')),
    );
    s.appendChild(
      slider(t('editor.place.scale'), {
        min: PLACEMENT_SCALE_MIN,
        max: PLACEMENT_SCALE_MAX,
        step: 0.1,
        value: d.getPlaceScale(),
        onInput: (v) => d.setPlaceScale(v),
        format: num1,
      }).root,
    );
    s.appendChild(
      checkbox(t('editor.place.collide'), d.getPlaceCollide(), (on) => d.setPlaceCollide(on)).root,
    );
    s.appendChild(hint(t('editor.place.collideHint')));
    s.appendChild(
      checkbox(t('editor.place.randomRotation'), d.getPlaceRandomRot(), (on) =>
        d.setPlaceRandomRot(on),
      ).root,
    );
    this.root.appendChild(s);
  }

  private campPanel(): void {
    const d = this.deps;
    const s = section(t('editor.camp.title'));
    s.appendChild(hint(t('editor.camp.hint')));
    s.appendChild(hint(t('editor.camp.playtestNote')));
    const camp = d.getSelectedCamp();
    if (!camp) {
      s.appendChild(el('p', 'ed-muted', t('editor.camp.none')));
      this.root.appendChild(s);
      return;
    }
    const mobs = d.mobOptions();
    const chosen = mobs.find((m) => m.id === camp.mobId);
    s.appendChild(
      el('p', 'ed-chosen', t('editor.camp.selected', { mob: chosen?.label ?? camp.mobId })),
    );
    const mobRow = el('label', 'ed-field');
    mobRow.appendChild(el('span', undefined, t('editor.camp.mob')));
    const sel = document.createElement('select');
    for (const m of mobs) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      sel.appendChild(opt);
    }
    sel.value = camp.mobId;
    sel.addEventListener('change', () => {
      d.updateCamp({ mobId: sel.value });
      this.refresh();
    });
    mobRow.appendChild(sel);
    s.appendChild(mobRow);
    s.appendChild(
      slider(t('editor.camp.count'), {
        min: 1,
        max: 8,
        step: 1,
        value: camp.count,
        onInput: () => {},
        onChange: (v) => d.updateCamp({ count: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.camp.radius'), {
        min: 4,
        max: 30,
        step: 1,
        value: camp.radius,
        onInput: () => {},
        onChange: (v) => d.updateCamp({ radius: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      button(
        t('editor.camp.delete'),
        () => {
          d.deleteCamp();
          this.refresh();
        },
        'danger small',
      ),
    );
    this.root.appendChild(s);
  }

  private spawnPanel(): void {
    const d = this.deps;
    const s = section(t('editor.spawn.title'));
    s.appendChild(hint(t('editor.spawn.hint')));
    const spawn = d.getSpawn();
    if (spawn) {
      s.appendChild(
        el('p', 'ed-chosen', t('editor.spawn.position', { x: num1(spawn.x), z: num1(spawn.z) })),
      );
      s.appendChild(
        button(
          t('editor.spawn.clear'),
          () => {
            d.clearSpawn();
            this.refresh();
          },
          'small',
        ),
      );
    } else {
      s.appendChild(el('p', 'ed-muted', t('editor.spawn.unset')));
    }
    this.root.appendChild(s);
  }

  private regionPanel(): void {
    const d = this.deps;
    const s = section(t('editor.region.title'));
    s.appendChild(hint(t('editor.region.hint')));
    if (d.getViewMode() === '3d') s.appendChild(hint(t('editor.region.hint3d')));
    const row = el('div', 'ed-row');
    row.append(
      button(t('editor.region.copy'), () => d.copyRegion()),
      button(t('editor.region.pasteBeside'), () => d.pasteBeside()),
    );
    s.appendChild(row);
    this.root.appendChild(s);
  }

  private erasePanel(): void {
    const s = section(t('editor.eraseTool.title'));
    s.appendChild(hint(t('editor.eraseTool.hint')));
    s.appendChild(hint(t('editor.eraseTool.blockerHint')));
    this.root.appendChild(s);
  }

  private foliagePanel(): void {
    const d = this.deps;
    const f = d.getFoliage();
    const s = section(t('editor.foliageTool.title'));
    s.appendChild(hint(t('editor.foliageTool.hint')));

    // ---- custom brush asset (scatter a chosen asset instead of the groups) ---
    s.appendChild(el('h4', 'ed-sub-title', t('editor.foliageTool.customTitle')));
    const custom = d.getFoliageCustom();
    if (custom) {
      s.appendChild(
        el('p', 'ed-chosen', t('editor.foliageTool.customChosen', { name: custom.label })),
      );
      s.appendChild(
        button(t('editor.foliageTool.customClear'), () => d.clearFoliageCustom(), 'small'),
      );
    } else {
      s.appendChild(hint(t('editor.foliageTool.customHint')));
      s.appendChild(
        button(t('editor.foliageTool.customPick'), () => d.pickFoliageCustom(), 'small'),
      );
    }

    // Group toggles + grass controls only matter for the built-in pool; a custom
    // asset ignores them, so hide them while one is active.
    if (custom) {
      this.foliageSharedControls(s, f);
      this.root.appendChild(s);
      return;
    }

    // Animated grass (the built-in world's tuft cards) + its theme color and
    // clump size. The swatch previews the blade color BEFORE painting.
    s.appendChild(
      checkbox(t('editor.foliageTool.grass'), f.grass, (on) => {
        d.setFoliage({ grass: on });
        this.refresh(); // the grass controls appear/disappear with the checkbox
      }).root,
    );
    if (f.grass) {
      const swatch = el('div', 'ed-grass-swatch');
      swatch.title = t('editor.foliageTool.grassPreview');
      const paintSwatch = (): void => {
        const cur = d.getFoliage();
        // Matches the renderer's tint: setHSL(hue, 0.55, light).
        swatch.style.background = `hsl(${Math.round(cur.grassHue)}, 55%, ${Math.round(cur.grassLight)}%)`;
      };
      paintSwatch();
      s.appendChild(
        slider(t('editor.foliageTool.grassHue'), {
          min: 0,
          max: 360,
          step: 1,
          value: f.grassHue,
          onInput: (v) => {
            d.setFoliage({ grassHue: v });
            paintSwatch();
          },
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.foliageTool.grassLight'), {
          min: 15,
          max: 90,
          step: 1,
          value: f.grassLight,
          onInput: (v) => {
            d.setFoliage({ grassLight: v });
            paintSwatch();
          },
          format: num1,
        }).root,
      );
      s.appendChild(swatch);
      s.appendChild(
        slider(t('editor.foliageTool.grassClump'), {
          min: 1,
          max: 40,
          step: 1,
          value: f.grassClump,
          onInput: (v) => d.setFoliage({ grassClump: v }),
          format: num1,
        }).root,
      );
    }
    for (const group of ['ferns', 'bushes', 'trees', 'rocks'] as const) {
      s.appendChild(
        checkbox(t(`editor.foliageTool.${group}` as Parameters<typeof t>[0]), f[group], (on) =>
          d.setFoliage({ [group]: on }),
        ).root,
      );
    }
    this.foliageSharedControls(s, f);
    this.root.appendChild(s);
  }

  /** Density / scale / collide controls shared by the built-in and custom
   *  foliage brush (a custom asset ignores the group toggles, not these). */
  private foliageSharedControls(s: HTMLElement, f: ReturnType<InspectorDeps['getFoliage']>): void {
    const d = this.deps;
    s.appendChild(
      slider(t('editor.foliageTool.density'), {
        min: 1,
        max: 10,
        step: 1,
        value: f.density,
        onInput: (v) => d.setFoliage({ density: v }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.foliageTool.minScale'), {
        min: 0.2,
        max: 50,
        step: 0.1,
        value: f.minScale,
        onInput: (v) => d.setFoliage({ minScale: Math.min(v, d.getFoliage().maxScale) }),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.foliageTool.maxScale'), {
        min: 0.2,
        max: 50,
        step: 0.1,
        value: f.maxScale,
        onInput: (v) => d.setFoliage({ maxScale: Math.max(v, d.getFoliage().minScale) }),
        format: num1,
      }).root,
    );
    s.appendChild(
      checkbox(t('editor.foliageTool.collide'), f.collide, (on) => d.setFoliage({ collide: on }))
        .root,
    );
  }

  private blockerPanel(): void {
    const d = this.deps;
    const s = section(t('editor.blockerTool.title'));
    s.appendChild(hint(t('editor.blockerTool.hint')));
    const stats = d.getBlockerStats();
    s.appendChild(
      hint(
        t('editor.blockerTool.count', {
          count: formatNumber(stats.count, { useGrouping: false }),
          max: formatNumber(stats.max, { useGrouping: false }),
        }),
      ),
    );
    this.root.appendChild(s);
  }

  private colliderPanel(): void {
    const d = this.deps;
    const s = section(t('editor.collider.title'));
    s.appendChild(hint(t('editor.collider.hint')));
    const pal = el('div', 'ed-biomes');
    pal.setAttribute('role', 'radiogroup');
    pal.setAttribute('aria-label', t('editor.collider.shapeLabel'));
    const shapes: ColliderVolumeKind[] = ['box', 'sphere', 'plane', 'wall'];
    for (const kind of shapes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-biome';
      b.setAttribute('role', 'radio');
      const active = d.getColliderShape() === kind;
      b.setAttribute('aria-checked', active ? 'true' : 'false');
      b.classList.toggle('active', active);
      const sw = el('span', 'ed-biome-swatch');
      sw.style.background = '#3ddc6a';
      b.append(sw, el('span', undefined, t(`editor.collider.${kind}` as Parameters<typeof t>[0])));
      b.addEventListener('click', () => {
        d.setColliderShape(kind);
        this.refresh();
      });
      pal.appendChild(b);
    }
    s.appendChild(pal);
    s.appendChild(hint(t('editor.collider.playtestNote')));
    s.appendChild(
      checkbox(t('editor.collider.hideVolumes'), d.getCollidersHidden(), (on) =>
        d.setCollidersHidden(on),
      ).root,
    );
    s.appendChild(hint(t('editor.collider.hideVolumesHint')));
    this.root.appendChild(s);
  }

  /** Per-axis dimension sliders for a selected collider volume. */
  /** Fluid tool: pick the pool preset to stamp; click ground to place. */
  private fluidToolPanel(): void {
    const d = this.deps;
    const s = section(t('editor.fluid.title'));
    s.appendChild(hint(t('editor.fluid.hint')));
    const kinds: FluidKind[] = ['lava', 'acid', 'spectral', 'water'];
    for (const kind of kinds) {
      const preset = FLUID_PRESETS[kind];
      const row = checkbox(
        t(`editor.fluid.kind.${kind}` as Parameters<typeof t>[0]),
        d.getFluidKind() === kind,
        () => {
          d.setFluidKind(kind);
          this.refresh();
        },
      );
      const sw = el('span', 'ed-swatch');
      sw.style.background = `hsl(${preset.hue}, 70%, ${Math.round(preset.lum * 100)}%)`;
      row.root.appendChild(sw);
      s.appendChild(row.root);
    }
    this.root.appendChild(s);
  }

  /** Selected fluid pool: tint, surface offset, damage, effect toggles. */
  private fluidControls(s: HTMLElement, sel: PlacementSelection): void {
    const d = this.deps;
    const kind = sel.fluidKind as FluidKind;
    const preset = FLUID_PRESETS[kind];
    const hue = sel.hue ?? preset.hue;
    const lumPct = Math.round((sel.lum ?? preset.lum) * 100);
    const swatch = el('span', 'ed-swatch');
    const paint = (h: number, lp: number): void => {
      swatch.style.background = `hsl(${Math.round(h)}, 70%, ${Math.round(lp)}%)`;
    };
    paint(hue, lumPct);
    s.appendChild(swatch);
    s.appendChild(
      slider(t('editor.fluid.hue'), {
        min: 0,
        max: 360,
        step: 1,
        value: hue,
        onInput: (v) => {
          d.updateSelection({ hue: v }, false);
          paint(v, lumPct);
        },
        onChange: (v) => d.updateSelection({ hue: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.fluid.light'), {
        min: 8,
        max: 90,
        step: 1,
        value: lumPct,
        onInput: (v) => {
          d.updateSelection({ lum: v / 100 }, false);
          paint(sel.hue ?? preset.hue, v);
        },
        onChange: (v) => d.updateSelection({ lum: v / 100 }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.fluid.dps'), {
        min: 0,
        max: 50,
        step: 0.5,
        value: sel.fluidDps ?? preset.dps,
        onInput: (v) => d.updateSelection({ fluidDps: v }, false),
        onChange: (v) => d.updateSelection({ fluidDps: v }, true),
        format: num1,
      }).root,
    );
    s.appendChild(
      slider(t('editor.fluid.surfaceOffset'), {
        min: -20,
        max: 20,
        step: 0.1,
        value: sel.sizeY ?? 0.3,
        onInput: (v) => d.updateSelection({ sizeY: v }, false),
        onChange: (v) => d.updateSelection({ sizeY: v }, true),
        format: num1,
      }).root,
    );
    const fx = sel.fluidFx ?? preset.fx;
    const fxToggle = (labelKey: string, bit: number): void => {
      s.appendChild(
        checkbox(t(labelKey as Parameters<typeof t>[0]), (fx & bit) !== 0, (on) => {
          d.updateSelection({ fluidFx: on ? fx | bit : fx & ~bit }, true);
          this.refresh();
        }).root,
      );
    };
    fxToggle('editor.fluid.fxBubbles', 1);
    fxToggle('editor.fluid.fxSmoke', 2);
    fxToggle('editor.fluid.fxHaze', 4);
    fxToggle('editor.fluid.fxLight', 8);
    s.appendChild(
      button(
        t('editor.fluid.resetPreset'),
        () => {
          d.updateSelection({ hue: null, lum: null, fluidDps: null, fluidFx: null }, true);
          this.refresh();
        },
        'small',
      ),
    );
    s.appendChild(hint(t('editor.fluid.selHint')));
  }

  private colliderSizeControls(s: HTMLElement, sel: PlacementSelection): void {
    const d = this.deps;
    const kind = sel.colliderKind;
    if (!kind) return;
    const defs = COLLIDER_DEFAULT_SIZE[kind];
    const dim = (
      labelKey: string,
      value: number,
      axis: 'sizeX' | 'sizeY' | 'sizeZ',
      min: number,
      max: number,
    ): void => {
      s.appendChild(
        slider(t(labelKey as Parameters<typeof t>[0]), {
          min,
          max,
          step: 0.5,
          value,
          onInput: (v) => d.updateSelection({ [axis]: v }, false),
          onChange: (v) => d.updateSelection({ [axis]: v }, true),
          format: num1,
        }).root,
      );
    };
    if (kind === 'box') {
      dim('editor.collider.width', sel.sizeX ?? defs.x, 'sizeX', 0.5, 60);
      dim('editor.collider.height', sel.sizeY ?? defs.y, 'sizeY', 0.5, 30);
      dim('editor.collider.depth', sel.sizeZ ?? defs.z, 'sizeZ', 0.5, 60);
    } else if (kind === 'wall') {
      // A wall is a thin standing box: long, tall, and barely thick.
      dim('editor.collider.width', sel.sizeX ?? defs.x, 'sizeX', 0.5, 120);
      dim('editor.collider.height', sel.sizeY ?? defs.y, 'sizeY', 0.5, 100);
      dim('editor.collider.depth', sel.sizeZ ?? defs.z, 'sizeZ', 0.2, 10);
    } else if (kind === 'sphere') {
      dim('editor.collider.diameter', sel.sizeX ?? defs.x, 'sizeX', 0.5, 60);
    } else {
      dim('editor.collider.width', sel.sizeX ?? defs.x, 'sizeX', 0.5, 120);
      dim('editor.collider.depth', sel.sizeZ ?? defs.z, 'sizeZ', 0.5, 120);
      dim('editor.collider.floorOffset', sel.sizeY ?? defs.y, 'sizeY', -20, 40);
    }
    s.appendChild(hint(t('editor.collider.sizeHint')));
  }

  private transformPanel(tool: 'move' | 'rotate' | 'scale'): void {
    const s = section(t(`editor.tool.${tool}` as Parameters<typeof t>[0]));
    const hintKey =
      tool === 'move'
        ? 'editor.transform.moveHint'
        : tool === 'rotate'
          ? 'editor.transform.rotateHint'
          : 'editor.transform.scaleHint';
    s.appendChild(hint(t(hintKey as Parameters<typeof t>[0])));
    if (!this.deps.getSelection()) s.appendChild(hint(t('editor.transform.pickHint')));
    this.root.appendChild(s);
  }

  private selectPanel(): void {
    const d = this.deps;
    const sel = d.getSelection();
    const s = section(t('editor.selection.title'));
    if (sel) {
      const count = d.getSelectionCount();
      if (count > 1) {
        s.appendChild(
          el(
            'p',
            'ed-chosen',
            t('editor.selection.multiCount', {
              count: formatNumber(count, { useGrouping: false }),
            }),
          ),
        );
        s.appendChild(hint(t('editor.selection.multiHint')));
      }
      s.appendChild(el('p', 'ed-chosen', t('editor.selection.asset', { name: sel.assetLabel })));
      s.appendChild(
        this.coordField(t('editor.selection.x'), sel.x, (v) => {
          d.updateSelection({ x: v }, true);
        }),
      );
      s.appendChild(
        this.coordField(t('editor.selection.y'), sel.y ?? 0, (v) => {
          d.updateSelection({ y: v }, true);
        }),
      );
      s.appendChild(
        this.coordField(t('editor.selection.z'), sel.z, (v) => {
          d.updateSelection({ z: v }, true);
        }),
      );
      s.appendChild(
        slider(t('editor.selection.rotation'), {
          min: 0,
          max: 360,
          step: 1,
          value: Math.round(
            (((sel.rotY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI),
          ),
          onInput: (v) => d.updateSelection({ rotY: (v * Math.PI) / 180 }, false),
          onChange: (v) => d.updateSelection({ rotY: (v * Math.PI) / 180 }, true),
          format: num1,
        }).root,
      );
      s.appendChild(
        slider(t('editor.selection.scale'), {
          min: PLACEMENT_SCALE_MIN,
          max: PLACEMENT_SCALE_MAX,
          step: 0.1,
          value: sel.scale,
          onInput: (v) => d.updateSelection({ scale: v }, false),
          onChange: (v) => d.updateSelection({ scale: v }, true),
          format: num1,
        }).root,
      );
      // "Scale all copies": roll a random scale in [min, max] onto every
      // placement of this asset (min==max = uniform). Only when copies exist.
      if (sel.sameAssetCount > 0) {
        const range = d.getCloneScaleRange();
        s.appendChild(el('h4', 'ed-sub-title', t('editor.selection.scaleAllTitle')));
        s.appendChild(
          slider(t('editor.selection.scaleMin'), {
            min: PLACEMENT_SCALE_MIN,
            max: PLACEMENT_SCALE_MAX,
            step: 0.1,
            value: range.min,
            onInput: (v) => d.setCloneScaleRange({ min: v }),
            onChange: (v) => d.setCloneScaleRange({ min: v }),
            format: num1,
          }).root,
        );
        s.appendChild(
          slider(t('editor.selection.scaleMax'), {
            min: PLACEMENT_SCALE_MIN,
            max: PLACEMENT_SCALE_MAX,
            step: 0.1,
            value: range.max,
            onInput: (v) => d.setCloneScaleRange({ max: v }),
            onChange: (v) => d.setCloneScaleRange({ max: v }),
            format: num1,
          }).root,
        );
        s.appendChild(
          button(
            t('editor.selection.scaleAllButton', {
              name: sel.assetLabel,
              count: formatNumber(sel.sameAssetCount + 1, { useGrouping: false }),
            }),
            () => d.scaleAllSameAsset(),
          ),
        );
        s.appendChild(hint(t('editor.selection.scaleAllHint', { name: sel.assetLabel })));
      }
      if (sel.fluidKind) {
        // Fluid pools: footprint + surface offset + tint/damage/effects.
        this.fluidControls(s, sel);
      } else if (sel.assetId === ROCK_ASSET_ID) {
        this.rockControls(s, sel);
      } else if (sel.colliderKind) {
        // Collider volumes: per-axis dimensions instead of the circle-footprint
        // controls (their collision IS the volume; collide stays on).
        this.colliderSizeControls(s, sel);
      } else {
        this.collisionControls(s, sel);
      }
      // Appearance (shader tweaks): tint / opacity / glow, saved on the map.
      if (!sel.colliderKind) {
        s.appendChild(el('h4', 'ed-sub-title', t('editor.appearance.title')));
        s.appendChild(
          this.colorInput(t('editor.appearance.tint'), sel.tint ?? 0xffffff, (hex) =>
            d.updateSelection({ tint: hex === 0xffffff ? null : hex }, true),
          ),
        );
        s.appendChild(
          slider(t('editor.appearance.opacity'), {
            min: 10,
            max: 100,
            step: 5,
            value: Math.round((sel.opacity ?? 1) * 100),
            onInput: (v) => d.updateSelection({ opacity: v >= 100 ? null : v / 100 }, false),
            onChange: (v) => d.updateSelection({ opacity: v >= 100 ? null : v / 100 }, true),
            format: num1,
          }).root,
        );
        s.appendChild(
          this.colorInput(t('editor.appearance.glow'), sel.glow ?? 0x000000, (hex) =>
            d.updateSelection({ glow: hex === 0 ? null : hex }, true),
          ),
        );
        s.appendChild(
          slider(t('editor.appearance.glowStrength'), {
            min: 0,
            max: 8,
            step: 0.1,
            value: sel.glowStrength ?? 1,
            onInput: (v) => d.updateSelection({ glowStrength: v }, false),
            onChange: (v) => d.updateSelection({ glowStrength: v }, true),
            format: num1,
          }).root,
        );
        s.appendChild(
          checkbox(t('editor.appearance.fire'), sel.fire, (on) =>
            d.updateSelection({ fire: on ? true : null }, true),
          ).root,
        );
        s.appendChild(
          button(
            t('editor.appearance.reset'),
            () => {
              d.updateSelection(
                { tint: null, opacity: null, glow: null, glowStrength: null, fire: null },
                true,
              );
              this.refresh();
            },
            'small',
          ),
        );
        s.appendChild(hint(t('editor.appearance.hint')));
      }
      const row = el('div', 'ed-row');
      row.append(
        button(t('editor.selection.duplicate'), () => d.duplicateSelection()),
        button(t('editor.selection.delete'), () => d.deleteSelection(), 'danger'),
      );
      s.appendChild(row);
      // Teach the direct-manipulation paths (drag-move, wheel, nudge keys).
      s.appendChild(hint(t('editor.selection.moveHint')));
      s.appendChild(hint(t('editor.selection.wheelHint')));
      s.appendChild(hint(t('editor.selection.deleteHint')));
    } else {
      const marker = d.getMarkerSelection();
      if (marker) {
        s.appendChild(el('p', 'ed-chosen', marker.label));
        s.appendChild(
          this.coordField(t('editor.selection.x'), marker.x, (v) => d.updateMarker('x', v)),
        );
        s.appendChild(
          this.coordField(t('editor.selection.z'), marker.z, (v) => d.updateMarker('z', v)),
        );
        s.appendChild(
          button(
            t('editor.marker.reset'),
            () => {
              d.resetMarker();
              this.refresh();
            },
            'small',
          ),
        );
      } else {
        s.appendChild(el('p', 'ed-muted', t('editor.selection.none')));
      }
    }
    s.appendChild(
      checkbox(t('editor.selection.footprints'), d.getFootprints(), (on) => d.setFootprints(on))
        .root,
    );
    this.root.appendChild(s);
  }

  /** Collision block for ordinary model placements: the type dropdown plus
   *  the picked mode's controls (baked hitbox editing / basic radius / true
   *  mesh status). */
  private collisionControls(s: HTMLElement, sel: PlacementSelection): void {
    const d = this.deps;
    s.appendChild(el('h4', 'ed-sub-title', t('editor.selection.collisionTitle')));
    s.appendChild(
      selectRow(
        t('editor.selection.collisionType'),
        [
          { value: 'baked', label: t('editor.selection.collisionTypeBaked') },
          { value: 'basic', label: t('editor.selection.collisionTypeBasic') },
          { value: 'mesh', label: t('editor.selection.collisionTypeMesh') },
          { value: 'none', label: t('editor.selection.collisionTypeNone') },
        ],
        sel.collisionMode,
        (v) => {
          d.updateSelection({ collisionMode: v as CollisionMode }, true);
          this.refresh();
        },
      ).root,
    );
    if (sel.collisionMode === 'basic') {
      s.appendChild(
        slider(t('editor.selection.radius'), {
          min: MIN_COLLIDE_RADIUS,
          max: MAX_COLLIDE_RADIUS,
          step: 0.1,
          value: sel.collideRadius ?? collideRadiusFor(sel.scale, sel.assetId),
          onInput: (v) => d.updateSelection({ collideRadius: v }, false),
          onChange: (v) => d.updateSelection({ collideRadius: v }, true),
          format: num1,
        }).root,
      );
      s.appendChild(
        checkbox(t('editor.selection.squareCollision'), sel.collideShape === 'square', (on) =>
          d.updateSelection({ collideShape: on ? 'square' : null }, true),
        ).root,
      );
      s.appendChild(
        button(
          t('editor.selection.radiusAuto'),
          () => {
            d.updateSelection({ collideRadius: null }, true);
            this.refresh();
          },
          'small',
          t('editor.selection.radiusAutoTitle'),
        ),
      );
      s.appendChild(hint(t('editor.selection.radiusHint')));
    } else if (sel.collisionMode === 'baked') {
      const he = d.getHitboxEdit();
      s.appendChild(
        hint(
          sel.hasHitboxEdits
            ? t('editor.selection.collisionEdited', {
                count: formatNumber(sel.hitboxCount, { useGrouping: false }),
              })
            : t('editor.selection.collisionBaked', {
                count: formatNumber(sel.hitboxCount, { useGrouping: false }),
              }),
        ),
      );
      if (!he) {
        s.appendChild(
          button(t('editor.selection.hitboxEdit'), () => {
            d.enterHitboxEdit();
            this.refresh();
          }),
        );
      } else {
        s.appendChild(
          hint(
            t('editor.selection.hitboxSelected', {
              count: formatNumber(he.selectedCount, { useGrouping: false }),
            }),
          ),
        );
        const row = el('div', 'ed-row');
        row.append(
          button(t('editor.selection.hitboxAdd'), () => {
            d.addHitbox();
            this.refresh();
          }),
          button(
            t('editor.selection.hitboxDelete'),
            () => {
              d.deleteSelectedHitboxes();
              this.refresh();
            },
            'danger',
          ),
        );
        s.appendChild(row);
        s.appendChild(
          button(t('editor.selection.hitboxDone'), () => {
            d.exitHitboxEdit();
            this.refresh();
          }),
        );
        s.appendChild(hint(t('editor.selection.hitboxHint')));
      }
      if (sel.hasHitboxEdits) {
        const row = el('div', 'ed-row');
        row.append(
          button(t('editor.selection.hitboxReset'), () => {
            d.resetHitboxes();
            this.refresh();
          }),
          button(
            t('editor.selection.hitboxSavePreset'),
            () => {
              d.saveHitboxPreset();
              this.refresh();
            },
            undefined,
            t('editor.selection.hitboxPresetHint'),
          ),
        );
        s.appendChild(row);
      }
      if (sel.hasHitboxPreset) {
        s.appendChild(
          button(t('editor.selection.hitboxClearPreset'), () => {
            d.clearHitboxPreset();
            this.refresh();
          }),
        );
        s.appendChild(hint(t('editor.selection.hitboxPresetHint')));
      }
    } else if (sel.collisionMode === 'mesh') {
      s.appendChild(
        hint(
          sel.meshBakePending
            ? t('editor.selection.meshBaking')
            : sel.meshBakeReady
              ? t('editor.selection.meshReady')
              : t('editor.selection.meshHint'),
        ),
      );
    }
    // Bottom of the menu: copy this placement's whole collision setup onto every
    // other placement of the same asset on the map (confirmed in the app layer).
    if (sel.sameAssetCount > 0) {
      s.appendChild(
        button(
          t('editor.selection.collisionCopyAll', {
            name: sel.assetLabel,
            count: formatNumber(sel.sameAssetCount, { useGrouping: false }),
          }),
          () => d.copyCollisionToSameAsset(),
        ),
      );
      s.appendChild(hint(t('editor.selection.collisionCopyAllHint', { name: sel.assetLabel })));
    }
  }

  private layersPanel(): void {
    const d = this.deps;
    const s = section(t('editor.layers.title'));
    const list = el('div', 'ed-layers');
    for (const layer of d.layers()) {
      list.appendChild(
        checkbox(layer.label, layer.visible, (on) => d.toggleLayer(layer.kind, on)).root,
      );
    }
    s.appendChild(list);
    const frame = section(t('editor.frame.title'));
    const row = el('div', 'ed-row ed-wrap');
    row.appendChild(button(t('editor.frame.all'), () => d.frameAll(), 'small'));
    for (const z of d.zones()) {
      row.appendChild(button(z.name, () => d.frameZone(z.id), 'small'));
    }
    frame.appendChild(row);
    this.root.appendChild(s);
    this.root.appendChild(frame);
  }

  private procgenPanel(): void {
    const d = this.deps;
    const s = section(t('editor.procgen.title'));
    s.appendChild(
      slider(t('editor.procgen.count'), {
        min: 10,
        max: 400,
        step: 10,
        value: d.getScatterCount(),
        onInput: (v) => d.setScatterCount(v),
        format: num1,
      }).root,
    );
    const row = el('div', 'ed-row ed-wrap');
    row.append(
      button(t('editor.procgen.scatter'), () => d.runScatter(), 'small'),
      button(t('editor.procgen.hills'), () => d.runHills(), 'small'),
    );
    s.appendChild(row);
    this.root.appendChild(s);
  }

  private lightingPanel(): void {
    const d = this.deps;
    const L = d.getLighting();
    const p = L.profile;
    const s = section(t('editor.lighting.title'));
    const row = el('div', 'ed-row ed-wrap');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('editor.lighting.presetLabel'));
    const presets = ['day', 'overcast', 'dusk', 'night'] as const;
    for (const key of presets) {
      const b = button(
        t(`editor.lighting.${key}` as Parameters<typeof t>[0]),
        () => {
          d.setLightingPreset(key);
          this.refresh();
        },
        L.preset === key ? 'small active' : 'small',
      );
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', L.preset === key ? 'true' : 'false');
      row.appendChild(b);
    }
    s.appendChild(row);
    if (L.preset === 'custom') s.appendChild(hint(t('editor.lighting.customHint')));
    const live = (
      labelKey: string,
      value: number,
      min: number,
      max: number,
      step: number,
      apply: (v: number) => Partial<EditorLightingProfile>,
    ): void => {
      s.appendChild(
        slider(t(labelKey as Parameters<typeof t>[0]), {
          min,
          max,
          step,
          value,
          onInput: (v) => d.updateLighting(apply(v)),
          onChange: () => this.refresh(), // the preset chips flip to Custom
          format: num1,
        }).root,
      );
    };
    live('editor.lighting.sun', p.sunIntensity, 0, 6, 0.1, (v) => ({ sunIntensity: v }));
    live('editor.lighting.ambient', p.hemiIntensity, 0, 2, 0.05, (v) => ({ hemiIntensity: v }));
    live('editor.lighting.environment', p.envScale, 0, 2, 0.05, (v) => ({ envScale: v }));
    live('editor.lighting.azimuth', p.sunAzimuthDeg, 0, 360, 5, (v) => ({ sunAzimuthDeg: v }));
    live('editor.lighting.elevation', p.sunElevationDeg, 5, 85, 1, (v) => ({
      sunElevationDeg: v,
    }));
    s.appendChild(
      this.colorInput(t('editor.lighting.sunColor'), p.sunColor, (hex) =>
        d.updateLighting({ sunColor: hex }),
      ),
    );
    s.appendChild(
      this.colorInput(t('editor.lighting.skyColor'), p.skyColor, (hex) =>
        d.updateLighting({ skyColor: hex }),
      ),
    );
    s.appendChild(hint(t('editor.lighting.hint')));

    // ---- skybox (procedural sky, a bundled CC0 image, or an uploaded one) ----
    s.appendChild(el('h4', 'ed-sub-title', t('editor.lighting.skyboxTitle')));
    const active = d.getSkybox();
    const skyRow = el('div', 'ed-row ed-wrap');
    const skyChip = (label: string, value: string | null, title?: string): void => {
      const b = button(
        label,
        () => {
          d.setSkybox(value);
          this.refresh();
        },
        'small',
        title,
      );
      if (active === value) b.classList.add('active');
      skyRow.appendChild(b);
    };
    skyChip(t('editor.lighting.skyboxDefault'), null);
    for (const sky of BUILTIN_SKYBOXES) {
      skyChip(
        t(`editor.lighting.skybox_${sky.id}` as Parameters<typeof t>[0]),
        `builtin:${sky.id}`,
      );
    }
    s.appendChild(skyRow);
    if (active?.startsWith('custom:')) {
      s.appendChild(el('p', 'ed-chosen', t('editor.lighting.skyboxCustomActive')));
    }
    s.appendChild(button(t('editor.lighting.skyboxUpload'), () => d.importSkybox(), 'small'));
    s.appendChild(hint(t('editor.lighting.skyboxHint')));

    // ---- birds ----------------------------------------------------------------
    s.appendChild(el('h4', 'ed-sub-title', t('editor.lighting.birdsTitle')));
    const birds = d.getBirds();
    s.appendChild(
      checkbox(t('editor.lighting.birds'), birds.enabled, (on) => {
        d.setBirds({ enabled: on });
        this.refresh(); // the sliders appear/disappear with the checkbox
      }).root,
    );
    if (birds.enabled) {
      s.appendChild(
        slider(t('editor.lighting.birdCount'), {
          min: 2,
          max: 40,
          step: 1,
          value: birds.count,
          onInput: (v) => d.setBirds({ count: v }),
          format: num1,
        }).root,
      );
      s.appendChild(
        checkbox(t('editor.lighting.birdFormation'), birds.formation, (on) =>
          d.setBirds({ formation: on }),
        ).root,
      );
    }
    this.weatherControls(s);
    this.worldSpeedControls(s);
    this.root.appendChild(s);
  }

  /** Ambience "world speed": one cosmetic-motion multiplier (below weather). */
  private worldSpeedControls(s: HTMLElement): void {
    const d = this.deps;
    s.appendChild(el('h3', 'ed-subtitle', t('editor.lighting.worldSpeedTitle')));
    const speed = d.getWorldSpeed();
    s.appendChild(
      slider(t('editor.lighting.worldSpeed'), {
        min: 0.25,
        max: 2,
        step: 0.05,
        value: speed,
        onInput: (v) => d.setWorldSpeed(v),
        onChange: () => this.refresh(),
        format: (v) => `${num1(v)}x`,
      }).root,
    );
    s.appendChild(hint(t('editor.lighting.worldSpeedHint')));
    if (Math.abs(speed - 1) > 0.001) {
      s.appendChild(
        button(
          t('editor.lighting.worldSpeedReset'),
          () => {
            d.setWorldSpeed(1);
            this.refresh();
          },
          'small',
        ),
      );
    }
  }

  /** Map weather: fixed mode / intensity / cloud deck / timed schedule. */
  private weatherControls(s: HTMLElement): void {
    const d = this.deps;
    const w = d.getWeather();
    const hasSchedule = w.schedule.length > 0;
    s.appendChild(el('h3', 'ed-subtitle', t('editor.weather.title')));
    // Fixed mode radio row (dimmed by a live schedule, which wins).
    const modes: { key: 'auto' | 'clear' | 'rain' | 'snow' | 'sparkle'; label: string }[] = [
      { key: 'auto', label: t('editor.weather.auto') },
      { key: 'clear', label: t('editor.weather.clear') },
      { key: 'rain', label: t('editor.weather.rain') },
      { key: 'snow', label: t('editor.weather.snow') },
      { key: 'sparkle', label: t('editor.weather.sparkle') },
    ];
    const row = el('div', 'ed-row ed-weather-modes');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', t('editor.weather.title'));
    for (const m of modes) {
      const b = button(
        m.label,
        () => {
          d.setWeather({ ...w, mode: m.key });
          this.refresh();
        },
        'small',
      );
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', w.mode === m.key ? 'true' : 'false');
      b.classList.toggle('active', w.mode === m.key);
      if (hasSchedule) b.disabled = true;
      row.appendChild(b);
    }
    s.appendChild(row);
    if (hasSchedule) s.appendChild(hint(t('editor.weather.scheduleWins')));
    s.appendChild(
      slider(t('editor.weather.intensity'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(w.intensity * 100),
        onInput: (v) => d.setWeather({ ...w, intensity: v / 100 }),
        format: num1,
      }).root,
    );
    // Cloud deck.
    s.appendChild(
      slider(t('editor.weather.cloudCover'), {
        min: 0,
        max: 100,
        step: 5,
        value: Math.round(w.clouds.coverage * 100),
        onInput: (v) => d.setWeather({ ...w, clouds: { ...w.clouds, coverage: v / 100 } }),
        format: num1,
      }).root,
    );
    if (w.clouds.coverage > 0) {
      s.appendChild(
        slider(t('editor.weather.cloudHeight'), {
          min: 0,
          max: 160,
          step: 2,
          value: w.clouds.height,
          onInput: (v) => d.setWeather({ ...w, clouds: { ...w.clouds, height: v } }),
          format: num1,
        }).root,
      );
      s.appendChild(hint(t('editor.weather.cloudHint')));
    }
    // Dynamic schedule.
    s.appendChild(el('h3', 'ed-subtitle', t('editor.weather.scheduleTitle')));
    w.schedule.forEach((step, i) => {
      const r = el('div', 'ed-row');
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', t('editor.weather.stepMode'));
      for (const m of modes) {
        if (m.key === 'auto') continue;
        const opt = document.createElement('option');
        opt.value = m.key;
        opt.textContent = m.label;
        opt.selected = step.mode === m.key;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        const schedule = w.schedule.map((st, j) =>
          j === i ? { ...st, mode: sel.value as typeof step.mode } : st,
        );
        d.setWeather({ ...w, schedule });
        this.refresh();
      });
      const mins = document.createElement('input');
      mins.type = 'number';
      mins.min = '0.5';
      mins.max = '120';
      mins.step = '0.5';
      mins.value = String(step.minutes);
      mins.setAttribute('aria-label', t('editor.weather.stepMinutes'));
      mins.addEventListener('keydown', (ev) => ev.stopPropagation());
      mins.addEventListener('change', () => {
        const v = Number(mins.value);
        if (!Number.isFinite(v)) return;
        const schedule = w.schedule.map((st, j) =>
          j === i ? { ...st, minutes: Math.min(120, Math.max(0.5, v)) } : st,
        );
        d.setWeather({ ...w, schedule });
      });
      r.append(
        sel,
        mins,
        el('span', 'ed-muted', t('editor.weather.minutesShort')),
        button(
          'x',
          () => {
            const schedule = w.schedule.filter((_, j) => j !== i);
            d.setWeather({ ...w, schedule });
            this.refresh();
          },
          'danger small',
          t('editor.weather.removeStep'),
        ),
      );
      s.appendChild(r);
    });
    s.appendChild(
      button(
        t('editor.weather.addStep'),
        () => {
          const schedule = [...w.schedule, { mode: 'rain' as const, minutes: 5 }];
          d.setWeather({ ...w, schedule });
          this.refresh();
        },
        'small',
        t('editor.weather.addStepTitle'),
      ),
    );
    s.appendChild(hint(t('editor.weather.scheduleHint')));
  }

  private colorInput(label: string, value: number, onChange: (hex: number) => void): HTMLElement {
    const row = el('label', 'ed-field');
    row.appendChild(el('span', undefined, label));
    const input = document.createElement('input');
    input.type = 'color';
    input.value = `#${value.toString(16).padStart(6, '0')}`;
    input.addEventListener('input', () => {
      const v = Number.parseInt(input.value.slice(1), 16);
      if (Number.isFinite(v)) onChange(v);
    });
    input.addEventListener('change', () => this.refresh());
    row.appendChild(input);
    return row;
  }

  private cameraPanel(): void {
    const d = this.deps;
    const s = section(t('editor.camera.title'));
    s.appendChild(
      button(
        t('editor.camera.focus'),
        () => d.focusSelection(),
        'small',
        t('editor.camera.focusTitle'),
      ),
    );
    s.appendChild(
      checkbox(t('editor.camera.freeFly'), d.getFreeFly(), (on) => d.setFreeFly(on)).root,
    );
    if (d.getFreeFly()) s.appendChild(hint(t('editor.camera.freeFlyHint')));
    s.appendChild(
      checkbox(t('editor.camera.invertPan'), d.getInvertPan(), (on) => d.setInvertPan(on)).root,
    );
    s.appendChild(
      checkbox(t('editor.camera.showPlayer'), d.getShowPlayer(), (on) => d.setShowPlayer(on)).root,
    );
    // View toggles (overlay visibility only; collision never changes).
    s.appendChild(
      checkbox(t('editor.camera.showBoundary'), d.getShowBoundaryWalls(), (on) =>
        d.setShowBoundaryWalls(on),
      ).root,
    );
    s.appendChild(
      checkbox(t('editor.camera.wireframe'), d.getWireframe(), (on) => d.setWireframe(on)).root,
    );
    // Collision hitbox overlay (ON by default; persisted per maker).
    s.appendChild(
      checkbox(t('editor.selection.footprints'), d.getFootprints(), (on) => d.setFootprints(on))
        .root,
    );

    // ---- movement speeds ----------------------------------------------------
    s.appendChild(el('h4', 'ed-sub-title', t('editor.camera.speedTitle')));
    const speeds = d.getCameraSpeeds();
    const speedSlider = (labelKey: string, value: number, apply: (v: number) => void): void => {
      s.appendChild(
        slider(t(labelKey as Parameters<typeof t>[0]), {
          min: 0.1,
          max: 4,
          step: 0.1,
          value,
          onInput: apply,
          format: (v) => `${num1(v)}x`,
        }).root,
      );
    };
    speedSlider('editor.camera.moveSpeed', speeds.move, (v) => d.setCameraSpeeds({ move: v }));
    speedSlider('editor.camera.lookSpeed', speeds.look, (v) => d.setCameraSpeeds({ look: v }));
    speedSlider('editor.camera.panSpeed', speeds.pan, (v) => d.setCameraSpeeds({ pan: v }));
    s.appendChild(hint(t('editor.camera.speedHint')));
    s.appendChild(
      button(
        t('editor.camera.resetSpeeds'),
        () => {
          d.setCameraSpeeds({ move: 1, look: 1, pan: 1 });
          this.refresh();
        },
        'small',
      ),
    );

    // ---- placed-asset view distance (LOD) -----------------------------------
    s.appendChild(el('h4', 'ed-sub-title', t('editor.camera.assetViewTitle')));
    s.appendChild(
      slider(t('editor.camera.assetViewDistance'), {
        min: 120,
        max: 2000,
        step: 20,
        value: d.getAssetViewDistance(),
        onInput: (v) => d.setAssetViewDistance(v),
        format: (v) => (v >= 2000 ? t('editor.camera.assetViewMax') : `${num1(v)} yd`),
      }).root,
    );
    s.appendChild(hint(t('editor.camera.assetViewHint')));

    // ---- performance overlay ------------------------------------------------
    s.appendChild(el('h4', 'ed-sub-title', t('editor.camera.perfTitle')));
    const perf = d.getPerfOverlay();
    s.appendChild(
      checkbox(t('editor.camera.perfShow'), perf.enabled, (on) => {
        d.setPerfOverlay({ enabled: on });
        this.refresh(); // the field toggles appear/disappear with the overlay
      }).root,
    );
    if (perf.enabled) {
      s.appendChild(hint(t('editor.camera.perfHint')));
      const fields: { key: keyof typeof perf; labelKey: string }[] = [
        { key: 'fps', labelKey: 'editor.camera.perfFps' },
        { key: 'frameMs', labelKey: 'editor.camera.perfFrameMs' },
        { key: 'assets', labelKey: 'editor.camera.perfAssets' },
        { key: 'terrain', labelKey: 'editor.camera.perfTerrain' },
      ];
      for (const f of fields) {
        s.appendChild(
          checkbox(t(f.labelKey as Parameters<typeof t>[0]), perf[f.key], (on) =>
            d.setPerfOverlay({ [f.key]: on }),
          ).root,
        );
      }
    }

    this.root.appendChild(s);
  }

  /** Blender-style Scene Collection: a flat list of every placed object with an
   *  eyeball (hide in editor), a click-to-select / double-click-to-rename name,
   *  and a pin (fly the camera close + select). */
  private sceneCollectionPanel(): void {
    const d = this.deps;
    const s = section(t('editor.scene.title'));
    s.appendChild(hint(t('editor.scene.hint')));
    const objects = d.getSceneObjects();
    if (objects.length === 0) {
      s.appendChild(el('p', 'ed-muted', t('editor.scene.none')));
      this.root.appendChild(s);
      return;
    }
    s.appendChild(el('p', 'ed-muted', t('editor.scene.count', { n: objects.length })));
    const list = el('div', 'ed-scene-list');
    for (const obj of objects) {
      const row = el('div', 'ed-scene-row');
      row.classList.toggle('active', obj.selected);
      row.classList.toggle('is-hidden', obj.hidden);
      // Eyeball: hide/show in the EDITOR only (the object stays in the map).
      row.appendChild(
        iconButton(
          obj.hidden ? ICON_EYE_OFF : ICON_EYE,
          () => d.toggleSceneObjectHidden(obj.index),
          'ed-scene-icon',
          obj.hidden ? t('editor.scene.showTitle') : t('editor.scene.hideTitle'),
        ),
      );
      // Name: single click selects, double click renames inline. A short timer
      // lets a double click cancel the pending select (which would rebuild the
      // row out from under the dblclick).
      const name = el('button', 'ed-scene-name', obj.name);
      name.type = 'button';
      name.title = obj.name;
      let clickTimer = 0;
      name.addEventListener('click', () => {
        window.clearTimeout(clickTimer);
        clickTimer = window.setTimeout(() => d.selectSceneObject(obj.index), 220);
      });
      name.addEventListener('dblclick', (ev) => {
        window.clearTimeout(clickTimer);
        ev.preventDefault();
        const input = this.nameInput(obj.name, (v) => d.renameSceneObject(obj.index, v));
        input.className = 'ed-scene-name-input';
        input.setAttribute('aria-label', t('editor.scene.renameLabel'));
        name.replaceWith(input);
        input.focus();
        input.select();
        input.addEventListener('blur', () => this.refresh());
        input.addEventListener('keydown', (k) => {
          if (k.key === 'Enter') input.blur();
          else if (k.key === 'Escape') this.refresh();
        });
      });
      row.appendChild(name);
      if (obj.hidden) row.appendChild(el('span', 'ed-scene-badge', t('editor.scene.hiddenBadge')));
      // Pin: fly the camera close to the object and select it.
      row.appendChild(
        iconButton(
          ICON_PIN,
          () => d.pinSceneObject(obj.index),
          'ed-scene-icon',
          t('editor.scene.pinTitle'),
        ),
      );
      list.appendChild(row);
    }
    s.appendChild(list);
    this.root.appendChild(s);
  }

  private navHint(): void {
    const mode = this.deps.getViewMode();
    this.root.appendChild(
      el(
        'p',
        'ed-hint ed-nav-hint',
        mode === '3d' ? t('editor.hints.nav3d') : t('editor.hints.nav2d'),
      ),
    );
  }

  private coordField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
    const row = el('label', 'ed-field');
    row.appendChild(el('span', undefined, label));
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.5';
    input.value = String(Math.round(value * 100) / 100);
    input.addEventListener('keydown', (ev) => ev.stopPropagation());
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) onChange(v);
    });
    row.appendChild(input);
    return row;
  }
}
