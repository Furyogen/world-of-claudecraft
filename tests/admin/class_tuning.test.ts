// The Class Power Tuner's admin-side view model, plus the two things that keep
// the dashboard honest about a surface it derives from the sim without being
// allowed to import it:
//
//   - the local value math is byte-equivalent to the sim's `scaleTuningValue`
//   - every channel and ability source in the sim's closed vocabularies has an
//     admin i18n label (the page builds those keys dynamically, so the admin
//     catalog's literal-key scan cannot see them)
//
// Node environment: this file tests plain helpers, no DOM.

import { describe, expect, it } from 'vitest';
import {
  buildTuningDocument,
  channelPreview,
  clampFactor,
  EMPTY_ABILITY_FILTER,
  factorDeltaPercent,
  filterAbilities,
  isNeutral,
  resetAbility,
  scaleTunedValue,
  TUNING_MAX_FACTOR,
  TUNING_MIN_FACTOR,
  tunedAbilityCount,
  tunedChannelCount,
  tuningDocumentKey,
  tuningFormState,
} from '../../src/admin/class_tuning';
import { en as adminEn } from '../../src/admin/i18n.en';
import type { ClassTuningCatalog, TunerClassInfo } from '../../src/admin/types';
import { buildClassTuningCatalog, TUNING_CHANNELS } from '../../src/sim/tuning';
import {
  scaleTuningValue as simScaleTuningValue,
  type TuningValueKind,
} from '../../src/sim/tuning/channels';

const CLASS: TunerClassInfo = {
  id: 'druid',
  name: 'Druid',
  specs: [
    { id: 'balance', name: 'Balance', role: 'dps' },
    { id: 'feral', name: 'Feral', role: 'dps' },
    { id: 'restoration', name: 'Restoration', role: 'healer' },
  ],
  abilities: [
    {
      id: 'thorns',
      name: 'Briarguard',
      class: 'druid',
      school: 'nature',
      learnLevel: 6,
      specs: ['balance', 'feral', 'restoration'],
      source: 'base',
      passive: false,
      ranks: 3,
      channels: [
        {
          channel: 'damage_reflect',
          sites: [
            { path: 'effects[0].buffTarget.value', value: 3, kind: 'linear' },
            { path: 'ranks[0].effects[0].buffTarget.value', value: 6, kind: 'linear' },
            { path: 'ranks[1].effects[0].buffTarget.value', value: 9, kind: 'linear' },
          ],
        },
        {
          channel: 'resource_cost',
          sites: [{ path: 'cost', value: 20, kind: 'linear' }],
        },
      ],
    },
    {
      id: 'swiftmend',
      name: 'Swiftmend',
      class: 'druid',
      school: 'nature',
      learnLevel: 20,
      specs: ['restoration'],
      source: 'signature',
      passive: false,
      ranks: 1,
      channels: [{ channel: 'heal_direct', sites: [{ path: 'x', value: 100, kind: 'linear' }] }],
    },
  ],
};

const CATALOG: ClassTuningCatalog = { classes: [CLASS] };

describe('slider state', () => {
  it('seeds every channel of every ability at neutral', () => {
    const form = tuningFormState(CATALOG, null);
    expect(form.thorns).toEqual({ damage_reflect: 1, resource_cost: 1 });
    expect(form.swiftmend).toEqual({ heal_direct: 1 });
  });

  it('lays a saved document over the neutral baseline', () => {
    const form = tuningFormState(CATALOG, {
      version: 1,
      abilities: { thorns: { damage_reflect: 0.8 } },
    });
    expect(form.thorns.damage_reflect).toBe(0.8);
    expect(form.thorns.resource_cost).toBe(1);
  });

  it('drops a saved channel the catalog no longer exposes', () => {
    // A retired effect must not leave an invisible factor that a later save
    // would silently re-post against an ability that cannot use it.
    const form = tuningFormState(CATALOG, {
      version: 1,
      abilities: { thorns: { damage_finisher: 2 }, retired_spell: { cooldown: 2 } },
    });
    expect(form.thorns.damage_finisher).toBeUndefined();
    expect(form.retired_spell).toBeUndefined();
  });

  it('clamps a stored factor outside the slider range', () => {
    const form = tuningFormState(CATALOG, {
      version: 1,
      abilities: { thorns: { damage_reflect: 99, resource_cost: -5 } },
    });
    expect(form.thorns.damage_reflect).toBe(TUNING_MAX_FACTOR);
    expect(form.thorns.resource_cost).toBe(TUNING_MIN_FACTOR);
  });
});

describe('the document the page posts', () => {
  it('is sparse: neutral channels and untouched abilities are omitted', () => {
    const form = tuningFormState(CATALOG, null);
    form.thorns.damage_reflect = 1.5;
    const doc = buildTuningDocument(form);
    expect(doc).toEqual({ version: 1, abilities: { thorns: { damage_reflect: 1.5 } } });
  });

  it('is empty when nothing has moved', () => {
    expect(buildTuningDocument(tuningFormState(CATALOG, null)).abilities).toEqual({});
  });

  it('round-trips a saved document unchanged, so opening the page is not a diff', () => {
    const saved = {
      version: 1,
      abilities: { thorns: { damage_reflect: 0.75, resource_cost: 1.2 } },
    };
    const form = tuningFormState(CATALOG, saved);
    expect(tuningDocumentKey(buildTuningDocument(form))).toBe(tuningDocumentKey(saved));
  });

  it('serializes stably regardless of key order', () => {
    const a = { version: 1, abilities: { thorns: { damage_reflect: 2, resource_cost: 1.5 } } };
    const b = { version: 1, abilities: { thorns: { resource_cost: 1.5, damage_reflect: 2 } } };
    expect(tuningDocumentKey(a)).toBe(tuningDocumentKey(b));
  });
});

describe('counting and resetting', () => {
  it('counts only the channels off neutral', () => {
    const form = tuningFormState(CATALOG, null);
    expect(tunedChannelCount(form, 'thorns')).toBe(0);
    form.thorns.damage_reflect = 1.5;
    form.thorns.resource_cost = 0.5;
    expect(tunedChannelCount(form, 'thorns')).toBe(2);
    expect(tunedAbilityCount(form, CLASS)).toBe(1);
  });

  it('resets one ability without touching the others', () => {
    const form = tuningFormState(CATALOG, null);
    form.thorns.damage_reflect = 2;
    form.swiftmend.heal_direct = 2;
    resetAbility(form, 'thorns');
    expect(form.thorns.damage_reflect).toBe(1);
    expect(form.swiftmend.heal_direct).toBe(2);
  });

  it('treats a factor within half a step of 1 as neutral', () => {
    expect(isNeutral(1)).toBe(true);
    expect(isNeutral(1.004)).toBe(true);
    expect(isNeutral(1.01)).toBe(false);
    expect(clampFactor(Number.NaN)).toBe(1);
  });
});

describe('filtering a class window', () => {
  const form = tuningFormState(CATALOG, null);

  it('shows every ability with no filter', () => {
    expect(filterAbilities(CLASS, EMPTY_ABILITY_FILTER, form).map((a) => a.id)).toEqual([
      'thorns',
      'swiftmend',
    ]);
  });

  it('narrows to one spec', () => {
    const ids = filterAbilities(CLASS, { ...EMPTY_ABILITY_FILTER, spec: 'balance' }, form).map(
      (a) => a.id,
    );
    expect(ids).toEqual(['thorns']);
  });

  it('matches on name and on id, case-insensitively', () => {
    expect(
      filterAbilities(CLASS, { ...EMPTY_ABILITY_FILTER, search: 'briar' }, form).map((a) => a.id),
    ).toEqual(['thorns']);
    expect(
      filterAbilities(CLASS, { ...EMPTY_ABILITY_FILTER, search: 'SWIFTMEND' }, form).map(
        (a) => a.id,
      ),
    ).toEqual(['swiftmend']);
    expect(filterAbilities(CLASS, { ...EMPTY_ABILITY_FILTER, search: 'zzz' }, form)).toEqual([]);
  });

  it('narrows to the tuned abilities only', () => {
    const tuned = tuningFormState(CATALOG, null);
    tuned.swiftmend.heal_direct = 1.5;
    const ids = filterAbilities(CLASS, { ...EMPTY_ABILITY_FILTER, onlyTuned: true }, tuned).map(
      (a) => a.id,
    );
    expect(ids).toEqual(['swiftmend']);
  });
});

describe('the before/after readout', () => {
  it('shows the shipped numbers and what the slider makes them', () => {
    const preview = channelPreview(CLASS.abilities[0].channels[0], 2);
    expect(preview.base).toEqual([3, 6, 9]);
    expect(preview.tuned).toEqual([6, 12, 18]);
    expect(preview.unchanged).toBe(false);
  });

  it('reports an unmoved slider as unchanged', () => {
    expect(channelPreview(CLASS.abilities[0].channels[0], 1).unchanged).toBe(true);
  });

  it('dedupes repeated values and caps the readout', () => {
    const preview = channelPreview(
      {
        channel: 'damage_direct',
        sites: [
          { path: 'a', value: 5, kind: 'linear' },
          { path: 'b', value: 5, kind: 'linear' },
          { path: 'c', value: 7, kind: 'linear' },
        ],
      },
      1.5,
      2,
    );
    expect(preview.base).toEqual([5, 7]);
  });

  it('renders the factor as a signed percentage', () => {
    expect(factorDeltaPercent(1.35)).toBe(35);
    expect(factorDeltaPercent(0.8)).toBe(-20);
    expect(factorDeltaPercent(1)).toBe(0);
  });
});

// The dashboard cannot import src/sim, so its copy of the value math would be
// free to drift. Pin it instead, the way permissions.ts is pinned.
describe('the local value math mirrors the sim', () => {
  const kinds: TuningValueKind[] = ['linear', 'deviation', 'fraction', 'multiplier'];
  const bases = [0, 0.25, 0.5, 1, 1.4, 2, 3, 9, 12.5, 100, 168, -20];
  const factors = [0.1, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

  it('agrees on every kind, base and factor', () => {
    for (const kind of kinds) {
      for (const base of bases) {
        for (const factor of factors) {
          expect(scaleTunedValue(base, factor, kind), `${kind} base=${base} factor=${factor}`).toBe(
            simScaleTuningValue(base, factor, kind),
          );
        }
      }
    }
  });
});

// The page builds these keys from the id (`tuning.channel.${channel}`), which
// the admin catalog's literal-key scan cannot see. Pin them against the live
// vocabulary so a new channel cannot ship a blank label.
describe('every vocabulary value has an admin label', () => {
  it('labels every tuning channel', () => {
    for (const channel of TUNING_CHANNELS) {
      const key = `tuning.channel.${channel}`;
      expect(adminEn[key as keyof typeof adminEn], key).toBeTruthy();
    }
  });

  it('labels every ability source the catalog can emit', () => {
    const sources = new Set(
      buildClassTuningCatalog().classes.flatMap((entry) =>
        entry.abilities.map((ability) => ability.source),
      ),
    );
    expect(sources.size).toBeGreaterThan(1);
    const keys: Record<string, string> = {
      base: 'tuning.sourceBase',
      spec: 'tuning.sourceSpec',
      signature: 'tuning.sourceSignature',
      row: 'tuning.sourceRow',
      unspecced: 'tuning.sourceUnspecced',
    };
    for (const source of sources) {
      const key = keys[source];
      expect(key, `no label key for source ${source}`).toBeTruthy();
      expect(adminEn[key as keyof typeof adminEn], key).toBeTruthy();
    }
  });
});
