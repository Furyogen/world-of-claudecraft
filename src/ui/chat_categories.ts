// Pure model for the "All chat" category filter strip (issue #1670): lets a
// player independently hide groups of lines from the combined All view without
// giving up channel tabs (which still show exactly one channel, untouched by
// this filter). hud.ts owns the strip DOM and per-line tagging; this module
// owns which category a line belongs to and the persisted hidden-set.
//
// Two families of category:
//  - System categories (`loot`, `xp`, `quest`, `event`, `game`) group the
//    game-emitted lines that all carry chan `'system'` today. hud.ts tags each
//    one with a `SystemChatCategory` at the call site (see `log()`); this
//    module has no way to infer one from text alone.
//  - Player-channel categories (`public`, `party`, `guild`, `channels`,
//    `whispers`) group the existing per-line `chan` values so the same strip
//    can also thin the player-chat mix in the All view (a channel tab already
//    isolates one of these; this only affects the combined view).

export const SYSTEM_CHAT_CATEGORIES = ['game', 'loot', 'xp', 'quest', 'event'] as const;
export type SystemChatCategory = (typeof SYSTEM_CHAT_CATEGORIES)[number];

export function isSystemChatCategory(v: unknown): v is SystemChatCategory {
  return typeof v === 'string' && (SYSTEM_CHAT_CATEGORIES as readonly string[]).includes(v);
}

const PLAYER_CHANNEL_GROUP: Record<string, ChatCategory> = {
  say: 'public',
  yell: 'public',
  general: 'public',
  world: 'channels',
  lfg: 'channels',
  party: 'party',
  guild: 'guild',
  officer: 'guild',
  whisper: 'whispers',
};

export const CHAT_CATEGORIES = [
  ...SYSTEM_CHAT_CATEGORIES,
  'public',
  'party',
  'guild',
  'channels',
  'whispers',
] as const;
export type ChatCategory = (typeof CHAT_CATEGORIES)[number];

export function isChatCategory(v: unknown): v is ChatCategory {
  return typeof v === 'string' && (CHAT_CATEGORIES as readonly string[]).includes(v);
}

// The category a rendered line belongs to, for filter-strip purposes. `chan`
// is the existing per-line channel tag (`'system'` for every game-emitted
// line, or a real channel/`'whisper'` for player chat). `sysCat` is the finer
// system category hud.ts stamps alongside `chan` for system lines; it is
// ignored (and may be omitted) for player-channel lines.
export function categoryForLine(chan: string, sysCat?: SystemChatCategory): ChatCategory {
  if (chan === 'system') return sysCat ?? 'game';
  return PLAYER_CHANNEL_GROUP[chan] ?? 'public';
}

// Persistence: the set of categories the player has hidden from the All view.
// Defaults to empty (everything visible), matching current behavior for
// anyone who has never touched the filter strip. Parsing is defensive so a
// corrupt or forward-version blob never throws inside the HUD.
export function parseHiddenChatCategories(raw: string | null): ChatCategory[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: ChatCategory[] = [];
  for (const v of arr) {
    if (isChatCategory(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

export function serializeHiddenChatCategories(hidden: readonly ChatCategory[]): string {
  return JSON.stringify(hidden);
}

export function isChatCategoryVisible(
  hidden: readonly ChatCategory[],
  category: ChatCategory,
): boolean {
  return !hidden.includes(category);
}

// Toggle one category's visibility, returning a new array (never mutates the
// input) so callers can keep using plain equality/persistence checks.
export function toggleChatCategory(
  hidden: readonly ChatCategory[],
  category: ChatCategory,
): ChatCategory[] {
  return hidden.includes(category) ? hidden.filter((c) => c !== category) : [...hidden, category];
}
