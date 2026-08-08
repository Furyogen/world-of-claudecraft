import { describe, expect, it } from 'vitest';
import { effectiveSpellHit, spellResistChance } from '../src/sim/combat/spell_resist';
import { aggregateSetBonuses } from '../src/sim/content/item_sets';
import { ITEMS, MOBS } from '../src/sim/data';
import { itemLevel } from '../src/sim/item_level';
import { endgameItemLevel } from '../src/sim/item_tier';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemDef } from '../src/sim/types';
import {
  critFractionFromRating,
  hasteFractionFromRating,
  hitFractionFromRating,
  meleeMissChance,
  spellHitChance,
  swingMissChance,
} from '../src/sim/types';

// A minimal entity for the pure hit-table functions: swingMissChance reads only
// level/kind/hostile/ownerId/hitBonus.
function ent(partial: Partial<Entity>): Entity {
  return {
    kind: 'player',
    level: 20,
    hostile: false,
    ownerId: null,
    hitBonus: 0,
    ...partial,
  } as Entity;
}

describe('combat ratings', () => {
  it('converts haste, crit and hit ratings to fractions', () => {
    expect(hasteFractionFromRating(150)).toBe(0.15);
    expect(critFractionFromRating(20)).toBe(0.02);
    expect(hitFractionFromRating(50)).toBe(0.05);
  });

  it('accumulates item combat ratings and applies them to derived player stats', () => {
    const itemId = '__test_combat_rating_chest';
    const item: ItemDef = {
      id: itemId,
      name: 'Combat Rating Test Chest',
      kind: 'armor',
      slot: 'chest',
      armorType: 'leather',
      sellValue: 0,
      requiredLevel: 1,
      hasteRating: 150,
      critRating: 20,
      hitRating: 200,
    };
    ITEMS[itemId] = item;
    try {
      const sim = new Sim({ seed: 11, playerClass: 'rogue' });
      const p = sim.player;
      sim.addItem(itemId, 1);
      sim.equipItem(itemId);

      expect(p.hasteRating).toBe(150);
      expect(p.critRating).toBe(20);
      expect(p.hitRating).toBe(200);
      expect(p.meleeHaste).toBe(0.15);
      expect(p.rangedHaste).toBe(0.15);
      expect(p.spellHaste).toBe(0.15);
      expect(p.critChance).toBeCloseTo(0.05 + p.stats.agi * 0.0005 + 0.02);
      expect(p.hitBonus).toBeCloseTo(0.2);
    } finally {
      delete ITEMS[itemId];
    }
  });

  it('hit rating reduces a player melee miss vs a higher-level (Heroic +3) mob', () => {
    const mob = ent({ kind: 'mob', hostile: true, level: 23 });
    // The +3 above-level miss is capped at ~26%; 5% hit claws it to ~21%.
    expect(meleeMissChance(20, 23)).toBeCloseTo(0.26);
    expect(swingMissChance(ent({ hitBonus: 0.05 }), mob)).toBeCloseTo(0.21);
    // Enough hit floors the miss at 0 (hit-capped), never negative.
    expect(swingMissChance(ent({ hitBonus: 0.9 }), mob)).toBe(0);
  });

  it('hit rating reduces spell resist by the same amount', () => {
    // The +3 above-level resist is capped at ~25%; 5% hit claws it to ~20%.
    expect(spellResistChance(20, 23)).toBeCloseTo(0.25);
    expect(spellResistChance(20, 23, 0.05)).toBeCloseTo(0.2);
  });

  it('is a no-op with zero hit, preserving the ungeared draw (parity)', () => {
    // The player-attacker branch equals the raw level-only miss when hitBonus is 0.
    expect(
      swingMissChance(ent({ hitBonus: 0 }), ent({ kind: 'mob', hostile: true, level: 23 })),
    ).toBe(meleeMissChance(20, 23));
    // The spell path passes spellHitChance(...) unchanged to rng.chance when hit is 0.
    expect(effectiveSpellHit(20, 23, 0)).toBe(spellHitChance(20, 23));
  });

  it('effective spell hit is clamped at 1 (over-capping Hit cannot exceed certainty)', () => {
    // spellHitChance(20, 23) is ~0.75; a huge hitBonus would push it past 1 without
    // the Math.min clamp. Equal-level (0.96) also clamps.
    expect(effectiveSpellHit(20, 23, 0.9)).toBe(1);
    expect(effectiveSpellHit(20, 20, 0.5)).toBe(1);
    expect(spellResistChance(20, 23, 0.9)).toBe(0); // and resist floors at 0
  });

  it('hit does not help a mob attacking a player (attacker-side only, capped)', () => {
    // A mob has no hit gear; the player-side target hit never reduces the mob's swing.
    const mob = ent({ kind: 'mob', hostile: true, level: 23 });
    const player = ent({ hitBonus: 0.5 });
    expect(swingMissChance(mob, player)).toBeLessThanOrEqual(0.2); // MOB_VS_PLAYER cap, unchanged
  });

  it('the weak T2 bleed 4-set bonuses now also grant hit rating', () => {
    const crownforged = aggregateSetBonuses(new Map([['crownforged', 4]]));
    const nighttalon = aggregateSetBonuses(new Map([['nighttalon', 4]]));
    expect(crownforged.hitRating).toBe(60);
    expect(nighttalon.hitRating).toBe(60);
  });

  it('the heroic marks jewelry carries one combat rating each', async () => {
    const { HEROIC_VENDOR_ITEMS } = await import('../src/sim/content/heroic_vendor');
    const jewelry = Object.values(HEROIC_VENDOR_ITEMS);
    expect(jewelry.length).toBeGreaterThanOrEqual(10);
    for (const item of jewelry) {
      const ratings = [item.hitRating, item.critRating, item.hasteRating].filter(
        (r) => (r ?? 0) > 0,
      );
      expect(ratings.length, item.id).toBe(1);
    }
  });

  it('PvP honor jewelry keeps its warfare rating (its own differentiator, unchanged)', () => {
    // The honor track's jewelry is differentiated by its PvP warfare rating, not a
    // PvE combat rating; hit/crit/haste are deliberately NOT added there to avoid a
    // same-level PvP balance change.
    const honorJewelry = Object.values(ITEMS).filter(
      (i) => (i.slot === 'ring' || i.slot === 'neck') && (i.pvpOffenseRating ?? 0) > 0,
    );
    expect(honorJewelry.length).toBeGreaterThan(0);
    for (const item of honorJewelry) {
      expect(item.hitRating ?? 0, item.id).toBe(0);
    }
  });
});

// The tier ladder is the fix for "the heroic tier feels the same as the dungeon
// tier": ratings, not the primary-stat growth, differentiate the tiers. 0 ratings on
// normal dungeon epics -> 1 rating on every heroic boss-set piece -> 2 on the heroic
// raid variants. Selected by SOURCE (which table a piece comes from), never by a bare
// item-level literal: the endgame bands (item_tier.ts) put several sources on the same
// rung, so a literal would silently sweep the wrong set.
describe('combat-rating tier ladder', () => {
  const ratingValues = (item: ItemDef): number[] =>
    [item.hitRating, item.critRating, item.hasteRating].filter((r): r is number => (r ?? 0) > 0);
  const ratingCount = (item: ItemDef): number => ratingValues(item).length;

  it('every heroic boss-set piece carries exactly one rating', async () => {
    const { HEROIC_ITEMS } = await import('../src/sim/content/heroic_loot');
    const fiveManLevel = endgameItemLevel('heroic_dungeon', 'epic');
    const pieces = Object.values(HEROIC_ITEMS).filter((item) => itemLevel(item) === fiveManLevel);
    expect(pieces).toHaveLength(24);
    for (const item of pieces) {
      expect(ratingCount(item), item.id).toBe(1);
      expect(ratingValues(item), item.id).toEqual([item.weapon ? 50 : 40]);
    }
    // Hit is over-represented (the Heroic-defining stat): at least a third of the set.
    const hitPieces = pieces.filter((i) => (i.hitRating ?? 0) > 0).length;
    expect(hitPieces).toBeGreaterThanOrEqual(Math.ceil(pieces.length / 3));
  });

  it('enforces the complete 0 -> 1 -> 2 rating ladder across the tier sources', async () => {
    const { HEROIC_VENDOR_ITEMS } = await import('../src/sim/content/heroic_vendor');
    const { HEROIC_ITEMS } = await import('../src/sim/content/heroic_loot');
    const vendorIds = new Set(Object.keys(HEROIC_VENDOR_ITEMS));
    const heroicSetIds = new Set(Object.keys(HEROIC_ITEMS));
    const allGear = Object.values(ITEMS).filter(
      (item) => item.slot && itemLevel(item) !== undefined,
    );
    const raidBases = new Set(
      (MOBS.nythraxis_scourge_of_thornpeak?.loot ?? []).flatMap((e) =>
        e.itemId ? [e.itemId] : [],
      ),
    );

    // Rung 0: normal five-man dungeon epics carry no combat rating at all.
    const dungeonEpics = allGear.filter(
      (item) =>
        itemLevel(item) === endgameItemLevel('dungeon', 'epic') &&
        item.quality === 'epic' &&
        !item.heroicOf,
    );
    expect(dungeonEpics.length).toBeGreaterThan(0);
    for (const item of dungeonEpics) expect(ratingCount(item), item.id).toBe(0);

    // Rung 0: the heroic five-man VARIANTS inherit their base's ratings unchanged, so
    // a variant of a rating-free dungeon epic stays rating-free.
    const fiveManVariants = allGear.filter(
      (item) => item.heroicOf !== undefined && !raidBases.has(item.heroicOf),
    );
    expect(fiveManVariants.length).toBeGreaterThan(0);
    for (const item of fiveManVariants) {
      expect(itemLevel(item), item.id).toBe(endgameItemLevel('heroic_dungeon', item.quality));
      if (ratingCount(ITEMS[item.heroicOf as string]) === 0)
        expect(ratingCount(item), item.id).toBe(0);
    }

    // Rung 1: the marks jewelry, at its own smaller allowance.
    expect([...vendorIds]).toHaveLength(10);
    for (const id of vendorIds) {
      const item = ITEMS[id];
      expect(itemLevel(item), id).toBe(endgameItemLevel('heroic_dungeon', 'epic'));
      expect(ratingValues(item), id).toEqual([25]);
    }

    // Rung 1: the normal Nythraxis raid epics carry the single 20-point seed rating
    // the heroic raid variants later scale up.
    const raidEpics = allGear.filter(
      (item) =>
        itemLevel(item) === endgameItemLevel('raid', 'epic') &&
        item.quality === 'epic' &&
        !item.heroicOf &&
        !vendorIds.has(item.id) &&
        !heroicSetIds.has(item.id),
    );
    expect(raidEpics).toHaveLength(12);
    for (const item of raidEpics) expect(ratingValues(item), item.id).toEqual([20]);

    // Rung 2: every heroic Nythraxis piece carries TWO ratings, the tier's identity.
    const directHeroicRaidWeapons = new Set([
      'scepter_of_the_deathless_court',
      'deathless_greatblade',
      'stormcallers_focus',
    ]);
    const heroicRaidGear = allGear.filter(
      (item) =>
        (item.heroicOf !== undefined && raidBases.has(item.heroicOf)) ||
        directHeroicRaidWeapons.has(item.id),
    );
    expect(heroicRaidGear).toHaveLength(17);
    const legendaryLevel = endgameItemLevel('heroic_raid', 'legendary');
    for (const item of heroicRaidGear) {
      const ilvl = itemLevel(item);
      expect(ilvl, item.id).toBe(endgameItemLevel('heroic_raid', item.quality));
      const expectedPrimary = ilvl === legendaryLevel ? 70 : item.weapon ? 65 : 55;
      const expectedSecondary = ilvl === legendaryLevel ? 30 : 20;
      expect(
        ratingValues(item).sort((a, b) => b - a),
        item.id,
      ).toEqual([expectedPrimary, expectedSecondary]);
    }
  });

  it('a spell-facing raid legendary (Heartwood staff) takes throughput ratings, never Hit', () => {
    // A rating-less caster/healer base must not default to the game's largest Hit
    // allowance: heals are not resisted by level, matching the healer-facing rule.
    const staff = ITEMS['heroic_deathless_heartwood'];
    expect(staff, 'heroic Heartwood variant should be generated').toBeTruthy();
    if (staff) {
      expect(staff.hitRating ?? 0).toBe(0);
      expect(ratingCount(staff)).toBe(2); // haste primary + crit secondary
      expect((staff.hasteRating ?? 0) > 0 && (staff.critRating ?? 0) > 0).toBe(true);
    }
  });
});
