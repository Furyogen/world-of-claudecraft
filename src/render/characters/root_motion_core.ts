// Root-motion removal for locomotion clips authored with travel baked in.
//
// Some imported rigs (the Tripo-built Sporemender Form) ship Walk and Run
// clips whose root bone TRANSLATES forward across the cycle and snaps back
// when the loop wraps. The sim already moves the body, so that baked travel
// reads as the figure sprinting ahead of its own position and rolling back
// every stride. `inPlaceTranslation` turns such a track into an in-place
// cycle: it removes the steady per-cycle drift from every component, then
// recentres each drifting component on the bone's rest translation so the
// body stays over its pivot. Non-drifting components (the vertical bob) keep
// their authored values, apart from a seam-closing slope too small to see.
//
// `cycleTravel` measures that same drift as a distance per second in the
// clip's own units, which is the figure a VisualDef walkRef/runRef records
// once it is scaled by the visual's normalisation (manifest.ts).
//
// Pure and three-free: typed arrays in, typed arrays out (RENDER_PURE_CORES,
// tests/architecture.test.ts). Pinned by tests/root_motion_core.test.ts.

/** Components drifting less than this many clip units per cycle are left
 *  centred where the author put them (only their seam slope is removed). */
export const ROOT_DRIFT_EPSILON = 0.01;

/** Which root bone carries baked travel, and in which clips (VisualDef). */
export interface InPlaceClipSpec {
  bone: string;
  clips: readonly string[];
}

/** One LINEAR vec3 track: `times` holds n keys, `values` holds 3n floats. */
export interface Vec3Track {
  times: ArrayLike<number>;
  values: ArrayLike<number>;
}

/** The per-cycle drift of each component (last key minus first key). */
export function cycleDrift(track: Vec3Track): [number, number, number] {
  const n = track.times.length;
  if (n < 2) return [0, 0, 0];
  const last = 3 * (n - 1);
  return [
    track.values[last] - track.values[0],
    track.values[last + 1] - track.values[1],
    track.values[last + 2] - track.values[2],
  ];
}

/** Horizontal-agnostic travel speed of the root, in clip units per second:
 *  the length of the per-cycle drift over the keyed span. */
export function cycleTravel(track: Vec3Track): number {
  const n = track.times.length;
  if (n < 2) return 0;
  const span = track.times[n - 1] - track.times[0];
  if (span <= 0) return 0;
  const [dx, dy, dz] = cycleDrift(track);
  return Math.hypot(dx, dy, dz) / span;
}

/** The track rewritten as an in-place cycle around `rest` (see header). The
 *  input is never mutated; a track with fewer than two keys comes back as a
 *  plain copy. */
export function inPlaceTranslation(
  track: Vec3Track,
  rest: readonly [number, number, number],
  epsilon = ROOT_DRIFT_EPSILON,
): Float32Array {
  const n = track.times.length;
  const out = Float32Array.from(track.values);
  if (n < 2) return out;
  const t0 = track.times[0];
  const span = track.times[n - 1] - t0;
  if (span <= 0) return out;
  const drift = cycleDrift(track);
  for (let k = 0; k < 3; k++) {
    const slope = drift[k] / span;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = out[3 * i + k] - slope * (track.times[i] - t0);
      out[3 * i + k] = v;
      sum += v;
    }
    if (Math.abs(drift[k]) < epsilon) continue;
    const shift = rest[k] - sum / n;
    for (let i = 0; i < n; i++) out[3 * i + k] += shift;
  }
  return out;
}
