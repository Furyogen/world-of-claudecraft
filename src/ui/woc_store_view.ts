// Pure projection for the WOC Store weapon-cosmetic grid. The economy service
// remains authoritative for availability, names, prices, balances, and grants.
// This module only associates known shipped weapon cosmetics with their card art.

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
