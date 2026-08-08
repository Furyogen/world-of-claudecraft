import { describe, expect, it } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import { ITEMS, MOBS } from '../src/sim/data';
import { STAT_PER_ILVL, statPointCurve, weaponDpsBudget } from '../src/sim/item_budget';
import {
  expectedStatBudget,
  itemFromRaid,
  itemLevel,
  itemScore,
  itemSourceLevel,
  normalizePrimaryStats,
  PRIMARY_STATS,
  primaryStatBudget,
  primaryStatSum,
  resetItemLevelCache,
} from '../src/sim/item_level';
import {
  ENDGAME_MAX_ILVL,
  ENDGAME_MIN_ILVL,
  type EndgameTier,
  endgameItemLevel,
  tierBand,
} from '../src/sim/item_tier';

// The showcase tiers wired up in src/sim/content/items.ts: two trios, each one
// piece per archetype, dropping from the same place so they share an item level.
const CHEST_TRIO = ['hollowbone_hauberk', 'gravewoven_raiment', 'cryptstalker_jerkin'];
const WEAPON_TRIO = ['gravecaller_blade', 'widowfang_dirk', 'gravecaller_staff'];

describe('item level: source derivation', () => {
  it('derives the drop level from the dropping mob band', () => {
    // The chest trio drops from the level-7 chapel rare elites.
    for (const id of CHEST_TRIO) expect(itemSourceLevel(id), id).toBe(7);
  });

  it('derives a quest reward level from its hardest kill objective (the boss)', () => {
    // The weapon trio is the q_hollow reward for slaying Morthen (level 10).
    for (const id of WEAPON_TRIO) expect(itemSourceLevel(id), id).toBe(10);
  });

  it('returns undefined for items with no drop or quest source', () => {
    // Conjured water is mage-made, never dropped or quest-granted.
    expect(itemSourceLevel('conjured_water')).toBeUndefined();
    expect(itemLevel(ITEMS.conjured_water)).toBeUndefined();
  });

  it('derives collect-gated quest reward levels from the collected item source', () => {
    // q_greyjaw collects Old Greyjaw's fang from a level-4 rare.
    expect(itemSourceLevel('greyjaw_pelt_cloak')).toBe(4);
    expect(itemLevel(ITEMS.greyjaw_pelt_cloak)).toBe(5);

    // q_stalker_pelts collects Ridge Stalker Pelts from level-14 beasts.
    expect(itemSourceLevel('ridgestalker_treads')).toBe(14);
    expect(itemLevel(ITEMS.ridgestalker_treads)).toBe(15);
  });
});

describe('item level: tier number', () => {
  it('adds the rarity bonus to the source level', () => {
    // rare = +3: chest trio 7 -> 10, weapon trio 10 -> 13.
    for (const id of CHEST_TRIO) expect(itemLevel(ITEMS[id]), id).toBe(10);
    for (const id of WEAPON_TRIO) expect(itemLevel(ITEMS[id]), id).toBe(13);
  });
});

describe('item level: stat budget formula', () => {
  it('whites carry no primary-stat budget; rarity and level raise it', () => {
    expect(primaryStatBudget(10, 'common', 'chest')).toBe(0);
    expect(primaryStatBudget(10, 'rare', 'chest')).toBe(6);
    expect(primaryStatBudget(13, 'rare', 'mainhand')).toBe(7);
    // monotonic in level and in quality for a fixed slot.
    expect(primaryStatBudget(20, 'rare', 'chest')).toBeGreaterThan(
      primaryStatBudget(10, 'rare', 'chest'),
    );
    expect(primaryStatBudget(13, 'epic', 'mainhand')).toBeGreaterThan(
      primaryStatBudget(13, 'rare', 'mainhand'),
    );
  });

  it('weights smaller slots below chest/main-hand', () => {
    expect(primaryStatBudget(13, 'rare', 'feet')).toBeLessThan(
      primaryStatBudget(13, 'rare', 'chest'),
    );
  });

  it('a sourceless / slotless item has no expected budget', () => {
    expect(expectedStatBudget(ITEMS.conjured_water)).toBeUndefined();
  });

  it('only assigns item levels and budgets to equippable combat gear', () => {
    const slotBearingTool = {
      id: 'gravecaller_blade',
      name: 'Gravecaller Tuning Fork',
      kind: 'tool',
      slot: 'mainhand',
      sellValue: 0,
    } as const;

    expect(itemSourceLevel(slotBearingTool.id)).toBe(10);
    expect(itemLevel(slotBearingTool)).toBeUndefined();
    expect(expectedStatBudget(slotBearingTool)).toBeUndefined();
  });
});

describe('item level: showcase tiers are normalized to budget', () => {
  it('every showcase item carries exactly its item-level stat budget', () => {
    for (const id of [...CHEST_TRIO, ...WEAPON_TRIO]) {
      const item = ITEMS[id];
      const budget = expectedStatBudget(item);
      expect(budget, `${id} has a derivable budget`).not.toBeUndefined();
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(budget);
    }
  });

  it('items from the same place share one item level and one budget (same tier)', () => {
    const chestLevels = new Set(CHEST_TRIO.map((id) => itemLevel(ITEMS[id])));
    const chestBudgets = new Set(CHEST_TRIO.map((id) => primaryStatSum(ITEMS[id])));
    expect(chestLevels).toEqual(new Set([10]));
    expect(chestBudgets).toEqual(new Set([6]));

    const weaponLevels = new Set(WEAPON_TRIO.map((id) => itemLevel(ITEMS[id])));
    const weaponBudgets = new Set(WEAPON_TRIO.map((id) => primaryStatSum(ITEMS[id])));
    expect(weaponLevels).toEqual(new Set([13]));
    expect(weaponBudgets).toEqual(new Set([7]));
  });

  it('normalization preserved each piece stat identity (no attribute swapped in/out)', () => {
    const ident = (id: string) =>
      PRIMARY_STATS.filter((k) => (ITEMS[id].stats?.[k] ?? 0) > 0).sort();
    expect(ident('hollowbone_hauberk')).toEqual(['sta', 'str']);
    expect(ident('gravewoven_raiment')).toEqual(['int', 'spi']);
    expect(ident('cryptstalker_jerkin')).toEqual(['agi', 'sta']);
    expect(ident('gravecaller_staff')).toEqual(['int', 'spi']);
  });
});

describe('normalizePrimaryStats', () => {
  it('scales to the exact integer budget while keeping the input ratio', () => {
    expect(normalizePrimaryStats({ str: 3, sta: 2 }, 7)).toEqual({ str: 4, sta: 3 });
    expect(normalizePrimaryStats({ int: 4, spi: 2 }, 7)).toEqual({ int: 5, spi: 2 });
    // sum is always exactly the budget.
    const out = normalizePrimaryStats({ agi: 4, sta: 2 }, 6);
    expect((out.agi ?? 0) + (out.sta ?? 0)).toBe(6);
  });

  it('only touches the attributes already present and passes armor through', () => {
    const out = normalizePrimaryStats({ armor: 38, int: 4, spi: 3 }, 6);
    expect(out.armor).toBe(38);
    expect(out.str).toBeUndefined();
    expect((out.int ?? 0) + (out.spi ?? 0)).toBe(6);
  });

  it('is deterministic (ties resolved by a stable order) and idempotent at budget', () => {
    const a = normalizePrimaryStats({ str: 1, agi: 1 }, 3);
    const b = normalizePrimaryStats({ str: 1, agi: 1 }, 3);
    expect(a).toEqual(b);
    expect((a.str ?? 0) + (a.agi ?? 0)).toBe(3);
    // re-normalizing an already-on-budget item is a no-op.
    expect(normalizePrimaryStats({ str: 4, sta: 3 }, 7)).toEqual({ str: 4, sta: 3 });
  });

  it('drops all primary stats at a zero budget but keeps armor', () => {
    expect(normalizePrimaryStats({ armor: 10, str: 3 }, 0)).toEqual({ armor: 10 });
  });
});

describe('itemScore', () => {
  it('counts primary stats, converted armor, and converted weapon dps', () => {
    // Pure stat piece: score is just the stat sum.
    expect(
      itemScore({
        id: 'x',
        name: 'x',
        kind: 'armor',
        slot: 'chest',
        armorType: 'mail',
        sellValue: 0,
        stats: { str: 4, sta: 3 },
      }),
    ).toBe(7);
    // Armor converts at ARMOR_PER_POINT (12): 24 armor -> 2 points.
    expect(
      itemScore({
        id: 'x',
        name: 'x',
        kind: 'armor',
        slot: 'chest',
        armorType: 'mail',
        sellValue: 0,
        stats: { armor: 24 },
      }),
    ).toBe(2);
    // A weapon adds dps weight, so it outscores its raw stat bonus alone.
    const blade = ITEMS.gravecaller_blade;
    expect(itemScore(blade)).toBeGreaterThan(primaryStatSum(blade));
  });
});

describe('item level: raid tier', () => {
  it('flags raid (10-player) drops and not dungeon (5-player) drops', () => {
    // Nythraxis raid loot vs Korzul 5-player dungeon loot, both from level-20 bosses.
    expect(itemFromRaid('crownforged_dreadhelm')).toBe(true);
    expect(itemFromRaid('deathless_heartwood')).toBe(true);
    expect(itemFromRaid('deathlord_warplate')).toBe(false);
    expect(itemFromRaid('boneplate_vest')).toBe(false);
  });

  it('raid loot reads a tier above same-level dungeon loot', () => {
    // Same source level (20) + same quality (epic), but the raid helmet is anchored
    // to the 'raid' band and the dungeon helmet to the 'dungeon' band, so the raid
    // piece reads exactly its own tier's epic rung (item_tier.ts) and the dungeon
    // piece reads the rung below. RAID_ILVL_BONUS no longer applies at the cap: it
    // only separates raid from dungeon loot for sub-cap sources.
    const raidHelm = itemLevel(ITEMS.crownforged_dreadhelm);
    const dungeonHelm = itemLevel(ITEMS.deathlords_dread_visage);
    expect(itemSourceLevel('crownforged_dreadhelm')).toBe(20);
    expect(itemSourceLevel('deathlords_dread_visage')).toBe(20);
    expect(raidHelm).toBe(endgameItemLevel('raid', 'epic'));
    expect(dungeonHelm).toBe(endgameItemLevel('dungeon', 'epic'));
    if (raidHelm === undefined || dungeonHelm === undefined)
      throw new Error('raid and dungeon helmets should have item levels');
    expect(raidHelm).toBeGreaterThan(dungeonHelm);
    // The dungeon band's top rung stays strictly below the raid band's bottom rung:
    // no normal-dungeon drop can read above a raid drop whatever its quality.
    expect(tierBand('dungeon').max).toBeLessThan(tierBand('raid').min);
    // ...and the raid helmet therefore carries a strictly larger stat budget.
    const raidBudget = expectedStatBudget(ITEMS.crownforged_dreadhelm);
    const dungeonBudget = expectedStatBudget(ITEMS.deathlords_dread_visage);
    expect(raidBudget).not.toBeUndefined();
    expect(dungeonBudget).not.toBeUndefined();
    if (raidBudget === undefined || dungeonBudget === undefined)
      throw new Error('raid and dungeon helmets should have stat budgets');
    expect(raidBudget).toBeGreaterThan(dungeonBudget);
  });
});

describe('item level: the endgame bands are a strict, gapless ladder', () => {
  // The whole point of the squish: every cap-level tier owns a contiguous band, the
  // bands never overlap, and the ladder stays inside a fixed window under the level
  // cap so a future cap can own its own window. Guards the ORDER, not the literals,
  // except for the two endpoints that define the window.
  it('orders the tiers and keeps them inside the endgame window', () => {
    const order: EndgameTier[] = ['dungeon', 'raid', 'heroic_dungeon', 'heroic_raid'];
    for (let i = 1; i < order.length; i++) {
      const below = tierBand(order[i - 1]);
      const above = tierBand(order[i]);
      expect(below.min, `${order[i - 1]} band is ordered`).toBeLessThanOrEqual(below.max);
      expect(below.max, `${order[i - 1]} sits strictly below ${order[i]}`).toBeLessThan(above.min);
    }
    expect(tierBand('dungeon').min).toBe(ENDGAME_MIN_ILVL);
    // Legendaries cap the window, above every tier's epic rung.
    expect(endgameItemLevel('heroic_raid', 'legendary')).toBe(ENDGAME_MAX_ILVL);
    expect(endgameItemLevel('raid', 'legendary')).toBeGreaterThan(tierBand('heroic_raid').max);
  });

  it('reads higher item level as higher stat budget, with one known exception', () => {
    // A tooltip's item level is only useful if a bigger number means a stronger
    // piece. It does across the ladder EXCEPT at a tier's sub-epic rung, because
    // quality is counted twice there: the band rung already encodes quality, and
    // QUALITY_STAT_MULT then scales the budget again. The live case is the heroic
    // five-man RARE variants: they read the heroic band (above the normal-dungeon
    // and normal-raid epics) while budgeting below both.
    //
    // This is a design decision, not a bug to paper over: closing it means either
    // widening the bands or compressing the quality multiplier for cap-level gear,
    // which re-budgets ~80 shipped items. Pinned here as a tripwire so the exception
    // cannot silently SPREAD to another rung.
    const KNOWN_INVERSIONS = new Set(['heroic_dungeon:rare']);
    const rungs: { tier: EndgameTier; quality: 'uncommon' | 'rare' | 'epic'; level: number }[] = [];
    for (const tier of ['dungeon', 'raid', 'heroic_dungeon', 'heroic_raid'] as EndgameTier[]) {
      for (const quality of ['uncommon', 'rare', 'epic'] as const) {
        rungs.push({ tier, quality, level: endgameItemLevel(tier, quality) });
      }
    }
    rungs.sort((a, b) => a.level - b.level);
    // Compare on one fixed slot so only the level and quality vary.
    const budgetOf = (r: (typeof rungs)[number]): number =>
      primaryStatBudget(r.level, r.quality, 'chest');
    const found: string[] = [];
    let best = -1;
    for (const rung of rungs) {
      const budget = budgetOf(rung);
      if (budget < best) found.push(`${rung.tier}:${rung.quality}`);
      best = Math.max(best, budget);
    }
    expect(new Set(found)).toEqual(KNOWN_INVERSIONS);
  });

  it('keeps every live item level inside the window, so no drop outruns the ladder', () => {
    for (const item of Object.values(ITEMS)) {
      const level = itemLevel(item);
      if (level === undefined) continue;
      expect(level, `${item.id} item level`).toBeLessThanOrEqual(ENDGAME_MAX_ILVL);
    }
  });

  it('anchors the budget curves so nothing below the endgame window moves', () => {
    // The endgame curve is steeper but CONTINUOUS at the anchor: the two segments
    // agree there, which is what keeps the whole sub-cap ladder byte-identical.
    expect(statPointCurve(ENDGAME_MIN_ILVL)).toBeCloseTo(ENDGAME_MIN_ILVL * STAT_PER_ILVL, 10);
    expect(weaponDpsBudget(ENDGAME_MIN_ILVL)).toBeCloseTo(6.7 + 0.3 * ENDGAME_MIN_ILVL, 10);
    for (let level = 1; level <= ENDGAME_MIN_ILVL; level++) {
      expect(statPointCurve(level), `ilvl ${level} stat curve`).toBeCloseTo(
        level * STAT_PER_ILVL,
        10,
      );
      expect(weaponDpsBudget(level), `ilvl ${level} dps curve`).toBeCloseTo(6.7 + 0.3 * level, 10);
    }
    // Above the anchor it is strictly steeper, which is what makes a one-rung tier
    // step legible instead of rounding away.
    expect(statPointCurve(ENDGAME_MIN_ILVL + 1) - statPointCurve(ENDGAME_MIN_ILVL)).toBeGreaterThan(
      STAT_PER_ILVL,
    );
  });
});

describe('item level: heroic boss drops are budget-exact (their tier band)', () => {
  it('every explicit heroic-table drop is at its tier item level with its exact stat budget', () => {
    // The five-man final bosses register at source level 25 and anchor to the
    // 'heroic_dungeon' band. The 10-player raid boss (Heroic Nythraxis) is the tier
    // above at source level 27 and anchors to 'heroic_raid': its explicit table
    // lists only the three heroic-only weapons. See buildSourceIndex +
    // NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL.
    const raidIds = new Set(
      (HEROIC_BOSS_LOOT.nythraxis_scourge_of_thornpeak ?? []).flatMap((e) =>
        e.itemId ? [e.itemId] : [],
      ),
    );
    expect(raidIds.size).toBe(3); // the three heroic-only raid weapons
    const ids = Object.values(HEROIC_BOSS_LOOT)
      .flat()
      .flatMap((e) => (e.itemId ? [e.itemId] : []));
    expect(ids.length).toBeGreaterThanOrEqual(12); // the full five-man heroic set + raid weapons
    for (const id of ids) {
      const item = ITEMS[id];
      const raid = raidIds.has(id);
      expect(item, `${id} is a real item`).toBeTruthy();
      expect(itemSourceLevel(id), `${id} source`).toBe(raid ? 27 : 25);
      expect(item.quality, id).toBe('epic');
      expect(itemLevel(item), `${id} ilvl`).toBe(
        endgameItemLevel(raid ? 'heroic_raid' : 'heroic_dungeon', 'epic'),
      );
      expect(itemLevel(item), `${id} ilvl literal`).toBe(raid ? 29 : 27);
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(expectedStatBudget(item));
    }
  });

  it('the raid boss set pieces and legendaries upgrade to raid-tier heroic variants (29/31)', () => {
    // These are not listed in the explicit table: they come from the normal-loot
    // heroic swap (heroic_<base>), rescaled to the raid tier (source 27).
    const raidBases = (MOBS.nythraxis_scourge_of_thornpeak?.loot ?? []).flatMap((e: any) =>
      e.itemId ? [e.itemId] : [],
    );
    expect(raidBases.length).toBeGreaterThanOrEqual(8);
    let epics = 0;
    let legendaries = 0;
    for (const base of raidBases) {
      const variant = ITEMS[`heroic_${base}`];
      expect(variant, `heroic_${base} exists`).toBeTruthy();
      expect(itemSourceLevel(variant.id), `${variant.id} source`).toBe(27);
      if (variant.quality === 'legendary') {
        legendaries++;
        expect(itemLevel(variant), `${variant.id} ilvl`).toBe(31);
        expect(itemLevel(variant)).toBe(endgameItemLevel('heroic_raid', 'legendary'));
      } else {
        epics++;
        expect(variant.quality, variant.id).toBe('epic');
        expect(itemLevel(variant), `${variant.id} ilvl`).toBe(29);
        expect(itemLevel(variant)).toBe(endgameItemLevel('heroic_raid', 'epic'));
      }
      expect(primaryStatSum(variant), `${variant.id} stat sum == budget`).toBe(
        expectedStatBudget(variant),
      );
    }
    expect(epics + legendaries).toBe(raidBases.length);
    expect(legendaries).toBe(2); // Deathless Heartwood + Kingsbane, Last Oath
  });
});

describe('item level: every level-20 item is balanced to budget', () => {
  it('all level-20 gear carries exactly its item-level stat budget', () => {
    const offBudget: string[] = [];
    let checked = 0;
    for (const id of Object.keys(ITEMS)) {
      const item = ITEMS[id];
      if (!item.slot || itemSourceLevel(id) !== 20) continue;
      checked++;
      if (primaryStatSum(item) !== expectedStatBudget(item)) {
        offBudget.push(`${id}: have ${primaryStatSum(item)}, want ${expectedStatBudget(item)}`);
      }
    }
    expect(checked).toBeGreaterThan(30); // the full endgame set
    expect(offBudget, offBudget.join('\n')).toEqual([]);
  });

  it('level-20 items of the same item level + slot + hand share one budget', () => {
    const groups = new Map<string, Set<number>>();
    for (const id of Object.keys(ITEMS)) {
      const item = ITEMS[id];
      if (!item.slot || itemSourceLevel(id) !== 20) continue;
      const hand = item.kind === 'weapon' && item.hand === 'twohand' ? 'twohand' : 'onehand';
      const key = `${itemLevel(item)}:${item.quality}:${item.slot}:${hand}`;
      let sums = groups.get(key);
      if (!sums) {
        sums = new Set();
        groups.set(key, sums);
      }
      sums.add(primaryStatSum(item));
    }
    // No group may contain two different budgets.
    const split = [...groups.entries()].filter(([, sums]) => sums.size > 1);
    expect(split.map(([k]) => k)).toEqual([]);
  });

  it('the two legendaries are normalized to the same top-tier budget', () => {
    expect(primaryStatSum(ITEMS.deathless_heartwood)).toBe(
      primaryStatSum(ITEMS.kingsbane_last_oath),
    );
  });
});

describe('item level: purity and determinism', () => {
  it('is a pure function of the static tables across cache rebuilds', () => {
    const before = CHEST_TRIO.map((id) => [itemSourceLevel(id), itemLevel(ITEMS[id])]);
    resetItemLevelCache();
    const after = CHEST_TRIO.map((id) => [itemSourceLevel(id), itemLevel(ITEMS[id])]);
    expect(after).toEqual(before);
  });
});

describe('heroic set: class coverage', () => {
  it('every class can use a broad slot spread of heroic epics', () => {
    const ALL_CLASSES = [
      'warrior',
      'paladin',
      'shaman',
      'rogue',
      'hunter',
      'druid',
      'mage',
      'priest',
      'warlock',
    ] as const;
    const ids = Object.values(HEROIC_BOSS_LOOT)
      .flat()
      .flatMap((e) => (e.itemId ? [e.itemId] : []));
    for (const cls of ALL_CLASSES) {
      const slots = new Set<string>();
      for (const id of ids) {
        const it: any = ITEMS[id];
        const rc: string[] | undefined = it.requiredClass;
        if (!rc || rc.includes(cls)) slots.add(it.slot);
      }
      // Every class reaches at least five of the eight droppable slots.
      expect(slots.size, `${cls}: ${[...slots].sort().join(',')}`).toBeGreaterThanOrEqual(5);
      // Every class has at least one usable weapon.
      expect(slots.has('mainhand'), `${cls} has a weapon`).toBe(true);
    }
  });
});

describe('item level: crafted gear derives its level from the recipe (content/recipes.ts)', () => {
  // The three level-20, hub-gated caster pieces (issue #1965 review): a level-20
  // recipe is cap-level content, so its output anchors to the 'dungeon' band's rare
  // rung, matching the level-20 rares in the same slots (boundstone_helm,
  // gravewyrm_gauntlets, gravewyrm_mantle).
  const CASTER_HUB_IDS = ['wardweave_cowl', 'duskhide_wraps', 'sootscale_mantle'];
  const CASTER_COMMON_IDS = [
    'eastbrook_ritual_vestments',
    'eastbrook_druids_hide',
    'eastbrook_warded_leggings',
  ];

  it('registers a source level for every crafted item with primary stats', () => {
    for (const id of [...CASTER_HUB_IDS, ...CASTER_COMMON_IDS]) {
      expect(itemSourceLevel(id), `${id} has a source level`).not.toBeUndefined();
      expect(itemLevel(ITEMS[id]), `${id} has an item level`).not.toBeUndefined();
    }
  });

  it('the hub caster pieces land at the dungeon-tier rare rung with their exact budget', () => {
    for (const id of CASTER_HUB_IDS) {
      const item = ITEMS[id];
      expect(itemLevel(item), `${id} item level`).toBe(22);
      expect(itemLevel(item)).toBe(endgameItemLevel('dungeon', 'rare'));
      const budget = expectedStatBudget(item);
      expect(budget, `${id} has a derivable budget`).not.toBeUndefined();
      expect(primaryStatSum(item), `${id} stat sum == budget`).toBe(budget);
    }
  });

  it('matches the existing level-20 rares sharing its slot (helmet 11, gloves 9, shoulder 10)', () => {
    expect(primaryStatSum(ITEMS.wardweave_cowl)).toBe(primaryStatSum(ITEMS.boundstone_helm));
    expect(primaryStatSum(ITEMS.duskhide_wraps)).toBe(primaryStatSum(ITEMS.gravewyrm_gauntlets));
    expect(primaryStatSum(ITEMS.sootscale_mantle)).toBe(primaryStatSum(ITEMS.gravewyrm_mantle));
  });
});
