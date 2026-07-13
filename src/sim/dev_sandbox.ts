// A controlled practice sandbox for exercising abilities on a dev-command realm:
// a NON-offensive training dummy to build resources on, plus a small group of
// friendly LEVEL-20 allies parked at reduced health so only YOUR healing (or
// damage) moves their bars. A self-contained dev system behind the SimContext
// seam (it holds only functions; the ids it spawns are tracked on the caster's
// PlayerMeta, so each tester's sandbox is independent and is torn down with them).
//
// The two properties that keep the readout clean both go through mechanisms the
// sim already respects, not fragile overrides that a later tick undoes:
//   - The roomy health pool is a `buff_sta` Stamina aura through the normal stat
//     pipeline (recalcPlayerStats, run inside applyAura), so any future recalc
//     REBUILDS the pool instead of collapsing a raw `maxHp` write back to base.
//   - Out-of-combat regen is suppressed by the `devFreezeRegen` Entity flag,
//     which updateRegen checks and combat damage never clears, unlike a fake
//     `eating` payload (the first hit wipes that, unfreezing the bar).
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now.

import { MOBS } from './data';
import { createMob } from './entity';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

// startDevSandbox return codes. A non-negative value is the ally count spawned;
// the negative sentinels let the chat handler give specific feedback.
export const DEV_SANDBOX_NO_CASTER = 0;
export const DEV_SANDBOX_ALREADY_GROUPED = -1;

// A duration long enough that the pool aura never lapses within a session
// (~31 years of sim seconds); it is refreshed on every re-run regardless.
const DEV_SANDBOX_AURA_SECONDS = 1_000_000_000;

const SANDBOX = {
  dummyOffset: { x: -3, z: 4 },
  bots: 5,
  botZ: 2,
  botX0: 2,
  botGap: 1.5,
  // A roomy pool started low, so a healer can top the bar for a good while AND
  // watch it climb (a near-infinite pool would barely move). Approximate: the
  // Stamina aura below is sized to reach this from each bot's level-20 base.
  targetMaxHp: 10_000,
  startHpFrac: 0.15,
};

// Lift a bot's level-based pool to ~targetMaxHp with a Stamina buff. hpFromStamina
// adds ~10 HP per point above 20, so (target - base) / 10 points gets us there;
// recalcPlayerStats (run inside applyAura) rebuilds maxHp from the aura, so the
// pool survives every later recalc instead of being clobbered by one.
function applySandboxPool(ctx: SimContext, e: Entity): void {
  const base = e.maxHp;
  const sta = Math.ceil(Math.max(0, SANDBOX.targetMaxHp - base) / 10);
  ctx.applyAura(e, {
    id: 'dev_sandbox_pool',
    name: 'Sandbox Vigor',
    kind: 'buff_sta',
    value: sta,
    remaining: DEV_SANDBOX_AURA_SECONDS,
    duration: DEV_SANDBOX_AURA_SECONDS,
    sourceId: e.id,
    school: 'arcane',
  });
  // Start the bar low so there is something to heal (recalc raised maxHp, not hp).
  e.hp = Math.max(1, Math.round(e.maxHp * SANDBOX.startHpFrac));
}

// One friendly practice ally: a LEVEL-20 bot parked at an exact spot with the
// durable pool and regen frozen, so only the tester's abilities move its bar.
function spawnSandboxAlly(ctx: SimContext, name: string, x: number, z: number): number {
  // spawnDevBot handles addPlayer + the name-uniqueness gate + isDevBot; the
  // caller passes a pid-suffixed name so two testers never collide on that gate.
  const id = ctx.spawnDevBot(name);
  if (id < 0) return id;
  ctx.setPlayerLevel(20, id); // a full base pool, so healing reads as it climbs
  const e = ctx.entities.get(id);
  if (!e) return id;
  e.pos = ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  ctx.rebucket(e);
  applySandboxPool(ctx, e);
  e.devFreezeRegen = true; // updateRegen skips it; combat damage never clears it
  return id;
}

// /dev sandbox: spawn (or reset) the controlled practice scenario for `pid`.
// Returns the ally count on success, or a negative sentinel (see the consts).
export function startDevSandbox(ctx: SimContext, pid?: number): number {
  const casterId = pid ?? ctx.primaryId;
  const me = ctx.entities.get(casterId);
  if (!me) return DEV_SANDBOX_NO_CASTER;
  // Reset first: tearing down the PREVIOUS sandbox drops its allies, which leave
  // the group and disband the sandbox party, so re-running refills the hurt
  // allies instead of piling on more bodies.
  cleanupDevSandbox(ctx, casterId);
  // Never hijack a REAL group: after our own teardown, a surviving party means
  // the tester is grouped with real players. Bail rather than invite bots into it.
  if (ctx.partyOf(casterId)) return DEV_SANDBOX_ALREADY_GROUPED;
  // A NON-offensive training dummy (training_dummy is moveSpeed 0 / aggroRadius 0,
  // so nothing chases you) to build resources on before practicing on the allies.
  const dummy = createMob(
    ctx.nextId++,
    MOBS.training_dummy,
    20,
    ctx.groundPos(me.pos.x + SANDBOX.dummyOffset.x, me.pos.z + SANDBOX.dummyOffset.z),
  );
  dummy.hostile = true;
  ctx.addEntity(dummy);
  // A tight front-right cluster, close enough that the cast line of sight stays clear.
  const botIds: number[] = [];
  for (let i = 0; i < SANDBOX.bots; i++) {
    const id = spawnSandboxAlly(
      ctx,
      `Practice${i + 1}-${casterId}`,
      me.pos.x + SANDBOX.botX0 + i * SANDBOX.botGap,
      me.pos.z + SANDBOX.botZ,
    );
    if (id >= 0) botIds.push(id);
  }
  // Raid so party/raid-only support abilities reach every ally (a 5-cap party
  // would drop the last body): fill a full party, convert, then add the rest.
  for (const id of botIds.slice(0, 4)) {
    ctx.partyInvite(id, casterId);
    ctx.partyAccept(id);
  }
  if (botIds.length >= 5) ctx.convertPartyToRaid(casterId);
  for (const id of botIds.slice(4)) {
    ctx.partyInvite(id, casterId);
    ctx.partyAccept(id);
  }
  // Track exactly what THIS tester spawned, on their own PlayerMeta, so a re-run
  // (or the caster leaving) tears down only their sandbox, never another tester's.
  const meta = ctx.players.get(casterId);
  if (meta) meta.devSandboxIds = [dummy.id, ...botIds];
  return botIds.length;
}

// Despawn the caster's tracked sandbox entities. Safe to call unconditionally:
// it no-ops when the caster has no live sandbox. Invoked on re-run (reset) and
// from Sim.removePlayer (so a leaving tester's bots and dummy never linger).
export function cleanupDevSandbox(ctx: SimContext, casterId: number): void {
  const meta = ctx.players.get(casterId);
  const ids = meta?.devSandboxIds;
  if (!ids || ids.length === 0) return;
  for (const id of ids) {
    if (ctx.players.has(id)) ctx.removePlayer(id);
    else ctx.dropEntity(id);
  }
  if (meta) meta.devSandboxIds = undefined;
}
