// Sim-side behavior of the game-master toolkit: the /invisible cloak
// (src/sim/admin_cloak.ts) and the /freeze hold (src/sim/admin_freeze.ts).
// The command parsing and policy live in tests/admin_commands.test.ts and
// tests/admin_tools_service.test.ts; this suite proves the world actually obeys.
import { describe, expect, it } from 'vitest';
import { isAdminCloaked, setAdminCloak, shedCloakedPresence } from '../src/sim/admin_cloak';
import {
  ADMIN_FREEZE_AURA_ID,
  ADMIN_FREEZE_DURATION_SECONDS,
  adminFreezeAura,
  applyAdminFreeze,
  clearAdminFreeze,
  isAdminFreezeAura,
  isAdminFrozen,
} from '../src/sim/admin_freeze';
import { isCancelableAura } from '../src/sim/combat/aura_cancel';
import { isRooted, isStunned } from '../src/sim/combat/cc';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { addThreat } from '../src/sim/threat';
import type { Entity, WorldContent } from '../src/sim/types';

// Wolves only: everything below needs one live wild mob near the spawn, and a
// trimmed world keeps sim.tick() cheap (the subsystem-world pattern).
const GM_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: BUILTIN_WORLD.camps.filter((camp) => camp.mobId === 'forest_wolf'),
  npcs: {},
  groundObjects: [],
};

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: GM_TEST_WORLD });
}

function nearestWolf(sim: Sim, near: Entity): Entity {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== 'forest_wolf') continue;
    const d = Math.hypot(e.pos.x - near.pos.x, e.pos.z - near.pos.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) throw new Error('no forest_wolf in the test world');
  return best;
}

describe('admin cloak: the flag', () => {
  it('sets and clears without leaving a false-y field behind', () => {
    const sim = makeSim();
    const admin = sim.entities.get(sim.addPlayer('warrior', 'Gm'))!;
    expect(isAdminCloaked(admin)).toBe(false);
    setAdminCloak(admin, true);
    expect(isAdminCloaked(admin)).toBe(true);
    setAdminCloak(admin, false);
    expect(isAdminCloaked(admin)).toBe(false);
    expect(Object.hasOwn(admin, 'adminCloak')).toBe(false);
  });
});

describe('admin cloak: unkillable', () => {
  it('takes zero damage from any source while cloaked, and normal damage after', () => {
    const sim = makeSim();
    const admin = sim.entities.get(sim.addPlayer('warrior', 'Gm'))!;
    const wolf = nearestWolf(sim, admin);
    sim.setAdminCloak(true, admin.id);
    const before = admin.hp;
    expect(sim.dealDamage(wolf, admin, 500, false, 'physical', null, 'hit', true)).toBe(0);
    expect(admin.hp).toBe(before);
    sim.setAdminCloak(false, admin.id);
    expect(sim.dealDamage(wolf, admin, 10, false, 'physical', null, 'hit', true)).toBeGreaterThan(
      0,
    );
    expect(admin.hp).toBeLessThan(before);
  });
});

describe('admin cloak: unaggroable and untargetable', () => {
  it('drops the admin out of a mob hate table and off its aggro when cloaked', () => {
    const sim = makeSim();
    const admin = sim.entities.get(sim.addPlayer('warrior', 'Gm'))!;
    const wolf = nearestWolf(sim, admin);
    addThreat(wolf, admin.id, 100);
    wolf.aggroTargetId = admin.id;
    wolf.aiState = 'chase';
    sim.setAdminCloak(true, admin.id);
    expect(wolf.threat.has(admin.id)).toBe(false);
    expect(wolf.aggroTargetId).toBeNull();
  });

  it('clears another player selection pointed at the admin', () => {
    const sim = makeSim();
    const admin = sim.entities.get(sim.addPlayer('warrior', 'Gm'))!;
    const other = sim.entities.get(sim.addPlayer('mage', 'Other'))!;
    other.targetId = admin.id;
    other.autoAttack = true;
    sim.setAdminCloak(true, admin.id);
    expect(other.targetId).toBeNull();
    expect(other.autoAttack).toBe(false);
  });

  it('refuses a re-target at the cloaked admin, and allows it again after /visible', () => {
    const sim = makeSim();
    const admin = sim.entities.get(sim.addPlayer('warrior', 'Gm'))!;
    const other = sim.entities.get(sim.addPlayer('mage', 'Other'))!;
    sim.setAdminCloak(true, admin.id);
    sim.targetEntity(admin.id, other.id);
    expect(other.targetId).toBeNull();
    sim.setAdminCloak(false, admin.id);
    sim.targetEntity(admin.id, other.id);
    expect(other.targetId).toBe(admin.id);
  });

  it('still lets the cloaked admin target other things', () => {
    const sim = makeSim();
    const admin = sim.entities.get(sim.addPlayer('warrior', 'Gm'))!;
    const wolf = nearestWolf(sim, admin);
    sim.setAdminCloak(true, admin.id);
    sim.targetEntity(wolf.id, admin.id);
    expect(admin.targetId).toBe(wolf.id);
  });

  it('shedCloakedPresence retargets only the mobs that were locked on', () => {
    const sim = makeSim();
    const admin = sim.entities.get(sim.addPlayer('warrior', 'Gm'))!;
    const wolf = nearestWolf(sim, admin);
    const retargeted: number[] = [];
    addThreat(wolf, admin.id, 5);
    wolf.aggroTargetId = admin.id;
    shedCloakedPresence(admin.id, [admin, wolf], (mob) => retargeted.push(mob.id));
    expect(retargeted).toEqual([wolf.id]);
    // A mob that never held the cloaked player is left completely alone.
    const untouched = nearestWolf(sim, admin);
    untouched.aggroTargetId = 999;
    shedCloakedPresence(admin.id, [untouched], () => retargeted.push(-1));
    expect(untouched.aggroTargetId).toBe(999);
  });
});

describe('admin freeze: the ice block', () => {
  it('applies the mage Ice Block aura, unbreakable and long-lived', () => {
    const aura = adminFreezeAura(7);
    expect(aura.id).toBe(ADMIN_FREEZE_AURA_ID);
    expect(aura.id).toBe('ice_block'); // the literal the renderer keys the ice shell on
    expect(aura.kind).toBe('stasis');
    expect(aura.unbreakableControl).toBe(true);
    expect(aura.remaining).toBe(ADMIN_FREEZE_DURATION_SECONDS);
    expect(ADMIN_FREEZE_DURATION_SECONDS).toBeGreaterThan(24 * 60 * 60);
    // Unbreakable control is also what makes it un-right-clickable by the player.
    expect(isCancelableAura(aura)).toBe(false);
  });

  it('tells its own aura apart from a mage cast Ice Block', () => {
    const mine = adminFreezeAura(1);
    const mageCast = { ...mine };
    delete (mageCast as { unbreakableControl?: true }).unbreakableControl;
    expect(isAdminFreezeAura(mine)).toBe(true);
    expect(isAdminFreezeAura(mageCast)).toBe(false);
  });

  it('freezes and releases a player, leaving a mage own Ice Block untouched', () => {
    const sim = makeSim();
    const victim = sim.entities.get(sim.addPlayer('mage', 'Victim'))!;
    const ownBlock = { ...adminFreezeAura(victim.id), remaining: 8, duration: 8 };
    delete (ownBlock as { unbreakableControl?: true }).unbreakableControl;
    victim.auras.push(ownBlock);
    expect(sim.setAdminFrozen(true, victim.id)).toBe(true);
    expect(isAdminFrozen(victim)).toBe(true);
    expect(victim.auras.filter(isAdminFreezeAura)).toHaveLength(1);
    // A second freeze is a no-op, not a second shell.
    expect(sim.setAdminFrozen(true, victim.id)).toBe(false);
    expect(victim.auras.filter(isAdminFreezeAura)).toHaveLength(1);
    expect(sim.setAdminFrozen(false, victim.id)).toBe(true);
    expect(isAdminFrozen(victim)).toBe(false);
    expect(victim.auras.filter(isAdminFreezeAura)).toHaveLength(0);
    expect(victim.auras).toContain(ownBlock);
    // Releasing twice reports the no-op instead of claiming a second release.
    expect(sim.setAdminFrozen(false, victim.id)).toBe(false);
  });

  it('locks movement and every action through the existing CC predicates', () => {
    const sim = makeSim();
    const victim = sim.entities.get(sim.addPlayer('warrior', 'Victim'))!;
    expect(isRooted(victim)).toBe(false);
    applyAdminFreeze(victim, 1);
    expect(isStunned(victim)).toBe(true);
    expect(isRooted(victim)).toBe(true);
    clearAdminFreeze(victim);
    expect(isRooted(victim)).toBe(false);
  });

  it('refuses /unstuck for as long as the freeze holds', () => {
    const sim = makeSim();
    const victim = sim.entities.get(sim.addPlayer('warrior', 'Victim'))!;
    victim.inCombat = false;
    victim.combatTimer = 100;
    sim.setAdminFrozen(true, victim.id);
    sim.drainEvents();
    expect(sim.unstuck(victim.id)).toBe(false);
    const blocked = sim.drainEvents().find((ev) => ev.type === 'unstuck' && ev.phase === 'blocked');
    expect(blocked).toMatchObject({ type: 'unstuck', phase: 'blocked', reason: 'controlled' });
  });

  it('cancels an unstuck countdown that was already running', () => {
    const sim = makeSim();
    const victim = sim.entities.get(sim.addPlayer('warrior', 'Victim'))!;
    victim.inCombat = false;
    victim.combatTimer = 100;
    expect(sim.unstuck(victim.id)).toBe(true);
    sim.drainEvents();
    sim.setAdminFrozen(true, victim.id);
    const cancelled = sim.tick().find((ev) => ev.type === 'unstuck' && ev.phase === 'cancelled');
    expect(cancelled).toMatchObject({ phase: 'cancelled', reason: 'state_changed' });
  });

  it('stops an in-flight cast when the freeze lands', () => {
    const sim = makeSim();
    const victim = sim.entities.get(sim.addPlayer('mage', 'Victim'))!;
    const wolf = nearestWolf(sim, victim);
    victim.pos = { ...wolf.pos };
    sim.targetEntity(wolf.id, victim.id);
    sim.castAbility('fireball', victim.id);
    expect(victim.castingAbility).not.toBeNull();
    sim.setAdminFrozen(true, victim.id);
    expect(victim.castingAbility).toBeNull();
  });
});
