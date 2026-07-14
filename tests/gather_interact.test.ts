// Player-input path for gather-node harvest (#1888). Every pre-existing
// gathering test drives sim.harvestNode directly, which is exactly why the
// missing client trigger shipped green: nothing proved a player INPUT reaches
// the sim. These tests drive tryHarvestNearestNode (the arm the Interact
// key/button consumes via interactKey() in src/main.ts) against a real offline
// Sim standing in as the IWorld, plus a source-level wiring guard so removing
// the main.ts call site fails CI even though main.ts itself is not
// unit-testable.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tryHarvestNearestNode } from '../src/game/gather_interact';
import { GATHER_NODES, NPCS } from '../src/sim/data';
import { NODE_HARVEST_TABLE } from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import { INTERACT_RANGE } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const ORE_NODES = GATHER_NODES.filter((n) => n.type === 'ore');
const NODE_A = ORE_NODES[0];
const NODE_B = ORE_NODES[1];
const ORE_ITEM = NODE_HARVEST_TABLE.ore.itemId;

function makeWorld() {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  // First-added player becomes the primary, so the IWorld local-viewer
  // surface (world.player / nodeHarvestableByMe / harvestNode) targets it.
  const pid = sim.addPlayer('warrior', 'Interactor');
  return { sim, pid };
}

function teleportTo(sim: Sim, pid: number, x: number, z: number) {
  const p = sim.entities.get(pid)!;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function acceptProfIntro(sim: Sim, pid: number) {
  const giver = NPCS.foreman_odell;
  teleportTo(sim, pid, giver.pos.x, giver.pos.z);
  sim.acceptQuest('q_prof_intro', pid);
  sim.tick();
  if (sim.questState('q_prof_intro', pid) !== 'active') throw new Error('quest not active');
}

describe('tryHarvestNearestNode: the Interact input path harvests (#1888)', () => {
  it('standing on a node, an interact press grants the material, the quest item, and the gather event', () => {
    const { sim, pid } = makeWorld();
    acceptProfIntro(sim, pid);
    teleportTo(sim, pid, NODE_A.pos.x, NODE_A.pos.z);

    sim.drainEvents();
    expect(tryHarvestNearestNode(sim)).toBe(true);
    const events = sim.drainEvents();
    sim.tick();

    expect(sim.countItem(ORE_ITEM, pid)).toBe(1);
    expect(sim.countItem('chunk_of_ore', pid)).toBe(1);
    expect(events.some((e) => e.type === 'gatherResult')).toBe(true);
    expect(sim.nodeHarvestableByMeFor(NODE_A.id, pid)).toBe(false);
  });

  it('an immediate second press attempts the cooldown node and surfaces the sim denial', () => {
    const { sim, pid } = makeWorld();
    // wood_eastbrook_1 is the nearest-neighbor-isolated placement (no other
    // node within INTERACT_RANGE), so the second press has no ready fallback
    // and must attempt the cooldown node itself.
    const lone = GATHER_NODES.find((n) => n.id === 'wood_eastbrook_1')!;
    const woodItem = NODE_HARVEST_TABLE.wood.itemId;
    teleportTo(sim, pid, lone.pos.x, lone.pos.z);
    expect(tryHarvestNearestNode(sim)).toBe(true);
    sim.drainEvents();

    // Still true: an attempt was dispatched (the sim owns the outcome), so
    // interactKey never claims "Nothing to interact with" beside a vein.
    expect(tryHarvestNearestNode(sim)).toBe(true);
    const events = sim.drainEvents();
    expect(
      events.some(
        (e) => e.type === 'error' && e.text === 'This resource node has not respawned for you yet.',
      ),
    ).toBe(true);
    expect(sim.countItem(woodItem, pid)).toBe(1);
  });

  it('returns false with no node in range, so interactKey falls through to its own error', () => {
    const { sim, pid } = makeWorld();
    teleportTo(sim, pid, NODE_A.pos.x + 1000, NODE_A.pos.z + 1000);
    sim.drainEvents();
    expect(tryHarvestNearestNode(sim)).toBe(false);
    expect(sim.drainEvents()).toEqual([]);
    expect(sim.countItem(ORE_ITEM, pid)).toBe(0);
  });

  it('prefers the nearest node, and a ready node over a nearer cooldown node', () => {
    const { sim, pid } = makeWorld();
    // Stand between two ore nodes, measurably closer to NODE_A, with both
    // inside INTERACT_RANGE of the standing point.
    const mid = {
      x: NODE_A.pos.x + (NODE_B.pos.x - NODE_A.pos.x) * 0.2,
      z: NODE_A.pos.z + (NODE_B.pos.z - NODE_A.pos.z) * 0.2,
    };
    const distTo = (n: { pos: { x: number; z: number } }) =>
      Math.hypot(n.pos.x - mid.x, n.pos.z - mid.z);
    expect(distTo(NODE_A)).toBeLessThan(distTo(NODE_B));
    expect(distTo(NODE_A)).toBeLessThan(INTERACT_RANGE);
    expect(distTo(NODE_B)).toBeLessThan(INTERACT_RANGE);
    teleportTo(sim, pid, mid.x, mid.z);

    // First press: both ready, the nearer NODE_A wins.
    expect(tryHarvestNearestNode(sim)).toBe(true);
    expect(sim.nodeHarvestableByMeFor(NODE_A.id, pid)).toBe(false);
    expect(sim.nodeHarvestableByMeFor(NODE_B.id, pid)).toBe(true);

    // Second press: NODE_A is nearer but on cooldown for this viewer, so the
    // ready NODE_B is preferred and harvested.
    expect(tryHarvestNearestNode(sim)).toBe(true);
    expect(sim.nodeHarvestableByMeFor(NODE_B.id, pid)).toBe(false);
    expect(sim.countItem(ORE_ITEM, pid)).toBe(2);
  });
});

describe('q_prof_intro end to end through the player-input path (#1888)', () => {
  it('a fresh level 1 character accepts, mines 5 chunks via Interact only, and turns in for the rewards', () => {
    const { sim, pid } = makeWorld();
    const meta = sim.players.get(pid)!;
    expect(sim.entities.get(pid)!.level).toBe(1);
    acceptProfIntro(sim, pid);

    // Mine the same vein five times through the input path only, advancing the
    // deterministic clock past the per-player respawn window between presses
    // (same convention as the direct-harvest tests). No pickaxe, no learned
    // profession: the current sim gates require neither.
    teleportTo(sim, pid, NODE_A.pos.x, NODE_A.pos.z);
    const need = 5;
    for (let i = 1; i <= need; i++) {
      expect(tryHarvestNearestNode(sim)).toBe(true);
      sim.tick();
      expect(sim.countItem('chunk_of_ore', pid)).toBe(i);
      if (i < need) {
        sim.time += NODE_HARVEST_TABLE.ore.respawnSeconds + 1;
        sim.tick();
      }
    }
    expect(sim.questState('q_prof_intro', pid)).toBe('ready');

    // Walk back to Foreman Odell and turn in: 150 xp and 50 copper on top of
    // whatever the harvests themselves granted.
    const giver = NPCS.foreman_odell;
    teleportTo(sim, pid, giver.pos.x, giver.pos.z);
    const xpBefore = meta.xp;
    const copperBefore = meta.copper;
    sim.turnInQuest('q_prof_intro', pid);
    sim.tick();
    expect(sim.questState('q_prof_intro', pid)).toBe('done');
    expect(meta.xp).toBe(xpBefore + 150);
    expect(meta.copper).toBe(copperBefore + 50);
  });
});

describe('interactKey wiring guard (#1888)', () => {
  it('main.ts dispatches the gather arm from interactKey, before the nothing-to-interact error', () => {
    // main.ts is not unit-testable (module side effects on import), so pin the
    // wiring at source level the way other source-scraping guards in this repo
    // do: removing the import or the call site fails here even though the
    // module tests above still pass.
    const src = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    expect(src).toMatch(/import \{ tryHarvestNearestNode \} from '.\/game\/gather_interact'/);
    expect(src).toContain('if (tryHarvestNearestNode(world)) return;');
    // Ordering: the arm must run before the fallback error inside interactKey.
    const arm = src.indexOf('if (tryHarvestNearestNode(world)) return;');
    const fallback = src.indexOf("hud.showError(t('errors.nothingInteract'))");
    expect(arm).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(arm);
  });
});
