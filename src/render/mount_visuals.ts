// Rideable-mount view data + the procedural motion math: which VISUALS key a
// sim MountKey renders as, how high the rider sits, and the bob applied to the
// clipless mounts (the hover cycle floats, the griffin canters; the snail
// glides flat). Pure and Node-tested (tests/mount_visuals.test.ts); the
// renderer is a thin consumer. The catalog itself (names, gates, combat
// numbers) is sim content: src/sim/content/mounts.ts.

import type { MountKey } from '../sim/content/mounts';
import { MOUNTS } from '../sim/content/mounts';

/** How a mount poses its rider. Every saddle mount seats them ('sit'); the
 *  Riftbound Boulder has no saddle, so its rider stands on the crown and TREADS
 *  it backward, which is what rolls the stone forward. */
export type MountRidePose = 'sit' | 'tread';

const TAU = Math.PI * 2;

export interface MountVisualSpec {
  /** VISUALS key (src/render/characters/manifest.ts, lazyPreload). */
  visualKey: string;
  /** World-unit rider lift onto the saddle at e.scale = 1. */
  seat: number;
  /** World-unit rider shift along facing (negative = toward the tail) for
   *  mounts whose saddle sits off the model origin (the toad's is well back). */
  seatFwd: number;
  /** Carries baked Idle/Walk/Run gait clips (scripts/bake_mount_gaits.mjs).
   *  The clipless rest render their generated standing pose and move via the
   *  bob below. */
  rigged: boolean;
  /** Procedural bob amplitude in world units (0 = none). */
  bobAmp: number;
  /** Bob frequency in cycles per second. */
  bobHz: number;
  /** Bob even while standing (the hover cycle floats in place). */
  bobIdle: boolean;
  /** Bob shape: a smooth hover sine, or gallop-style hops (abs sine). */
  bobShape: 'hover' | 'hop';
  /** Ambient particle effect the renderer emits for this mount: the snail's
   *  slime path while moving, the hover cycle's aether exhaust. */
  fx: 'slime' | 'exhaust' | null;
  /** How the rider is posed while riding this mount. */
  ridePose: MountRidePose;
  /** World-unit radius of a mount that ROLLS instead of walking (0 = it does
   *  not roll). One number doing two jobs, because physically it IS one number:
   *  it lifts the sphere's centre off the ground, and it turns travel into spin
   *  at omega = v / r. Keeping them the same field is what makes a mismatch
   *  impossible; a stone that skated instead of biting would read as cheap even
   *  to a player who could not say why. */
  rollRadius: number;
}

const spec = (
  visualKey: string,
  seat: number,
  rigged: boolean,
  bob?: { amp: number; hz: number; idle?: boolean; shape?: 'hover' | 'hop' },
  seatFwd = 0,
  fx: 'slime' | 'exhaust' | null = null,
  ride?: { pose?: MountRidePose; rollRadius?: number },
): MountVisualSpec => ({
  visualKey,
  seat,
  seatFwd,
  rigged,
  bobAmp: bob?.amp ?? 0,
  bobHz: bob?.hz ?? 0,
  bobIdle: bob?.idle ?? false,
  bobShape: bob?.shape ?? 'hop',
  fx,
  ridePose: ride?.pose ?? 'sit',
  rollRadius: ride?.rollRadius ?? 0,
});

export const MOUNT_VISUAL_SPECS: Record<MountKey, MountVisualSpec> = {
  // seat tuned to the authored horse model: its saddle sits forward of the
  // origin and lower than the old Tripo build, so the rider shifts toward the
  // neck and drops a touch
  valorsteed: spec('mount_valorsteed', 2.4, true, undefined, 0.15),
  grag_bear: spec('mount_grag_bear', 3.35, true, undefined, -0.8),
  stalkglider_snail: spec('mount_stalkglider_snail', 2.65, false, undefined, -0.3, 'slime'),
  aether_hover_cycle: spec(
    'mount_aether_hover_cycle',
    2.1,
    false,
    { amp: 0.14, hz: 1.1, idle: true, shape: 'hover' },
    0,
    'exhaust',
  ),
  shadowjump_toad: spec('mount_shadowjump_toad', 2.52, true, undefined, -0.5),
  // gait-rigged by bake_mount_gaits.mjs (buildPropRig): real Walk/Run clips
  // replaced the old procedural canter hop
  stormfeather_griffin: spec('mount_stormfeather_griffin', 2.75, true),
  // ships its authored strut cycle as Walk/Run plus a baked breathing Idle;
  // the saddle sits over the hips, behind the neck (hence the rear shift)
  thunderstrut_gobbler: spec('mount_thunderstrut_gobbler', 2.05, true, undefined, -0.15),
  // Compact tracked vehicle with an authored rider socket behind the turret.
  // Its rigid-body clips animate the suspension and track wheels without a
  // procedural bob, keeping the pilot locked to the saddle.
  terrorspark_groundshaker: spec('mount_terrorspark_groundshaker', 2.38, true, undefined, -0.3),
  // The Drakemaw Raptor: authored saddle sits over the hips behind the neck
  // spines (hence the slight rear shift), gait-rigged Walk/Run cycles.
  drakemaw_raptor: spec('mount_drakemaw_raptor', 2.35, true, undefined, -0.1),
  // The Riftbound Boulder: a Rift hazard stopped mid-charge and bound. Clipless
  // like the snail, but it neither walks nor bobs: it ROLLS, at the rate its own
  // travel demands. The rider stands on the crown at 2 * rollRadius (feet on top
  // of the stone) and treads it backward, which is what drives it forward.
  riftbound_boulder: spec('mount_riftbound_boulder', 1.6, false, undefined, 0, null, {
    pose: 'tread',
    rollRadius: 0.8,
  }),
};

/** Spec for an entity's active mountKey, or null when dismounted/unknown. */
export function mountVisualSpec(mountKey: string): MountVisualSpec | null {
  return mountKey in MOUNTS ? MOUNT_VISUAL_SPECS[mountKey as MountKey] : null;
}

/** World-unit rider lift for the active mountKey ('' or unknown: 0). */
export function mountSeatLift(mountKey: string): number {
  return mountVisualSpec(mountKey)?.seat ?? 0;
}

/** Procedural vertical offset for a clipless mount at time t (seconds). */
export function mountBobY(spec: MountVisualSpec, timeSec: number, moving: boolean): number {
  if (spec.bobAmp <= 0) return 0;
  if (!moving && !spec.bobIdle) return 0;
  const wave = Math.sin(timeSec * Math.PI * 2 * spec.bobHz);
  return (spec.bobShape === 'hover' ? wave : Math.abs(wave)) * spec.bobAmp;
}

/**
 * The base-pose flags a rider's mount imposes.
 *
 * Every saddle mount holds the seated pose (the sit loop reads as riding);
 * swim and cast still outrank it in desiredBaseState, so mounted casting and
 * swimming animate normally. The Riftbound Boulder is the exception: it has no
 * saddle, so its rider keeps their feet and TREADS the crown backward, which is
 * what rolls the stone forward. That reuses the rig's own backpedal cycle,
 * rate-matched to travel by locomotionTimeScale like any other walk, rather
 * than authoring a clip, and it rides the same pose seam rather than a second
 * one.
 *
 * `riderMounted` is the DISPLAYED state (the mount is built and shown), not the
 * logical one, so a rider whose mount has not finished loading keeps their own
 * locomotion instead of treading thin air. `resting` is the rider's own
 * sitting/eating/drinking, which seats them with or without a mount.
 */
export function riderPoseFlags(
  mountKey: string,
  riderMounted: boolean,
  resting: boolean,
): { sitting: boolean; treading: boolean } {
  const pose = riderMounted ? (mountVisualSpec(mountKey)?.ridePose ?? null) : null;
  return { sitting: resting || pose === 'sit', treading: pose === 'tread' };
}

/**
 * Radians a rolling mount turns over one frame of ground travel.
 *
 * The forward and lateral arguments are this frame's DISPLACEMENT in the
 * mount's own frame (world units), not velocities: displacement is the arc
 * length the contact patch actually swept, which is exactly what omega = v / r
 * integrates to, and taking it straight from displayed position means the spin
 * can never disagree with the travel it is drawn against.
 *
 * The stone always spins about its forward axis, even under a pure strafe. A
 * sphere strafing sideways would physically roll about a different axis, but
 * the rate is what sells the weight: rolling at the right rate about the wrong
 * axis reads as a stone crabbing, while holding still reads as a stone skating,
 * and the second is the failure this whole coupling exists to prevent.
 */
export function mountRollStep(
  spec: MountVisualSpec,
  forwardStep: number,
  lateralStep: number,
): number {
  if (spec.rollRadius <= 0) return 0;
  const distance = Math.hypot(forwardStep, lateralStep);
  return ((forwardStep < 0 ? -distance : distance) / spec.rollRadius) % TAU;
}

/** Accumulate a roll step, wrapped into [0, TAU). Wrapping is not cosmetic: an
 *  unwrapped angle loses float precision over a long ride and the stone starts
 *  to judder. */
export function advanceRollAngle(angle: number, step: number): number {
  const next = (angle + step) % TAU;
  return next < 0 ? next + TAU : next;
}
