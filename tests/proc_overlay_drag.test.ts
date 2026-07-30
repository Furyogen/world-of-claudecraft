// The proc overlay's drag persistence (pure half): viewport-fraction clamping
// and the localStorage round-trip parsing. The DOM attacher is the thin
// consumer (src/ui/proc_overlay_drag.ts).
import { describe, expect, it } from 'vitest';
import {
  attachOverlayDrag,
  clampOverlayAnchor,
  parseOverlayAnchor,
  serializeOverlayAnchor,
} from '../src/ui/proc_overlay_drag';
import { FakeDocument, FakeWindow, pointerEvent } from './helpers/fake_dom';

describe('clampOverlayAnchor', () => {
  it('keeps the whole element on screen', () => {
    // 300x232 element in a 1600x900 viewport: half-width = 150/1600.
    expect(clampOverlayAnchor(0, 0, 300, 232, 1600, 900)).toEqual({
      fx: 150 / 1600,
      fy: 116 / 900,
    });
    expect(clampOverlayAnchor(1, 1, 300, 232, 1600, 900)).toEqual({
      fx: 1 - 150 / 1600,
      fy: 1 - 116 / 900,
    });
  });

  it('passes an in-bounds anchor through unchanged', () => {
    expect(clampOverlayAnchor(0.5, 0.42, 300, 232, 1600, 900)).toEqual({ fx: 0.5, fy: 0.42 });
  });

  it('degrades to center on a degenerate viewport instead of NaN', () => {
    const a = clampOverlayAnchor(Number.NaN, 0.5, 300, 232, 0, 0);
    expect(a.fx).toBe(0.5);
    expect(Number.isFinite(a.fy)).toBe(true);
  });
});

describe('parse / serialize round-trip', () => {
  it('round-trips a stored anchor', () => {
    const a = { fx: 0.31, fy: 0.77 };
    expect(parseOverlayAnchor(serializeOverlayAnchor(a))).toEqual(a);
  });

  it('rejects garbage and out-of-band values', () => {
    expect(parseOverlayAnchor(null)).toBeNull();
    expect(parseOverlayAnchor('not json')).toBeNull();
    expect(parseOverlayAnchor('{"fx":"a","fy":0.5}')).toBeNull();
    expect(parseOverlayAnchor('{"fx":null,"fy":0.5}')).toBeNull();
    // A finite but out-of-range stored value is clamped into 0..1.
    expect(parseOverlayAnchor('{"fx":7,"fy":-3}')).toEqual({ fx: 1, fy: 0 });
  });
});

describe('attachOverlayDrag: the lock gate', () => {
  // The Skills Manager reuses this family for its two tracker groups, gated on the
  // lock button. Locked, a pointerdown must be ignored ENTIRELY: the group is pure
  // read-out, so it must neither move nor swallow the click. The proc overlay
  // passes no options and stays always-draggable, the original behavior.
  const harness = (opts?: Parameters<typeof attachOverlayDrag>[3]) => {
    const doc = new FakeDocument();
    const el = doc.createElement('div');
    el.setRect({ left: 0, top: 0, width: 100, height: 50 });
    const realWindow = (globalThis as { window?: unknown }).window;
    const realStorage = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { window?: unknown }).window = new FakeWindow(1000, 800);
    // No storage: the attacher must tolerate it (every access is try/catch guarded).
    delete (globalThis as { localStorage?: unknown }).localStorage;
    attachOverlayDrag(el as unknown as HTMLElement, 'testAnchor', { fx: 0.5, fy: 0.5 }, opts);
    const restore = () => {
      (globalThis as { window?: unknown }).window = realWindow;
      (globalThis as { localStorage?: unknown }).localStorage = realStorage;
    };
    return { el, restore };
  };

  it('ignores a pointerdown while locked, leaving the element where it was', () => {
    const { el, restore } = harness({ isLocked: () => true });
    try {
      const before = el.style.left;
      el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }));
      el.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 400, clientY: 300 }));
      expect(el.style.left).toBe(before);
      expect(el.classList.contains('dragging')).toBe(false);
    } finally {
      restore();
    }
  });

  it('drags once unlocked, and reads the gate LIVE rather than at attach time', () => {
    let locked = true;
    const { el, restore } = harness({ isLocked: () => locked });
    try {
      const before = el.style.left;
      locked = false;
      el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }));
      expect(el.classList.contains('dragging')).toBe(true);
      el.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 400, clientY: 300 }));
      expect(el.style.left).not.toBe(before);
    } finally {
      restore();
    }
  });

  it('stays draggable with no options at all (the proc overlay call site)', () => {
    const { el, restore } = harness();
    try {
      el.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 }));
      expect(el.classList.contains('dragging')).toBe(true);
    } finally {
      restore();
    }
  });
});
