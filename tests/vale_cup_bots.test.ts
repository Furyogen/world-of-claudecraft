// Vale Cup bot-driven and on-pitch play scenarios: the parimutuel betting
// window (staged on a bot showcase), the idle-timer bot exhibition, bot
// backfill / practice, and the sport-move kit. Sharded out of
// tests/vale_cup.test.ts (which keeps the queue, matchmaking, lifecycle,
// desertion, kit-swap and determinism specs) so neither file carries the
// whole bill; fixtures live in tests/vale_cup_shared.ts.
import { describe, expect, it } from 'vitest';
import { DUNGEON_X_THRESHOLD } from '../src/sim/data';
import type { Sim } from '../src/sim/sim';
import { endCupMatch, VC_BACKFILL_WAIT, VC_MATCH_DURATION } from '../src/sim/social/vale_cup';
import type { SimEvent } from '../src/sim/types';
import {
  GOAL_LINE_EAST_X,
  GOAL_LINE_WEST_X,
  isOnPitch,
  PITCH,
  PITCH_CENTER,
} from '../src/sim/vale_cup_layout';
import { groundHeight } from '../src/sim/world';
import { addAt, makeWorld, readyAll, startBout, teleport, tickUntil } from './vale_cup_shared';

describe('Vale Cup: parimutuel betting', () => {
  // Stage a bot showcase in the briefing window, then seat two spectators at the
  // Sowfield with copper to wager.
  function stageBettableMatch() {
    const sim = makeWorld({ noPlayer: false, playerName: 'Host' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    const match = sim.vcup.match!;
    expect(match.phase).toBe('briefing');
    const s1 = addAt(sim, 'warrior', 'Bettor1', PITCH_CENTER.x, PITCH_CENTER.z - 22);
    const s2 = addAt(sim, 'warrior', 'Bettor2', PITCH_CENTER.x + 3, PITCH_CENTER.z - 22);
    sim.players.get(s1)!.copper = 1000;
    sim.players.get(s2)!.copper = 1000;
    return { sim, match, s1, s2 };
  }

  it('winners split the whole pool pro-rata and the record persists', () => {
    const { sim, match, s1, s2 } = stageBettableMatch();
    sim.vcupBet('A', 100, s1);
    sim.vcupBet('B', 300, s2);
    expect(sim.players.get(s1)!.copper).toBe(900);
    expect(sim.players.get(s2)!.copper).toBe(700);
    expect(match.bets.poolA).toBe(100);
    expect(match.bets.poolB).toBe(300);
    // A wins: winPool 100, losePool 300. s1 gets stake 100 + 100*300/100 = 400.
    endCupMatch(sim.ctx, match, 'A');
    expect(sim.players.get(s1)!.copper).toBe(900 + 400);
    expect(sim.players.get(s2)!.copper).toBe(700); // lost stake stays debited
    expect(sim.players.get(s1)!.vcupBetWins).toBe(1);
    expect(sim.players.get(s1)!.vcupBetNet).toBe(300);
    expect(sim.players.get(s2)!.vcupBetLosses).toBe(1);
    expect(sim.players.get(s2)!.vcupBetNet).toBe(-300);
  });

  it('a draw (or a winner nobody backed) refunds every stake', () => {
    const { sim, match, s1, s2 } = stageBettableMatch();
    sim.vcupBet('A', 100, s1);
    sim.vcupBet('B', 200, s2);
    endCupMatch(sim.ctx, match, null); // golden-cap draw
    expect(sim.players.get(s1)!.copper).toBe(1000); // refunded
    expect(sim.players.get(s2)!.copper).toBe(1000);
    expect(sim.players.get(s1)!.vcupBetWins).toBe(0);
    expect(sim.players.get(s1)!.vcupBetLosses).toBe(0);
  });

  it('rejects a second wager on the opposite side, allows topping up the same side', () => {
    const { sim, match, s1 } = stageBettableMatch();
    sim.vcupBet('A', 100, s1);
    sim.vcupBet('B', 50, s1); // rejected: already backed A
    expect(match.bets.poolB).toBe(0);
    expect(sim.players.get(s1)!.copper).toBe(900);
    sim.vcupBet('A', 50, s1); // top up A
    expect(match.bets.poolA).toBe(150);
    expect(match.bets.wagers.get(s1)!.stake).toBe(150);
    expect(sim.players.get(s1)!.copper).toBe(850);
  });

  it('refuses a bet from a participant, from off-site, and once betting closes', () => {
    const { sim, match, s1 } = stageBettableMatch();
    // A participant (a seated bot) cannot bet on its own match.
    const bot = match.teamA[0];
    sim.vcupBet('A', 100, bot);
    expect(match.bets.poolA).toBe(0);
    // Off-site spectator: teleport far away, the bet is refused.
    teleport(sim, s1, 0, -300);
    sim.vcupBet('A', 100, s1);
    expect(match.bets.poolA).toBe(0);
    expect(sim.players.get(s1)!.copper).toBe(1000);
    // Betting closes once the phase leaves briefing.
    teleport(sim, s1, PITCH_CENTER.x, PITCH_CENTER.z - 22);
    match.phase = 'active';
    sim.vcupBet('A', 100, s1);
    expect(match.bets.poolA).toBe(0);
  });
});

describe('Vale Cup: bot showcase', () => {
  it('auto-stages a 3v3 bot exhibition after 60s idle when showcase is enabled', () => {
    // A human is online (so someone can watch), nobody queues: after the idle
    // stretch the Sowfield stages a full bot-vs-bot match with distinct nations.
    const sim = makeWorld({ noPlayer: false, playerName: 'Watcher' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    const match = sim.vcup.match!;
    expect(match).toBeTruthy();
    expect(match.teamA.length).toBe(3);
    expect(match.teamB.length).toBe(3);
    expect(match.nationA).not.toBe(match.nationB);
    // Every fighter is a bot (no human seated in an exhibition).
    expect(sim.vcup.botPids.length).toBe(6);
    for (const pid of [...match.teamA, ...match.teamB]) {
      expect(sim.vcup.botPids.includes(pid)).toBe(true);
    }
    expect(match.rated).toBe(false);
  });

  it('does not stage a showcase when the flag is off (tests/goldens stay quiet)', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Watcher' });
    for (let i = 0; i < 20 * 65; i++) sim.tick();
    expect(sim.vcup.match).toBe(null);
  });

  it('preempts a live bot exhibition the moment two humans can form a rated match', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Watcher' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    const showcase = sim.vcup.match!;
    expect(showcase).toBeTruthy();
    expect(showcase.rated).toBe(false);
    // Two humans queue a 1v1: the exhibition must yield the pitch to them.
    const a = addAt(sim, 'mage', 'RealOne', 0, -40);
    const b = addAt(sim, 'rogue', 'RealTwo', 4, -40);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
    // A couple of ticks: preempt (frees the pitch), remove bots, seat the rated match.
    for (let i = 0; i < 4 && !(sim.vcup.match && sim.vcup.match.rated); i++) sim.tick();
    const real = sim.vcup.match!;
    expect(real).toBeTruthy();
    expect(real.id).not.toBe(showcase.id);
    expect(real.rated).toBe(true);
    expect(real.teamA).toContain(a);
    expect(real.teamB).toContain(b);
    // The showcase bots are gone (only the two real humans remain seated).
    for (const pid of [...real.teamA, ...real.teamB]) {
      expect(sim.vcup.botPids.includes(pid)).toBe(false);
    }
  });

  it('does not preempt a bot-backfilled match (a human is playing in it)', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Solo' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    // A lone human queues and gets bot-backfilled after the wait: that match has
    // a human seated, so a second late queuer must NOT tear it down.
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, sim.primaryId);
    for (let i = 0; i < VC_BACKFILL_WAIT * 20 + 4 && !sim.vcup.match; i++) sim.tick();
    const backfilled = sim.vcup.match!;
    expect(backfilled).toBeTruthy();
    expect(backfilled.rated).toBe(false);
    expect(backfilled.teamA).toContain(sim.primaryId);
    const late = addAt(sim, 'mage', 'Latecomer', 0, -40);
    sim.vcupQueueJoin(1, 'ogre', 'allrounder', false, late);
    for (let i = 0; i < 6; i++) sim.tick();
    // The human's backfilled match is untouched; the latecomer waits in queue.
    expect(sim.vcup.match!.id).toBe(backfilled.id);
    expect(sim.cupInfoFor(late)!.queued).toBe(true);
  });

  it('bots use the pass mechanic to build up in a showcase match', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Watcher' });
    (sim as unknown as { cfg: { valeCupShowcase: boolean } }).cfg.valeCupShowcase = true;
    for (let i = 0; i < 20 * 60 + 2 && !sim.vcup.match; i++) sim.tick();
    expect(sim.vcup.match).toBeTruthy();
    // Record every ability a bot casts across the briefing + a chunk of play.
    const casts: string[] = [];
    const orig = sim.castAbility.bind(sim);
    (sim as unknown as { castAbility: typeof sim.castAbility }).castAbility = (id, pid, aim) => {
      casts.push(id);
      return orig(id, pid, aim);
    };
    // Stop as soon as a pass fires (fast in the common case; the full window is
    // the upper bound so the test never runs away under full-suite load).
    for (let i = 0; i < 20 * 240 && !casts.includes('sport_pass'); i++) sim.tick();
    // The AI plays crisp lead passes in build-up (not just hopeful shots).
    expect(casts).toContain('sport_pass');
  });
});

describe('Vale Cup: bot backfill and practice', () => {
  it('backfills both sides with bots after the human unit waits out the timer (unrated)', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, a);
    for (let i = 0; i < VC_BACKFILL_WAIT * 20 - 2; i++) sim.tick();
    expect(sim.vcup.match).toBe(null); // still waiting at 59.9s
    sim.tick();
    sim.tick();
    const match = sim.vcup.match!;
    expect(match).toBeTruthy();
    expect(match.rated).toBe(false);
    expect(sim.vcup.botPids.length).toBe(3);
    expect(match.teamA[0]).toBe(a);
    // Bot names are lore-flavored and unique.
    const names = [...match.rosterA, ...match.rosterB].map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    // Unrated: ready up, force a quick decision, confirm no standing moved.
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    (match as any).scoreA = 1;
    (match as any).clock = VC_MATCH_DURATION;
    tickUntil(sim, () => sim.vcup.match === null, 20 * 20);
    expect(sim.vcup.match).toBe(null);
    expect(sim.vcup.botPids.length).toBe(0);
    const meta = sim.players.get(a)!;
    expect(meta.vcupWins + meta.vcupLosses + meta.vcupDraws).toBe(0);
  });

  it('practice seats you on a PRIVATE instanced pitch, not the physical slot', () => {
    const sim = makeWorld({ noPlayer: false, playerName: 'Solo' });
    sim.vcupPracticeStart(3);
    // The one physical Sowfield slot stays free; practice lives in its own list.
    expect(sim.vcup.match).toBe(null);
    const match = sim.vcup.practices[0];
    expect(match).toBeTruthy();
    expect(match.bracket).toBe(3);
    expect(match.rated).toBe(false);
    expect(match.practice?.ownerPid).toBe(sim.primaryId);
    expect(sim.vcup.botPids.length).toBe(5);
    expect(match.teamA[0]).toBe(sim.primaryId);
    expect(match.roles[match.teamB[0]]).toBe('keeper');
    // Seated far from the Sowfield (its own instance band), not on the real pitch.
    const me = sim.entities.get(sim.primaryId)!;
    expect(me.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
  });

  it('a full practice bout plays itself out and cleans up, returning me home', () => {
    const sim = makeWorld({ noPlayer: false, playerClass: 'hunter', playerName: 'Solo' });
    const home = { ...sim.entities.get(sim.primaryId)!.pos };
    sim.vcupPracticeStart(1);
    expect(sim.vcup.practices.length).toBe(1);
    let end: SimEvent | undefined;
    for (let i = 0; i < 20 * (VC_MATCH_DURATION + 60) && sim.vcup.practices.length > 0; i++) {
      for (const ev of sim.tick()) if (ev.type === 'vcupEnd') end = ev;
    }
    expect(sim.vcup.practices.length).toBe(0);
    expect(end).toBeTruthy();
    expect(sim.vcup.botPids.length).toBe(0);
    expect(sim.players.size).toBe(1); // bots removed
    const meta = sim.players.get(sim.primaryId)!;
    expect(meta.sportRole).toBe(null);
    expect(meta.vcupWins + meta.vcupLosses + meta.vcupDraws).toBe(0); // unrated
    // Returned to where I started (not left out in the instance band).
    const me = sim.entities.get(sim.primaryId)!;
    expect(Math.hypot(me.pos.x - home.x, me.pos.z - home.z)).toBeLessThan(2);
  });
});

describe('Vale Cup: sport moves', () => {
  // Stage a lone shooter on the ball a fixed distance out from the empty east
  // goal, facing it, then fire sport_shoot at a given charge (encoded as the aim
  // distance) and report whether it scored. No keeper, no other fighters.
  function shootFromRange(charge: number, outYd: number): { scored: boolean; maxY: number } {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Striker');
    const b = addAt(sim, 'mage', 'Keep', 4, -40);
    const match = startBout(sim, a, b);
    teleport(sim, b, PITCH.xMin + 1, PITCH.zMin + 1); // opponent far away
    const ballX = GOAL_LINE_EAST_X - outYd;
    match.ball!.x = ballX;
    match.ball!.z = PITCH_CENTER.z;
    match.ball!.y = groundHeight(ballX, PITCH_CENTER.z, sim.cfg.seed);
    match.ball!.vx = 0;
    match.ball!.vy = 0;
    match.ball!.vz = 0;
    match.ball!.holderPid = null;
    teleport(sim, a, ballX - 1.5, PITCH_CENTER.z);
    sim.entities.get(a)!.facing = Math.PI / 2; // face east at the goal
    (match as any).kickoffGraceUntil = 0; // past the whistle grace
    // Aim distance encodes charge: charge*range from the shooter.
    const r = charge * 34;
    const ae = sim.entities.get(a)!;
    sim.castAbility('sport_shoot', a, {
      x: ae.pos.x + Math.sin(ae.facing) * r,
      z: ae.pos.z + Math.cos(ae.facing) * r,
    });
    let scored = false;
    let maxY = 0;
    for (let i = 0; i < 20 * 4 && !scored; i++) {
      const gy = groundHeight(match.ball!.x, match.ball!.z, sim.cfg.seed);
      maxY = Math.max(maxY, match.ball!.y - gy);
      for (const e of sim.tick()) if (e.type === 'vcupGoal') scored = true;
    }
    return { scored, maxY };
  }

  it('Shoot: a well-judged charge scores under the bar; a max-power charge sails over', () => {
    // ~70% charge from close range is a clean goal under the bar.
    expect(shootFromRange(0.7, 10).scored).toBe(true);
    // Full charge from the same spot balloons over the crossbar: no goal.
    const maxed = shootFromRange(1, 10);
    expect(maxed.scored).toBe(false);
    expect(maxed.maxY).toBeGreaterThan(2.5); // it climbed above the bar height
  });

  it('the harvest truce floors damage between fighters to 0', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    startBout(sim, a, b);
    const ae = sim.entities.get(a)!;
    const be = sim.entities.get(b)!;
    teleport(sim, a, PITCH_CENTER.x - 3, PITCH_CENTER.z + 3);
    teleport(sim, b, PITCH_CENTER.x + 1, PITCH_CENTER.z + 3);
    // The no-damage truce: a raw damage call between fighters cannot hurt.
    const hp0 = be.hp;
    sim.dealDamage(ae, be, 50, false, 'physical', null, 'hit');
    expect(be.hp).toBe(hp0);
  });

  // A 2v2 with a1+a2 premade on team A (against two parked human solos), run to
  // active. Returns the match plus every pid so a pass test can stage positions.
  function start2v2(sim: Sim) {
    const a1 = addAt(sim, 'warrior', 'Passer');
    const a2 = addAt(sim, 'warrior', 'Mate', 2, -40);
    const s1 = addAt(sim, 'warrior', 'OppOne', 4, -40);
    const s2 = addAt(sim, 'warrior', 'OppTwo', 6, -40);
    sim.partyInvite(a2, a1);
    sim.partyAccept(a2);
    sim.drainEvents();
    sim.vcupQueueJoin(2, 'vale', 'allrounder', false, a1);
    sim.vcupQueueJoin(2, 'ogre', 'allrounder', false, s1);
    sim.vcupQueueJoin(2, 'coliseum', 'allrounder', false, s2);
    sim.tick();
    const match = sim.vcup.match!;
    expect(match.teamA).toEqual([a1, a2]);
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    expect(match.phase).toBe('active');
    return { match, a1, a2, s1, s2 };
  }

  it('Pass rolls the ball to the TARGETED teammate, leading their run', () => {
    const sim = makeWorld();
    const { match, a1, a2, s1, s2 } = start2v2(sim);
    // Passer on the ball at center; mate 12yd north; opponents parked far away.
    teleport(sim, a1, PITCH_CENTER.x, PITCH_CENTER.z);
    teleport(sim, a2, PITCH_CENTER.x, PITCH_CENTER.z + 12);
    teleport(sim, s1, PITCH.xMin + 2, PITCH_CENTER.z);
    teleport(sim, s2, PITCH.xMin + 2, PITCH_CENTER.z + 2);
    const ball = match.ball!;
    ball.x = PITCH_CENTER.x;
    ball.z = PITCH_CENTER.z;
    ball.y = groundHeight(ball.x, ball.z, sim.cfg.seed);
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.holderPid = null;
    match.kickoffGraceUntil = 0; // past the whistle grace so the pass is full weight
    sim.entities.get(a1)!.targetId = a2; // select the teammate (tab/click)
    // Aim deliberately points elsewhere: a targeted pass ignores it and finds the mate.
    sim.castAbility('sport_pass', a1, { x: PITCH_CENTER.x, z: PITCH_CENTER.z });
    expect(ball.vz).toBeGreaterThan(4); // heads north toward the mate, at real pace
    expect(Math.abs(ball.vx)).toBeLessThan(Math.abs(ball.vz));
    expect(ball.lastTouchPid).toBe(a1);
  });

  it('Pass with no teammate targeted finds the best mate toward the aim', () => {
    const sim = makeWorld();
    const { match, a1, a2, s1, s2 } = start2v2(sim);
    teleport(sim, a1, PITCH_CENTER.x, PITCH_CENTER.z);
    teleport(sim, a2, PITCH_CENTER.x + 14, PITCH_CENTER.z); // mate to the EAST
    teleport(sim, s1, PITCH.xMin + 2, PITCH_CENTER.z);
    teleport(sim, s2, PITCH.xMin + 2, PITCH_CENTER.z + 2);
    const ball = match.ball!;
    ball.x = PITCH_CENTER.x;
    ball.z = PITCH_CENTER.z;
    ball.y = groundHeight(ball.x, ball.z, sim.cfg.seed);
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.holderPid = null;
    match.kickoffGraceUntil = 0;
    sim.entities.get(a1)!.targetId = null; // nobody selected
    sim.castAbility('sport_pass', a1, { x: PITCH_CENTER.x + 10, z: PITCH_CENTER.z }); // aim east
    expect(ball.vx).toBeGreaterThan(4); // rolled east toward the only mate on that line
    expect(Math.abs(ball.vz)).toBeLessThan(Math.abs(ball.vx));
  });

  it('keeper role: grip catches a shot in the box (a save), holds, expires, and punts from the hold', () => {
    const sim = makeWorld();
    const pids: number[] = [];
    const classes = ['warrior', 'mage', 'rogue', 'priest', 'paladin', 'shaman'] as const;
    for (let i = 0; i < 6; i++) pids.push(addAt(sim, classes[i], `Fighter${i}`, i * 2, -40));
    // Six solos, bracket 3: first three seat team A, next three team B. The
    // fourth queuer (team B seat 0) keeps goal for the EAST side.
    for (let i = 0; i < 6; i++) {
      sim.vcupQueueJoin(
        3,
        i < 3 ? 'vale' : 'coliseum',
        i === 3 ? 'keeper' : 'striker',
        false,
        pids[i],
      );
    }
    sim.tick();
    const match = sim.vcup.match!;
    expect(match.roles[pids[3]]).toBe('keeper');
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    const keeper = pids[3];
    const ke = sim.entities.get(keeper)!;
    // Clear every OTHER fighter out to the corners so only the keeper stands in
    // the shot lane (body control now lets any fighter trap a shot in flight).
    for (const p of pids) {
      if (p === keeper) continue;
      teleport(sim, p, PITCH.xMin + 1, PITCH.zMin + 1);
    }
    teleport(sim, keeper, GOAL_LINE_EAST_X - 2, PITCH_CENTER.z);
    // A shot crossing the box toward the east goal, fast enough to be a save.
    const ball = match.ball!;
    ball.x = ke.pos.x - 2.5;
    ball.z = ke.pos.z;
    ball.y = groundHeight(ball.x, ball.z, sim.cfg.seed);
    ball.vx = 16;
    ball.vz = 0;
    const events = tickUntil(sim, () => ball.holderPid !== null, 10);
    expect(ball.holderPid).toBe(keeper);
    expect(events.some((e) => e.type === 'vcupSave' && (e as any).keeperName === 'Fighter3')).toBe(
      true,
    );
    // The held ball is unkickable by others...
    const striker = pids[0];
    teleport(sim, striker, ke.pos.x - 2, ke.pos.z);
    sim.castAbility('sport_shoot', striker, { x: GOAL_LINE_WEST_X, z: PITCH_CENTER.z });
    sim.tick();
    expect(ball.holderPid).toBe(keeper);
    // ...and the keeper can clear straight out of the grip with a shot. Move the
    // striker off the clearance lane first, or their body would trap it.
    teleport(sim, striker, PITCH.xMin + 1, PITCH.zMax - 1);
    sim.castAbility('sport_shoot', keeper, { x: GOAL_LINE_WEST_X, z: PITCH_CENTER.z });
    sim.tick();
    expect(ball.holderPid).toBe(null);
    expect(ball.vx).toBeLessThan(0); // launched back up the field (toward the enemy goal)
    // A re-grip needs a MOVING ball; once it settles near the keeper it stays free.
    ball.vx = 0;
    ball.vz = 0;
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(ball.holderPid).toBe(null);
  });

  it('a lone center-spot shot at kickoff cannot beat a set keeper in the first 3 seconds', () => {
    // Live-balance pin: keepers line up ON their goal line at every kickoff and
    // the whistle grace clamps a charged shot to the short-touch profile, so an
    // instant unchallenged shot from the center spot is savable, not a goal.
    const sim = makeWorld({ noPlayer: false, playerName: 'Solo' });
    sim.vcupPracticeStart(3); // the bot side's seat 0 keeps goal
    const match = sim.vcup.practices[0];
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    expect(match.phase).toBe('active');
    // The practice pitch is offset; the goal/center are shifted by match.origin.
    const goalX = GOAL_LINE_EAST_X + match.origin.x;
    const centerZ = PITCH_CENTER.z + match.origin.z;
    // The enemy keeper stands set on its goal line before the first touch.
    const keeperPid = match.teamB[0];
    expect(match.roles[keeperPid]).toBe('keeper');
    const keeperE = sim.entities.get(keeperPid)!;
    expect(Math.abs(keeperE.pos.x - goalX)).toBeLessThan(2);
    // I take the kickoff and immediately shoot straight at the goal mouth.
    sim.castAbility('sport_shoot', sim.primaryId, { x: goalX, z: centerZ });
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 3; i++) events.push(...sim.tick());
    expect(events.some((e) => e.type === 'vcupGoal')).toBe(false);
    expect(match.scoreA).toBe(0);
  });

  it('opens on a briefing: bots pre-ready, humans ready up or auto-ready at the timer', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
    sim.tick();
    const match = sim.vcup.match!;
    // Briefing is live; the kit is already swapped so the overlay can show it.
    expect(match.phase).toBe('briefing');
    expect(sim.cupInfoFor(a)!.match!.phase).toBe('briefing');
    expect(sim.cupInfoFor(a)!.match!.briefingLeft).toBeGreaterThan(0);
    expect(sim.cupInfoFor(a)!.match!.iAmReady).toBe(false);
    // One fighter readying is not enough; the other still holds the whistle.
    sim.vcupReady(a);
    sim.tick();
    expect(sim.vcup.match!.phase).toBe('briefing');
    expect(sim.cupInfoFor(a)!.match!.iAmReady).toBe(true);
    // Both ready -> the countdown starts on the next tick.
    sim.vcupReady(b);
    sim.tick();
    expect(sim.vcup.match!.phase).toBe('countdown');
  });

  it('auto-readies at the briefing timer when a fighter never readies', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    sim.vcupQueueJoin(1, 'vale', 'allrounder', false, a);
    sim.vcupQueueJoin(1, 'mirefen', 'allrounder', false, b);
    sim.tick();
    const match = sim.vcup.match!;
    // Nobody readies: the briefing times out and the match proceeds anyway.
    tickUntil(sim, () => match.phase !== 'briefing', 20 * 31);
    expect(match.phase).not.toBe('briefing');
  });

  it('kick power scales with aim distance: a short pass is softer than a long shot', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    const match = startBout(sim, a, b);
    const ae = sim.entities.get(a)!;
    const ball = match.ball!;
    // Long boot at a far aim (>= the ability reach): near full power.
    teleport(sim, a, PITCH_CENTER.x - 2, PITCH_CENTER.z);
    ball.x = PITCH_CENTER.x;
    ball.z = PITCH_CENTER.z;
    ball.y = groundHeight(ball.x, ball.z, sim.cfg.seed);
    ball.vx = 0;
    ball.vz = 0;
    ball.holderPid = null;
    ae.facing = Math.PI / 2;
    sim.castAbility('sport_shoot', a, { x: PITCH_CENTER.x + 30, z: PITCH_CENTER.z });
    sim.tick();
    const farSpeed = Math.hypot(ball.vx, ball.vz);
    // Same boot at a SHORT aim: a soft pass, clearly slower.
    ball.x = PITCH_CENTER.x;
    ball.z = PITCH_CENTER.z;
    ball.vx = 0;
    ball.vz = 0;
    ball.holderPid = null;
    teleport(sim, a, PITCH_CENTER.x - 2, PITCH_CENTER.z);
    // wait out the boot cooldown
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    sim.castAbility('sport_shoot', a, { x: PITCH_CENTER.x + 5, z: PITCH_CENTER.z });
    sim.tick();
    const shortSpeed = Math.hypot(ball.vx, ball.vz);
    expect(shortSpeed).toBeLessThan(farSpeed * 0.75);
    expect(shortSpeed).toBeGreaterThan(0); // still a real touch
  });

  it('fighters cannot walk through each other on the pitch (soft separation)', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aleph');
    const b = addAt(sim, 'mage', 'Bet', 4, -40);
    const match = startBout(sim, a, b);
    const ae = sim.entities.get(a)!;
    const be = sim.entities.get(b)!;
    // Stack both fighters on the exact same spot mid-pitch.
    teleport(sim, a, PITCH_CENTER.x, PITCH_CENTER.z + 4);
    teleport(sim, b, PITCH_CENTER.x, PITCH_CENTER.z + 4);
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    const gap = Math.hypot(ae.pos.x - be.pos.x, ae.pos.z - be.pos.z);
    expect(gap).toBeGreaterThanOrEqual(1.05); // 2 * VC_FIGHTER_RADIUS, settled apart
    // Both stayed on the pitch (the push resolves against the boards).
    expect(isOnPitch(ae.pos.x, ae.pos.z)).toBe(true);
    expect(isOnPitch(be.pos.x, be.pos.z)).toBe(true);
    // Separation is match-scoped: it ends with the match.
    expect(match.phase).not.toBe('over');
  });

  it('bot attacking is paced for a human game: few goals early, no blowout', () => {
    // Live-balance pin (the "they just quickly put it straight in" report): with
    // the human idle, the all-bot attack must not run away. Shot range gate +
    // deterministic aim error + a slower decision cadence keep the scoreline
    // human-playable. Deterministic (zero rng), so these are hard bounds.
    const sim = makeWorld({ noPlayer: false, playerName: 'Idle' });
    sim.vcupPracticeStart(3);
    const match = sim.vcup.practices[0];
    readyAll(sim);
    tickUntil(sim, () => match.phase === 'active', 20 * 6);
    const runTo = (seconds: number) => {
      while (match.clock < seconds && match.phase !== 'over') sim.tick();
    };
    // No early flurry: a handful of goals at most in the opening minute (a
    // keeper-defended pitch, not a shooting gallery).
    runTo(60);
    expect(match.scoreA + match.scoreB).toBeLessThanOrEqual(4);
    // No fast blowout: the match is not already decided (a team at the 5 cap)
    // in the first 90 seconds. Before the tuning it was 5-0 in ~30s; now a
    // keeper-defended goal keeps it a contest that plays out over minutes.
    runTo(90);
    expect(match.phase).not.toBe('over');
  });
});
