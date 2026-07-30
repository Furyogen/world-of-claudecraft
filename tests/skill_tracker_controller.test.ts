// Skills Manager controller: the composition Hud owns one of. These cover the
// behavior that lives in the seams rather than in either pure half:
//  - the MASTER SWITCH ("Skills manager" off hides every frame and bar, and does
//    no derivation at all),
//  - the LOCK, which both gates dragging and decides whether an empty group stays
//    visible so it can still be grabbed,
//  - per-class selection load/save (a class switch never inherits a selection),
//  - the target hand-off (the tracked spell follows the CURRENT target),
//  - the entry-rebuild cadence: a fresh `known` array every frame (what the online
//    mirror does) must NOT rebuild the entry list, but a talent-shortened cooldown
//    must.
//
// The drag math itself is covered by tests/proc_overlay_drag.test.ts; here the
// attach is injected, so this suite needs no DOM globals.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import type { OverlayAnchor, OverlayDragOptions } from '../src/ui/proc_overlay_drag';
import {
  SkillTrackerController,
  type SkillTrackerControllerDeps,
  type SkillTrackerControllerWorld,
} from '../src/ui/skill_tracker_controller';
import { FakeDocument, type FakeElement } from './helpers/fake_dom';

const PLAYER_ID = 7;
const TARGET_ID = 42;

// The shared hand-rolled fake DOM (tests/helpers/fake_dom.ts): the painter only
// needs createElement plus the childNodes / firstChild / nextSibling /
// insertBefore order surface its keyed reconcile walks.

// A minimal in-memory localStorage. The controller guards every access in a
// try/catch (so it imports cleanly in plain Node), but the per-class selection is
// only observable ACROSS a class switch if a store actually persists, so install
// one for this suite and restore the environment afterwards.
function installFakeStorage(): void {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
  };
}

type Call = { m: keyof PainterHostWriters; el: unknown; args: unknown[] };

interface Harness {
  controller: SkillTrackerController;
  calls: Call[];
  squareGroup: FakeElement;
  barGroup: FakeElement;
  squareItems: FakeElement;
  barItems: FakeElement;
  state: { enabled: boolean; locked: boolean };
  dragOpts: OverlayDragOptions[];
  dragKeys: string[];
  dragDefaults: OverlayAnchor[];
  displayOf(el: FakeElement): string | undefined;
  classOf(el: FakeElement, cls: string): boolean | undefined;
}

function harness(over: Partial<{ enabled: boolean; locked: boolean }> = {}): Harness {
  const calls: Call[] = [];
  const writers: PainterHostWriters = {
    setText: (el, text) => calls.push({ m: 'setText', el, args: [text] }),
    setDisplay: (el, display) => calls.push({ m: 'setDisplay', el, args: [display] }),
    setTransform: (el, transform) => calls.push({ m: 'setTransform', el, args: [transform] }),
    setWidth: (el, width) => calls.push({ m: 'setWidth', el, args: [width] }),
    setStyleProp: (el, prop, value) => calls.push({ m: 'setStyleProp', el, args: [prop, value] }),
    toggleClass: (el, cls, on) => calls.push({ m: 'toggleClass', el, args: [cls, on] }),
    setAttr: (el, name, value) => calls.push({ m: 'setAttr', el, args: [name, value] }),
  };
  const doc = new FakeDocument();
  const squareGroup = doc.createElement('div');
  const barGroup = doc.createElement('div');
  const squareItems = doc.createElement('div');
  const barItems = doc.createElement('div');
  const state = { enabled: true, locked: true, ...over };
  const dragOpts: OverlayDragOptions[] = [];
  const dragKeys: string[] = [];
  const dragDefaults: OverlayAnchor[] = [];
  const deps: SkillTrackerControllerDeps = {
    squareGroup: () => squareGroup as unknown as HTMLElement,
    barGroup: () => barGroup as unknown as HTMLElement,
    squareItems: () => squareItems as unknown as HTMLElement,
    barItems: () => barItems as unknown as HTMLElement,
    writers,
    enabled: () => state.enabled,
    setEnabled: (on) => {
      state.enabled = on;
    },
    locked: () => state.locked,
    setLocked: (locked) => {
      state.locked = locked;
    },
    painterDeps: {
      resolveIconUrl: (id) => `url(${id})`,
      renderTooltip: (name) => name,
      attachTooltip: () => {},
    },
    viewDeps: {
      abilityName: (id) => `name:${id}`,
      formatRemaining: (s) => s.toFixed(1),
      formatStacks: (n) => `x${n}`,
    },
    attachDrag: (_el, key, defaults, opts) => {
      dragKeys.push(key);
      dragDefaults.push(defaults);
      dragOpts.push(opts);
    },
    doc: doc as unknown as Document,
  };
  const lastArgs = (el: FakeElement, method: keyof PainterHostWriters, slot?: string) => {
    for (let i = calls.length - 1; i >= 0; i--) {
      const call = calls[i];
      if (call.el !== el || call.m !== method) continue;
      if (slot !== undefined && call.args[0] !== slot) continue;
      return call.args;
    }
    return undefined;
  };
  return {
    controller: new SkillTrackerController(deps),
    calls,
    squareGroup,
    barGroup,
    squareItems,
    barItems,
    state,
    dragOpts,
    dragKeys,
    dragDefaults,
    displayOf: (el) => lastArgs(el, 'setDisplay')?.[0] as string | undefined,
    classOf: (el, cls) => lastArgs(el, 'toggleClass', cls)?.[1] as boolean | undefined,
  };
}

function world(over: Partial<SkillTrackerControllerWorld> = {}): SkillTrackerControllerWorld {
  return {
    playerId: PLAYER_ID,
    player: { targetId: null, auras: [], cooldowns: new Map() },
    entities: new Map(),
    known: [{ def: { id: 'rejuvenation' }, cooldown: 0 }],
    cfg: { playerClass: 'druid' },
    ...over,
  };
}

/** A target carrying the player's own Wildbloom HoT. */
function targetWithHot(remaining = 6): Pick<SkillTrackerControllerWorld, 'player' | 'entities'> {
  return {
    player: { targetId: TARGET_ID, auras: [], cooldowns: new Map() },
    entities: new Map([
      [
        TARGET_ID,
        {
          auras: [{ id: 'rejuvenation', remaining, duration: 12, sourceId: PLAYER_ID }],
        },
      ],
    ]),
  };
}

// Every test starts from a clean stored selection.
beforeEach(() => {
  installFakeStorage();
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('SkillTrackerController: the master switch', () => {
  it('hides both groups and paints nothing while the Skills Manager is off', () => {
    const h = harness({ enabled: false });
    h.controller.setTracked('druid', 'rejuvenation', true);
    h.controller.update(world({ ...targetWithHot() }));
    expect(h.displayOf(h.squareGroup)).toBe('none');
    expect(h.displayOf(h.barGroup)).toBe('none');
    // Nothing was derived: no node reached either items container.
    expect(h.barItems.childNodes).toHaveLength(0);
    expect(h.squareItems.childNodes).toHaveLength(0);
    // And the unlocked affordance is cleared, so a hidden group cannot be grabbed.
    expect(h.classOf(h.squareGroup, 'st-unlocked')).toBe(false);
    expect(h.classOf(h.barGroup, 'st-unlocked')).toBe(false);
  });

  it('paints a tracked spell on the current target once switched on', () => {
    const h = harness();
    h.controller.setTracked('druid', 'rejuvenation', true);
    h.controller.setTrackDisplay('druid', 'rejuvenation', 'bar');
    h.controller.update(world({ ...targetWithHot() }));
    expect(h.barItems.childNodes).toHaveLength(1);
    expect(h.displayOf(h.barGroup)).toBe('');
    expect(h.calls).toContainEqual(
      expect.objectContaining({ m: 'setAttr', args: ['data-source', 'target'] }),
    );
    // Half of a 12s HoT left reads as a half-full bar.
    expect(h.calls).toContainEqual(
      expect.objectContaining({ m: 'setStyleProp', args: ['--st-fill', '50.00%'] }),
    );
  });

  it('drops the tracker when the player loses the target', () => {
    const h = harness();
    h.controller.setTracked('druid', 'rejuvenation', true);
    h.controller.setTrackDisplay('druid', 'rejuvenation', 'bar');
    h.controller.update(world({ ...targetWithHot() }));
    expect(h.barItems.childNodes).toHaveLength(1);
    h.controller.update(world());
    expect(h.barItems.childNodes).toHaveLength(0);
  });

  it('reads the master switch and lock through the injected settings', () => {
    const h = harness({ enabled: false, locked: true });
    expect(h.controller.managerMode()).toBe(false);
    h.controller.setManagerMode(true);
    expect(h.state.enabled).toBe(true);
    expect(h.controller.managerMode()).toBe(true);
    expect(h.controller.locked()).toBe(true);
    h.controller.setLocked(false);
    expect(h.state.locked).toBe(false);
    expect(h.controller.locked()).toBe(false);
  });
});

describe('SkillTrackerController: the lock', () => {
  it('gates dragging on the LIVE lock state, per group', () => {
    const h = harness({ locked: true });
    expect(h.dragKeys).toEqual(['skillTrackerSquareAnchor', 'skillTrackerBarAnchor']);
    // Two distinct default anchors, so the groups do not land on top of each other.
    expect(h.dragDefaults[0]).not.toEqual(h.dragDefaults[1]);
    expect(h.dragOpts).toHaveLength(2);
    for (const opts of h.dragOpts) expect(opts.isLocked?.()).toBe(true);
    // The gate is a live read, not a snapshot: unlocking mid-session frees the drag.
    h.controller.setLocked(false);
    for (const opts of h.dragOpts) expect(opts.isLocked?.()).toBe(false);
  });

  it('keeps an EMPTY group visible while unlocked, so it can still be parked', () => {
    const h = harness({ locked: false });
    h.controller.update(world());
    expect(h.displayOf(h.squareGroup)).toBe('');
    expect(h.displayOf(h.barGroup)).toBe('');
    expect(h.classOf(h.squareGroup, 'st-unlocked')).toBe(true);
    expect(h.classOf(h.barGroup, 'st-unlocked')).toBe(true);
  });

  it('hides an empty group once locked, so it never occludes the world', () => {
    const h = harness({ locked: true });
    h.controller.update(world());
    expect(h.displayOf(h.squareGroup)).toBe('none');
    expect(h.displayOf(h.barGroup)).toBe('none');
  });

  it('hides only the group with nothing in it', () => {
    const h = harness({ locked: true });
    h.controller.setTracked('druid', 'rejuvenation', true);
    h.controller.setTrackDisplay('druid', 'rejuvenation', 'bar');
    h.controller.update(world({ ...targetWithHot() }));
    expect(h.displayOf(h.barGroup)).toBe('');
    expect(h.displayOf(h.squareGroup)).toBe('none');
  });
});

describe('SkillTrackerController: the per-class selection', () => {
  it('keeps each class selection separate', () => {
    const h = harness();
    h.controller.setTracked('druid', 'rejuvenation', true);
    expect(h.controller.tracking('druid').rejuvenation?.enabled).toBe(true);
    // Asking for another class loads THAT class's store; the druid row must not
    // bleed across.
    expect(h.controller.tracking('mage').rejuvenation).toBeUndefined();
    // And switching back does not lose the druid selection.
    expect(h.controller.tracking('druid').rejuvenation?.enabled).toBe(true);
  });

  it('stops painting a spell whose display is switched back off', () => {
    const h = harness();
    h.controller.setTracked('druid', 'rejuvenation', true);
    h.controller.setTrackDisplay('druid', 'rejuvenation', 'bar');
    h.controller.update(world({ ...targetWithHot() }));
    expect(h.barItems.childNodes).toHaveLength(1);
    h.controller.setTracked('druid', 'rejuvenation', false);
    h.controller.update(world({ ...targetWithHot() }));
    expect(h.barItems.childNodes).toHaveLength(0);
  });

  it('moves a tracker between groups when its type is flipped', () => {
    const h = harness();
    h.controller.setTracked('druid', 'rejuvenation', true);
    h.controller.setTrackDisplay('druid', 'rejuvenation', 'bar');
    h.controller.update(world({ ...targetWithHot() }));
    expect(h.barItems.childNodes).toHaveLength(1);
    h.controller.setTrackDisplay('druid', 'rejuvenation', 'square');
    h.controller.update(world({ ...targetWithHot() }));
    expect(h.barItems.childNodes).toHaveLength(0);
    expect(h.squareItems.childNodes).toHaveLength(1);
  });
});

describe('SkillTrackerController: the entry-rebuild cadence', () => {
  it('does NOT rebuild when `known` is a fresh array of the same data each frame', () => {
    // Exactly what the online ClientWorld mirror does every snapshot: reference
    // identity would rebuild every frame, so the freshness walk must be by value.
    const h = harness();
    h.controller.setTracked('druid', 'rejuvenation', true);
    const frame = () =>
      h.controller.update(
        world({ known: [{ def: { id: 'rejuvenation' }, cooldown: 0 }], ...targetWithHot() }),
      );
    frame();
    const node = h.squareItems.childNodes[0];
    expect(node).toBeDefined();
    // Behavioral proof: the painted node stays the SAME pooled node across frames,
    // which only holds if the entry list (and so the slot key) never churned.
    for (let i = 0; i < 3; i++) frame();
    expect(h.squareItems.childNodes).toHaveLength(1);
    expect(h.squareItems.childNodes[0]).toBe(node);
  });

  it('re-derives the sweep length when a talent shortens the resolved cooldown', () => {
    const h = harness();
    h.controller.setTracked('druid', 'entangling_roots', true);
    const cooldowns = new Map([['entangling_roots', 5]]);
    const base = {
      player: { targetId: null, auras: [], cooldowns },
      entities: new Map(),
    };
    // 5s left of a 20s cooldown -> a quarter sweep.
    h.controller.update(
      world({ ...base, known: [{ def: { id: 'entangling_roots' }, cooldown: 20 }] }),
    );
    expect(h.calls).toContainEqual(
      expect.objectContaining({ m: 'setStyleProp', args: ['--st-fill', '25.00%'] }),
    );
    // A talent halves it to 10s -> the same 5s now reads as a half sweep.
    h.controller.update(
      world({ ...base, known: [{ def: { id: 'entangling_roots' }, cooldown: 10 }] }),
    );
    expect(h.calls).toContainEqual(
      expect.objectContaining({ m: 'setStyleProp', args: ['--st-fill', '50.00%'] }),
    );
  });

  it('drops a tracker whose ability is no longer learned', () => {
    const h = harness();
    h.controller.setTracked('druid', 'rejuvenation', true);
    h.controller.setTrackDisplay('druid', 'rejuvenation', 'bar');
    h.controller.update(world({ ...targetWithHot() }));
    expect(h.barItems.childNodes).toHaveLength(1);
    // The ability left `known` (a spec change / respec): the frame goes with it.
    h.controller.update(world({ ...targetWithHot(), known: [] }));
    expect(h.barItems.childNodes).toHaveLength(0);
  });
});
