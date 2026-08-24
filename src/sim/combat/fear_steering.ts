// Feared-PLAYER wall guard. Fear runs a player on one fixed heading for its whole
// duration, so a heading pointed at a wall marches them into it. Two arms keep the
// run off the geometry, and they are deliberately different sensors:
//
//  1. steerFearFromWalls PREDICTS. It probes FEAR_WALL_LOOKAHEAD yards ahead against
//     the collider set and makes a corrective turn before the body reaches the wall,
//     which is what keeps the run looking like a panicked veer rather than a bounce.
//  2. fleeAlongOpenHeading MEASURES. It runs the step, reads how far the body
//     actually got, and turns until one delivers. It is the backstop for everything
//     the collider probe cannot see, and it owns the big turns (see its own header).
//
// Both are deterministic and draw no rng, so the parity draw order is untouched. The
// caller (Sim.updateFearMovement) applies them to players only, so feared-mob
// movement, and the parity draw order with it, stays byte-identical.
import { PLAYER_BODY_RADIUS } from '../pathfind';
import type { SimContext } from '../sim_context';
import { DT, type Entity } from '../types';

export const FEAR_WALL_LOOKAHEAD = 2; // yards ahead to watch for a wall (turn late, near the wall)
const FEAR_WALL_PROBE_STEP = 1; // radius-0.5 probe discs are tangent at a 1yd step, so no gap along the ray
// Headings to try (smallest turn first, ties broken by fan order) when blocked ahead.
// Corrective turns only, a quarter or a half. A PREDICTED wall is not evidence enough
// for a three-quarter turn or an about-face: in a shallow dead end the most open probe
// direction is simply back the way the run came, and taking it every tick bounces the
// body between the two ends for the whole fear, which is the same complaint as a pin.
// A big turn has to be earned by a MEASURED stall (fleeAlongOpenHeading below), whose
// fan does carry the reversal.
const FEAR_TURN_FAN = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2];

// Yards the entity can travel straight along `heading` before a wall, capped at
// FEAR_WALL_LOOKAHEAD. Mover-aware via ctx.resolveMovePoint, so a low prop the
// player steps over is not mistaken for a wall.
export function fearWallOpenDistance(ctx: SimContext, e: Entity, heading: number): number {
  const sinA = Math.sin(heading);
  const cosA = Math.cos(heading);
  for (let d = FEAR_WALL_PROBE_STEP; d <= FEAR_WALL_LOOKAHEAD; d += FEAR_WALL_PROBE_STEP) {
    const x = e.pos.x + sinA * d;
    const z = e.pos.z + cosA * d;
    const r = ctx.resolveMovePoint(x, z, PLAYER_BODY_RADIUS, e);
    if (Math.hypot(r.x - x, r.z - z) > 0.05) return d - FEAR_WALL_PROBE_STEP;
  }
  return FEAR_WALL_LOOKAHEAD;
}

// If the flee heading is clear for the lookahead, keep it; otherwise turn to the
// most open heading in FEAR_TURN_FAN (smallest turn first, ties by fan order). In
// a fully enclosed pocket (every candidate blocked no farther than the straight
// one) the original heading is kept, degrading gracefully to the pre-guard pin
// rather than jittering.
export function steerFearFromWalls(ctx: SimContext, e: Entity, heading: number): number {
  let bestOpen = fearWallOpenDistance(ctx, e, heading);
  if (bestOpen >= FEAR_WALL_LOOKAHEAD) return heading;
  let best = heading;
  for (const off of FEAR_TURN_FAN) {
    const open = fearWallOpenDistance(ctx, e, heading + off);
    if (open > bestOpen) {
      bestOpen = open;
      best = heading + off;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Stall escape: the same job as the probe above, but read from the OUTCOME.
//
// steerFearFromWalls predicts a wall from the collider set alone, and that model
// is narrower than the mover it is standing in for: moveToward also refuses an
// uphill step onto ground steeper than the climb limit (true across the whole
// Thornhollow band, which is authored relief, see world.ts nearSteepWalls), a
// step across a garden hedge, and a landlocked step under the waterline. None of
// those show up in a resolveMovePoint probe, so the guard reads "open", never
// turns, and the run pins anyway. The probe is also 1yd-grained, so it accepts a
// 1yd pocket as an improvement and then has nothing left to try once every
// direction reads blocked (its documented no-jitter fallback).
//
// So measure the step the flee ACTUALLY covered and turn off a heading that is
// not delivering. Whatever refused the step (collider, relief, hedge, waterline,
// delve clamp) shows up the same way, which is the point: this arm has no model
// of the world to keep in sync with the mover. Deterministic and rng-free.

const FEAR_FLEE_LOOKAHEAD = 10; // yards ahead the flee destination is placed

// Fraction of the step the flee speed asked for that a tick has to cover before
// the run counts as moving. A heading that merely SLIDES along a wall still
// covers a full step (moveToward's own slide fan takes the body sideways at
// speed), so a half-step bar separates a wall-hugging run, which is fine and is
// what fear is supposed to look like, from a body pinned against the geometry.
export const FEAR_STALL_STEP_FRACTION = 0.5;

// Headings tried when the step stalls: the current one first, then symmetric
// turns of growing size so a stalled body takes the shortest way out, ending at
// a straight reversal, which is open by construction because the player just ran
// from there. A full sweep, so a sealed corner always has an answer.
export const FEAR_ESCAPE_FAN = [
  0,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  (5 * Math.PI) / 6,
  -(5 * Math.PI) / 6,
  Math.PI,
];

/** One tick's worth of flee movement, injected so the search stays host-agnostic
 *  and a test can drive it with a synthetic map instead of a live Sim. */
export interface FearFleeStepper {
  /** Run one flee step along `heading`, leave the body at the stepped position,
   *  and return the yards it covered measured from where this tick started. */
  step(heading: number): number;
  /** Put the body back where this tick started, so the next candidate is tried
   *  from the same place. */
  rewind(): void;
}

/** Wrap to (-PI, PI]. The chosen heading is written back to the aura every tick
 *  and shipped raw on every snapshot, so it is kept bounded rather than left to
 *  accumulate a turn per tick for the length of the fear. */
export function wrapHeading(heading: number): number {
  // Exact for a heading already in range: the modulo below would perturb it by an ulp,
  // and an unchanged heading has to compare equal so a steady run reads as steady.
  if (heading > -Math.PI && heading <= Math.PI) return heading;
  const turns = (((heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return turns === 0 ? Math.PI : turns - Math.PI;
}

/**
 * Step the flee along `heading`, and if that step stalls, turn until one does not.
 * Returns the heading actually committed to (wrapped), which the caller remembers
 * on the aura so the run holds its new course instead of re-testing the blocked
 * one next tick. The body is left at the stepped position.
 *
 * Common case (open ground) costs exactly one step and returns immediately; only
 * a body that is genuinely not moving pays for the fan.
 */
export function fleeAlongOpenHeading(
  heading: number,
  intendedStep: number,
  stepper: FearFleeStepper,
): number {
  const bar = intendedStep * FEAR_STALL_STEP_FRACTION;
  let bestOff = 0;
  let bestMoved = -1;
  for (const off of FEAR_ESCAPE_FAN) {
    const moved = stepper.step(heading + off);
    if (moved >= bar) return wrapHeading(heading + off);
    if (moved > bestMoved) {
      bestMoved = moved;
      bestOff = off;
    }
    stepper.rewind();
  }
  // Sealed on every heading: still take the ground the best candidate gives, so the
  // body is never frozen outright, but KEEP the heading. Committing to whichever
  // offset happened to win a sealed tick makes the next tick pick the opposite one,
  // and a boxed-in body jitters in place instead of holding a course; this is the
  // same no-jitter contract steerFearFromWalls keeps for its own sealed case.
  stepper.step(heading + bestOff);
  return wrapHeading(heading);
}

/** The live-Sim stepper: move, measure, and rewind through the seam. */
export function fearFleeStepper(ctx: SimContext, e: Entity, speed: number): FearFleeStepper {
  const start = { x: e.pos.x, y: e.pos.y, z: e.pos.z, facing: e.facing };
  return {
    step(heading: number): number {
      const dest = ctx.groundPos(
        e.pos.x + Math.sin(heading) * FEAR_FLEE_LOOKAHEAD,
        e.pos.z + Math.cos(heading) * FEAR_FLEE_LOOKAHEAD,
      );
      ctx.moveToward(e, dest, speed);
      return Math.hypot(e.pos.x - start.x, e.pos.z - start.z);
    },
    rewind(): void {
      e.pos.x = start.x;
      e.pos.y = start.y;
      e.pos.z = start.z;
      e.facing = start.facing;
    },
  };
}

/** Sim entry point: run this tick's feared step and return the heading it took. */
export function fleeFearStep(ctx: SimContext, e: Entity, heading: number): number {
  const speed = ctx.fleeMoveSpeed(e);
  return fleeAlongOpenHeading(heading, speed * DT, fearFleeStepper(ctx, e, speed));
}
