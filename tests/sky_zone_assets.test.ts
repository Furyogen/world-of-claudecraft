import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadHdr = vi.fn(async () => new THREE.DataTexture());
const loadTexture = vi.fn(async () => new THREE.Texture());

describe('zone-scoped sky assets', () => {
  beforeEach(() => {
    vi.resetModules();
    loadHdr.mockClear();
    loadTexture.mockClear();
    vi.doMock('../src/render/gfx', () => ({ GFX: { standardMaterials: true } }));
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(),
      loadHdr,
      loadTexture,
      releaseGltf: vi.fn(),
    }));
    vi.doMock('../src/render/textures', () => ({
      cloudTexture: vi.fn(() => new THREE.Texture()),
      skyTexture: vi.fn(() => new THREE.Texture()),
    }));
  });

  it('loads only requested biomes and deduplicates repeated calls', async () => {
    const { ensureSkyBiomeAssets, hasSkyHdriAssets } = await import('../src/render/sky');

    expect(loadHdr).not.toHaveBeenCalled();
    await ensureSkyBiomeAssets(['vale', 'vale']);
    expect(loadHdr).toHaveBeenCalledTimes(1);
    expect(loadTexture).toHaveBeenCalledTimes(1);
    expect(hasSkyHdriAssets(['vale'])).toBe(true);
    expect(hasSkyHdriAssets(['marsh'])).toBe(false);

    await ensureSkyBiomeAssets(['vale']);
    expect(loadHdr).toHaveBeenCalledTimes(1);
    expect(loadTexture).toHaveBeenCalledTimes(1);
  });
});
