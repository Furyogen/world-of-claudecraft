// Keyed-pool painter for the Skills Manager HUD trackers: the WeakAuras-style
// cooldown/proc SQUARES and duration BARS the spellbook's manager mode configures.
//
// The consumer half of the pure-core + thin-painter split (the derivation is
// skill_tracker_view.ts, the config model skill_tracker_core.ts). It follows the
// auras_painter discipline verbatim, because the shape of the problem is the same:
//
//  - ONE persistent node per tracker key (display + ability id), kept in a keyed
//    pool and recycled through a free list; never an innerHTML wipe per frame.
//  - EVERY per-frame DOM write goes through the injected PainterHostWriters facet
//    (setStyleProp for the icon + fill, setText for the countdown / name / stacks,
//    setDisplay for the stacks badge, setAttr for the source attribute). The only
//    raw DOM touch is the one-time node construction in createNode().
//  - The expensive icon data-URL resolve is elided behind a lastIconKey diff, so a
//    steady-state frame pays for none of it.
//  - Active nodes are reconciled into their container with the minimum number of
//    insertBefore moves, so a steady-state frame moves no node.
//
// TWO GROUPS, ONE PAINTER. Squares and bars live in separate movable containers
// (the WeakAuras "group" read: a row of icons, a stack of bars), so the painter is
// constructed with both and routes each slot by its display. A slot's pool key
// carries its display, so flipping an ability's type in the manager retires the old
// node and builds one in the other group instead of recycling a mismatched shape.
//
// FAIRNESS: nothing here varies with the graphics tier. A tracker is actionable
// information the player reacts to (a HoT about to fall off, a cooldown coming
// back), so unlike the aura strip's cosmetic buff overflow it is never capped or
// shed on a lower preset (root CLAUDE.md, gameplay-neutral graphics).

import type { PainterHostWriters } from './painter_host';
import type { SkillTrackerDisplay } from './skill_tracker_core';
import type { SkillTrackerSource, SkillTrackerState } from './skill_tracker_view';

// Class / property / attribute names the painter drives. Named, not inlined, so
// the painter references no bare DOM string literal and the stylesheet owns every
// color and size (the no-magic-values painter rule).
const SQUARE_CLASS = 'st-square';
const SQUARE_SWEEP_CLASS = 'st-sweep';
const SQUARE_TIME_CLASS = 'st-time';
const SQUARE_STACKS_CLASS = 'st-stacks';
const BAR_CLASS = 'st-bar';
const BAR_ICON_CLASS = 'st-bar-icon';
const BAR_TRACK_CLASS = 'st-bar-track';
const BAR_FILL_CLASS = 'st-bar-fill';
const BAR_TIME_CLASS = 'st-bar-time';
const BAR_NAME_CLASS = 'st-bar-name';
const BAR_STACKS_CLASS = 'st-bar-stacks';
// What the tracker follows (target aura / own aura / cooldown), for the hover
// tooltip and for any source-specific chrome.
const SOURCE_ATTR = 'data-source';
// How it READS (buff / debuff / cooldown), which is what the stylesheet tints the
// fill from. Separate from the source because a HoT you keep on your target is
// helpful while a DoT on the same target is not (see skill_tracker_view's tone).
const TONE_ATTR = 'data-tone';
const BACKGROUND_IMAGE_PROP = 'background-image';
// The 0..100% of the followed duration still to run. The stylesheet turns it into
// the bar's width and the square's sweep height, so no geometry lives in TS.
const FILL_PROP = '--st-fill';
// The stacks badge persists in the DOM; only its display toggles ('' reverts to
// the stylesheet's shown state, matching the auras_painter convention).
const BADGE_SHOWN = '';
const BADGE_HIDDEN = 'none';
// Percent formatting for the fill custom property. Two decimals keeps a 30-second
// duration's per-frame steps smooth without churning the elided write every frame
// on a very long one.
const FILL_DECIMALS = 2;

/** What the pool needs from the Hud: the icon-URL resolver and the tooltip glue.
 *  Injected so a Node test drives the pool without the icon / i18n runtime. */
export interface SkillTrackerPainterDeps {
  /** Resolve an ability id to a CSS background-image value (host:
   *  `url(${iconDataUrl('ability', id)})`). Called only when a node's ability
   *  changes, never per frame. */
  resolveIconUrl(abilityId: string): string;
  /** Render the hover tooltip from the LIVE pooled record (host: the tt-title /
   *  tt-sub markup). Called lazily on hover. */
  renderTooltip(name: string, remaining: number, source: SkillTrackerSource): string;
  /** Attach a lazily-built tooltip to a node (host: Hud.attachTooltip). Called
   *  ONCE per pooled node; the closure reads the live record. */
  attachTooltip(el: HTMLElement, html: () => string): void;
}

/** One pooled tracker node: the DOM refs plus the LIVE fields the tooltip closure
 *  reads. Updated in place each frame and on recycle, so the once-attached closure
 *  always renders the tracker the node currently shows (the auras_painter Top-risk-3
 *  rule: never capture a value in the closure). */
interface PooledTracker {
  el: HTMLElement;
  /** The element carrying the icon background (the square itself, or the bar's
   *  leading icon child). */
  icon: HTMLElement;
  /** The element whose --st-fill drives the visible progress. */
  fill: HTMLElement;
  time: HTMLElement;
  /** The bar's ability-name label; null on a square (which has no room for one). */
  label: HTMLElement | null;
  stacks: HTMLElement;
  display: SkillTrackerDisplay;
  key: string;
  name: string;
  remaining: number;
  source: SkillTrackerSource;
  /** The last ability whose icon URL was resolved + written, so the expensive
   *  resolve fires only on change. null until the first paint. */
  lastIconId: string | null;
  /** Frame stamp of the last paint that touched this record (the recycle sweep). */
  seen: number;
}

export class SkillTrackerPainter {
  private readonly pool = new Map<string, PooledTracker>();
  // Free lists are PER DISPLAY: a square's DOM shape is not a bar's, so a retired
  // square may only be recycled into another square.
  private readonly free: Record<SkillTrackerDisplay, PooledTracker[]> = { square: [], bar: [] };
  // Reused ordering scratch per group (cleared + refilled each paint), so a
  // per-frame paint allocates no new array.
  private readonly orderedSquares: PooledTracker[] = [];
  private readonly orderedBars: PooledTracker[] = [];
  private frame = 0;

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly squareContainer: HTMLElement,
    private readonly barContainer: HTMLElement,
    private readonly deps: SkillTrackerPainterDeps,
    // Injectable so a Node test drives the pool without a global document.
    private readonly doc: Document = globalThis.document,
  ) {}

  /** Reconcile both groups to this frame's trackers and repaint each in place.
   *  Runs every frame; the elided writers make an unchanged frame cost no DOM
   *  mutation. */
  paint(state: SkillTrackerState): void {
    this.frame++;
    const { slots, count } = state;
    this.orderedSquares.length = 0;
    this.orderedBars.length = 0;
    for (let i = 0; i < count; i++) {
      const slot = slots[i];
      let rec = this.pool.get(slot.key);
      if (!rec) {
        rec = this.free[slot.display].pop() ?? this.createNode(slot.display);
        rec.key = slot.key;
        this.pool.set(slot.key, rec);
      }
      // Update the LIVE fields the tooltip reads BEFORE any DOM write, so a node
      // recycled to a different ability never renders the previous one.
      rec.name = slot.name;
      rec.remaining = slot.remaining;
      rec.source = slot.source;
      rec.seen = this.frame;
      if (rec.lastIconId !== slot.abilityId) {
        rec.lastIconId = slot.abilityId;
        this.writers.setStyleProp(
          rec.icon,
          BACKGROUND_IMAGE_PROP,
          this.deps.resolveIconUrl(slot.abilityId),
        );
      }
      this.writers.setAttr(rec.el, SOURCE_ATTR, slot.source);
      this.writers.setAttr(rec.el, TONE_ATTR, slot.tone);
      this.writers.setStyleProp(
        rec.fill,
        FILL_PROP,
        `${(slot.fraction * 100).toFixed(FILL_DECIMALS)}%`,
      );
      this.writers.setText(rec.time, slot.remainingText);
      if (rec.label) this.writers.setText(rec.label, slot.name);
      const hasStacks = slot.stacksText !== '';
      this.writers.setDisplay(rec.stacks, hasStacks ? BADGE_SHOWN : BADGE_HIDDEN);
      if (hasStacks) this.writers.setText(rec.stacks, slot.stacksText);
      (slot.display === 'square' ? this.orderedSquares : this.orderedBars).push(rec);
    }
    // Recycle records whose tracker went idle this frame: detach to the matching
    // free list (the node's tooltip closure stays attached for reuse). Iterate
    // `.values()` and delete by the record's own key, the auras_painter pattern
    // that avoids the per-entry tuple `for (const [k, v] of map)` allocates.
    for (const rec of this.pool.values()) {
      if (rec.seen !== this.frame) {
        rec.el.remove();
        this.free[rec.display].push(rec);
        this.pool.delete(rec.key);
      }
    }
    this.reconcileOrder(this.squareContainer, this.orderedSquares);
    this.reconcileOrder(this.barContainer, this.orderedBars);
  }

  /** Build one tracker node for a display kind and attach its tooltip ONCE. The
   *  closure reads the returned record's LIVE fields, so it survives recycling. */
  private createNode(display: SkillTrackerDisplay): PooledTracker {
    // One class write, funnelled through this builder, so the whole painter holds
    // exactly one raw-DOM-write token and the perf-budget allowance stays a
    // single documented build-time exception rather than a per-child tally.
    const div = (cls: string): HTMLElement => {
      const node = this.doc.createElement('div');
      node.classList.add(cls);
      return node;
    };
    const isSquare = display === 'square';
    const el = div(isSquare ? SQUARE_CLASS : BAR_CLASS);
    const time = div(isSquare ? SQUARE_TIME_CLASS : BAR_TIME_CLASS);
    const stacks = div(isSquare ? SQUARE_STACKS_CLASS : BAR_STACKS_CLASS);
    let icon: HTMLElement;
    let fill: HTMLElement;
    let label: HTMLElement | null = null;
    if (isSquare) {
      // The square IS the icon; a sweep overlay drains it and the countdown sits
      // on top (the classic cooldown read).
      icon = el;
      fill = div(SQUARE_SWEEP_CLASS);
      el.appendChild(fill);
      el.appendChild(time);
      el.appendChild(stacks);
    } else {
      // The bar: icon, then a track whose fill drains right-to-left with the
      // countdown at its head and the ability name at its tail.
      icon = div(BAR_ICON_CLASS);
      const track = div(BAR_TRACK_CLASS);
      fill = div(BAR_FILL_CLASS);
      label = div(BAR_NAME_CLASS);
      track.appendChild(fill);
      track.appendChild(time);
      track.appendChild(label);
      track.appendChild(stacks);
      el.appendChild(icon);
      el.appendChild(track);
    }
    const rec: PooledTracker = {
      el,
      icon,
      fill,
      time,
      label,
      stacks,
      display,
      key: '',
      name: '',
      remaining: 0,
      source: 'cooldown',
      lastIconId: null,
      seen: 0,
    };
    this.deps.attachTooltip(el, () => this.deps.renderTooltip(rec.name, rec.remaining, rec.source));
    return rec;
  }

  // Walk the desired child sequence against the container's current children,
  // moving a node into place ONLY when it is not already there (the keyed-list
  // reconcile the auras + FCT pools share): O(N) compares and exactly as many
  // insertBefore moves as nodes that actually changed position, zero when nothing
  // moved. Departed records were already detached in paint(), so every move here
  // is a deliberate (re)insert.
  private reconcileOrder(container: HTMLElement, ordered: readonly PooledTracker[]): void {
    let ref: ChildNode | null = container.firstChild;
    for (const rec of ordered) {
      if (rec.el === ref) {
        ref = ref.nextSibling;
      } else {
        container.insertBefore(rec.el, ref);
      }
    }
  }
}
