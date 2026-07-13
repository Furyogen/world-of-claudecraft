import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  GAUNTLET,
  GAUNTLET_LAYOUT,
  GAUNTLET_VENUE,
  gauntletSpectatorSpot,
} from '../src/sim/content/gauntlet';
import { gauntletOrigin } from '../src/sim/data';
import { gauntletRunForPlayer } from '../src/sim/gauntlet/runs';
import { GAUNTLET_KEEP_OUTS, gauntletKeepOutPush } from '../src/sim/gauntlet/spectator_bounds';
import { applyVitalityDamage } from '../src/sim/gauntlet/vitality';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

// The three player-facing join modes (src/sim/gauntlet/modes.ts): the fair rolling
// queue, the always-on Practice run vs bots, and the free-roaming Spectator.

// noPlayer world with the event window open (gauntletAlwaysOpen), so joins are
// accepted. gauntletInstantLobby stays false, so a queue lobby actually waits and
// the rolling matchmaker is exercised (offline single-player uses the instant path).
const makeSim = (seed = 7, open = true) =>
  new Sim({ seed, playerClass: 'warrior', noPlayer: true, gauntletAlwaysOpen: open });

function recruiter(sim: Sim) {
  return [...sim.entities.values()].find((e) => e.templateId === 'gauntlet_recruiter')!;
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Stand a fresh player beside the recruiter (the join geo-gate) and return its pid.
function addNear(sim: Sim, name: string): number {
  const pid = sim.addPlayer('warrior', name);
  const r = recruiter(sim);
  teleport(sim, pid, r.pos.x, r.pos.z);
  return pid;
}

function advanceUntil(sim: Sim, pred: () => boolean, maxTicks = 20 * 60): void {
  for (let i = 0; i < maxTicks && !pred(); i++) sim.tick();
}

describe('The Gauntlet queue (fair, rolling)', () => {
  it('queues players FIFO and reports 1-based positions', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Aay');
    const b = addNear(sim, 'Bee');
    sim.gauntletQueueJoin(a);
    sim.gauntletQueueJoin(b);
    expect(sim.gauntletQueue.map((u) => u.pid)).toEqual([a, b]);
    expect(sim.gauntletQueuePositionOf(a)).toBe(1);
    expect(sim.gauntletQueuePositionOf(b)).toBe(2);
    // A player who is not queued reports 0.
    const c = addNear(sim, 'Cee');
    expect(sim.gauntletQueuePositionOf(c)).toBe(0);
  });

  it('the matchmaker forms one lobby from the front of the queue', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Aay');
    const b = addNear(sim, 'Bee');
    sim.gauntletQueueJoin(a);
    sim.gauntletQueueJoin(b);
    sim.tick(); // the queue matchmaker runs each tick before the run driver
    // Both seated into a single forming lobby (2 < maxRealPlayers), queue drained.
    expect(sim.gauntletQueue.length).toBe(0);
    expect(sim.gauntletRuns.length).toBe(1);
    expect(gauntletRunForPlayer(sim.ctx, a)).not.toBeNull();
    expect(gauntletRunForPlayer(sim.ctx, b)).not.toBeNull();
    expect(sim.gauntletRuns[0]!.practice).toBe(false);
  });

  it('seats a late click into the still-filling lobby (friends queue seconds apart)', () => {
    const sim = makeSim();
    const a = addNear(sim, 'First');
    sim.gauntletQueueJoin(a);
    for (let i = 0; i < 20 * 2; i++) sim.tick(); // a's lobby opened; 2s of countdown pass
    const b = addNear(sim, 'Second');
    sim.gauntletQueueJoin(b);
    sim.tick();
    // b lands in a's forming game, never stranded behind it at queue position 1.
    const run = gauntletRunForPlayer(sim.ctx, a)!;
    expect(run.phase).toBe('lobby');
    expect(gauntletRunForPlayer(sim.ctx, b)).toBe(run);
    expect(sim.gauntletQueuePositionOf(b)).toBe(0);
    advanceUntil(sim, () => run.phase !== 'lobby');
    expect(run.playerStates.has(a)).toBe(true);
    expect(run.playerStates.has(b)).toBe(true);
  });

  it('a fully abandoned run never stalls the next queue game', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Quitter');
    const b = addNear(sim, 'Friend');
    sim.gauntletQueueJoin(a);
    sim.gauntletQueueJoin(b);
    advanceUntil(sim, () => (gauntletRunForPlayer(sim.ctx, a)?.phase ?? 'lobby') !== 'lobby');
    // Both walk out mid-game (back to their saved spots beside the recruiter),
    // then immediately re-queue.
    sim.gauntletLeave(a);
    sim.gauntletLeave(b);
    sim.gauntletQueueJoin(a);
    sim.gauntletQueueJoin(b);
    sim.tick();
    // Seated into a fresh lobby right away, NOT after the 30s empty-run sweep
    // disposes the husk they abandoned.
    const run2 = gauntletRunForPlayer(sim.ctx, a);
    expect(run2).not.toBeNull();
    expect(run2!.phase).toBe('lobby');
    expect(gauntletRunForPlayer(sim.ctx, b)).toBe(run2);
  });

  it('rolls sequentially: a new queuer waits for the running game, then gets the next', () => {
    const sim = makeSim();
    const a = addNear(sim, 'First');
    sim.gauntletQueueJoin(a);
    // Advance until a's game has actually started (left the lobby phase).
    advanceUntil(sim, () => (gauntletRunForPlayer(sim.ctx, a)?.phase ?? 'lobby') !== 'lobby');
    expect(gauntletRunForPlayer(sim.ctx, a)!.phase).not.toBe('lobby');

    // b queues WHILE a's game runs: the matchmaker holds one queue game at a time.
    const b = addNear(sim, 'Second');
    sim.gauntletQueueJoin(b);
    sim.tick();
    expect(gauntletRunForPlayer(sim.ctx, b)).toBeNull(); // still waiting, not seated
    expect(sim.gauntletQueuePositionOf(b)).toBeGreaterThan(0);
    expect(sim.gauntletRuns.length).toBe(1);

    // a leaves; the abandoned run stops blocking at once (no empty-timeout wait)
    // and the NEXT game forms for b.
    sim.gauntletLeave(a);
    advanceUntil(sim, () => gauntletRunForPlayer(sim.ctx, b) !== null, 20 * 45);
    expect(gauntletRunForPlayer(sim.ctx, b)).not.toBeNull();
    expect(sim.gauntletQueuePositionOf(b)).toBe(0); // pulled out of the queue
  });

  it('there is NO in-game requeue: a finisher must leave and queue again at the recruiter', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Runner');
    sim.gauntletQueueJoin(a);
    advanceUntil(sim, () => (gauntletRunForPlayer(sim.ctx, a)?.phase ?? 'lobby') !== 'lobby');
    const run = gauntletRunForPlayer(sim.ctx, a)!;
    run.trial = null;
    run.phase = 'podium'; // their game is over; the ceremony holds

    // The requeue command is gone from the world surface entirely (it used to
    // re-queue straight from the podium, skipping the walk-up gate).
    expect('gauntletRejoin' in sim).toBe(false);

    // A player still on the podium is not queueable: they are in a run.
    sim.gauntletQueueJoin(a);
    expect(sim.gauntletQueue.map((u) => u.pid)).toEqual([]);

    // Leaving detaches them and returns them to where they joined from, which is
    // beside the recruiter: from THERE the normal walk-up queue join works.
    sim.gauntletLeave(a);
    expect(gauntletRunForPlayer(sim.ctx, a)).toBeNull();
    const e = sim.entities.get(a)!;
    const r = recruiter(sim);
    expect(Math.hypot(e.pos.x - r.pos.x, e.pos.z - r.pos.z)).toBeLessThan(GAUNTLET.joinRadius);
    sim.gauntletQueueJoin(a);
    expect(sim.gauntletQueue.map((u) => u.pid)).toEqual([a]);
  });

  it('a finished game parked on its podium never blocks the next game from forming', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Champion');
    sim.gauntletQueueJoin(a);
    advanceUntil(sim, () => (gauntletRunForPlayer(sim.ctx, a)?.phase ?? 'lobby') !== 'lobby');
    const runA = gauntletRunForPlayer(sim.ctx, a)!;
    // Fast-forward a's game to its ceremony. The podium has no clock (it holds
    // until each player leaves), so it can linger indefinitely; the
    // matchmaker must treat it as finished competition, not a live game.
    runA.trial = null;
    runA.phase = 'podium';
    runA.phaseEndsAt = sim.time;

    const b = addNear(sim, 'Next');
    sim.gauntletQueueJoin(b);
    sim.tick();
    const runB = gauntletRunForPlayer(sim.ctx, b);
    expect(runB).not.toBeNull();
    expect(runB).not.toBe(runA);
    // The lingering ceremony is untouched: a stays attached on their podium.
    expect(runA.phase).toBe('podium');
    expect(gauntletRunForPlayer(sim.ctx, a)).toBe(runA);
  });
});

describe('The Gauntlet Practice (instant, solo vs bots, always available)', () => {
  it('starts instantly with a full NPC field even when the event is closed', () => {
    const sim = makeSim(7, false); // event window CLOSED
    expect(sim.gauntletOpen).toBe(false);
    const a = addNear(sim, 'Trainee');

    // The queue is gated by the event window; Practice ignores it.
    sim.gauntletQueueJoin(a);
    expect(sim.gauntletQueuePositionOf(a)).toBe(0); // rejected while closed

    sim.gauntletPractice(undefined, a);
    const run = gauntletRunForPlayer(sim.ctx, a);
    expect(run).not.toBeNull();
    expect(run!.practice).toBe(true);
    expect(run!.phase).not.toBe('lobby'); // instant start, no fill window
    // A full field: the one real player plus NPC backfill up to fieldSize.
    expect(run!.contestants.length).toBe(GAUNTLET.fieldSize);
    expect(run!.contestants.filter((c) => c.player).length).toBe(1);
  });

  it('records no ladder stats (practice never inflates runs/wins)', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Trainee');
    sim.gauntletPractice(undefined, a);
    expect(sim.gauntletRuns[0]!.practice).toBe(true);
    const meta = sim.players.get(a)!;
    expect(meta.gauntletStats.runs).toBe(0);
  });

  it('is invisible to the queue matchmaker (does not block a rolling game)', () => {
    const sim = makeSim();
    const practicer = addNear(sim, 'Solo');
    sim.gauntletPractice(undefined, practicer);
    // A separate player queues; the matchmaker must still form their game despite
    // the live practice run occupying a slot.
    const q = addNear(sim, 'Queuer');
    sim.gauntletQueueJoin(q);
    advanceUntil(sim, () => gauntletRunForPlayer(sim.ctx, q) !== null);
    expect(gauntletRunForPlayer(sim.ctx, q)).not.toBeNull();
    expect(gauntletRunForPlayer(sim.ctx, q)!.practice).toBe(false);
  });

  it('practicing a picked game opens AT that trial, seated at its arena', () => {
    const sim = makeSim(7, false); // practice ignores the closed window
    const a = addNear(sim, 'Driller');
    const echoIndex = GAUNTLET.trials.indexOf('echo');
    sim.gauntletPractice(echoIndex, a);
    const run = gauntletRunForPlayer(sim.ctx, a)!;
    expect(run.practice).toBe(true);
    expect(run.practiceTrial).toBe(echoIndex);
    expect(run.trialIndex).toBe(echoIndex); // opens at the picked game, not trial 0
    expect(run.phase).toBe('staging');
    // The roster is the field that trial would actually see (the previous
    // trial's survivor target), never the full 30-body starting field.
    expect(run.contestants.length).toBe(GAUNTLET.targetSurvivorsPerTrial[echoIndex - 1]);
    // The field stands at the echo courtyard for the countdown, not on the
    // sentinel staging line (stagingZ = -10; the courtyard is ~100yd north).
    const e = sim.entities.get(a)!;
    expect(e.pos.z - run.origin.z).toBeGreaterThan(50);
    // Staging elapses into the picked trial itself.
    advanceUntil(sim, () => run.phase === 'trial');
    expect(run.trial?.kind).toBe('echo');
  });

  it('a picked-game practice run podiums when its one trial resolves', () => {
    const sim = makeSim(7, false);
    const a = addNear(sim, 'Driller');
    const echoIndex = GAUNTLET.trials.indexOf('echo');
    sim.gauntletPractice(echoIndex, a);
    const run = gauntletRunForPlayer(sim.ctx, a)!;
    advanceUntil(sim, () => run.phase === 'trial');
    // Ride out the whole trial window without answering: the trial resolves on
    // its clock, and a single-game practice goes straight to the podium (never
    // to an interlude for the next trial).
    advanceUntil(sim, () => run.phase !== 'trial', 20 * (GAUNTLET.echo.durationS + 10));
    expect(run.phase).toBe('podium');
    // No ladder stats from practice, exactly like the full-run harness.
    expect(sim.players.get(a)!.gauntletStats.runs).toBe(0);
  });

  it('an out-of-range trial pick falls back to the full run from trial 0', () => {
    const sim = makeSim(7, false);
    const a = addNear(sim, 'Driller');
    sim.gauntletPractice(99, a);
    const run = gauntletRunForPlayer(sim.ctx, a)!;
    expect(run.practiceTrial).toBeNull();
    expect(run.trialIndex).toBe(0);
  });

  it('a knockout parks the fallen beside the LIVE arena; the podium gathers everyone', () => {
    const sim = makeSim(7, false);
    const a = addNear(sim, 'Faller');
    const echoIndex = GAUNTLET.trials.indexOf('echo');
    sim.gauntletPractice(echoIndex, a);
    const run = gauntletRunForPlayer(sim.ctx, a)!;
    advanceUntil(sim, () => run.phase === 'trial');
    // Knock the player out mid-echo: they park at the echo courtyard's viewing
    // spot (inside the ~90yd player interest radius), NOT the sentinel-field
    // terrace 100+ yards away.
    const c = run.contestants.find((k) => k.entityId === a)!;
    applyVitalityDamage(sim.ctx, run, c, GAUNTLET.vitalityMax, 'trial');
    expect(run.playerStates.get(a)!.spectating).toBe(true);
    const e = sim.entities.get(a)!;
    const spot = gauntletSpectatorSpot('echo');
    const dPark = Math.hypot(e.pos.x - (run.origin.x + spot.x), e.pos.z - (run.origin.z + spot.z));
    expect(dPark).toBeLessThan(1);
    // The NPC field finishes without them; the single-game practice podiums,
    // and the ceremony gathers the fallen player onto the plaza in front of
    // the winners' stand (again inside interest range of the champions).
    advanceUntil(sim, () => run.phase === 'podium', 20 * (GAUNTLET.echo.durationS + 30));
    expect(run.phase).toBe('podium');
    const plazaZ = run.origin.z + GAUNTLET_LAYOUT.podium.z + 12;
    expect(Math.abs(e.pos.z - plazaZ)).toBeLessThan(6);
  });
});

describe('The Gauntlet Spectate (free-roaming observer)', () => {
  it('is in no run, watches the live board, and renders faint via the entity flag', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Contender');
    sim.gauntletQueueJoin(a);
    advanceUntil(sim, () => (gauntletRunForPlayer(sim.ctx, a)?.phase ?? 'lobby') !== 'lobby');

    const s = addNear(sim, 'Watcher');
    const savedPos = { ...sim.entities.get(s)!.pos };
    sim.gauntletSpectate(s);

    // Not a contestant anywhere, but flagged + tracked as a free spectator.
    expect(gauntletRunForPlayer(sim.ctx, s)).toBeNull();
    expect(sim.entities.get(s)!.spectator).toBe(true);
    expect(sim.gauntletSpectators.has(s)).toBe(true);
    expect(sim.gauntletSpectatingOf(s)).toBe(true);

    // The self view is the watched run's board (spectating, never "you").
    const view = sim.gauntletRunWire(s);
    expect(view).not.toBeNull();
    expect(view!.spectating).toBe(true);
    expect(view!.board.length).toBeGreaterThan(0);
    expect(view!.board.some((row) => row.you)).toBe(false);

    // Leaving clears the flag and returns them to their pre-spectate spot.
    sim.gauntletLeave(s);
    expect(sim.entities.get(s)!.spectator).toBe(false);
    expect(sim.gauntletSpectators.has(s)).toBe(false);
    expect(sim.gauntletSpectatingOf(s)).toBe(false);
    const back = sim.entities.get(s)!.pos;
    expect(Math.hypot(back.x - savedPos.x, back.z - savedPos.z)).toBeLessThan(1);
  });
});

describe('The Gauntlet spectator keep-out (watch from outside the games)', () => {
  // The pure zone core: a point inside an arena is pushed to its edge, a point
  // outside every arena is left alone (src/sim/gauntlet/spectator_bounds.ts).
  it('pushes a point inside an arena out to its boundary, and leaves an outside point alone', () => {
    const V = GAUNTLET_VENUE;

    // Dead centre of the etching dais: pushed radially out to exactly its rim.
    const dais = gauntletKeepOutPush(V.sigils.x, V.sigils.z)!;
    expect(dais).not.toBeNull();
    expect(Math.hypot(dais.x - V.sigils.x, dais.z - V.sigils.z)).toBeCloseTo(V.sigils.radius, 1);

    // Just inside the Final Court's floor: out along the same radial, not across
    // the arena (a push must never fling a watcher through the fight).
    const inCourt = gauntletKeepOutPush(V.court.x, V.court.z + V.court.radius - 1)!;
    expect(inCourt.x).toBeCloseTo(V.court.x, 6);
    expect(inCourt.z).toBeCloseTo(V.court.z + V.court.radius, 1);

    // Standing on the rope lane: out over the nearer sideline, not down its length.
    const onRope = gauntletKeepOutPush(V.pull.x + 2, V.pull.z + 1)!;
    expect(onRope.x).toBeCloseTo(V.pull.x + 2, 6);
    expect(onRope.z).toBeCloseTo(V.pull.z + V.pull.width / 2 + 1.5, 1);

    // Mid-crossing on the brittle span, and mid-field on the sentinel crossing.
    expect(gauntletKeepOutPush(V.span.x, V.span.z)).not.toBeNull();
    expect(gauntletKeepOutPush(0, GAUNTLET.sentinel.fieldLength / 2)).not.toBeNull();
    // Inside the echo courtyard (its open east side is the only way in).
    expect(gauntletKeepOutPush(V.echo.x, V.echo.z)).not.toBeNull();

    // The boundary itself is CLEAR (a strict inside test), so a pushed watcher
    // settles at the edge instead of being shoved again every tick.
    expect(gauntletKeepOutPush(V.sigils.x + V.sigils.radius, V.sigils.z)).toBeNull();
    // The staging plaza, the winners' podium, and the grandstand terrace are all
    // free ground: a spectator may stand anywhere that is not a game.
    expect(gauntletKeepOutPush(0, GAUNTLET_LAYOUT.podium.z)).toBeNull();
    expect(gauntletKeepOutPush(0, GAUNTLET_LAYOUT.stagingZ)).toBeNull();
    expect(gauntletKeepOutPush(GAUNTLET_LAYOUT.spectatorX, GAUNTLET_LAYOUT.spectatorZ)).toBeNull();
  });

  it('parks every fallen contestant outside every arena (the viewing spots are legal ground)', () => {
    // The knockout park spots and the free spectator's drop-in vantage must all
    // sit clear of the keep-out, or a spectator would spawn inside a game and be
    // shoved out of it on the very next tick.
    const kinds = [undefined, 'sentinel', 'sigils', 'pull', 'echo', 'span', 'court'] as const;
    for (const kind of kinds) {
      const spot = gauntletSpectatorSpot(kind as never);
      expect(gauntletKeepOutPush(spot.x, spot.z)).toBeNull();
    }
    expect(gauntletKeepOutPush(GAUNTLET_LAYOUT.spectatorX, GAUNTLET_LAYOUT.spectatorZ)).toBeNull();
  });

  it('shoves a free-roaming spectator who walks into a live game back out of it', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Contender');
    sim.gauntletQueueJoin(a);
    advanceUntil(sim, () => (gauntletRunForPlayer(sim.ctx, a)?.phase ?? 'lobby') !== 'lobby');
    const run = gauntletRunForPlayer(sim.ctx, a)!;

    const s = addNear(sim, 'Griefer');
    sim.gauntletSpectate(s);
    // Walk them into the middle of the Final Court's arena (the worst grief: a
    // body standing in the melee the champions are fighting in).
    const C = GAUNTLET_VENUE.court;
    teleport(sim, s, run.origin.x + C.x, run.origin.z + C.z);
    sim.tick();

    const e = sim.entities.get(s)!;
    const d = Math.hypot(e.pos.x - (run.origin.x + C.x), e.pos.z - (run.origin.z + C.z));
    expect(d).toBeCloseTo(C.radius, 1); // out on the rim, not in the ring
    expect(gauntletKeepOutPush(e.pos.x - run.origin.x, e.pos.z - run.origin.z)).toBeNull();
    // Still a spectator, still in no run: they were pushed, not ejected.
    expect(sim.gauntletSpectators.has(s)).toBe(true);
    expect(gauntletRunForPlayer(sim.ctx, s)).toBeNull();
  });

  it('shoves a knocked-out contestant out of the arena the survivors are still playing in', () => {
    const sim = makeSim();
    const a = addNear(sim, 'Faller');
    const b = addNear(sim, 'Runner');
    sim.gauntletQueueJoin(a);
    sim.gauntletQueueJoin(b);
    advanceUntil(sim, () => (gauntletRunForPlayer(sim.ctx, a)?.phase ?? 'lobby') === 'trial');
    const run = gauntletRunForPlayer(sim.ctx, a)!;
    expect(run.phase).toBe('trial'); // the crossing, with b still live in it

    const c = run.contestants.find((k) => k.entityId === a)!;
    applyVitalityDamage(sim.ctx, run, c, GAUNTLET.vitalityMax, 'trial');
    expect(run.playerStates.get(a)!.spectating).toBe(true);

    // The fallen player walks back onto the crossing, straight in front of the
    // contestants still running it: the sweep puts them out on the sideline.
    teleport(sim, a, run.origin.x, run.origin.z + GAUNTLET.sentinel.fieldLength / 2);
    sim.tick();
    const e = sim.entities.get(a)!;
    // Out on the sideline, past the field kerb and the terrace rail (the pad).
    expect(Math.abs(e.pos.x - run.origin.x)).toBeCloseTo(GAUNTLET.sentinel.fieldHalfWidth + 6, 1);
    expect(isBlocked(sim.cfg.seed, e.pos.x, e.pos.z, 0.5)).toBe(false);
    expect(gauntletKeepOutPush(e.pos.x - run.origin.x, e.pos.z - run.origin.z)).toBeNull();
    // b is still crossing: the trial ran on, and a live contestant is never pushed.
    expect(run.playerStates.get(b)!.spectating).toBe(false);
    expect(run.phase).toBe('trial');
  });

  it('leaves the walled courtyard by its DOOR: never through a wall, whichever wall is nearer', () => {
    const V = GAUNTLET_VENUE;
    const half = V.echo.size / 2;
    // The courtyard's west, north, and south sides are walls whose colliders sit
    // exactly on the footprint's edges, so "out over the nearest edge" would
    // teleport a watcher INTO a wall. Every interior point leaves east instead,
    // through the one open entrance.
    const inside: Array<[number, number]> = [
      [V.echo.x - half + 0.5, V.echo.z], // hugging the west wall
      [V.echo.x, V.echo.z + half - 0.5], // hugging the north wall
      [V.echo.x, V.echo.z - half + 0.5], // hugging the south wall
      [V.echo.x, V.echo.z], // dead centre
    ];
    for (const [x, z] of inside) {
      const out = gauntletKeepOutPush(x, z)!;
      expect(out).not.toBeNull();
      expect(out.x).toBeGreaterThan(V.echo.x + half); // east, out the door
      expect(out.z).toBe(z); // straight out: never dragged along the wall
      expect(gauntletKeepOutPush(out.x, out.z)).toBeNull();
    }
  });

  it('every landing the sweep can produce is clear ground, never inside a venue collider', () => {
    // The push writes the body straight onto its landing spot, so a landing that
    // overlaps a collider (a kerb, a courtyard wall, a rim torch) would have the
    // movement pass eject the body back inward and the sweep shove it out again,
    // tick after tick. Walk the interior of every zone and prove the landing is
    // walkable, at a real body radius, in a real venue.
    const sim = makeSim();
    const seed = sim.cfg.seed;
    const o = gauntletOrigin(0);
    for (const zone of GAUNTLET_KEEP_OUTS) {
      const hx = zone.kind === 'circle' ? zone.r : zone.hx;
      const hz = zone.kind === 'circle' ? zone.r : zone.hz;
      for (let i = -9; i <= 9; i++) {
        for (let j = -9; j <= 9; j++) {
          const lx = zone.x + (i / 10) * hx;
          const lz = zone.z + (j / 10) * hz;
          const push = gauntletKeepOutPush(lx, lz);
          if (!push) continue; // a corner of a circle's bounding box: not inside
          // Clear of every zone (one push always resolves; the zones are disjoint)
          expect(gauntletKeepOutPush(push.x, push.z)).toBeNull();
          // ...and standing on ground a body actually fits on.
          expect(isBlocked(seed, o.x + push.x, o.z + push.z, 0.5)).toBe(false);
        }
      }
    }
  });

  it('the arena keep-outs are disjoint, so a push out of one is never into another', () => {
    // gauntletKeepOutPush resolves the FIRST zone it finds and pushes once; that
    // is only sound while no two arenas overlap. A venue re-layout that packed two
    // of them together would break the sweep, so pin it.
    for (let a = 0; a < GAUNTLET_KEEP_OUTS.length; a++) {
      for (let b = a + 1; b < GAUNTLET_KEEP_OUTS.length; b++) {
        const A = GAUNTLET_KEEP_OUTS[a];
        const B = GAUNTLET_KEEP_OUTS[b];
        // Compare their bounding boxes (a superset of each zone): disjoint boxes
        // means disjoint zones.
        const ahx = A.kind === 'circle' ? A.r : A.hx;
        const ahz = A.kind === 'circle' ? A.r : A.hz;
        const bhx = B.kind === 'circle' ? B.r : B.hx;
        const bhz = B.kind === 'circle' ? B.r : B.hz;
        const gap = Math.abs(A.x - B.x) >= ahx + bhx || Math.abs(A.z - B.z) >= ahz + bhz;
        expect(gap, `zones ${a} and ${b} overlap`).toBe(true);
      }
    }
  });

  it('never pushes a LIVE contestant: the field plays inside the arena', () => {
    const sim = makeSim(7, false);
    const a = addNear(sim, 'Etcher');
    sim.gauntletPractice(GAUNTLET.trials.indexOf('sigils'), a);
    const run = gauntletRunForPlayer(sim.ctx, a)!;
    advanceUntil(sim, () => run.phase === 'trial');
    // Their own station is INSIDE the dais keep-out; the sweep must leave every
    // live contestant (player and NPC) exactly where the trial seated them.
    const e = sim.entities.get(a)!;
    const before = { x: e.pos.x, z: e.pos.z };
    const dais = Math.hypot(
      before.x - (run.origin.x + GAUNTLET_VENUE.sigils.x),
      before.z - (run.origin.z + GAUNTLET_VENUE.sigils.z),
    );
    expect(dais).toBeLessThan(GAUNTLET_VENUE.sigils.radius); // really inside the zone
    sim.tick();
    expect(e.pos.x).toBeCloseTo(before.x, 3);
    expect(e.pos.z).toBeCloseTo(before.z, 3);
  });
});
