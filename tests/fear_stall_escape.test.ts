import { describe, expect, it } from 'vitest';
import {
  FEAR_ESCAPE_FAN,
  FEAR_STALL_STEP_FRACTION,
  type FearFleeStepper,
  fleeAlongOpenHeading,
  wrapHeading,
} from '../src/sim/combat/fear_steering';
import { battlegroundOrigin } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { DT } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

// A feared player runs one heading for the whole fear. The predictive wall guard
// (steerFearFromWalls) turns that heading off a wall it can SEE in the collider set,
// but the mover refuses steps for reasons a collider probe never sees: authored
// relief steeper than the climb limit (all of Thornhollow), a garden hedge, the
// waterline. Where the probe and the mover disagreed the run pinned anyway, which is
// the "feared into the decor" report from the 5v5 battleground.
//
// fleeAlongOpenHeading closes the loop on the OUTCOME: run the step, measure what it
// covered, and turn until one delivers. Whatever refused the step shows up the same
// way, so this arm has no world model to keep in sync with the mover.

const STEP = 1; // one yard of intended travel, so the stall bar is FEAR_STALL_STEP_FRACTION
const BAR = STEP * FEAR_STALL_STEP_FRACTION;

/** Synthetic mover: a step along `heading` covers a full step when the heading is one
 *  of `open`, and nothing otherwise. Records the call order so the search's shape is
 *  observable without a live Sim. */
function fakeStepper(open: number[], tol = 1e-9) {
  const steps: number[] = [];
  const rewinds: number[] = [];
  let at = 0;
  const stepper: FearFleeStepper = {
    step(heading: number): number {
      steps.push(heading);
      at = open.some((o) => Math.abs(wrapHeading(heading - o)) <= tol) ? STEP : 0;
      return at;
    },
    rewind(): void {
      rewinds.push(steps.length);
      at = 0;
    },
  };
  return { stepper, steps, rewinds, moved: () => at };
}

describe('fear stall escape (pure core)', () => {
  it('keeps a heading that delivers, and pays for exactly one step', () => {
    const f = fakeStepper([0.7]);
    expect(fleeAlongOpenHeading(0.7, STEP, f.stepper)).toBe(0.7);
    expect(f.steps).toEqual([0.7]); // no fan walked on the open-ground path
    expect(f.rewinds).toEqual([]); // and the body is left where the step put it
  });

  it('turns to the first fan heading that actually moves the body', () => {
    // Straight ahead is refused; a third of a turn to the left is open.
    const f = fakeStepper([0.7 + Math.PI / 3]);
    const chosen = fleeAlongOpenHeading(0.7, STEP, f.stepper);
    expect(chosen).toBeCloseTo(wrapHeading(0.7 + Math.PI / 3), 10);
    expect(f.moved()).toBe(STEP); // committed step, not a rewound probe
    // Smallest turns first, and every refused candidate is rewound before the next.
    expect(f.steps).toEqual([0.7, 0.7 + Math.PI / 6, 0.7 - Math.PI / 6, 0.7 + Math.PI / 3]);
    expect(f.rewinds).toEqual([1, 2, 3]);
  });

  it('reverses when only the way back is open (a dead end still empties)', () => {
    const f = fakeStepper([wrapHeading(0.7 + Math.PI)]);
    expect(fleeAlongOpenHeading(0.7, STEP, f.stepper)).toBeCloseTo(wrapHeading(0.7 + Math.PI), 10);
    expect(f.moved()).toBe(STEP);
  });

  it('a step under the stall bar does not count as delivered', () => {
    const steps: number[] = [];
    const stepper: FearFleeStepper = {
      step(h: number): number {
        steps.push(h);
        return BAR - 1e-9; // every heading gives a sub-bar nudge: sealed
      },
      rewind(): void {},
    };
    expect(fleeAlongOpenHeading(0.4, STEP, stepper)).toBe(wrapHeading(0.4));
    expect(steps).toHaveLength(FEAR_ESCAPE_FAN.length + 1); // whole fan, then the fallback
  });

  it('a step exactly on the bar counts as delivered', () => {
    const steps: number[] = [];
    const stepper: FearFleeStepper = {
      step(h: number): number {
        steps.push(h);
        return BAR;
      },
      rewind(): void {},
    };
    expect(fleeAlongOpenHeading(0.4, STEP, stepper)).toBe(0.4);
    expect(steps).toEqual([0.4]);
  });

  it('sealed on every heading: keeps the heading, but still takes the best step', () => {
    // Nothing is open; one fan candidate gives more ground than the rest.
    const best = -Math.PI / 6;
    const steps: number[] = [];
    let lastMoved = -1;
    const stepper: FearFleeStepper = {
      step(h: number): number {
        steps.push(h);
        lastMoved = Math.abs(wrapHeading(h - (0.4 + best))) < 1e-9 ? BAR / 2 : BAR / 10;
        return lastMoved;
      },
      rewind(): void {},
    };
    // The heading is UNCHANGED: committing to whichever offset won a sealed tick makes
    // the next tick pick the opposite one, and the body jitters instead of holding.
    expect(fleeAlongOpenHeading(0.4, STEP, stepper)).toBe(wrapHeading(0.4));
    expect(steps[steps.length - 1]).toBeCloseTo(0.4 + best, 10); // best-effort step ran last
    expect(lastMoved).toBe(BAR / 2); // and it is the best candidate's, not a frozen zero
  });

  it('a zero intended step (fully snared) returns immediately without walking the fan', () => {
    const f = fakeStepper([]);
    expect(fleeAlongOpenHeading(1.1, 0, f.stepper)).toBe(1.1);
    expect(f.steps).toEqual([1.1]);
  });

  it('the committed heading is always wrapped to (-PI, PI]', () => {
    for (const off of FEAR_ESCAPE_FAN) {
      const f = fakeStepper([wrapHeading(3.0 + off)]);
      const chosen = fleeAlongOpenHeading(3.0, STEP, f.stepper);
      expect(chosen).toBeGreaterThan(-Math.PI);
      expect(chosen).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('the fan starts straight ahead, is symmetric, and carries a full reversal', () => {
    expect(FEAR_ESCAPE_FAN[0]).toBe(0);
    expect(FEAR_ESCAPE_FAN).toContain(Math.PI);
    for (const off of FEAR_ESCAPE_FAN) {
      if (off === 0 || off === Math.PI) continue;
      expect(FEAR_ESCAPE_FAN).toContain(-off);
    }
    // Non-decreasing turn size, so the shortest way out is always tried first.
    const sizes = FEAR_ESCAPE_FAN.map(Math.abs);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
  });
});

describe('wrapHeading', () => {
  it('bounds a heading to (-PI, PI] without changing its direction', () => {
    const cases: [number, number][] = [
      [0, 0],
      [Math.PI, Math.PI],
      [-Math.PI, Math.PI],
      [Math.PI / 2, Math.PI / 2],
      [-Math.PI / 2, -Math.PI / 2],
      [3 * Math.PI, Math.PI],
      [2 * Math.PI, 0],
      [-3 * Math.PI, Math.PI],
    ];
    for (const [raw, want] of cases) expect(wrapHeading(raw)).toBeCloseTo(want, 12);
    // A many-turn accumulation lands on the same unit vector as the raw angle.
    const raw = 0.7 + 40 * Math.PI;
    expect(Math.sin(wrapHeading(raw))).toBeCloseTo(Math.sin(raw), 10);
    expect(Math.cos(wrapHeading(raw))).toBeCloseTo(Math.cos(raw), 10);
  });
});

// The Thornhollow battleground field, where the report comes from: an authored relief
// map inside a walled rectangle. These field-local spots each FROZE a feared player
// outright on release/v0.40.0 (under a twentieth of a yard of travel over three
// seconds of fear) because the mover refused every step the collider probe called
// open. Found by sweeping every playable yard of the field against sixteen headings.
const FROZEN_SPOTS: { x: number; z: number; heading: number; what: string }[] = [
  { x: 30, z: -26, heading: 0, what: 'chamber cover' },
  { x: 7, z: -39, heading: -(3 * Math.PI) / 8, what: 'heart ruin approach' },
  { x: 7, z: -38, heading: (5 * Math.PI) / 8, what: 'heart ruin approach, mirrored' },
  { x: -24, z: -47, heading: Math.PI / 2, what: 'curtain wall pocket' },
  { x: -21, z: -54, heading: -Math.PI / 8, what: 'gatehouse corner' },
];

type FearHooks = {
  updateFearMovement(e: unknown): boolean;
  fleeMoveSpeed(e: unknown): number;
};

function fearedInBattleground(localX: number, localZ: number, heading: number) {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const origin = battlegroundOrigin(0);
  const p = sim.player;
  const x = origin.x + localX;
  const z = origin.z + localZ;
  p.pos = { x, y: sim.groundPos(x, z).y, z };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  p.auras.push({
    id: 'fear_incap',
    name: 'Fear',
    kind: 'incapacitate',
    remaining: 60,
    duration: 60,
    value: heading,
    sourceId: 0,
    school: 'shadow',
  });
  return { sim, p, hooks: sim as unknown as FearHooks, from: { x, z } };
}

/** Yards of ground actually covered over `ticks` of fear (path length, not net
 *  displacement): the number that separates a body that RUNS from one pinned in place. */
function fleePathLength(sim: Sim, ticks: number): number {
  const hooks = sim as unknown as FearHooks;
  const p = sim.player;
  let path = 0;
  let px = p.pos.x;
  let pz = p.pos.z;
  for (let i = 0; i < ticks; i++) {
    hooks.updateFearMovement(p);
    path += Math.hypot(p.pos.x - px, p.pos.z - pz);
    px = p.pos.x;
    pz = p.pos.z;
  }
  return path;
}

describe('feared players are never pinned in the battleground (regression)', () => {
  for (const spot of FROZEN_SPOTS) {
    it(`runs instead of freezing at ${spot.x},${spot.z} (${spot.what})`, () => {
      const { sim, p, hooks } = fearedInBattleground(spot.x, spot.z, spot.heading);
      const ticks = 60; // three seconds of fear
      const unobstructed = hooks.fleeMoveSpeed(p) * DT * ticks;
      expect(unobstructed).toBeGreaterThan(0); // the fixture is not vacuously slow
      // The bar is a conservative fraction of the ground an unobstructed flee covers,
      // so a wall-hugging run clears it and a pinned body cannot.
      expect(fleePathLength(sim, ticks)).toBeGreaterThan(unobstructed * 0.5);
    });
  }

  // Two cells of the field sit inside a prop's baked collision (a thicket) where the
  // mover refuses EVERY heading, not just the feared one. Geometry that sealed cannot
  // be opened from the movement code, and re-picking a heading there would only make
  // the body jitter. What the escape guarantees is the part that is in reach: the body
  // is no longer frozen outright, and it holds one heading while it is boxed in.
  it('a sealed thicket pocket is no longer a hard freeze, and does not jitter', () => {
    const { sim, p, hooks } = fearedInBattleground(-4, 34, 0);
    const path = fleePathLength(sim, 60);
    expect(path).toBeGreaterThan(1); // release/v0.40.0 covered 0.05 yards here
    const held = p.auras.find((a) => a.id === 'fear_incap')?.value;
    for (let i = 0; i < 40; i++) {
      hooks.updateFearMovement(p);
      expect(p.auras.find((a) => a.id === 'fear_incap')?.value).toBe(held); // one course
    }
  });

  it('the flee heading stays bounded for the whole fear', () => {
    const { sim, p, hooks } = fearedInBattleground(-24, -47, Math.PI / 2);
    for (let i = 0; i < 200; i++) {
      hooks.updateFearMovement(p);
      const value = p.auras.find((a) => a.id === 'fear_incap')?.value;
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value ?? 0)).toBeLessThanOrEqual(Math.PI);
    }
    expect(sim.player).toBe(p);
  });

  it('is deterministic: the same seed and spot replay identically', () => {
    const run = (): number[] => {
      const { p, hooks } = fearedInBattleground(7, -39, -(3 * Math.PI) / 8);
      const out: number[] = [];
      for (let i = 0; i < 40; i++) {
        hooks.updateFearMovement(p);
        out.push(p.pos.x, p.pos.z, p.auras.find((a) => a.id === 'fear_incap')?.value ?? 0);
      }
      return out;
    };
    const first = run();
    expect(first).toEqual(run());
    expect(first.some((v, i) => i % 3 === 0 && v !== first[0])).toBe(true); // it moved
  });

  it('draws no rng: the shared stream is untouched by a feared step', () => {
    // The stall escape retries a blocked step up to a full fan per tick, so a single
    // stray draw in that loop would fork the world between the three hosts.
    const { sim } = fearedInBattleground(-24, -47, Math.PI / 2);
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    const path = fleePathLength(sim, 60);
    sim.rng.setObserver(null);
    expect(path).toBeGreaterThan(1); // the fan really ran, so the count is not vacuous
    expect(draws).toBe(0);
  });

  it('open ground keeps the heading it was feared on', () => {
    const { sim, p } = fearedInBattleground(20, 0, 0);
    const from = { x: p.pos.x, z: p.pos.z };
    fleePathLength(sim, 20);
    expect(p.auras.find((a) => a.id === 'fear_incap')?.value).toBe(0);
    expect(p.pos.z - from.z).toBeGreaterThan(1); // ran the way the fear pointed
    expect(Math.abs(p.pos.x - from.x)).toBeLessThan(0.5); // and straight, not veering
  });
});
