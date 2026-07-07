import type { ItemDef } from '../types';

// The Heroic Quartermaster's marks-currency stock: the game's only source of
// neck and ring jewelry. Prices are HEROIC MARKS (the heroic_mark inventory
// item from ./dungeon_difficulty.ts), debited from the buyer's bags by
// buyHeroicVendorItem (src/sim/instances/heroic_vendor.ts).
//
// Item level: the source index (src/sim/item_level.ts) treats this stock as
// level-20 heroic content, so the epic pieces read item level 26 (20 + the epic
// bump) and their stat sums are budget-enforced by tests/item_level.test.ts:
// ring budget 11 (slot mult 0.6), neck budget 12 (slot mult 0.65).
//
// Jewelry carries no armorType, so every class can wear every piece; the stat
// identity picks its audience. Prices are tunable placeholders sized against
// the daily-gated income of at most 4 marks per UTC day.

export const HEROIC_VENDOR_NPC_ID = 'heroic_quartermaster';

export interface HeroicVendorOffer {
  itemId: string;
  marks: number;
}

export const HEROIC_VENDOR_ITEMS: Record<string, ItemDef> = {
  ring_of_the_nine: {
    id: 'ring_of_the_nine',
    name: 'Ring of the Nine',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { str: 7, sta: 4 },
    sellValue: 4500,
  },
  nielas_band: {
    id: 'nielas_band',
    name: "Niela's Band",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { int: 7, sta: 4 },
    sellValue: 4500,
  },
  sutils_fortune: {
    id: 'sutils_fortune',
    name: "Sutil's Fortune",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { agi: 7, sta: 4 },
    sellValue: 4500,
  },
  arthurs_round_band: {
    id: 'arthurs_round_band',
    name: "Arthur's Round Band",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { sta: 6, str: 5 },
    sellValue: 4500,
  },
  signet_of_zyzz: {
    id: 'signet_of_zyzz',
    name: 'Signet of Zyzz',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { spi: 6, int: 5 },
    sellValue: 4500,
  },
  band_of_the_architect: {
    id: 'band_of_the_architect',
    name: 'Band of the Architect',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { int: 6, spi: 5 },
    sellValue: 4500,
  },
  yumis_best_pendant: {
    id: 'yumis_best_pendant',
    name: "Yumi's Best Pendant",
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    requiredLevel: 20,
    stats: { agi: 7, sta: 5 },
    sellValue: 6000,
  },
  zense_meridian: {
    id: 'zense_meridian',
    name: 'Zense Meridian',
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    requiredLevel: 20,
    stats: { int: 7, spi: 5 },
    sellValue: 6000,
  },
  swiftstride_pendant: {
    id: 'swiftstride_pendant',
    name: 'Swiftstride Pendant',
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    requiredLevel: 20,
    stats: { str: 6, agi: 6 },
    sellValue: 6000,
  },
  pendant_of_endless_profit: {
    id: 'pendant_of_endless_profit',
    name: 'Pendant of Endless Profit',
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    requiredLevel: 20,
    stats: { str: 7, sta: 5 },
    sellValue: 6000,
  },
};

export const HEROIC_VENDOR_STOCK: readonly HeroicVendorOffer[] = [
  { itemId: 'ring_of_the_nine', marks: 12 },
  { itemId: 'nielas_band', marks: 12 },
  { itemId: 'sutils_fortune', marks: 12 },
  { itemId: 'arthurs_round_band', marks: 12 },
  { itemId: 'signet_of_zyzz', marks: 12 },
  { itemId: 'band_of_the_architect', marks: 12 },
  { itemId: 'yumis_best_pendant', marks: 16 },
  { itemId: 'zense_meridian', marks: 16 },
  { itemId: 'swiftstride_pendant', marks: 16 },
  { itemId: 'pendant_of_endless_profit', marks: 16 },
];
