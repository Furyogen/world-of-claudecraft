// Deterministic local recovery for players wedged in world geometry.
//
// Unstuck is deliberately not a travel primitive: the player must remain idle
// for a server-authoritative countdown, the destination is capped to eight
// yards, every candidate must be point-clear and reachable through the same
// swept collision resolver as normal movement, and the destination must remain
// in the same world/instance identity. There is no graveyard fallback.

import { isRooted, isStunned } from './combat/cc';
import {
  INSTANCE_X_BASE,
  isArenaPos,
  isDelvePos,
  isRiftPos,
  riftInstanceOrigin,
  zoneAt,
} from './data';
import { delveBlackwaterTierAt, delveModuleZOffset } from './delves/runs';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from './pathfind';
import {
  riftInstanceAtPos,
  riftPlayerLift,
  riftRecoveryPointSafe,
  riftRecoveryRoutePointClear,
} from './rift/runs';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import {
  DT,
  type Entity,
  isConsuming,
  type UnstuckArea,
  type UnstuckBlockedReason,
  type UnstuckCancelReason,
  type UnstuckEvent,
  type UnstuckPosition,
  type Vec3,
} from './types';
import { UNSTUCK_COOLDOWN_ID } from './unstuck_cooldown';
import { groundHeight, terrainSteepnessAt, terrainWallStandoff, waterLevelAt } from './world';

export const UNSTUCK_COUNTDOWN_SECONDS = 10;
export const UNSTUCK_RETRY_SECONDS = 15;
export const UNSTUCK_SUCCESS_COOLDOWN_SECONDS = 5 * 60;
export const UNSTUCK_MAX_DISTANCE = 8;
export const UNSTUCK_EMBEDDED_CORRECTION_MAX = 2;
export { UNSTUCK_COOLDOWN_ID } from './unstuck_cooldown';

const POSITION_EPS = 1e-4;
const CANCEL_MOVE_DISTANCE = 0.5;
const CANCEL_VERTICAL_DISTANCE = 0.25;
const CANDIDATE_DIRECTIONS = 16;
const CANDIDATE_RADII = [1, 2, 3, 4, 6, 8] as const;
const ROUTE_SAMPLE_DISTANCE = 0.25;

export interface PendingUnstuck {
  startedAt: number;
  endsAt: number;
  origin: UnstuckPosition;
  area: UnstuckArea;
  damageTaken: number;
  lastAnnouncedSecond: number;
}

export type CancelledUnstuckEvent = Extract<UnstuckEvent, { phase: 'cancelled' }> & {
  pid: number;
};

interface LocatedPoint {
  area: UnstuckArea;
  point: UnstuckPosition;
}

function located(area: UnstuckArea, pos: Vec3, origin: { x: number; z: number }): LocatedPoint {
  return {
    area,
    point: { ...pos, localX: pos.x - origin.x, localZ: pos.z - origin.z },
  };
}

/** Resolve a position into a stable content identity plus instance-local coords. */
export function unstuckLocationAt(ctx: SimContext, pid: number, pos: Vec3): LocatedPoint | null {
  const rift = riftInstanceAtPos(ctx, pos);
  if (rift) {
    if (!rift.memberIds.has(pid)) return null;
    const origin = riftInstanceOrigin(rift.slot, rift.floorIndex);
    return located(
      {
        kind: 'rift',
        // Content identity deliberately excludes the ephemeral event id so
        // equivalent procedural layouts aggregate into the same hotspot map.
        id: `seed:${rift.seed >>> 0}:floor:${rift.floorIndex}`,
        instanceId: String(rift.instanceId),
        slot: rift.slot,
      },
      pos,
      origin,
    );
  }
  // A coordinate in the rift band without a live owning instance is not a safe
  // recovery area. Treating it as overworld would permit a cross-instance snap.
  if (isRiftPos(pos.x)) return null;

  const delve = ctx.delveRunForPlayer(pid);
  if (delve && isDelvePos(pos.x)) {
    const moduleId = delve.modules[delve.moduleIndex];
    if (!moduleId) return null;
    const moduleOrigin = {
      x: delve.origin.x,
      z: delve.origin.z + delveModuleZOffset(delve),
    };
    return located(
      {
        kind: 'delve',
        id: `${delve.delveId}:module:${moduleId}`,
        instanceId: `seed:${delve.seed >>> 0}:tier:${delve.tierId}`,
        slot: delve.slot,
      },
      pos,
      moduleOrigin,
    );
  }
  if (isDelvePos(pos.x)) return null;

  // Resolve through the canonical live claim envelope, rather than the generic
  // 120-yard slot lookup. Nythraxis deliberately has a much wider raid floor,
  // and instanceClaimIdAt is the shared authority that includes those wings
  // while still binding the point to one live, unrecycled claim.
  const claimId = ctx.instanceClaimIdAt(pos);
  if (claimId !== null) {
    const instance = ctx.instances.find(
      (candidate) => candidate.exitId === claimId && candidate.partyKey === ctx.instanceKeyFor(pid),
    );
    if (!instance) return null;
    return located(
      {
        kind: 'dungeon',
        id: instance.dungeonId,
        instanceId: String(claimId),
        slot: instance.slot,
      },
      pos,
      ctx.instanceOriginOf(instance),
    );
  }
  // Every remaining coordinate in the reserved instance bands is private
  // runtime space (arena, Vale Cup practice, Yumi, or future modules). Never
  // reinterpret an unrecognized/private band as an overworld zone.
  if (pos.x >= INSTANCE_X_BASE) return null;

  const zone = zoneAt(pos.x, pos.z);
  return located({ kind: 'overworld', id: zone.id }, pos, { x: 0, z: 0 });
}

function sameArea(a: UnstuckArea, b: UnstuckArea): boolean {
  return (
    a.kind === b.kind &&
    a.id === b.id &&
    (a.instanceId ?? null) === (b.instanceId ?? null) &&
    (a.slot ?? null) === (b.slot ?? null)
  );
}

function isValeCupPlayer(ctx: SimContext, pid: number): boolean {
  const matches = ctx.vcup.match ? [ctx.vcup.match, ...ctx.vcup.practices] : ctx.vcup.practices;
  return matches.some((match) => match.teamA.includes(pid) || match.teamB.includes(pid));
}

function hasMoveInput(meta: PlayerMeta): boolean {
  const input = meta.moveInput;
  return input.forward || input.back || input.strafeLeft || input.strafeRight || input.jump;
}

function forcedMovement(p: Entity): boolean {
  return (
    p.chargeTargetId !== null ||
    p.followTargetId !== null ||
    p.auras.some((aura) => aura.id === 'fear_incap' && aura.kind === 'incapacitate') ||
    Math.hypot(p.vx, p.vy, p.vz) > POSITION_EPS
  );
}

function competitive(ctx: SimContext, pid: number, p: Entity): boolean {
  return (
    ctx.duels.has(pid) ||
    ctx.arenaMatches.has(pid) ||
    isValeCupPlayer(ctx, pid) ||
    isArenaPos(p.pos.x)
  );
}

function blockedReason(ctx: SimContext, meta: PlayerMeta, p: Entity): UnstuckBlockedReason | null {
  if (p.ghost) return 'ghost';
  if (p.dead) return 'dead';
  if (p.jailed) return 'jailed';
  if (p.inCombat || p.combatTimer < 5) return 'combat';
  if (isStunned(p) || isRooted(p)) return 'controlled';
  if (!p.onGround || p.jumping) return 'falling';
  if (ctx.isSwimming(p)) return 'falling';
  if (forcedMovement(p)) return 'moving';
  if (p.castingAbility !== null || isConsuming(p) || p.sitting) return 'busy';
  if (competitive(ctx, p.id, p)) return 'competitive';
  if (ctx.tradeFor(p.id)) return 'trading';
  if (!unstuckLocationAt(ctx, p.id, p.pos)) return 'invalid_area';
  if (hasMoveInput(meta)) return 'moving';
  return null;
}

function emitBlocked(
  ctx: SimContext,
  pid: number,
  reason: UnstuckBlockedReason,
  seconds?: number,
): void {
  ctx.emit({ type: 'unstuck', phase: 'blocked', reason, ...(seconds ? { seconds } : {}), pid });
}

/** Begin the authoritative idle countdown. Returns true only when accepted. */
export function requestUnstuck(ctx: SimContext, pid?: number): boolean {
  const resolved = ctx.resolve(pid);
  if (!resolved) return false;
  const { meta, e: p } = resolved;
  if (meta.pendingUnstuck) {
    emitBlocked(ctx, p.id, 'already_active');
    return false;
  }
  const cooldown = p.cooldowns.get(UNSTUCK_COOLDOWN_ID) ?? 0;
  if (cooldown > 0) {
    emitBlocked(ctx, p.id, 'cooldown', Math.max(1, Math.ceil(cooldown)));
    return false;
  }
  const blocked = blockedReason(ctx, meta, p);
  if (blocked) {
    emitBlocked(ctx, p.id, blocked);
    return false;
  }
  const current = unstuckLocationAt(ctx, p.id, p.pos);
  if (!current) {
    emitBlocked(ctx, p.id, 'invalid_area');
    return false;
  }
  if (isUnstuckDestinationSafe(ctx, p, p.pos)) {
    emitBlocked(ctx, p.id, 'already_safe');
    return false;
  }
  meta.pendingUnstuck = {
    startedAt: ctx.time,
    endsAt: ctx.time + UNSTUCK_COUNTDOWN_SECONDS,
    origin: current.point,
    area: current.area,
    damageTaken: meta.counters.damageTaken,
    lastAnnouncedSecond: UNSTUCK_COUNTDOWN_SECONDS,
  };
  p.cooldowns.set(UNSTUCK_COOLDOWN_ID, UNSTUCK_RETRY_SECONDS);
  ctx.emit({
    type: 'unstuck',
    phase: 'started',
    seconds: UNSTUCK_COUNTDOWN_SECONDS,
    pid: p.id,
  });
  return true;
}

function geometricallyStablePoint(ctx: SimContext, p: Entity, x: number, z: number): boolean {
  const resolved = ctx.resolveMovePoint(x, z, PLAYER_BODY_RADIUS, p);
  if (Math.hypot(resolved.x - x, resolved.z - z) > POSITION_EPS) return false;
  const stand = terrainWallStandoff(x, z, ctx.cfg.seed, PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE);
  if (Math.hypot(stand.x - x, stand.z - z) > POSITION_EPS) return false;
  if (terrainSteepnessAt(x, z, ctx.cfg.seed) > PLAYER_MAX_CLIMB_SLOPE) return false;
  return groundHeight(x, z, ctx.cfg.seed) >= waterLevelAt(x, z) - PLAYER_SWIM_DEPTH;
}

/** Destination safety adds live instance hazards to the static geometry checks. */
export function isUnstuckDestinationSafe(ctx: SimContext, p: Entity, pos: Vec3): boolean {
  if (!unstuckLocationAt(ctx, p.id, pos)) return false;
  if (!geometricallyStablePoint(ctx, p, pos.x, pos.z)) return false;
  const delve = ctx.delveRunForPlayer(p.id);
  if (delve && isDelvePos(pos.x) && delveBlackwaterTierAt(delve, pos) !== null) return false;
  return riftRecoveryPointSafe(ctx, p, pos);
}

/**
 * Check the complete walkable route at normal-movement granularity. Static
 * collision remains swept by resolvePlayerMove, while the samples also apply
 * the movement kernel's terrain climb gate and live instance doors.
 */
export function unstuckRouteReachable(ctx: SimContext, p: Entity, from: Vec3, to: Vec3): boolean {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  if (distance <= POSITION_EPS) return true;
  const steps = Math.ceil(distance / ROUTE_SAMPLE_DISTANCE);
  let currentX = from.x;
  let currentZ = from.z;
  for (let step = 1; step <= steps; step++) {
    const fraction = step / steps;
    const targetX = from.x + (to.x - from.x) * fraction;
    const targetZ = from.z + (to.z - from.z) * fraction;
    const run = Math.hypot(targetX - currentX, targetZ - currentZ);
    const h0 = groundHeight(currentX, currentZ, ctx.cfg.seed);
    const h1 = groundHeight(targetX, targetZ, ctx.cfg.seed);
    if (
      h1 > h0 &&
      run > POSITION_EPS &&
      ((h1 - h0) / run > PLAYER_MAX_CLIMB_SLOPE ||
        terrainSteepnessAt(targetX, targetZ, ctx.cfg.seed) > PLAYER_MAX_CLIMB_SLOPE)
    ) {
      return false;
    }
    const stand = terrainWallStandoff(
      targetX,
      targetZ,
      ctx.cfg.seed,
      PLAYER_BODY_RADIUS,
      PLAYER_MAX_CLIMB_SLOPE,
    );
    if (Math.hypot(stand.x - targetX, stand.z - targetZ) > POSITION_EPS) return false;
    const target = ctx.groundPos(targetX, targetZ);
    if (!riftRecoveryRoutePointClear(ctx, p, target)) return false;
    const swept = ctx.resolvePlayerMove(
      currentX,
      currentZ,
      targetX,
      targetZ,
      PLAYER_BODY_RADIUS,
      p,
      false,
    );
    if (Math.hypot(swept.x - targetX, swept.z - targetZ) > POSITION_EPS) return false;
    currentX = targetX;
    currentZ = targetZ;
  }
  return true;
}

function embeddedCorrectionReachable(
  ctx: SimContext,
  p: Entity,
  origin: Vec3,
  anchor: Vec3,
): boolean {
  const distance = Math.hypot(anchor.x - origin.x, anchor.z - origin.z);
  if (distance > UNSTUCK_EMBEDDED_CORRECTION_MAX + POSITION_EPS) return false;
  const steps = Math.max(1, Math.ceil(distance / ROUTE_SAMPLE_DISTANCE));
  let currentX = origin.x;
  let currentZ = origin.z;
  for (let step = 1; step <= steps; step++) {
    const fraction = step / steps;
    const targetX = origin.x + (anchor.x - origin.x) * fraction;
    const targetZ = origin.z + (anchor.z - origin.z) * fraction;
    const run = Math.hypot(targetX - currentX, targetZ - currentZ);
    const h0 = groundHeight(currentX, currentZ, ctx.cfg.seed);
    const h1 = groundHeight(targetX, targetZ, ctx.cfg.seed);
    if (
      h1 > h0 &&
      run > POSITION_EPS &&
      ((h1 - h0) / run > PLAYER_MAX_CLIMB_SLOPE ||
        terrainSteepnessAt(targetX, targetZ, ctx.cfg.seed) > PLAYER_MAX_CLIMB_SLOPE)
    ) {
      return false;
    }
    if (!riftRecoveryRoutePointClear(ctx, p, ctx.groundPos(targetX, targetZ))) return false;
    currentX = targetX;
    currentZ = targetZ;
  }
  const swept = ctx.resolvePlayerMove(
    origin.x,
    origin.z,
    anchor.x,
    anchor.z,
    PLAYER_BODY_RADIUS,
    p,
    false,
  );
  return Math.hypot(swept.x - anchor.x, swept.z - anchor.z) <= POSITION_EPS;
}

function pointInArea(
  ctx: SimContext,
  pid: number,
  area: UnstuckArea,
  x: number,
  z: number,
): Vec3 | null {
  const pos = ctx.groundPos(x, z);
  const found = unstuckLocationAt(ctx, pid, pos);
  return found && sameArea(found.area, area) ? pos : null;
}

/** Deterministic nearest reachable point, bounded to the invocation area and 8yd. */
export function findUnstuckDestination(
  ctx: SimContext,
  p: Entity,
  pending: PendingUnstuck,
): Vec3 | null {
  const origin = pending.origin;
  const pointResolved = ctx.resolveMovePoint(origin.x, origin.z, PLAYER_BODY_RADIUS, p);
  const stoodOff = terrainWallStandoff(
    pointResolved.x,
    pointResolved.z,
    ctx.cfg.seed,
    PLAYER_BODY_RADIUS,
    PLAYER_MAX_CLIMB_SLOPE,
  );
  const anchorResolved = ctx.resolveMovePoint(stoodOff.x, stoodOff.z, PLAYER_BODY_RADIUS, p);
  const anchor = pointInArea(ctx, p.id, pending.area, anchorResolved.x, anchorResolved.z);
  if (!anchor || !geometricallyStablePoint(ctx, p, anchor.x, anchor.z)) return null;

  const anchorDistance = Math.hypot(anchor.x - origin.x, anchor.z - origin.z);
  // A clear, ordinary origin is not stuck. Never move a player merely because
  // the search has a nearby ring point, which would turn repeated use into travel.
  if (anchorDistance <= POSITION_EPS) return null;
  if (anchorDistance > UNSTUCK_MAX_DISTANCE + POSITION_EPS) return null;
  if (!embeddedCorrectionReachable(ctx, p, origin, anchor)) return null;
  if (isUnstuckDestinationSafe(ctx, p, anchor)) return anchor;

  for (const radius of CANDIDATE_RADII) {
    for (let i = 0; i < CANDIDATE_DIRECTIONS; i++) {
      const angle = (i / CANDIDATE_DIRECTIONS) * Math.PI * 2;
      const x = anchor.x + Math.sin(angle) * radius;
      const z = anchor.z + Math.cos(angle) * radius;
      if (Math.hypot(x - origin.x, z - origin.z) > UNSTUCK_MAX_DISTANCE + POSITION_EPS) continue;
      const candidate = pointInArea(ctx, p.id, pending.area, x, z);
      if (!candidate) continue;
      if (!isUnstuckDestinationSafe(ctx, p, candidate)) continue;
      if (!unstuckRouteReachable(ctx, p, anchor, candidate)) continue;
      const rise = Math.abs(candidate.y - anchor.y);
      const run = Math.hypot(candidate.x - anchor.x, candidate.z - anchor.z);
      if (run > POSITION_EPS && rise / run > PLAYER_MAX_CLIMB_SLOPE) continue;
      return candidate;
    }
  }
  return null;
}

function cancelReason(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  pending: PendingUnstuck,
): UnstuckCancelReason | null {
  if (meta.counters.damageTaken > pending.damageTaken) return 'damaged';
  if (p.inCombat || p.combatTimer < 5) return 'combat';
  if (p.castingAbility !== null || isConsuming(p) || p.sitting) return 'busy';
  if (
    hasMoveInput(meta) ||
    Math.hypot(p.pos.x - pending.origin.x, p.pos.z - pending.origin.z) > CANCEL_MOVE_DISTANCE ||
    Math.abs(p.pos.y - pending.origin.y) > CANCEL_VERTICAL_DISTANCE
  )
    return 'moved';
  if (
    p.dead ||
    p.ghost ||
    p.jailed ||
    isStunned(p) ||
    isRooted(p) ||
    !p.onGround ||
    p.jumping ||
    ctx.isSwimming(p) ||
    forcedMovement(p) ||
    competitive(ctx, p.id, p) ||
    ctx.tradeFor(p.id)
  )
    return 'state_changed';
  const current = unstuckLocationAt(ctx, p.id, p.pos);
  if (!current || !sameArea(current.area, pending.area)) return 'state_changed';
  return null;
}

function clearMoveInput(meta: PlayerMeta): void {
  meta.moveInput.forward = false;
  meta.moveInput.back = false;
  meta.moveInput.turnLeft = false;
  meta.moveInput.turnRight = false;
  meta.moveInput.strafeLeft = false;
  meta.moveInput.strafeRight = false;
  meta.moveInput.jump = false;
}

function cancelUnstuck(
  ctx: SimContext,
  meta: PlayerMeta,
  pending: PendingUnstuck,
  reason: UnstuckCancelReason,
  emitEvent = true,
): CancelledUnstuckEvent {
  meta.pendingUnstuck = null;
  const event: CancelledUnstuckEvent = {
    type: 'unstuck',
    phase: 'cancelled',
    reason,
    area: pending.area,
    origin: pending.origin,
    duration: Math.max(0, ctx.time - pending.startedAt),
    pid: meta.entityId,
  };
  if (emitEvent) ctx.emit(event);
  return event;
}

/**
 * End an accepted attempt when its owning session leaves. The returned event
 * lets an online host persist the terminal report while account/character
 * identity is still available; the sim event remains useful to offline hosts.
 */
export function cancelPendingUnstuckForDisconnect(
  ctx: SimContext,
  pid: number,
  emitEvent = true,
): CancelledUnstuckEvent | null {
  const meta = ctx.players.get(pid);
  const pending = meta?.pendingUnstuck;
  if (!meta || !pending) return null;
  return cancelUnstuck(ctx, meta, pending, 'disconnected', emitEvent);
}

function completeUnstuck(
  ctx: SimContext,
  meta: PlayerMeta,
  p: Entity,
  pending: PendingUnstuck,
): void {
  const destination = findUnstuckDestination(ctx, p, pending);
  meta.pendingUnstuck = null;
  if (!destination) {
    ctx.emit({
      type: 'unstuck',
      phase: 'failed',
      reason: 'no_safe_position',
      area: pending.area,
      origin: pending.origin,
      duration: Math.max(0, ctx.time - pending.startedAt),
      pid: p.id,
    });
    return;
  }

  p.pos = { ...destination };
  p.pos.y += riftPlayerLift(ctx, p);
  p.prevPos = { ...p.pos };
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.onGround = true;
  p.jumping = false;
  p.fallStartY = p.pos.y;
  p.fatigueTicks = 0;
  p.chargeTargetId = null;
  p.chargeTimeLeft = 0;
  p.chargePath = [];
  p.followTargetId = null;
  clearMoveInput(meta);
  ctx.rebucket(p);
  p.cooldowns.set(UNSTUCK_COOLDOWN_ID, UNSTUCK_SUCCESS_COOLDOWN_SECONDS);

  const final = unstuckLocationAt(ctx, p.id, p.pos);
  if (!final || !sameArea(final.area, pending.area)) {
    // Defensive only: validation above guarantees this. Avoid emitting corrupt
    // telemetry if a future area classifier changes independently.
    return;
  }
  ctx.emit({
    type: 'unstuck',
    phase: 'completed',
    reason: 'nearest_safe_position',
    area: pending.area,
    origin: pending.origin,
    destination: final.point,
    duration: Math.max(0, ctx.time - pending.startedAt),
    distance: Math.hypot(final.point.x - pending.origin.x, final.point.z - pending.origin.z),
    pid: p.id,
  });
}

/** Tick pending recovery attempts after player movement/combat for this frame. */
export function updateUnstuck(ctx: SimContext): void {
  for (const meta of ctx.players.values()) {
    const pending = meta.pendingUnstuck;
    if (!pending) continue;
    const p = ctx.entities.get(meta.entityId);
    if (!p) {
      cancelUnstuck(ctx, meta, pending, 'disconnected');
      continue;
    }
    const cancelled = cancelReason(ctx, meta, p, pending);
    if (cancelled) {
      cancelUnstuck(ctx, meta, pending, cancelled);
      continue;
    }
    const seconds = Math.max(0, Math.ceil(pending.endsAt - ctx.time - DT / 2));
    if (seconds > 0 && seconds < pending.lastAnnouncedSecond) {
      pending.lastAnnouncedSecond = seconds;
      ctx.emit({ type: 'unstuck', phase: 'countdown', seconds, pid: p.id });
    }
    if (ctx.time + DT / 2 >= pending.endsAt) completeUnstuck(ctx, meta, p, pending);
  }
}
