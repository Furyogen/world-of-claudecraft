// Skills Manager config core: the per-ability tracking selection, its
// localStorage round trip, and the "can this ability be tracked" predicate.
//
// These are the decisions the manager's two per-row buttons make, kept pure so
// they are provable without a DOM: a copy-on-write config, a tolerant parse that
// can never break the HUD on a corrupt blob, a serializer that keeps a player's
// chosen type across an off/on cycle, and a trackability rule that never offers a
// switch which could not light up.

import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import type { AbilityDef } from '../src/sim/types';
import {
  DEFAULT_SKILL_TRACKER_ENTRY,
  isSkillTrackerEnabled,
  isTrackableAbility,
  nextSkillTrackerDisplay,
  parseSkillTrackerConfig,
  SKILL_TRACKER_DISPLAYS,
  type SkillTrackerConfig,
  serializeSkillTrackerConfig,
  setSkillTrackerDisplay,
  setSkillTrackerEnabled,
  skillTrackerDisplayOf,
  skillTrackerEntry,
  skillTrackerStorageKey,
} from '../src/ui/skill_tracker_core';

describe('skill_tracker_core: the per-ability selection model', () => {
  it('defaults an unseen ability to off, square', () => {
    expect(skillTrackerEntry({}, 'rejuvenation')).toEqual({ enabled: false, display: 'square' });
    expect(DEFAULT_SKILL_TRACKER_ENTRY).toEqual({ enabled: false, display: 'square' });
  });

  it('never hands back the stored object, so a caller cannot mutate the config', () => {
    const config: SkillTrackerConfig = { rejuvenation: { enabled: true, display: 'bar' } };
    const read = skillTrackerEntry(config, 'rejuvenation');
    expect(read).not.toBe(config.rejuvenation);
    read.enabled = false;
    expect(config.rejuvenation.enabled).toBe(true);
  });

  it('sets enabled copy-on-write, leaving the input config untouched', () => {
    const before: SkillTrackerConfig = {};
    const after = setSkillTrackerEnabled(before, 'moonfire', true);
    expect(after).not.toBe(before);
    expect(before).toEqual({});
    expect(after.moonfire).toEqual({ enabled: true, display: 'square' });
  });

  it('keeps the chosen display when enabled flips, and the enabled flag when the display cycles', () => {
    // The two manager buttons are independent: neither implies the other.
    let config = setSkillTrackerDisplay({}, 'rejuvenation', 'bar');
    expect(config.rejuvenation).toEqual({ enabled: false, display: 'bar' });
    config = setSkillTrackerEnabled(config, 'rejuvenation', true);
    expect(config.rejuvenation).toEqual({ enabled: true, display: 'bar' });
    config = setSkillTrackerEnabled(config, 'rejuvenation', false);
    expect(config.rejuvenation.display).toBe('bar');
  });

  it('cycles the display through every kind and wraps', () => {
    expect(SKILL_TRACKER_DISPLAYS).toEqual(['square', 'bar']);
    expect(nextSkillTrackerDisplay('square')).toBe('bar');
    // Wraps back rather than sticking on the last kind.
    expect(nextSkillTrackerDisplay('bar')).toBe('square');
  });

  it('reads enabled + display allocation-free, matching skillTrackerEntry', () => {
    const config: SkillTrackerConfig = {
      rejuvenation: { enabled: true, display: 'bar' },
      moonfire: { enabled: false, display: 'square' },
    };
    expect(isSkillTrackerEnabled(config, 'rejuvenation')).toBe(true);
    expect(isSkillTrackerEnabled(config, 'moonfire')).toBe(false);
    expect(isSkillTrackerEnabled(config, 'not_a_spell')).toBe(false);
    expect(skillTrackerDisplayOf(config, 'rejuvenation')).toBe('bar');
    expect(skillTrackerDisplayOf(config, 'not_a_spell')).toBe('square');
  });

  it('keys the store per class, so one class cannot inherit another selection', () => {
    expect(skillTrackerStorageKey('druid')).toBe('woc_skill_tracker:druid');
    expect(skillTrackerStorageKey('mage')).not.toBe(skillTrackerStorageKey('druid'));
  });
});

describe('skill_tracker_core: the localStorage round trip', () => {
  it('round-trips an enabled selection byte-for-byte', () => {
    const config: SkillTrackerConfig = {
      rejuvenation: { enabled: true, display: 'bar' },
      moonfire: { enabled: true, display: 'square' },
    };
    expect(parseSkillTrackerConfig(serializeSkillTrackerConfig(config))).toEqual(config);
  });

  it('drops rows identical to the default but KEEPS an off row with a chosen type', () => {
    const serialized = serializeSkillTrackerConfig({
      idle_default: { enabled: false, display: 'square' },
      off_but_bar: { enabled: false, display: 'bar' },
    });
    const parsed = parseSkillTrackerConfig(serialized);
    // The default-shaped row leaves no residue...
    expect(parsed.idle_default).toBeUndefined();
    // ...but the player's chosen type survives switching its display off and on.
    expect(parsed.off_but_bar).toEqual({ enabled: false, display: 'bar' });
  });

  it('degrades every malformed blob to an empty selection instead of throwing', () => {
    expect(parseSkillTrackerConfig(null)).toEqual({});
    expect(parseSkillTrackerConfig('')).toEqual({});
    expect(parseSkillTrackerConfig('{not json')).toEqual({});
    // A JSON value of the wrong SHAPE (array, primitive, null) is not a config.
    expect(parseSkillTrackerConfig('[]')).toEqual({});
    expect(parseSkillTrackerConfig('7')).toEqual({});
    expect(parseSkillTrackerConfig('null')).toEqual({});
  });

  it('drops individual rows whose shape is wrong, keeping the good ones', () => {
    const parsed = parseSkillTrackerConfig(
      JSON.stringify({
        good: { enabled: true, display: 'bar' },
        // An unknown display kind is not coerced to a default: the row is dropped,
        // so a future/renamed kind can never render as the wrong shape.
        unknown_display: { enabled: true, display: 'radial' },
        missing_display: { enabled: true },
        not_an_object: 'bar',
        nulled: null,
      }),
    );
    expect(Object.keys(parsed)).toEqual(['good']);
    expect(parsed.good).toEqual({ enabled: true, display: 'bar' });
  });

  it('coerces a non-boolean enabled to false rather than trusting it', () => {
    const parsed = parseSkillTrackerConfig(
      JSON.stringify({ truthy_string: { enabled: 'yes', display: 'bar' } }),
    );
    expect(parsed.truthy_string).toEqual({ enabled: false, display: 'bar' });
  });
});

describe('skill_tracker_core: isTrackableAbility', () => {
  it('accepts the druid HoT and DoT the owner asked for by name', () => {
    // Wildbloom (rejuvenation) is a pure HoT; Lunar Tempest (moonfire) is a nuke
    // plus a DoT. Both leave an aura on their target, so both are trackable.
    expect(isTrackableAbility(ABILITIES.rejuvenation)).toBe(true);
    expect(isTrackableAbility(ABILITIES.moonfire)).toBe(true);
  });

  it('accepts a cooldown-only ability even with no aura effect', () => {
    const def = {
      id: 'x',
      cooldown: 30,
      effects: [{ type: 'directDamage', min: 1, max: 2 }],
    } as unknown as AbilityDef;
    expect(isTrackableAbility(def)).toBe(true);
  });

  it('rejects a plain instant nuke with no aura and no cooldown', () => {
    const def = {
      id: 'x',
      cooldown: 0,
      effects: [{ type: 'directDamage', min: 1, max: 2 }],
    } as unknown as AbilityDef;
    expect(isTrackableAbility(def)).toBe(false);
  });

  it('rejects an unknown ability id (an undefined def)', () => {
    expect(isTrackableAbility(undefined)).toBe(false);
    expect(isTrackableAbility(ABILITIES.not_a_real_ability)).toBe(false);
  });

  it('accepts a friendly buff landed on a target (Mark of the Wild, Thorns)', () => {
    // Both are `buffTarget` with no cooldown: without that family in the
    // allowlist the manager silently refuses to offer a tracker for the whole
    // raid-buff class of spells.
    expect(isTrackableAbility(ABILITIES.mark_of_the_wild)).toBe(true);
    expect(isTrackableAbility(ABILITIES.thorns)).toBe(true);
  });

  it('accepts each aura-applying effect family on its own', () => {
    // One case per family, so a dropped entry in the allowlist fails here rather
    // than silently removing a whole class of trackers.
    for (const type of [
      'dot',
      'hot',
      'absorb',
      'applyDebuff',
      'buffTarget',
      'selfBuff',
      'petBuff',
      'imbue',
      'slow',
      'root',
      'stun',
      'silence',
      'incapacitate',
      'polymorph',
      'aoeFear',
      'faerieFire',
      'sunder',
    ]) {
      const def = { id: 'x', cooldown: 0, effects: [{ type }] } as unknown as AbilityDef;
      expect(isTrackableAbility(def), `effect ${type} should be trackable`).toBe(true);
    }
  });
});
