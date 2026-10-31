// One duel, start to finish: spawn both duelists in their Season 2 kits,
// request and accept a real duel, let both prepare during the countdown, then
// tick the shared Sim with both bots until the duel ends or the time cap hits.

import { restorePet } from '../../src/sim/pet/pet_commands';
import { Rng } from '../../src/sim/rng';
import type { Sim } from '../../src/sim/sim';
import { dist2d, type Entity, type SimEvent } from '../../src/sim/types';
import { type BotState, type DuelCtx, drive, freshBotState, prepare, specAi } from './ai';
import type { SpecBuild } from './builds';
import { clearStage, DUEL_FIELD, spawnDuelist } from './setup';

export const DUEL_TIME_CAP_S = 240;
const HUNTER_PET_TEMPLATE = 'forest_wolf';

export interface DuelResult {
  a: string;
  b: string;
  seed: number;
  /** 'a' | 'b' when the duel ended on a defeat; 'timeout' at the cap. */
  winner: 'a' | 'b' | 'timeout';
  /** At a timeout: the side holding the larger health fraction (null on a tie). */
  timeoutLeader: 'a' | 'b' | null;
  seconds: number;
  hpA: number;
  hpB: number;
  dmgToA: number;
  dmgToB: number;
  castsA: Record<string, number>;
  castsB: Record<string, number>;
  trinketA: number;
  trinketB: number;
  stunnedSecA: number;
  stunnedSecB: number;
}

/** Stable 32-bit seed per (matchup, run): FNV-1a over the key, so any matrix
 *  duel replays from its specs and run index alone. */
export function duelSeed(a: string, b: string, run: number): number {
  let h = 0x811c9dc5;
  for (const ch of `${a}|${b}|${run}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}

export function specKey(b: SpecBuild): string {
  return `${b.cls}/${b.spec}`;
}

function givePet(sim: Sim, owner: Entity): void {
  restorePet(sim.ctx, owner, {
    templateId: HUNTER_PET_TEMPLATE,
    name: 'Fang',
    level: owner.level,
    hp: 1,
    dead: false,
    mode: 'defensive',
  });
  const pet = sim.petOf(owner.id, true);
  if (pet) pet.hp = pet.maxHp;
}

function tidy(sim: Sim, pid: number): void {
  if (!sim.entities.has(pid)) return;
  sim.removePlayer(pid);
}

export function runDuel(
  sim: Sim,
  buildA: SpecBuild,
  buildB: SpecBuild,
  seed: number,
  trace?: (t: number, a: Entity, b: Entity, events: SimEvent[]) => void,
): DuelResult {
  // Each duel draws its own stream: reseeding the shared Rng makes a duel
  // reproducible from (matchup, seed) no matter what ran before it on this Sim.
  clearStage(sim);
  sim.rng = new Rng(seed);
  const jitter = new Rng(seed ^ 0x5bd1e995);
  const gap = 18 + jitter.next() * 6; // 18 to 24 yards apart at the flag
  const angle = jitter.next() * Math.PI * 2;
  const cx = DUEL_FIELD.x;
  const cz = DUEL_FIELD.z;
  const ax = cx + Math.sin(angle) * (gap / 2);
  const az = cz + Math.cos(angle) * (gap / 2);
  const bx = cx - Math.sin(angle) * (gap / 2);
  const bz = cz - Math.cos(angle) * (gap / 2);

  const A = spawnDuelist(sim, buildA, 'Alpha', ax, az);
  const B = spawnDuelist(sim, buildB, 'Bravo', bx, bz);
  const ea = sim.entities.get(A.pid) as Entity;
  const eb = sim.entities.get(B.pid) as Entity;
  const aiA = specAi(buildA);
  const aiB = specAi(buildB);
  if (aiA.hunterPet) givePet(sim, ea);
  if (aiB.hunterPet) givePet(sim, eb);

  const stA: BotState = freshBotState();
  const stB: BotState = freshBotState();
  const ctxA = (): DuelCtx => ({
    sim,
    me: ea,
    foe: eb,
    build: buildA,
    foeBuild: buildB,
    dist: dist2d(ea.pos, eb.pos),
    t: activeTicks / 20,
    st: stA,
  });
  const ctxB = (): DuelCtx => ({
    sim,
    me: eb,
    foe: ea,
    build: buildB,
    foeBuild: buildA,
    dist: dist2d(ea.pos, eb.pos),
    t: activeTicks / 20,
    st: stB,
  });
  let activeTicks = 0;

  // Preparation out of combat, before the flag: buffs, forms, poisons, pets,
  // summons, stealth (stealth last so nothing after it breaks it).
  prepare(ctxA(), aiA, () => sim.tick());
  prepare(ctxB(), aiB, () => sim.tick());
  ea.hp = ea.maxHp;
  eb.hp = eb.maxHp;
  for (const e of [ea, eb]) e.resource = e.resourceType === 'rage' ? 0 : e.maxResource;
  stA.casts = {};
  stB.casts = {};

  sim.duelRequest(B.pid, A.pid);
  sim.duelAccept(B.pid);
  const duel = sim.duelFor(A.pid);
  if (!duel) throw new Error(`duel did not start for ${specKey(buildA)} vs ${specKey(buildB)}`);
  let guard = 0;
  while (duel.state === 'countdown' && guard++ < 200) sim.tick();
  // Pets go in with their owners.
  let dmgToA = 0;
  let dmgToB = 0;
  let stunnedA = 0;
  let stunnedB = 0;
  let winner: DuelResult['winner'] = 'timeout';
  const cap = DUEL_TIME_CAP_S * 20;
  let petsSent = false;
  while (activeTicks < cap) {
    const ca = ctxA();
    const cb = ctxB();
    // Alternate who decides first so neither side owns the tie on a tick.
    if (activeTicks % 2 === 0) {
      drive(ca, aiA);
      drive(cb, aiB);
    } else {
      drive(cb, aiB);
      drive(ca, aiA);
    }
    if (!petsSent) {
      sim.petAttack(A.pid);
      sim.petAttack(B.pid);
      petsSent = true;
    }
    const events: SimEvent[] = sim.tick();
    activeTicks++;
    trace?.(activeTicks / 20, ea, eb, events);
    for (const ev of events) {
      if (ev.type === 'damage') {
        const amt = (ev as { amount?: number }).amount ?? 0;
        const tid = (ev as { targetId?: number }).targetId;
        if (tid === A.pid) dmgToA += amt;
        else if (tid === B.pid) dmgToB += amt;
      } else if (ev.type === 'duelEnd') {
        winner = ev.winnerName === 'Alpha' ? 'a' : 'b';
      }
    }
    if (
      ea.auras.some((a) => a.kind === 'stun' || a.kind === 'incapacitate' || a.kind === 'polymorph')
    )
      stunnedA++;
    if (
      eb.auras.some((a) => a.kind === 'stun' || a.kind === 'incapacitate' || a.kind === 'polymorph')
    )
      stunnedB++;
    if (winner !== 'timeout') break;
    if (!sim.duelFor(A.pid)) {
      // Ended without a duelEnd event (forfeit by distance): the runner keeps
      // fights inside the 60 yd flag radius, so treat it as a fault.
      throw new Error(
        `duel ended without a winner: ${specKey(buildA)} vs ${specKey(buildB)} seed ${seed}`,
      );
    }
  }
  const hpA = ea.hp / ea.maxHp;
  const hpB = eb.hp / eb.maxHp;
  let timeoutLeader: DuelResult['timeoutLeader'] = null;
  if (winner === 'timeout') {
    if (hpA > hpB + 1e-6) timeoutLeader = 'a';
    else if (hpB > hpA + 1e-6) timeoutLeader = 'b';
  }
  const result: DuelResult = {
    a: specKey(buildA),
    b: specKey(buildB),
    seed,
    winner,
    timeoutLeader,
    seconds: activeTicks / 20,
    hpA,
    hpB,
    dmgToA,
    dmgToB,
    castsA: stA.casts,
    castsB: stB.casts,
    trinketA: stA.trinketUses,
    trinketB: stB.trinketUses,
    stunnedSecA: stunnedA / 20,
    stunnedSecB: stunnedB / 20,
  };
  // A timed-out duel is still open: close it before the duelists leave.
  if (sim.duelFor(A.pid)) {
    sim.ctx.duels.delete(A.pid);
    sim.ctx.duels.delete(B.pid);
  }
  tidy(sim, A.pid);
  tidy(sim, B.pid);
  // Let the roster drop the removed players and their pets.
  sim.tick();
  return result;
}
