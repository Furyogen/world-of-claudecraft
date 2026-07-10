// Sentinel's Crossing reaction math (pure, host-agnostic, Node-tested).
//
// The red-light catch judges DISPLACEMENT, and a released run keeps sliding
// (trial_sentinel.ts momentum). So the grace window after a red flip has to pay
// for two things in sequence: the human's reaction to the light, and then the
// slide that reaction cannot cancel. If graceS is shorter than the slide alone,
// even a perfect zero-reaction stop convicts, which is not a reaction test but
// an anticipation-only one. These helpers name that budget so the tuning in
// content/gauntlet.ts can be checked against it instead of guessed at.

import type { GauntletSentinelTuning } from '../types';

/**
 * Seconds a released slide takes to fall to (or below) the catch epsilon.
 * The slide decays geometrically once per tick, so this is the first tick k
 * where `speedPerTick * decay^k <= eps`, in seconds. A contestant already
 * slower than the epsilon stops zero ticks from now.
 */
export function slideStopS(speedPerTick: number, decay: number, eps: number, dt: number): number {
  if (speedPerTick <= eps) return 0;
  // decay >= 1 never falls below the epsilon: an unbounded slide.
  if (decay <= 0) return dt;
  if (decay >= 1) return Number.POSITIVE_INFINITY;
  return Math.ceil(Math.log(eps / speedPerTick) / Math.log(decay)) * dt;
}

/**
 * How long a contestant running at `runSpeed` may take to react to a red light
 * and still stop clean: the grace window minus the braked slide it has to pay
 * for. Must stay comfortably above a human's visual reaction (~0.3s) plus one
 * network round trip, or the trial punishes latency rather than attention.
 */
export function sentinelReactionBudgetS(
  t: GauntletSentinelTuning,
  runSpeed: number,
  dt: number,
): number {
  return t.graceS - slideStopS(runSpeed * dt, t.redMomentumDecay, t.redMoveEps, dt);
}
