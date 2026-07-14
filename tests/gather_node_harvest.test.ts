import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { GATHER_NODES, NPCS } from '../src/sim/data';
import {
  MATERIAL_RARITY_MAX_PROFICIENCY,
  NODE_HARVEST_TABLE,
} from '../src/sim/professions/gathering';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function mustMeta(sim: Sim, pid: number) {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error(`missing player meta ${pid}`);
  return meta;
}

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
    // B is now on cooldown for B; A's cooldown is unaffected by B harvesting:
    // it stays on the same denial it already had before B ever harvested.
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pidB)).toBe(false);
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pidA)).toBe(false);
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
    // A richer observable than "granted or not": the exact sim-time at which
    // the node becomes harvestable again (drives from ctx.time + a fixed
    // respawnSeconds, no rng, so it must land on the exact same tick every
    // run) plus the settled gathering-profession skill value, so a
    // regression that shifts either the timer or the grant amount is caught.
    const run = () => {
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Det');
      teleportOntoNode(sim, pid, NODE_ID);
      sim.harvestNode(NODE_ID, pid);
      sim.tick();
      const node = mustNode(NODE_ID);
      const entry = NODE_HARVEST_TABLE[node.type];
      // Advance to just short of the respawn window and record readiness,
      // then past it, so both edges of the timer are part of the observable.
      sim.time += entry.respawnSeconds - 1;
      sim.tick();
      const notYetReady = sim.nodeHarvestableByMeFor(NODE_ID, pid);
      sim.time += 2;
      sim.tick();
      const nowReady = sim.nodeHarvestableByMeFor(NODE_ID, pid);
      const skill = sim
        .professionsStateFor(pid)
        .skills.find((s) => s.professionId === entry.professionId)?.skill;
      return {
        count: sim.countItem(entry.itemId, pid),
        notYetReady,
        nowReady,
        skill,
      };
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

  it('a harvest grants the matching gathering profession one point of skill', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Skiller');
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    const before = sim
      .professionsStateFor(pid)
      .skills.find((s) => s.professionId === entry.professionId)?.skill;
    sim.harvestNode(NODE_ID, pid);
    // The grant is queued this tick and drained on the next tick's per-player
    // pass (same cadence as every other pendingGatherGrant drain), so tick
    // once to let it land before asserting.
    sim.tick();
    const after = sim
      .professionsStateFor(pid)
      .skills.find((s) => s.professionId === entry.professionId)?.skill;
    expect(after).toBe((before ?? 0) + 1);
  });

  it('a harvest grants character XP scaled to the node level (profession XP)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'XpMiner');
    teleportOntoNode(sim, pid, NODE_ID);
    const meta = mustMeta(sim, pid);
    const before = meta.xp;

    sim.harvestNode(NODE_ID, pid);
    sim.tick();

    expect(meta.xp).toBeGreaterThan(before);
  });

  it('a harvest of a node far below a high-level player grants zero XP (gray band)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'MaxLevelMiner');
    teleportOntoNode(sim, pid, NODE_ID);
    sim.setPlayerLevel(20);
    const meta = mustMeta(sim, pid);
    const before = meta.xp;

    sim.harvestNode(NODE_ID, pid);
    sim.tick();

    expect(meta.xp).toBe(before);
  });

  it('denies harvest for a dead player without granting the item or the timer', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Ghost');
    teleportOntoNode(sim, pid, NODE_ID);
    const p = mustEntity(sim, pid);
    p.dead = true;

    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];
    const before = sim.countItem(entry.itemId, pid);
    sim.harvestNode(NODE_ID, pid);
    sim.tick();
    expect(sim.countItem(entry.itemId, pid)).toBe(before);
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(true);
  });

  it('denies harvest when the bag is full, without consuming the respawn timer', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'FullBags');
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    // Fill every bag slot with non-stacking instanced junk so canAddItem
    // denies regardless of the harvested item's own stack state (an
    // instanced slot, unlike a plain stack, never merges further adds).
    const meta = mustMeta(sim, pid);
    const capacity = bagCapacity(meta.bags);
    meta.inventory.length = 0;
    for (let i = 0; i < capacity; i++) {
      meta.inventory.push({ itemId: 'bone_fragments', count: 1, instance: { boundTo: pid } });
    }
    expect(sim.canAddItem(entry.itemId, 1, pid)).toBe(false);

    sim.harvestNode(NODE_ID, pid);
    sim.tick();
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(true);
  });

  it('spends exactly one rng draw on a granted harvest and none on any denial path', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'DrawCount');
    const fullBagsPid = sim.addPlayer('warrior', 'DrawCountFull');
    teleportOntoNode(sim, pid, NODE_ID);
    teleportOntoNode(sim, fullBagsPid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    // Stuff the second player's bags up front so the bags-full branch below
    // stays reachable while their own per-player node timer is still fresh
    // (the readiness check sits before the capacity check).
    const fullMeta = mustMeta(sim, fullBagsPid);
    fullMeta.inventory.length = 0;
    for (let i = 0; i < bagCapacity(fullMeta.bags); i++) {
      fullMeta.inventory.push({
        itemId: 'bone_fragments',
        count: 1,
        instance: { boundTo: fullBagsPid },
      });
    }
    expect(sim.canAddItem(entry.itemId, 1, fullBagsPid)).toBe(false);

    // The rarity roll (#1122) pulls from the SHARED sim rng, so a draw on a
    // denial would advance the whole sim's stream and desync every downstream
    // roll. harvestNode dispatches synchronously and nothing ticks inside
    // this bracket, so every counted draw belongs to the harvest path.
    let draws = 0;
    (sim as unknown as { rng: { setObserver(fn: () => void): void } }).rng.setObserver(() => {
      draws++;
    });

    sim.harvestNode(NODE_ID, pid); // granted: exactly the one rarity draw
    expect(draws).toBe(1);

    draws = 0;
    sim.harvestNode(NODE_ID, pid); // denied: not respawned for this player yet
    expect(draws).toBe(0);
    sim.harvestNode('no_such_node_id', pid); // denied: unknown node
    expect(draws).toBe(0);
    sim.harvestNode(NODE_ID, fullBagsPid); // denied: bags full
    expect(draws).toBe(0);
    const p = mustEntity(sim, pid);
    p.pos.x = node.pos.x + 100;
    p.prevPos = { ...p.pos };
    sim.harvestNode(NODE_ID, pid); // denied: too far away
    expect(draws).toBe(0);
    p.dead = true;
    sim.harvestNode(NODE_ID, pid); // denied: dead, the first guard in the chain
    expect(draws).toBe(0);
  });
});

describe('bag-full quest-item feedback (#1888)', () => {
  const ORE_NODE_ID = GATHER_NODES.find((n) => n.type === 'ore')!.id;

  // Walks the player to Foreman Odell, accepts q_prof_intro, then stands them
  // on the ore node, so a harvest wants BOTH the material and chunk_of_ore.
  function acceptProfIntroOnNode(sim: Sim, pid: number) {
    const giver = NPCS.foreman_odell;
    const p = mustEntity(sim, pid);
    p.pos.x = giver.pos.x;
    p.pos.z = giver.pos.z;
    p.pos.y = terrainHeight(giver.pos.x, giver.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    sim.acceptQuest('q_prof_intro', pid);
    sim.tick();
    if (sim.questState('q_prof_intro', pid) !== 'active') throw new Error('quest not active');
    teleportOntoNode(sim, pid, ORE_NODE_ID);
  }

  it('denies the whole harvest with a bags-full error when the quest item cannot fit, preserving the timer', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'QuestFull');
    acceptProfIntroOnNode(sim, pid);
    const meta = mustMeta(sim, pid);

    // Every slot holds non-stacking instanced junk EXCEPT one plain
    // bone_fragments stack with room: the harvested material can merge into
    // that stack, but chunk_of_ore has no free slot and no stack of its own.
    const capacity = bagCapacity(meta.bags);
    meta.inventory.length = 0;
    for (let i = 0; i < capacity - 1; i++) {
      meta.inventory.push({ itemId: 'bone_fragments', count: 1, instance: { boundTo: pid } });
    }
    meta.inventory.push({ itemId: 'bone_fragments', count: 1 });
    expect(sim.canAddItem('bone_fragments', 1, pid)).toBe(true);
    expect(sim.canAddItem('chunk_of_ore', 1, pid)).toBe(false);

    const materialBefore = sim.countItem('bone_fragments', pid);
    sim.drainEvents();
    sim.harvestNode(ORE_NODE_ID, pid);
    // Drain BEFORE tick: tick() itself flushes and returns the event queue.
    const events = sim.drainEvents();
    sim.tick();

    // Nothing granted, the denial is loud, and the per-player respawn timer
    // is untouched so clearing a slot lets the player re-harvest immediately.
    expect(sim.countItem('bone_fragments', pid)).toBe(materialBefore);
    expect(sim.countItem('chunk_of_ore', pid)).toBe(0);
    expect(sim.nodeHarvestableByMeFor(ORE_NODE_ID, pid)).toBe(true);
    expect(events.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
    expect(events.some((e) => e.type === 'gatherResult')).toBe(false);
  });

  it('the one-free-slot race still grants the material but errors loudly on the skipped quest item', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'OneSlot');
    acceptProfIntroOnNode(sim, pid);
    const meta = mustMeta(sim, pid);

    // Exactly ONE free slot and no mergeable stack of either item: both
    // pre-checks pass individually, but the material's add consumes the slot,
    // so the quest-item add finds full bags. This edge must never be silent.
    const capacity = bagCapacity(meta.bags);
    meta.inventory.length = 0;
    for (let i = 0; i < capacity - 1; i++) {
      meta.inventory.push({ itemId: 'wolf_fang', count: 1, instance: { boundTo: pid } });
    }
    expect(sim.canAddItem('bone_fragments', 1, pid)).toBe(true);
    expect(sim.canAddItem('chunk_of_ore', 1, pid)).toBe(true);

    sim.drainEvents();
    sim.harvestNode(ORE_NODE_ID, pid);
    // Drain BEFORE tick: tick() itself flushes and returns the event queue.
    const events = sim.drainEvents();
    sim.tick();

    expect(sim.countItem('bone_fragments', pid)).toBe(1);
    expect(sim.countItem('chunk_of_ore', pid)).toBe(0);
    // The material grant consumed the timer (the harvest itself succeeded).
    expect(sim.nodeHarvestableByMeFor(ORE_NODE_ID, pid)).toBe(false);
    expect(events.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(true);
  });

  it('a quest-item-full denial spends no rng draw (no draw-order skew from the new gate)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'NoDraw');
    acceptProfIntroOnNode(sim, pid);
    const meta = mustMeta(sim, pid);
    const capacity = bagCapacity(meta.bags);
    meta.inventory.length = 0;
    for (let i = 0; i < capacity - 1; i++) {
      meta.inventory.push({ itemId: 'bone_fragments', count: 1, instance: { boundTo: pid } });
    }
    meta.inventory.push({ itemId: 'bone_fragments', count: 1 });

    let draws = 0;
    (sim as unknown as { rng: { setObserver(fn: () => void): void } }).rng.setObserver(() => {
      draws++;
    });
    sim.harvestNode(ORE_NODE_ID, pid);
    expect(draws).toBe(0);
  });
});

describe('pendingNodeCooldowns boundary (#1888)', () => {
  it('agrees with isNodeHarvestableBy at the exact readyAt instant: due means ready and absent from gnodes', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Boundary');
    const meta = mustMeta(sim, pid);

    // Exactly due (readyAt === now): harvestable again, so it must NOT ship as
    // cooling, or the online minimap would paint a harvestable vein on
    // cooldown forever at the boundary.
    meta.nodeHarvestReadyAt[NODE_ID] = sim.time;
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(true);
    expect(sim.nodeHarvestPendingFor(pid)).toEqual({});

    // One tick short of due: still cooling, so it ships with its stamp.
    const readyAt = sim.time + 0.05;
    meta.nodeHarvestReadyAt[NODE_ID] = readyAt;
    expect(sim.nodeHarvestableByMeFor(NODE_ID, pid)).toBe(false);
    expect(sim.nodeHarvestPendingFor(pid)).toEqual({ [NODE_ID]: readyAt });
  });
});

describe('gather tool use feedback (#1888)', () => {
  it('using a mining pick from the bag emits the gather hint instead of silently doing nothing', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'PickUser');
    const meta = mustMeta(sim, pid);
    meta.inventory.push({ itemId: 'copper_mining_pick', count: 1 });

    sim.drainEvents();
    sim.useItem('copper_mining_pick', pid);
    const events = sim.drainEvents();
    expect(
      events.some(
        (e) =>
          e.type === 'log' &&
          e.text === 'Walk up to a resource node and interact with it to harvest.',
      ),
    ).toBe(true);
    // The pick is a permanent tool: giving feedback never consumes it.
    expect(sim.countItem('copper_mining_pick', pid)).toBe(1);
  });

  it('every gathering tool kind (pick, axe, sickle) gives the same feedback', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'ToolUser');
    const meta = mustMeta(sim, pid);
    for (const toolId of ['handaxe', 'gathering_sickle']) {
      meta.inventory.push({ itemId: toolId, count: 1 });
      sim.drainEvents();
      sim.useItem(toolId, pid);
      expect(
        sim
          .drainEvents()
          .some(
            (e) =>
              e.type === 'log' &&
              e.text === 'Walk up to a resource node and interact with it to harvest.',
          ),
        toolId,
      ).toBe(true);
    }
  });
});

describe('gather-completion event for audio (#1729)', () => {
  it('a granted harvest emits a personal gatherResult carrying node/profession/item/rarity', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Harvester');
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];

    sim.drainEvents();
    sim.harvestNode(NODE_ID, pid);
    const gather = sim.drainEvents().find((e) => e.type === 'gatherResult');
    if (gather?.type !== 'gatherResult') throw new Error('expected a gatherResult event');
    // Personal: carries the acting player's pid so the server routes it only to
    // the harvester (delivered-to-acting-player acceptance criterion).
    expect(gather.pid).toBe(pid);
    expect(gather.nodeId).toBe(node.id);
    expect(gather.nodeType).toBe(node.type);
    expect(gather.professionId).toBe(entry.professionId);
    expect(gather.itemId).toBe(entry.itemId);
    // A proficiency-0 harvest always rolls common (the rarity ladder puts all
    // weight on common at proficiency 0), so this exact value is seed-independent.
    expect(gather.rarity).toBe('common');
  });

  it('the emitted rarity reflects the actual roll: a max-proficiency harvest never reports common', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Proficient');
    teleportOntoNode(sim, pid, NODE_ID);
    const node = mustNode(NODE_ID);
    const entry = NODE_HARVEST_TABLE[node.type];
    const meta = mustMeta(sim, pid);
    // At max proficiency the rarity ladder puts ZERO weight on common, so the
    // emitted rarity must be one of the four higher tiers. This proves the event
    // carries the value actually rolled, not a hard-coded 'common'.
    meta.gatheringProficiency[entry.professionId] = MATERIAL_RARITY_MAX_PROFICIENCY;

    sim.drainEvents();
    sim.harvestNode(NODE_ID, pid);
    const gather = sim.drainEvents().find((e) => e.type === 'gatherResult');
    if (gather?.type !== 'gatherResult') throw new Error('expected a gatherResult event');
    expect(gather.rarity).not.toBe('common');
    expect(['uncommon', 'rare', 'epic', 'legendary']).toContain(gather.rarity);
  });

  it('no gatherResult is emitted on any denial path (too far, dead, unknown node)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Denied');
    const p = mustEntity(sim, pid);
    // Too far from any node.
    p.pos.x = -9999;
    p.pos.z = -9999;
    p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    sim.drainEvents();
    sim.harvestNode(NODE_ID, pid);
    expect(sim.drainEvents().some((e) => e.type === 'gatherResult')).toBe(false);

    // Dead player standing on the node.
    teleportOntoNode(sim, pid, NODE_ID);
    p.dead = true;
    sim.drainEvents();
    sim.harvestNode(NODE_ID, pid);
    expect(sim.drainEvents().some((e) => e.type === 'gatherResult')).toBe(false);

    // Unknown node id.
    p.dead = false;
    sim.drainEvents();
    sim.harvestNode('not_a_real_node', pid);
    expect(sim.drainEvents().some((e) => e.type === 'gatherResult')).toBe(false);
  });

  it('the gatherResult event is deterministic across runs (same seed, same harvest)', () => {
    const run = () => {
      const sim = makeWorld();
      const pid = sim.addPlayer('warrior', 'Det');
      teleportOntoNode(sim, pid, NODE_ID);
      sim.drainEvents();
      sim.harvestNode(NODE_ID, pid);
      return sim.drainEvents().find((e) => e.type === 'gatherResult');
    };
    expect(run()).toEqual(run());
  });
});
