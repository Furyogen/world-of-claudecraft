import { describe, expect, it } from 'vitest';
import { ATLANTIS_LAYOUT } from '../src/sim/content/atlantis';
import { PORTAL_PADS, WORLD_MAX_Z, ZONES, zoneAt } from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import { groundHeight, terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 42;

function makeSim() {
  return new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
}

// Test idiom from tests/CLAUDE.md: set pos, snap y to terrain, copy prevPos.
function teleport(sim: Sim, pid: number, x: number, z: number): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error('no player entity');
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

describe('Atlantis zone data', () => {
  it('is the 4th zone band and extends the world north', () => {
    expect(ZONES).toHaveLength(4);
    expect(ZONES[3].id).toBe('atlantis');
    expect(zoneAt(1080).id).toBe('atlantis');
    expect(zoneAt(890).id).toBe('thornpeak_heights');
    expect(WORLD_MAX_Z).toBe(1260);
  });

  it('pairs every portal pad with a dest outside any pad trigger radius', () => {
    for (const pad of PORTAL_PADS) {
      for (const other of PORTAL_PADS) {
        const d = Math.hypot(pad.dest.x - other.pos.x, pad.dest.z - other.pos.z);
        expect(d, `${pad.id} dest lands inside ${other.id} trigger`).toBeGreaterThan(3);
      }
    }
  });
});

describe('the trench seal', () => {
  it('has no walkable step across the zone-3 seam (portal is the only way)', () => {
    // Walking blocks when a single step's rise/run exceeds the climb slope.
    // March south→north over the wall at many x and require every column to
    // hit a blocking step; the old inter-zone ridges keep a road pass, this
    // one must not.
    const step = 0.5;
    for (let x = -175; x <= 175; x += 5) {
      let steepest = 0;
      for (let z = 875; z <= 925; z += step) {
        const rise = terrainHeight(x, z + step, SEED) - terrainHeight(x, z, SEED);
        steepest = Math.max(steepest, rise / step);
      }
      expect(steepest, `climbable column at x=${x}`).toBeGreaterThan(PLAYER_MAX_CLIMB_SLOPE);
    }
  });
});

describe('the domed city terrain', () => {
  it('shapes the three terraces at their authored heights', () => {
    expect(terrainHeight(0, 1080, SEED)).toBeCloseTo(10, 0); // the Lumen Crown
    expect(terrainHeight(-20, 1072, SEED)).toBeCloseTo(5.5, 0); // Pearl Market terrace
    expect(terrainHeight(0, 1120, SEED)).toBeCloseTo(1.5, 0); // Lower Ward
  });

  it('keeps the city dry and the annex + open sea swimmable', () => {
    // city plaza well above water
    expect(terrainHeight(0, 1038, SEED)).toBeGreaterThan(WATER_LEVEL + 1);
    // annex bowl is deep water (swim threshold is WATER_LEVEL - swim depth)
    expect(groundHeight(58, 1112, SEED)).toBeLessThan(WATER_LEVEL - 0.8);
    // open shelf outside the glass is deep ocean
    expect(groundHeight(-100, 1000, SEED)).toBeLessThan(WATER_LEVEL - 0.8);
    // the secret grotto island is dry
    expect(terrainHeight(ATLANTIS_LAYOUT.grotto.x, ATLANTIS_LAYOUT.grotto.z, SEED)).toBeGreaterThan(
      WATER_LEVEL + 1,
    );
  });
});

describe('portal pads', () => {
  it('spawns one pad object per PORTAL_PADS entry', () => {
    const sim = makeSim();
    const pads = [...sim.entities.values()].filter((e) => e.templateId === 'portal_pad');
    expect(pads).toHaveLength(PORTAL_PADS.length);
    const tidegate = PORTAL_PADS.find((p) => p.id === 'tidegate_thornpeak');
    if (!tidegate) throw new Error('tidegate_thornpeak missing');
    expect(
      pads.some((e) => Math.hypot(e.pos.x - tidegate.pos.x, e.pos.z - tidegate.pos.z) < 0.5),
    ).toBe(true);
  });

  it('walks a player through the Tidegate and back to Highwatch', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Diver');
    // step onto the Thornpeak-side Tidegate
    teleport(sim, pid, 110, 800);
    sim.tick();
    const p = sim.entities.get(pid);
    if (!p) throw new Error('player vanished');
    expect(p.pos.x).toBeCloseTo(6, 0);
    expect(p.pos.z).toBeCloseTo(1042, 0);
    expect(zoneAt(p.pos.z).id).toBe('atlantis');
    // step onto the return gate: land at the Highwatch edge in zone 3
    teleport(sim, pid, 0, 1030);
    sim.tick();
    expect(p.pos.x).toBeCloseTo(8, 0);
    expect(p.pos.z).toBeCloseTo(652, 0);
    expect(zoneAt(p.pos.z).id).toBe('thornpeak_heights');
  });

  it('runs the Lumen Lift between the Lower Ward and the Crown', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Diver');
    teleport(sim, pid, 0, 1122);
    sim.tick();
    const p = sim.entities.get(pid);
    if (!p) throw new Error('player vanished');
    expect(p.pos.z).toBeCloseTo(1086, 0); // up on the Crown
    teleport(sim, pid, 0, 1074);
    sim.tick();
    expect(p.pos.z).toBeCloseTo(1118, 0); // back down in the Ward
  });

  it('drops combat state on teleport', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Diver');
    const p = sim.entities.get(pid);
    if (!p) throw new Error('player vanished');
    p.autoAttack = true;
    p.targetId = 12345;
    teleport(sim, pid, 110, 800);
    sim.tick();
    expect(p.autoAttack).toBe(false);
    expect(p.targetId).toBeNull();
  });
});

describe('the Kelpwarden Annex nest', () => {
  it('spawns every sea-beast camp inside the annex bowl', () => {
    const sim = makeSim();
    const ids = ['glimmerfin_eel', 'pearlshell_skitterer', 'kelpshade_lurker', 'undertow_maw'];
    for (const id of ids) {
      const spawned = [...sim.entities.values()].filter(
        (e) => e.kind === 'mob' && e.templateId === id,
      );
      expect(spawned.length, `${id} did not spawn`).toBeGreaterThan(0);
      for (const mob of spawned) {
        const d = Math.hypot(
          mob.pos.x - ATLANTIS_LAYOUT.annex.x,
          mob.pos.z - ATLANTIS_LAYOUT.annex.z,
        );
        expect(d, `${id} strayed outside the annex`).toBeLessThan(ATLANTIS_LAYOUT.annex.r + 6);
      }
    }
  });
});

describe('determinism', () => {
  it('replays the portal round trip identically', () => {
    const run = () => {
      const sim = makeSim();
      const pid = sim.addPlayer('warrior', 'Diver');
      teleport(sim, pid, 110, 800);
      for (let i = 0; i < 60; i++) sim.tick();
      const p = sim.entities.get(pid);
      if (!p) throw new Error('player vanished');
      return { x: p.pos.x, z: p.pos.z, entities: sim.entities.size };
    };
    expect(run()).toEqual(run());
  });
});
