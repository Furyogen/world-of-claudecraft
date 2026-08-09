// The class power tuning DOCUMENT: the sparse, per-realm record of which
// ability channels an operator has moved off neutral, plus the one validator
// every write and every load runs through.
//
// The document is the only thing persisted. It is sparse on purpose: an
// untouched channel carries no row, so a realm that has never been tuned stores
// `{}` and the apply path is a no-op that returns the shipped ability table
// unchanged.
//
// Pure leaf: no SimContext, no rng, no clock, no IO.

import {
  clampTuningFactor,
  isNeutralFactor,
  isTuningChannel,
  type TuningChannel,
} from './channels';

export const CLASS_TUNING_VERSION = 1;

export type AbilityTuning = Partial<Record<TuningChannel, number>>;

export interface ClassTuningDocument {
  version: number;
  /** ability id -> the channels moved off neutral for it */
  abilities: Record<string, AbilityTuning>;
}

// Bounds on a stored document. Both are far above any real tuning pass; they
// exist so a malformed or hostile body cannot grow the realm's JSONB row
// without limit.
export const MAX_TUNED_ABILITIES = 2000;
const ABILITY_ID_PATTERN = /^[a-z0-9_]{1,64}$/;

export function emptyClassTuningDocument(): ClassTuningDocument {
  return { version: CLASS_TUNING_VERSION, abilities: {} };
}

export function isEmptyClassTuningDocument(doc: ClassTuningDocument): boolean {
  return Object.keys(doc.abilities).length === 0;
}

/**
 * Normalize any untrusted value into a document the apply path can run.
 *
 * Never throws and never rejects the whole document over one bad row: an
 * unknown channel, an unparseable factor, or a malformed ability id is dropped
 * and the rest is kept. A stored document that has rotted (an ability retired
 * since it was written) must not be able to keep a realm from booting, and a
 * dashboard save must not be able to smuggle an unbounded blob into Postgres.
 *
 * Neutral factors are dropped rather than stored, so "has this ability been
 * tuned" is answerable by key presence alone.
 */
export function sanitizeClassTuningDocument(input: unknown): ClassTuningDocument {
  const doc = emptyClassTuningDocument();
  const root = asRecord(input);
  if (!root) return doc;

  const abilities = asRecord(root.abilities);
  if (!abilities) return doc;

  let kept = 0;
  for (const abilityId of Object.keys(abilities).sort()) {
    if (kept >= MAX_TUNED_ABILITIES) break;
    if (!ABILITY_ID_PATTERN.test(abilityId)) continue;
    const channels = asRecord(abilities[abilityId]);
    if (!channels) continue;

    const tuning: AbilityTuning = {};
    let any = false;
    for (const channel of Object.keys(channels).sort()) {
      if (!isTuningChannel(channel)) continue;
      const raw = channels[channel];
      if (typeof raw !== 'number' && typeof raw !== 'string') continue;
      const factor = clampTuningFactor(raw);
      if (isNeutralFactor(factor)) continue;
      tuning[channel] = factor;
      any = true;
    }
    if (!any) continue;
    doc.abilities[abilityId] = tuning;
    kept++;
  }
  return doc;
}

/** Stable serialization, so an unchanged save is detectable as unchanged. */
export function classTuningDocumentKey(doc: ClassTuningDocument): string {
  const abilities: Record<string, AbilityTuning> = {};
  for (const abilityId of Object.keys(doc.abilities).sort()) {
    const tuning = doc.abilities[abilityId];
    const ordered: AbilityTuning = {};
    for (const channel of Object.keys(tuning).sort() as TuningChannel[]) {
      ordered[channel] = tuning[channel];
    }
    abilities[abilityId] = ordered;
  }
  return JSON.stringify({ version: doc.version, abilities });
}

/** How many individual channel knobs the document moves. */
export function countTunedChannels(doc: ClassTuningDocument): number {
  let total = 0;
  for (const tuning of Object.values(doc.abilities)) total += Object.keys(tuning).length;
  return total;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
