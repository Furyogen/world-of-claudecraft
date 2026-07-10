// Unit coverage for the PBE account boost (PBE_BOOST_ACCOUNTS=1): the env
// gate, the random name generator, the non-heroic best-in-slot kit selection,
// the boosted level-20 character state builder, and the per-account
// orchestrator driven through injected fakes. The register-handler wire-in is
// a two-line gate on pbeBoostEnabled(); the gate itself is pinned here.

// server/db.ts constructs a pg Pool at module load and throws if DATABASE_URL
// is unset; pbe_boost.ts imports it for the real deps, so set a dummy URL.
// The pool never connects: every db-touching path in this file is faked.
process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:9/unused';

import { describe, expect, it } from 'vitest';
import { normalizeCharName, offensiveName } from '../../server/auth';
import {
  BOOST_CLASSES,
  BOOST_LEVEL,
  type BoostCreateResult,
  type BoostDeps,
  boostAccountCharacters,
  buildBoostedCharacterState,
  classItemScore,
  nonHeroicBisKit,
  pbeBoostEnabled,
  randomBoostName,
} from '../../server/pbe_boost';
import { HEROIC_ITEMS } from '../../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../../src/sim/content/heroic_vendor';
import { ITEMS } from '../../src/sim/data';
import { canEquipItem } from '../../src/sim/equipment_rules';
import { meetsLevelRequirement } from '../../src/sim/item_level_req';
import type { CharacterState } from '../../src/sim/sim';
import { Sim } from '../../src/sim/sim';
import { type EquipSlot, type PlayerClass, xpToReachLevel } from '../../src/sim/types';

// Deterministic stand-in for crypto.randomInt so name/skin tests are stable.
// Uses the HIGH bits of the LCG state: the low bits have tiny periods and
// would collapse the name variety this suite asserts on.
function lcg(seed: number): (maxExclusive: number) => number {
  let s = seed >>> 0;
  return (maxExclusive: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return Math.floor((s / 2 ** 32) * maxExclusive);
  };
}

const HEROIC_VENDOR_IDS = new Set(HEROIC_VENDOR_STOCK.map((o) => o.itemId));
const ARMOR_SLOTS: EquipSlot[] = [
  'mainhand',
  'helmet',
  'shoulder',
  'chest',
  'waist',
  'legs',
  'gloves',
  'feet',
];

describe('pbeBoostEnabled (env gate)', () => {
  it('is on only for the literal "1"', () => {
    expect(pbeBoostEnabled({ PBE_BOOST_ACCOUNTS: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(pbeBoostEnabled({ PBE_BOOST_ACCOUNTS: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(pbeBoostEnabled({ PBE_BOOST_ACCOUNTS: '' } as NodeJS.ProcessEnv)).toBe(false);
    expect(pbeBoostEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(pbeBoostEnabled({ PBE_BOOST_ACCOUNTS: 'true' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('randomBoostName', () => {
  it('always produces a valid, inoffensive character name', () => {
    const rand = lcg(7);
    for (let i = 0; i < 300; i++) {
      const name = randomBoostName(rand);
      expect(normalizeCharName(name), name).toBe(name);
      expect(offensiveName(name), name).toBe(false);
      expect(name.length).toBeGreaterThanOrEqual(2);
      expect(name.length).toBeLessThanOrEqual(16);
      expect(name[0]).toMatch(/[A-Z]/);
    }
  });

  it('draws different names across calls (retry after a collision works)', () => {
    const rand = lcg(11);
    const names = new Set(Array.from({ length: 50 }, () => randomBoostName(rand)));
    expect(names.size).toBeGreaterThan(40);
  });
});

describe('nonHeroicBisKit', () => {
  it('covers every armor and weapon slot for every class with eligible non-heroic items', () => {
    for (const cls of BOOST_CLASSES) {
      const kit = nonHeroicBisKit(cls);
      for (const slot of ARMOR_SLOTS) {
        expect(kit[slot], `${cls} ${slot}`).toBeTruthy();
      }
      for (const [slot, itemId] of Object.entries(kit) as [EquipSlot, string][]) {
        const item = ITEMS[itemId];
        expect(item, `${cls} ${slot} ${itemId}`).toBeDefined();
        expect(item.heroic ?? false, `${cls} ${slot} ${itemId} heroic`).toBe(false);
        expect(item.heroicOf, `${cls} ${slot} ${itemId} heroicOf`).toBeUndefined();
        expect(itemId in HEROIC_ITEMS, `${cls} ${slot} ${itemId} bespoke heroic`).toBe(false);
        expect(HEROIC_VENDOR_IDS.has(itemId), `${cls} ${slot} ${itemId} vendor`).toBe(false);
        expect(canEquipItem(cls, item), `${cls} ${slot} ${itemId} canEquip`).toBe(true);
        if (item.requiredClass) expect(item.requiredClass, `${cls} ${slot}`).toContain(cls);
        expect(meetsLevelRequirement(BOOST_LEVEL, item), `${cls} ${slot} level`).toBe(true);
      }
    }
  });

  it('fills jewelry slots whenever a non-heroic candidate exists at all', () => {
    const anyJewelry = Object.values(ITEMS).some(
      (i) =>
        (i.slot === 'neck' || i.slot === 'ring') &&
        !i.heroic &&
        !i.heroicOf &&
        !(i.id in HEROIC_ITEMS) &&
        !HEROIC_VENDOR_IDS.has(i.id),
    );
    const kit = nonHeroicBisKit('warrior');
    if (anyJewelry) {
      expect(kit.neck || kit.ring1, 'expected some jewelry pick').toBeTruthy();
    }
    if (kit.ring1 && kit.ring2) expect(kit.ring1).not.toBe(kit.ring2);
  });

  it('picks the argmax of classItemScore per slot (chest, every class)', () => {
    for (const cls of BOOST_CLASSES) {
      const kit = nonHeroicBisKit(cls);
      const candidates = Object.values(ITEMS).filter(
        (i) =>
          i.slot === 'chest' &&
          i.kind === 'armor' &&
          !i.heroic &&
          !i.heroicOf &&
          !(i.id in HEROIC_ITEMS) &&
          !HEROIC_VENDOR_IDS.has(i.id) &&
          canEquipItem(cls, i) &&
          (!i.requiredClass || i.requiredClass.includes(cls)) &&
          meetsLevelRequirement(BOOST_LEVEL, i),
      );
      const best = Math.max(...candidates.map((i) => classItemScore(cls, i)));
      expect(classItemScore(cls, ITEMS[kit.chest as string]), `${cls} chest`).toBe(best);
    }
  });

  it('equips a real weapon in the mainhand for every class', () => {
    for (const cls of BOOST_CLASSES) {
      const kit = nonHeroicBisKit(cls);
      const weapon = ITEMS[kit.mainhand as string];
      expect(weapon?.kind, `${cls} mainhand`).toBe('weapon');
      expect(weapon?.weapon, `${cls} mainhand dps`).toBeDefined();
    }
  });
});

describe('buildBoostedCharacterState', () => {
  it('builds an internally consistent level-20 character wearing the kit', () => {
    const kit = nonHeroicBisKit('warrior');
    const state = buildBoostedCharacterState('warrior', 'Pbetestwar', 3);
    expect(state.level).toBe(BOOST_LEVEL);
    expect(state.lifetimeXp).toBeGreaterThanOrEqual(xpToReachLevel(BOOST_LEVEL));
    expect(state.skin).toBe(3);
    for (const [slot, itemId] of Object.entries(kit)) {
      expect(state.equipment[slot as EquipSlot], `equipped ${slot}`).toBe(itemId);
    }
  });

  it('round-trips through a fresh Sim load (the server login path shape)', () => {
    const state = buildBoostedCharacterState('mage', 'Pbetestmage', 1);
    const revived = JSON.parse(JSON.stringify(state)) as CharacterState;
    const sim = new Sim({ seed: 99, playerClass: 'mage', playerName: 'unused', noPlayer: true });
    const pid = sim.addPlayer('mage', 'Pbetestmage', { state: revived });
    const reloaded = sim.serializeCharacter(pid);
    expect(reloaded?.level).toBe(BOOST_LEVEL);
    expect(reloaded?.equipment).toEqual(state.equipment);
  });
});

describe('boostAccountCharacters', () => {
  function fakes() {
    const created: { name: string; cls: PlayerClass; state: CharacterState }[] = [];
    const saved: { id: number; level: number }[] = [];
    let nextId = 100;
    const deps: BoostDeps = {
      createCharacter: async (
        _accountId: number,
        name: string,
        cls: PlayerClass,
        state: CharacterState,
      ): Promise<BoostCreateResult> => {
        created.push({ name, cls, state });
        return { id: nextId++ };
      },
      saveState: async (id: number, level: number) => {
        saved.push({ id, level });
      },
      rand: lcg(23),
    };
    return { created, saved, deps };
  }

  it('creates one level-20 character per class with distinct valid names', async () => {
    const { created, saved, deps } = fakes();
    const count = await boostAccountCharacters(42, deps);
    expect(count).toBe(BOOST_CLASSES.length);
    expect(created.map((c) => c.cls).sort()).toEqual([...BOOST_CLASSES].sort());
    const names = new Set(created.map((c) => c.name));
    expect(names.size).toBe(BOOST_CLASSES.length);
    for (const c of created) {
      expect(normalizeCharName(c.name)).toBe(c.name);
      expect(c.state.level).toBe(BOOST_LEVEL);
    }
    expect(saved).toHaveLength(BOOST_CLASSES.length);
    for (const s of saved) expect(s.level).toBe(BOOST_LEVEL);
  });

  it('retries with a different name when the first is taken', async () => {
    const { created, deps } = fakes();
    const tried: string[] = [];
    const inner = deps.createCharacter;
    let rejectedOnce = false;
    deps.createCharacter = async (accountId, name, cls, state) => {
      tried.push(name);
      if (!rejectedOnce) {
        rejectedOnce = true;
        return 'name_taken';
      }
      return inner(accountId, name, cls, state);
    };
    const count = await boostAccountCharacters(42, deps);
    expect(count).toBe(BOOST_CLASSES.length);
    expect(tried.length).toBe(BOOST_CLASSES.length + 1);
    expect(tried[0]).not.toBe(tried[1]);
    expect(created).toHaveLength(BOOST_CLASSES.length);
  });

  it('a failure on one class never blocks the rest', async () => {
    const { created, deps } = fakes();
    const inner = deps.createCharacter;
    deps.createCharacter = async (accountId, name, cls, state) => {
      if (cls === 'priest') throw new Error('boom');
      return inner(accountId, name, cls, state);
    };
    const count = await boostAccountCharacters(42, deps);
    expect(count).toBe(BOOST_CLASSES.length - 1);
    expect(created.some((c) => c.cls === 'priest')).toBe(false);
    expect(created).toHaveLength(BOOST_CLASSES.length - 1);
  });

  it('stops burning names after the retry budget (account at cap)', async () => {
    const { deps } = fakes();
    deps.createCharacter = async () => 'name_taken';
    const count = await boostAccountCharacters(42, deps);
    expect(count).toBe(0);
  });
});
