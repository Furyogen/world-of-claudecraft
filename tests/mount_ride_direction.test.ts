import { describe, expect, it } from 'vitest';
import type { AnimState, BaseState } from '../src/render/characters/anim_state';
import { desiredBaseState } from '../src/render/characters/anim_state';
import { newLocoState, newLocoTrack, updateLocomotionInto } from '../src/render/locomotion';
import {
  applyStandingRider,
  driveMountRide,
  type MountAnimInputs,
  type MountRideView,
  STANDING_WALK_MIN_SPEED,
  signedTravelSpeed,
} from '../src/render/mount_ride_view';
import { type MountVisualSpec, mountVisualSpec } from '../src/render/mount_visuals';

// Regression cover for the reverse-travel bug: the rolling mounts advanced
// their roll from LocoState.speed, which is a positive MAGNITUDE with the
// travel direction split off into `backwards`. A player holding their back key
// therefore travelled backwards while the barrel rolled forward and the rider
// kept backpedalling, so both the contact patch and the feet ran against the
// direction actually covered.
//
// These drive the REAL renderer-facing helpers (the locomotion track that the
// renderer feeds displacements to, then driveMountRide and applyStandingRider)
// rather than asserting the sign in isolation, because the defect lived in the
// seam BETWEEN them, not in either one.

const FPS = 1 / 60;
const BARREL: MountVisualSpec = (() => {
  const spec = mountVisualSpec('tavern_barrel');
  // A loud failure rather than a silently skipped suite if the key ever moves.
  if (!spec) throw new Error('tavern_barrel has no mount visual spec');
  return spec;
})();

const IDLE = {
  speed: 0,
  moving: false,
  running: false,
  backwards: false,
  airborne: false,
  falling: false,
  sitting: false,
  casting: false,
  spinning: false,
  swimming: false,
  submerged: false,
  wading: false,
  swimPitch: 0,
} as unknown as AnimState;

/** A view + fx sink shaped like the renderer's, with no Three in sight. */
function harness() {
  const view: MountRideView = {
    mountVisual: {
      root: { position: { y: 0, z: 0 }, rotation: { x: 0 } },
      update: () => {},
      advanceOffscreen: () => {},
    },
    visual: { root: { position: { y: 0 } } },
    mountLift: 1.5,
    mountRoll: 0,
    group: { position: { x: 0, y: 0, z: 0 } },
  };
  const fxSink = {
    mountSlimeTrail: () => {},
    mountExhaust: () => {},
  };
  return { view, fxSink };
}

const MOUNT_ANIM: MountAnimInputs = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  swimming: false,
};

/** Shortest signed arc from `a` to `b`, both wrapped into [0, 2pi). The drive
 *  wraps its accumulator, so a frame's roll has to be read as a delta. */
function arcStep(a: number, b: number): number {
  const TAU = Math.PI * 2;
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Run `frames` of travel at `speed` u/s along the facing axis, signed by
 *  `sign` (+1 walks forward, -1 backpedals), and report what the mount and the
 *  rider ended up doing. Facing 0 is +Z, which is how the renderer samples it.
 *
 *  Per-frame rows come back too: the locomotion track confirms a direction
 *  change over three frames, so a run that STARTS backwards spends its first
 *  frames latched forward. That is deliberate hysteresis (a one-frame
 *  correction nudge must not flash the walkBack clip) and it applies to the
 *  roll and the rider's gait alike, so the steady state is what the mirror
 *  cases below compare. */
function ride(sign: 1 | -1, frames = 30, speed = 4.55) {
  const track = newLocoTrack();
  const loco = newLocoState();
  const { view, fxSink } = harness();
  const st = { ...IDLE } as AnimState;
  let standing = false;
  const rows: { roll: number; signed: number; backwards: boolean }[] = [];
  for (let i = 0; i < frames; i++) {
    const vz = sign * speed * FPS;
    updateLocomotionInto(loco, track, 0, vz, 0, FPS);
    standing = applyStandingRider(st, loco);
    const before = view.mountRoll;
    view.mountRoll = driveMountRide(BARREL, MOUNT_ANIM, view, fxSink, {
      dt: FPS,
      time: i * FPS,
      loco,
      facing: 0,
      present: true,
      animate: true,
    });
    rows.push({
      roll: arcStep(before, view.mountRoll),
      signed: signedTravelSpeed(loco),
      backwards: st.backwards,
    });
  }
  return {
    loco,
    view,
    st,
    standing,
    rows,
    baseState: desiredBaseState(st, true) as BaseState,
  };
}

/** Roll swept over the settled tail of a run, past the direction latch's
 *  confirm window and the speed smoother's ramp. */
const settledRoll = (rows: { roll: number }[]) =>
  rows.slice(Math.floor(rows.length / 2)).reduce((a, r) => a + r.roll, 0);

/** Unwrap a roll accumulated in [0, 2pi) back onto the signed line, so a small
 *  backwards roll reads as negative rather than as "nearly a full turn". */
const asSigned = (roll: number) => (roll > Math.PI ? roll - Math.PI * 2 : roll);

describe('the barrel is a mount that rolls, so travel direction picks its own sign', () => {
  it('is a rolling mount at all (the spec these cases lean on)', () => {
    expect(BARREL.rollRadius).toBeGreaterThan(0);
    expect(BARREL.ridePose).toBe('standing');
  });

  it('rolls FORWARD and backpedals the rider on forward travel', () => {
    const fwd = ride(1);
    expect(fwd.loco.moving).toBe(true);
    expect(fwd.loco.backwards).toBe(false);
    expect(asSigned(fwd.view.mountRoll)).toBeGreaterThan(0);
    expect(fwd.standing).toBe(true);
    expect(fwd.baseState).toBe('walkBack');
  });

  it('rolls BACKWARD and walks the rider forward on reverse travel', () => {
    // The bug: this used to roll forward (the magnitude was all the drive got)
    // with the rider still backpedalling, so the barrel drove out from under
    // feet that were pointing the wrong way.
    const back = ride(-1);
    expect(back.loco.moving).toBe(true);
    expect(back.loco.backwards).toBe(true);
    expect(asSigned(back.view.mountRoll)).toBeLessThan(0);
    expect(back.standing).toBe(true);
    expect(back.baseState).toBe('walk');
  });

  it('rolls the two directions by mirror-equal amounts, not by different rules', () => {
    // A decisive pin rather than two sign checks: once travel is settled,
    // reversing it must NEGATE the roll exactly, since it is the same
    // omega = v / r either way. Measured over the settled tail, because the
    // direction latch spends the first frames of a reversal still reading
    // forward (and moves the rider's feet with it, which is the point).
    const fwd = settledRoll(ride(1).rows);
    const back = settledRoll(ride(-1).rows);
    expect(fwd).toBeGreaterThan(0);
    expect(back).toBeCloseTo(-fwd, 12);
  });

  it('sweeps exactly the ground it covers, per frame, in whichever direction', () => {
    // The no-slip law itself (arc = distance) restated frame by frame against
    // the SIGNED speed, which is the form the reverse case used to violate: the
    // drive was handed a magnitude, so a backpedalling frame swept its arc the
    // wrong way and the contact patch scrubbed at twice the ground speed.
    for (const sign of [1, -1] as const) {
      for (const row of ride(sign).rows) {
        expect(row.roll * BARREL.rollRadius).toBeCloseTo(row.signed * FPS, 12);
      }
    }
  });

  it('turns the rider to face whichever way the crown is carrying them', () => {
    // Per frame, not just at the end: the gait flag must track the sign of the
    // roll every frame, including the latch window, or the feet point one way
    // while the barrel goes the other.
    for (const sign of [1, -1] as const) {
      for (const row of ride(sign).rows) {
        if (Math.abs(row.signed) <= STANDING_WALK_MIN_SPEED) continue;
        expect(row.backwards).toBe(row.roll > 0);
      }
    }
  });

  it('keeps the rider stride a positive RATE in both directions', () => {
    // Only the flag carries direction; a negative anim speed would run the
    // clip backwards on top of an already-backwards clip.
    const fwd = ride(1);
    const back = ride(-1);
    expect(fwd.st.speed).toBeGreaterThan(0);
    expect(back.st.speed).toBeCloseTo(fwd.st.speed, 10);
    expect(back.st.running).toBe(false);
  });

  it('never lets the contact patch fight the ground it is travelling over', () => {
    // The property the whole feature exists for, asserted in BOTH directions:
    // arc swept equals ground covered, with the same sign. A forward roll under
    // backward travel breaks this by 2x the distance, which is exactly what the
    // review saw.
    for (const sign of [1, -1] as const) {
      const frames = 30;
      const speed = 4.55;
      const r = ride(sign, frames, speed);
      const arc = asSigned(r.view.mountRoll) * BARREL.rollRadius;
      // The locomotion track smooths speed, so compare the SIGN and the
      // magnitude band rather than an exact distance: it must never come out
      // opposed to travel, and never larger than the ground actually covered.
      expect(Math.sign(arc)).toBe(sign);
      expect(Math.abs(arc)).toBeLessThanOrEqual(speed * frames * FPS + 1e-9);
      expect(Math.abs(arc)).toBeGreaterThan(0);
    }
  });
});

describe('signedTravelSpeed rejoins the magnitude and the direction latch', () => {
  it('negates only while the track reads backwards', () => {
    expect(signedTravelSpeed({ speed: 7, moving: true, backwards: false, running: true })).toBe(7);
    expect(signedTravelSpeed({ speed: 7, moving: true, backwards: true, running: false })).toBe(-7);
  });

  it('is zero-signed while parked, so a stopped mount does not creep', () => {
    expect(signedTravelSpeed(newLocoState())).toBe(0);
  });

  it('feeds the roll and the gait from the SAME latch', () => {
    // The two consumers cannot disagree even mid-latch: the direction flag is
    // read once, by both. Three frames is the locomotion track's confirm window
    // for a direction change, so this samples inside it.
    const track = newLocoTrack();
    const loco = newLocoState();
    const st = { ...IDLE } as AnimState;
    for (let i = 0; i < 40; i++) updateLocomotionInto(loco, track, 0, 4.55 * FPS, 0, FPS);
    for (let i = 0; i < 2; i++) updateLocomotionInto(loco, track, 0, -4.55 * FPS, 0, FPS);
    // Still latched forward inside the confirm window...
    expect(loco.backwards).toBe(false);
    applyStandingRider(st, loco);
    expect(st.backwards).toBe(signedTravelSpeed(loco) > 0);
    // ...and once it flips, both flip together.
    for (let i = 0; i < 4; i++) updateLocomotionInto(loco, track, 0, -4.55 * FPS, 0, FPS);
    expect(loco.backwards).toBe(true);
    applyStandingRider(st, loco);
    expect(st.backwards).toBe(signedTravelSpeed(loco) > 0);
    expect(st.backwards).toBe(false);
  });
});
