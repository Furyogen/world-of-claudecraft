import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GAUNTLET,
  GAUNTLET_VENUE,
  nearestSigilRingSlot,
  sigilFocusPose,
  sigilRingOffset,
  sigilStation,
} from '../src/sim/content/gauntlet';
import { type SigilOutline, sigilOutline } from '../src/sim/gauntlet/sigil_shapes';
import { seatSigilsField } from '../src/sim/gauntlet/trial_sigils';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { groundHeight } from '../src/sim/world';

// --- local helpers (not shared; copied idioms from gauntlet.test.ts) ---

const makeSim = (seed = 42) =>
  new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    gauntletAlwaysOpen: true,
    gauntletInstantLobby: true,
  });

function recruiter(sim: Sim) {
  return [...sim.entities.values()].find((e) => e.templateId === 'gauntlet_recruiter');
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Instant-lobby join: tick once so the recruiter spawns, then stand beside it
// and join (the run starts on the spot in single-player).
function openAndJoin(sim: Sim, pid: number) {
  sim.tick();
  const r = recruiter(sim)!;
  teleport(sim, pid, r.pos.x, r.pos.z);
  sim.gauntletJoin(pid);
}

function advanceToTrial(sim: Sim, maxTicks = 20 * 40) {
  for (let i = 0; i < maxTicks && sim.gauntletRuns[0]?.phase !== 'trial'; i++) sim.tick();
}

// Point on a closed outline at a target arc-fraction (0..1), walking the same
// piecewise-linear polyline the scorer uses.
function pointAtArc(o: SigilOutline, frac: number): [number, number] {
  const n = o.xs.length;
  const seg = new Array<number>(n);
  let total = 0;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    seg[k] = Math.hypot(o.xs[j] - o.xs[k], o.ys[j] - o.ys[k]);
    total += seg[k];
  }
  let target = frac * total;
  for (let k = 0; k < n; k++) {
    if (target <= seg[k] || k === n - 1) {
      const j = (k + 1) % n;
      const t = seg[k] > 0 ? target / seg[k] : 0;
      return [o.xs[k] + t * (o.xs[j] - o.xs[k]), o.ys[k] + t * (o.ys[j] - o.ys[k])];
    }
    target -= seg[k];
  }
  return [o.xs[0], o.ys[0]];
}

// Drive one sim into the sigils trial and hand back the live per-player state,
// with the shape optionally forced and the crack/coverage state reset so a test
// controls the trace from a known start.
function startTrialSim(seed: number, shapeId?: number) {
  const sim = makeSim(seed);
  const pid = sim.addPlayer('warrior', 'Etcher');
  openAndJoin(sim, pid);
  advanceToTrial(sim);
  const run = sim.gauntletRuns[0]!;
  const trial = run.trial;
  if (!trial || trial.kind !== 'sigils') throw new Error('expected the sigils trial to be live');
  const sp = trial.players.get(pid)!;
  if (shapeId !== undefined) sp.shapeId = shapeId;
  sp.covered.fill(false);
  sp.coveredCount = 0;
  sp.carveBank = 0;
  sp.crack = 0;
  sp.shatters = 0;
  sp.done = false;
  sp.lastPointAt = sim.time;
  return { sim, pid, run, trial, sp };
}

// -----------------------------------------------------------------------------

describe('sigil shapes (pure)', () => {
  const n = GAUNTLET.sigils.outlinePoints;

  it('sigilOutline is deterministic per (seed, shapeId, points) and varies with the seed', () => {
    const a = sigilOutline(12345, 2, n);
    const b = sigilOutline(12345, 2, n);
    expect(a).toEqual(b);
    expect(a.xs.length).toBe(n);
    expect(a.ys.length).toBe(n);
    expect(a.thin.length).toBe(n);
    // a different seed yields a different (rotated/scaled) outline
    expect(sigilOutline(67890, 2, n).xs).not.toEqual(a.xs);
  });

  it('every vertex of every shape stays inside the unit square', () => {
    for (const id of [0, 1, 2, 3, 4]) {
      const o = sigilOutline(4242, id, n);
      for (let i = 0; i < n; i++) {
        expect(o.xs[i]).toBeGreaterThanOrEqual(0);
        expect(o.xs[i]).toBeLessThanOrEqual(1);
        expect(o.ys[i]).toBeGreaterThanOrEqual(0);
        expect(o.ys[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the circle carries no thin sections; every cornered shape does', () => {
    // 0 triangle, 1 circle, 2 star, 3 rectangle, 4 hexagon.
    expect(sigilOutline(1, 1, n).thin.some(Boolean)).toBe(false); // circle: smooth
    for (const id of [0, 2, 3, 4]) {
      const o = sigilOutline(1, id, n);
      expect(o.thin.some(Boolean)).toBe(true); // corners are fragile
      // the thin band is a minority of the loop, not the whole shape
      expect(o.thin.filter(Boolean).length).toBeLessThan(n);
    }
  });
});

describe('sigil trial scoring', () => {
  const savedTrials = [...GAUNTLET.trials];
  const savedTargets = [...GAUNTLET.targetSurvivorsPerTrial];
  beforeAll(() => {
    GAUNTLET.trials.splice(0, GAUNTLET.trials.length, 'sigils');
    GAUNTLET.targetSurvivorsPerTrial.splice(0, GAUNTLET.targetSurvivorsPerTrial.length, 12);
  });
  afterAll(() => {
    GAUNTLET.trials.splice(0, GAUNTLET.trials.length, ...savedTrials);
    GAUNTLET.targetSurvivorsPerTrial.splice(
      0,
      GAUNTLET.targetSurvivorsPerTrial.length,
      ...savedTargets,
    );
  });

  it('the field mans the ring lecterns: the player first, the NPCs behind them', () => {
    const { sim, run, pid } = startTrialSim(31);
    const { ring } = GAUNTLET_VENUE.sigils;
    const offset = sigilRingOffset(run.seed);
    const npcs = run.contestants.filter((c) => !c.player && c.eliminatedAtTrial === null);
    expect(npcs.length).toBeGreaterThan(ring.count); // the ring fills, extras rank behind

    // Station seq 0 is the lone player's; the NPC field starts at seq 1, so no
    // bot is ever standing in the player's circle.
    const atStation = (id: number, seq: number) => {
      const st = sigilStation(seq, offset);
      const e = sim.entities.get(id)!;
      expect(e.pos.x).toBeCloseTo(run.origin.x + st.x, 3);
      expect(e.pos.z).toBeCloseTo(run.origin.z + st.z, 3);
      expect(e.facing).toBeCloseTo(st.facing, 3);
      return st;
    };
    const mine = atStation(pid, 0);
    for (let i = 0; i < ring.count - 1; i++) {
      const st = atStation(npcs[i].entityId, 1 + i);
      expect(st.slot).not.toBe(mine.slot);
    }
    // Every lectern of the ring is manned exactly once before anyone doubles up.
    const slots = [
      mine.slot,
      ...Array.from({ length: ring.count - 1 }, (_, i) => sigilStation(1 + i, offset).slot),
    ];
    expect(new Set(slots).size).toBe(ring.count);

    // The overflow rank stands one step further out, back at the first angle.
    const extra = sigilStation(ring.count, offset);
    expect(extra.slot).toBe(mine.slot);
    expect(
      Math.hypot(extra.x - GAUNTLET_VENUE.sigils.x, extra.z - GAUNTLET_VENUE.sigils.z),
    ).toBeCloseTo(ring.radius + 3.2, 3);
    const e = sim.entities.get(npcs[ring.count - 1].entityId)!;
    expect(e.pos.x).toBeCloseTo(run.origin.x + extra.x, 3);
  });

  it('two players each claim their own lectern, nobody shares a circle', () => {
    // NOT the instant-lobby sim: that starts the run on the first join, so a
    // second player could never be seated. Let the fill window run instead.
    const sim = new Sim({
      seed: 77,
      playerClass: 'warrior',
      noPlayer: true,
      gauntletAlwaysOpen: true,
    });
    const a = sim.addPlayer('warrior', 'Etcher');
    const b = sim.addPlayer('mage', 'Scribe');
    sim.tick(); // spawn the recruiter
    const r = recruiter(sim)!;
    teleport(sim, a, r.pos.x, r.pos.z);
    teleport(sim, b, r.pos.x, r.pos.z);
    sim.gauntletJoin(a); // both land in the same lobby before it fills
    sim.gauntletJoin(b);
    advanceToTrial(sim, 20 * 90);
    const run = sim.gauntletRuns[0]!;
    expect(run.contestants.filter((c) => c.player).length).toBe(2);

    const offset = sigilRingOffset(run.seed);
    const stA = sigilStation(0, offset);
    const stB = sigilStation(1, offset);
    expect(stA.slot).not.toBe(stB.slot); // the whole point: separate podiums
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    expect(ea.pos.x).toBeCloseTo(run.origin.x + stA.x, 3);
    expect(ea.pos.z).toBeCloseTo(run.origin.z + stA.z, 3);
    expect(eb.pos.x).toBeCloseTo(run.origin.x + stB.x, 3);
    expect(eb.pos.z).toBeCloseTo(run.origin.z + stB.z, 3);
    // Not stacked in the middle: they stand a lectern apart, and neither is on
    // the dais centre the old seating crowded.
    const V = GAUNTLET_VENUE.sigils;
    expect(Math.hypot(ea.pos.x - eb.pos.x, ea.pos.z - eb.pos.z)).toBeGreaterThan(2);
    for (const e of [ea, eb]) {
      const rad = Math.hypot(e.pos.x - run.origin.x - V.x, e.pos.z - run.origin.z - V.z);
      expect(rad).toBeCloseTo(V.ring.radius + 1.6, 3);
    }
    // Each host resolves the same station back from the position it seated.
    expect(nearestSigilRingSlot(ea.pos.x - run.origin.x - V.x, ea.pos.z - run.origin.z - V.z)).toBe(
      stA.slot,
    );
    expect(nearestSigilRingSlot(eb.pos.x - run.origin.x - V.x, eb.pos.z - run.origin.z - V.z)).toBe(
      stB.slot,
    );
    // No NPC crowds either of them.
    for (const c of run.contestants.filter((k) => !k.player && k.eliminatedAtTrial === null)) {
      const e = sim.entities.get(c.entityId)!;
      expect(Math.hypot(e.pos.x - ea.pos.x, e.pos.z - ea.pos.z)).toBeGreaterThan(1);
      expect(Math.hypot(e.pos.x - eb.pos.x, e.pos.z - eb.pos.z)).toBeGreaterThan(1);
    }

    // One of them walks out: the field recompacts on the next re-seat, so the
    // survivor takes the FIRST station and the NPC field shifts up behind them.
    // (seatSigilsField runs twice per trial, at the interlude and at the start,
    // and both calls must agree on a shrunk roster.)
    sim.gauntletLeave(a);
    seatSigilsField((sim as unknown as { ctx: SimContext }).ctx, run);
    expect(eb.pos.x).toBeCloseTo(run.origin.x + stA.x, 3); // b moved up to a's lectern
    expect(eb.pos.z).toBeCloseTo(run.origin.z + stA.z, 3);
    const firstNpc = run.contestants.find((k) => !k.player && k.eliminatedAtTrial === null)!;
    const en = sim.entities.get(firstNpc.entityId)!;
    expect(en.pos.x).toBeCloseTo(run.origin.x + stB.x, 3); // the NPCs close the gap
    expect(Math.hypot(en.pos.x - eb.pos.x, en.pos.z - eb.pos.z)).toBeGreaterThan(1);
  });

  it('the seeded ring rotation moves the field off the same lecterns run to run', () => {
    const slots = new Set<number>();
    for (let seed = 0; seed < 24; seed++) slots.add(sigilStation(0, sigilRingOffset(seed)).slot);
    expect(slots.size).toBe(GAUNTLET_VENUE.sigils.ring.count); // every station gets used
    // But it is a pure function of the seed: the interlude re-seat and the
    // trial's own re-seat must agree, or the field would shuffle mid-countdown.
    expect(sigilRingOffset(9)).toBe(sigilRingOffset(9));
    expect(sigilStation(3, 5)).toEqual(sigilStation(3, 5));
  });

  it('the camera pose rides onto whichever lectern the viewer is manning', () => {
    const V = GAUNTLET_VENUE.sigils;
    const f = GAUNTLET_VENUE.focus.sigils;
    const standoff = Math.hypot(f.pos.x - V.x, f.pos.z - V.z); // the authored standoff
    for (let slot = 0; slot < V.ring.count; slot++) {
      const st = sigilStation(slot);
      const pose = sigilFocusPose(slot);
      // Looking straight at THIS lectern's slab, at the authored slab height.
      expect(pose.lookAt.x).toBeCloseTo(st.lecternX, 6);
      expect(pose.lookAt.z).toBeCloseTo(st.lecternZ, 6);
      expect(pose.lookAt.y).toBe(f.lookAt.y);
      // Camera the authored standoff back along the radial (the etcher's side),
      // at the authored height: never inside the dais, never past the etcher.
      expect(Math.hypot(pose.pos.x - st.lecternX, pose.pos.z - st.lecternZ)).toBeCloseTo(
        standoff,
        6,
      );
      expect(pose.pos.y).toBe(f.pos.y);
      // Radially OUTSIDE the lectern, on the etcher's side: never inside the dais.
      const fromAnchor = Math.hypot(pose.pos.x - V.x, pose.pos.z - V.z);
      expect(fromAnchor).toBeCloseTo(V.ring.radius + standoff, 6);
      expect(fromAnchor).toBeGreaterThan(V.ring.radius);
    }
    // Distinct stations get distinct poses (the whole point of carrying it).
    expect(sigilFocusPose(0).pos).not.toEqual(sigilFocusPose(1).pos);
    expect(sigilFocusPose(0).lookAt).not.toEqual(sigilFocusPose(1).lookAt);
  });

  it('the shape roll picks any of the five shapes (0..4) with real variety', () => {
    // The per-run seed keys off the run-creation tick (runs.ts), so vary the
    // ticks before joining to sample distinct shape rolls.
    const seen = new Set<number>();
    for (let pre = 0; pre < 24; pre++) {
      const sim = makeSim(42);
      const pid = sim.addPlayer('warrior', 'Etcher');
      sim.tick(); // spawn the recruiter
      for (let i = 0; i < pre; i++) sim.tick(); // shift the run-creation tick
      const r = recruiter(sim)!;
      teleport(sim, pid, r.pos.x, r.pos.z);
      sim.gauntletJoin(pid);
      advanceToTrial(sim);
      const trial = sim.gauntletRuns[0]!.trial;
      if (!trial || trial.kind !== 'sigils') throw new Error('expected the sigils trial');
      const sp = trial.players.get(pid)!;
      expect(sp.shapeId).toBeGreaterThanOrEqual(0);
      expect(sp.shapeId).toBeLessThanOrEqual(4);
      seen.add(sp.shapeId);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3); // real variety across run seeds
  }, 30000);

  it('a clean, continuous on-path drag reaches done with no shatter', () => {
    const { sim, pid, run, sp } = startTrialSim(5, 1); // circle: no thin, radial from center
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 1, n);
    // Walk the arc forward in steps under the contiguity reach, so the covered
    // frontier extends without a gap; coverage grows as one connected pass.
    const paceFracPerTick = GAUNTLET.sigils.carveArcFrac * 0.8;
    let frac = 0.25; // the stroke may begin anywhere on the outline
    for (let i = 0; i < 20 * 60 && !sp.done; i++) {
      frac = (frac + paceFracPerTick) % 1;
      const [x, y] = pointAtArc(outline, frac);
      sim.gauntletTrace([x, y], pid);
      sim.tick();
    }
    expect(sp.done).toBe(true);
    expect(sp.shatters).toBe(0);
    expect(sp.crack).toBe(0);
    expect(run.playerStates.get(pid)!.finishedAt).not.toBeNull();
    // a finisher takes no end-of-trial damage
    const c = run.contestants.find((k) => k.entityId === pid)!;
    expect(c.vitality).toBe(GAUNTLET.vitalityMax);
  }, 20000);

  it('scattered dabs never stitch the loop: coverage stays a tiny seed', () => {
    const { sim, pid, sp } = startTrialSim(21, 1); // circle
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 1, n);
    // Six fixed dab spots hammered for ten seconds. Only the first seeds the
    // arc; the others land far from the covered frontier (a jump across the
    // shape), so they carve nothing. Coverage never grows past the seed.
    const spots = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].map((f) => pointAtArc(outline, f));
    for (let i = 0; i < 20 * 10 && !sp.done; i++) {
      const pts: number[] = [];
      for (const [x, y] of spots) pts.push(x, y);
      sim.gauntletTrace(pts, pid);
      sim.tick();
    }
    expect(sp.done).toBe(false);
    expect(sp.crack).toBe(0); // the dabs are all on-band, so nothing cracks
    expect(sp.coveredCount).toBeLessThan(n * 0.15); // never stitched into a loop
  });

  it('a point just outside the tightened band cracks', () => {
    const { sim, pid, sp } = startTrialSim(22, 1); // circle: the line is radial from center
    const outline = sigilOutline(sp.shapeSeed, 1, GAUNTLET.sigils.outlinePoints);
    const [px, py] = pointAtArc(outline, 0);
    const dx = px - 0.5;
    const dy = py - 0.5;
    const len = Math.hypot(dx, dy);
    // 0.07 out: well past the tightened 0.02 accept band, so it cracks.
    const off = 0.07;
    expect(off).toBeGreaterThan(GAUNTLET.sigils.tolerance);
    const p: [number, number] = [px + (dx / len) * off, py + (dy / len) * off];
    sim.tick();
    sim.gauntletTrace([p[0], p[1]], pid);
    expect(sp.crack).toBeGreaterThan(0);
    expect(sp.coveredCount).toBe(0);
  });

  it('tracing the arc BACKWARD from the seed still extends coverage', () => {
    const { sim, pid, sp } = startTrialSim(11, 1);
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 1, n);
    // Continuous backward drag under the contiguity reach: the frontier extends
    // the other way, so a trace works either direction from where it began.
    const paceFracPerTick = GAUNTLET.sigils.carveArcFrac * 0.8;
    let frac = 0.6;
    for (let i = 0; i < 20 * 3; i++) {
      frac = (frac - paceFracPerTick + 1) % 1;
      const [x, y] = pointAtArc(outline, frac);
      sim.gauntletTrace([x, y], pid);
      sim.tick();
    }
    expect(sp.coveredCount).toBeGreaterThan(5);
    expect(sp.crack).toBe(0);
  });

  it('re-tracing an already-covered arc adds nothing', () => {
    const { sim, pid, sp } = startTrialSim(12, 1);
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 1, n);
    const retrace = () => {
      // the same short arc window, walked over 3 seconds
      for (let i = 0; i < 20 * 3; i++) {
        const [x, y] = pointAtArc(outline, 0.3 + 0.1 * ((i % 20) / 20));
        sim.gauntletTrace([x, y], pid);
        sim.tick();
      }
    };
    retrace();
    const afterFirst = sp.coveredCount;
    expect(afterFirst).toBeGreaterThan(0);
    retrace();
    expect(sp.coveredCount).toBe(afterFirst); // already carved; nothing new
    expect(sp.crack).toBe(0); // staying on the band never cracks
  });

  it('feeding the whole outline in one instant is capped by the carve rate', () => {
    const { sim, pid, sp } = startTrialSim(6, 1);
    const n = GAUNTLET.sigils.outlinePoints;
    const outline = sigilOutline(sp.shapeSeed, 1, n);
    sim.tick(); // one tick elapses so the batch has a real (small) time budget
    // The outline points are in arc order, so this fat batch IS a contiguous
    // chain (each point adjacent to the last): contiguity would let it all carve,
    // but the per-second rate cap holds it to the banked budget.
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(outline.xs[i], outline.ys[i]);
    sim.gauntletTrace(pts, pid);
    expect(sp.coveredCount).toBeLessThanOrEqual(GAUNTLET.sigils.coverageCapPerS);
    expect(sp.done).toBe(false);
    expect(sp.crack).toBe(0);
  });

  it('off-band points accrue crack (double when far out) and never coverage', () => {
    const { sim, pid, sp } = startTrialSim(13, 1);
    const outline = sigilOutline(sp.shapeSeed, 1, GAUNTLET.sigils.outlinePoints);
    // A graze just outside the band vs a wild point far outside it: build both
    // from the outline's own geometry so the distances are known.
    const [px, py] = pointAtArc(outline, 0);
    const dx = px - 0.5;
    const dy = py - 0.5;
    const len = Math.hypot(dx, dy);
    const graze: [number, number] = [
      px + (dx / len) * 1.5 * GAUNTLET.sigils.tolerance,
      py + (dy / len) * 1.5 * GAUNTLET.sigils.tolerance,
    ];
    sim.tick();
    sim.gauntletTrace([graze[0], graze[1]], pid);
    const grazeCrack = sp.crack;
    expect(grazeCrack).toBeGreaterThan(0);
    expect(sp.coveredCount).toBe(0);
    // the unit-square center sits ~0.36+ from the ring, past 2x tolerance
    sp.crack = 0;
    sp.lastPointAt = sim.time;
    sim.tick();
    sim.gauntletTrace([0.5, 0.5], pid);
    expect(sp.coveredCount).toBe(0);
    expect(sp.crack).toBeCloseTo(grazeCrack * 2, 6); // the far-off doubling
  });

  it('full crack shatters: a vitality chunk, coverage resets, and play continues', () => {
    const { sim, pid, run, sp } = startTrialSim(7, 1);
    const c = run.contestants.find((k) => k.entityId === pid)!;
    const startVitality = c.vitality;
    const oldSeed = sp.shapeSeed;
    // Carve a little first so the shatter observably resets coverage.
    const outline = sigilOutline(sp.shapeSeed, 1, GAUNTLET.sigils.outlinePoints);
    const [ox, oy] = pointAtArc(outline, 0.5);
    for (let i = 0; i < 20; i++) {
      sim.gauntletTrace([ox, oy], pid);
      sim.tick();
    }
    expect(sp.coveredCount).toBeGreaterThan(0);
    // The unit-square center sits well inside the ring, far past tolerance:
    // every fed point is off the line.
    for (let i = 0; i < 20 * 30 && sp.shatters === 0; i++) {
      sim.gauntletTrace([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], pid);
      sim.tick();
    }
    expect(sp.shatters).toBe(1);
    expect(c.vitality).toBe(startVitality - GAUNTLET.sigils.shatterDamage);
    expect(sp.crack).toBe(0); // reset on shatter
    expect(sp.coveredCount).toBe(0);
    expect(sp.covered.some(Boolean)).toBe(false);
    expect(sp.shapeSeed).not.toBe(oldSeed); // a fresh etching
    // play continues: the fresh pane accepts new coverage
    const fresh = sigilOutline(sp.shapeSeed, sp.shapeId, GAUNTLET.sigils.outlinePoints);
    const [nx, ny] = pointAtArc(fresh, 0.2);
    for (let i = 0; i < 20; i++) {
      sim.gauntletTrace([nx, ny], pid);
      sim.tick();
    }
    expect(sp.coveredCount).toBeGreaterThan(0);
  }, 20000);

  it('a knocked-out etcher loses the sigils substate while the trial runs on', () => {
    const { sim, pid, run, sp } = startTrialSim(13, 1);
    const c = run.contestants.find((k) => k.entityId === pid)!;
    expect(sim.gauntletRunWire(pid)!.sigils).not.toBeNull(); // live: they have a pane
    // One more shatter is lethal, so the next off-band stroke knocks them out
    // mid-trial (not at the clock).
    c.vitality = GAUNTLET.sigils.shatterDamage;
    // The shatter (and the knockout it deals) lands inside the trace command, so
    // break BEFORE the tick that would resolve this solo trial: we want the wire
    // as the rest of the field would still see it, mid-trial.
    for (let i = 0; i < 20 * 30 && c.eliminatedAtTrial === null; i++) {
      sim.gauntletTrace([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], pid);
      if (c.eliminatedAtTrial !== null) break;
      sim.tick();
    }
    expect(c.eliminatedAtTrial).not.toBeNull();
    expect(sp.shatters).toBe(1);
    // The trial is still live, but the fallen etcher is parked at the viewing
    // spot: no pane, so the venue retires the live rig off the ring lectern they
    // vacated instead of leaving it glowing there.
    expect(sim.gauntletRuns[0]!.trial?.kind).toBe('sigils');
    expect(run.playerStates.get(pid)!.spectating).toBe(true);
    expect(sim.gauntletRunWire(pid)!.sigils).toBeNull();
  }, 30000);

  it('a player who traced nothing is knocked out at the timeout (zero coverage is fatal)', () => {
    const { sim, run } = startTrialSim(8);
    const pid = [...run.playerStates.keys()][0];
    const c = run.contestants.find((k) => k.entityId === pid)!;
    // tick through the whole trial without a single trace point
    for (let i = 0; i < 20 * 120 && sim.gauntletRuns[0]?.trial?.kind === 'sigils'; i++) {
      sim.tick();
    }
    // Resolved on the clock: zero coverage takes the full-pool end-of-trial
    // toll (damageMax === vitalityMax), which is lethal from full vitality, so
    // an idle player is eliminated rather than coasting to the next trial.
    expect(GAUNTLET.sigils.damageMax).toBe(GAUNTLET.vitalityMax);
    expect(c.vitality).toBe(0);
    expect(c.eliminatedAtTrial).not.toBeNull();
    expect(run.playerStates.get(pid)!.spectating).toBe(true);
  }, 30000);

  it('two same-seed sims fed identical trace inputs produce identical outcomes', () => {
    const scenario = () => {
      const { sim, pid, run, sp } = startTrialSim(9);
      const c = run.contestants.find((k) => k.entityId === pid)!;
      const snap: string[] = [];
      // off-path churn: crack climbs to a shatter (a per-run rng draw for the
      // fresh seed) over and over, so the stream exercises the trace-path rng
      for (let i = 0; i < 20 * 15; i++) {
        sim.gauntletTrace([0.5, 0.5, 0.5, 0.5], pid);
        sim.tick();
        snap.push(
          `${sp.crack.toFixed(6)}|${sp.coveredCount}|${sp.shatters}|${sp.shapeSeed}|${c.vitality}`,
        );
      }
      return snap;
    };
    const a = scenario();
    const b = scenario();
    expect(b).toEqual(a);
    // the scenario actually exercised scoring (at least one shatter fired)
    expect(Number(a[a.length - 1].split('|')[2])).toBeGreaterThan(0);
  }, 20000);
});
