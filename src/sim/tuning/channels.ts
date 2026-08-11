// The class power tuner's CHANNEL VOCABULARY: the closed set of power
// dimensions an operator may scale on a single ability, plus the value math
// that turns a slider factor into a tuned number.
//
// A channel is a named aspect of a spell (its direct damage, its damage over
// time, its healing, its threat, its cooldown, ...). Every tunable number in an
// AbilityDef is classified into exactly one channel by the field table in
// `ability_fields.ts`, so the tuner UI can offer "Briarguard: reflect damage per
// hit" without anybody hand-authoring a knob per ability.
//
// Pure leaf: no SimContext, no rng, no clock. Unit-tested directly.

export const TUNING_CHANNELS = [
  'damage_direct',
  'damage_dot',
  'damage_aoe',
  'damage_finisher',
  'damage_reflect',
  'heal_direct',
  'heal_hot',
  'absorb',
  'threat',
  'spell_power',
  'resource_cost',
  'resource_gain',
  'cooldown',
  'cast_time',
  'effect_magnitude',
  'duration_effect',
  'duration_control',
  'radius',
  'range',
  'distance',
  'targets',
  // Auto-attack ("white") swings. These belong to a WEAPON, not an ability:
  // the same closed vocabulary covers both scopes so a document, a slider and
  // an apply step never need to know which one they are looking at.
  'swing_damage',
  'swing_speed',
] as const;

export type TuningChannel = (typeof TUNING_CHANNELS)[number];

const CHANNEL_SET: ReadonlySet<string> = new Set<string>(TUNING_CHANNELS);

export function isTuningChannel(value: unknown): value is TuningChannel {
  return typeof value === 'string' && CHANNEL_SET.has(value);
}

// How a raw authored number responds to a slider factor.
//   linear    the number IS the magnitude (damage, cost, seconds, yards): scale it.
//   deviation the number is a multiplier whose NEUTRAL point is 1 (a snare's 0.5
//             speed multiplier, a threat multiplier of 2, a haste multiplier of
//             1.4). Scaling it directly would be nonsense, so the distance from
//             1 is what moves: 1 + (value - 1) * factor.
//   fraction  the number is a normalized 0..1 share (a heal-on-dispel fraction, a
//             resurrect hp fraction, a proc chance): scale, then clamp to [0, 1]
//             so a maxed slider can never hand out more than the whole.
//   multiplier the number is a plain rate whose neutral is 1 (a weapon-damage
//             multiplier, a spell-power coefficient multiplier): scale it, but
//             never snap it to a whole number the way `linear` does, since a
//             coefficient of 1 must be able to become 1.5.
export type TuningValueKind = 'linear' | 'deviation' | 'fraction' | 'multiplier';

// Slider bounds. 1 is untouched; the floor keeps an ability from being scaled
// into a no-op that reads as a bug, the ceiling keeps a mistyped document from
// minting a one-shot.
export const TUNING_MIN_FACTOR = 0.1;
export const TUNING_MAX_FACTOR = 3;
export const TUNING_FACTOR_STEP = 0.01;
export const TUNING_NEUTRAL_FACTOR = 1;

// Factors are rounded to the slider step before anything reads them, so a
// document written by hand and one written by the dashboard produce the same
// world. Anything unparseable falls back to neutral rather than throwing: a
// corrupt row must never keep a realm from booting.
export function clampTuningFactor(value: unknown): number {
  // Only a number or a numeric string is a factor. Anything else falls back to
  // neutral rather than going through Number(), which would silently turn null,
  // [] and '' into 0 and then clamp them up to the floor: a corrupt row must
  // read as "untouched", never as "scaled to a tenth".
  if (typeof value !== 'number' && typeof value !== 'string') return TUNING_NEUTRAL_FACTOR;
  const raw = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(raw) || (typeof value === 'string' && value.trim() === '')) {
    return TUNING_NEUTRAL_FACTOR;
  }
  const clamped = Math.min(TUNING_MAX_FACTOR, Math.max(TUNING_MIN_FACTOR, raw));
  return roundTo(clamped, 2);
}

export function isNeutralFactor(factor: number): boolean {
  return Math.abs(factor - TUNING_NEUTRAL_FACTOR) < TUNING_FACTOR_STEP / 2;
}

// Deterministic decimal rounding: the same document must produce the same
// numbers on every host, so no raw floating-point tails survive into the world.
function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

const FLOAT_DECIMALS = 4;

/**
 * Whether moving a slider over this number can change anything at all. A zero
 * magnitude stays zero however hard it is scaled, and a multiplier already at
 * its neutral 1 has no deviation to move, so the tuner offers no slider for
 * either: a control that provably does nothing reads as a broken control.
 */
export function isEffectiveTuningSite(base: number, kind: TuningValueKind): boolean {
  if (!Number.isFinite(base)) return false;
  return kind === 'deviation' ? base !== 1 : base !== 0;
}

/**
 * Apply one slider factor to one authored number.
 *
 * A `linear` value whose base is a whole number stays whole (damage rolls,
 * resource costs and stack counts are integers in this engine and reading a
 * fractional one back would be a new bug class); a base that was already
 * fractional keeps four decimals.
 */
export function scaleTuningValue(base: number, factor: number, kind: TuningValueKind): number {
  if (!Number.isFinite(base)) return base;
  if (kind === 'deviation') return roundTo(1 + (base - 1) * factor, FLOAT_DECIMALS);
  const scaled = base * factor;
  if (kind === 'fraction') return roundTo(Math.min(1, Math.max(0, scaled)), FLOAT_DECIMALS);
  if (kind === 'multiplier') return roundTo(scaled, FLOAT_DECIMALS);
  return Number.isInteger(base) ? Math.round(scaled) : roundTo(scaled, FLOAT_DECIMALS);
}
