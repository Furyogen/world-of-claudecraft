// Item level: a single "how powerful is this drop" number resolved from WHERE an
// item comes from, and the stat budget that an item of that level + quality + slot
// is expected to carry.
//
// Two regimes, because the source level means different things either side of the
// level cap:
//   - BELOW the cap it is DERIVED: the level of the mob that drops it (or the boss a
//     quest-reward is gated behind) plus a rarity bump. The source level is the
//     progression axis there, so it is the right thing to read.
//   - AT the cap every source sits at the same character level, so the derivation
//     degenerates into a pile of additive bonuses. Cap-level content is ANCHORED to
//     its tier's band instead (item_tier.ts), which is what keeps the endgame ladder
//     ordered and inside a fixed window under the cap.
//
// This is a pure, host-agnostic leaf (no DOM, no rng, no Sim state): it reads only
// the static content tables and does arithmetic, so the HUD imports it directly the
// same way it already consumes other pure sim leaves (data, world, equipment_rules,
// lockpick). The architecture purity gate (tests/architecture.test.ts) keeps it
// host-agnostic. Keeping the formula on the sim side gives one source of truth;
// tests import it directly.
//
// Two distinct outputs:
//   - itemLevel(item): the tier number shown in the tooltip ("Item Level 10").
//   - primaryStatBudget(...): the total primary-stat points an item of that tier
//     SHOULD grant. normalizePrimaryStats() distributes that budget back across an
//     item's existing stats so two drops from the same place carry the same total
//     power while keeping their own stat identity (a warrior plate piece stays
//     str/sta, a mage cloth piece stays int/spi). itemScore() is the realized
//     power (stats + armor + weapon dps) for at-a-glance comparison.

import {
  HEROIC_BOSS_LOOT,
  HEROIC_LOOT_SOURCE_LEVEL,
  NYTHRAXIS_RAID_BOSS_ID,
  NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL,
} from './content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from './content/heroic_vendor';
import { FURY_STOCK, WARFARE_SOURCE_LEVEL } from './content/pvp_honor';
import { ALL_RECIPES, DUNGEONS, ITEMS, MOBS, QUESTS } from './data';
// The pure budget primitives live in the leaf module ./item_budget (no ./data
// import, so content/heroic_variants.ts can share them at data-eval time without a
// cycle). Imported for internal use and re-exported so every existing importer of
// item_level keeps working unchanged.
import {
  HEROIC_VARIANT_SOURCE_LEVEL,
  normalizePrimaryStats,
  PRIMARY_STATS,
  type PrimaryStat,
  primaryStatBudget,
  QUALITY_ILVL_BONUS,
  QUALITY_STAT_MULT,
  SLOT_STAT_MULT,
  STAT_PER_ILVL,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
} from './item_budget';
import { type EndgameTier, endgameItemLevel, tierBand } from './item_tier';
import type { ItemDef } from './types';
import { MAX_LEVEL } from './types';

export {
  HEROIC_VARIANT_SOURCE_LEVEL,
  normalizePrimaryStats,
  PRIMARY_STATS,
  type PrimaryStat,
  primaryStatBudget,
  QUALITY_ILVL_BONUS,
  QUALITY_STAT_MULT,
  SLOT_STAT_MULT,
  STAT_PER_ILVL,
  TWOHAND_DPS_MULT,
  TWOHAND_STAT_MULT,
};

// Raid loot is one tier above same-level 5-player dungeon loot: a 10-player raid
// encounter confers this item-level bonus on top of the mob's character level.
// SUB-CAP ONLY: at the level cap the tier bands (item_tier.ts) separate raid from
// dungeon loot instead, so this bonus never applies to endgame drops.
// RAID_MIN_PLAYERS is the suggestedPlayers threshold that marks a dungeon as a raid.
export const RAID_ILVL_BONUS = 3;
export const RAID_MIN_PLAYERS = 10;

// The source level the Heroic Quartermaster's stock reads as (heroic dungeons
// are level-20 content); see buildSourceIndex.
export const HEROIC_VENDOR_SOURCE_LEVEL = 20;

// itemScore weights: how many armor points and how much weapon DPS count as one
// primary-stat point, so a single comparable number can span gear types.
export const ARMOR_PER_POINT = 12;
export const WEAPON_DPS_WEIGHT = 0.5;

// mobId -> the largest suggestedPlayers of any dungeon the mob spawns in (a raid
// boss therefore reports its raid size). Lets a drop know it came from a raid
// without a per-mob flag. Built lazily + memoized, pure over the static tables.
let encounterIndex: Map<string, number> | null = null;

function encounterIndexOf(): Map<string, number> {
  if (encounterIndex) return encounterIndex;
  const idx = new Map<string, number>();
  for (const def of Object.values(DUNGEONS)) {
    for (const spawn of def.spawns) {
      const prev = idx.get(spawn.mobId);
      if (prev === undefined || def.suggestedPlayers > prev)
        idx.set(spawn.mobId, def.suggestedPlayers);
    }
  }
  encounterIndex = idx;
  return idx;
}

function isRaidMob(mobId: string): boolean {
  return (encounterIndexOf().get(mobId) ?? 0) >= RAID_MIN_PLAYERS;
}

// itemId -> { level, raid }: the level the item drops at (top of the dropping mob's
// band, or the hardest boss a quest-reward is gated behind) and whether its best
// source is a raid encounter. Built once, lazily, from the static tables (so data.ts
// is fully initialized first) and memoized. Deterministic: pure function of the
// content tables, no rng, no clock.
interface ItemSource {
  level: number;
  raid: boolean;
  // The endgame tier the item belongs to, when its best source is cap-level content.
  // Set, it anchors the item level to that tier's band (item_tier.ts); unset, the
  // item is sub-cap levelling gear and keeps the derived source + quality bump.
  tier?: EndgameTier;
}
let sourceIndex: Map<string, ItemSource> | null = null;

function buildSourceIndex(): Map<string, ItemSource> {
  const idx = new Map<string, ItemSource>();
  const bump = (
    itemId: string | undefined,
    level: number | undefined,
    raid: boolean,
    tier?: EndgameTier,
  ): void => {
    if (!itemId || level === undefined) return;
    const prev = idx.get(itemId);
    // Highest level wins (and brings its own tier with it); the raid flag is OR'd so
    // a raid source always counts.
    if (prev === undefined || level > prev.level)
      idx.set(itemId, { level, raid: raid || (prev?.raid ?? false), tier });
    else if (raid && !prev.raid) idx.set(itemId, { ...prev, raid: true });
  };
  // Mob loot: an item is "current" at the top of the dropping mob's level band.
  // A cap-level mob is endgame content, so its drops anchor to a tier band: the
  // 10-player raid to 'raid', everything else (five-man dungeons and the level-20
  // outdoor world) to 'dungeon'.
  for (const mob of Object.values(MOBS)) {
    if (!mob.loot) continue;
    const raid = isRaidMob(mob.id);
    const tier = endgameTierForLevel(mob.maxLevel, raid);
    for (const entry of mob.loot) bump(entry.itemId, mob.maxLevel, raid, tier);
  }
  // Quest rewards: gated behind the quest's hardest combat source: direct kill
  // objectives, or collected quest items traced back to the mob that drops them.
  // Fall back to the quest's own minLevel when no concrete source exists.
  for (const quest of Object.values(QUESTS)) {
    let source: ItemSource | undefined;
    const consider = (level: number | undefined, raid: boolean): void => {
      if (level === undefined) return;
      if (source === undefined || level > source.level)
        source = { level, raid: raid || (source?.raid ?? false) };
      else if (raid && !source.raid) source = { ...source, raid: true };
    };
    for (const objective of quest.objectives) {
      if (objective.type === 'kill' && objective.targetMobId) {
        const mob = MOBS[objective.targetMobId];
        consider(mob?.maxLevel, mob ? isRaidMob(mob.id) : false);
      } else if (objective.type === 'collect' && objective.itemId) {
        const collectedSource = idx.get(objective.itemId);
        consider(collectedSource?.level, collectedSource?.raid ?? false);
      }
    }
    consider(quest.minLevel, false);
    for (const itemId of Object.values(quest.itemRewards))
      bump(
        itemId,
        source?.level,
        source?.raid ?? false,
        endgameTierForLevel(source?.level, source?.raid ?? false),
      );
  }
  // Heroic Quartermaster stock: the marks-vendor jewelry never drops from a mob,
  // but it IS heroic five-man content (Heroic Marks only come from heroic final
  // bosses), so it anchors to the heroic dungeon tier. The source LEVEL stays at
  // the level-20 content it is bought from, which is what the equip gate reads
  // (item_level_req.ts).
  for (const offer of HEROIC_VENDOR_STOCK)
    bump(offer.itemId, HEROIC_VENDOR_SOURCE_LEVEL, false, 'heroic_dungeon');
  // FURY's WARFARE stock is level-22 PvP content, the honor-earned parallel to the
  // heroic five-man tier, so it shares that band. Its pieces stay deliberately
  // stat-light within it (see content/pvp_honor.ts).
  for (const itemId of FURY_STOCK) bump(itemId, WARFARE_SOURCE_LEVEL, false, 'heroic_dungeon');
  // Heroic boss drops: the heroic five-man tier. The 10-player raid (Heroic
  // Nythraxis) is the tier ABOVE, so its heroic-only weapons anchor to
  // 'heroic_raid'. Source levels are unchanged (they still order the index).
  for (const [bossId, entries] of Object.entries(HEROIC_BOSS_LOOT)) {
    const raidBoss = bossId === NYTHRAXIS_RAID_BOSS_ID;
    const src = raidBoss ? NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL : HEROIC_LOOT_SOURCE_LEVEL;
    const tier: EndgameTier = raidBoss ? 'heroic_raid' : 'heroic_dungeon';
    for (const entry of entries) {
      if (entry.itemId) bump(entry.itemId, src, false, tier);
    }
  }
  // Heroic upgraded drop variants (content/heroic_variants.ts): the "Heroic X"
  // copies of base dungeon drops anchor to the heroic five-man tier. Registered
  // here so a variant's tooltip level and budget derive from the index like any
  // other drop. The exception is the heroic RAID: the Nythraxis raid boss's own set
  // pieces and legendaries upgrade to 'heroic_raid', anchored on the raid boss's
  // normal loot so the auto-swap in a heroic claim reads the raid tier too.
  const raidBases = new Set(
    (MOBS[NYTHRAXIS_RAID_BOSS_ID]?.loot ?? []).flatMap((e) => (e.itemId ? [e.itemId] : [])),
  );
  for (const item of Object.values(ITEMS)) {
    if (!item.heroicOf) continue;
    const raidBase = raidBases.has(item.heroicOf);
    const src = raidBase ? NYTHRAXIS_RAID_LOOT_SOURCE_LEVEL : HEROIC_VARIANT_SOURCE_LEVEL;
    bump(item.id, src, false, raidBase ? 'heroic_raid' : 'heroic_dungeon');
  }
  // Crafted gear (content/recipes.ts): a recipe's output is current at the recipe's
  // own level (the level a character can learn/use it, mirroring how a mob's level
  // stands in for its loot). Without this, any crafted item with primary stats has
  // no derivable item level: the budget gates below skip it and the tooltip's item
  // level/score lines never show. Never a raid source, and a cap-level recipe is
  // level-20 content, so it anchors to the same band as a level-20 drop.
  for (const recipe of ALL_RECIPES)
    bump(recipe.resultItemId, recipe.level, false, endgameTierForLevel(recipe.level, false));
  return idx;
}

// The endgame tier a plain (non-heroic) source of this character level belongs to,
// or undefined when the source is below the cap and therefore still on the derived
// levelling ladder. Heroic sources never come through here: their tier is explicit
// at the registration site, because "heroic" is a property of the instance, not of
// any level the content is tuned to.
function endgameTierForLevel(level: number | undefined, raid: boolean): EndgameTier | undefined {
  if (level === undefined || level < MAX_LEVEL) return undefined;
  return raid ? 'raid' : 'dungeon';
}

function sourceIndexOf(): Map<string, ItemSource> {
  if (!sourceIndex) sourceIndex = buildSourceIndex();
  return sourceIndex;
}

// The level of the content an item drops from, or undefined for items with no
// drop/quest source (vendor stock, starter gear, junk, conjured/quest items).
export function itemSourceLevel(itemId: string): number | undefined {
  return sourceIndexOf().get(itemId)?.level;
}

// Whether an item's best source is a 10-player raid encounter (drives the raid
// item-level bonus). False for dungeon/world drops and quest rewards.
export function itemFromRaid(itemId: string): boolean {
  return sourceIndexOf().get(itemId)?.raid ?? false;
}

// Item level is a combat-gear concept. Slot-bearing non-combat oddities (tools,
// quest objects, cosmetics) can exist in the item model, but should not get an
// item-level readout or stat budget.
export function isItemLevelEligible(item: ItemDef): boolean {
  return (
    !!item.slot && (item.kind === 'armor' || item.kind === 'weapon' || item.kind === 'held_offhand')
  );
}

// The item level (tier number) shown in the tooltip, or undefined when there is no
// derivable source (so the UI simply omits the line for sourceless items). Adds the
// raid bonus so raid loot reads a tier above same-level dungeon loot.
export function itemLevel(item: ItemDef): number | undefined {
  if (!isItemLevelEligible(item)) return undefined;
  const src = sourceIndexOf().get(item.id);
  if (src === undefined) return undefined;
  // Cap-level content is anchored to its tier's band (item_tier.ts) instead of the
  // additive derivation, so the endgame ladder stays inside a fixed window under the
  // level cap and its tiers cannot be reordered by a quality bump.
  if (src.tier) return endgameItemLevel(src.tier, item.quality);
  const bonus = QUALITY_ILVL_BONUS[item.quality ?? 'common'] ?? 0;
  const raid = src.raid ? RAID_ILVL_BONUS : 0;
  const derived = Math.max(1, src.level + bonus + raid);
  // A sub-cap source can never read above the first endgame tier's band. Without
  // this a high-quality drop from a near-cap source derives INTO a tier band it did
  // not earn (a level-19 epic used to land on the raid rung), which is exactly the
  // band collision the anchored ladder exists to prevent. The clamp only binds for
  // sources within a quality bump of the cap; the rest of the levelling ladder is
  // untouched.
  return Math.min(derived, tierBand('dungeon').max);
}

// The budget an item is expected to carry given its own source/quality/slot, or
// undefined when the item has no derivable item level. A two-handed weapon carries
// only the modest TWOHAND_STAT_MULT premium over the mainhand line (its real
// compensation is weapon dps, TWOHAND_DPS_MULT); rounded so budgets stay integral.
export function expectedStatBudget(item: ItemDef): number | undefined {
  const level = itemLevel(item);
  if (level === undefined) return undefined;
  const base = primaryStatBudget(level, item.quality, item.slot);
  return item.kind === 'weapon' && item.hand === 'twohand'
    ? Math.round(base * TWOHAND_STAT_MULT)
    : base;
}

// The sum of an item's primary stats (its realized stat budget).
export function primaryStatSum(item: ItemDef): number {
  if (!item.stats) return 0;
  let sum = 0;
  for (const k of PRIMARY_STATS) sum += item.stats[k] ?? 0;
  return sum;
}

// A single comparable power number: primary stats + armor (converted) + weapon DPS
// (converted). Rounded to one decimal for stable display/sorting.
export function itemScore(item: ItemDef): number {
  let score = primaryStatSum(item);
  if (item.stats?.armor) score += item.stats.armor / ARMOR_PER_POINT;
  if (item.weapon) {
    const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
    score += dps * WEAPON_DPS_WEIGHT;
  }
  return Math.round(score * 10) / 10;
}

// Test/tooling hook: drop the memoized index so a test that mutates the tables can
// rebuild it. Not used by the running game.
export function resetItemLevelCache(): void {
  sourceIndex = null;
  encounterIndex = null;
}
