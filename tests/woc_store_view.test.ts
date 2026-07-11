import { describe, expect, it } from 'vitest';
import {
  buildWocStoreRows,
  isKnownWocStoreWeapon,
  type WocStoreItemInput,
} from '../src/ui/woc_store_view';

const items: WocStoreItemInput[] = [
  {
    itemId: 'emberfang_sword',
    name: 'Emberfang',
    kind: 'item',
    costClaudium: 1200,
    owned: false,
  },
  {
    itemId: 'placeholder_hat',
    name: 'Placeholder Hat',
    kind: 'cosmetic',
    costClaudium: 20,
    owned: false,
  },
  {
    itemId: 'purple_axe',
    name: 'Aether Axe',
    kind: 'item',
    costClaudium: 800,
    owned: true,
  },
];

describe('WOC Store weapon catalog projection', () => {
  it('shows only known shipped weapon cosmetics and preserves service pricing', () => {
    expect(buildWocStoreRows(1000, items)).toEqual([
      {
        itemId: 'emberfang_sword',
        name: 'Emberfang',
        kind: 'item',
        costClaudium: 1200,
        owned: false,
        art: '/ui/store/weapons/emberfang_sword.jpg',
        category: 'weapons',
        affordable: false,
        shortfall: 200,
      },
      {
        itemId: 'purple_axe',
        name: 'Aether Axe',
        kind: 'item',
        costClaudium: 800,
        owned: true,
        art: '/ui/store/weapons/purple_axe.jpg',
        category: 'weapons',
        affordable: false,
        shortfall: 0,
      },
    ]);
  });

  it('fails closed when the economy balance is unavailable', () => {
    expect(buildWocStoreRows(null, items)).toEqual([]);
  });

  it('rejects invalid costs and exposes the complete known weapon set', () => {
    expect(
      buildWocStoreRows(100, [
        {
          itemId: 'redskull_wand',
          name: 'Wand',
          kind: 'item',
          costClaudium: 0,
          owned: false,
        },
      ]),
    ).toEqual([]);
    expect(isKnownWocStoreWeapon('redskull_wand')).toBe(true);
    expect(isKnownWocStoreWeapon('placeholder_hat')).toBe(false);
  });
});
