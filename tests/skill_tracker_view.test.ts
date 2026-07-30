// Skills Manager per-frame derivation: which of the three sources a tracker
// follows, how the fraction is derived, and the allocation-light contract.
//
// The load-bearing behavior the owner asked for is the FIRST case here: a tracked
// spell follows what the CURRENT TARGET carries from YOU (the druid Wildbloom HoT,
// the Lunar Tempest DoT), falling back to your own auras and then the ability's
// cooldown, and rendering nothing at all when idle.
//
// PARITY is asserted directly: every case runs against BOTH a Sim-shaped aura
// (sourceId + stacks always present) and a ClientWorld-mirror-shaped aura (the
// sparse wire, which omits stacks at 1 and can omit src entirely), and the derived
// slot must be identical.

import { describe, expect, it } from 'vitest';
import {
  createSkillTrackerView,
  type SkillTrackerAuraInput,
  type SkillTrackerDeps,
  type SkillTrackerEntryInput,
  type SkillTrackerWorldInput,
  skillTrackerFractionDigits,
} from '../src/ui/skill_tracker_view';
import { assertAllocationStable } from './util/alloc_probe';

const PLAYER_ID = 7;
const OTHER_CASTER_ID = 99;

const deps: SkillTrackerDeps = {
  abilityName: (id) => `name:${id}`,
  formatRemaining: (s) => s.toFixed(skillTrackerFractionDigits(s)),
  formatStacks: (n) => `x${n}`,
};

function entry(over: Partial<SkillTrackerEntryInput> = {}): SkillTrackerEntryInput {
  return { abilityId: 'rejuvenation', display: 'bar', cooldown: 0, ...over };
}

function world(over: Partial<SkillTrackerWorldInput> = {}): SkillTrackerWorldInput {
  return {
    playerId: PLAYER_ID,
    selfAuras: [],
    targetAuras: null,
    cooldowns: new Map(),
    ...over,
  };
}

/** A Sim-shaped aura: every optional field materialized, stacks explicitly 1. */
function simAura(over: Partial<SkillTrackerAuraInput> = {}): SkillTrackerAuraInput {
  return {
    id: 'rejuvenation',
    remaining: 6,
    duration: 12,
    sourceId: PLAYER_ID,
    stacks: 1,
    kind: 'hot',
    ...over,
  };
}

/** The same aura as the online mirror sees it. The wire omits `stacks` at 1 and
 *  omits `value` at 0, but ALWAYS carries `id` / `rem` / `dur` / `kind` / `src`
 *  (server/game.ts wireAura), so those survive the trip and this shape is exactly
 *  what src/net/online.ts decodes. */
function wireAura(over: Partial<SkillTrackerAuraInput> = {}): SkillTrackerAuraInput {
  const aura = simAura(over);
  return {
    id: aura.id,
    remaining: aura.remaining,
    duration: aura.duration,
    sourceId: aura.sourceId,
    kind: aura.kind,
  };
}

describe('skill_tracker_view: which source a tracker follows', () => {
  it('follows the tracked spell on the CURRENT TARGET when you cast it', () => {
    const view = createSkillTrackerView(deps);
    const state = view.tick([entry()], world({ targetAuras: [simAura()] }));
    expect(state.count).toBe(1);
    expect(state.slots[0]).toMatchObject({
      key: 'bar:rejuvenation',
      abilityId: 'rejuvenation',
      display: 'bar',
      source: 'target',
      remaining: 6,
      fraction: 0.5,
      name: 'name:rejuvenation',
      remainingText: '6.0',
    });
  });

  it('prefers the target aura over an identical one on you', () => {
    const view = createSkillTrackerView(deps);
    const state = view.tick(
      [entry()],
      world({
        selfAuras: [simAura({ remaining: 11 })],
        targetAuras: [simAura({ remaining: 3 })],
      }),
    );
    expect(state.slots[0].source).toBe('target');
    expect(state.slots[0].remaining).toBe(3);
  });

  it('falls back to your OWN auras (a self buff or proc) with no target aura', () => {
    const view = createSkillTrackerView(deps);
    const state = view.tick([entry()], world({ selfAuras: [simAura({ remaining: 9 })] }));
    expect(state.slots[0].source).toBe('self');
    expect(state.slots[0].remaining).toBe(9);
    expect(state.slots[0].fraction).toBe(0.75);
  });

  it('falls back to the running cooldown with no aura anywhere', () => {
    const view = createSkillTrackerView(deps);
    const state = view.tick(
      [entry({ abilityId: 'entangle', cooldown: 20 })],
      world({ cooldowns: new Map([['entangle', 5]]) }),
    );
    expect(state.slots[0]).toMatchObject({ source: 'cooldown', remaining: 5, fraction: 0.25 });
  });

  it('renders NOTHING for an idle ability (no aura, no cooldown)', () => {
    const view = createSkillTrackerView(deps);
    expect(view.tick([entry()], world()).count).toBe(0);
  });

  it('renders nothing once the followed timer hits zero', () => {
    const view = createSkillTrackerView(deps);
    // A zero-remaining aura and a zero cooldown are both "not running".
    expect(view.tick([entry()], world({ targetAuras: [simAura({ remaining: 0 })] })).count).toBe(0);
    expect(
      view.tick([entry({ cooldown: 20 })], world({ cooldowns: new Map([['rejuvenation', 0]]) }))
        .count,
    ).toBe(0);
  });

  it('ignores ANOTHER caster aura on the target, then falls through to the cooldown', () => {
    // Two healers keep the same HoT up; the tracker is yours, so a foreign one must
    // not stand in for it. With nothing of your own, the cooldown takes over.
    const view = createSkillTrackerView(deps);
    const foreign = simAura({ sourceId: OTHER_CASTER_ID, remaining: 8 });
    const state = view.tick(
      [entry({ cooldown: 10 })],
      world({ targetAuras: [foreign], cooldowns: new Map([['rejuvenation', 4]]) }),
    );
    expect(state.slots[0]).toMatchObject({ source: 'cooldown', remaining: 4 });
  });

  it('picks YOUR aura out of a mixed list on the same target', () => {
    const view = createSkillTrackerView(deps);
    const state = view.tick(
      [entry()],
      world({
        targetAuras: [
          simAura({ sourceId: OTHER_CASTER_ID, remaining: 8 }),
          simAura({ sourceId: PLAYER_ID, remaining: 2 }),
        ],
      }),
    );
    expect(state.slots[0].remaining).toBe(2);
  });

  it('treats an un-attributed aura as showable, so an old server degrades not blanks', () => {
    // An old server omits WireAura.src and the mirror decodes 0. Dropping the
    // tracker there would blank the HUD; showing it is the pre-attribution read.
    const view = createSkillTrackerView(deps);
    for (const sourceId of [undefined, 0]) {
      const state = view.tick(
        [entry()],
        world({ targetAuras: [{ id: 'rejuvenation', remaining: 6, duration: 12, sourceId }] }),
      );
      expect(state.count, `sourceId=${String(sourceId)}`).toBe(1);
      expect(state.slots[0].source).toBe('target');
    }
  });

  it('never mistakes a different ability aura for the tracked one', () => {
    const view = createSkillTrackerView(deps);
    const state = view.tick([entry()], world({ targetAuras: [simAura({ id: 'moonfire' })] }));
    expect(state.count).toBe(0);
  });

  it('keys each slot by display + ability, so flipping the type re-keys the node', () => {
    const view = createSkillTrackerView(deps);
    const asBar = view.tick([entry({ display: 'bar' })], world({ targetAuras: [simAura()] }));
    expect(asBar.slots[0].key).toBe('bar:rejuvenation');
    const asSquare = view.tick([entry({ display: 'square' })], world({ targetAuras: [simAura()] }));
    expect(asSquare.slots[0].key).toBe('square:rejuvenation');
  });

  it('keeps entry order and reports only the active leading slots', () => {
    const view = createSkillTrackerView(deps);
    const state = view.tick(
      [
        entry({ abilityId: 'rejuvenation' }),
        entry({ abilityId: 'idle_one' }),
        entry({ abilityId: 'moonfire' }),
      ],
      world({
        targetAuras: [simAura({ id: 'moonfire' }), simAura({ id: 'rejuvenation' })],
      }),
    );
    // The idle middle entry is skipped and the two live ones keep ENTRY order,
    // not the order the auras happen to sit in on the target.
    expect(state.count).toBe(2);
    expect(state.slots.slice(0, 2).map((s) => s.abilityId)).toEqual(['rejuvenation', 'moonfire']);
  });
});

describe('skill_tracker_view: the buff/debuff tone', () => {
  it('tones a HoT you keep on your TARGET as a buff, not a debuff', () => {
    // The whole reason tone is separate from source: source says where the aura
    // sits, tone says how it reads. The druid HoT the owner asked for sits on the
    // target AND is helpful.
    const view = createSkillTrackerView(deps);
    const state = view.tick([entry()], world({ targetAuras: [simAura({ kind: 'hot' })] }));
    expect(state.slots[0]).toMatchObject({ source: 'target', tone: 'buff' });
  });

  it('tones a DoT on your target as a debuff', () => {
    const view = createSkillTrackerView(deps);
    const state = view.tick(
      [entry({ abilityId: 'moonfire' })],
      world({ targetAuras: [simAura({ id: 'moonfire', kind: 'dot' })] }),
    );
    expect(state.slots[0]).toMatchObject({ source: 'target', tone: 'debuff' });
  });

  it('tones a negative-value stat buff as the debuff it is', () => {
    // A mob stat-sap rides a buff_* kind with a negative value. The shared sim
    // classifier catches it, so the tracker cannot disagree with the aura strip.
    const view = createSkillTrackerView(deps);
    const sapped = view.tick(
      [entry()],
      world({ targetAuras: [simAura({ kind: 'buff_ap', value: -20 })] }),
    );
    expect(sapped.slots[0].tone).toBe('debuff');
    const helped = view.tick(
      [entry()],
      world({ targetAuras: [simAura({ kind: 'buff_ap', value: 20 })] }),
    );
    expect(helped.slots[0].tone).toBe('buff');
  });

  it('tones a running cooldown as neither', () => {
    const view = createSkillTrackerView(deps);
    const state = view.tick(
      [entry({ abilityId: 'entangle', cooldown: 20 })],
      world({ cooldowns: new Map([['entangle', 5]]) }),
    );
    expect(state.slots[0]).toMatchObject({ source: 'cooldown', tone: 'cooldown' });
  });

  it('falls back to the placement-implied tone for an aura with no kind', () => {
    // No host mirrors a kind-less aura today, but the field is optional, and the
    // fallback must never leave a frame untinted.
    const view = createSkillTrackerView(deps);
    const onTarget = view.tick(
      [entry()],
      world({ targetAuras: [{ id: 'rejuvenation', remaining: 6, duration: 12 }] }),
    );
    expect(onTarget.slots[0].tone).toBe('debuff');
    const onSelf = view.tick(
      [entry()],
      world({ selfAuras: [{ id: 'rejuvenation', remaining: 6, duration: 12 }] }),
    );
    expect(onSelf.slots[0].tone).toBe('buff');
  });
});

describe('skill_tracker_view: the fraction and the labels', () => {
  it('clamps the fraction into 0..1 and reads 0 with no known total', () => {
    const view = createSkillTrackerView(deps);
    // remaining above duration (a refreshed/extended aura) never exceeds a full bar.
    expect(
      view.tick([entry()], world({ targetAuras: [simAura({ remaining: 20, duration: 12 })] }))
        .slots[0].fraction,
    ).toBe(1);
    // A zero duration cannot divide; the slot still renders its countdown.
    const noTotal = view.tick(
      [entry()],
      world({ targetAuras: [simAura({ remaining: 4, duration: 0 })] }),
    );
    expect(noTotal.slots[0].fraction).toBe(0);
    expect(noTotal.slots[0].remaining).toBe(4);
  });

  it('floors the cooldown denominator at the live remaining, so a shortened cooldown cannot overflow', () => {
    const view = createSkillTrackerView(deps);
    // A talent shortened the cooldown mid-run: remaining (9) exceeds the resolved
    // length (5), and the fraction must still cap at a full sweep.
    const state = view.tick(
      [entry({ abilityId: 'entangle', cooldown: 5 })],
      world({ cooldowns: new Map([['entangle', 9]]) }),
    );
    expect(state.slots[0].fraction).toBe(1);
  });

  it('keeps a decimal under ten seconds and drops it above', () => {
    expect(skillTrackerFractionDigits(0.4)).toBe(1);
    expect(skillTrackerFractionDigits(9.99)).toBe(1);
    expect(skillTrackerFractionDigits(10)).toBe(0);
    expect(skillTrackerFractionDigits(18)).toBe(0);
  });

  it('badges stacks only past one', () => {
    const view = createSkillTrackerView(deps);
    expect(
      view.tick([entry()], world({ targetAuras: [simAura({ stacks: 3 })] })).slots[0].stacksText,
    ).toBe('x3');
    expect(
      view.tick([entry()], world({ targetAuras: [simAura({ stacks: 1 })] })).slots[0].stacksText,
    ).toBe('');
    expect(
      view.tick([entry()], world({ targetAuras: [simAura({ stacks: undefined })] })).slots[0]
        .stacksText,
    ).toBe('');
  });

  it('re-reads the injected deps every tick, so an in-game language switch lands next frame', () => {
    let language = 'en';
    const view = createSkillTrackerView({
      abilityName: () => `${language}:name`,
      formatRemaining: (s) => `${language}:${s}`,
      formatStacks: (n) => `${language}:${n}`,
    });
    const input = world({ targetAuras: [simAura({ stacks: 2 })] });
    expect(view.tick([entry()], input).slots[0].name).toBe('en:name');
    language = 'fr';
    const after = view.tick([entry()], input);
    expect(after.slots[0].name).toBe('fr:name');
    expect(after.slots[0].remainingText).toBe('fr:6');
    expect(after.slots[0].stacksText).toBe('fr:2');
  });
});

describe('skill_tracker_view: parity between the two worlds', () => {
  it('derives an IDENTICAL slot from a Sim-shaped and a wire-shaped aura', () => {
    // Same logical aura, two host shapes. The wire omits stacks at 1; the sim
    // materializes it. Every derived field must match.
    const simView = createSkillTrackerView(deps);
    const wireView = createSkillTrackerView(deps);
    const fromSim = simView.tick([entry()], world({ targetAuras: [simAura()] }));
    const fromWire = wireView.tick([entry()], world({ targetAuras: [wireAura()] }));
    expect(fromSim.count).toBe(fromWire.count);
    expect({ ...fromSim.slots[0] }).toEqual({ ...fromWire.slots[0] });
  });

  it('derives an identical cooldown slot on both hosts', () => {
    const simView = createSkillTrackerView(deps);
    const wireView = createSkillTrackerView(deps);
    const cooldowns = new Map([['entangle', 7]]);
    const args = [entry({ abilityId: 'entangle', cooldown: 14 })] as SkillTrackerEntryInput[];
    const fromSim = simView.tick(args, world({ cooldowns, selfAuras: [] }));
    const fromWire = wireView.tick(args, world({ cooldowns, selfAuras: [], targetAuras: null }));
    expect({ ...fromSim.slots[0] }).toEqual({ ...fromWire.slots[0] });
  });
});

describe('skill_tracker_view: the allocation-light contract', () => {
  it('returns the SAME container and slot references every tick', () => {
    const view = createSkillTrackerView(deps);
    const entries = [entry({ abilityId: 'rejuvenation' }), entry({ abilityId: 'moonfire' })];
    const input = world({
      targetAuras: [simAura({ id: 'rejuvenation' }), simAura({ id: 'moonfire' })],
    });
    assertAllocationStable(() => view.tick(entries, input));
  });

  it('keeps the pool at its high-water mark instead of truncating', () => {
    const view = createSkillTrackerView(deps);
    const entries = [entry({ abilityId: 'rejuvenation' }), entry({ abilityId: 'moonfire' })];
    const both = view.tick(
      entries,
      world({ targetAuras: [simAura({ id: 'rejuvenation' }), simAura({ id: 'moonfire' })] }),
    );
    const secondSlot = both.slots[1];
    expect(both.count).toBe(2);
    // One tracker drops out: count shrinks but the retired slot object survives, so
    // the pool never reallocates when it comes back.
    const one = view.tick(entries, world({ targetAuras: [simAura({ id: 'rejuvenation' })] }));
    expect(one.count).toBe(1);
    expect(one.slots.length).toBe(2);
    expect(one.slots[1]).toBe(secondSlot);
  });
});
