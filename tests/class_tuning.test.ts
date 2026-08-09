// The class power tuner's pure core: channel math, the ability walker, the
// document sanitizer, and the install/restore round trip.
// Paired module: src/sim/tuning/ (see its index.ts for the feature summary).

import { afterEach, describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { abilityPowerCoeffMult, directHitBonus } from '../src/sim/spell_scaling';
import {
  abilityTuningChannels,
  abilityTuningKnobs,
  applyAbilityTuning,
  applyClassTuning,
  clampTuningFactor,
  classTuningDocumentKey,
  countTunedChannels,
  emptyClassTuningDocument,
  installClassTuning,
  installedTunedAbilityIds,
  isEffectiveTuningSite,
  isNeutralFactor,
  sanitizeClassTuningDocument,
  scaleTuningValue,
  TUNING_CHANNELS,
  TUNING_MAX_FACTOR,
  TUNING_MIN_FACTOR,
} from '../src/sim/tuning';
import type { AbilityDef } from '../src/sim/types';

function def(partial: Partial<AbilityDef>): AbilityDef {
  return {
    id: 'probe',
    name: 'Probe',
    class: 'mage',
    cost: 20,
    castTime: 0,
    cooldown: 0,
    range: 30,
    school: 'fire',
    requiresTarget: true,
    learnLevel: 1,
    effects: [],
    description: '',
    ...partial,
  };
}

afterEach(() => {
  // Every install mutates the process-wide ability table; restore the shipped
  // one so an ordering change cannot leak a tuned def into another suite.
  installClassTuning(emptyClassTuningDocument());
});

describe('tuning channel math', () => {
  it('scales a linear magnitude and keeps a whole number whole', () => {
    expect(scaleTuningValue(100, 1.25, 'linear')).toBe(125);
    expect(scaleTuningValue(9, 1.2, 'linear')).toBe(11); // 10.8 rounds, stays an integer
    expect(scaleTuningValue(1.5, 2, 'linear')).toBe(3);
    expect(scaleTuningValue(2.5, 1.1, 'linear')).toBe(2.75); // fractional base keeps decimals
  });

  it('moves a multiplier by its DEVIATION from 1, not by the number itself', () => {
    // a 50% snare buffed 20% must slow HARDER (0.4), not become a 0.6 speed-up
    expect(scaleTuningValue(0.5, 1.2, 'deviation')).toBe(0.4);
    // a 2x threat multiplier buffed 20% becomes 2.2, not 2.4
    expect(scaleTuningValue(2, 1.2, 'deviation')).toBe(2.2);
    // a neutral multiplier stays neutral at any factor
    expect(scaleTuningValue(1, TUNING_MAX_FACTOR, 'deviation')).toBe(1);
  });

  it('clamps a fraction to the whole, so a maxed slider cannot exceed 100%', () => {
    expect(scaleTuningValue(0.3, 2, 'fraction')).toBe(0.6);
    expect(scaleTuningValue(0.5, 3, 'fraction')).toBe(1);
    expect(scaleTuningValue(0.5, 0.1, 'fraction')).toBe(0.05);
  });

  it('clamps and rounds a factor, and falls back to neutral on junk', () => {
    expect(clampTuningFactor(1.234)).toBe(1.23);
    expect(clampTuningFactor(99)).toBe(TUNING_MAX_FACTOR);
    expect(clampTuningFactor(-4)).toBe(TUNING_MIN_FACTOR);
    expect(clampTuningFactor(Number.NaN)).toBe(1);
    expect(clampTuningFactor('nonsense')).toBe(1);
    expect(clampTuningFactor(null)).toBe(1);
    expect(isNeutralFactor(1)).toBe(true);
    expect(isNeutralFactor(1.02)).toBe(false);
  });

  it('reports a slider that provably cannot move anything as ineffective', () => {
    expect(isEffectiveTuningSite(0, 'linear')).toBe(false);
    expect(isEffectiveTuningSite(1, 'deviation')).toBe(false);
    expect(isEffectiveTuningSite(1, 'linear')).toBe(true);
    expect(isEffectiveTuningSite(0.5, 'deviation')).toBe(true);
  });
});

describe('ability knob derivation', () => {
  it('routes a thorns aura value to the reflect-damage channel, across every rank', () => {
    const knobs = abilityTuningKnobs(ABILITIES.thorns).filter(
      (knob) => knob.channel === 'damage_reflect',
    );
    expect(knobs.map((knob) => knob.value)).toEqual([3, 6, 9]);
    expect(knobs.map((knob) => knob.path)).toEqual([
      'effects[0].buffTarget.value',
      'ranks[0].effects[0].buffTarget.value',
      'ranks[1].effects[0].buffTarget.value',
    ]);
  });

  it('separates a hybrid nuke plus DoT into distinct damage channels', () => {
    const channels = abilityTuningChannels(ABILITIES.moonfire);
    expect(channels).toContain('damage_direct');
    expect(channels).toContain('damage_dot');
    expect(channels).toContain('duration_effect');
    // A DoT's tick cadence is not a power lever, so it is never a knob.
    expect(abilityTuningKnobs(ABILITIES.moonfire).some((k) => k.path.endsWith('.interval'))).toBe(
      false,
    );
  });

  it('offers spell power only where something actually scales with power', () => {
    const scaling = def({ effects: [{ type: 'directDamage', min: 10, max: 20 }] });
    const inert = def({ effects: [{ type: 'taunt' }] });
    expect(abilityTuningChannels(scaling)).toContain('spell_power');
    expect(abilityTuningChannels(inert)).not.toContain('spell_power');
  });

  it('drops sliders that cannot move anything but keeps them for the raw walk', () => {
    const instant = def({ cooldown: 0, castTime: 0 });
    expect(abilityTuningChannels(instant)).not.toContain('cooldown');
    expect(
      abilityTuningKnobs(instant, { includeInert: true }).some((k) => k.channel === 'cooldown'),
    ).toBe(true);
  });

  it('walks nested and array-shaped effect fields', () => {
    const cone = def({
      effects: [
        {
          type: 'empoweredCone',
          angle: 60,
          stages: [
            { range: 10, min: 20, max: 30 },
            { range: 20, min: 40, max: 60 },
          ],
        },
      ],
    });
    // one field at a time across every stage: mins first, then maxes
    const damage = abilityTuningKnobs(cone).filter((k) => k.channel === 'damage_aoe');
    expect(damage.map((k) => k.value)).toEqual([20, 40, 30, 60]);
    const ranges = abilityTuningKnobs(cone).filter((k) => k.channel === 'range');
    expect(ranges.map((k) => k.path)).toContain('effects[0].empoweredCone.stages.0.range');
  });

  it('never offers a slider for a marker aura', () => {
    const stance = def({
      effects: [{ type: 'selfBuff', kind: 'battle_stance', value: 0, duration: 60 }],
    });
    expect(abilityTuningKnobs(stance).some((k) => k.path.endsWith('selfBuff.value'))).toBe(false);
  });
});

describe('applying tuning to one ability', () => {
  it('produces a tuned clone and leaves the shipped def untouched', () => {
    const shipped = ABILITIES.thorns;
    const before = JSON.stringify(shipped);
    const tuned = applyAbilityTuning(shipped, { damage_reflect: 2 });
    expect(tuned).not.toBe(shipped);
    expect(JSON.stringify(shipped)).toBe(before);
    expect((tuned.effects[0] as { value: number }).value).toBe(6);
    const ranks = tuned.ranks ?? [];
    expect((ranks[1].effects[0] as { value: number }).value).toBe(18);
    // an untouched channel keeps its authored number
    expect(tuned.cost).toBe(shipped.cost);
  });

  it('returns the same def object when nothing moves', () => {
    expect(applyAbilityTuning(ABILITIES.thorns, {})).toBe(ABILITIES.thorns);
    expect(applyAbilityTuning(ABILITIES.thorns, { damage_reflect: 1 })).toBe(ABILITIES.thorns);
    // a channel this ability does not expose changes nothing
    expect(applyAbilityTuning(ABILITIES.thorns, { damage_finisher: 2 })).toBe(ABILITIES.thorns);
  });

  it('moves each aspect independently: threat without damage, cooldown without cost', () => {
    const probe = def({
      cost: 30,
      cooldown: 10,
      threat: { flat: 100, mult: 2 },
      effects: [{ type: 'directDamage', min: 10, max: 20 }],
    });
    const tuned = applyAbilityTuning(probe, { threat: 1.5, cooldown: 0.5 });
    expect(tuned.threat).toEqual({ flat: 150, mult: 2.5 });
    expect(tuned.cooldown).toBe(5);
    expect(tuned.cost).toBe(30);
    expect(tuned.effects[0]).toEqual({ type: 'directDamage', min: 10, max: 20 });
  });

  it('scales the spell power coefficient through the shared scaling helper', () => {
    const probe = def({ castTime: 3.5, effects: [{ type: 'directDamage', min: 10, max: 20 }] });
    const base = directHitBonus(400, probe, probe.castTime);
    const tuned = applyAbilityTuning(probe, { spell_power: 1.5 });
    expect(abilityPowerCoeffMult(tuned)).toBe(1.5);
    expect(directHitBonus(400, tuned, tuned.castTime)).toBe(Math.round(base * 1.5));
  });
});

describe('the tuning document', () => {
  it('keeps well-formed rows and drops everything it cannot trust', () => {
    const doc = sanitizeClassTuningDocument({
      version: 1,
      abilities: {
        thorns: { damage_reflect: 1.5, not_a_channel: 2, cooldown: 'junk' },
        'Bad Id!': { cooldown: 2 },
        rip: { damage_dot: 1 }, // neutral: dropped, so the ability drops out too
        moonfire: { damage_direct: 500 }, // clamped to the ceiling
      },
    });
    expect(doc.abilities.thorns).toEqual({ damage_reflect: 1.5 });
    expect(doc.abilities['Bad Id!']).toBeUndefined();
    expect(doc.abilities.rip).toBeUndefined();
    expect(doc.abilities.moonfire).toEqual({ damage_direct: TUNING_MAX_FACTOR });
    expect(countTunedChannels(doc)).toBe(2);
  });

  it('returns an empty document for junk rather than throwing', () => {
    for (const junk of [null, undefined, 42, 'x', [], { abilities: 7 }]) {
      expect(sanitizeClassTuningDocument(junk).abilities).toEqual({});
    }
  });

  it('serializes stably regardless of key order, so an unchanged save is detectable', () => {
    const a = sanitizeClassTuningDocument({
      abilities: { thorns: { cooldown: 1.5, damage_reflect: 2 } },
    });
    const b = sanitizeClassTuningDocument({
      abilities: { thorns: { damage_reflect: 2, cooldown: 1.5 } },
    });
    expect(classTuningDocumentKey(a)).toBe(classTuningDocumentKey(b));
  });

  it('every channel in the vocabulary survives a sanitize round trip', () => {
    const abilities: Record<string, Record<string, number>> = { probe: {} };
    for (const channel of TUNING_CHANNELS) abilities.probe[channel] = 1.5;
    const doc = sanitizeClassTuningDocument({ abilities });
    expect(Object.keys(doc.abilities.probe).sort()).toEqual([...TUNING_CHANNELS].sort());
  });
});

describe('applying a document to the ability table', () => {
  it('tunes only the named abilities and keeps the rest by reference', () => {
    const doc = sanitizeClassTuningDocument({ abilities: { thorns: { damage_reflect: 2 } } });
    const tuned = applyClassTuning(ABILITIES, doc);
    expect(tuned.thorns).not.toBe(ABILITIES.thorns);
    expect(tuned.rip).toBe(ABILITIES.rip);
    expect(ABILITIES.thorns.effects[0]).toEqual({
      type: 'buffTarget',
      kind: 'thorns',
      value: 3,
      duration: 600,
    });
  });

  it('ignores an ability id that no longer exists', () => {
    const doc = sanitizeClassTuningDocument({ abilities: { retired_spell: { cooldown: 2 } } });
    expect(() => applyClassTuning(ABILITIES, doc)).not.toThrow();
  });
});

describe('installing onto the shared ability table', () => {
  it('replaces the def in place and restores it exactly when cleared', () => {
    const shipped = ABILITIES.thorns;
    installClassTuning({ abilities: { thorns: { damage_reflect: 3 } } });
    expect(ABILITIES.thorns).not.toBe(shipped);
    expect((ABILITIES.thorns.effects[0] as { value: number }).value).toBe(9);
    expect(installedTunedAbilityIds()).toEqual(['thorns']);

    installClassTuning(emptyClassTuningDocument());
    expect(ABILITIES.thorns).toBe(shipped);
    expect(installedTunedAbilityIds()).toEqual([]);
  });

  it('never compounds: re-installing starts from the shipped numbers', () => {
    installClassTuning({ abilities: { thorns: { damage_reflect: 2 } } });
    installClassTuning({ abilities: { thorns: { damage_reflect: 2 } } });
    expect((ABILITIES.thorns.effects[0] as { value: number }).value).toBe(6);
  });

  it('drops an ability from the install when its document row goes away', () => {
    const shipped = ABILITIES.rip;
    installClassTuning({ abilities: { thorns: { damage_reflect: 2 }, rip: { damage_dot: 2 } } });
    expect(installedTunedAbilityIds()).toEqual(['rip', 'thorns']);
    installClassTuning({ abilities: { thorns: { damage_reflect: 2 } } });
    expect(installedTunedAbilityIds()).toEqual(['thorns']);
    expect(ABILITIES.rip).toBe(shipped);
  });

  it('is deterministic: the same document always yields the same numbers', () => {
    const doc = { abilities: { moonfire: { damage_direct: 1.37, damage_dot: 0.66 } } };
    installClassTuning(doc);
    const first = JSON.stringify(ABILITIES.moonfire);
    installClassTuning(emptyClassTuningDocument());
    installClassTuning(doc);
    expect(JSON.stringify(ABILITIES.moonfire)).toBe(first);
  });
});
