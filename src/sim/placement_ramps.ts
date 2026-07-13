// Walkable ramp decks from baked stairs/ramp placements: the collision bake
// classifies stair-like catalogue assets and fits a rising deck over their
// steps (scripts/assets/bake_collision.mjs -> ASSET_RAMPS). A colliding
// stairs placement contributes that deck to the walkable ground the same way
// 'collider/plane' volumes do, so the player just WALKS UP stairs; the asset
// bakes no blocking boxes at all (grazing the sides clips - lenient by
// design).
//
// The per-content ramp list is cached (custom maps carry thousands of
// placements; stairs are a handful) and busted alongside the static-collider
// cache whenever placements mutate.

import { ASSET_RAMPS } from './asset_collision.generated';
import type { WorldContent } from './types';
import { terrainHeight } from './world';

interface WorldRamp {
  x: number; // placement anchor
  z: number;
  rotY: number;
  // Deck footprint in MODEL units (center offset + half extents) and the
  // per-axis world scale to apply.
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  axis: 'x' | 'z';
  yNeg: number;
  yPos: number;
  sx: number;
  sy: number;
  sz: number;
  // World base height of the model's seat (frozen ground when detached).
  detached: boolean;
  groundY: number;
  lift: number;
}

const cache = new WeakMap<WorldContent, Map<number, WorldRamp[]>>();

/** Drop the cached ramp list for `content` (placements changed). */
export function invalidatePlacementRamps(content: WorldContent): void {
  cache.delete(content);
}

function rampsFor(content: WorldContent, seed: number): WorldRamp[] {
  let bySeed = cache.get(content);
  if (!bySeed) {
    bySeed = new Map();
    cache.set(content, bySeed);
  }
  let ramps = bySeed.get(seed);
  if (ramps) return ramps;
  ramps = [];
  for (const p of content.placements ?? []) {
    // Same gate as the box colliders: collide ON, no hand-authored footprint.
    if (!p.collideRadius || p.collideRadius <= 0 || p.collideCustom) continue;
    const m = p.path ? /^\/models\/(.+)\.glb$/.exec(p.path) : null;
    const ramp = m ? ASSET_RAMPS[m[1]] : undefined;
    if (!ramp) continue;
    const s = p.scale > 0 ? p.scale : 1;
    ramps.push({
      x: p.x,
      z: p.z,
      rotY: p.rotY,
      cx: ramp.cx,
      cz: ramp.cz,
      hx: ramp.hx,
      hz: ramp.hz,
      axis: ramp.axis,
      yNeg: ramp.yNeg,
      yPos: ramp.yPos,
      sx: s * (p.scaleX ?? 1),
      sy: s * (p.scaleY ?? 1),
      sz: s * (p.scaleZ ?? 1),
      detached: p.detached === true,
      groundY: p.groundY ?? 0,
      lift: p.y ?? 0,
    });
  }
  bySeed.set(seed, ramps);
  return ramps;
}

/**
 * The highest stairs-deck floor under (x, z), or -Infinity when none.
 * groundHeight max()es this in, exactly like plane collider volumes.
 */
export function placementRampFloorAt(
  content: WorldContent,
  seed: number,
  x: number,
  z: number,
): number {
  const ramps = rampsFor(content, seed);
  let best = Number.NEGATIVE_INFINITY;
  for (const r of ramps) {
    // Into the placement's local (pre-yaw) frame, then to model units.
    const dx = x - r.x;
    const dz = z - r.z;
    const c = Math.cos(r.rotY);
    const s = Math.sin(r.rotY);
    const lx = (dx * c - dz * s) / (r.sx || 1);
    const lz = (dx * s + dz * c) / (r.sz || 1);
    const ox = lx - r.cx;
    const oz = lz - r.cz;
    if (Math.abs(ox) > r.hx || Math.abs(oz) > r.hz) continue;
    const along = r.axis === 'x' ? ox : oz;
    const half = r.axis === 'x' ? r.hx : r.hz;
    const t = half > 1e-6 ? (along + half) / (2 * half) : 0.5;
    const deckModel = r.yNeg + (r.yPos - r.yNeg) * Math.min(1, Math.max(0, t));
    const base = r.detached ? r.groundY : terrainHeight(r.x, r.z, seed);
    const floor = base + r.lift + deckModel * r.sy;
    if (floor > best) best = floor;
  }
  return best;
}
