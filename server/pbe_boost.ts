// PBE account boost. When the server runs with PBE_BOOST_ACCOUNTS=1, a freshly
// registered account is pre-populated with one level-20 character per class,
// each wearing the non-heroic best-in-slot kit under a random generated name,
// so public-beta testers land straight in endgame testing instead of leveling.
//
// The flag is read live per registration (the PERF_TICK_LOG pattern, not the
// boot-time config object) so tests and operators can flip it without a
// restart. NEVER set it in production: it turns every registration into a
// full character roster.
//
// The character states are built through the real Sim (setPlayerLevel + the
// real equip path + serializeCharacter), never hand-crafted JSONB, so every
// derived field (xp, talents unlocked, known abilities, stats) stays exactly
// consistent with what the game itself would produce.

import { randomInt } from 'node:crypto';
import { HEROIC_ITEMS } from '../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import { ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { meetsLevelRequirement } from '../src/sim/item_level_req';
import { type CharacterState, Sim } from '../src/sim/sim';
import type { EquipSlot, ItemDef, PlayerClass } from '../src/sim/types';
import { normalizeCharName, offensiveName } from './auth';
import { createCharacterCapped, saveCharacterState } from './db';
import { logger } from './http/logger';
import { isUniqueViolation } from './http_util';

export const BOOST_LEVEL = 20;
// Mirrors the per-realm character cap in server/characters.ts (10) and its
// MAX_SKIN (7): one boosted character per class fits under the cap with a
// slot to spare for a hand-made character.
const CHARACTER_LIMIT = 10;
const BOOST_MAX_SKIN = 7;
// Same fixed world seed the normal creation path uses (initialCharacterState
// in server/main.ts): the builder Sim is a throwaway, never ticked.
const BOOST_SEED = 20061;
// Name draws per class before giving up on that class (collisions are rare;
// the generator space is ~10k combos).
const NAME_ATTEMPTS = 8;

export const BOOST_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

export function pbeBoostEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PBE_BOOST_ACCOUNTS === '1';
}

// ---------------------------------------------------------------------------
// Random names. Syllable composition only ever emits letters, so every draw
// already matches the character-name shape rule (server/auth.ts); the
// offensiveName screen still runs as a belt-and-braces filter.

const NAME_STARTS = [
  'Bal',
  'Cael',
  'Dor',
  'El',
  'Fen',
  'Gar',
  'Hal',
  'Isen',
  'Jor',
  'Kel',
  'Lor',
  'Mar',
  'Ner',
  'Or',
  'Pell',
  'Quin',
  'Ral',
  'Sel',
  'Tor',
  'Ul',
  'Vael',
  'Wren',
  'Yor',
  'Zan',
];
const NAME_MIDS = [
  'a',
  'ad',
  'ar',
  'e',
  'en',
  'i',
  'ir',
  'o',
  'or',
  'u',
  'and',
  'eth',
  'is',
  'ol',
  'um',
  'yn',
];
const NAME_ENDS = [
  'bard',
  'dan',
  'dric',
  'fast',
  'gorn',
  'grim',
  'hart',
  'ion',
  'lan',
  'lek',
  'mir',
  'mond',
  'nash',
  'rick',
  'rin',
  'ros',
  'stag',
  'thas',
  'tide',
  'vane',
  'vash',
  'wick',
  'wyn',
  'zar',
];

type RandFn = (maxExclusive: number) => number;

export function randomBoostName(rand: RandFn = randomInt): string {
  for (;;) {
    const mid = rand(2) === 0 ? NAME_MIDS[rand(NAME_MIDS.length)] : '';
    const name = NAME_STARTS[rand(NAME_STARTS.length)] + mid + NAME_ENDS[rand(NAME_ENDS.length)];
    if (normalizeCharName(name) === name && !offensiveName(name)) return name;
  }
}

// ---------------------------------------------------------------------------
// Non-heroic best-in-slot selection. "Non-heroic" excludes the whole bespoke
// heroic item table (HEROIC_ITEMS: the five-man and raid heroic drops, some of
// which predate the heroic flag), the generated heroic dungeon variants
// (heroicOf), and the heroic-mark vendor stock. What remains is the normal
// ladder: item-level-26 dungeon epics, 29 normal-raid epics, and the
// normal-raid legendaries at 33.

const HEROIC_VENDOR_IDS: ReadonlySet<string> = new Set(HEROIC_VENDOR_STOCK.map((o) => o.itemId));

// Test-kit stat heuristics per class, not balance truth: primary stats a class
// scales with (AP/spell power/HP derivations in recalcPlayerStats), sta for
// survivability. Armor and weapon dps mirror itemScore's conversions
// (src/sim/item_level.ts): 12 armor = 1 point, melee dps at half weight;
// casters instead value spell power and barely swing.
type WeightableStat = 'str' | 'agi' | 'sta' | 'int' | 'spi';
const CLASS_STAT_WEIGHTS: Record<PlayerClass, Partial<Record<WeightableStat, number>>> = {
  warrior: { str: 1, sta: 0.8, agi: 0.4 },
  paladin: { str: 1, sta: 0.8, int: 0.3, spi: 0.2 },
  hunter: { agi: 1, sta: 0.6, int: 0.2 },
  rogue: { agi: 1, sta: 0.6, str: 0.4 },
  priest: { int: 1, spi: 0.8, sta: 0.4 },
  shaman: { int: 1, spi: 0.7, sta: 0.5 },
  mage: { int: 1, spi: 0.6, sta: 0.4 },
  warlock: { int: 1, sta: 0.6, spi: 0.5 },
  druid: { int: 1, spi: 0.7, sta: 0.5 },
};
const CASTER_CLASSES: ReadonlySet<PlayerClass> = new Set([
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
]);
const ARMOR_PER_POINT = 12;
const MELEE_DPS_WEIGHT = 0.5;
const CASTER_DPS_WEIGHT = 0.1;
const SPELL_POWER_WEIGHT = 0.9;
const RATING_WEIGHT = 0.3;

export function classItemScore(cls: PlayerClass, item: ItemDef): number {
  const weights = CLASS_STAT_WEIGHTS[cls];
  let score = 0;
  for (const [stat, weight] of Object.entries(weights) as [WeightableStat, number][]) {
    score += (item.stats?.[stat] ?? 0) * weight;
  }
  score += (item.stats?.armor ?? 0) / ARMOR_PER_POINT;
  if (item.weapon) {
    const dps = (item.weapon.min + item.weapon.max) / 2 / item.weapon.speed;
    score += dps * (CASTER_CLASSES.has(cls) ? CASTER_DPS_WEIGHT : MELEE_DPS_WEIGHT);
  }
  if (CASTER_CLASSES.has(cls)) score += (item.spellPower ?? 0) * SPELL_POWER_WEIGHT;
  score += ((item.critRating ?? 0) + (item.hasteRating ?? 0)) * RATING_WEIGHT;
  return score;
}

function eligibleForBoost(cls: PlayerClass, item: ItemDef): boolean {
  if (!item.slot) return false;
  if (item.kind !== 'weapon' && item.kind !== 'armor') return false;
  if (item.heroic || item.heroicOf) return false;
  if (item.id in HEROIC_ITEMS) return false;
  if (HEROIC_VENDOR_IDS.has(item.id)) return false;
  if (!canEquipItem(cls, item)) return false;
  // canEquipItem checks requiredClass for weapons only; class-locked armor
  // (the tier sets) declares intent through requiredClass too, so honor it.
  if (item.requiredClass && !item.requiredClass.includes(cls)) return false;
  return meetsLevelRequirement(BOOST_LEVEL, item);
}

/** The slot order the kit is equipped in; rings resolve ring1 then ring2. */
const KIT_SLOTS: readonly EquipSlot[] = [
  'mainhand',
  'helmet',
  'neck',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
  'ring1',
  'ring2',
];

export function nonHeroicBisKit(cls: PlayerClass): Partial<Record<EquipSlot, string>> {
  const bestBySlot = new Map<string, { id: string; score: number }>();
  const rings: { id: string; score: number }[] = [];
  for (const item of Object.values(ITEMS)) {
    if (!eligibleForBoost(cls, item)) continue;
    const score = classItemScore(cls, item);
    if (item.slot === 'ring') {
      rings.push({ id: item.id, score });
      continue;
    }
    const slot = item.slot as string;
    const best = bestBySlot.get(slot);
    if (!best || score > best.score) bestBySlot.set(slot, { id: item.id, score });
  }
  rings.sort((a, b) => b.score - a.score);
  const kit: Partial<Record<EquipSlot, string>> = {};
  for (const slot of KIT_SLOTS) {
    if (slot === 'ring1' || slot === 'ring2') continue;
    const best = bestBySlot.get(slot);
    if (best) kit[slot] = best.id;
  }
  if (rings[0]) kit.ring1 = rings[0].id;
  if (rings[1]) kit.ring2 = rings[1].id;
  return kit;
}

// ---------------------------------------------------------------------------
// Character state construction: the same throwaway-Sim shape as
// initialCharacterState (server/main.ts), plus level and gear. The Sim is
// never ticked, so nothing in the world can interact with the player.

export function buildBoostedCharacterState(
  cls: PlayerClass,
  name: string,
  skin: number,
): CharacterState {
  const sim = new Sim({ seed: BOOST_SEED, playerClass: cls, playerName: name });
  const pid = sim.playerId;
  sim.setPlayerSkin(pid, skin);
  sim.setPlayerLevel(BOOST_LEVEL, pid);
  const kit = nonHeroicBisKit(cls);
  for (const slot of KIT_SLOTS) {
    const itemId = kit[slot];
    if (!itemId) continue;
    sim.addItem(itemId, 1, pid);
    sim.equipItem(itemId, pid);
  }
  const state = sim.serializeCharacter(pid);
  if (!state) throw new Error('failed to serialize boosted character');
  return state;
}

// ---------------------------------------------------------------------------
// Orchestration: one character per class on the fresh account. Injected deps
// keep the db seam testable; the defaults hit the real characters table.

export type BoostCreateResult = { id: number } | 'name_taken' | null;

export interface BoostDeps {
  /** Insert the character row (null = account at the slot cap: stop). */
  createCharacter(
    accountId: number,
    name: string,
    cls: PlayerClass,
    state: CharacterState,
  ): Promise<BoostCreateResult>;
  /** Persist the level column + state blob (charselect reads the column). */
  saveState(characterId: number, level: number, state: CharacterState): Promise<void>;
  rand?: RandFn;
}

const defaultDeps: BoostDeps = {
  createCharacter: async (accountId, name, cls, state) => {
    try {
      const row = await createCharacterCapped(accountId, name, cls, CHARACTER_LIMIT, state);
      return row ? { id: row.id } : null;
    } catch (err) {
      if (isUniqueViolation(err)) return 'name_taken';
      throw err;
    }
  },
  saveState: (characterId, level, state) => saveCharacterState(characterId, level, state),
};

/**
 * Create the boosted roster for a freshly registered account: one level-20,
 * BiS-geared character per class under a random name. Per-class failures are
 * logged and skipped so one bad apple never blocks the rest; returns how many
 * characters were created.
 */
export async function boostAccountCharacters(
  accountId: number,
  deps: BoostDeps = defaultDeps,
): Promise<number> {
  const rand = deps.rand ?? randomInt;
  const triedNames = new Set<string>();
  let created = 0;
  for (const cls of BOOST_CLASSES) {
    // Yield between world builds so the 20 Hz world loop keeps breathing.
    await new Promise((resolve) => setImmediate(resolve));
    try {
      for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
        const name = randomBoostName(rand);
        if (triedNames.has(name)) continue;
        triedNames.add(name);
        const state = buildBoostedCharacterState(cls, name, rand(BOOST_MAX_SKIN + 1));
        const result = await deps.createCharacter(accountId, name, cls, state);
        if (result === 'name_taken') continue;
        if (result === null) return created;
        await deps.saveState(result.id, BOOST_LEVEL, state);
        created++;
        break;
      }
    } catch (err) {
      logger.error({ err, cls, accountId }, 'pbe boost character creation failed');
    }
  }
  return created;
}
