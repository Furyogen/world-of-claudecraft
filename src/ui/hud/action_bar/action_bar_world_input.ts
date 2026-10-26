// The per-frame world input every action-bar-family view ticks off (the desktop
// bar, the mobile ring, the consumables quick bar, the cross hotbar, the
// cooldown manager), refreshed IN PLACE so a frame allocates no new input
// object. Extracted from hud.ts, which kept a field-by-field copy of the same
// assignments for the first frame and every later one.

import type { Entity } from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { mountSpellIconKey, mountSpellLook } from '../../mount_spell_icon_core';
import type { ActionBarTargetInput, ActionBarWorldInput } from './action_bar_view';

// The Summon Mount icon key, rebuilt only when the look it draws changes. The
// look itself is computed per frame without allocating (a bag scan and a
// presentation-key pick, mount_spell_icon_core.ts), so an unchanged frame
// returns the same key string. A pure function memo: sharing it across HUD
// instances changes no answer.
let lastLook: string | undefined;
let lastKey: string | undefined;

function mountSpellKey(world: IWorld): string | undefined {
  if (!world.ridingTrained()) return undefined;
  const look = mountSpellLook(world.player.mountSkinId, world.inventory, () => world.ownedMounts());
  if (look !== lastLook || lastKey === undefined) {
    lastLook = look;
    lastKey = mountSpellIconKey(look);
  }
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
