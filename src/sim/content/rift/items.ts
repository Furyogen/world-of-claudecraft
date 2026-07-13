import type { ItemDef } from '../../types';

export const RIFT_ESSENCE_ITEM_ID = 'rift_essence';
export const RIFT_GEM_IDS = ['rift_gem_crimson', 'rift_gem_azure', 'rift_gem_verdant'] as const;
export type RiftGemId = (typeof RIFT_GEM_IDS)[number];

export const RIFT_GEAR_ITEM_IDS = [
  'riftbound_band_of_might',
  'riftbound_band_of_insight',
  'riftbound_band_of_guile',
] as const;

/** Static shells. The non-fungible payload carries each drop's source, power,
 * upgrades, enchantment, sockets, gems, and rolled bonus stats. */
export const RIFT_ITEMS: Record<string, ItemDef> = {
  rift_essence: {
    id: 'rift_essence',
    name: 'Rift Essence',
    kind: 'tool',
    quality: 'rare',
    stackSize: 20,
    sellValue: 0,
    noMarketList: true,
  },
  rift_gem_crimson: {
    id: 'rift_gem_crimson',
    name: 'Crimson Rift Gem',
    kind: 'tool',
    quality: 'epic',
    stackSize: 20,
    sellValue: 0,
    noMarketList: true,
  },
  rift_gem_azure: {
    id: 'rift_gem_azure',
    name: 'Azure Rift Gem',
    kind: 'tool',
    quality: 'epic',
    stackSize: 20,
    sellValue: 0,
    noMarketList: true,
  },
  rift_gem_verdant: {
    id: 'rift_gem_verdant',
    name: 'Verdant Rift Gem',
    kind: 'tool',
    quality: 'epic',
    stackSize: 20,
    sellValue: 0,
    noMarketList: true,
  },
  riftbound_band_of_might: {
    id: 'riftbound_band_of_might',
    name: 'Riftbound Band of Might',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { str: 6, sta: 5 },
    sellValue: 5000,
    noMarketList: true,
  },
  riftbound_band_of_insight: {
    id: 'riftbound_band_of_insight',
    name: 'Riftbound Band of Insight',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { int: 6, spi: 5 },
    sellValue: 5000,
    noMarketList: true,
  },
  riftbound_band_of_guile: {
    id: 'riftbound_band_of_guile',
    name: 'Riftbound Band of Guile',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { agi: 6, sta: 5 },
    sellValue: 5000,
    noMarketList: true,
  },
};
