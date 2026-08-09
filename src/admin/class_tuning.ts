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
  TuningValueKind,
} from './types';

export const TUNING_MIN_FACTOR = 0.1;
export const TUNING_MAX_FACTOR = 3;
export const TUNING_FACTOR_STEP = 0.01;
export const TUNING_NEUTRAL_FACTOR = 1;

/** ability id -> channel -> factor. Every channel an ability exposes is present. */
export type TuningFormState = Record<string, Record<string, number>>;

/** The sparse shape the API stores: only channels moved off neutral. */
export interface TuningDocument {
  version: number;
  abilities: Record<string, Record<string, number>>;
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
): TuningFormState {
  const form: TuningFormState = {};
  const saved = document?.abilities ?? {};
  for (const classInfo of catalog.classes) {
    for (const ability of classInfo.abilities) {
      const row: Record<string, number> = {};
      for (const channel of ability.channels) {
        const stored = saved[ability.id]?.[channel.channel];
        row[channel.channel] = typeof stored === 'number' ? clampFactor(stored) : 1;
      }
      form[ability.id] = row;
    }
  }
  return form;
}

/** The sparse document to post: neutral channels are omitted entirely. */
export function buildTuningDocument(form: TuningFormState): TuningDocument {
  const abilities: Record<string, Record<string, number>> = {};
  for (const abilityId of Object.keys(form).sort()) {
    const row: Record<string, number> = {};
    let any = false;
    for (const channel of Object.keys(form[abilityId]).sort()) {
      const factor = clampFactor(form[abilityId][channel]);
      if (isNeutral(factor)) continue;
      row[channel] = factor;
      any = true;
    }
    if (any) abilities[abilityId] = row;
  }
  return { version: 1, abilities };
}

/** Stable serialization, so "is anything unsaved" is a string comparison. */
export function tuningDocumentKey(document: TuningDocument): string {
  const abilities: Record<string, Record<string, number>> = {};
  for (const abilityId of Object.keys(document.abilities).sort()) {
    const row: Record<string, number> = {};
    for (const channel of Object.keys(document.abilities[abilityId]).sort()) {
      row[channel] = document.abilities[abilityId][channel];
    }
    abilities[abilityId] = row;
  }
  return JSON.stringify(abilities);
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

/** Reset every channel of one ability back to the shipped numbers. */
export function resetAbility(form: TuningFormState, abilityId: string): void {
  const row = form[abilityId];
  if (!row) return;
  for (const channel of Object.keys(row)) row[channel] = TUNING_NEUTRAL_FACTOR;
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
