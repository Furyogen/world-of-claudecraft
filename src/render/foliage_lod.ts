// Distance windows for the instanced tree / rock / dressing buckets, kept apart
// from foliage.ts so the decision itself is pure: no Three, no DOM, no GFX
// singleton, unit-testable in Node (tests/foliage_lod.test.ts).
//
// THE IMPOSTOR IS A LOD, NOT A PLACEHOLDER. Past the tree-detail distance a real
// GLB tree is swapped for a cheap stand-in (a cone for pines, a blob for oaks;
// farTreeProxyGeo in foliage.ts). Nothing about it is meant to be legible: it
// only works while the zone's fog has already swallowed the swap, which is why
// the two windows are exact complements rather than a cross-fade.
//
// That held while every zone's fog closed at ~340u and the detail distance was a
// flat 300u: the impostor band sat inside the murk. Zones now open the view out
// to 470-560u, and a build-time constant cannot know that, so the cones ended up
// standing in clear air. Hence the rule below: the detail distance follows the
// FOG, and an impostor may only appear where fog has already blended it at least
// IMPOSTOR_MIN_FOG_BLEND of the way to solid. A short-fog zone keeps the old,
// cheaper radius (the max() never shrinks it), so this costs nothing where the
// view was already closed in.

export interface LodDists {
  barkFar: number;
  treeDetailFar: number;
  dressFar: number;
  rockFar: number;
  treeFillFar: number;
}

export const LOD_HIGH: LodDists = {
  barkFar: 330,
  treeDetailFar: 300,
  dressFar: 200,
  rockFar: 360,
  treeFillFar: 310,
};

// low caps must clear the worst camera-to-bucket distance (~158u for a
// 2-column x 240u-band bucket) or nearby dressing vanishes and trunks pop at
// bucket boundaries
export const LOD_LOW: LodDists = {
  barkFar: 170,
  treeDetailFar: 250,
  dressFar: 185,
  rockFar: 190,
  treeFillFar: 245,
};

export function lodDistsFor(leanFoliage: boolean): LodDists {
  return leanFoliage ? LOD_LOW : LOD_HIGH;
}

/**
 * How far the fog must have swallowed a tree before it is allowed to become an
 * impostor. 0 would permit a cone in clear air; 1 would forbid impostors
 * entirely (and hand the far field back its full triangle cost).
 */
export const IMPOSTOR_MIN_FOG_BLEND = 0.7;

/** THREE.Fog is linear: 0 at `near`, fully fogged at `far`. */
export function fogBlendAt(dist: number, fogNear: number, fogFar: number): number {
  if (!(fogFar > fogNear)) return dist >= fogFar ? 1 : 0;
  return Math.min(1, Math.max(0, (dist - fogNear) / (fogFar - fogNear)));
}

/**
 * Distance at which a real tree gives way to its impostor.
 *
 * `distanceScale` is the adaptive frame budget's lever (render_budget.ts pulls
 * foliage down first under load). It may still shrink the detail radius, but
 * never past the point where fog stops hiding the swap: a transient dip while
 * assets decode and shaders compile used to drag the boundary in to ~216u and
 * park cones in plain view until the budget recovered, which read as "the trees
 * are still cones until they load".
 */
export function treeDetailDistance(
  base: number,
  fogNear: number,
  fogFar: number,
  distanceScale: number,
): number {
  const budgeted = base * distanceScale;
  if (!(fogFar > fogNear)) return budgeted;
  const fogFloor = fogNear + IMPOSTOR_MIN_FOG_BLEND * (fogFar - fogNear);
  return Math.max(budgeted, fogFloor);
}

export interface BucketWindowInput {
  /** distance from the camera to the bucket's CENTER */
  centerDist: number;
  /** bucket bounding radius */
  radius: number;
  /** build-time bounds, scaled by the adaptive budget at draw time */
  minDist?: number;
  maxDist?: number;
  /**
   * Bounds that additionally track the runtime tree-detail swap: the impostor
   * starts there (minAtDetail), the real model ends there (maxAtDetail). It is
   * the one edge that cannot be known at build time, because it follows the
   * zone's fog. A bucket can carry BOTH a numeric cap and the detail cap (the
   * near-fill half of a species culls at treeFillFar OR at the swap, whichever
   * comes first), so these compose rather than replace.
   */
  minAtDetail?: boolean;
  maxAtDetail?: boolean;
  /** adaptive budget scale applied to the build-time bounds */
  distanceScale: number;
  /** runtime tree-detail boundary (see treeDetailDistance) */
  detailFar: number;
  /** per-bucket jitter that staggers the low-tier reveal; 1 elsewhere */
  revealScale: number;
  /** buckets entirely behind the fog wall are pure overdraw */
  fogLimit: number;
}

/**
 * The build-time caps (the near-fill density cull, rocks, dressing, the early bark
 * cull) are measured against the bucket's CENTER, as they always have been. They
 * are cost controls and a bucket is ~240u deep, so measuring them from the near
 * edge would keep every bucket alive for another half-bucket past its cap and
 * quietly multiply the triangles they exist to cut.
 *
 * The tree-detail swap is the exception: it is measured from the NEAR EDGE. Keyed
 * on the center, a bucket you are standing at the edge of could already have
 * flipped to impostors, putting cones a few strides away. Both sides of the swap
 * read that same quantity, so a species' real-model and impostor windows stay
 * exact complements: never drawn together, never both dropped.
 */
export function bucketVisible(w: BucketWindowInput): boolean {
  const nearEdge = w.centerDist - w.radius;

  const minCap = (w.minDist ?? 0) * w.distanceScale;
  const maxCap =
    w.maxDist === undefined
      ? Number.POSITIVE_INFINITY
      : w.maxDist * w.distanceScale * w.revealScale;
  if (w.centerDist < minCap || w.centerDist >= maxCap) return false;

  if (w.minAtDetail && nearEdge < w.detailFar) return false;
  if (w.maxAtDetail && nearEdge >= w.detailFar) return false;

  return nearEdge < w.fogLimit;
}
