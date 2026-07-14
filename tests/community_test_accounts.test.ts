import { describe, expect, it } from 'vitest';
import { validCharName } from '../server/auth';
import {
  buildCommunityTestCharacters,
  communityTestAccountsEnabled,
  configureCommunityTestAccounts,
  generatedTestCharacterName,
} from '../server/community_test_accounts';
import { bagCapacity } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { meetsLevelRequirement } from '../src/sim/item_level_req';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, EQUIP_SLOTS, MAX_LEVEL, xpToReachLevel } from '../src/sim/types';

describe('community test account configuration', () => {
  it('is disabled until boot explicitly enables it', () => {
    configureCommunityTestAccounts(false);
    expect(communityTestAccountsEnabled()).toBe(false);
    configureCommunityTestAccounts(true);
    expect(communityTestAccountsEnabled()).toBe(true);
    configureCommunityTestAccounts(false);
  });
});

describe('generated community character names', () => {
  it('is deterministic, valid, distinct per class, and changes on collision retry', () => {
    const first = ALL_CLASSES.map((cls) => generatedTestCharacterName(42, cls, 0));
    const retried = ALL_CLASSES.map((cls) => generatedTestCharacterName(42, cls, 1));

    expect(new Set(first)).toHaveLength(ALL_CLASSES.length);
    expect(first.every(validCharName)).toBe(true);
    expect(retried.every(validCharName)).toBe(true);
    expect(first).toEqual(ALL_CLASSES.map((cls) => generatedTestCharacterName(42, cls, 0)));
    expect(retried).not.toEqual(first);
  });
});

describe('community test character templates', () => {
  it('builds one fully playable level-20 character for every class', () => {
    const characters = buildCommunityTestCharacters(42);
    expect(characters.map((character) => character.cls)).toEqual(ALL_CLASSES);
    expect(new Set(characters.map((character) => character.name))).toHaveLength(ALL_CLASSES.length);

    for (const character of characters) {
      const { cls, name, state } = character;
      expect(validCharName(name)).toBe(true);
      expect(state.level).toBe(MAX_LEVEL);
      expect(state.lifetimeXp).toBeGreaterThanOrEqual(xpToReachLevel(MAX_LEVEL));
      expect(Object.keys(state.equipment).sort()).toEqual([...EQUIP_SLOTS].sort());
      expect(state.bags).toEqual(Array(4).fill('mistcallers_duffel'));
      expect(bagCapacity(state.bags ?? [])).toBe(72);

      for (const itemId of Object.values(state.equipment)) {
        const item = ITEMS[itemId];
        expect(item, `${cls} equipment ${itemId} must exist`).toBeDefined();
        expect(item?.quality).toBe('epic');
        expect(item?.sellValue).toBe(0);
        expect(item?.soulbound).toBe(true);
        if (!item) throw new Error(`missing equipment ${itemId}`);
        expect(canEquipItem(cls, item)).toBe(true);
        expect(meetsLevelRequirement(MAX_LEVEL, item)).toBe(true);
      }

      const reloaded = new Sim({ seed: 20061, playerClass: cls, noPlayer: true });
      const pid = reloaded.addPlayer(cls, name, { state });
      const player = reloaded.entities.get(pid);
      if (!player) throw new Error(`failed to reload ${name}`);
      expect(player.hp).toBe(player.maxHp);
      if (player.resourceType !== 'rage') expect(player.resource).toBe(player.maxResource);
    }
  });

  it('uses the intended Warfare profile for each class', () => {
    const byClass = Object.fromEntries(
      buildCommunityTestCharacters(7).map((character) => [
        character.cls,
        character.state.equipment,
      ]),
    );

    for (const cls of ['warrior', 'paladin'] as const) {
      expect(byClass[cls].mainhand).toBe('final_argument_greatblade');
      expect(byClass[cls].helmet).toBe('furyforged_warhelm');
      expect(byClass[cls].neck).toBe('final_oath_medallion');
      expect([byClass[cls].ring1, byClass[cls].ring2]).toEqual([
        'iron_vow_band',
        'unbroken_circle',
      ]);
    }
    for (const cls of ['hunter', 'rogue', 'druid'] as const) {
      expect(byClass[cls].mainhand).toBe('first_blood_razor');
      expect(byClass[cls].helmet).toBe('ashstalker_cowl');
      expect(byClass[cls].neck).toBe('razorwind_torque');
      expect([byClass[cls].ring1, byClass[cls].ring2]).toEqual([
        'fleetblood_band',
        'last_step_signet',
      ]);
    }
    expect(byClass.shaman.mainhand).toBe('emberglass_warstaff');
    expect(byClass.shaman.helmet).toBe('stormbound_crown');
    for (const cls of ['priest', 'mage', 'warlock'] as const) {
      expect(byClass[cls].mainhand).toBe('emberglass_warstaff');
      expect(byClass[cls].helmet).toBe('cinderweave_cowl');
    }
    for (const cls of ['priest', 'shaman', 'mage', 'warlock'] as const) {
      expect(byClass[cls].neck).toBe('cinder_sigil_pendant');
      expect([byClass[cls].ring1, byClass[cls].ring2]).toEqual([
        'ashen_focus_ring',
        'spellbreakers_seal',
      ]);
    }
  });

  it('returns independent state copies so accounts and classes cannot share mutable saves', () => {
    const first = buildCommunityTestCharacters(10);
    const second = buildCommunityTestCharacters(11);
    first[0].state.inventory.push({ itemId: 'linen_pouch', count: 1 });
    first[0].state.equipment.mainhand = 'worn_sword';

    expect(second[0].state.inventory).not.toContainEqual({ itemId: 'linen_pouch', count: 1 });
    expect(second[0].state.equipment.mainhand).toBe('final_argument_greatblade');
  });
});
