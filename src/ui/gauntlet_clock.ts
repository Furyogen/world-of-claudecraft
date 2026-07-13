// A wall-clock estimator for the Gauntlet countdown.
//
// GauntletRunView.endsAt is an ABSOLUTE sim-time deadline, so a countdown is
// endsAt - now. IWorld exposes no sim clock to the client, though (the online
// ClientWorld mirrors none), so this anchors to each new phase deadline as it
// appears in the wire view and ticks down with the local wall clock, then reports
// an estimated sim `time` such that (endsAt - time) is the seconds left. Feeding
// that estimate into gauntletHudModel keeps its endsAt - time math exact while the
// bar/timer animate on both hosts.
//
// It re-anchors when the phase / trial / deadline changes, so latency at a phase
// flip costs at most a small one-time skew, never accumulating drift. A viewer
// whose view FIRST appears mid-phase (a late lobby joiner, a mid-run reconnect)
// would otherwise count down from the full window: the sim's `gauntletPhase`
// events carry a point-in-time `remainingS` sample, fed in via calibrate(), which
// snaps the anchor onto the true remaining time. If IWorld ever exposes a real
// sim clock, pass that straight into the model and drop this.
//
// A CLOCKLESS phase (The Great Pull) inverts the arithmetic. It has no deadline
// and no window, so its `endsAt` is the sim time the phase OPENED and sim time
// runs FORWARD from that anchor. Counting down to it instead (the windowed arm,
// with a zero window) pins the estimate AT the open time for the whole trial: a
// frozen clock, which is what left every pull circle unrendered (its absolute
// spawnAt never arrives). The two arms are what make both honest.

import type { GauntletRunView } from '../sim/types';
import { gauntletPhaseIsClockless, gauntletPhaseWindowSeconds } from './gauntlet_hud_view';

export class GauntletClock {
  private key = '';
  private anchorWallMs = 0;
  private windowS = 0;
  private calRemainingS: number | null = null;
  private calWallMs = 0;

  /** Feed a sim-emitted remaining-seconds sample (the gauntletPhase event). */
  calibrate(remainingS: number, wallNowMs: number): void {
    this.calRemainingS = remainingS;
    this.calWallMs = wallNowMs;
  }

  /** Estimated absolute sim time; on a windowed phase (run.endsAt - result) is the
   * seconds remaining, and on a clockless one (result - run.endsAt) is the seconds
   * the phase has been open. */
  estimate(run: GauntletRunView, wallNowMs: number): number {
    const key = `${run.phase}:${run.trialIndex}:${run.endsAt}`;
    if (key !== this.key) {
      this.key = key;
      this.anchorWallMs = wallNowMs;
      this.windowS = gauntletPhaseWindowSeconds(run);
    }
    if (this.calRemainingS !== null) {
      // Re-place the anchor so (window - elapsed) equals the sampled remaining
      // as of the sample's wall time. Clamped into the window so a stale or
      // out-of-range sample can never push the countdown negative or past full.
      // On a clockless phase the window is zero, so this collapses to anchoring
      // at the sample's wall time, which is exactly right: the sim emits that
      // phase event as the phase opens, and the open IS the anchor.
      const rem = Math.min(this.windowS, Math.max(0, this.calRemainingS));
      this.anchorWallMs = this.calWallMs - (this.windowS - rem) * 1000;
      this.calRemainingS = null;
    }
    const elapsed = (wallNowMs - this.anchorWallMs) / 1000;
    // Clockless: endsAt is the phase's OPEN, so sim time runs forward off it.
    if (gauntletPhaseIsClockless(run)) return run.endsAt + Math.max(0, elapsed);
    const remaining = Math.max(0, this.windowS - elapsed);
    return run.endsAt - remaining;
  }
}
