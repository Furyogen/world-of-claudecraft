// The Gauntlet's spectator keep-out: the arena footprints a watcher may not
// stand in. A spectator is a body in the world like any other (a knocked-out
// contestant parked at the viewing spot, or a free-roaming watcher from
// gauntlet/modes.ts), and nothing stopped one from strolling onto the sentinel
// field, up the etching dais, over the rope, across the brittle span, or into
// the middle of the Final Court, where they blocked sightlines and read as
// contestants. They watch from OUTSIDE each game now: the per-tick sweep below
// pushes any spectator inside an arena back to its edge, and lets them walk
// anywhere else in the venue.
//
// The zones are derived from the SAME content anchors the renderer builds the
// venue from (GAUNTLET_VENUE / GAUNTLET), so the boundary a spectator feels is
// the arena edge they can see, and every gauntletSpectatorSpot parks clear of
// every zone (pinned in tests/gauntlet_modes.test.ts).
//
// Pure placement: no rng (so an active gauntlet never perturbs the world's
// global draw order), no emits, no state. The push is a plain position write
// in the end-of-tick block, after the movement pass, exactly like the court's
// arena clamp and the staging pin.

import { GAUNTLET, GAUNTLET_VENUE } from '../content/gauntlet';
import { gauntletOriginAt, isGauntletPos } from '../data';
import type { SimContext } from '../sim_context';
import type { GauntletRun } from './state';

/**
 * One arena footprint, in instance-local yards (add the run origin).
 *
 * A box names the WAY OUT of it, because "the nearest edge" is the wrong answer
 * for a real arena: the echo courtyard's nearest edge is usually one of its
 * WALLS, and the crossing's nearest edge is its kerb. `exit` is the side a
 * watcher actually leaves by (a lane is left over its sidelines; the walled
 * courtyard is left through its one open door), and `pad` is how far PAST the
 * footprint the landing sits, sized so the body ends up on clear ground instead
 * of embedded in the collider that dresses the edge (the kerb, the wall). Both
 * are pinned against the real venue colliders in tests/gauntlet_modes.test.ts.
 */
export type GauntletKeepOut =
  | { kind: 'circle'; x: number; z: number; r: number }
  | {
      kind: 'rect';
      x: number;
      z: number;
      hx: number;
      hz: number;
      exit: 'x' | 'z' | 'east';
      pad: number;
    };

function keepOuts(): GauntletKeepOut[] {
  const V = GAUNTLET_VENUE;
  const out: GauntletKeepOut[] = [];

  // Trial 1, the crossing: the whole sentinel field, start line to finish. It is
  // a lane, so it is left sideways, over a sideline. The landing clears BOTH the
  // field kerb (an OBB out at fieldHalfWidth + 3.4) and the spectators' terrace
  // rail behind it, which is why the pad is this wide: a body pushed onto either
  // one would be ejected inward by the collider pass and shoved back out here,
  // tick after tick.
  const L = GAUNTLET.sentinel.fieldLength;
  const z0 = -2;
  const z1 = L + 2;
  out.push({
    kind: 'rect',
    x: 0,
    z: (z0 + z1) / 2,
    hx: GAUNTLET.sentinel.fieldHalfWidth + 3,
    hz: (z1 - z0) / 2,
    exit: 'x',
    pad: 3,
  });

  // Trial 2, the sigils: the etching dais. Its rim is the boundary, which keeps a
  // watcher a clear couple of yards off the outermost lectern station and stands
  // them inside the pillar ring (the pillars sit a yard and a half further out).
  out.push({ kind: 'circle', x: V.sigils.x, z: V.sigils.z, r: V.sigils.radius });

  // Trial 3, the pull: the rope lane, another lane, left over its sidelines (the
  // fallen already park south of it: gauntletSpectatorSpot). The box runs the
  // full length of the lane PLUS the knot's travel, because the whole line slides
  // with the rope.
  out.push({
    kind: 'rect',
    x: V.pull.x,
    z: V.pull.z,
    hx: V.pull.length / 2 + V.pull.knotTravel,
    hz: V.pull.width / 2 + 1.5,
    exit: 'z',
    pad: 0,
  });

  // Trial 4, the echo: the courtyard interior. Its west, north, and south sides
  // are WALLS (their colliders sit exactly on this box's edges), so there is one
  // way out and the sweep uses it: east, through the open entrance the desks
  // face, landing a clear stride past the wall ends.
  out.push({
    kind: 'rect',
    x: V.echo.x,
    z: V.echo.z,
    hx: V.echo.size / 2,
    hz: V.echo.size / 2,
    exit: 'east',
    pad: 1.2,
  });

  // Trial 5, the span: the twin-track deck and its two approach ramps. A lane
  // again: off the side of the crossing, clear of the deck and its end torches.
  const t = GAUNTLET.span;
  out.push({
    kind: 'rect',
    x: V.span.x,
    z: V.span.z,
    hx: t.panelGap / 2 + t.panelWidth + 1.5,
    hz: (t.steps * t.panelLength) / 2 + 3,
    exit: 'x',
    pad: 0,
  });

  // Trial 6, the Final Court: the dressed floor disc (the fighters themselves are
  // clamped to the tighter GAUNTLET.court.arenaRadius well inside it, and the rim
  // torches stand outside it).
  out.push({ kind: 'circle', x: V.court.x, z: V.court.z, r: V.court.radius });

  return out;
}

/** The six arena footprints a spectator is kept out of, instance-local. */
export const GAUNTLET_KEEP_OUTS: readonly GauntletKeepOut[] = keepOuts();

// The landing sits this hair PAST the boundary rather than exactly on it: the
// containment test is a strict inside, and a radial landing computed at exactly
// the rim can read back as a whisker inside it in floating point, which would
// push the same body again every tick forever. A centimetre is invisible and
// makes the settle idempotent.
const EDGE_EPS = 0.01;

/**
 * The instance-local point a spectator standing at (lx, lz) is pushed to: out of
 * the arena they are inside, radially for a disc and over the declared exit for a
 * box, or null when they are already clear of every zone. Pure and Node-tested
 * directly.
 *
 * Landing exactly ON a boundary is CLEAR (the containment test is a strict
 * inside), so a pushed spectator settles at the edge rather than being shoved
 * again every tick. The zones are disjoint (pinned), so one push always resolves.
 */
export function gauntletKeepOutPush(lx: number, lz: number): { x: number; z: number } | null {
  for (const zone of GAUNTLET_KEEP_OUTS) {
    if (zone.kind === 'circle') {
      const dx = lx - zone.x;
      const dz = lz - zone.z;
      const d = Math.hypot(dx, dz);
      if (d >= zone.r) continue;
      const r = zone.r + EDGE_EPS;
      // Dead centre has no radial to push along: any direction is as good, so
      // take +x (deterministic, never a draw).
      if (d < 1e-6) return { x: zone.x + r, z: zone.z };
      return { x: zone.x + (dx / d) * r, z: zone.z + (dz / d) * r };
    }
    const dx = lx - zone.x;
    const dz = lz - zone.z;
    if (Math.abs(dx) >= zone.hx || Math.abs(dz) >= zone.hz) continue;
    const outX = zone.hx + zone.pad + EDGE_EPS;
    const outZ = zone.hz + zone.pad + EDGE_EPS;
    if (zone.exit === 'east') return { x: zone.x + outX, z: lz };
    if (zone.exit === 'z') return { x: lx, z: zone.z + (dz < 0 ? -outZ : outZ) };
    return { x: zone.x + (dx < 0 ? -outX : outX), z: lz };
  }
  return null;
}

// Push one spectating body out of whatever arena it is standing in. The venue is
// resolved from the entity's own band position (gauntletOriginAt, the venue-physics
// idiom), so it works for a run's parked spectators and for a free-roaming watcher
// who wandered into a different slot's venue alike.
function pushOut(ctx: SimContext, pid: number): void {
  const e = ctx.entities.get(pid);
  if (!e || e.dead || !isGauntletPos(e.pos.x)) return;
  const origin = gauntletOriginAt(e.pos.z);
  const push = gauntletKeepOutPush(e.pos.x - origin.x, e.pos.z - origin.z);
  if (!push) return;
  e.pos.x = origin.x + push.x;
  e.pos.z = origin.z + push.z;
  // prevPos is left alone on purpose: the nudge then reads as being held back at
  // the line rather than as a teleport. The re-bucket matches every sibling
  // position write in the gauntlet (vitality.ts, podium.ts, runs.ts) rather than
  // leaning on the coordinator's end-of-tick grid refresh running after us.
  ctx.rebucket(e);
}

/**
 * The per-tick sweep (called from the gauntlet run driver, in the end-of-tick
 * block AFTER the movement pass, so any step into an arena is undone before the
 * frame is broadcast): keep every spectator outside every arena.
 *
 * Covers both kinds of watcher: a run's knocked-out players (playerStates
 * `spectating`) and the free-roaming spectators of gauntlet/modes.ts. A player
 * posed on the winners' stand is exempt: the ceremony seats the fallen, and the
 * podium stands clear of every zone anyway.
 */
export function holdSpectatorsOutsideArenas(ctx: SimContext): void {
  for (const run of ctx.gauntletRuns) {
    for (const [pid, ps] of run.playerStates) {
      if (!ps.spectating) continue;
      if (isPodiumOccupant(run, pid)) continue;
      pushOut(ctx, pid);
    }
  }
  for (const pid of ctx.gauntletSpectators.keys()) pushOut(ctx, pid);
}

function isPodiumOccupant(run: GauntletRun, pid: number): boolean {
  return !!run.podiumSeats?.some((s) => s.entityId === pid);
}
