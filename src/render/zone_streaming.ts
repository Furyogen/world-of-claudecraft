// Pure spatial policy for renderer zone streaming. Only resident zones own
// render geometry. Two cooperating halves keep that invariant seamless:
// zonesWithinStreamingHorizon feeds the renderer's background prepare queue,
// so a zone becomes resident BEFORE its rectangle can enter the relaxed fog
// horizon, and fogFarForPreparedZones is the safety net that contracts the
// fog ahead of any zone the streaming has not finished yet (a teleport, a
// sprint that outruns the build), so an unloaded region is never visible.

import {
  BUILTIN_WORLD,
  getActiveWorldContent,
  STRIP_MAX_X,
  STRIP_MIN_X,
  WORLD_MAX_X,
  ZONES,
} from '../sim/data';
import type { WorldContent, ZoneDef } from '../sim/types';

// The outdoor visibility envelope: no biome fog preset may exceed this, and
// terrain/prop/foliage culling all key off the live fog far, so this is the
// hard ceiling on how much world one camera can request.
export const MAX_OUTDOOR_FOG_FAR = 850;
export const MIN_OUTDOOR_FOG_FAR = 45;
export const UNPREPARED_ZONE_FOG_GUARD = 8;
export const ZONE_STREAM_RECHECK_DISTANCE = 24;

interface Candidate {
  zone: ZoneDef;
  distanceSq: number;
  alignment: number;
  order: number;
}

// ---------------------------------------------------------------------------
// A custom world can be WIDER or TALLER than the built-in 14-zone footprint
// (blank maps size up to MAX_WORLD_COORD). Terrain cell ownership clamps such
// margin cells to the nearest built-in zone (zoneAt), so the streaming policy
// must see matching rectangles: strip-spanning zones widen to the custom
// world's x extent, and the south/northmost bands extend to its z extent.
// Otherwise the camera out in the margin is "far from every zone rect", the
// prepare queue stays empty, and the margin never builds — the classic
// "chunks only load near spawn" failure on big custom maps. Built-in world:
// returns ZONES itself, byte-identical behavior.
// ---------------------------------------------------------------------------
let effectiveZonesCache: { content: WorldContent; zones: ZoneDef[] } | null = null;

export function effectiveStreamingZones(): readonly ZoneDef[] {
  const content = getActiveWorldContent();
  if (content === BUILTIN_WORLD) return ZONES;
  if (effectiveZonesCache?.content === content) return effectiveZonesCache.zones;
  const halfX = content.worldHalfX ?? WORLD_MAX_X;
  const czones = content.zones ?? [];
  const cMinZ = czones.length > 0 ? Math.min(...czones.map((z) => z.zMin)) : Infinity;
  const cMaxZ = czones.length > 0 ? Math.max(...czones.map((z) => z.zMax)) : -Infinity;
  const southZMin = Math.min(...ZONES.map((z) => z.zMin));
  const northZMax = Math.max(...ZONES.map((z) => z.zMax));
  const zones = ZONES.map((zone) => {
    const copy: ZoneDef = { ...zone };
    // Strip-default zones (no explicit x range) own the x margins too.
    if (zone.xMin === undefined) copy.xMin = Math.min(STRIP_MIN_X, -halfX);
    if (zone.xMax === undefined) copy.xMax = Math.max(STRIP_MAX_X, halfX);
    // The end bands own anything the custom world extends past them.
    if (zone.zMin === southZMin && cMinZ < zone.zMin) copy.zMin = cMinZ;
    if (zone.zMax === northZMax && cMaxZ > zone.zMax) copy.zMax = cMaxZ;
    return copy;
  });
  effectiveZonesCache = { content, zones };
  return zones;
}

/** Squared XZ distance from a point to a zone's exact rectangle. */
export function distanceSqToZone(zone: ZoneDef, x: number, z: number): number {
  const minX = zone.xMin ?? STRIP_MIN_X;
  const maxX = zone.xMax ?? STRIP_MAX_X;
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dz = z < zone.zMin ? zone.zMin - z : z > zone.zMax ? z - zone.zMax : 0;
  return dx * dx + dz * dz;
}

/**
 * Zones whose rectangles intersect a radial camera horizon, nearest first.
 * When distances tie, the zone in the camera's projected forward direction is
 * first so the terrain currently on screen wins the sequential build queue.
 */
export function zonesWithinStreamingHorizon(
  zones: readonly ZoneDef[],
  cameraX: number,
  cameraZ: number,
  horizon: number,
  forwardX = 0,
  forwardZ = 0,
): ZoneDef[] {
  const radius = Math.max(0, horizon);
  const radiusSq = radius * radius;
  const forwardLength = Math.hypot(forwardX, forwardZ);
  const fx = forwardLength > 0 ? forwardX / forwardLength : 0;
  const fz = forwardLength > 0 ? forwardZ / forwardLength : 0;
  const candidates: Candidate[] = [];

  for (let order = 0; order < zones.length; order++) {
    const zone = zones[order];
    const distanceSq = distanceSqToZone(zone, cameraX, cameraZ);
    if (distanceSq > radiusSq) continue;
    const minX = zone.xMin ?? STRIP_MIN_X;
    const maxX = zone.xMax ?? STRIP_MAX_X;
    const nearestX = Math.max(minX, Math.min(maxX, cameraX));
    const nearestZ = Math.max(zone.zMin, Math.min(zone.zMax, cameraZ));
    const dx = nearestX - cameraX;
    const dz = nearestZ - cameraZ;
    const distance = Math.sqrt(distanceSq);
    const alignment = distance > 0 ? (dx * fx + dz * fz) / distance : 1;
    candidates.push({ zone, distanceSq, alignment, order });
  }

  candidates.sort(
    (a, b) => a.distanceSq - b.distanceSq || b.alignment - a.alignment || a.order - b.order,
  );
  return candidates.map((candidate) => candidate.zone);
}

/**
 * The point of `zone`'s rectangle nearest (x, z), inset one yard inside every
 * edge. This is the likely entry point of an approaching camera, used as a
 * zone prepare's build-priority anchor. The inset is load-bearing: zone
 * rectangles are exclusive on their max edges (zoneAt resolves the exact
 * boundary to the neighbour), so an un-inset nearest point can resolve to the
 * WRONG zone, no-op the prepare, and silently starve the streaming queue
 * entry it was consumed by.
 */
export function zoneEntryPoint(zone: ZoneDef, x: number, z: number): { x: number; z: number } {
  const minX = zone.xMin ?? STRIP_MIN_X;
  const maxX = zone.xMax ?? STRIP_MAX_X;
  return {
    x: Math.max(minX + 1, Math.min(maxX - 1, x)),
    z: Math.max(zone.zMin + 1, Math.min(zone.zMax - 1, z)),
  };
}

/**
 * Cap outdoor visibility before the closest unloaded zone rectangle. The cap
 * drops immediately as the camera approaches a boundary and may ease back out
 * after the destination becomes resident; the renderer owns that temporal
 * policy. No geometry is generated by this query.
 */
export function fogFarForPreparedZones(
  zones: readonly ZoneDef[],
  preparedZoneIds: ReadonlySet<string>,
  cameraX: number,
  cameraZ: number,
  requestedFar: number,
): number {
  let nearestSq = Number.POSITIVE_INFINITY;
  for (const zone of zones) {
    if (preparedZoneIds.has(zone.id)) continue;
    nearestSq = Math.min(nearestSq, distanceSqToZone(zone, cameraX, cameraZ));
  }
  if (!Number.isFinite(nearestSq)) return Math.min(requestedFar, MAX_OUTDOOR_FOG_FAR);
  const beforeUnprepared = Math.sqrt(nearestSq) - UNPREPARED_ZONE_FOG_GUARD;
  return Math.max(
    MIN_OUTDOOR_FOG_FAR,
    Math.min(requestedFar, MAX_OUTDOOR_FOG_FAR, beforeUnprepared),
  );
}
