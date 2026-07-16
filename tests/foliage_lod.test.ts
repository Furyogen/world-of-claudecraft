import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type BucketWindowInput,
  bucketVisible,
  fogBlendAt,
  IMPOSTOR_MIN_FOG_BLEND,
  LOD_HIGH,
  LOD_LOW,
  lodDistsFor,
  treeDetailDistance,
} from '../src/render/foliage_lod';

// The worst distanceScale the high tier can reach: 0.72 + 0.28 * modelQuality
// with the adaptive budget's foliage lever pinned to the floor (render_budget.ts).
const WORST_SCALE = 0.72;
const BEST_SCALE = 1;

// The shipped per-biome fog, parsed from the renderer rather than restated here,
// so a new zone (or a widened view distance) is covered by these tests the day it
// lands instead of the day someone remembers to update a fixture.
function shippedBiomeFog(): { biome: string; near: number; far: number }[] {
  const src = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
  const block = /BIOME_FOG[^{]*\{([\s\S]*?)\n {2}\};/.exec(src);
  expect(block, 'BIOME_FOG table not found in renderer.ts').not.toBe(null);
  const rows = [
    ...(block as RegExpExecArray)[1].matchAll(
      /(\w+):\s*\{[^}]*near:\s*([\d.]+),\s*far:\s*([\d.]+)/g,
    ),
  ].map((m) => ({ biome: m[1], near: Number(m[2]), far: Number(m[3]) }));
  expect(rows.length, 'parsed no fog rows out of BIOME_FOG').toBeGreaterThan(3);
  return rows;
}

function windowFor(over: Partial<BucketWindowInput> & { centerDist: number }): BucketWindowInput {
  return {
    radius: 0,
    distanceScale: BEST_SCALE,
    detailFar: 300,
    revealScale: 1,
    fogLimit: Number.POSITIVE_INFINITY,
    ...over,
  };
}
// The two buckets a species places over the SAME trees: the real GLB model
// inside the detail radius, the cone/blob impostor outside it.
const realTrees = (centerDist: number, over: Partial<BucketWindowInput> = {}) =>
  windowFor({ centerDist, maxAtDetail: true, ...over });
const impostors = (centerDist: number, over: Partial<BucketWindowInput> = {}) =>
  windowFor({ centerDist, minAtDetail: true, ...over });

describe('foliage LOD: the far-tree impostor never stands in clear air', () => {
  it.each(shippedBiomeFog())('biome $biome: the swap only happens under heavy fog', ({
    near,
    far,
  }) => {
    // Worst case for the player: a starved frame budget, which used to drag the
    // swap toward the camera.
    const detailFar = treeDetailDistance(LOD_HIGH.treeDetailFar, near, far, WORST_SCALE);
    expect(fogBlendAt(detailFar, near, far)).toBeGreaterThanOrEqual(IMPOSTOR_MIN_FOG_BLEND);
  });

  it('regression: a build-time 300u swap left cones half-clear in the long-fog zones', () => {
    // This is the reported bug, not the fix's own arithmetic. The Vale opens to
    // 470u; a flat 300u swap sits at 50% fog, i.e. plainly visible as a cone.
    // Revert treeDetailDistance to a constant and this fails.
    const vale = { near: 130, far: 470 };
    expect(fogBlendAt(300, vale.near, vale.far)).toBeLessThan(IMPOSTOR_MIN_FOG_BLEND);

    const fixed = treeDetailDistance(LOD_HIGH.treeDetailFar, vale.near, vale.far, BEST_SCALE);
    expect(fixed).toBeGreaterThan(LOD_HIGH.treeDetailFar);
    expect(fogBlendAt(fixed, vale.near, vale.far)).toBeGreaterThanOrEqual(IMPOSTOR_MIN_FOG_BLEND);
  });

  it('a starved frame budget cannot drag cones toward the camera', () => {
    // The "cones until they load" half of the report: nothing is loading. The
    // budget dips while assets decode and shaders compile, the detail radius
    // shrank with it (300 * 0.72 = 216u), and the cones marched in until it
    // recovered.
    const vale = { near: 130, far: 470 };
    const starved = treeDetailDistance(LOD_HIGH.treeDetailFar, vale.near, vale.far, WORST_SCALE);
    const rested = treeDetailDistance(LOD_HIGH.treeDetailFar, vale.near, vale.far, BEST_SCALE);

    expect(starved).toBeGreaterThan(LOD_HIGH.treeDetailFar * WORST_SCALE);
    expect(starved).toBe(rested); // fog floor dominates: no visible pop either way
    expect(fogBlendAt(starved, vale.near, vale.far)).toBeGreaterThanOrEqual(IMPOSTOR_MIN_FOG_BLEND);
  });

  it('costs nothing in a short-fog zone: the radius never grows past the old constant', () => {
    // Cave fog closes at 190u, so the fog floor lands below the old 300u radius
    // and the cheaper build-time value must win. This is what stops the fix from
    // paying to draw real trees nobody can see.
    const cave = { near: 45, far: 190 };
    expect(treeDetailDistance(LOD_HIGH.treeDetailFar, cave.near, cave.far, BEST_SCALE)).toBe(300);
    expect(treeDetailDistance(LOD_HIGH.treeDetailFar, cave.near, cave.far, WORST_SCALE)).toBe(216);
  });
});

describe('foliage LOD: the real-model and impostor windows partition the world', () => {
  const detailFar = 368; // the Vale's fog-derived swap

  it('exactly one of the two draws at every distance, for every bucket depth', () => {
    for (const radius of [0, 60, 120]) {
      for (let d = radius; d <= 900; d += 7) {
        const drawn = [
          realTrees(d, { detailFar, radius }),
          impostors(d, { detailFar, radius }),
        ].filter(bucketVisible).length;
        // 2 = the same tree drawn twice (z-fighting); 0 = a hole in the forest.
        expect(drawn, `radius ${radius}, distance ${d}`).toBe(1);
      }
    }
  });

  it('a bucket you are standing at the edge of still draws real trees', () => {
    // Buckets are 240u deep. Keyed on the bucket CENTER, a bucket whose near edge
    // is right under the player could already have flipped to cones. Keyed on the
    // near edge, it cannot.
    const radius = 120;
    const straddling = detailFar + 60; // center past the swap, near edge well inside
    expect(bucketVisible(realTrees(straddling, { detailFar, radius }))).toBe(true);
    expect(bucketVisible(impostors(straddling, { detailFar, radius }))).toBe(false);

    const wellPast = detailFar + radius + 1; // the whole bucket is past the swap
    expect(bucketVisible(realTrees(wellPast, { detailFar, radius }))).toBe(false);
    expect(bucketVisible(impostors(wellPast, { detailFar, radius }))).toBe(true);
  });

  it('the near-fill half still culls at its own cap, and grows no impostor there', () => {
    // Half of each species drops out at treeFillFar to keep the far field cheap.
    // That cap is TIGHTER than the fog-derived swap, so those trees must simply
    // vanish: they must not reappear as cones just because the swap moved out.
    const fill = LOD_HIGH.treeFillFar; // 310, inside detailFar 368
    const nearFillTrees = (d: number) => realTrees(d, { detailFar, maxDist: fill });
    const nearFillImpostors = (d: number) => impostors(d, { detailFar, maxDist: fill });

    expect(bucketVisible(nearFillTrees(fill - 1))).toBe(true);
    expect(bucketVisible(nearFillTrees(fill + 1))).toBe(false);
    for (const d of [fill + 1, detailFar - 1, detailFar + 1, 500]) {
      expect(bucketVisible(nearFillImpostors(d)), `no near-fill cone at ${d}`).toBe(false);
    }
  });

  it('buckets behind the fog wall are dropped whichever LOD they are', () => {
    const fogLimit = 400;
    expect(bucketVisible(impostors(500, { detailFar, fogLimit }))).toBe(false);
    expect(bucketVisible(realTrees(500, { detailFar, fogLimit }))).toBe(false);
    expect(bucketVisible(impostors(380, { detailFar, fogLimit }))).toBe(true);
  });

  it('a cost cap cuts on the bucket CENTER, not its near edge', () => {
    // Buckets are ~240u deep. The density/rock/dressing caps exist to cut
    // triangles, so measuring them from the near edge would keep every bucket
    // alive for another half-bucket past its cap: measured live in the Vale, that
    // one slip took foliage from ~1.0M to ~4.6M triangles a frame. Only the
    // detail swap gets the near-edge treatment.
    const radius = 120;
    const cap = LOD_HIGH.treeFillFar; // 310
    const pastCap = windowFor({
      centerDist: cap + 20, // center is past the cap...
      radius, // ...but the near edge (410 - 120 = 190) is well inside it
      maxDist: cap,
      detailFar: 368,
    });
    expect(bucketVisible(pastCap)).toBe(false);
    expect(bucketVisible({ ...pastCap, centerDist: cap - 20 })).toBe(true);
  });

  it('the budget still scales build-time bounds, just not the fog-derived one', () => {
    // A plain numeric bound (rocks, dressing, the near-fill cull) keeps shrinking
    // under load, which is the budget's whole point. rockFar 360 at half budget
    // is 180, so a rock bucket at 200u is culled.
    const rock = windowFor({ centerDist: 200, maxDist: LOD_HIGH.rockFar, distanceScale: 0.5 });
    expect(bucketVisible(rock)).toBe(false);
    expect(bucketVisible({ ...rock, distanceScale: 1 })).toBe(true);
  });
});

describe('foliage LOD: tiers and purity', () => {
  it('hands the low tier its own, tighter table', () => {
    expect(lodDistsFor(true)).toBe(LOD_LOW);
    expect(lodDistsFor(false)).toBe(LOD_HIGH);
    expect(LOD_LOW.treeDetailFar).toBeLessThan(LOD_HIGH.treeDetailFar);
  });

  it('stays a pure decision module: no Three, no sim', () => {
    const src = readFileSync(new URL('../src/render/foliage_lod.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import/m);
  });
});
