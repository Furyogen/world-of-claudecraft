import { DUNGEON_X_THRESHOLD, MOBS } from '../data';
import { combatProfileForMob, effectiveMobMeleeRange, type MobCombatProfile } from '../mob_combat';
import type { SimContext } from '../sim_context';
import { clearThreat } from '../threat';
import { angleTo, DT, DUNGEON_LEASH_DISTANCE, dist2d, type Entity, LEASH_DISTANCE } from '../types';
import { retargetMob, updateMobTarget } from './targeting';

export type MobCombatProfileMode = 'chase' | 'attack';
export type MobCombatProfileResult = 'done' | 'runAttackMechanics';

type EngagedTickHook = () => void;

export function mobCombatProfile(mob: Entity): MobCombatProfile {
  return combatProfileForMob(mob.templateId, mob.scale);
}

export function mobEffectiveMeleeRange(mob: Entity): number {
  const profile = mobCombatProfile(mob);
  const mobMoved = dist2d(mob.pos, mob.prevPos) > 0.05;
  return effectiveMobMeleeRange(profile, mobMoved);
}

export function tryMobMeleeSwingInRange(ctx: SimContext, mob: Entity, target: Entity): boolean {
  if (dist2d(mob.pos, target.pos) > mobEffectiveMeleeRange(mob)) return false;
  mob.aiState = 'attack';
  mob.facing = angleTo(mob.pos, target.pos);
  if (mob.swingTimer <= 0) {
    ctx.mobSwing(mob, target);
    mob.swingTimer = mob.weapon.speed * ctx.swingIntervalMult(mob);
  }
  return true;
}

export function updateMobCombatProfile(
  ctx: SimContext,
  mob: Entity,
  mode: MobCombatProfileMode,
  onEngagedTick?: EngagedTickHook,
): MobCombatProfileResult {
  const profile = mobCombatProfile(mob);
  updateMobTarget(ctx, mob);
  const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!target || target.dead) {
    retargetMob(ctx, mob);
    return 'done';
  }
  if (ctx.maybeFlee(mob, target)) return 'done';

  const pursuitProfile = isPursuitCombatProfile(profile);
  if (profile.canLeash && (mode === 'chase' || pursuitProfile)) {
    const leash = mob.spawnPos.x > DUNGEON_X_THRESHOLD ? DUNGEON_LEASH_DISTANCE : LEASH_DISTANCE;
    const leashAnchor = mob.leashAnchor ?? mob.spawnPos;
    if (mob.fleeReturnTimer > 0) {
      mob.fleeReturnTimer = Math.max(0, mob.fleeReturnTimer - DT);
      if (dist2d(mob.pos, leashAnchor) <= leash - 1) mob.fleeReturnTimer = 0;
    }
    if (dist2d(mob.pos, leashAnchor) > leash && mob.fleeReturnTimer <= 0) {
      mob.aiState = 'evade';
      mob.aggroTargetId = null;
      clearThreat(mob);
      mob.leashAnchor = null;
      return 'done';
    }
  }

  onEngagedTick?.();

  if (pursuitProfile) {
    updatePursuitProfileCombat(ctx, mob, target, profile);
    return 'done';
  }

  if (mode === 'chase') {
    updateDefaultProfileChase(ctx, mob, target, profile);
    return 'done';
  }
  return updateDefaultProfileAttack(ctx, mob, target);
}

function isPursuitCombatProfile(profile: MobCombatProfile): boolean {
  return profile.swingWhilePursuing || profile.immediateSwingOnEnterRange || !profile.canLeash;
}

function updatePursuitProfileCombat(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  profile: MobCombatProfile,
): void {
  mob.swingTimer = Math.max(0, mob.swingTimer - DT);
  if (profile.swingWhilePursuing || mob.aiState === 'attack') {
    tryMobMeleeSwingInRange(ctx, mob, target);
  }

  if (dist2d(mob.pos, target.pos) > profile.desiredRange) {
    if (!ctx.isRooted(mob)) {
      ctx.moveToward(
        mob,
        target.pos,
        mob.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(mob),
      );
    } else {
      mob.facing = angleTo(mob.pos, target.pos);
    }
  } else {
    mob.facing = angleTo(mob.pos, target.pos);
  }

  if (
    profile.immediateSwingOnEnterRange ||
    profile.swingWhilePursuing ||
    mob.aiState === 'attack'
  ) {
    tryMobMeleeSwingInRange(ctx, mob, target);
  }
  mob.aiState = dist2d(mob.pos, target.pos) <= profile.meleeRange ? 'attack' : 'chase';
}

function updateDefaultProfileChase(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  profile: MobCombatProfile,
): void {
  const spell = MOBS[mob.templateId]?.petSpell;
  const d = dist2d(mob.pos, target.pos);
  if (spell && d <= spell.range) {
    mob.aiState = 'attack';
    mob.swingTimer = Math.min(mob.swingTimer, 0.4);
    return;
  }
  mob.swingTimer = Math.max(0, mob.swingTimer - DT);
  if (tryMobMeleeSwingInRange(ctx, mob, target)) return;
  if (!ctx.isRooted(mob)) {
    ctx.moveToward(
      mob,
      target.pos,
      mob.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(mob),
    );
  } else {
    mob.facing = angleTo(mob.pos, target.pos);
  }
  tryMobMeleeSwingInRange(ctx, mob, target);
}

function updateDefaultProfileAttack(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
): MobCombatProfileResult {
  const d = dist2d(mob.pos, target.pos);
  const spell = MOBS[mob.templateId]?.petSpell;
  if (spell) {
    if (d > spell.range) {
      mob.aiState = 'chase';
      return 'done';
    }
    ctx.updateRangedPetAttack(mob, target, spell);
    return 'done';
  }
  if (d > mobEffectiveMeleeRange(mob)) {
    mob.aiState = 'chase';
    return 'done';
  }
  mob.facing = angleTo(mob.pos, target.pos);
  mob.swingTimer -= DT;
  if (mob.swingTimer <= 0) {
    ctx.mobSwing(mob, target);
    mob.swingTimer = mob.weapon.speed * ctx.swingIntervalMult(mob);
  }
  return 'runAttackMechanics';
}
