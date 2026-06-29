// The WoW-style death loop: ghost release, the corpse run, and the two ways back
// to life. A self-contained game system behind the SimContext seam (it holds only
// functions; the ghost/corpse state lives on the Entity, set/cleared here).
//
// Flow:
//  1. A player dies (combat/damage.ts handleDeath): `dead = true`. The body lies
//     where it fell; another player could still resurrect it in place.
//  2. releasePlayerSpirit: the spirit leaves the body. `dead` stays true but
//     `ghost` becomes true (a ghost cannot fight or be hit, but it CAN move, runs
//     faster, and is rendered translucent), and `corpsePos` records where the body
//     is. The spirit appears at the nearest graveyard, where a Spirit Healer hovers.
//  3a. resurrectAtCorpse: run the ghost back to its body; within CORPSE_REZ_RANGE
//      it can resurrect with no penalty (RES_HP_FRACTION of its pools).
//  3b. resurrectAtSpiritHealer: accept the angel's resurrection instead, instant and
//      in place, at the cost of Resurrection Sickness (RES_SICKNESS_*). For corpses
//      that are unreachable.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now.

import {
  dungeonAt,
  instanceOrigin,
  isDelvePos,
  OVERWORLD_GRAVEYARDS,
  SPIRIT_HEALER,
  SPIRIT_HEALER_NPC_ID,
} from './data';
import { createNpc, recalcPlayerStats } from './entity';
import { releaseSpiritInDelve } from './entity_roster';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { dist2d, type Entity, type Vec3 } from './types';

// --- tuning -----------------------------------------------------------------
// A released spirit runs faster than the living, ignoring slows (a ghost cannot be
// snared): the classic ghost-run feel. Effective ghost speed is RUN_SPEED * this.
export const GHOST_RUN_MULT = 1.25;
// How close the ghost must be to its corpse to resurrect there (yards). The client
// only surfaces the "Resurrect" button inside this range; the server re-checks it.
export const CORPSE_REZ_RANGE = 35;
// How close the ghost must stand to a Spirit Healer to accept its resurrection.
export const SPIRIT_HEALER_RANGE = 8;
// Fraction of max hp/mana restored on a corpse-run resurrection (no penalty: half).
export const RES_HP_FRACTION = 0.5;
// A Spirit Healer resurrection is the worse option: it returns you at only this much
// hp/mana AND inflicts Resurrection Sickness, so the penalty-free corpse run is the
// reward for running your spirit all the way back.
export const RES_HEALER_HP_FRACTION = 0.2;
// Resurrection Sickness: a 10-minute drain to a quarter of all stats, always inflicted
// by a Spirit Healer resurrection (the corpse run is the penalty-free path).
export const RESURRECTION_SICKNESS_ID = 'resurrection_sickness';
export const RES_SICKNESS_DURATION = 600;
export const RES_SICKNESS_STAT_MULT = -0.75;

// --- graveyard selection ----------------------------------------------------

// Nearest overworld graveyard to a position (pure: a scan of the static list).
export function nearestOverworldGraveyard(x: number, z: number): { x: number; z: number } {
  let best = OVERWORLD_GRAVEYARDS[0];
  let bestD = Infinity;
  for (const g of OVERWORLD_GRAVEYARDS) {
    const dx = g.x - x;
    const dz = g.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return { x: best.x, z: best.z };
}

// The graveyard a released spirit appears at. Inside a dungeon/raid instance the
// spirit stays in the instance (it appears at the instance entry, where the
// per-instance Spirit Healer hovers) so the corpse run happens in the instance;
// outdoors it is the nearest overworld graveyard.
function ghostGraveyard(ctx: SimContext, p: Entity): { x: number; z: number } {
  const dungeon = dungeonAt(p.pos.x);
  if (dungeon) {
    for (const inst of ctx.instances) {
      if (inst.dungeonId !== dungeon.id) continue;
      const o = instanceOrigin(dungeon.index, inst.slot);
      if (Math.abs(p.pos.x - o.x) < 120 && Math.abs(p.pos.z - o.z) < 250) {
        return { x: o.x + dungeon.entry.x, z: o.z + dungeon.entry.z };
      }
    }
    // Defensive: a dungeon-band death with no matching instance falls back to the
    // overworld graveyard nearest the dungeon's door.
    return nearestOverworldGraveyard(dungeon.doorPos.x, dungeon.doorPos.z);
  }
  return nearestOverworldGraveyard(p.pos.x, p.pos.z);
}

// --- release / resurrect ----------------------------------------------------

// Release the spirit: leave the body where it fell and rise as a ghost at the
// nearest graveyard. Replaces the old instant-respawn-at-graveyard behavior.
export function releasePlayerSpirit(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (!p.dead || p.ghost) return; // not dead, or already a spirit
  if (ctx.arenaMatches.has(p.id)) return; // arena/fiesta run their own respawn
  if (isDelvePos(p.pos.x)) {
    // Delves keep their own bounded respawn rules (see entity_roster), no ghost run.
    releaseSpiritInDelve(ctx, meta.entityId);
    return;
  }
  // Mark where the body lies, then send the spirit to the graveyard.
  p.corpsePos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
  p.ghost = true; // p.dead stays true
  const gy = ghostGraveyard(ctx, p);
  p.pos = ctx.groundPos(gy.x, gy.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  p.auras = [];
  p.ccDr.clear();
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta));
  // A ghost shows a full (greyed) bar even though it is still `dead`. recalc forces
  // hp to 0 while dead, so set the display pools afterward.
  p.hp = p.maxHp;
  p.resource = p.resourceType === 'mana' ? p.maxResource : p.resourceType === 'energy' ? 100 : 0;
  p.targetId = null;
  p.autoAttack = false;
  p.queuedOnSwing = null;
  p.combatTimer = 99;
  p.inCombat = false;
  // No event: the client transitions to the ghost UI from the snapshot's ghost flag.
}

// Resurrect at the corpse (no penalty) once the ghost is within range of its body.
export function resurrectAtCorpse(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (!p.dead || !p.ghost || !p.corpsePos) return;
  // Server-authoritative range gate; the client only offers the button in range.
  if (dist2d(p.pos, p.corpsePos) > CORPSE_REZ_RANGE) return;
  reviveAt(ctx, meta, p, p.corpsePos, RES_HP_FRACTION, false);
  ctx.emit({ type: 'respawn', pid: meta.entityId });
}

// Resurrect at the Spirit Healer: instant, in place, but with Resurrection Sickness.
export function resurrectAtSpiritHealer(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const { meta, e: p } = r;
  if (!p.dead || !p.ghost) return;
  if (!spiritHealerInRange(ctx, p)) return;
  // The Spirit Healer always inflicts Resurrection Sickness and returns you at only
  // RES_HEALER_HP_FRACTION of your pools (the corpse run is the penalty-free choice).
  reviveAt(ctx, meta, p, p.pos, RES_HEALER_HP_FRACTION, true);
  ctx.emit({ type: 'respawn', pid: meta.entityId });
}

// Whether a Spirit Healer NPC stands within reach of the spirit.
function spiritHealerInRange(ctx: SimContext, p: Entity): boolean {
  for (const e of ctx.entities.values()) {
    if (e.kind !== 'npc' || e.templateId !== SPIRIT_HEALER_NPC_ID) continue;
    if (dist2d(e.pos, p.pos) <= SPIRIT_HEALER_RANGE) return true;
  }
  return false;
}

// Shared resurrection: clear the ghost/corpse state, place the body, restore half
// pools, and (when penalized) apply Resurrection Sickness.
function reviveAt(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  pos: Vec3,
  hpFrac: number,
  sickness: boolean,
): void {
  p.dead = false;
  p.ghost = false;
  p.corpsePos = null;
  p.pos = ctx.groundPos(pos.x, pos.z);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  p.auras = [];
  p.ccDr.clear();
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta));
  p.hp = Math.max(1, Math.round(p.maxHp * hpFrac));
  p.resource = p.resourceType === 'mana' ? Math.round(p.maxResource * hpFrac) : 0;
  p.targetId = null;
  p.autoAttack = false;
  p.queuedOnSwing = null;
  p.combatTimer = 99;
  p.inCombat = false;
  // Apply sickness last: applyAura -> recalcPlayerStats preserves the hp/resource
  // fractions just set, so hp settles at RES_HP_FRACTION of the reduced max.
  if (sickness) applyResurrectionSickness(ctx, p);
}

export function applyResurrectionSickness(ctx: SimContext, p: Entity): void {
  ctx.applyAura(p, {
    id: RESURRECTION_SICKNESS_ID,
    name: 'Resurrection Sickness',
    kind: 'buff_allstats_pct',
    remaining: RES_SICKNESS_DURATION,
    duration: RES_SICKNESS_DURATION,
    value: RES_SICKNESS_STAT_MULT,
    sourceId: p.id,
    school: 'shadow',
  });
}

// --- spawning the angels ----------------------------------------------------

// Spawn one Spirit Healer at a world position, returning its entity id. Reused by
// the overworld ctor pass and by the per-instance dungeon/raid spawn. createNpc
// draws no rng, so call order is determinism-neutral.
export function spawnSpiritHealerAt(ctx: SimContext, x: number, z: number): number {
  const npc = createNpc(ctx.nextId++, SPIRIT_HEALER, ctx.groundPos(x, z));
  ctx.addEntity(npc);
  return npc.id;
}

// Place an angel at every overworld graveyard. Called once from the Sim ctor.
export function spawnOverworldSpiritHealers(ctx: SimContext): void {
  for (const g of OVERWORLD_GRAVEYARDS) spawnSpiritHealerAt(ctx, g.x, g.z);
}
