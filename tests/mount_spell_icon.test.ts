import { describe, expect, it } from 'vitest';
import { MOUNT_SPELL_ID } from '../src/sim/content/mount_spell';
import type { MountKey } from '../src/sim/content/mounts';
import { actionBarIconBg } from '../src/ui/hud/action_bar/action_bar_icon_bg';
import { syncActionBarWorldInput } from '../src/ui/hud/action_bar/action_bar_world_input';
import { iconDataUrl } from '../src/ui/icons';
import { mountSpellIconUrl } from '../src/ui/mount_spell_icon';
import {
  MOUNT_SPELL_ICON_PREFIX,
  mountSpellIconKey,
  mountSpellLook,
} from '../src/ui/mount_spell_icon_core';
import type { IWorld } from '../src/world_api';

// The Summon Mount icon: the worn mount skin, else the mount a press summons
// (the fastest owned), else the default mount for a rider who owns none.

describe('mountSpellLook', () => {
  it('shows the worn skin over whatever mount the press summons', () => {
    expect(mountSpellLook('rickshaw_mount', ['valorsteed', 'grag_bear'])).toBe('rickshaw_mount');
  });

  it('shows the mount the press summons when no skin is worn', () => {
    expect(mountSpellLook(null, ['valorsteed', 'grag_bear'])).toBe('grag_bear');
  });

  it('falls back to the default mount when nothing is owned', () => {
    expect(mountSpellLook(null, [])).toBe('valorsteed');
    expect(mountSpellLook('rickshaw_mount', [])).toBe('rickshaw_mount');
  });

  it('ignores a retired or unknown skin id, like the mount model does', () => {
    expect(mountSpellLook('rallycart_rxt', ['valorsteed'])).toBe('valorsteed');
  });
});

describe('mount spell icon resolution', () => {
  it('draws a skin with its store art and a mount with its reins art', () => {
    expect(mountSpellIconUrl('rickshaw_mount')).toBe('/ui/store/mount_skins/rickshaw_mount.webp');
    expect(mountSpellIconUrl('grag_bear')).toBe('/ui/items/reins_grag_bear.webp');
  });

  it('draws the default mount wherever only the ability id is known', () => {
    expect(iconDataUrl('ability', MOUNT_SPELL_ID)).toBe('/ui/skills/general/summon_mount.webp');
  });

  it('resolves the action-bar look key to that art', () => {
    expect(actionBarIconBg(mountSpellIconKey('rickshaw_mount', []))).toBe(
      'url(/ui/store/mount_skins/rickshaw_mount.webp)',
    );
    expect(actionBarIconBg(`${MOUNT_SPELL_ICON_PREFIX}valorsteed`)).toBe(
      'url(/ui/items/reins_valorsteed.webp)',
    );
  });
});

describe('syncActionBarWorldInput', () => {
  function fakeWorld(state: { trained: boolean; skin: string | null; owned: MountKey[] }) {
    const player = { id: 1, mountSkinId: state.skin, auras: [] };
    return {
      player,
      inventory: [],
      equipment: { trinket: null },
      talentSpec: null,
      cfg: { playerClass: 'warrior' },
      entities: new Map(),
      ridingTrained: () => state.trained,
      ownedMounts: () => state.owned,
    } as unknown as IWorld;
  }

  it('carries the Summon Mount look key once Riding is learned, and follows a skin change', () => {
    const state = {
      trained: false,
      skin: null as string | null,
      owned: ['valorsteed'] as MountKey[],
    };
    const world = fakeWorld(state);
    const p = world.player;
    const first = syncActionBarWorldInput(null, world, p, null, false, 0, null);
    expect(first.mountSpellIconKey).toBeUndefined();
    state.trained = true;
    const again = syncActionBarWorldInput(first, world, p, null, false, 0, null);
    // Refreshed in place: the shared input object is never re-minted.
    expect(again).toBe(first);
    expect(again.mountSpellIconKey).toBe('mountspell:valorsteed');
    (world.player as { mountSkinId: string | null }).mountSkinId = 'rickshaw_mount';
    expect(syncActionBarWorldInput(first, world, p, null, false, 0, null).mountSpellIconKey).toBe(
      'mountspell:rickshaw_mount',
    );
  });

  it('refreshes every other field each frame', () => {
    const world = fakeWorld({ trained: false, skin: null, owned: [] });
    const input = syncActionBarWorldInput(null, world, world.player, null, true, 2, 5);
    expect(input).toMatchObject({
      stealthed: true,
      fateThreads: 2,
      activeAimSlot: 5,
      playerClass: 'warrior',
      wornTrinketId: null,
      paladinSpec: null,
    });
    syncActionBarWorldInput(input, world, world.player, null, false, 0, null);
    expect(input).toMatchObject({ stealthed: false, fateThreads: 0, activeAimSlot: null });
  });
});
