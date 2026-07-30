// Skills Manager tracker painter: the no-raw-write + no-magic source guards, and
// an end-to-end pool proof over a tiny fake DOM (no jsdom).
//
// It holds the same contract auras_painter does, so it is tested the same way: the
// tooltip attaches ONCE per pooled node, a recycled node renders the NEW tracker's
// LIVE data (never a captured value), a steady-state frame moves no node and
// re-resolves no icon, and the two displays route into their own group with their
// own free list so a square is never recycled into a bar.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { SkillTrackerPainter, type SkillTrackerPainterDeps } from '../src/ui/skill_tracker_painter';
import type { SkillTrackerSlot, SkillTrackerState } from '../src/ui/skill_tracker_view';
import { FakeDocument, type FakeElement } from './helpers/fake_dom';

// ---------------------------------------------------------------------------
// Source guards
// ---------------------------------------------------------------------------

describe('SkillTrackerPainter: no raw DOM writes, no magic values', () => {
  const src = readFileSync(new URL('../src/ui/skill_tracker_painter.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw style / textContent / setAttribute / setProperty / innerHTML write', () => {
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
    expect(code).not.toMatch(/\.setProperty\b/);
    expect(code).not.toMatch(/\.innerHTML\b/);
    expect(code).not.toMatch(/\.className\b/);
    expect(code).not.toMatch(/\.dataset\b/);
    // No listener churn on a per-frame painter: the tooltip attaches once in
    // createNode through the injected helper.
    expect(code).not.toMatch(/addEventListener/);
    // EXACTLY one .classList, the single build-time write in createNode's div()
    // helper. Every child's class funnels through it, so a per-frame class write
    // (the shape that would defeat the elided facet) pushes this above 1.
    expect(code.match(/\.classList\b/g) ?? []).toHaveLength(1);
  });

  it('reads no layout property, so it can never thrash layout per frame', () => {
    for (const token of [
      'offsetWidth',
      'offsetHeight',
      'clientWidth',
      'clientHeight',
      'getBoundingClientRect',
      'getComputedStyle',
    ]) {
      expect(code, `must not read ${token}`).not.toMatch(new RegExp(`\\.${token}\\b`));
    }
  });

  it('carries no literal hex / rgb / px value', () => {
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(code.match(/\brgba?\s*\(/g) ?? []).toEqual([]);
    expect(code.match(/\b\d+px\b/g) ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The shared hand-rolled fake DOM (tests/helpers/fake_dom.ts) + a recording facet
// drive the real painter. No jsdom: the painter only needs createElement, the
// class list, and the childNodes / firstChild / nextSibling / insertBefore order
// surface the keyed reconcile walks.
// ---------------------------------------------------------------------------

type Call = { m: keyof PainterHostWriters; el: unknown; args: unknown[] };
function recordingFacet() {
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
  return { calls, writers };
}

function slot(over: Partial<SkillTrackerSlot> & { abilityId: string }): SkillTrackerSlot {
  const display = over.display ?? 'bar';
  return {
    key: `${display}:${over.abilityId}`,
    display,
    source: 'target',
    tone: 'debuff',
    remaining: 6,
    remainingText: '6.0',
    name: `name:${over.abilityId}`,
    fraction: 0.5,
    stacksText: '',
    ...over,
  };
}

function state(slots: SkillTrackerSlot[]): SkillTrackerState {
  return { slots, count: slots.length };
}

describe('SkillTrackerPainter: keyed pool over the elided writers', () => {
  let doc: FakeDocument;
  let squares: FakeElement;
  let bars: FakeElement;
  let calls: Call[];
  let attached: Array<{ el: unknown; html: () => string }>;
  let iconUrl: ReturnType<typeof vi.fn<(id: string) => string>>;
  let painter: SkillTrackerPainter;

  beforeEach(() => {
    doc = new FakeDocument();
    squares = doc.createElement('div');
    bars = doc.createElement('div');
    const facet = recordingFacet();
    calls = facet.calls;
    attached = [];
    iconUrl = vi.fn((id: string) => `url(${id})`);
    const deps: SkillTrackerPainterDeps = {
      resolveIconUrl: (id) => iconUrl(id),
      renderTooltip: (name, remaining, source) => `${name}|${remaining}|${source}`,
      attachTooltip: (el, html) => {
        attached.push({ el, html });
      },
    };
    painter = new SkillTrackerPainter(
      facet.writers,
      squares as unknown as HTMLElement,
      bars as unknown as HTMLElement,
      deps,
      doc as unknown as Document,
    );
  });

  it('routes each display into its own group', () => {
    painter.paint(
      state([
        slot({ abilityId: 'rejuvenation', display: 'bar' }),
        slot({ abilityId: 'entangle', display: 'square' }),
      ]),
    );
    expect(bars.childNodes).toHaveLength(1);
    expect(squares.childNodes).toHaveLength(1);
    expect(bars.childNodes[0].classList.contains('st-bar')).toBe(true);
    expect(squares.childNodes[0].classList.contains('st-square')).toBe(true);
  });

  it('builds the bar with an icon, a fill, a countdown and a name label', () => {
    painter.paint(state([slot({ abilityId: 'rejuvenation', display: 'bar' })]));
    const row = bars.childNodes[0];
    // icon + track
    expect(row.childNodes.map((c) => c.classList.toString())).toEqual([
      'st-bar-icon',
      'st-bar-track',
    ]);
    const track = row.childNodes[1];
    expect(track.childNodes.map((c) => c.classList.toString())).toEqual([
      'st-bar-fill',
      'st-bar-time',
      'st-bar-name',
      'st-bar-stacks',
    ]);
    // The name label is written for a bar (it has room for one).
    expect(calls.filter((c) => c.m === 'setText').map((c) => c.args[0])).toContain(
      'name:rejuvenation',
    );
  });

  it('builds the square as the icon itself, with a sweep and no name label', () => {
    painter.paint(state([slot({ abilityId: 'entangle', display: 'square' })]));
    const node = squares.childNodes[0];
    expect(node.childNodes.map((c) => c.classList.toString())).toEqual([
      'st-sweep',
      'st-time',
      'st-stacks',
    ]);
    // The icon background is written to the square node itself, not a child.
    const icon = calls.find((c) => c.m === 'setStyleProp' && c.args[0] === 'background-image');
    expect(icon?.el).toBe(node);
    // No name text: the only setText values are the countdown (the stacks badge is
    // hidden, so its text is never written).
    expect(calls.filter((c) => c.m === 'setText').map((c) => c.args[0])).toEqual(['6.0']);
  });

  it('writes the fill as a percent custom property and the source as an attribute', () => {
    painter.paint(state([slot({ abilityId: 'rejuvenation', fraction: 0.25, source: 'cooldown' })]));
    expect(calls).toContainEqual(
      expect.objectContaining({ m: 'setStyleProp', args: ['--st-fill', '25.00%'] }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ m: 'setAttr', args: ['data-source', 'cooldown'] }),
    );
    // Tone is a SEPARATE attribute from source: a HoT on your target follows the
    // target but reads as a buff, so the stylesheet must be able to tint on the
    // buff/debuff axis independently of where the aura sits.
    calls.length = 0;
    painter.paint(state([slot({ abilityId: 'rejuvenation', source: 'target', tone: 'buff' })]));
    expect(calls).toContainEqual(
      expect.objectContaining({ m: 'setAttr', args: ['data-source', 'target'] }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ m: 'setAttr', args: ['data-tone', 'buff'] }),
    );
  });

  it('shows the stacks badge only when the view supplied a label', () => {
    painter.paint(state([slot({ abilityId: 'rejuvenation', stacksText: 'x3' })]));
    expect(calls).toContainEqual(expect.objectContaining({ m: 'setDisplay', args: [''] }));
    expect(calls).toContainEqual(expect.objectContaining({ m: 'setText', args: ['x3'] }));
    calls.length = 0;
    painter.paint(state([slot({ abilityId: 'rejuvenation', stacksText: '' })]));
    expect(calls).toContainEqual(expect.objectContaining({ m: 'setDisplay', args: ['none'] }));
    expect(calls.filter((c) => c.m === 'setText').map((c) => c.args[0])).not.toContain('x3');
  });

  it('attaches the tooltip ONCE per pooled node, however many frames run', () => {
    for (let i = 0; i < 5; i++) painter.paint(state([slot({ abilityId: 'rejuvenation' })]));
    expect(attached).toHaveLength(1);
  });

  it('re-resolves the icon only when the node ability changes', () => {
    const iconWrites = () =>
      calls.filter((c) => c.m === 'setStyleProp' && c.args[0] === 'background-image').length;
    painter.paint(state([slot({ abilityId: 'rejuvenation' })]));
    expect(iconUrl).toHaveBeenCalledTimes(1);
    expect(iconWrites()).toBe(1);
    // A steady-state frame re-resolves nothing (the expensive half stays elided).
    painter.paint(state([slot({ abilityId: 'rejuvenation', remainingText: '5.0' })]));
    expect(iconUrl).toHaveBeenCalledTimes(1);
    expect(iconWrites()).toBe(1);
  });

  it('moves no node on a steady-state frame', () => {
    painter.paint(state([slot({ abilityId: 'rejuvenation' }), slot({ abilityId: 'moonfire' })]));
    const before = bars.mutations;
    painter.paint(state([slot({ abilityId: 'rejuvenation' }), slot({ abilityId: 'moonfire' })]));
    expect(bars.mutations).toBe(before);
  });

  it('reorders with the minimum number of moves', () => {
    painter.paint(state([slot({ abilityId: 'rejuvenation' }), slot({ abilityId: 'moonfire' })]));
    const [first, second] = bars.childNodes;
    painter.paint(state([slot({ abilityId: 'moonfire' }), slot({ abilityId: 'rejuvenation' })]));
    expect(bars.childNodes).toEqual([second, first]);
  });

  it('detaches a tracker that goes idle and recycles its node when it returns', () => {
    painter.paint(state([slot({ abilityId: 'rejuvenation' })]));
    const node = bars.childNodes[0];
    painter.paint(state([]));
    expect(bars.childNodes).toHaveLength(0);
    painter.paint(state([slot({ abilityId: 'rejuvenation' })]));
    // Same node object, and NO second tooltip attach: the pool reused it.
    expect(bars.childNodes[0]).toBe(node);
    expect(attached).toHaveLength(1);
  });

  it('renders the NEW tracker data after a recycle, never the captured one', () => {
    // The Top-risk-3 rule: the tooltip closure must read the live record. Frame 1
    // paints Wildbloom; it goes idle; frame 3 recycles the node to Lunar Tempest.
    painter.paint(state([slot({ abilityId: 'rejuvenation', name: 'Wildbloom' })]));
    const tooltip = attached[0].html;
    expect(tooltip()).toBe('Wildbloom|6|target');
    painter.paint(state([]));
    painter.paint(
      state([
        slot({
          abilityId: 'moonfire',
          name: 'Lunar Tempest',
          remaining: 3,
          source: 'cooldown',
        }),
      ]),
    );
    expect(attached).toHaveLength(1);
    expect(tooltip()).toBe('Lunar Tempest|3|cooldown');
  });

  it('never recycles a square node into a bar (the free lists are per display)', () => {
    painter.paint(state([slot({ abilityId: 'entangle', display: 'square' })]));
    const squareNode = squares.childNodes[0];
    painter.paint(state([]));
    // The retired square is on the SQUARE free list only, so a bar must build fresh.
    painter.paint(state([slot({ abilityId: 'rejuvenation', display: 'bar' })]));
    expect(bars.childNodes[0]).not.toBe(squareNode);
    expect(bars.childNodes[0].classList.contains('st-bar')).toBe(true);
    expect(squares.childNodes).toHaveLength(0);
  });

  it('retires the old node when an ability flips its display type', () => {
    painter.paint(state([slot({ abilityId: 'rejuvenation', display: 'bar' })]));
    expect(bars.childNodes).toHaveLength(1);
    painter.paint(state([slot({ abilityId: 'rejuvenation', display: 'square' })]));
    // The bar node is gone and a square took over: no half-migrated node.
    expect(bars.childNodes).toHaveLength(0);
    expect(squares.childNodes).toHaveLength(1);
    expect(squares.childNodes[0].classList.contains('st-square')).toBe(true);
  });
});
