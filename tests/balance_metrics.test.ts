// Guards the analytical balance metrics behind scripts/balance_report.mjs.
//
// The regression this file exists for: the report resolved every damage
// magnitude from the rank the reference character knows, then divided by
// def.cost, which is the RANK-1 price. Efficiency was inflated by the whole
// rank-1-to-max-rank cost ratio, so the worst-scaling nukes read as the most
// mana-efficient in the game (shaman Arc Bolt reported 6.93 dps per mana on a
// cost of 15 when the rank it was measuring really casts for 60).
import { describe, expect, it } from 'vitest';
import {
  type AnalyzeContext,
  analyzeAbility,
  critFactor,
  deviation,
  type KnownAbilityLike,
  medianOf,
  type ScalingFns,
  spellCritFromInt,
} from '../scripts/lib/balance_metrics.mjs';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { channelTickBonus, directHitBonus, dotTickBonus } from '../src/sim/spell_scaling';
import { GCD, MAX_LEVEL } from '../src/sim/types';

// Zero-scaling stubs isolate the arithmetic from the Spell Power curve.
const NO_SCALING: ScalingFns = {
  directHitBonus: () => 0,
  channelTickBonus: () => 0,
  dotTickBonus: () => 0,
};

const ctx = (over: Partial<AnalyzeContext> = {}): AnalyzeContext => ({
  spellPower: 0,
  rangedPower: 0,
  int: 0,
  gcd: GCD,
  scaling: NO_SCALING,
  ...over,
});

const nuke = (over: Partial<KnownAbilityLike> = {}): KnownAbilityLike => ({
  def: { cooldown: 0 },
  effects: [{ type: 'directDamage', min: 75, max: 85 }],
  castTime: 3,
  cost: 60,
  ...over,
});

describe('efficiency is priced at the rank being measured', () => {
  it('divides damage by the resolved rank cost, not a rank-1 cost', () => {
    // avg 80 damage, no crit (int 0 gives the 5% floor), cost 60.
    const m = analyzeAbility(nuke(), ctx());
    expect(m.cost).toBe(60);
    expect(m.dpsPerMana).toBeCloseTo(80 / 60, 6);
  });

  it('reports a cheaper rank as strictly more efficient at equal damage', () => {
    const expensive = analyzeAbility(nuke({ cost: 60 }), ctx());
    const cheap = analyzeAbility(nuke({ cost: 15 }), ctx());
    expect(cheap.dpsPerMana).toBeGreaterThan(expensive.dpsPerMana);
    // The exact 4x the old def.cost bug introduced for Arc Bolt rank 4.
    expect(cheap.dpsPerMana / expensive.dpsPerMana).toBeCloseTo(4, 6);
  });

  it('ignores the rank-1 cost carried on the def', () => {
    // A def whose rank-1 price is a quarter of the resolved cost must not leak in.
    const withRank1 = nuke();
    (withRank1.def as unknown as { cost: number }).cost = 15;
    expect(analyzeAbility(withRank1, ctx()).dpsPerMana).toBeCloseTo(80 / 60, 6);
  });

  it('treats a free ability as infinitely efficient rather than dividing by zero', () => {
    expect(analyzeAbility(nuke({ cost: 0 }), ctx()).dpsPerMana).toBe(Infinity);
  });
});

describe('occupancy and throughput', () => {
  it('floors a fast cast at the global cooldown', () => {
    const instant = analyzeAbility(nuke({ castTime: 0 }), ctx());
    expect(instant.effCast).toBe(GCD);
  });

  it('throttles a cooldown-gated nuke to its cooldown', () => {
    const gated = analyzeAbility(nuke({ def: { cooldown: 8 } }), ctx());
    expect(gated.effCast).toBe(8);
    // 80 average damage carrying the 5% crit floor (1.025x), spread over 8s.
    expect(gated.spamDPS).toBeCloseTo((80 * 1.025) / 8, 6);
  });

  it('does not let a cooldown shorter than the cast shorten occupancy', () => {
    const m = analyzeAbility(nuke({ def: { cooldown: 1 } }), ctx());
    expect(m.effCast).toBe(3);
  });

  it('spreads a damage-over-time effect across its duration', () => {
    const dot = analyzeAbility(
      nuke({
        effects: [{ type: 'dot', total: 60, duration: 12, interval: 3 }],
        castTime: 0,
      }),
      ctx(),
    );
    expect(dot.spamDPS).toBeCloseTo(5, 6); // 60 damage over 12 seconds
  });

  it('amortizes a channel over its duration, not the global cooldown', () => {
    const channelled = analyzeAbility(
      nuke({
        def: { cooldown: 0, channel: { duration: 5, ticks: 5 } },
        effects: [{ type: 'directDamage', min: 20, max: 20 }],
        castTime: 5,
      }),
      ctx(),
    );
    // 5 ticks of 20 over 5 seconds, with the 5% crit floor on the ticks.
    expect(channelled.spamDPS).toBeCloseTo((100 * 1.025) / 5, 6);
  });

  it('does not crit a damage-over-time effect the way it crits a direct hit', () => {
    const overTime = analyzeAbility(
      nuke({ effects: [{ type: 'dot', total: 60, duration: 12, interval: 3 }], castTime: 0 }),
      ctx({ int: 1000 }), // a crit chance that would be obvious if it applied
    );
    expect(overTime.spamDPS).toBeCloseTo(5, 6);
  });

  it('applies the area penalty through the injected scaling, not the direct path', () => {
    const seen: boolean[] = [];
    const spy: ScalingFns = {
      ...NO_SCALING,
      directHitBonus: (_p, _d, _c, aoe) => {
        seen.push(aoe);
        return 0;
      },
    };
    analyzeAbility(
      nuke({ effects: [{ type: 'aoeDamage', min: 10, max: 10 }] }),
      ctx({ scaling: spy }),
    );
    expect(seen).toEqual([true]);
  });

  it('scales a ranged attack off ranged power rather than spell power', () => {
    const powers: number[] = [];
    const spy: ScalingFns = {
      ...NO_SCALING,
      directHitBonus: (p) => {
        powers.push(p);
        return 0;
      },
    };
    analyzeAbility(
      nuke({ def: { cooldown: 0, scalesWith: 'ranged' } }),
      ctx({ spellPower: 100, rangedPower: 7, scaling: spy }),
    );
    expect(powers).toEqual([7]);
  });
});

describe('crit curve', () => {
  it('starts at the 5 percent floor and rises with Intellect', () => {
    expect(spellCritFromInt(0)).toBeCloseTo(0.05, 6);
    expect(spellCritFromInt(56)).toBeCloseTo(0.0948, 6);
  });

  it('caps at 100 percent', () => {
    expect(spellCritFromInt(100_000)).toBe(1);
  });

  it('turns crit chance into the expected 1.5x hit multiplier', () => {
    expect(critFactor(0)).toBe(1);
    expect(critFactor(1)).toBeCloseTo(1.5, 6);
  });
});

describe('summary helpers', () => {
  it('takes the middle value regardless of input order', () => {
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([3, 1, 5])).toBe(3);
  });

  it('reports deviation as a signed fraction of the reference', () => {
    expect(deviation(12, 10)).toBeCloseTo(0.2, 6);
    expect(deviation(8, 10)).toBeCloseTo(-0.2, 6);
  });
});

describe('against the real content tables', () => {
  it('prices shaman Arc Bolt at the level 20 rank, four times its rank-1 cost', () => {
    const known = abilitiesKnownAt('shaman', MAX_LEVEL).find((a) => a.def.id === 'lightning_bolt');
    if (!known) throw new Error('shaman is missing lightning_bolt');

    // The trap: the def still carries the rank-1 price the old code divided by.
    expect(ABILITIES.lightning_bolt.cost).toBe(15);
    expect(known.cost).toBe(60);

    const m = analyzeAbility(known as unknown as KnownAbilityLike, {
      spellPower: 28,
      rangedPower: 0,
      int: 56,
      gcd: GCD,
      scaling: { directHitBonus, channelTickBonus, dotTickBonus } as unknown as ScalingFns,
    });

    // Throughput is unchanged by the fix; only the price moved.
    expect(m.spamDPS).toBeCloseTo(36.3, 1);
    expect(m.dpsPerMana).toBeCloseTo(1.73, 2);
    // The number the old code printed, which must never come back.
    expect(m.dpsPerMana).not.toBeCloseTo(6.93, 1);
  });
});
