// Duel fixture: a quiet open-world Sim, two level-20 duelists in their Season 2
// PvP kits, and a real accepted duel between them (so isHostileTo, the Warfare
// Offense/Defense multiplier, PvP diminishing returns and the duel 1-HP finish
// rule all run exactly as they do live).

import { SEASON2_SETS } from '../../src/sim/content/pvp_honor_season2';
import { ITEMS } from '../../src/sim/data';
import { parseBisGearFor } from '../../src/sim/dev/parse_bis_loadouts';
import { Sim } from '../../src/sim/sim';
import { ALL_EQUIP_SLOTS, type Entity, type EquipSlot } from '../../src/sim/types';
import {
  entryWaistFeet,
  JEWELRY,
  type Kit,
  PVP_TRINKET,
  SEASON2_PUSHBACK_IMMUNITY,
  type SpecBuild,
} from './builds';

/** A flat, open patch of the overworld with clear sight lines (the balance
 *  probes' PROBE_OPEN_FIELD anchor, scripts/probe_anchor.ts). */
export const DUEL_FIELD = { x: 50, z: -90 } as const;

export function buildKit(build: SpecBuild): Kit {
  const set = SEASON2_SETS.find((s) => s.cls === build.cls && s.spec === build.spec);
  if (!set) throw new Error(`no Season 2 set for ${build.cls}/${build.spec}`);
  const kit: Kit = {};
  for (const id of set.itemIds) {
    const slot = ITEMS[id]?.slot as EquipSlot | undefined;
    if (!slot) throw new Error(`missing Season 2 item ${id}`);
    kit[slot] = id;
  }
  const wf = entryWaistFeet(set.armorType, build.primary);
  kit.waist = wf.waist;
  kit.feet = wf.feet;
  Object.assign(kit, JEWELRY[build.primary]);
  kit.trinket = PVP_TRINKET;
  kit.mainhand = build.weapon;
  const weapon = ITEMS[build.weapon];
  const twoHand = weapon?.kind === 'weapon' && weapon.hand === 'twohand';
  if (build.offhand) kit.offhand = build.offhand;
  else if (!twoHand) {
    const parseOff = parseBisGearFor(build.cls, build.spec)?.offhand;
    if (parseOff) kit.offhand = parseOff;
  }
  return kit;
}

export function equipKit(sim: Sim, pid: number, kit: Kit): Kit {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('missing duelist meta');
  // Start from a bare paperdoll so no starter item survives the swap.
  for (const slot of ALL_EQUIP_SLOTS) meta.equipment[slot] = null as never;
  const order: EquipSlot[] = [
    'mainhand',
    'offhand',
    ...ALL_EQUIP_SLOTS.filter((s) => s !== 'mainhand' && s !== 'offhand'),
  ];
  for (const slot of order) {
    const id = kit[slot];
    if (!id) continue;
    if (!ITEMS[id]) throw new Error(`missing kit item ${id}`);
    sim.addItem(id, 1, pid);
    sim.equipItemToSlot(id, slot, pid);
  }
  const worn: Kit = {};
  for (const slot of ALL_EQUIP_SLOTS) {
    const id = meta.equipment[slot];
    if (id) worn[slot] = id as string;
  }
  return worn;
}

export interface Duelist {
  pid: number;
  build: SpecBuild;
  kit: Kit;
}

export function spawnDuelist(
  sim: Sim,
  build: SpecBuild,
  name: string,
  x: number,
  z: number,
): Duelist {
  const pid = sim.addPlayer(build.cls, name, { autoEquip: false, tutorialGreetingSent: true });
  sim.setPlayerLevel(20, pid);
  if (!sim.applyTalents({ spec: build.spec, rows: { ...build.rows } }, pid)) {
    throw new Error(`talent build rejected for ${build.label}`);
  }
  const kit = equipKit(sim, pid, buildKit(build));
  const e = sim.entities.get(pid) as Entity;
  if (SEASON2_PUSHBACK_IMMUNITY) applySeason2PushbackImmunity(sim, pid, build, kit);
  place(sim, e, x, z);
  e.hp = e.maxHp;
  e.resource = e.resourceType === 'rage' ? 0 : e.maxResource;
  return { pid, build, kit };
}

/** Model the v0.46 Season 2 pushback immunity (builds.ts
 *  SEASON2_PUSHBACK_IMMUNITY) through the engine's own pushback channel: the
 *  talent-seam `global.castPushbackReduction` that recalcPlayerStats
 *  max-combines with the item-set value. Living on the player's modifiers, it
 *  survives every mid-fight stat recalc, and pushbackCast reads it as full
 *  immunity at 1. Applied only when all five Season 2 pieces are worn. */
export function applySeason2PushbackImmunity(
  sim: Sim,
  pid: number,
  build: SpecBuild,
  kit: Kit,
): void {
  const set = SEASON2_SETS.find((s) => s.cls === build.cls && s.spec === build.spec);
  const worn = new Set(Object.values(kit));
  if (!set || !set.itemIds.every((id) => worn.has(id))) return;
  const meta = sim.players.get(pid);
  const e = sim.entities.get(pid);
  if (!meta || !e) return;
  meta.talentMods = {
    ...meta.talentMods,
    global: { ...meta.talentMods.global, castPushbackReduction: 1 },
  };
  sim.ctx.recalcPlayer(e);
}

export function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = sim.groundPos(x, z);
  e.prevPos = { ...e.pos };
  sim.rebucket(e);
}

/** Clear the stage: every non-player entity goes (mobs, NPCs, objects, any
 *  world boss that spawned since), so nothing wanders into a duel and the tick
 *  costs the two duelists and their pets, not the realm. Uses the Sim's own
 *  roster drop, the despawn path every entity takes. */
export function clearStage(sim: Sim): void {
  const drop = (sim as unknown as { dropEntity(id: number): void }).dropEntity.bind(sim);
  for (const e of [...sim.entities.values()]) {
    if (e.kind === 'player') continue;
    drop(e.id);
  }
}

export function createDuelSim(seed: number): Sim {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    worldPvpDisabled: true,
    // Only tick mobs near a player: the duel field is clear, so the rest of the
    // world idles and a run costs the duel, not the realm.
    idleMobTickRadius: 60,
  });
  for (const pid of [...sim.players.keys()]) sim.removePlayer(pid);
  clearStage(sim);
  return sim;
}
