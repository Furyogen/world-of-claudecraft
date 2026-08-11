// Host-agnostic view model behind the Class Power Tuner page: slider state,
// dirty tracking, filtering, the tuned-number preview, and the document the
// page posts back. No DOM, no Svelte: unit-tested directly in
// tests/admin/class_tuning.test.ts.
//
// The value math below is a DELIBERATE LOCAL COPY of `scaleTuningValue` in
// src/sim/tuning/channels.ts. This bundle cannot import src/sim (see
// src/admin/CLAUDE.md), and a balance tool that cannot show the resulting
// numbers is only half a tool, so the copy earns its keep. It is pinned equal
// to the sim's across every value kind by tests/admin/class_tuning.test.ts,
// the same arrangement `permissions.ts` uses for the permission vocabulary.

import type {
  ClassTuningCatalog,
  TunerAbilityInfo,
  TunerChannelInfo,
  TunerClassInfo,
  TunerWeaponInfo,
  TuningValueKind,
} from './types';

export const TUNING_MIN_FACTOR = 0.1;
export const TUNING_MAX_FACTOR = 3;
export const TUNING_FACTOR_STEP = 0.01;
export const TUNING_NEUTRAL_FACTOR = 1;

/**
 * entry id -> channel -> factor, for ONE scope. Every channel the entry exposes
 * is present, at 1 when untouched.
 */
export type TuningFormState = Record<string, Record<string, number>>;

/** Both scopes' slider state: abilities and auto-attack weapon profiles. */
export interface TuningForm {
  abilities: TuningFormState;
  weapons: TuningFormState;
}

/** The sparse shape the API stores: only channels moved off neutral. */
export interface TuningDocument {
  version: number;
  abilities: Record<string, Record<string, number>>;
  weapons: Record<string, Record<string, number>>;
}

export function isNeutral(factor: number): boolean {
  return Math.abs(factor - TUNING_NEUTRAL_FACTOR) < TUNING_FACTOR_STEP / 2;
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** Mirror of the sim's `scaleTuningValue`. Keep the two byte-equivalent. */
export function scaleTunedValue(base: number, factor: number, kind: TuningValueKind): number {
  if (!Number.isFinite(base)) return base;
  if (kind === 'deviation') return roundTo(1 + (base - 1) * factor, 4);
  const scaled = base * factor;
  if (kind === 'fraction') return roundTo(Math.min(1, Math.max(0, scaled)), 4);
  if (kind === 'multiplier') return roundTo(scaled, 4);
  return Number.isInteger(base) ? Math.round(scaled) : roundTo(scaled, 4);
}

export function clampFactor(value: number): number {
  if (!Number.isFinite(value)) return TUNING_NEUTRAL_FACTOR;
  return roundTo(Math.min(TUNING_MAX_FACTOR, Math.max(TUNING_MIN_FACTOR, value)), 2);
}

/**
 * The slider state for a whole catalog: every channel of every ability present
 * at neutral, then the saved document laid over the top.
 *
 * Channels in the document that the catalog no longer exposes are dropped: a
 * retired effect must not leave an invisible factor behind that a later save
 * would silently re-post.
 */
export function tuningFormState(
  catalog: ClassTuningCatalog,
  document: TuningDocument | null,
): TuningForm {
  return {
    abilities: scopeFormState(
      catalog.classes.flatMap((classInfo) => classInfo.abilities),
      document?.abilities,
    ),
    weapons: scopeFormState(catalog.weapons, document?.weapons),
  };
}

/** One scope's slider state: every exposed channel present, saved values on top. */
function scopeFormState(
  entries: readonly { id: string; channels: TunerChannelInfo[] }[],
  saved: Record<string, Record<string, number>> | undefined,
): TuningFormState {
  const form: TuningFormState = {};
  for (const entry of entries) {
    const row: Record<string, number> = {};
    for (const channel of entry.channels) {
      const stored = saved?.[entry.id]?.[channel.channel];
      row[channel.channel] = typeof stored === 'number' ? clampFactor(stored) : 1;
    }
    form[entry.id] = row;
  }
  return form;
}

/** The sparse document to post: neutral channels are omitted entirely. */
export function buildTuningDocument(form: TuningForm): TuningDocument {
  return { version: 1, abilities: sparseScope(form.abilities), weapons: sparseScope(form.weapons) };
}

function sparseScope(scope: TuningFormState): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const entryId of Object.keys(scope).sort()) {
    const row: Record<string, number> = {};
    let any = false;
    for (const channel of Object.keys(scope[entryId]).sort()) {
      const factor = clampFactor(scope[entryId][channel]);
      if (isNeutral(factor)) continue;
      row[channel] = factor;
      any = true;
    }
    if (any) out[entryId] = row;
  }
  return out;
}

/** Stable serialization, so "is anything unsaved" is a string comparison. */
export function tuningDocumentKey(document: TuningDocument): string {
  return JSON.stringify({
    abilities: orderedScope(document.abilities),
    weapons: orderedScope(document.weapons ?? {}),
  });
}

function orderedScope(
  scope: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const entryId of Object.keys(scope).sort()) {
    const row: Record<string, number> = {};
    for (const channel of Object.keys(scope[entryId]).sort())
      row[channel] = scope[entryId][channel];
    out[entryId] = row;
  }
  return out;
}

/** How many channels of this one ability are off neutral. */
export function tunedChannelCount(form: TuningFormState, abilityId: string): number {
  const row = form[abilityId];
  if (!row) return 0;
  return Object.values(row).filter((factor) => !isNeutral(factor)).length;
}

/** How many abilities in this class have anything moved. */
export function tunedAbilityCount(form: TuningFormState, classInfo: TunerClassInfo): number {
  return classInfo.abilities.filter((ability) => tunedChannelCount(form, ability.id) > 0).length;
}

/** How many weapon profiles have a swing channel moved. */
export function tunedWeaponCount(
  form: TuningFormState,
  weapons: readonly TunerWeaponInfo[],
): number {
  return weapons.filter((weapon) => tunedChannelCount(form, weapon.id) > 0).length;
}

export interface AbilityFilter {
  /** A spec id, or null for every spec in the class. */
  spec: string | null;
  /** Case-insensitive match against ability name and id. */
  search: string;
  /** Show only abilities with at least one channel off neutral. */
  onlyTuned: boolean;
}

export const EMPTY_ABILITY_FILTER: AbilityFilter = { spec: null, search: '', onlyTuned: false };

export function filterAbilities(
  classInfo: TunerClassInfo,
  filter: AbilityFilter,
  form: TuningFormState,
): TunerAbilityInfo[] {
  const needle = filter.search.trim().toLowerCase();
  return classInfo.abilities.filter((ability) => {
    // An ability every spec excludes (source 'unspecced') carries no spec, so a
    // spec filter must not hide it behind an empty list check that reads as a
    // bug; it is shown only when no spec filter is active.
    if (filter.spec !== null && !ability.specs.includes(filter.spec)) return false;
    if (filter.onlyTuned && tunedChannelCount(form, ability.id) === 0) return false;
    if (needle.length > 0) {
      const haystack = `${ability.name} ${ability.id}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** Reset every channel of one ability or weapon back to the shipped numbers. */
export function resetAbility(form: TuningFormState, entryId: string): void {
  const row = form[entryId];
  if (!row) return;
  for (const channel of Object.keys(row)) row[channel] = TUNING_NEUTRAL_FACTOR;
}

export interface WeaponFilter {
  /** A hand/type value ('onehand', 'twohand', 'ranged', 'wand'), or null for all. */
  hand: string | null;
  search: string;
  onlyTuned: boolean;
}

export const EMPTY_WEAPON_FILTER: WeaponFilter = { hand: null, search: '', onlyTuned: false };

export function weaponHands(weapons: readonly TunerWeaponInfo[]): string[] {
  return [...new Set(weapons.map((weapon) => weapon.hand))].sort();
}

export function filterWeapons(
  weapons: readonly TunerWeaponInfo[],
  filter: WeaponFilter,
  form: TuningFormState,
): TunerWeaponInfo[] {
  const needle = filter.search.trim().toLowerCase();
  return weapons.filter((weapon) => {
    if (filter.hand !== null && weapon.hand !== filter.hand) return false;
    if (filter.onlyTuned && tunedChannelCount(form, weapon.id) === 0) return false;
    if (needle.length > 0 && !`${weapon.name} ${weapon.id}`.toLowerCase().includes(needle)) {
      return false;
    }
    return true;
  });
}

/**
 * The weapon's numbers after its current sliders, for the card readout. Mirrors
 * the sim's weapon walker: damage scales linearly, the swing timer scales
 * linearly (a factor above 1 makes the weapon SLOWER, matching the label), and
 * the timer never drops below one sim tick.
 */
export interface WeaponPreview {
  min: number;
  max: number;
  speed: number;
  dps: number;
  unchanged: boolean;
}

export const MIN_SWING_SECONDS = 0.05;

export function weaponPreview(
  weapon: TunerWeaponInfo,
  factors: Record<string, number> | undefined,
): WeaponPreview {
  const damage = factors?.swing_damage ?? TUNING_NEUTRAL_FACTOR;
  const speedFactor = factors?.swing_speed ?? TUNING_NEUTRAL_FACTOR;
  const min = scaleTunedValue(weapon.min, damage, 'linear');
  const max = scaleTunedValue(weapon.max, damage, 'linear');
  const speed = Math.max(MIN_SWING_SECONDS, scaleTunedValue(weapon.speed, speedFactor, 'linear'));
  const dps = speed > 0 ? Math.round(((min + max) / 2 / speed + Number.EPSILON) * 100) / 100 : 0;
  return {
    min,
    max,
    speed,
    dps,
    unchanged: min === weapon.min && max === weapon.max && speed === weapon.speed,
  };
}

export interface ChannelPreview {
  /** The authored numbers, deduped in traversal order. */
  base: number[];
  /** The same numbers with the current factor applied. */
  tuned: number[];
  /** True when the factor leaves every number where it was. */
  unchanged: boolean;
}

/**
 * The before/after readout for one slider. Deduped and capped, because a
 * multi-rank ability can carry a dozen sites and the card only has room for a
 * readable handful.
 */
export function channelPreview(
  channel: TunerChannelInfo,
  factor: number,
  maxValues = 6,
): ChannelPreview {
  const base: number[] = [];
  const tuned: number[] = [];
  const seen = new Set<number>();
  for (const site of channel.sites) {
    if (seen.has(site.value)) continue;
    seen.add(site.value);
    if (base.length >= maxValues) break;
    base.push(site.value);
    tuned.push(scaleTunedValue(site.value, factor, site.kind));
  }
  return { base, tuned, unchanged: base.every((value, index) => value === tuned[index]) };
}

/** The percentage a factor represents, for the slider's label ("+35%", "-20%"). */
export function factorDeltaPercent(factor: number): number {
  return Math.round((factor - 1) * 100);
}
