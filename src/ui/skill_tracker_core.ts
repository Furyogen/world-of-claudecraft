// Pure config core for the Skills Manager (the WeakAuras-style per-spell tracker
// the spellbook's manager mode configures).
//
// This is the COLD half: which abilities the player chose to track and how each
// one draws (a cooldown/proc SQUARE or a duration BAR), plus the localStorage
// round trip and the "can this ability be tracked at all" predicate. The per-frame
// derivation lives in skill_tracker_view.ts and the DOM in
// skill_tracker_painter.ts.
//
// DOM-free, i18n-free, and host-agnostic: it reads AbilityDef (a sim type) and
// plain strings, so a Vitest drives it directly and the offline Sim and the online
// ClientWorld feed it identical input (the ability table is shared content, not
// per-world state).
//
// The config is stored PER CLASS: a druid's tracked kit has nothing to do with a
// mage's, and the spellbook only ever shows one class's abilities, so keying the
// store by class keeps a character switch from inheriting a foreign selection.

import type { AbilityDef, AbilityEffect } from '../sim/types';

/** How one tracked ability draws on the HUD.
 *  - 'square': a cooldown/proc icon with a sweep + countdown (WoW cooldown read).
 *  - 'bar': a cast-bar-style duration bar (icon, countdown, name), the read for a
 *    HoT/DoT ticking on your target. */
export type SkillTrackerDisplay = 'square' | 'bar';

/** The two display kinds in cycle order, so the "type" button steps through them. */
export const SKILL_TRACKER_DISPLAYS: readonly SkillTrackerDisplay[] = ['square', 'bar'];

/** One ability's tracking choice. `enabled` is the manager's display toggle. */
export interface SkillTrackerEntry {
  enabled: boolean;
  display: SkillTrackerDisplay;
}

/** The whole per-class selection, keyed by ability id. Absent id = untracked. */
export type SkillTrackerConfig = Readonly<Record<string, SkillTrackerEntry>>;

/** The state an ability with no stored row starts in: off, and a square once the
 *  player switches it on (the cooldown/proc read is the commoner default). */
export const DEFAULT_SKILL_TRACKER_ENTRY: SkillTrackerEntry = { enabled: false, display: 'square' };

/** Every AbilityEffect family that leaves a timed aura the tracker can follow: a
 *  DoT/HoT, a buff on you or a friendly, a debuff or control effect on an enemy,
 *  an absorb, a weapon imbue. An ability with one of these, or with a real
 *  cooldown, is worth a tracker; a plain instant nuke is not, so the manager never
 *  offers a control that could never light up.
 *
 *  Kept as an explicit ALLOWLIST rather than a "has a duration field" heuristic,
 *  so adding a new effect kind is a deliberate decision here (and a visible one in
 *  tests/skill_tracker_core.test.ts) instead of silently changing which spells the
 *  manager offers. */
const AURA_EFFECT_TYPES: ReadonlySet<AbilityEffect['type']> = new Set([
  // Damage / healing over time.
  'dot',
  'hot',
  'selfHotPctMax',
  // Buffs: on the caster, on a friendly target (Mark of the Wild, Thorns), on a
  // pet, or fanned across the party.
  'selfBuff',
  'buffTarget',
  'petBuff',
  'partyMeleeBuff',
  'aoeAllyAbsorb',
  'aoeAllyAttackPower',
  'aoeAllyDamage',
  'aoeAllyHaste',
  'aoeAllyMaxHp',
  'aoeAllySureCrit',
  'aoeAttackPower',
  'aoeAttackSpeed',
  // Shields, imbues, and the resource-absorb variant.
  'absorb',
  'absorbSpentResource',
  'imbue',
  // Debuffs and control landed on an enemy.
  'applyDebuff',
  'debuffTargetSource',
  'slow',
  'aoeSlow',
  'root',
  'aoeRoot',
  'stun',
  'silence',
  'incapacitate',
  'polymorph',
  'aoeFear',
  'faerieFire',
  'sunder',
  'enrageChance',
  'finisherHaste',
  'finisherStun',
  'greaterInvisibility',
  'temporalEcho',
]);

/** Can this ability ever drive a tracker? True when it applies a followable aura
 *  or has a cooldown to sweep. Pure; the manager rows and the per-frame view both
 *  gate on it so a configured-then-retuned ability cannot leave a dead frame. */
export function isTrackableAbility(def: AbilityDef | undefined): boolean {
  if (!def) return false;
  if (def.cooldown > 0) return true;
  return def.effects.some((effect) => AURA_EFFECT_TYPES.has(effect.type));
}

/** The localStorage key holding one class's selection. Per class (see the header). */
export function skillTrackerStorageKey(classId: string): string {
  return `woc_skill_tracker:${classId}`;
}

/** Read an ability's row, falling back to the untracked default. Never returns
 *  the stored object itself, so a caller cannot mutate the config in place. */
export function skillTrackerEntry(
  config: SkillTrackerConfig,
  abilityId: string,
): SkillTrackerEntry {
  const stored = config[abilityId];
  if (!stored) return { ...DEFAULT_SKILL_TRACKER_ENTRY };
  return { enabled: stored.enabled, display: stored.display };
}

/** Is this ability's tracker display on? The ALLOCATION-FREE read (unlike
 *  skillTrackerEntry, which copies), for the per-frame freshness walk. */
export function isSkillTrackerEnabled(config: SkillTrackerConfig, abilityId: string): boolean {
  return config[abilityId]?.enabled === true;
}

/** This ability's stored tracker type, or the default. The allocation-free twin of
 *  isSkillTrackerEnabled, for the same per-frame walk. */
export function skillTrackerDisplayOf(
  config: SkillTrackerConfig,
  abilityId: string,
): SkillTrackerDisplay {
  return config[abilityId]?.display ?? DEFAULT_SKILL_TRACKER_ENTRY.display;
}

/** Return a NEW config with this ability's enabled flag set (the manager's first
 *  button). Copy-on-write so the caller can diff configs by reference. */
export function setSkillTrackerEnabled(
  config: SkillTrackerConfig,
  abilityId: string,
  enabled: boolean,
): SkillTrackerConfig {
  const current = skillTrackerEntry(config, abilityId);
  return { ...config, [abilityId]: { enabled, display: current.display } };
}

/** Return a NEW config with this ability's display set (the manager's "type"
 *  button). Setting a type never implies enabling: the two buttons stay
 *  independent, exactly like the interface settings they mirror. */
export function setSkillTrackerDisplay(
  config: SkillTrackerConfig,
  abilityId: string,
  display: SkillTrackerDisplay,
): SkillTrackerConfig {
  const current = skillTrackerEntry(config, abilityId);
  return { ...config, [abilityId]: { enabled: current.enabled, display } };
}

/** The next display in SKILL_TRACKER_DISPLAYS order (wraps). Pure. */
export function nextSkillTrackerDisplay(display: SkillTrackerDisplay): SkillTrackerDisplay {
  const index = SKILL_TRACKER_DISPLAYS.indexOf(display);
  return SKILL_TRACKER_DISPLAYS[(index + 1) % SKILL_TRACKER_DISPLAYS.length];
}

/** Parse a stored selection. Tolerant by design: a corrupt blob, a stray key, or a
 *  row with an unknown display degrades to "not tracked" rather than throwing, so
 *  a bad localStorage value can never break the HUD. */
export function parseSkillTrackerConfig(raw: string | null): SkillTrackerConfig {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, SkillTrackerEntry> = {};
  for (const [abilityId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as { enabled?: unknown; display?: unknown };
    const display = row.display;
    if (display !== 'square' && display !== 'bar') continue;
    out[abilityId] = { enabled: row.enabled === true, display };
  }
  return out;
}

/** Serialize a selection for localStorage. Rows byte-identical to the untracked
 *  default are dropped, so idly toggling a whole class kit off again leaves no
 *  residue; a row that is off but carries a NON-default display is kept, because
 *  the player's chosen type must survive switching its display off and on again. */
export function serializeSkillTrackerConfig(config: SkillTrackerConfig): string {
  const out: Record<string, SkillTrackerEntry> = {};
  for (const [abilityId, entry] of Object.entries(config)) {
    if (!entry.enabled && entry.display === DEFAULT_SKILL_TRACKER_ENTRY.display) continue;
    out[abilityId] = { enabled: entry.enabled, display: entry.display };
  }
  return JSON.stringify(out);
}
