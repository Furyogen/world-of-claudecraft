// Tests for the spellbook window pure core (spellbook_view.ts):
//  - the class kit maps to rows in display order,
//  - learned vs locked (trainable) rows from the `known` set,
//  - rank passthrough,
//  - on-bar derivation from the action-bar ability ids,
//  - the add-control disabled state (known, off the bar, no free slot),
//  - the empty state (no class kit),
//  - parity: a Sim-shaped and a ClientWorld-mirror-shaped `known`
//    set carrying the same logical data render identical rows, plus determinism.
//
// DOM-free / i18n-free, so this Node suite drives the core directly; the localized
// markup + drag/tooltip wiring is covered by the spellbook_window.ts source guard.

import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/sim/data';
import type { ResolvedAbility } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { ACTION_BAR_ABILITY_SLOTS } from '../src/ui/hud/action_bar/action_bar_layout_core';
import {
  buildSpellbookView,
  type SpellbookInput,
  trackerEntriesFromKnown,
} from '../src/ui/spellbook_view';

// A class whose kit has at least two abilities, so we can exercise known/locked.
const CLASS_ID = Object.values(CLASSES).find((c) => c.abilities.length >= 2)!.id as PlayerClass;
const KIT = CLASSES[CLASS_ID].abilities;

// Minimal ResolvedAbility stub: the core reads only `def.id` and `rank`. shape:
// 'sim' carries extra fields the core must ignore.
function known(shape: 'sim' | 'client', abilityId: string, rank = 1): ResolvedAbility {
  const junk = shape === 'sim' ? { _resolvedSeq: 3, cost: 12, cooldown: 6 } : {};
  return { def: { id: abilityId }, rank, ...junk } as unknown as ResolvedAbility;
}

function input(over: Partial<SpellbookInput> = {}): SpellbookInput {
  return {
    classId: CLASS_ID,
    abilities: KIT,
    known: [],
    barAbilityIds: [],
    hasFreeSlot: true,
    attackOnBar: true,
    hasFormBars: false,
    ...over,
  };
}

describe('buildSpellbookView: class kit + learned state', () => {
  it('maps the class kit to rows in display order', () => {
    const v = buildSpellbookView(input());
    expect(v.rows.map((r) => r.abilityId)).toEqual([...KIT]);
    expect(v.classId).toBe(CLASS_ID);
    expect(v.empty).toBe(false);
  });

  it('carries the pinned Attack toggle state beside the rows (never as a fake row)', () => {
    expect(buildSpellbookView(input({ attackOnBar: true })).attackOnBar).toBe(true);
    expect(buildSpellbookView(input({ attackOnBar: false })).attackOnBar).toBe(false);
    // Attack is not an ability: it never leaks into the ability rows.
    expect(buildSpellbookView(input()).rows.every((r) => r.abilityId !== 'attack')).toBe(true);
  });

  it('marks a learned ability known with its rank and a locked one null', () => {
    const v = buildSpellbookView(input({ known: [known('sim', KIT[0], 3)] }));
    const learned = v.rows.find((r) => r.abilityId === KIT[0])!;
    const locked = v.rows.find((r) => r.abilityId === KIT[1])!;
    expect(learned.known).not.toBeNull();
    expect(learned.rank).toBe(3);
    expect(locked.known).toBeNull();
    expect(locked.rank).toBe(0);
  });

  it('reports the empty state when the class kit is empty', () => {
    const v = buildSpellbookView(input({ abilities: [] }));
    expect(v.rows).toEqual([]);
    expect(v.empty).toBe(true);
  });

  it('passes the form-bars flag through (drives the reset button)', () => {
    expect(buildSpellbookView(input({ hasFormBars: true })).hasFormBars).toBe(true);
    expect(buildSpellbookView(input({ hasFormBars: false })).hasFormBars).toBe(false);
  });
});

describe('buildSpellbookView: on-bar + toggle-disabled derivation', () => {
  it('flags a learned ability that sits on the action bar as onBar', () => {
    const v = buildSpellbookView(input({ known: [known('sim', KIT[0])], barAbilityIds: [KIT[0]] }));
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.onBar).toBe(true);
  });

  it('does not flag a locked ability as onBar even if its id is on the bar', () => {
    // A defensive case: an id on the bar but not in `known` is not a learned row.
    const v = buildSpellbookView(input({ known: [], barAbilityIds: [KIT[0]] }));
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.onBar).toBe(false);
  });

  it('disables the add control for a learned, off-bar ability when no slot is free', () => {
    const v = buildSpellbookView(
      input({ known: [known('sim', KIT[0])], barAbilityIds: [], hasFreeSlot: false }),
    );
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.toggleDisabled).toBe(true);
  });

  it('enables the add control when a slot is free', () => {
    const v = buildSpellbookView(
      input({ known: [known('sim', KIT[0])], barAbilityIds: [], hasFreeSlot: true }),
    );
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.toggleDisabled).toBe(false);
  });

  it('never disables a removal (on-bar ability stays enabled even with no free slot)', () => {
    const v = buildSpellbookView(
      input({ known: [known('sim', KIT[0])], barAbilityIds: [KIT[0]], hasFreeSlot: false }),
    );
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.toggleDisabled).toBe(false);
  });
});

describe('buildSpellbookView: mobilePage derivation (Phase 4)', () => {
  // abilityIdByBarSlot index 0 = barSlot 1 (hotbarActions' own index = barSlot-1
  // convention). Build a slot array with KIT[0] parked on a given 1-indexed slot.
  const slotsWith = (abilityId: string, barSlot: number): (string | null)[] => {
    const slots: (string | null)[] = new Array(ACTION_BAR_ABILITY_SLOTS).fill(null);
    slots[barSlot - 1] = abilityId;
    return slots;
  };

  it('assigns page 0 for a bar-assigned row on slots 1-5', () => {
    for (const slot of [1, 2, 3, 4, 5]) {
      const v = buildSpellbookView(
        input({
          known: [known('sim', KIT[0])],
          barAbilityIds: [KIT[0]],
          abilityIdByBarSlot: slotsWith(KIT[0], slot),
        }),
      );
      expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage, `slot ${slot}`).toBe(0);
    }
  });

  it('assigns page 1 for a bar-assigned row on slots 6-10', () => {
    for (const slot of [6, 7, 8, 9, 10]) {
      const v = buildSpellbookView(
        input({
          known: [known('sim', KIT[0])],
          barAbilityIds: [KIT[0]],
          abilityIdByBarSlot: slotsWith(KIT[0], slot),
        }),
      );
      expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage, `slot ${slot}`).toBe(1);
    }
  });

  it('assigns page 2 for a bar-assigned row on slots 11-15', () => {
    for (const slot of [11, 12, 13, 14, 15]) {
      const v = buildSpellbookView(
        input({
          known: [known('sim', KIT[0])],
          barAbilityIds: [KIT[0]],
          abilityIdByBarSlot: slotsWith(KIT[0], slot),
        }),
      );
      expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage, `slot ${slot}`).toBe(2);
    }
  });

  it('assigns page 3 for a bar-assigned row on slots 16-20', () => {
    for (const slot of [16, 17, 18, 19, 20]) {
      const v = buildSpellbookView(
        input({
          known: [known('sim', KIT[0])],
          barAbilityIds: [KIT[0]],
          abilityIdByBarSlot: slotsWith(KIT[0], slot),
        }),
      );
      expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage, `slot ${slot}`).toBe(3);
    }
  });

  it('assigns pages 4 through 6 for the remaining secondary and third-row slots', () => {
    for (const [slot, page] of [
      [21, 4],
      [22, 4],
      [23, 4],
      [26, 5],
      [31, 6],
      [33, 6],
    ] as const) {
      const v = buildSpellbookView(
        input({
          known: [known('sim', KIT[0])],
          barAbilityIds: [KIT[0]],
          abilityIdByBarSlot: slotsWith(KIT[0], slot),
        }),
      );
      expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage, `slot ${slot}`).toBe(page);
    }
  });

  it('assigns null when the ability is absent from every source slot', () => {
    const v = buildSpellbookView(
      input({
        known: [known('sim', KIT[0])],
        barAbilityIds: [KIT[0]],
        abilityIdByBarSlot: new Array(ACTION_BAR_ABILITY_SLOTS).fill(null),
      }),
    );
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage).toBeNull();
  });

  it('assigns null for a row that is off-bar even if abilityIdByBarSlot is provided', () => {
    const v = buildSpellbookView(
      input({
        known: [known('sim', KIT[0])],
        barAbilityIds: [],
        abilityIdByBarSlot: new Array(ACTION_BAR_ABILITY_SLOTS).fill(null),
      }),
    );
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage).toBeNull();
  });

  it('assigns null when abilityIdByBarSlot is omitted (desktop / not-yet-wired callers)', () => {
    const v = buildSpellbookView(input({ known: [known('sim', KIT[0])], barAbilityIds: [KIT[0]] }));
    expect(v.rows.find((r) => r.abilityId === KIT[0])!.mobilePage).toBeNull();
  });
});

describe('buildSpellbookView: ClientWorld-vs-Sim parity', () => {
  // The core passes the resolved ability OBJECT through to the painter (it needs it
  // for the tooltip/summary), so the parity guarantee is over the DERIVED decision
  // state: a Sim-shaped known carrying extra fields the core ignores must yield the
  // same known-ness / rank / on-bar / disabled state as a ClientWorld-mirror shape.
  const derived = (shape: 'sim' | 'client') => {
    const abilityIdByBarSlot: (string | null)[] = new Array(ACTION_BAR_ABILITY_SLOTS).fill(null);
    abilityIdByBarSlot[19] = KIT[0];
    return buildSpellbookView(
      input({
        known: [known(shape, KIT[0], 2)],
        barAbilityIds: [KIT[0]],
        hasFreeSlot: false,
        abilityIdByBarSlot,
      }),
    ).rows.map((r) => ({
      abilityId: r.abilityId,
      learned: r.known !== null,
      rank: r.rank,
      onBar: r.onBar,
      toggleDisabled: r.toggleDisabled,
      mobilePage: r.mobilePage,
    }));
  };

  it('derives identical decision state regardless of the known object shape', () => {
    const simDerived = derived('sim');
    expect(simDerived.find((row) => row.abilityId === KIT[0])?.mobilePage).toBe(3);
    expect(simDerived).toEqual(derived('client'));
  });

  it('is deterministic: identical inputs produce a deep-equal view', () => {
    const i = input({ known: [known('sim', KIT[0])] });
    expect(buildSpellbookView(i)).toEqual(buildSpellbookView(i));
  });
});

// ---------------------------------------------------------------------------
// Skills Manager: the manager-mode row state and the derived tracker entries.
// The alternate spellbook the "Skills manager" footer button opens shows the SAME
// spell list plus, on each trackable row, a display toggle and a tracker-type
// button. These assert the decisions behind those two controls.
// ---------------------------------------------------------------------------

describe('buildSpellbookView: Skills Manager row state', () => {
  // The druid pair the owner asked for by name: Wildbloom (a pure HoT) and Lunar
  // Tempest (a nuke plus a DoT). Both apply an aura, so both are trackable.
  const DRUID: PlayerClass = 'druid';
  const druidInput = (over: Partial<SpellbookInput> = {}): SpellbookInput => ({
    classId: DRUID,
    abilities: CLASSES[DRUID].abilities,
    known: [],
    barAbilityIds: [],
    hasFreeSlot: true,
    attackOnBar: true,
    hasFormBars: true,
    ...over,
  });
  const row = (view: ReturnType<typeof buildSpellbookView>, abilityId: string) =>
    view.rows.find((r) => r.abilityId === abilityId)!;

  it('defaults to the classic spellbook: manager off, frames locked, nothing tracked', () => {
    const v = buildSpellbookView(druidInput());
    expect(v.managerMode).toBe(false);
    // Omitting `locked` must read as LOCKED, so a frame never loads draggable.
    expect(v.locked).toBe(true);
    expect(v.trackedCount).toBe(0);
  });

  it('passes the manager and lock flags through', () => {
    const v = buildSpellbookView(druidInput({ managerMode: true, locked: false }));
    expect(v.managerMode).toBe(true);
    expect(v.locked).toBe(false);
  });

  it('marks a LEARNED aura-applying ability trackable and an unlearned one not', () => {
    const v = buildSpellbookView(
      druidInput({ known: [known('sim', 'rejuvenation'), known('sim', 'moonfire')] }),
    );
    expect(row(v, 'rejuvenation').trackable).toBe(true);
    expect(row(v, 'moonfire').trackable).toBe(true);
    // Every OTHER kit row is unlearned here, so none of them offers the controls:
    // an unlearned ability can never light up a tracker.
    expect(v.rows.filter((r) => r.known === null).every((r) => r.trackable === false)).toBe(true);
  });

  it('reflects the stored per-ability selection on the row', () => {
    const v = buildSpellbookView(
      druidInput({
        known: [known('sim', 'rejuvenation'), known('sim', 'moonfire')],
        tracking: {
          rejuvenation: { enabled: true, display: 'bar' },
          moonfire: { enabled: false, display: 'bar' },
        },
      }),
    );
    expect(row(v, 'rejuvenation')).toMatchObject({ tracked: true, trackDisplay: 'bar' });
    // Switched off, but the chosen type still rides the row so turning the display
    // back on restores it rather than snapping to the square default.
    expect(row(v, 'moonfire')).toMatchObject({ tracked: false, trackDisplay: 'bar' });
    expect(v.trackedCount).toBe(1);
  });

  it('never reports an UNLEARNED ability as tracked, even with a stored row', () => {
    // A selection made at a higher level (or on another character) must not light
    // up a row the player cannot cast yet.
    const v = buildSpellbookView(
      druidInput({ known: [], tracking: { rejuvenation: { enabled: true, display: 'bar' } } }),
    );
    expect(row(v, 'rejuvenation').tracked).toBe(false);
    expect(v.trackedCount).toBe(0);
  });

  it('leaves the classic row decisions untouched by manager mode', () => {
    const base = druidInput({
      known: [known('sim', 'rejuvenation')],
      barAbilityIds: ['rejuvenation'],
    });
    const classic = buildSpellbookView(base);
    const manager = buildSpellbookView({ ...base, managerMode: true });
    const decisions = (v: ReturnType<typeof buildSpellbookView>) =>
      v.rows.map((r) => ({
        abilityId: r.abilityId,
        onBar: r.onBar,
        rank: r.rank,
        toggleDisabled: r.toggleDisabled,
        mobilePage: r.mobilePage,
      }));
    expect(decisions(manager)).toEqual(decisions(classic));
  });
});

describe('trackerEntriesFromKnown', () => {
  const resolved = (id: string, cooldown = 0) =>
    ({ def: { id }, cooldown }) as unknown as ResolvedAbility;

  it('emits only enabled, trackable, learned abilities, carrying the resolved cooldown', () => {
    const entries = trackerEntriesFromKnown(
      [resolved('rejuvenation'), resolved('moonfire'), resolved('entangling_roots', 8)],
      {
        rejuvenation: { enabled: true, display: 'bar' },
        moonfire: { enabled: true, display: 'square' },
      },
    );
    expect(entries).toEqual([
      { abilityId: 'rejuvenation', display: 'bar', cooldown: 0 },
      { abilityId: 'moonfire', display: 'square', cooldown: 0 },
    ]);
  });

  it('reads the TALENT-RESOLVED cooldown, not the base table value', () => {
    // The resolved value is what rides `known`, so a talent that shortens a
    // cooldown shortens the tracker sweep with no extra plumbing.
    const [entry] = trackerEntriesFromKnown([resolved('rejuvenation', 4)], {
      rejuvenation: { enabled: true, display: 'square' },
    });
    expect(entry.cooldown).toBe(4);
  });

  it('emits nothing for a switched-off row or an unknown ability id', () => {
    expect(
      trackerEntriesFromKnown([resolved('rejuvenation')], {
        rejuvenation: { enabled: false, display: 'bar' },
      }),
    ).toEqual([]);
    // An id with no ABILITIES record cannot be trackable, so a stale stored row
    // (a renamed ability) can never produce a dead frame.
    expect(
      trackerEntriesFromKnown([resolved('not_a_real_ability')], {
        not_a_real_ability: { enabled: true, display: 'bar' },
      }),
    ).toEqual([]);
  });

  it('keeps the learned-ability order, so the HUD order matches the spellbook order', () => {
    const entries = trackerEntriesFromKnown([resolved('moonfire'), resolved('rejuvenation')], {
      rejuvenation: { enabled: true, display: 'bar' },
      moonfire: { enabled: true, display: 'bar' },
    });
    expect(entries.map((e) => e.abilityId)).toEqual(['moonfire', 'rejuvenation']);
  });
});
