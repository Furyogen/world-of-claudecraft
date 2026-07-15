import {
  computeModifiersWithRows,
  emptyRowPicks,
  rowTreeFor,
  sanitizeRowPicks,
} from './content/talent_rows';
import {
  emptyAllocation,
  MAX_LOADOUTS,
  repairAllocation,
  SAVED_LOADOUT_BAR_SLOTS,
  type SavedLoadout,
  type TalentAllocation,
} from './content/talents';
import type { SavedCooldowns } from './cooldown_persist';
import { ABILITIES, abilitiesKnownAt } from './data';
import type { CharacterState } from './sim';
import { MAX_LEVEL, type PlayerClass } from './types';

/**
 * Revision of class-owned data embedded in CharacterState. Revision 1 is the
 * v0.24 stable-Warrior redesign. Production characters already use `warrior`;
 * only that stable id is normalized here.
 */
export const CURRENT_CHARACTER_CONTENT_REVISION = 1;

/**
 * Castable abilities introduced by the v0.24 Warrior redesign. This is the
 * deliberate delta from every ability a v0.23 Warrior could already know
 * (base kit, spec signatures, and talent grants), in current class-kit order.
 * Passives and the dedicated stance-bar abilities must never consume a normal
 * action-bar slot.
 */
export const WARRIOR_V024_HOTBAR_ADDITION_IDS = [
  'revenge',
  'raging_gale',
  'raised_guard',
  'pummel',
  'furious_mending',
  'iron_resolve',
  'red_harvest',
  'faultline',
  'heroic_leap',
  'rallying_cry',
  'emboldening_roar',
  'defiant_bellow',
  'intimidating_shout',
  'breachmaker',
  'die_by_sword',
  'sweeping_strikes',
] as const;

function normalizedLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
}

function knownAbilityIds(
  cls: PlayerClass,
  level: number,
  alloc: TalentAllocation,
  rowPicks: (string | null)[],
): Set<string> {
  const mods = computeModifiersWithRows(cls, alloc, rowPicks, level);
  return new Set(abilitiesKnownAt(cls, level, mods).map((known) => known.def.id));
}

function reconcileSavedBar(
  bar: readonly (string | null)[] | undefined,
  known: ReadonlySet<string>,
): (string | null)[] {
  const next = Array.from({ length: SAVED_LOADOUT_BAR_SLOTS }, (_, index) => {
    const id = Array.isArray(bar) ? bar[index] : null;
    return typeof id === 'string' && known.has(id) ? id : null;
  });

  for (const id of WARRIOR_V024_HOTBAR_ADDITION_IDS) {
    const def = ABILITIES[id];
    if (!def || def.passive || def.exclusiveGroup === 'warrior_stance') continue;
    if (!known.has(id) || next.includes(id)) continue;
    const empty = next.indexOf(null);
    if (empty === -1) break;
    next[empty] = id;
  }
  return next;
}

function normalizeLoadouts(
  loadouts: readonly SavedLoadout[] | undefined,
  level: number,
  rowPicks: (string | null)[],
): SavedLoadout[] {
  if (!Array.isArray(loadouts)) return [];
  return loadouts.slice(0, MAX_LOADOUTS).map((loadout) => {
    const alloc = repairAllocation('warrior', loadout.alloc ?? emptyAllocation(), level);
    return {
      name: (loadout.name || 'Build').toString().slice(0, 24),
      alloc,
      bar: reconcileSavedBar(loadout.bar, knownAbilityIds('warrior', level, alloc, rowPicks)),
    };
  });
}

function normalizeActiveLoadout(value: number | undefined, loadoutCount: number): number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < loadoutCount
    ? (value as number)
    : -1;
}

function normalizeCooldowns(
  cooldowns: SavedCooldowns | undefined,
  known: ReadonlySet<string>,
): SavedCooldowns | undefined {
  if (!cooldowns) return undefined;
  const abilities = Object.fromEntries(
    Object.entries(cooldowns.abilities ?? {}).filter(
      ([id, remaining]) => known.has(id) && Number.isFinite(remaining) && remaining > 0,
    ),
  );
  const potion = cooldowns.potion;
  const normalized: SavedCooldowns = {};
  if (Object.keys(abilities).length > 0) normalized.abilities = abilities;
  if (typeof potion === 'number' && Number.isFinite(potion) && potion > 0) {
    normalized.potion = potion;
  }
  return normalized.abilities || normalized.potion !== undefined ? normalized : undefined;
}

/**
 * Immutably upgrades pre-revision CharacterState class-owned fields. There is
 * intentionally no temporary-class branch or compatibility alias: PTR data is
 * reset, while the production-stable `warrior` id becomes the redesigned kit.
 */
export function normalizeCharacterContentRevision(
  cls: PlayerClass,
  state: CharacterState,
): CharacterState {
  if ((state.contentRevision ?? 0) >= CURRENT_CHARACTER_CONTENT_REVISION) return state;
  if (cls !== 'warrior') {
    return { ...state, contentRevision: CURRENT_CHARACTER_CONTENT_REVISION };
  }

  const level = normalizedLevel(state.level);
  const talents = repairAllocation('warrior', state.talents ?? emptyAllocation(), level);
  const rowPicks = sanitizeRowPicks(
    rowTreeFor('warrior'),
    state.rowPicks ?? emptyRowPicks(),
    level,
  );
  const loadouts = normalizeLoadouts(state.loadouts, level, rowPicks);
  const known = knownAbilityIds('warrior', level, talents, rowPicks);

  return {
    ...state,
    contentRevision: CURRENT_CHARACTER_CONTENT_REVISION,
    talents,
    rowPicks,
    loadouts,
    activeLoadout: normalizeActiveLoadout(state.activeLoadout, loadouts.length),
    cooldowns: normalizeCooldowns(state.cooldowns, known),
  };
}
