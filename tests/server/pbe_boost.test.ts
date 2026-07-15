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
  BOOST_BAG_SOCKETS,
  BOOST_CLASSES,
  BOOST_COPPER,
  BOOST_LEVEL,
  type BoostRole,
  bestBoostBag,
  bisKitForRole,
  buildBoostedCharacterState,
  buildBoostRoster,
  CLASS_ROLES,
  classItemScore,
  NYTHRAXIS_ATTUNEMENT_QUESTS,
  nonHeroicBisKit,
  pbeBoostEnabled,
  randomBoostName,
} from '../../server/pbe_boost';
import { HEROIC_ITEMS } from '../../src/sim/content/heroic_loot';
import { HEROIC_VENDOR_STOCK } from '../../src/sim/content/heroic_vendor';
import { ITEMS, QUESTS } from '../../src/sim/data';
import { canEquipItem, canEquipItemInSlot, weaponHand } from '../../src/sim/equipment_rules';
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
  it('requires the literal flag plus a complete PTR identity', () => {
    expect(
      pbeBoostEnabled({
        PBE_BOOST_ACCOUNTS: '1',
        DEPLOY_ENV: 'ptr',
        REALM_NAME: 'PTR',
        PTR_ENVIRONMENT_ID: '8f1d7e2c4b6a9031d5e7f9a2c4b60813',
        DATABASE_URL: 'postgres://eastbrook:secret@postgres:5432/eastbrook_ptr',
        PUBLIC_ORIGIN: 'https://ptr.worldofclaudecraft.example',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
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

  it('fills the offhand legally: never beside a two-hander, always slot-equippable', () => {
    for (const cls of BOOST_CLASSES) {
      const kit = nonHeroicBisKit(cls);
      if (!kit.offhand) continue;
      const main = ITEMS[kit.mainhand as string];
      expect(main.kind === 'weapon' && main.hand === 'twohand', `${cls} 2H+offhand`).toBe(false);
      const off = ITEMS[kit.offhand];
      expect(canEquipItemInSlot(cls, off, 'offhand', null), `${cls} offhand ${off.id}`).toBe(true);
      expect(kit.offhand).not.toBe(kit.mainhand);
    }
    // Concrete pins for today's content: the melee str classes raise the raid
    // 2H greatsword over Thronebane and drop the offhand entirely (classic hand
    // exclusivity), the hunter takes the agi greatblade, the elemental shaman
    // pairs the staff with the epic raid shield, cloth casters (and the balance
    // druid) hold the Wraithfire Orb, and the rogue still dual-wields a second
    // real weapon.
    for (const cls of ['warrior', 'paladin'] as const) {
      expect(nonHeroicBisKit(cls).mainhand, cls).toBe('bonewrought_greatsword');
      expect(nonHeroicBisKit(cls).offhand, cls).toBeUndefined();
    }
    expect(nonHeroicBisKit('hunter').mainhand).toBe('direfang_greatblade');
    expect(nonHeroicBisKit('hunter').offhand).toBeUndefined();
    expect(nonHeroicBisKit('shaman').offhand).toBe('bonewrought_bulwark');
    for (const cls of ['mage', 'priest', 'warlock', 'druid'] as const) {
      expect(nonHeroicBisKit(cls).offhand, cls).toBe('wraithfire_orb');
    }
    const rogue = nonHeroicBisKit('rogue');
    expect(ITEMS[rogue.offhand as string]?.kind).toBe('weapon');
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

describe('bags, gold, and alternate role kits', () => {
  it('equips the best non-heroic bag in every bag socket', () => {
    const bagId = bestBoostBag();
    expect(bagId).toBe('mistcallers_duffel');
    const bags = Object.values(ITEMS).filter(
      (i) =>
        i.kind === 'bag' &&
        !i.heroic &&
        !i.heroicOf &&
        !(i.id in HEROIC_ITEMS) &&
        !HEROIC_VENDOR_IDS.has(i.id),
    );
    const maxSlots = Math.max(...bags.map((b) => b.bagSlots ?? 0));
    expect(ITEMS[bagId].bagSlots).toBe(maxSlots);
    const state = buildBoostedCharacterState('warrior', 'Pbetestbags', 0);
    expect(state.bags).toEqual(Array(BOOST_BAG_SOCKETS).fill(bagId));
  });

  it('grants exactly 10 gold of pocket money on top of the attunement quest rewards', () => {
    expect(BOOST_COPPER).toBe(100000);
    const questCopper = NYTHRAXIS_ATTUNEMENT_QUESTS.reduce(
      (sum, id) => sum + (QUESTS[id].copperReward ?? 0),
      0,
    );
    const state = buildBoostedCharacterState('rogue', 'Pbetestgold', 0);
    expect(state.copper).toBe(BOOST_COPPER + questCopper);
  });

  it('exactly the multi-kit classes define alternate roles, and spawn roles are stable', () => {
    const hybrids = BOOST_CLASSES.filter((c) => CLASS_ROLES[c].length > 1);
    expect([...hybrids].sort()).toEqual(['druid', 'paladin', 'shaman', 'warrior']);
    for (const cls of BOOST_CLASSES) {
      expect(CLASS_ROLES[cls].length, cls).toBeGreaterThanOrEqual(1);
      expect(CLASS_ROLES[cls].length, cls).toBeLessThanOrEqual(3);
    }
    // The spawn-equipped identity (roles[0]) never changes silently: character
    // selection and the prebuilt kits both lean on these.
    expect(CLASS_ROLES.warrior[0].id).toBe('arms');
    expect(CLASS_ROLES.paladin[0].id).toBe('retribution');
    expect(CLASS_ROLES.priest[0].id).toBe('holy');
    expect(CLASS_ROLES.shaman[0].id).toBe('elemental');
    expect(CLASS_ROLES.druid[0].id).toBe('balance');
  });

  it('hybrid classes carry their full alternate-role kit in the bags, without duplicates', () => {
    for (const cls of BOOST_CLASSES.filter((c) => CLASS_ROLES[c].length > 1)) {
      const state = buildBoostedCharacterState(cls, 'Pbetesthyb', 0);
      const equipped = new Set(Object.values(state.equipment));
      const carried = state.inventory.map((s) => s.itemId);
      const carriedSet = new Set(carried);
      let distinctAltPieces = 0;
      for (const role of CLASS_ROLES[cls].slice(1)) {
        const altKit = bisKitForRole(cls, role);
        for (const itemId of Object.values(altKit)) {
          if (!itemId) continue;
          expect(canEquipItem(cls, ITEMS[itemId]), `${cls} ${role.id} ${itemId} canEquip`).toBe(
            true,
          );
          if (equipped.has(itemId)) continue;
          distinctAltPieces++;
          expect(carriedSet.has(itemId), `${cls} ${role.id} ${itemId}`).toBe(true);
        }
      }
      // The alternate role must actually add SOMETHING (at minimum its weapon);
      // otherwise a regression that stops bagging alt kits passes silently.
      expect(distinctAltPieces, `${cls} distinct alt pieces`).toBeGreaterThanOrEqual(1);
      // Dedupe: nothing the character wears rides in the bags as a copy
      // (except a role's DELIBERATE extras, e.g. fury's second greatsword),
      // and no alt piece was added twice.
      const extras = new Set(CLASS_ROLES[cls].flatMap((r) => [...(r.extras ?? [])]));
      for (const id of equipped) {
        if (!id || extras.has(id)) continue;
        expect(carriedSet.has(id), `${cls} equipped ${id} duplicated in bags`).toBe(false);
      }
      expect(carried.length, `${cls} inventory has stack-level duplicates`).toBe(carriedSet.size);
    }
  });

  it('the shaman spawns in caster gear and carries a distinct melee weapon', () => {
    const state = buildBoostedCharacterState('shaman', 'Pbetestsham', 0);
    const equippedMain = ITEMS[state.equipment.mainhand as string];
    expect(equippedMain.stats?.int ?? 0, 'equipped weapon is caster gear').toBeGreaterThan(0);
    const enhancement = CLASS_ROLES.shaman[1];
    expect(enhancement.id).toBe('enhancement');
    const altMain = bisKitForRole('shaman', enhancement).mainhand as string;
    expect(altMain).not.toBe(equippedMain.id);
    const altDef = ITEMS[altMain];
    expect((altDef.stats?.agi ?? 0) + (altDef.stats?.str ?? 0), 'melee stats').toBeGreaterThan(0);
    expect(state.inventory.some((s) => s.itemId === altMain)).toBe(true);
  });
});

function roleOf(cls: PlayerClass, id: string): BoostRole {
  const role = CLASS_ROLES[cls].find((r) => r.id === id);
  expect(role, `${cls} has a ${id} role`).toBeDefined();
  return role as BoostRole;
}

describe('tank, dual-wield, and shadow kits', () => {
  it('the warrior prot kit tanks with a one-hander and the raid shield', () => {
    const kit = bisKitForRole('warrior', roleOf('warrior', 'prot'));
    const main = ITEMS[kit.mainhand as string];
    expect(main.kind).toBe('weapon');
    // Shieldcrack (the prot signature) requiresShield, so the kit must leave
    // the offhand free of a two-hander and actually hold a shield.
    expect(main.kind === 'weapon' && main.hand === 'twohand', 'prot mainhand is 1H').toBe(false);
    expect(kit.mainhand).toBe('kingsbane_last_oath');
    expect(kit.offhand).toBe('bonewrought_bulwark');
    expect(ITEMS[kit.offhand as string].kind).toBe('shield');
  });

  it('the paladin protection kit tanks with a one-hander and a shield', () => {
    const kit = bisKitForRole('paladin', roleOf('paladin', 'protection'));
    const main = ITEMS[kit.mainhand as string];
    expect(main.kind).toBe('weapon');
    expect(main.kind === 'weapon' && main.hand === 'twohand', 'protection MH is 1H').toBe(false);
    expect(kit.mainhand).toBe('kingsbane_last_oath');
    expect(kit.offhand).toBe('bonewrought_bulwark');
    expect(ITEMS[kit.offhand as string].kind).toBe('shield');
  });

  it('the warrior fury kit fills both hands with distinct spec-legal weapons', () => {
    const kit = bisKitForRole('warrior', roleOf('warrior', 'fury'));
    expect(ITEMS[kit.mainhand as string].kind).toBe('weapon');
    expect(ITEMS[kit.offhand as string].kind).toBe('weapon');
    expect(kit.mainhand).not.toBe(kit.offhand);
    // Titan's Grip: the 2H greatsword pairs with the one-hand legendary; the
    // offhand pick must be legal under the fury spec specifically.
    expect(canEquipItemInSlot('warrior', ITEMS[kit.offhand as string], 'offhand', 'fury')).toBe(
      true,
    );
    expect(kit.mainhand).toBe('bonewrought_greatsword');
    expect(kit.offhand).toBe('kingsbane_last_oath');
  });

  it('the fury kit carries the dual-wield test extras: every hand layout is testable', () => {
    const fury = roleOf('warrior', 'fury');
    // A second greatsword (Titan's Grip 2H+2H) and a spare one-hander
    // (classic 1H+1H); with the worn greatsword and the bagged Thronebane
    // that makes all three dual-wield layouts testable without farming.
    // (emberfang_warblade replaced wyrmfang_greatblade when PR #1762
    // declared the latter two-handed.)
    expect(fury.extras).toEqual(['bonewrought_greatsword', 'emberfang_warblade']);
    for (const id of fury.extras ?? []) {
      const item = ITEMS[id];
      expect(item.heroic ?? false, `${id} heroic`).toBe(false);
      expect(item.heroicOf, `${id} heroicOf`).toBeUndefined();
      expect(id in HEROIC_ITEMS, `${id} bespoke heroic`).toBe(false);
      expect(canEquipItem('warrior', item), `${id} canEquip`).toBe(true);
      expect(meetsLevelRequirement(BOOST_LEVEL, item), `${id} level`).toBe(true);
      expect(canEquipItemInSlot('warrior', item, 'offhand', 'fury'), `${id} offhand`).toBe(true);
    }
    // INTENT pin: the second extra exists to make the classic 1H+1H layout
    // testable, so it must BE one-handed. Titan's Grip makes a two-hander
    // offhand-LEGAL for fury, so the legality pin above cannot catch a hand
    // flip (exactly how wyrmfang_greatblade silently left this role when
    // PR #1762 declared it two-handed).
    const spare = ITEMS[(fury.extras ?? [])[1] as string];
    expect(spare.kind === 'weapon' && weaponHand(spare)).toBe('onehand');
    const state = buildBoostedCharacterState('warrior', 'Pbetestdw', 0);
    const carried = state.inventory.map((s) => s.itemId);
    expect(state.equipment.mainhand).toBe('bonewrought_greatsword');
    // The bagged SECOND copy of the worn greatsword is deliberate.
    expect(carried, 'bagged second greatsword').toContain('bonewrought_greatsword');
    expect(carried, 'bagged spare one-hander').toContain('emberfang_warblade');
    expect(carried, 'bagged legendary').toContain('kingsbane_last_oath');
  });

  it('the holy kit IS the shadow kit: the cloth pool stays undifferentiated (tripwire)', () => {
    // Priest deliberately defines a single kit. This pins the reason: a
    // shadow-weighted pass over the same pool (int-first, sta over spi) picks
    // the identical kit, so a second bagged kit would add zero pieces. If
    // this ever fails, shadow cloth has diverged from healer cloth: add a
    // real shadow role to CLASS_ROLES.
    const shadowStyle: BoostRole = {
      id: 'shadow',
      weights: { int: 1, sta: 0.6, spi: 0.1 },
      melee: false,
    };
    const holy = bisKitForRole('priest', roleOf('priest', 'holy'));
    const shadow = bisKitForRole('priest', shadowStyle);
    expect(shadow).toEqual(holy);
    for (const [slot, itemId] of Object.entries(holy) as [EquipSlot, string][]) {
      expect(ITEMS[itemId].stats?.int ?? 0, `priest ${slot} carries int`).toBeGreaterThan(0);
    }
  });

  it('boosted warriors and paladins carry the tank and fury pieces in their bags', () => {
    const war = buildBoostedCharacterState('warrior', 'Pbetesttank', 0);
    const warCarried = new Set(war.inventory.map((s) => s.itemId));
    expect(warCarried.has('bonewrought_bulwark'), 'warrior carries the shield').toBe(true);
    expect(warCarried.has('kingsbane_last_oath'), 'warrior carries the 1H').toBe(true);
    const pala = buildBoostedCharacterState('paladin', 'Pbetestpala', 0);
    const palaCarried = new Set(pala.inventory.map((s) => s.itemId));
    expect(palaCarried.has('bonewrought_bulwark'), 'paladin carries the shield').toBe(true);
  });
});

describe('caster cloth for the mail casters', () => {
  it('the caster cloth pool declares the full six-class caster group', () => {
    // canEquipItem gates cloth armor by armor RANK only, so the mail casters
    // could always physically wear it; requiredClass on armor is the intent
    // the loot and boost eligibility layers honor. The widening is the change
    // under test: pin the literal six-class list on a piece of each line.
    const casterGroup = ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'];
    expect(ITEMS.necromancers_starshroud.requiredClass).toEqual(casterGroup);
    expect(ITEMS.necromancers_legwraps.requiredClass).toEqual(casterGroup);
    expect(ITEMS.necromancers_soulsteps.requiredClass).toEqual(casterGroup);
    expect(ITEMS.soulflame_cowl.requiredClass).toEqual(casterGroup);
    expect(ITEMS.soulflame_cord.requiredClass).toEqual(casterGroup);
  });

  it('the holy paladin and elemental shaman kits pick the widened cloth body pieces', () => {
    const holy = bisKitForRole('paladin', roleOf('paladin', 'holy'));
    const ele = bisKitForRole('shaman', CLASS_ROLES.shaman[0]);
    // Concrete ids, per slot: reverting any single body-slot widening (e.g.
    // just the legwraps) must fail its dimension, so int>0 is not enough
    // (a reverted legs slot falls back to a low int piece and would pass).
    for (const kit of [holy, ele]) {
      expect(kit.chest).toBe('necromancers_starshroud');
      expect(kit.legs).toBe('necromancers_legwraps');
      expect(kit.feet).toBe('necromancers_soulsteps');
    }
  });
});

describe('Nythraxis attunement', () => {
  it('every boosted character has completed the whole attunement chain', () => {
    expect(NYTHRAXIS_ATTUNEMENT_QUESTS).toEqual([
      'q_nythraxis_restless_dead',
      'q_nythraxis_graves',
      'q_nythraxis_sealed_crypt',
      'q_nythraxis_bound_guardian',
    ]);
    for (const cls of BOOST_CLASSES) {
      const state = buildBoostedCharacterState(cls, 'Pbetestattn', 0);
      for (const questId of NYTHRAXIS_ATTUNEMENT_QUESTS) {
        expect(state.questsDone, `${cls} ${questId}`).toContain(questId);
      }
    }
  });

  it('attunement survives the server login round-trip (the raid door reads questsDone)', () => {
    const state = buildBoostedCharacterState('warlock', 'Pbetestdoor', 0);
    const revived = JSON.parse(JSON.stringify(state)) as CharacterState;
    const sim = new Sim({ seed: 7, playerClass: 'warlock', playerName: 'unused', noPlayer: true });
    const pid = sim.addPlayer('warlock', 'Pbetestdoor', { state: revived });
    // canEnterNythraxisRaid (src/sim/instances/dungeons.ts) gates on exactly
    // this quest id in the loaded meta.
    expect(sim.meta(pid)?.questsDone.has('q_nythraxis_bound_guardian')).toBe(true);
  });
});

describe('buildBoostRoster', () => {
  it('returns one complete roster with valid level-20 states', async () => {
    const roster = await buildBoostRoster(lcg(23));
    expect(roster.map((row) => row.cls)).toEqual(BOOST_CLASSES);
    const names = new Set(roster.map((row) => row.name));
    expect(names.size).toBe(BOOST_CLASSES.length);
    for (const row of roster) {
      expect(normalizeCharName(row.name)).toBe(row.name);
      expect(row.state.level).toBe(BOOST_LEVEL);
    }
  });
});
