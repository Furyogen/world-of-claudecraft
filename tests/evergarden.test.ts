// The Evergarden: zone registration, and the Great Maze contract. The maze
// hedges are pure terrain (world.ts GARDEN_MAZE), so these tests are what
// keeps an edit to the grid honest: the corridors must stay walkable, the
// walls must stay unclimbable, and the entrance must still reach the
// Fountain Court.

import { describe, expect, it } from 'vitest';
import { resolveMovement } from '../src/sim/colliders';
import {
  EVERGARDEN_CAMPS,
  EVERGARDEN_PROPS,
  EVERGARDEN_ROADS,
  EVERGARDEN_ZONE,
} from '../src/sim/content/evergarden';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import {
  GARDEN_MAZE_GRID,
  inGardenMaze,
  inGardenMazeWall,
  MAZE_CELL,
  MAZE_COLS,
  MAZE_ROWS,
  MAZE_X0,
  MAZE_Z1,
  terrainHeight,
  WATER_LEVEL,
} from '../src/sim/world';

const SEED = 1337; // matches the fixed client seed in src/main.ts

// Cell (col, row) center in world coordinates. Row 0 is the NORTH row.
function cellCenter(c: number, r: number): { x: number; z: number } {
  return {
    x: MAZE_X0 + c * MAZE_CELL + MAZE_CELL / 2,
    z: MAZE_Z1 - r * MAZE_CELL - MAZE_CELL / 2,
  };
}

describe('Evergarden zone registration', () => {
  it('keeps its hub, graveyard, and camps on dry, in-zone ground', () => {
    const { hub, graveyard } = EVERGARDEN_ZONE;
    expect(hub.z).toBeGreaterThan(EVERGARDEN_ZONE.zMin);
    expect(hub.z).toBeLessThan(EVERGARDEN_ZONE.zMax);
    expect(terrainHeight(hub.x, hub.z, SEED)).toBeGreaterThan(WATER_LEVEL);
    expect(terrainHeight(graveyard.x, graveyard.z, SEED)).toBeGreaterThan(WATER_LEVEL);
    for (const camp of EVERGARDEN_CAMPS) {
      expect(terrainHeight(camp.center.x, camp.center.z, SEED)).toBeGreaterThan(WATER_LEVEL);
    }
  });

  it('keeps every road on dry ground along its whole length', () => {
    for (const road of EVERGARDEN_ROADS) {
      for (let i = 0; i < road.length - 1; i++) {
        const a = road[i];
        const b = road[i + 1];
        const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps;
          const z = a.z + ((b.z - a.z) * k) / steps;
          expect(
            terrainHeight(x, z, SEED),
            `road ${Math.round(x)},${Math.round(z)}`,
          ).toBeGreaterThan(WATER_LEVEL);
        }
      }
    }
  });

  it('keeps roads, camps (except the court), and props out of the maze', () => {
    for (const road of EVERGARDEN_ROADS) {
      for (const p of road) expect(inGardenMaze(p.x, p.z), `road ${p.x},${p.z}`).toBe(false);
    }
    for (const camp of EVERGARDEN_CAMPS) {
      if (camp.mobId === 'the_topiary_bull') continue; // the court's keeper
      expect(inGardenMaze(camp.center.x, camp.center.z), camp.mobId).toBe(false);
    }
    for (const t of EVERGARDEN_PROPS.greatTrees ?? []) {
      expect(inGardenMaze(t.x, t.z), `tree ${t.x},${t.z}`).toBe(false);
      // dry footing too: a wet spot would strand an invisible trunk collider
      expect(terrainHeight(t.x, t.z, SEED), `tree ${t.x},${t.z}`).toBeGreaterThan(WATER_LEVEL);
    }
  });
});

describe('the Great Maze', () => {
  it('has a well-formed grid', () => {
    expect(GARDEN_MAZE_GRID.length).toBe(MAZE_ROWS);
    for (const row of GARDEN_MAZE_GRID) {
      expect(row.length).toBe(MAZE_COLS);
      expect(/^[#.]+$/.test(row)).toBe(true);
    }
  });

  it('is solvable: the entrance reaches the Fountain Court', () => {
    // BFS over open cells from the south entrance (last row's gap).
    const entranceCol = GARDEN_MAZE_GRID[MAZE_ROWS - 1].indexOf('.');
    expect(entranceCol).toBeGreaterThanOrEqual(0);
    const court = { c: 7, r: 8 }; // the open 3x3 center
    expect(GARDEN_MAZE_GRID[court.r][court.c]).toBe('.');
    const seen = new Set<string>([`${entranceCol},${MAZE_ROWS - 1}`]);
    const queue = [{ c: entranceCol, r: MAZE_ROWS - 1 }];
    let reached = false;
    while (queue.length > 0) {
      const cur = queue.shift();
      if (!cur) break;
      if (cur.c === court.c && cur.r === court.r) {
        reached = true;
        break;
      }
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const c = cur.c + dc;
        const r = cur.r + dr;
        if (c < 0 || c >= MAZE_COLS || r < 0 || r >= MAZE_ROWS) continue;
        if (GARDEN_MAZE_GRID[r][c] !== '.') continue;
        const key = `${c},${r}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ c, r });
      }
    }
    expect(reached).toBe(true);
  });

  it('keeps wall runs seamless: full height across shared edges, tall corners', () => {
    // Two failure shapes this pins down: a dip along the shared edge of two
    // adjacent wall cells (a visible seam splitting one hedge run into
    // slabs), and a taper-to-ground at a run's corner where it meets a
    // junction (a see-through notch). Both read as walls "not seamed".
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        if (GARDEN_MAZE_GRID[r][c] !== '#') continue;
        const center = cellCenter(c, r);
        const hWall = terrainHeight(center.x, center.z, SEED);
        // shared edge midpoints with east/south wall neighbors
        for (const [dc, dr] of [
          [1, 0],
          [0, 1],
        ]) {
          const oc = c + dc;
          const or = r + dr;
          if (oc >= MAZE_COLS || or >= MAZE_ROWS) continue;
          if (GARDEN_MAZE_GRID[or][oc] !== '#') continue;
          const other = cellCenter(oc, or);
          const mid = { x: (center.x + other.x) / 2, z: (center.z + other.z) / 2 };
          const hMid = terrainHeight(mid.x, mid.z, SEED);
          expect(hWall - hMid, `seam dip between ${c},${r} and ${oc},${or}`).toBeLessThan(1.5);
        }
        // corners: a yard inside each cell corner the hedge is already tall
        for (const [sx, sz] of [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const px = center.x + sx * (MAZE_CELL / 2 - 1);
          const pz = center.z + sz * (MAZE_CELL / 2 - 1);
          const lawn = terrainHeight(center.x, center.z, SEED) - 12; // approx local ground
          const h = terrainHeight(px, pz, SEED);
          expect(h - lawn, `low corner in wall ${c},${r}`).toBeGreaterThan(5);
        }
      }
    }
  });

  it('raises hedge walls the climb gate cannot beat', () => {
    // Every wall cell adjacent to a corridor must present a slope steeper
    // than the player's climb limit on the straight approach from the
    // corridor center to the wall center.
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        if (GARDEN_MAZE_GRID[r][c] !== '#') continue;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const oc = c + dc;
          const or = r + dr;
          if (oc < 0 || oc >= MAZE_COLS || or < 0 || or >= MAZE_ROWS) continue;
          if (GARDEN_MAZE_GRID[or][oc] !== '.') continue;
          const from = cellCenter(oc, or);
          const to = cellCenter(c, r);
          // walk the approach in half-yard steps; the steepest step must
          // exceed the climbable slope
          let maxSlope = 0;
          const steps = 18;
          let prev = terrainHeight(from.x, from.z, SEED);
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = from.x + (to.x - from.x) * t;
            const z = from.z + (to.z - from.z) * t;
            const h = terrainHeight(x, z, SEED);
            const stepLen = Math.hypot(to.x - from.x, to.z - from.z) / steps;
            maxSlope = Math.max(maxSlope, (h - prev) / stepLen);
            prev = h;
          }
          expect(maxSlope, `wall ${c},${r} from ${oc},${or}`).toBeGreaterThan(
            PLAYER_MAX_CLIMB_SLOPE,
          );
        }
      }
    }
  });

  it('keeps corridors flat across their full width', () => {
    // The wall skirt must live inside the wall cells: at a corridor cell's
    // edges (1yd off the wall face) the hedge offset stays out of the way,
    // so the walkable lane is the whole 9yd cell, not a narrow center strip.
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        if (GARDEN_MAZE_GRID[r][c] !== '.') continue;
        const center = cellCenter(c, r);
        const hCenter = terrainHeight(center.x, center.z, SEED);
        for (const [ox, oz] of [
          [MAZE_CELL / 2 - 1, 0],
          [-(MAZE_CELL / 2 - 1), 0],
          [0, MAZE_CELL / 2 - 1],
          [0, -(MAZE_CELL / 2 - 1)],
        ]) {
          const h = terrainHeight(center.x + ox, center.z + oz, SEED);
          expect(Math.abs(h - hCenter), `corridor ${c},${r} edge ${ox},${oz}`).toBeLessThan(2);
        }
      }
    }
  });

  it('keeps corridor centers flat enough to walk', () => {
    // Along every open cell center, the local slope to its open neighbors
    // stays under the climb gate, so the labyrinth is fully traversable.
    for (let r = 0; r < MAZE_ROWS; r++) {
      for (let c = 0; c < MAZE_COLS; c++) {
        if (GARDEN_MAZE_GRID[r][c] !== '.') continue;
        const here = cellCenter(c, r);
        const hHere = terrainHeight(here.x, here.z, SEED);
        for (const [dc, dr] of [
          [1, 0],
          [0, 1],
        ]) {
          const oc = c + dc;
          const or = r + dr;
          if (oc >= MAZE_COLS || or >= MAZE_ROWS) continue;
          if (GARDEN_MAZE_GRID[or][oc] !== '.') continue;
          const there = cellCenter(oc, or);
          const hThere = terrainHeight(there.x, there.z, SEED);
          const slope = Math.abs(hThere - hHere) / MAZE_CELL;
          expect(slope, `corridor ${c},${r} -> ${oc},${or}`).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
        }
      }
    }
  });
});

describe('the hedge walls are hard colliders', () => {
  // Find an interior wall cell with open corridor on both its east and west
  // sides, and prove movement cannot cross it, straight or diagonal. The
  // slope gate is not what stops it (a shallow diagonal defeats slope);
  // resolveMovement's hedge wall check is.
  function findCrossableWall(): { c: number; r: number } {
    for (let r = 1; r < MAZE_ROWS - 1; r++) {
      for (let c = 1; c < MAZE_COLS - 1; c++) {
        if (GARDEN_MAZE_GRID[r][c] !== '#') continue;
        if (GARDEN_MAZE_GRID[r][c - 1] === '.' && GARDEN_MAZE_GRID[r][c + 1] === '.') {
          return { c, r };
        }
      }
    }
    throw new Error('no wall with corridors on both sides');
  }

  it('blocks walking straight through a hedge', () => {
    const wall = findCrossableWall();
    const from = cellCenter(wall.c - 1, wall.r);
    const to = cellCenter(wall.c + 1, wall.r);
    const end = resolveMovement(SEED, from.x, from.z, to.x, to.z, 0.5);
    // never inside the hedge, and never on the far side
    expect(inGardenMazeWall(end.x, end.z)).toBe(false);
    const wallWest = MAZE_X0 + wall.c * MAZE_CELL;
    expect(end.x).toBeLessThan(wallWest + 1);
  });

  it('blocks the diagonal cheese over a hedge', () => {
    const wall = findCrossableWall();
    const from = cellCenter(wall.c - 1, wall.r);
    // a long shallow diagonal aimed across the wall
    const to = { x: from.x + MAZE_CELL * 2, z: from.z + 3 };
    let x = from.x;
    let z = from.z;
    // push repeatedly, as a player holding a diagonal key would
    for (let i = 0; i < 40; i++) {
      const step = resolveMovement(SEED, x, z, to.x, to.z, 0.5);
      x = step.x;
      z = step.z;
    }
    expect(inGardenMazeWall(x, z)).toBe(false);
    const wallWest = MAZE_X0 + wall.c * MAZE_CELL;
    expect(x, 'slid along the hedge, never across it').toBeLessThan(wallWest + 1);
  });

  it('lets movement flow freely along a corridor', () => {
    // control: the same mover walks the entrance corridor unimpeded
    const entranceCol = GARDEN_MAZE_GRID[MAZE_ROWS - 1].indexOf('.');
    const from = cellCenter(entranceCol, MAZE_ROWS - 1);
    const to = cellCenter(entranceCol, MAZE_ROWS - 3);
    const end = resolveMovement(SEED, from.x, from.z, to.x, to.z, 0.5);
    expect(Math.hypot(end.x - to.x, end.z - to.z)).toBeLessThan(1);
  });
});
