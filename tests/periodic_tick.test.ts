// Unit tests for the pure dynamic-DoT/HoT tick math (src/sim/combat/periodic_tick.ts):
// live per-tick recompute off the caster's CURRENT power, haste raising the tick rate
// with a fixed duration, and the per-tick crit chance/multiplier. No Sim: the functions
// read only a handful of combat ratings off the entity, so a minimal stub suffices.

import { describe, expect, it } from 'vitest';
import {
  periodicCritChance,
  periodicCritMult,
  periodicTickAmount,
  periodicTickInterval,
} from '../src/sim/combat/periodic_tick';
import type { Aura, Entity } from '../src/sim/types';

function caster(over: Partial<Entity> = {}): Entity {
  return {
    spellPower: 0,
    rangedPower: 0,
    attackPower: 0,
    spellHaste: 0,
    rangedHaste: 0,
    meleeHaste: 0,
    critChance: 0.05,
    ...over,
  } as unknown as Entity;
}

function dot(over: Partial<Aura> = {}): Aura {
  return {
    id: 'd',
    name: 'd',
    kind: 'dot',
    remaining: 12,
    duration: 12,
    value: 40,
    tickBase: 40,
    tickPowerCoeff: 0.2,
    tickPowerStat: 'spell',
    tickInterval: 3,
    tickTimer: 3,
    sourceId: 1,
    school: 'shadow',
    ...over,
  } as Aura;
}

describe('periodicTickAmount (dynamic recompute)', () => {
  it('adds the caster CURRENT power rider on top of the static base', () => {
    const a = dot({ tickBase: 40, tickPowerCoeff: 0.2 });
    // 40 + round(100 * 0.2) = 60, and it tracks live power the moment it changes.
    expect(periodicTickAmount(a, caster({ spellPower: 0 }))).toBe(40);
    expect(periodicTickAmount(a, caster({ spellPower: 100 }))).toBe(60);
    expect(periodicTickAmount(a, caster({ spellPower: 250 }))).toBe(90);
  });

  it('reads the stat named by tickPowerStat (ranged / melee / spell)', () => {
    const src = caster({ spellPower: 10, rangedPower: 200, attackPower: 500 });
    expect(periodicTickAmount(dot({ tickPowerStat: 'ranged', tickBase: 0 }), src)).toBe(40);
    expect(periodicTickAmount(dot({ tickPowerStat: 'melee', tickBase: 0 }), src)).toBe(100);
    expect(periodicTickAmount(dot({ tickPowerStat: 'spell', tickBase: 0 }), src)).toBe(2);
  });

  it('falls back to the snapshot value for a non-dynamic aura (mob bleed)', () => {
    const a = dot({ tickBase: undefined, tickPowerCoeff: undefined, tickPowerStat: undefined });
    expect(periodicTickAmount(a, caster({ spellPower: 999 }))).toBe(40); // value, unscaled
  });

  it('never scales below 1 and ignores power when the caster has left the world', () => {
    expect(periodicTickAmount(dot(), null)).toBe(40); // no caster: static base only
    expect(periodicTickAmount(dot({ tickBase: 0, tickPowerCoeff: 0 }), caster())).toBe(1);
  });
});

describe('periodicTickInterval (haste raises the tick rate)', () => {
  it('shrinks the interval by (1 + haste), leaving a haste-less caster untouched', () => {
    expect(periodicTickInterval(dot({ tickInterval: 3 }), caster({ spellHaste: 0 }))).toBe(3);
    expect(periodicTickInterval(dot({ tickInterval: 3 }), caster({ spellHaste: 0.5 }))).toBe(2);
    // 30% haste on a 3s interval -> more ticks fit the same fixed duration.
    expect(periodicTickInterval(dot({ tickInterval: 3 }), caster({ spellHaste: 0.2 }))).toBeCloseTo(
      2.5,
      9,
    );
  });

  it('uses the haste rating matching the aura stat, and never hastes a mob source', () => {
    const src = caster({ spellHaste: 1, rangedHaste: 0.25, meleeHaste: 0.5 });
    expect(periodicTickInterval(dot({ tickPowerStat: 'ranged' }), src)).toBeCloseTo(2.4, 9);
    expect(periodicTickInterval(dot({ tickPowerStat: 'melee' }), src)).toBe(2);
    // A mob bleed carries no tickPowerStat, so its cadence is exactly the base.
    expect(periodicTickInterval(dot({ tickPowerStat: undefined }), src)).toBe(3);
  });
});

describe('periodicCritChance / periodicCritMult', () => {
  it('physical bleeds crit off melee crit at 2x; magic dots and hots off spell crit at 1.5x', () => {
    const src = caster({ critChance: 0.3 });
    const spellCrit = (_e: Entity) => 0.15;
    expect(periodicCritChance(dot({ school: 'physical' }), src, spellCrit)).toBe(0.3);
    expect(periodicCritChance(dot({ school: 'shadow' }), src, spellCrit)).toBe(0.15);
    expect(periodicCritMult(dot({ school: 'physical' }))).toBe(2);
    expect(periodicCritMult(dot({ school: 'shadow' }))).toBe(1.5);
    expect(periodicCritMult(dot({ kind: 'hot', school: 'nature' }))).toBe(1.5);
  });

  it('is 0 with no caster in the world', () => {
    expect(periodicCritChance(dot(), null, () => 1)).toBe(0);
  });
});
