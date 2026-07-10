// The moored rowboat props.ts draws beside each fishing-dock (dock-local 2.4,
// -5.0) had no collider, so the player walked straight through its hull while
// every other structure blocks. colliders.ts emitted only the dock hut OBB and
// never covered the boat. Both docks (zone1 + zone2) share the geometry, so one
// derived collider fixes both. This pins that the hull is now solid, and that
// the circle footprint stays bounded (water past the hull remains walkable).
import { afterEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';

const SEED = 20061;

// Mirror colliders.ts rotY: rotate a local (lx,lz) offset by a rotation.y angle.
function rotY(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}
// World point for a dock-local offset.
function dockLocal(
  dock: { x: number; z: number; rot: number },
  lx: number,
  lz: number,
): { x: number; z: number } {
  const o = rotY(lx, lz, dock.rot);
  return { x: dock.x + o.x, z: dock.z + o.z };
}

// The two docks from content (zone1.ts / zone2.ts); the boat-local offset
// matches BOAT_LOCAL_X/Z in colliders.ts (and boatLx/boatLz in render/props.ts).
const DOCKS = [
  { x: -64, z: 60, rot: -2.2 }, // zone 1
  { x: -66, z: 305, rot: 1.68 }, // zone 2 (Deepfen)
];
const BOAT_LX = 2.4;
const BOAT_LZ = -5.0;

describe('moored rowboat collision', () => {
  afterEach(() => setActiveWorldContent(null));

  it('blocks the rowboat hull at both docks (previously walk-through)', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    for (const dock of DOCKS) {
      const p = dockLocal(dock, BOAT_LX, BOAT_LZ);
      expect(isBlocked(SEED, p.x, p.z), `rowboat of dock at ${dock.x},${dock.z}`).toBe(true);
    }
  });

  it('leaves water past the hull walkable (circle footprint bounded, ~1.1u radius)', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    for (const dock of DOCKS) {
      // ~2.2u out along local +x from the boat centre: clear of the ~1.1u circle.
      const past = dockLocal(dock, BOAT_LX + 2.2, BOAT_LZ);
      expect(isBlocked(SEED, past.x, past.z), `past-boat of dock at ${dock.x},${dock.z}`).toBe(
        false,
      );
    }
  });
});
