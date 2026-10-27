// Stealth Rework footprints: the pure placement half of the ground prints
// (stealth_footprint_visual.ts is the Three painter). A print's age picks one
// of FOOTPRINT_FADE_BUCKETS fade steps (newest darkest, linear across the
// readable window), and its foot offsets it to the left or right of the path.
// The prints are ACTIONABLE information (where an enemy stealther went), so
// the plan is identical on every graphics tier: no tier knob reads it.

import {
  FOOTPRINT_LAG,
  FOOTPRINT_LIFETIME,
  type VisibleFootprint,
} from '../sim/stealth_footprints';

export const FOOTPRINT_FADE_BUCKETS = 4;
/** Opacity of each fade bucket, newest first. */
export const FOOTPRINT_FADE_OPACITY: readonly number[] = [0.62, 0.46, 0.3, 0.16];
/** Yards each print sits to the side of the stealther's path. */
export const FOOTPRINT_SIDE_OFFSET = 0.16;
/** Half-width and half-length of one print, in yards. */
export const FOOTPRINT_HALF_WIDTH = 0.11;
export const FOOTPRINT_HALF_LENGTH = 0.24;

export interface FootprintPlacement {
  x: number;
  z: number;
  /** Rotation about +Y that turns the print's long axis (+Z) to its facing. */
  yaw: number;
  bucket: number;
}

export function newFootprintPlacement(): FootprintPlacement {
  return { x: 0, z: 0, yaw: 0, bucket: 0 };
}

/** 0 = freshest readable print, FOOTPRINT_FADE_BUCKETS - 1 = about to vanish. */
export function footprintFadeBucket(age: number): number {
  const span = FOOTPRINT_LIFETIME - FOOTPRINT_LAG;
  const t = (age - FOOTPRINT_LAG) / span;
  if (!(t > 0)) return 0;
  return Math.min(FOOTPRINT_FADE_BUCKETS - 1, Math.floor(t * FOOTPRINT_FADE_BUCKETS));
}

/** Fill `out` for one print: forward is (sin f, cos f) and right is
 *  (-cos f, sin f) in the world's x/z (the movement kernel's axes,
 *  sim/player_motion.ts), so the left foot steps to -right, the right to +right. */
export function footprintPlacementInto(
  out: FootprintPlacement,
  print: VisibleFootprint,
): FootprintPlacement {
  const side = print.foot === 1 ? FOOTPRINT_SIDE_OFFSET : -FOOTPRINT_SIDE_OFFSET;
  out.x = print.x - Math.cos(print.facing) * side;
  out.z = print.z + Math.sin(print.facing) * side;
  out.yaw = print.facing;
  out.bucket = footprintFadeBucket(print.age);
  return out;
}
