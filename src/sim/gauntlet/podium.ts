// The Gauntlet podium ceremony. Once the Final Court crowns a champion the run
// enters its podium phase; this module poses the top three finishers on the
// three-step winners' stand behind the staging plaza (1st on the gold centre
// step, 2nd on silver, 3rd on bronze) and re-asserts those poses each tick so
// the tableau holds through the ceremony. The ceremony has no clock: it stands
// until each player leaves it themselves, and the emptied run is then swept away
// (runs.ts emptyFor).
//
// Positions derive from the SAME GAUNTLET_LAYOUT.podium anchors the renderer
// builds the steps from and venue_physics blocks with a collider, so an occupant
// stands exactly on the step you see. Pure placement: no rng, so an active
// ceremony never perturbs the world's global draw order.

import {
  GAUNTLET_CONTESTANT_NPC_ID,
  GAUNTLET_LAYOUT,
  gauntletContestantNpcId,
} from '../content/gauntlet';
import { NPCS } from '../data';
import { createNpc } from '../entity';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import type { GauntletContestant, GauntletPodiumSeat, GauntletRun } from './state';

/**
 * The podium order of the whole field: live players by finish time then trial
 * progress, then the surviving NPCs by skill, then the fallen LAST-OUT FIRST.
 *
 * Ranking the fallen is what decides silver and bronze on a real run: the Final
 * Court crowns exactly ONE survivor, so every other step is a knocked-out
 * contestant. It ranks on the knockout INSTANT (`eliminatedAt`), never on
 * `eliminatedAtTrial` (a whole trial's fallen share one index) and never on
 * roster order, which is JOIN order, not a finishing order: the fallen used to
 * be handed out in reverse roster order, which put every fallen NPC above a
 * knocked-out player (players are seated into the roster first), so a real
 * runner-up never made it onto their own stand.
 *
 * Two contestants CAN share an instant: a trial's end-of-trial resolution tolls
 * the players and then culls the NPC field on one tick. That tie is broken the
 * way the field itself would have broken it, in order: the player placed by
 * playing, so they take it over any NPC culled with them; and between two NPCs
 * culled together, the more skilled one placed higher (the cull itself takes the
 * least skilled first, so this agrees with it).
 *
 * Pure (no ctx, no rng, no writes) so the ordering is Node-tested directly.
 */
export function rankGauntletField(run: GauntletRun): GauntletContestant[] {
  const alive = run.contestants.filter((c) => c.eliminatedAtTrial === null);
  const players = alive
    .filter((c) => c.player && !run.playerStates.get(c.entityId)?.spectating)
    .sort((a, b) => {
      const pa = run.playerStates.get(a.entityId);
      const pb = run.playerStates.get(b.entityId);
      const fa = pa?.finishedAt ?? Number.POSITIVE_INFINITY;
      const fb = pb?.finishedAt ?? Number.POSITIVE_INFINITY;
      if (fa !== fb) return fa - fb;
      return (pb?.bestZ ?? 0) - (pa?.bestZ ?? 0);
    });
  const npcs = alive.filter((c) => !c.player).sort((a, b) => b.skill - a.skill);
  const fallen = run.contestants
    .filter((c) => c.eliminatedAtTrial !== null)
    .sort((a, b) => {
      const ea = a.eliminatedAt ?? Number.NEGATIVE_INFINITY;
      const eb = b.eliminatedAt ?? Number.NEGATIVE_INFINITY;
      if (ea !== eb) return eb - ea; // the later knockout places higher
      if (a.player !== b.player) return Number(b.player) - Number(a.player); // the player takes it
      return b.skill - a.skill; // two NPCs culled together: the better one placed higher
    });
  return [...players, ...npcs, ...fallen];
}

// Seat the top finishers on the podium steps. `ranked` is the podium order
// (players first, then surviving NPCs, then the fallen). A fallen NPC in the
// top three was DESPAWNED at its knockout, so the ceremony respawns its entity
// (same rolled kit, name, and skin) on the step: silver and bronze must never
// stand empty. Teleports each occupant onto its step now and records the poses
// on the run for holdPodiumOccupants to re-assert; disposeRun drops a
// respawned occupant with the rest of the field (c.entityId is repointed).
export function seatPodium(ctx: SimContext, run: GauntletRun, ranked: GauntletContestant[]): void {
  const P = GAUNTLET_LAYOUT.podium;
  const seats: GauntletPodiumSeat[] = [];
  for (let i = 0; i < P.steps.length; i++) {
    const c = ranked[i];
    if (!c) break;
    const step = P.steps[i];
    const wx = run.origin.x + step.x;
    const wz = run.origin.z + P.z;
    // The podium tops are real WALKABLE ground (venue_physics), so groundPos
    // here already returns this step's stand-on height: what the eye sees,
    // what the sim seats at, and what the online self pose rests on all agree.
    const wy = ctx.groundPos(wx, wz).y;
    let e = ctx.entities.get(c.entityId);
    if (!e && !c.player) {
      const def = NPCS[gauntletContestantNpcId(c.cls)] ?? NPCS[GAUNTLET_CONTESTANT_NPC_ID];
      e = createNpc(ctx.nextId++, def, { x: wx, y: wy, z: wz });
      e.name = c.name;
      e.skin = c.skin;
      c.entityId = e.id;
      ctx.addEntity(e);
    }
    if (!e || e.dead) continue;
    // Stepping onto the stand takes an occupant back out of the gallery. A small
    // live field ranks the FALLEN into the top three, and vitality.ts flags the
    // knocked-out as spectators (10% opacity), so without this a runner-up would
    // stand on their own podium step as a faint ghost.
    e.spectator = false;
    const seat: GauntletPodiumSeat = { entityId: c.entityId, x: wx, y: wy, z: wz, facing: 0 };
    seats.push(seat);
    placeOnSeat(ctx, e, seat);
  }
  run.podiumSeats = seats;
}

// Re-assert each seat's pose (the end-of-tick pin, mirroring holdStagedPlayers):
// the champion's own movement and the collider ejection off the podium block
// both run earlier in the tick, so this snaps every occupant back before the
// frame is broadcast. Skips a seat whose entity has left the world.
export function holdPodiumOccupants(ctx: SimContext, run: GauntletRun): void {
  if (!run.podiumSeats) return;
  for (const seat of run.podiumSeats) {
    const e = ctx.entities.get(seat.entityId);
    if (e) placeOnSeat(ctx, e, seat);
  }
}

// Drop a leaving player's seat so holdPodiumOccupants stops yanking their entity
// back to the podium after they have been sent home mid-ceremony.
export function releasePodiumSeat(run: GauntletRun, pid: number): void {
  if (run.podiumSeats) run.podiumSeats = run.podiumSeats.filter((s) => s.entityId !== pid);
}

// Snap an entity onto a seat: position + facing, with prevPos/prevFacing matched
// so it reads as a held pose (no interpolated slide across the map).
function placeOnSeat(ctx: SimContext, e: Entity, seat: GauntletPodiumSeat): void {
  e.pos.x = seat.x;
  e.pos.y = seat.y;
  e.pos.z = seat.z;
  e.prevPos = { x: seat.x, y: seat.y, z: seat.z };
  e.facing = seat.facing;
  e.prevFacing = seat.facing;
  ctx.rebucket(e);
}
