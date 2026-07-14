// v0.25.0 replaced the standalone heroic Nythraxis drops with the heroic loot
// swap and deleted their four ItemDefs outright. Players who earned them during
// the v0.24.x window still carry the ids in persisted equipment, bags, bank,
// mail, and market listings; with no def the paperdoll slot rendered as Empty
// and the item granted zero stats (the live "Nightfang Harness is missing"
// incident, 2026-07-14). The ids must stay defined forever so those saves
// resolve, but they are retired: never on a loot source, never variant-cloned.
import { describe, expect, it } from 'vitest';
import { DELVE_SHOPS } from '../src/sim/content/delves/shop';
import { HEROIC_BOSS_LOOT, RETIRED_HEROIC_ITEMS } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { FURY_STOCK } from '../src/sim/content/pvp_honor';
import { ITEMS, MOBS, QUESTS } from '../src/sim/data';
import { buildPaperdollView } from '../src/ui/char_view';

const RETIRED_IDS = [
  'deathless_warguard_legmail',
  'scourgehide_carapace',
  'soulforged_warplate',
  'soulrend_diadem',
] as const;

describe('retired heroic items: the four ids v0.25.0 orphaned resolve again', () => {
  it('retires exactly the four orphaned ids, each merged into ITEMS', () => {
    expect(Object.keys(RETIRED_HEROIC_ITEMS).sort()).toEqual([...RETIRED_IDS]);
    for (const id of RETIRED_IDS) {
      expect(ITEMS[id]).toBe(RETIRED_HEROIC_ITEMS[id]);
    }
  });

  it('restores each def with its original v0.24.2 identity', () => {
    expect(ITEMS.scourgehide_carapace).toMatchObject({
      name: 'Scourgehide Carapace',
      kind: 'armor',
      armorType: 'leather',
      slot: 'chest',
      quality: 'epic',
      requiredLevel: 20,
      stats: { armor: 172, agi: 12, sta: 10 },
      requiredClass: ['rogue', 'hunter', 'druid'],
    });
    expect(ITEMS.soulrend_diadem).toMatchObject({
      name: 'Soulrend Diadem',
      kind: 'armor',
      armorType: 'cloth',
      slot: 'helmet',
      quality: 'epic',
      requiredLevel: 20,
      stats: { armor: 76, int: 10, spi: 8 },
      requiredClass: ['mage', 'priest', 'warlock', 'druid'],
    });
    expect(ITEMS.deathless_warguard_legmail).toMatchObject({
      name: 'Deathless Warguard Legmail',
      kind: 'armor',
      armorType: 'mail',
      slot: 'legs',
      quality: 'epic',
      requiredLevel: 20,
      stats: { armor: 315, str: 11, sta: 9 },
      requiredClass: ['warrior', 'paladin', 'shaman'],
    });
    expect(ITEMS.soulforged_warplate).toMatchObject({
      name: 'Soulforged Warplate',
      kind: 'armor',
      armorType: 'mail',
      slot: 'chest',
      quality: 'epic',
      requiredLevel: 20,
      stats: { armor: 335, int: 12, spi: 10 },
      requiredClass: ['paladin', 'shaman'],
    });
  });

  it('keeps every retired id off every acquisition path', () => {
    const obtainableIds = new Set<string>();
    for (const mob of Object.values(MOBS)) {
      for (const entry of mob.loot ?? []) {
        if (entry.itemId) obtainableIds.add(entry.itemId);
      }
    }
    for (const entries of Object.values(HEROIC_BOSS_LOOT)) {
      for (const entry of entries) {
        if (entry.itemId) obtainableIds.add(entry.itemId);
      }
    }
    for (const offer of HEROIC_VENDOR_STOCK) obtainableIds.add(offer.itemId);
    for (const itemId of FURY_STOCK) obtainableIds.add(itemId);
    for (const entries of Object.values(DELVE_SHOPS)) {
      for (const entry of entries) obtainableIds.add(entry.itemId);
    }
    for (const quest of Object.values(QUESTS)) {
      for (const itemId of Object.values(quest.itemRewards ?? {})) {
        if (itemId) obtainableIds.add(itemId);
      }
    }
    for (const id of RETIRED_IDS) {
      expect(obtainableIds.has(id)).toBe(false);
    }
  });

  it('generates no heroic variants for retired items (they are save-compat only)', () => {
    for (const id of RETIRED_IDS) {
      expect(ITEMS[`heroic_${id}`]).toBeUndefined();
    }
  });

  it('renders a real paperdoll cell for an equipped retired id (the Empty-slot regression)', () => {
    const view = buildPaperdollView({ chest: 'scourgehide_carapace' }, ITEMS);
    expect(view.left[3].slot).toBe('chest');
    expect(view.left[3].item).toBe(ITEMS.scourgehide_carapace);
  });
});
