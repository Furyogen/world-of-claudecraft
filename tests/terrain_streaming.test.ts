import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockEmptyAssetLoads(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => new Promise(() => {})),
    loadHdr: vi.fn(() => new Promise(() => {})),
    loadTexture: vi.fn(() => new Promise(() => {})),
    releaseGltf: vi.fn(),
  }));
  const texture = (): THREE.DataTexture => {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  vi.doMock('../src/render/textures', () => ({
    groundDetailTexture: vi.fn(texture),
    groundSplatMaps: vi.fn(() => ({
      grass: texture(),
      dirt: texture(),
      rock: texture(),
      sand: texture(),
      mud: texture(),
      snow: texture(),
    })),
    macroNoiseTexture: vi.fn(texture),
    skyTexture: vi.fn(texture),
    waterNormalish: vi.fn(texture),
    waterNormalMaps: vi.fn(() => [texture(), texture()]),
  }));
}

// Zone-lazy terrain: buildTerrain() itself builds nothing; each overworld zone
// materializes through ensureZone (driven by the renderer's prepareZoneAt and
// the visible-zone streaming queue). ensureZone yields between build batches
// on setTimeout(0); fake timers drain it deterministically.
describe('progressive terrain build', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds nothing until a zone is ensured, then only that zone streams in', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    expect(terrain.group.children).toHaveLength(0);

    const zone = zoneAt(0, 0);
    expect(terrain.isZoneLoaded(zone.id)).toBe(false);
    const task = terrain.ensureZone(zone);
    await vi.runAllTimersAsync();
    await task;

    expect(terrain.group.children.length).toBeGreaterThan(0);
    expect(terrain.isZoneLoaded(zone.id)).toBe(true);
  });

  it('cancelStreaming stops an in-flight zone build from ever completing', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const zone = zoneAt(0, 0);
    const task = terrain.ensureZone(zone);
    // Let at most one yield slice through, then cancel: the loop must bail at
    // its next yield point without marking the zone loaded.
    await vi.advanceTimersByTimeAsync(0);
    const midCount = terrain.group.children.length;
    terrain.cancelStreaming();

    await vi.runAllTimersAsync();
    await task;

    expect(terrain.group.children.length).toBe(midCount);
    expect(terrain.isZoneLoaded(zone.id)).toBe(false);
  });

  it('streamed-in chunks are visible to update()/rebuildRegion() via the same live chunk list', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const task = terrain.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    await task;

    // update() must not throw once zone chunks (added after the initial
    // return) are folded into fog culling.
    expect(() => terrain.update(0, 0, 1000)).not.toThrow();
  });

  it('freezes matrixAutoUpdate on every streamed-in chunk', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const terrain = buildTerrain(20061);
    const task = terrain.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    await task;

    for (const child of terrain.group.children) {
      expect(child.matrixAutoUpdate).toBe(false);
    }
  });

  it('an idle-paced background build completes and matches the fast build', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    const zone = zoneAt(0, 0);
    const fast = buildTerrain(20061);
    const fastTask = fast.ensureZone(zone);
    await vi.runAllTimersAsync();
    await fastTask;

    // No requestIdleCallback in plain Node, so idleSlot falls back to
    // setTimeout(0); fake timers drain it the same way. The pin is that the
    // idle-paced arm reaches full coverage (zone marked loaded) without
    // stalling or dropping work; it emits MORE meshes than the fast arm
    // because dense-band cells split into four half-size sub-chunks (the
    // per-idle-slot hitch bound), never fewer.
    const idle = buildTerrain(20061);
    const idleTask = idle.ensureZone(zone, undefined, { pace: 'idle' });
    await vi.runAllTimersAsync();
    await idleTask;

    expect(idle.group.children.length).toBeGreaterThanOrEqual(fast.group.children.length);
    expect(idle.isZoneLoaded(zone.id)).toBe(true);
    fast.cancelStreaming();
    idle.cancelStreaming();
  });

  it('builds the chunks nearest a per-call priority point before farther ones', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');
    const { zoneAt } = await import('../src/sim/data');

    // Anchor away from the zone's row-major origin so the ordering effect is
    // unambiguous: the first built chunks must hug the entry point. The point
    // rides the ensureZone call (a walked crossing's entry), NOT the view's
    // construction point, which deliberately stays unset here.
    const zone = zoneAt(0, 0);
    const point = { x: 0, z: (zone.zMin + zone.zMax) / 2 };
    const terrain = buildTerrain(20061);
    const task = terrain.ensureZone(zone, undefined, { priority: point });

    // Advance a couple of yield slices only, mid-build.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    const early = [...terrain.group.children];
    expect(early.length).toBeGreaterThan(0);

    await vi.runAllTimersAsync();
    await task;
    const all = [...terrain.group.children];
    expect(all.length).toBeGreaterThan(early.length);

    const distToPoint = (mesh: THREE.Object3D): number => {
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      return Math.hypot(center.x - point.x, center.z - point.z);
    };
    const earlyClosest = Math.min(...early.map(distToPoint));
    const overallClosest = Math.min(...all.map(distToPoint));
    expect(earlyClosest).toBeCloseTo(overallClosest, 5);
  });
});
