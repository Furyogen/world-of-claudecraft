// Pure projection for the WOC Store weapon-cosmetic grid and the Season 1
// Armory. The economy service remains authoritative for availability, prices,
// balances, and grants; the Season 1 catalog (src/sim/content/weapon_skins.ts)
// supplies the skins themselves (model, rarity, lore) and the apply rules
// decide which skins the player can attach right now. DOM-free and unit-tested.

import {
  eligibleClassesForWeaponSkinType,
  skinnableWeaponTypesFor,
} from '../sim/content/weapon_skin_rules';
import {
  WEAPON_SKIN_LIST,
  WEAPON_SKIN_RARITY_ORDER,
  type WeaponSkinDef,
  type WeaponSkinRarity,
  weaponSkinClaudiumCost,
} from '../sim/content/weapon_skins';
import type { PlayerClass, WeaponSkinType } from '../sim/types';
import type { AccountCosmetics } from '../world_api/cosmetics';

export interface WocStoreItemInput {
  itemId: string;
  name: string;
  kind: 'cosmetic' | 'skin' | 'item';
  costClaudium: number;
  owned: boolean;
}

export interface WocStoreItemRow extends WocStoreItemInput {
  art: string;
  category: WocStoreCategory;
  affordable: boolean;
  shortfall: number;
}

export type WocStoreCategory = 'weapons' | 'outfits' | 'mounts';

interface WocStoreAsset {
  art: string;
  category: WocStoreCategory;
}

const asset = (art: string, category: WocStoreCategory = 'weapons'): WocStoreAsset => ({
  art,
  category,
});

const STORE_ASSETS: Readonly<Record<string, WocStoreAsset>> = {
  emberfang_sword: asset('/ui/store/weapons/emberfang_sword.jpg'),
  redskull_sword: asset('/ui/store/weapons/redskull_sword.jpg'),
  redskull_dagger: asset('/ui/store/weapons/redskull_dagger.jpg'),
  redskull_staff: asset('/ui/store/weapons/redskull_staff.jpg'),
  redskull_wand: asset('/ui/store/weapons/redskull_wand.jpg'),
  redskull_hammer: asset('/ui/store/weapons/redskull_hammer.jpg'),
  purple_sword: asset('/ui/store/weapons/purple_sword.jpg'),
  purple_dagger: asset('/ui/store/weapons/purple_dagger.jpg'),
  purple_axe: asset('/ui/store/weapons/purple_axe.jpg'),
  purple_staff: asset('/ui/store/weapons/purple_staff.jpg'),
  purple_wand: asset('/ui/store/weapons/purple_wand.jpg'),
};

export function buildWocStoreRows(
  balance: number | null,
  items: readonly WocStoreItemInput[],
): WocStoreItemRow[] {
  if (balance === null) return [];
  return items.flatMap((item) => {
    const storeAsset = item.kind === 'item' ? STORE_ASSETS[item.itemId] : undefined;
    if (!storeAsset || !Number.isFinite(item.costClaudium) || item.costClaudium <= 0) return [];
    return [
      {
        ...item,
        ...storeAsset,
        affordable: !item.owned && balance >= item.costClaudium,
        shortfall: item.owned ? 0 : Math.max(0, item.costClaudium - balance),
      },
    ];
  });
}

export function isKnownWocStoreWeapon(itemId: string): boolean {
  return itemId in STORE_ASSETS;
}

// ── Season 1 Armory ─────────────────────────────────────────────────────────

export interface ArmorySkinRow {
  skin: WeaponSkinDef;
  /** Store card / inspect thumbnail (rarity-themed render). */
  art: string;
  /** Claudium cost: the service row's live price when present, else the catalog peg. */
  costClaudium: number;
  /** The economy service has this SKU, so Buy can succeed. */
  purchasable: boolean;
  owned: boolean;
  /** This exact skin is in the account loadout for its weapon type. */
  applied: boolean;
  /** A weapon of the skin's type is equipped right now, so Apply is possible. */
  canApplyNow: boolean;
  affordable: boolean;
  shortfall: number;
  /** Classes that can ever apply this skin (the card's face chips). */
  eligibleClasses: readonly PlayerClass[];
}

export interface ArmorySection {
  collection: string;
  rarity: WeaponSkinRarity;
  rows: ArmorySkinRow[];
}

export interface ArmoryContext {
  cosmetics: Pick<AccountCosmetics, 'weaponSkinIds' | 'weaponSkinLoadout'>;
  cls: string;
  mainhandItemId: string | null;
}

export function armorySkinArt(skinId: string): string {
  return `/ui/store/armory/${skinId}.webp`;
}

/** Season 1 Armory sections, highest rarity first (the hero collection leads).
 *  Every catalog skin always shows; a skin missing from the service snapshot
 *  renders with its catalog price but an unavailable Buy. Owned unions the
 *  service grant flag with the account mirror so a fresh purchase reflects
 *  immediately even before the next store fetch. */
export function buildArmorySections(
  balance: number | null,
  items: readonly WocStoreItemInput[],
  ctx: ArmoryContext,
): ArmorySection[] {
  const serviceRows = new Map(items.filter((i) => i.kind === 'skin').map((i) => [i.itemId, i]));
  const applicableTypes = new Set<WeaponSkinType>(
    skinnableWeaponTypesFor(ctx.cls, ctx.mainhandItemId),
  );
  const sections = new Map<string, ArmorySection>();
  for (const skin of WEAPON_SKIN_LIST) {
    const service = serviceRows.get(skin.id);
    const owned = (service?.owned ?? false) || ctx.cosmetics.weaponSkinIds.includes(skin.id);
    const costClaudium = service?.costClaudium ?? weaponSkinClaudiumCost(skin);
    const row: ArmorySkinRow = {
      skin,
      art: armorySkinArt(skin.id),
      costClaudium,
      purchasable: service !== undefined,
      owned,
      applied: owned && ctx.cosmetics.weaponSkinLoadout[skin.weaponType] === skin.id,
      canApplyNow: owned && applicableTypes.has(skin.weaponType),
      affordable: !owned && balance !== null && balance >= costClaudium,
      shortfall: owned || balance === null ? 0 : Math.max(0, costClaudium - balance),
      eligibleClasses: eligibleClassesForWeaponSkinType(skin.weaponType),
    };
    let section = sections.get(skin.collection);
    if (!section) {
      section = { collection: skin.collection, rarity: skin.rarity, rows: [] };
      sections.set(skin.collection, section);
    }
    section.rows.push(row);
  }
  const rarityRank = (r: WeaponSkinRarity) => WEAPON_SKIN_RARITY_ORDER.indexOf(r);
  return [...sections.values()].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
}
