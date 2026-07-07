// Reproduces the live "Fleet Form runs at normal speed" reports (druids, plus a
// restoration shaman with Shadewolf): any talent damage/heal percent triggers the
// effect-scaling pass in abilitiesKnownAt, whose selfBuff/buffTarget arm applied
// Math.round(value * dmgMult + flat) to EVERY aura kind. Kinds whose value is a
// multiplier or a 0..1 fraction are not magnitudes: a restoration mastery's +14%
// healing rounded Fleet Form's 1.4 speed multiplier down to 1 (no speed bonus,
// gone only when the healing mods are respecced away), a balance/elemental
// mastery's spell damage rounded 1.4 up to 2 (double speed), and a combat rogue's
// melee mastery rounded Ghostfoot's 0.5 dodge fraction up to 1 (100% dodge).
// Ratio-valued kinds must pass through talent scaling untouched; flat-magnitude
// buffs (armor, stats) keep scaling as before.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  type TalentAllocation,
} from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const alloc = (over: Partial<TalentAllocation> = {}): TalentAllocation => ({
  ...emptyAllocation(),
  ...over,
});

// Resolve one ability for a class/level/build and return its first buff effect value.
function resolvedBuffValue(
  cls: PlayerClass,
  level: number,
  allocation: TalentAllocation,
  abilityId: string,
): number {
  const known = abilitiesKnownAt(cls, level, computeTalentModifiers(cls, allocation));
  const entry = known.find((k) => k.def.id === abilityId);
  if (!entry) throw new Error(`${abilityId} not known for ${cls} at level ${level}`);
  for (const eff of entry.effects) {
    if (eff.type === 'selfBuff' || eff.type === 'buffTarget') return eff.value;
  }
  throw new Error(`${abilityId} has no selfBuff/buffTarget effect`);
}

describe('talent percent mods leave ratio-valued aura effects untouched', () => {
  it('restoration druid keeps Fleet Form at the 1.4 speed multiplier', () => {
    expect(resolvedBuffValue('druid', 20, alloc({ spec: 'restoration' }), 'travel_form')).toBe(1.4);
  });

  it('restoration shaman keeps Shadewolf at the 1.4 speed multiplier', () => {
    expect(resolvedBuffValue('shaman', 20, alloc({ spec: 'restoration' }), 'ghost_wolf')).toBe(1.4);
  });

  it('balance druid spell damage does not inflate Fleet Form to double speed', () => {
    expect(resolvedBuffValue('druid', 20, alloc({ spec: 'balance' }), 'travel_form')).toBe(1.4);
  });

  it('combat rogue melee damage leaves Swift Heels, Ghostfoot, and stealth untouched', () => {
    const combat = alloc({ spec: 'combat' });
    expect(resolvedBuffValue('rogue', 20, combat, 'sprint')).toBe(1.7);
    expect(resolvedBuffValue('rogue', 20, combat, 'evasion')).toBe(0.5);
    expect(resolvedBuffValue('rogue', 20, combat, 'stealth')).toBe(0.5);
  });

  it('flat-magnitude self-buffs still scale with damage percents (Oakhide armor)', () => {
    const base = resolvedBuffValue('druid', 20, alloc(), 'barkskin');
    expect(resolvedBuffValue('druid', 20, alloc({ spec: 'balance' }), 'barkskin')).toBe(
      Math.round(base * 1.1),
    );
  });

  it('buffPct still strengthens flat buff values (Improved Steadfast Aura)', () => {
    const base = resolvedBuffValue('paladin', 20, alloc(), 'devotion_aura');
    expect(
      resolvedBuffValue(
        'paladin',
        20,
        alloc({ ranks: { pal_imp_devotion_aura: 1 } }),
        'devotion_aura',
      ),
    ).toBe(Math.round(base * 1.2));
  });
});

describe('Sim integration: healing-spec travel forms', () => {
  it('a restoration druid in Fleet Form moves at 1.4x run speed', () => {
    const sim = new Sim({ seed: 11, playerClass: 'druid' });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents(alloc({ spec: 'restoration' }))).toBe(true);
    sim.castAbility('travel_form');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'form_travel')).toBe(true);
    expect(sim.moveSpeedMult(sim.player)).toBeCloseTo(1.4);
  });

  it('a restoration shaman in Shadewolf moves at 1.4x run speed', () => {
    const sim = new Sim({ seed: 11, playerClass: 'shaman' });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents(alloc({ spec: 'restoration' }))).toBe(true);
    sim.castAbility('ghost_wolf');
    // Shadewolf has a 2s cast: advance through it.
    for (let i = 0; i < 60; i++) sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'buff_speed')).toBe(true);
    expect(sim.moveSpeedMult(sim.player)).toBeCloseTo(1.4);
  });
});
