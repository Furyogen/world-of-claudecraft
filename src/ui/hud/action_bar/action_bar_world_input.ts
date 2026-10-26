// The per-frame world input every action-bar-family view ticks off (the desktop
// bar, the mobile ring, the consumables quick bar, the cross hotbar, the
// cooldown manager), refreshed IN PLACE so a frame allocates no new input
// object. Extracted from hud.ts, which kept a field-by-field copy of the same
// assignments for the first frame and every later one.

import type { MountKey } from '../../../sim/content/mounts';
import type { Entity } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { mountSpellIconKey } from '../../mount_spell_icon_core';
import type { ActionBarTargetInput, ActionBarWorldInput } from './action_bar_view';

// The Summon Mount icon key, rebuilt only when the worn skin or the owned-mount
// list changes. The list is compared by CONTENT: the online mirror keeps one
// array per snapshot, but the offline Sim mints a fresh one per read, and an
// identity check would rebuild the key string on every frame there. A pure
// function memo, so sharing it across HUD instances changes no answer.
let lastSkin: string | null | undefined;
const lastOwned: MountKey[] = [];
let lastKey: string | undefined;

function sameMounts(a: readonly MountKey[], b: readonly MountKey[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function mountSpellKey(world: IWorld): string | undefined {
  if (!world.ridingTrained()) return undefined;
  const skin = world.player.mountSkinId;
  const owned = world.ownedMounts();
  if (lastKey !== undefined && skin === lastSkin && sameMounts(owned, lastOwned)) return lastKey;
  lastKey = mountSpellIconKey(skin, owned);
  lastSkin = skin;
  lastOwned.length = 0;
  lastOwned.push(...owned);
  return lastKey;
}

/** Refresh (or, on the first frame, build) the shared action-bar world input. */
export function syncActionBarWorldInput(
  input: ActionBarWorldInput | null,
  world: IWorld,
  player: Entity,
  target: ActionBarTargetInput | null,
  stealthed: boolean,
  fateThreads: number,
  activeAimSlot: number | null,
): ActionBarWorldInput {
  const out: ActionBarWorldInput = input ?? {
    player,
    target,
    inventory: world.inventory,
    stealthed,
    entities: world.entities.values(),
    activeAimSlot,
  };
  out.player = player;
  out.target = target;
  out.inventory = world.inventory;
  out.wornTrinketId = world.equipment.trinket;
  out.stealthed = stealthed;
  out.paladinSpec = world.talentSpec;
  out.playerClass = world.cfg.playerClass;
  out.fateThreads = fateThreads;
  out.entities = world.entities.values();
  out.activeAimSlot = activeAimSlot;
  out.mountSpellIconKey = mountSpellKey(world);
  return out;
}
