import { describe, expect, it } from 'vitest';
import {
  distanceSqToZone,
  effectiveStreamingZones,
  fogFarForPreparedZones,
  MAX_OUTDOOR_FOG_FAR,
  MIN_OUTDOOR_FOG_FAR,
  UNPREPARED_ZONE_FOG_GUARD,
  ZONE_STREAM_RECHECK_DISTANCE,
  zoneEntryPoint,
  zonesWithinStreamingHorizon,
} from '../src/render/zone_streaming';
import { BUILTIN_WORLD, setActiveWorldContent, ZONES, zoneAt } from '../src/sim/data';

describe('renderer zone-streaming horizon', () => {
  it('keeps a zero-radius query scoped to the containing zone', () => {
    expect(zonesWithinStreamingHorizon(ZONES, 0, 0, 0).map((zone) => zone.id)).toEqual([
      'eastbrook_vale',
    ]);
  });

  it('includes a neighbouring column before the player crosses its boundary', () => {
    const ids = zonesWithinStreamingHorizon(ZONES, 150, 0, 80, 1, 0).map((zone) => zone.id);
    expect(ids).toEqual(['eastbrook_vale', 'farshore_isle']);
    const farshore = ZONES.find((zone) => zone.id === 'farshore_isle');
    if (!farshore) throw new Error('expected Farshore in built-in zones');
    expect(distanceSqToZone(farshore, 150, 0)).toBe(30 * 30);
  });

  it('limits the spawn horizon to nearby regions instead of the whole world', () => {
    const ids = zonesWithinStreamingHorizon(ZONES, 0, 0, 470, 1, 0).map((zone) => zone.id);
    expect(ids).toEqual([
      'eastbrook_vale',
      'farshore_isle',
      'mirefen_marsh',
      'galecrest',
      'willowfen',
    ]);
    expect(ids.length).toBeLessThan(ZONES.length / 2);
  });

  it('prioritizes the camera-facing zone when adjacent boundaries tie', () => {
    const east = zonesWithinStreamingHorizon(ZONES, 0, 0, 470, 1, 0).map((zone) => zone.id);
    const north = zonesWithinStreamingHorizon(ZONES, 0, 0, 470, 0, 1).map((zone) => zone.id);
    expect(east.indexOf('farshore_isle')).toBeLessThan(east.indexOf('mirefen_marsh'));
    expect(north.indexOf('mirefen_marsh')).toBeLessThan(north.indexOf('farshore_isle'));
  });

  it('uses a non-zero movement threshold for cheap frame-loop rechecks', () => {
    expect(ZONE_STREAM_RECHECK_DISTANCE).toBeGreaterThan(0);
  });

  it('every entry point resolves back to its own zone, even from a boundary camera', () => {
    // Regression for the willowfen starvation: the un-inset nearest rectangle
    // point of a zone west of the camera lands exactly on its exclusive max-x
    // edge, zoneAt resolves it to the neighbour, the prepare no-ops, and the
    // streaming queue entry is consumed without ever building the zone.
    const cameras = [
      { x: 25, z: -16 }, // the vale spawn camera that starved willowfen live
      { x: 0, z: 0 },
      { x: 500, z: 2000 },
      { x: -500, z: 900 },
    ];
    for (const zone of ZONES) {
      for (const cam of cameras) {
        const entry = zoneEntryPoint(zone, cam.x, cam.z);
        expect(zoneAt(entry.x, entry.z).id, `${zone.id} from (${cam.x}, ${cam.z})`).toBe(zone.id);
      }
    }
  });
});

describe('renderer zone-residency fog', () => {
  const eastbrookOnly = new Set(['eastbrook_vale']);

  it('clamps ahead of the nearest unprepared zone at the Eastbrook spawn', () => {
    // Farshore sits 178 yd from (2, -2) and is the closest unprepared zone,
    // so the fog is held at 178 - guard = 170 no matter what was requested.
    expect(fogFarForPreparedZones(ZONES, eastbrookOnly, 2, -2, 500)).toBe(170);
    expect(fogFarForPreparedZones(ZONES, eastbrookOnly, 2, -2, 900)).toBe(170);
  });

  it('contracts before Farshore can enter the visible envelope', () => {
    const farshore = ZONES.find((zone) => zone.id === 'farshore_isle');
    if (!farshore) throw new Error('expected Farshore in built-in zones');
    expect(distanceSqToZone(farshore, 60, 0)).toBe(120 * 120);
    expect(fogFarForPreparedZones(ZONES, eastbrookOnly, 60, 0, 500)).toBe(
      120 - UNPREPARED_ZONE_FOG_GUARD,
    );
    expect(fogFarForPreparedZones(ZONES, eastbrookOnly, 100, 0, 500)).toBe(
      80 - UNPREPARED_ZONE_FOG_GUARD,
    );
  });

  it('never exposes an unloaded boundary at point-blank range', () => {
    expect(fogFarForPreparedZones(ZONES, eastbrookOnly, 179, 0, 500)).toBe(MIN_OUTDOOR_FOG_FAR);
  });

  it('opens the view to the full request after the destination becomes resident', () => {
    const withFarshore = new Set(['eastbrook_vale', 'farshore_isle']);
    // The next unprepared zone is farther than the request, so the biome
    // preset wins outright once the crossing target is resident.
    expect(fogFarForPreparedZones(ZONES, withFarshore, 179, 0, 170)).toBe(170);
  });

  it('caps every request at the rendering envelope even with the world resident', () => {
    const all = new Set(ZONES.map((zone) => zone.id));
    expect(fogFarForPreparedZones(ZONES, all, 0, 0, MAX_OUTDOOR_FOG_FAR + 500)).toBe(
      MAX_OUTDOOR_FOG_FAR,
    );
    expect(fogFarForPreparedZones(ZONES, all, 0, 0, 80)).toBe(80);
  });
});

describe('effectiveStreamingZones', () => {
  it('is the ZONES table itself for the built-in world', () => {
    setActiveWorldContent(null);
    expect(effectiveStreamingZones()).toBe(ZONES);
  });

  it('expands rects to cover a larger custom world, so margin cameras queue zones', () => {
    const world = {
      ...BUILTIN_WORLD,
      worldHalfX: 400,
      zones: [
        {
          id: 'blank_world',
          name: '',
          zMin: -400,
          zMax: 400,
          levelRange: [1, 1] as [number, number],
          biome: 'vale' as const,
          hub: { x: 0, z: 0, radius: 8, name: '' },
          graveyard: { x: 0, z: 0 },
          lakes: [],
          pois: [],
          welcome: '',
        },
      ],
    };
    setActiveWorldContent(world);
    try {
      const zones = effectiveStreamingZones();
      expect(zones.map((zone) => zone.id)).toEqual(ZONES.map((zone) => zone.id));
      // A camera far out in the west margin now sits INSIDE some expanded
      // rect (distance 0), so the streaming queue fills instead of staying
      // empty and never building the margin.
      const margin = { x: -380, z: -380 };
      expect(zones.some((zone) => distanceSqToZone(zone, margin.x, margin.z) === 0)).toBe(true);
      // ...and the zone the queue prepares is the one the sim clamp (zoneAt)
      // resolves for that position, so ownership and preparation agree.
      const containing = zones.filter((zone) => distanceSqToZone(zone, margin.x, margin.z) === 0);
      expect(containing.map((zone) => zone.id)).toContain(zoneAt(margin.x, margin.z).id);
    } finally {
      setActiveWorldContent(null);
    }
  });
});
