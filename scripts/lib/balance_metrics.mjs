// Pure per-ability balance metrics: the analytical half of the spell-balance
// framework (docs/design/spell-balance-framework.md), extracted from
// scripts/balance_report.mjs so it can be unit tested directly.
//
// Host-agnostic on purpose: the Spell Power scaling functions are INJECTED
// rather than imported, so this module pulls in no TypeScript and a Vitest can
// drive it with stub scaling to assert the arithmetic in isolation.

export const SPELL_CRIT_MULT = 1.5; // sim: a spell crit deals 1.5x

// Effect kinds that make an ability a damage ability for reporting purposes.
export const DAMAGE_EFFECTS = new Set(['directDamage', 'aoeDamage', 'aoeRoot', 'dot', 'drainTick']);

// Classic-era spell crit from Intellect, matching the sim's caster crit curve.
export function spellCritFromInt(int) {
  return Math.min(1, 0.05 + int * 0.0008);
}

// Expected damage multiplier on a hit, given a crit chance.
export function critFactor(crit) {
  return 1 + crit * (SPELL_CRIT_MULT - 1);
}

/**
 * Metrics for ONE known ability at a reference character.
 *
 * `known` is a resolved KnownAbility: its `effects`, `castTime` and `cost` all
 * belong to the RANK the reference character actually knows. That pairing is
 * the load-bearing part. Reading the magnitudes from the resolved rank while
 * reading the price from `def.cost` (the rank-1 price) silently inflates
 * efficiency by the rank-1-to-max-rank cost ratio, which is the defect
 * `tests/balance_metrics.test.ts` pins.
 */
export function analyzeAbility(known, ctx) {
  const def = known.def;
  const { spellPower, rangedPower, int, gcd, scaling } = ctx;
  const factor = critFactor(spellCritFromInt(int));
  const power = def.scalesWith === 'ranged' ? rangedPower : spellPower;

  let directPerCast = 0; // one cast's direct/aoe damage, pre-crit
  let dotDPS = 0; // sustained DoT dps, pre-crit (DoTs do not crit here)
  let channelTotal = 0; // whole-channel damage
  let channelDur = 0;

  for (const eff of known.effects) {
    if (eff.type === 'directDamage') {
      const base = (eff.min + eff.max) / 2;
      if (def.channel) {
        channelTotal += (base + scaling.channelTickBonus(power, def)) * def.channel.ticks;
        channelDur = def.channel.duration;
      } else {
        directPerCast += base + scaling.directHitBonus(power, def, known.castTime, false);
      }
    } else if (eff.type === 'aoeDamage' || eff.type === 'aoeRoot') {
      const base = (eff.min + eff.max) / 2;
      directPerCast += base + scaling.directHitBonus(power, def, known.castTime, true);
    } else if (eff.type === 'drainTick') {
      const perTick = (eff.min + eff.max) / 2 + scaling.channelTickBonus(power, def);
      channelTotal += perTick * (def.channel?.ticks ?? 1);
      channelDur = def.channel?.duration ?? 1;
    } else if (eff.type === 'dot') {
      const ticks = eff.duration / eff.interval;
      const perTick =
        eff.total / ticks + scaling.dotTickBonus(power, def, eff.duration, eff.interval);
      dotDPS += (perTick * ticks) / eff.duration;
    }
  }

  // Effective occupancy: a cooldown-gated nuke is throttled to its cooldown when
  // that exceeds its cast; otherwise the cast time, floored at the GCD.
  const castOcc = Math.max(known.castTime || 0, gcd);
  const effCast = def.cooldown > castOcc ? def.cooldown : castOcc;

  const spamDPS =
    channelDur > 0
      ? (channelTotal * factor) / Math.max(channelDur, effCast) + dotDPS
      : (directPerCast * factor) / effCast + dotDPS;

  const damagePerCast = directPerCast + channelTotal + dotDPS * (channelDur || effCast);
  const dpsPerMana = known.cost > 0 ? damagePerCast / known.cost : Infinity;

  return { spamDPS, dpsPerMana, effCast, cost: known.cost, damagePerCast };
}

// Median of a numeric list (lower-middle element for an even count, matching the
// report's long-standing behavior).
export function medianOf(values) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

// Fractional deviation of a value from a reference, e.g. 0.25 for 25 percent above.
export function deviation(value, reference) {
  return (value - reference) / reference;
}
