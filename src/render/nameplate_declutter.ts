// Pure post-projection pass: nudges apart nameplates whose screen positions
// would otherwise fully overlap (e.g. two same-named mobs standing close
// together). Most visible on short mobile-landscape viewports, where entities
// need to be much farther apart in world space before their projections
// separate on their own. DOM/Three-free so it unit-tests directly.
//
// This runs for EVERY visible plate on EVERY rendered frame, so the hot path
// (`declutterNameplatesInPlace`) allocates nothing and finds each anchor's
// collision cluster through a reusable spatial hash rather than rescanning all
// anchors, which made the pass quadratic in a crowd.

export interface NameplateAnchor {
  id: number;
  sx: number;
  sy: number;
}

// Anchors within this horizontal distance are treated as colliding: nameplate
// labels render much wider than the anchor point itself (name + level + hp
// bar), so this approximates half of a typical label's on-screen width rather
// than the anchor point spacing.
const OVERLAP_THRESHOLD_X_PX = 80;
// Vertical anchors this close are considered the "same row" (labels are a
// single text line anchored at their bottom, so the tolerance is much
// tighter than the horizontal one).
const OVERLAP_THRESHOLD_Y_PX = 18;
// Vertical gap applied between stacked members of a cluster.
const STACK_OFFSET_PX = 20;

// Cell size equals the collision thresholds, so two colliding anchors are never
// more than one cell apart on either axis and a 3x3 neighbourhood is exhaustive.
const CELL_BIAS = 1 << 15; // keeps negative (just-offscreen) cells non-negative
const CELL_STRIDE = 1 << 16;

// ---------------------------------------------------------------------------
// Reusable workspace. The painter calls this once per frame on one thread, so a
// module-level scratch is safe and keeps the pass allocation-free.
// ---------------------------------------------------------------------------
const order: number[] = [];
const cluster: number[] = [];
const cells = new Map<number, number[]>();
const bucketPool: number[][] = [];
let visited = new Uint8Array(64);

function releaseCells(): void {
  for (const bucket of cells.values()) {
    bucket.length = 0;
    bucketPool.push(bucket);
  }
  cells.clear();
}

/**
 * Stack overlapping anchors apart, MUTATING `anchors` in place.
 *
 * Anchors are processed in ascending id order so the same entities always stack
 * the same way frame to frame, independent of render order.
 *
 * `count` bounds the live prefix, so the caller can hand in a pooled array that
 * is longer than this frame's anchor list without any slicing.
 */
export function declutterNameplatesInPlace(
  anchors: NameplateAnchor[],
  count = anchors.length,
): NameplateAnchor[] {
  const n = Math.min(count, anchors.length);
  if (n < 2) return anchors;

  if (visited.length < n) visited = new Uint8Array(Math.max(n, visited.length * 2));
  else visited.fill(0, 0, n);

  order.length = 0;
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => anchors[a].id - anchors[b].id);

  for (let i = 0; i < n; i++) {
    const cx = Math.floor(anchors[i].sx / OVERLAP_THRESHOLD_X_PX) + CELL_BIAS;
    const cy = Math.floor(anchors[i].sy / OVERLAP_THRESHOLD_Y_PX) + CELL_BIAS;
    const key = cx * CELL_STRIDE + cy;
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = bucketPool.pop() ?? [];
      cells.set(key, bucket);
    }
    bucket.push(i);
  }

  for (let o = 0; o < n; o++) {
    const i = order[o];
    if (visited[i]) continue;
    const ax = anchors[i].sx;
    const ay = anchors[i].sy;

    // gather this anchor's collision cluster from the 3x3 cell neighbourhood
    cluster.length = 0;
    const cx = Math.floor(ax / OVERLAP_THRESHOLD_X_PX) + CELL_BIAS;
    const cy = Math.floor(ay / OVERLAP_THRESHOLD_Y_PX) + CELL_BIAS;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = cells.get((cx + dx) * CELL_STRIDE + (cy + dy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (visited[j]) continue;
          if (Math.abs(anchors[j].sx - ax) > OVERLAP_THRESHOLD_X_PX) continue;
          if (Math.abs(anchors[j].sy - ay) > OVERLAP_THRESHOLD_Y_PX) continue;
          cluster.push(j);
        }
      }
    }

    if (cluster.length < 2) {
      visited[i] = 1;
      continue;
    }
    // the whole pass stacks in ascending id order
    cluster.sort((a, b) => anchors[a].id - anchors[b].id);

    let sum = 0;
    for (const j of cluster) sum += anchors[j].sy;
    const baseSy = sum / cluster.length;
    const mid = (cluster.length - 1) / 2;
    for (let k = 0; k < cluster.length; k++) {
      const j = cluster[k];
      anchors[j].sy = baseSy + (k - mid) * STACK_OFFSET_PX;
      visited[j] = 1;
    }
  }

  releaseCells();
  return anchors;
}

/**
 * Non-mutating wrapper: returns fresh anchors and leaves the input untouched.
 * It allocates, so it is NOT the per-frame path.
 */
export function declutterNameplates(anchors: NameplateAnchor[]): NameplateAnchor[] {
  return declutterNameplatesInPlace(anchors.map((a) => ({ ...a })));
}
