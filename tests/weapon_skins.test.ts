import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEAPON_VFX } from '../src/render/weapon_vfx';
import {
  skinnableWeaponTypesFor,
  WEAPON_TYPE_BY_ITEM,
  weaponSkinTypeMatches,
  weaponTypeForItem,
} from '../src/sim/content/weapon_skin_rules';
import {
  WEAPON_SKIN_COLLECTIONS,
  WEAPON_SKIN_LIST,
  WEAPON_SKIN_PRICE_USD,
  WEAPON_SKINS,
  weaponSkinClaudiumCost,
} from '../src/sim/content/weapon_skins';
import { ITEMS } from '../src/sim/data';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const ROOT = join(__dirname, '..');

describe('season 1 weapon skin catalog', () => {
  it('ships exactly the 28 paid skins: 7 per collection, 4 collections', () => {
    expect(WEAPON_SKIN_LIST.length).toBe(28);
    for (const collection of WEAPON_SKIN_COLLECTIONS) {
      const inCollection = WEAPON_SKIN_LIST.filter((s) => s.collection === collection);
      expect(inCollection.length, collection).toBe(7);
      // One skin per weapon type within a collection.
      expect(new Set(inCollection.map((s) => s.weaponType)).size).toBe(7);
    }
  });

  it('prices match the Season 1 sheet and the Claudium peg (1 = 0.01 USD)', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      expect(skin.priceUsd, skin.id).toBe(WEAPON_SKIN_PRICE_USD[skin.rarity]);
      expect(weaponSkinClaudiumCost(skin), skin.id).toBe(skin.priceUsd * 100);
    }
    expect(WEAPON_SKIN_PRICE_USD).toEqual({ uncommon: 2, rare: 10, epic: 30, legendary: 50 });
  });

  it('every skin id is its record key and no skin is free or common', () => {
    for (const [key, skin] of Object.entries(WEAPON_SKINS)) {
      expect(skin.id).toBe(key);
      expect(skin.priceUsd).toBeGreaterThan(0);
      expect(skin.season).toBe(1);
    }
  });

  it('every skin model ships a GLB and a bag icon', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      expect(existsSync(join(ROOT, `public/models/weapons/${skin.model}.glb`)), skin.model).toBe(
        true,
      );
      expect(existsSync(join(ROOT, `public/ui/weapons/${skin.model}.jpg`)), skin.model).toBe(true);
    }
  });

  it('every skin ships its rarity-themed store thumbnail (scripts/armory_thumbs.mjs)', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      expect(existsSync(join(ROOT, `public/ui/store/armory/${skin.id}.webp`)), skin.id).toBe(true);
    }
  });

  it('rare and above carry a VFX spec of the matching tier; uncommon has none', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      const spec = WEAPON_VFX[skin.model];
      if (skin.rarity === 'uncommon') {
        expect(spec, skin.id).toBeUndefined();
      } else {
        expect(spec, skin.id).toBeDefined();
        expect(spec?.tier, skin.id).toBe(skin.rarity);
      }
    }
  });

  it('flagship and hero badges sit where the sheet says', () => {
    expect(WEAPON_SKINS.ice_fang_sword?.badge).toBe('flagship');
    expect(WEAPON_SKINS.solheim_sword?.badge).toBe('hero');
    expect(WEAPON_SKIN_LIST.filter((s) => s.badge).length).toBe(2);
  });

  it('copy is free of em and en dashes (repo rule)', () => {
    for (const skin of WEAPON_SKIN_LIST) {
      for (const text of [skin.name, skin.collection, skin.look, skin.lore]) {
        expect(text.includes('—'), `${skin.id} em dash`).toBe(false);
        expect(text.includes('–'), `${skin.id} en dash`).toBe(false);
      }
    }
  });
});

describe('weapon type classification', () => {
  const weaponIds = Object.entries(ITEMS)
    .filter(([, def]) => def.kind === 'weapon')
    .map(([id]) => id);

  it('classifies every weapon item in the merged ITEMS table', () => {
    const missing = weaponIds.filter((id) => weaponTypeForItem(id) === null);
    expect(missing).toEqual([]);
  });

  it('has no orphan rows for items that do not exist', () => {
    const orphans = Object.keys(WEAPON_TYPE_BY_ITEM).filter((id) => !ITEMS[id]);
    expect(orphans).toEqual([]);
  });

  it('stays in lockstep with the render variant family for mapped items', () => {
    const familyOf = (variant: string): string | null => {
      if (/^(adv_)?sword/.test(variant)) return 'sword';
      if (/^(adv_)?dagger/.test(variant)) return 'dagger';
      if (/^(adv_)?(druid_)?staff|^adv_druid_staff/.test(variant)) return 'staff';
      if (/^hammer/.test(variant)) return 'mace';
      if (/^(adv_)?axe/.test(variant)) return 'axe';
      if (/^(adv_)?wand/.test(variant)) return 'wand';
      if (/^spear|^scythe/.test(variant)) return 'polearm';
      return null;
    };
    for (const id of weaponIds) {
      const variant = ITEM_WEAPON_VARIANTS[id];
      if (!variant) continue;
      const family = familyOf(variant);
      expect(family, `${id} variant ${variant} has no family`).not.toBeNull();
      expect(weaponTypeForItem(id), `${id} (${variant})`).toBe(family);
    }
  });

  it('every dagger-flagged weapon classifies as dagger', () => {
    for (const id of weaponIds) {
      const def = ITEMS[id];
      if (def.kind === 'weapon' && def.weapon.dagger) {
        expect(weaponTypeForItem(id), id).toBe('dagger');
      }
    }
  });

  it('heroic variants resolve through their base row', () => {
    expect(weaponTypeForItem('heroic_moggers_shiv')).toBe('dagger');
    expect(weaponTypeForItem('heroic_brutoks_maul')).toBe('mace');
  });
});

describe('skin apply rule', () => {
  it('requires an equipped mainhand weapon', () => {
    expect(skinnableWeaponTypesFor('warrior', null)).toEqual([]);
    expect(skinnableWeaponTypesFor('hunter', null)).toEqual([]);
  });

  it('matches the equipped item type for weapon-swapping classes', () => {
    expect(skinnableWeaponTypesFor('warrior', 'worn_sword')).toEqual(['sword']);
    expect(skinnableWeaponTypesFor('rogue', 'rusty_dagger')).toEqual(['dagger']);
    expect(weaponSkinTypeMatches('mage', 'gnarled_staff', 'staff')).toBe(true);
    expect(weaponSkinTypeMatches('warrior', 'worn_sword', 'axe')).toBe(false);
  });

  it('lets hunters use bow and crossbow skins (class-fixed ranged visual)', () => {
    expect(skinnableWeaponTypesFor('hunter', 'rusty_hatchet').sort()).toEqual(['bow', 'crossbow']);
  });

  it('offers nothing for polearms', () => {
    expect(skinnableWeaponTypesFor('warrior', 'tidereaver_gaff')).toEqual([]);
  });

  it('every paid skin type is reachable by some class and item', () => {
    const reachable = new Set<string>();
    for (const id of Object.keys(WEAPON_TYPE_BY_ITEM)) {
      for (const t of skinnableWeaponTypesFor('warrior', id)) reachable.add(t);
    }
    for (const t of skinnableWeaponTypesFor('hunter', 'worn_sword')) reachable.add(t);
    for (const skin of WEAPON_SKIN_LIST) {
      expect(reachable.has(skin.weaponType), `${skin.id} (${skin.weaponType})`).toBe(true);
    }
  });
});
