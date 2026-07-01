import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/data';
import { NODE_HARVEST_TABLE } from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function mustEntity(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function mustNode(nodeId: string) {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  return node;
}

// Teleports a player entity onto a node's exact (x, z) so the distance check
// always passes; matches the teleportTo helper convention in sim.test.ts.
function teleportOntoNode(sim: Sim, pid: number, nodeId: string) {
  const node = GATHER_NODES.find((n) => n.id === nodeId);
  if (!node) throw new Error(`missing node ${nodeId}`);
  const p = mustEntity(sim, pid);
  p.pos.x = node.pos.x;
  p.pos.z = node.pos.z;
  p.pos.y = terrainHeight(node.pos.x, node.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

const NODE_ID = GATHER_NODES[0].id;

describe('gather node harvest (#1121)', () => {
  it('a player near a node receives the material item on harvest', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Miner');
    teleportOntoNode(sim, pid, NODE_ID);

    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    const before = sim.countItem(entry.itemId, pid);
    sim.harvestNode(NODE_ID, pid);
    sim.tick();
    expect(sim.countItem(entry.itemId, pid)).toBe(before + 1);
  });

  it('denies harvest when the player is too far from the node', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'FarAway');
    const p = mustEntity(sim, pid);
    p.pos.x = -9999;
    p.pos.z = -9999;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };

    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];
    const before = sim.countItem(entry.itemId, pid);
    sim.harvestNode(NODE_ID, pid);
    sim.tick();
    expect(sim.countItem(entry.itemId, pid)).toBe(before);
  });

  it("two players harvesting the same node each get their own respawn timer: A's harvest never blocks B", () => {
    const sim = makeWorld();
    const pidA = sim.addPlayer('warrior', 'PlayerA');
    const pidB = sim.addPlayer('warrior', 'PlayerB');
    teleportOntoNode(sim, pidA, NODE_ID);
    teleportOntoNode(sim, pidB, NODE_ID);

    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    // Player A harvests first.
    sim.harvestNode(NODE_ID, pidA);
    sim.tick();
    expect(sim.countItem(entry.itemId, pidA)).toBe(1);
    // Player A's own node is now on cooldown for A.
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pidA)).toBe(false);

    // Player B, who never harvested yet, is still able to harvest the SAME
    // node: A's harvest never touched B's timer (no gather rush denial).
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pidB)).toBe(true);
    sim.harvestNode(NODE_ID, pidB);
    sim.tick();
    expect(sim.countItem(entry.itemId, pidB)).toBe(1);
    // B is now on cooldown for B; A's cooldown is unaffected by B harvesting.
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pidB)).toBe(false);
  });

  it('denies a second harvest by the SAME player before their own timer elapses, allows it after', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Repeat');
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    sim.harvestNode(NODE_ID, pid);
    sim.tick();
    expect(sim.countItem(entry.itemId, pid)).toBe(1);

    // Immediately harvesting again is denied: this player's own timer has not
    // elapsed yet.
    sim.harvestNode(NODE_ID, pid);
    sim.tick();
    expect(sim.countItem(entry.itemId, pid)).toBe(1);

    // Fast-forward past the node's respawn window by advancing the sim clock
    // directly (sim.time, not wall-clock) rather than looping thousands of
    // ticks: only the deterministic clock value matters to the readiness
    // check, and a real tick still runs afterward to prove the transition.
    sim.time += entry.respawnSeconds + 1;
    sim.tick();
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(true);
    sim.harvestNode(NODE_ID, pid);
    sim.tick();
    expect(sim.countItem(entry.itemId, pid)).toBe(2);
  });

  it('determinism: the same seed and same sequence of harvests yields the same result', () => {
    const run = () => {
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Det');
      teleportOntoNode(sim, pid, NODE_ID);
      sim.harvestNode(NODE_ID, pid);
      sim.tick();
      const node = mustNode(NODE_ID);
      const entry = NODE_HARVEST_TABLE[node.type];
      return sim.countItem(entry.itemId, pid);
    };
    expect(run()).toEqual(run());
  });

  it('an unknown node id is denied without throwing', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Unknown');
    expect(() => sim.harvestNode('not_a_real_node', pid)).not.toThrow();
    sim.tick();
    expect(sim.nodeHarvestableByMeFor('not_a_real_node', pid)).toBe(false);
  });
});
