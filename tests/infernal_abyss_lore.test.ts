import { describe, expect, it } from 'vitest';
import { infernalAbyssLoreLines } from '../src/sim/quests/infernal_abyss_lore';
import { setLanguage } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

describe('Infernal Abyss lore visions', () => {
  it('provides a two-line revelation for every authored lore object', () => {
    for (const itemId of [
      'charred_legion_tablet',
      'brands_of_the_first_flame',
      'forgekeepers_ledger',
      'azazels_broken_covenant',
    ]) {
      const lines = infernalAbyssLoreLines(itemId);
      expect(lines, itemId).toHaveLength(2);
      expect(lines?.every((line) => line.length > 20)).toBe(true);
    }
  });

  it('does not invent dialogue for ordinary interactables', () => {
    expect(infernalAbyssLoreLines('not_infernal_lore')).toBeNull();
  });

  it('localizes every lore line in the five non-Latin M16 locales', () => {
    const english = Object.values([
      'charred_legion_tablet',
      'brands_of_the_first_flame',
      'forgekeepers_ledger',
      'azazels_broken_covenant',
    ]).flatMap((itemId) => infernalAbyssLoreLines(itemId) ?? []);
    for (const language of ['zh_CN', 'zh_TW', 'ko_KR', 'ja_JP', 'ru_RU'] as const) {
      setLanguage(language);
      for (const line of english) expect(localizeSimText(line)).not.toBe(line);
    }
    setLanguage('en');
  });
});
