import type { WeaponSkinType } from '../sim/types';
import { t } from './i18n';
import type { ArmorySkinRow } from './woc_store_view';

export function weaponTypeLabel(type: WeaponSkinType): string {
  switch (type) {
    case 'sword':
      return t('hudChrome.wocStore.wtype.sword');
    case 'axe':
      return t('hudChrome.wocStore.wtype.axe');
    case 'mace':
      return t('hudChrome.wocStore.wtype.mace');
    case 'dagger':
      return t('hudChrome.wocStore.wtype.dagger');
    case 'staff':
      return t('hudChrome.wocStore.wtype.staff');
    case 'wand':
      return t('hudChrome.wocStore.wtype.wand');
    case 'bow':
      return t('hudChrome.wocStore.wtype.bow');
    case 'crossbow':
      return t('hudChrome.wocStore.wtype.crossbow');
  }
}

export function rarityLabel(rarity: ArmorySkinRow['skin']['rarity']): string {
  switch (rarity) {
    case 'uncommon':
      return t('hudChrome.wocStore.rarity.uncommon');
    case 'rare':
      return t('hudChrome.wocStore.rarity.rare');
    case 'epic':
      return t('hudChrome.wocStore.rarity.epic');
    case 'legendary':
      return t('hudChrome.wocStore.rarity.legendary');
  }
}

export function badgeLabel(badge: 'flagship' | 'hero'): string {
  return badge === 'flagship'
    ? t('hudChrome.wocStore.badge.flagship')
    : t('hudChrome.wocStore.badge.hero');
}
