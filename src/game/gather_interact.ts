// Gather-node arm for the Interact key/button (#1888). Gather nodes are static
// content records (src/sim/content/gather_nodes.ts), never entities, so the
// entity scan in interactKey() (src/main.ts) can not see them; this module
// resolves the nearest node against the SAME per-viewer classification the
// minimap already paints (src/ui/gathering_view.ts) and dispatches the harvest
// through the IWorld seam. Its own sibling module (main.ts is a firewall, not a
// home): main.ts consumes exactly one call, and both the desktop Interact key
// and the mobile Interact button funnel through that one call site.
//
// Authority stays with the sim/server: this module never predicts an outcome.
// A cooldown node inside range is still attempted (preferring a ready node
// when one is in reach) so the sim's own denial ("This resource node has not
// respawned for you yet.", "Too far away.", "Your bags are full.") surfaces
// through the normal error-event path instead of a client-side guess.

import { INTERACT_RANGE } from '../sim/types';
import { buildNearbyGatherNodes, type NearbyGatherNode } from '../ui/gathering_view';
import type { IWorld } from '../world_api';

// The nearest of `nodes` to `pos` by flat 2D distance (node placements carry
// no y, matching sim/professions/gathering.ts). Ties keep the earlier entry,
// which follows the stable GATHER_NODES content order buildNearbyGatherNodes
// preserves, so the pick is deterministic.
function nearestOf(
  nodes: readonly NearbyGatherNode[],
  pos: { x: number; z: number },
): NearbyGatherNode | null {
  let best: NearbyGatherNode | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const dx = node.x - pos.x;
    const dz = node.z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      best = node;
      bestD = d;
    }
  }
  return best;
}

/**
 * Attempts to harvest the best gather node within Interact reach: the nearest
 * node that is ready for this viewer, else the nearest cooldown node (so the
 * sim's authoritative denial message surfaces). Returns true when an attempt
 * was dispatched, false when no node is in range, so the caller (the Interact
 * arm chain in main.ts) knows whether to fall through to its
 * nothing-to-interact error.
 */
export function tryHarvestNearestNode(world: IWorld, range: number = INTERACT_RANGE): boolean {
  const nearby = buildNearbyGatherNodes(world, range);
  if (nearby.length === 0) return false;
  const pos = world.player.pos;
  const target =
    nearestOf(
      nearby.filter((n) => n.state === 'ready'),
      pos,
    ) ?? nearestOf(nearby, pos);
  if (!target) return false;
  world.harvestNode(target.id);
  return true;
}
