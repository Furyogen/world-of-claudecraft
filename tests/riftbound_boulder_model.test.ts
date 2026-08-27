// Contract test for the shipped Riftbound Boulder mount GLB.
//
// This model is not a downloaded asset: it is authored by
// scripts/assets/riftbound_boulder/ and its geometry carries load-bearing
// promises the renderer relies on but cannot check at runtime. The important
// one is the FRAMING contract. The renderer rolls this mount by rotating its
// visual root, and that only spins the stone in place while the root's origin
// is the stone's own centre. manifest.ts reaches that by pairing height 1.6
// with hover -0.8, and both numbers are correct only while the authored bounds
// are exactly 2.0 tall and centred on the origin. A factory edit that broke the
// centring would not throw anywhere: the stone would quietly start orbiting its
// own contact point instead of spinning, so it is pinned here.
//
// Materials, attributes and clips are read straight off the GLB JSON chunk (the
// same way tests/weapon_skins.test.ts reads its clip names); the BOUNDS go
// through gltf-transform, because the shipping pass quantizes positions and the
// raw accessor min/max are lattice integers rather than yards.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import { boulderSourceFingerprint } from '../scripts/assets/riftbound_boulder/source_fingerprint.mjs';

const repoRoot = path.resolve(__dirname, '..');
const glbPath = path.join(repoRoot, 'public/models/mounts/riftbound_boulder.glb');

interface GlbJson {
  asset: { extras?: Record<string, unknown> };
  extras?: Record<string, unknown>;
  meshes: { name?: string; primitives: { attributes: Record<string, number> }[] }[];
  materials?: { name?: string }[];
  animations?: unknown[];
  images?: unknown[];
  textures?: unknown[];
}

/** Parse a binary glTF's JSON chunk. */
function readGlbJson(file: string): GlbJson {
  const bytes = readFileSync(file);
  expect(bytes.readUInt32LE(0), 'glTF magic').toBe(0x46546c67);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as GlbJson;
}

/** The model bounds in WORLD units. Read through gltf-transform rather than
 *  straight off the accessors: the shipping pass quantizes positions, so the
 *  raw accessor min/max are integer lattice coordinates and only the node
 *  transform brings them back to yards. */
let bounds: { min: number[]; max: number[] };

describe('Riftbound Boulder mount GLB', () => {
  const glb = readGlbJson(glbPath);

  beforeAll(async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.read(glbPath);
    bounds = getBounds(document.getRoot().listScenes()[0]);
  });

  it('is exactly two units tall and centred on the origin', () => {
    const { min, max } = bounds;
    // Quantization from the meshopt pass moves vertices by a fraction of a
    // millimetre, so this is tight but not exact.
    expect(max[1] - min[1]).toBeCloseTo(2, 3);
    for (const axis of [0, 1, 2]) {
      expect((max[axis] + min[axis]) / 2, `axis ${axis} centre`).toBeCloseTo(0, 3);
    }
  });

  it('is roughly round, because a lumpy stone would wobble as it rolls', () => {
    const { min, max } = bounds;
    const height = max[1] - min[1];
    for (const axis of [0, 2]) {
      const extent = max[axis] - min[axis];
      // Within 12% of the height on both horizontal axes: enough relief to read
      // as broken stone, not enough to visibly wobble against a smooth roll.
      expect(Math.abs(extent - height) / height, `axis ${axis} roundness`).toBeLessThan(0.12);
    }
  });

  it('ships the stone and the rift seams as two vertex-coloured meshes', () => {
    const names = (glb.materials ?? []).map((material) => material.name).sort();
    expect(names).toEqual(['riftbound_stone', 'riftbound_vein']);
    for (const mesh of glb.meshes) {
      for (const primitive of mesh.primitives) {
        expect(primitive.attributes.COLOR_0, 'every primitive carries vertex colors').toBeDefined();
      }
    }
  });

  it('carries no textures at all, which is why it needs no KTX2 pass', () => {
    expect(glb.images ?? []).toHaveLength(0);
    expect(glb.textures ?? []).toHaveLength(0);
  });

  it('is clipless: its motion is the roll, never a baked gait', () => {
    expect(glb.animations ?? []).toHaveLength(0);
  });

  it('stays small enough to stop being a size question', () => {
    expect(readFileSync(glbPath).byteLength).toBeLessThan(96 * 1024);
  });

  it('is not stale: the stamped fingerprint matches its live sources', () => {
    const stamped = glb.asset.extras?.sourceFingerprint ?? glb.extras?.sourceFingerprint;
    expect(
      stamped,
      'committed GLB is stale; re-run node scripts/assets/riftbound_boulder/export_riftbound_boulder.mjs',
    ).toBe(boulderSourceFingerprint(repoRoot));
  });
});
