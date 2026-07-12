import { describe, expect, it } from 'vitest';
import {
  CHAT_CATEGORIES,
  categoryForLine,
  isChatCategory,
  isChatCategoryVisible,
  isSystemChatCategory,
  parseHiddenChatCategories,
  SYSTEM_CHAT_CATEGORIES,
  serializeHiddenChatCategories,
  toggleChatCategory,
} from '../src/ui/chat_categories';

describe('chat category filter, pure model', () => {
  it('exposes the five system categories and four player-channel groups', () => {
    expect(SYSTEM_CHAT_CATEGORIES).toEqual(['game', 'loot', 'xp', 'quest', 'event']);
    expect(CHAT_CATEGORIES).toEqual([
      'game',
      'loot',
      'xp',
      'quest',
      'event',
      'public',
      'party',
      'guild',
      'channels',
      'whispers',
    ]);
  });

  describe('categoryForLine', () => {
    it('groups system lines by their stamped sub-category, defaulting to game', () => {
      expect(categoryForLine('system', 'loot')).toBe('loot');
      expect(categoryForLine('system', 'xp')).toBe('xp');
      expect(categoryForLine('system', 'quest')).toBe('quest');
      expect(categoryForLine('system', 'event')).toBe('event');
      expect(categoryForLine('system')).toBe('game');
      expect(categoryForLine('system', 'game')).toBe('game');
    });

    it('groups player channels into the public/party/guild/channels/whispers buckets', () => {
      expect(categoryForLine('say')).toBe('public');
      expect(categoryForLine('yell')).toBe('public');
      expect(categoryForLine('general')).toBe('public');
      expect(categoryForLine('party')).toBe('party');
      expect(categoryForLine('guild')).toBe('guild');
      expect(categoryForLine('officer')).toBe('guild');
      expect(categoryForLine('world')).toBe('channels');
      expect(categoryForLine('lfg')).toBe('channels');
      expect(categoryForLine('whisper')).toBe('whispers');
    });

    it('falls back an unknown player channel tag to public rather than throwing', () => {
      expect(categoryForLine('bogus')).toBe('public');
    });

    it('ignores a sysCat hint on a non-system chan', () => {
      expect(categoryForLine('party', 'loot')).toBe('party');
    });
  });

  describe('type guards', () => {
    it('isChatCategory / isSystemChatCategory reject unknown values', () => {
      expect(isChatCategory('party')).toBe(true);
      expect(isChatCategory('bogus')).toBe(false);
      expect(isChatCategory(42)).toBe(false);
      expect(isChatCategory(null)).toBe(false);
      expect(isSystemChatCategory('loot')).toBe(true);
      expect(isSystemChatCategory('party')).toBe(false);
    });
  });

  describe('persistence', () => {
    it('round-trips a hidden-category list', () => {
      const hidden = ['loot', 'xp'] as const;
      expect(parseHiddenChatCategories(serializeHiddenChatCategories([...hidden]))).toEqual([
        ...hidden,
      ]);
    });

    it('defaults to empty (everything visible) for no stored value', () => {
      expect(parseHiddenChatCategories(null)).toEqual([]);
    });

    it('is defensive against corrupt, malformed, or forward-version blobs', () => {
      expect(parseHiddenChatCategories('not json')).toEqual([]);
      expect(parseHiddenChatCategories('{"a":1}')).toEqual([]);
      expect(parseHiddenChatCategories('["loot","bogus","xp",42]')).toEqual(['loot', 'xp']);
    });

    it('drops duplicate entries, keeping first occurrence order', () => {
      expect(parseHiddenChatCategories('["loot","xp","loot"]')).toEqual(['loot', 'xp']);
    });
  });

  describe('isChatCategoryVisible / toggleChatCategory', () => {
    it('everything is visible with an empty hidden set', () => {
      expect(isChatCategoryVisible([], 'loot')).toBe(true);
    });

    it('a hidden category reports not visible', () => {
      expect(isChatCategoryVisible(['loot'], 'loot')).toBe(false);
      expect(isChatCategoryVisible(['loot'], 'xp')).toBe(true);
    });

    it('toggle adds an unhidden category and removes an already-hidden one', () => {
      expect(toggleChatCategory([], 'loot')).toEqual(['loot']);
      expect(toggleChatCategory(['loot'], 'loot')).toEqual([]);
      expect(toggleChatCategory(['loot'], 'xp')).toEqual(['loot', 'xp']);
    });

    it('never mutates the input array', () => {
      const hidden: ('loot' | 'xp')[] = ['loot'];
      const result = toggleChatCategory(hidden, 'xp');
      expect(hidden).toEqual(['loot']);
      expect(result).toEqual(['loot', 'xp']);
    });
  });
});
