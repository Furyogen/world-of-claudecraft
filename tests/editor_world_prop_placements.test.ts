import { afterEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent, newCustomMap, newFlatCustomMap } from '../src/editor/custom_map';
import {
  promoteMajorWorldProps,
  withoutEditableWorldProps,
  worldMajorPropPlacements,
} from '../src/editor/world_prop_placements';
import { pathCrossesFence } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { MAX_PLACEMENTS, sanitizeMapDoc } from '../src/sim/map_doc';
import { isResting } from '../src/sim/progression/xp';
import type { Entity, ZonePropsDef } from '../src/sim/types';

const EMPTY: ZonePropsDef = {
  buildings: [],
  wells: [],
  stalls: [],
  mines: [],
  docks: [],
  tents: [],
  crates: [],
  campfires: [],
  mudHuts: [],
  ruinRings: [],
  fences: [],
  graveyards: [],
  delveMarkers: [],
  greatTrees: [],
};

describe('editable overworld scenery', () => {
  afterEach(() => setActiveWorldContent(null));

  it('expands buildings and fence runs into ordinary transformable placements', () => {
    const props: ZonePropsDef = {
      ...EMPTY,
      buildings: [
        { kind: 'house', x: 10, z: 20, w: 8, d: 6, rot: 0.4 },
        { kind: 'inn', x: -5, z: 3, w: 10, d: 8, rot: 1.2 },
      ],
      fences: [{ x1: 0, z1: 0, x2: 7.05, z2: 0 }],
    };

    const placements = worldMajorPropPlacements(props);

    expect(placements.filter((p) => p.name?.startsWith('Building'))).toHaveLength(2);
    expect(placements.filter((p) => p.assetId === 'props/fence')).toHaveLength(3);
    expect(placements.every((p) => p.collide)).toBe(true);
    expect(placements.find((p) => p.worldPropKind === 'inn')).toBeDefined();
    expect(placements.filter((p) => p.worldPropKind === 'fence')).toHaveLength(3);
  });

  it('turns every built-in scenery family into selectable placements', () => {
    const props: ZonePropsDef = {
      ...EMPTY,
      wells: [{ x: 1, z: 2, r: 1.4 }],
      stalls: [{ x: 3, z: 4, rot: 0.2, r: 2 }],
      mines: [{ x: 5, z: 6, rot: 0.3 }],
      docks: [{ x: 7, z: 8, rot: 0.4, hutLocal: { x: 2, z: 1, hw: 2, hd: 1.5 } }],
      tents: [{ x: 9, z: 10, rot: 0.5, scale: 1.2 }],
      crates: [[11, 12]],
      campfires: [[13, 14]],
      mudHuts: [[15, 16]],
      ruinRings: [{ x: 17, z: 18, ringR: 4, columns: 3 }],
      graveyards: [{ x: 19, z: 20 }],
      delveMarkers: [{ x: 21, z: 22, delveId: 'drowned_litany' }],
      greatTrees: [{ x: 23, z: 24, r: 4 }],
    };

    const placements = worldMajorPropPlacements(props);
    const assets = new Set(placements.map((placement) => placement.assetId));

    for (const assetId of [
      'props/well',
      'props/market_stand_1',
      'props/timber_pillar',
      'props/dock_platform',
      'props/tent_open',
      'props/crate_wooden',
      'props/bonfire',
      'props/mushroom_red',
      'props/column_broken',
      'props/gravestone_round',
      'dungeon/delve_entrance_2',
      'foliage/twisted_1',
    ]) {
      expect(assets.has(assetId), assetId).toBe(true);
    }
    expect(placements.find((placement) => placement.assetId === 'props/bonfire')?.fire).toBe(true);
    expect(withoutEditableWorldProps(props)).toEqual(EMPTY);
  });

  it('new world maps export all scenery as placements without static duplicates', () => {
    const map = newCustomMap('Editable World', 'world', 100);
    const world = customMapToWorldContent(map);

    expect(map.propsMode).toBe('editable-all');
    expect(map.placements.some((p) => p.assetId.startsWith('props/house_'))).toBe(true);
    expect(map.placements.some((p) => p.assetId === 'props/fence')).toBe(true);
    expect(world.props.buildings).toEqual([]);
    expect(world.props.fences).toEqual([]);
    expect(world.props).toEqual(EMPTY);
    expect(map.placements.some((p) => p.assetId === 'props/bonfire')).toBe(true);
    expect(map.placements.some((p) => p.assetId === 'dungeon/delve_entrance_2')).toBe(true);
  });

  it('promotes a recognized legacy world once without touching unrelated or full maps', () => {
    const legacy = newCustomMap('Legacy World', 'legacy', 100);
    legacy.placements = [];
    delete legacy.propsMode;

    expect(promoteMajorWorldProps(legacy)).toBe(true);
    const count = legacy.placements.length;
    expect(count).toBeGreaterThan(0);
    expect(promoteMajorWorldProps(legacy)).toBe(false);
    expect(legacy.placements).toHaveLength(count);

    const partial = newCustomMap('Partial', 'partial', 100);
    partial.placements = worldMajorPropPlacements({
      ...EMPTY,
      buildings: BUILTIN_WORLD.props.buildings,
      fences: BUILTIN_WORLD.props.fences,
    });
    partial.propsMode = 'editable-major';
    const oldCount = partial.placements.length;
    expect(promoteMajorWorldProps(partial)).toBe(true);
    expect(partial.propsMode).toBe('editable-all');
    expect(partial.placements.length).toBeGreaterThan(oldCount);

    const blank = newFlatCustomMap('Blank', 'blank', 100);
    delete blank.propsMode;
    expect(promoteMajorWorldProps(blank)).toBe(false);

    const full = newCustomMap('Full', 'full', 100);
    full.placements = Array.from({ length: MAX_PLACEMENTS }, (_, index) => ({
      id: `full-${index}`,
      assetId: 'props/crate',
      x: index,
      y: 0,
      z: 0,
      rotY: 0,
      scale: 1,
      collide: false,
      snapToGround: true,
    }));
    delete full.propsMode;
    expect(promoteMajorWorldProps(full)).toBe(false);
    expect(full.propsMode).toBeUndefined();
  });

  it('preserves transform and gameplay metadata through export sanitization', () => {
    const map = newCustomMap('Round trip', 'round-trip', 100);
    const clean = sanitizeMapDoc(JSON.stringify(map));
    const fence = clean?.placements.find((p) => p.worldPropKind === 'fence');

    expect(clean?.propsMode).toBe('editable-all');
    expect(fence?.assetId).toBe('props/fence');
    expect(fence?.collisionMode).toBe('baked');
    expect(fence?.worldPropWidth).toBeGreaterThan(0);
    expect(fence?.worldPropDepth).toBeGreaterThan(0);
    expect(typeof fence?.rotZ).toBe('number');
  });

  it('keeps moved fences jump-aware and moved inns rest-aware', () => {
    const map = newCustomMap('Gameplay props', 'gameplay-props', 100);
    const fence = map.placements.find((p) => p.worldPropKind === 'fence');
    const inn = map.placements.find((p) => p.worldPropKind === 'inn');
    expect(fence).toBeDefined();
    expect(inn).toBeDefined();
    if (!fence || !inn) return;

    const oldInn = { x: inn.x, z: inn.z };
    inn.x += 100;
    inn.z += 100;
    setActiveWorldContent(customMapToWorldContent(map));

    const nx = Math.sin(fence.rotY);
    const nz = Math.cos(fence.rotY);
    expect(
      pathCrossesFence(fence.x - nx * 2, fence.z - nz * 2, fence.x + nx * 2, fence.z + nz * 2),
    ).toBe(true);

    const player = {
      inCombat: false,
      pos: { x: inn.x, y: 0, z: inn.z },
    } as Entity;
    expect(isResting(player)).toBe(true);
    player.pos.x = oldInn.x;
    player.pos.z = oldInn.z;
    expect(isResting(player)).toBe(false);
  });
});
