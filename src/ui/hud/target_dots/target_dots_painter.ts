// Painter for the Target dots frame (#target-dots): one bar row per debuff the
// local player has out, across every enemy in interest range. The reliquary /
// deed tracker contract, verbatim: the static skeleton (a fixed pool of
// TARGET_DOTS_ROW_CAP rows plus the overflow line) is built ONCE with a single
// innerHTML write, and every refresh routes through the PainterHostWriters
// elided facet only (setText / setWidth / setStyleProp / setDisplay / setAttr /
// toggleClass), never innerHTML per frame.
//
// A row is icon + bar + countdown. The bar's fill is the remaining fraction and
// its tint is the aura's magic school (the same --color-debuff-* tokens the aura
// strips use), so a school reads the same wherever it is painted. The label rides
// ON the bar, WoW-tracker style: aura name, then the enemy it is on.
//
// The frame is player-chosen, ALWAYS-actionable information (these are the timers
// a refresh is scheduled against), so nothing here is graphics-tier gated: it is
// governed by the showTargetDots setting alone. See the gameplay-neutral-graphics
// invariant in root CLAUDE.md.

import { formatNumber } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { TARGET_DOTS_ROW_CAP, type TargetDotsState } from './target_dots_view';

const ROW_CLASS = 'td-row';
const TARGET_CLASS = 'td-on-target';
const EXPIRING_CLASS = 'td-expiring';
const SCHOOL_ATTR = 'data-school';
const HIDDEN = 'none';
const SHOWN = '';
const SHOWN_FLEX = 'flex';

export interface TargetDotsPainterDeps {
  /** The #target-dots container (Hud owns the id). */
  root(): HTMLElement;
  /** The shared write-elision facet (Hud's caches; one skip-rate). */
  writers: PainterHostWriters;
  /** Aura artwork identity to a CSS background value. */
  iconBackground(iconKey: string): string;
  /** Localized "<aura> on <target>" row label. */
  rowLabel(auraName: string, targetName: string): string;
  /** Localized accessible name for the whole frame. */
  frameLabel(): string;
  /** Localized "+N more" overflow line. */
  overflowLabel(count: number): string;
  /** Localized seconds suffix for the countdown ('s' in English). */
  secondsSuffix(): string;
}

interface RowEls {
  row: HTMLElement;
  icon: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
  time: HTMLElement;
  stacks: HTMLElement;
  /** Last painted icon key, so the background is resolved only on a change. */
  iconKey: string;
}

export class TargetDotsPainter {
  private readonly root: HTMLElement;
  private readonly rows: RowEls[] = [];
  private readonly overflowEl: HTMLElement;

  constructor(private readonly deps: TargetDotsPainterDeps) {
    this.root = deps.root();
    // Static skeleton, built once: chrome only, no player text (every visible
    // string is painted through the elided writers below).
    const rowHtml =
      `<div class="${ROW_CLASS}" style="display:none">` +
      `<span class="td-icon" aria-hidden="true"></span>` +
      `<span class="td-bar"><span class="td-fill"></span><span class="td-label"></span>` +
      `<span class="td-stacks" style="display:none"></span></span>` +
      `<span class="td-time"></span></div>`;
    this.root.innerHTML = `${rowHtml.repeat(TARGET_DOTS_ROW_CAP)}<div class="td-overflow" style="display:none"></div>`;
    const rowNodes = this.root.querySelectorAll<HTMLElement>(`.${ROW_CLASS}`);
    for (const row of rowNodes) {
      this.rows.push({
        row,
        icon: row.querySelector('.td-icon') as HTMLElement,
        fill: row.querySelector('.td-fill') as HTMLElement,
        label: row.querySelector('.td-label') as HTMLElement,
        time: row.querySelector('.td-time') as HTMLElement,
        stacks: row.querySelector('.td-stacks') as HTMLElement,
        iconKey: '',
      });
    }
    this.overflowEl = this.root.querySelector('.td-overflow') as HTMLElement;
    // The frame is a live region only in the weak sense: it names itself, and a
    // screen reader user reads it on demand rather than being interrupted by
    // every tick. The countdown text is the reason polite would be wrong here.
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', deps.frameLabel());
  }

  /** Re-resolve the frame's localized accessible name (language switch). */
  relocalize(): void {
    this.deps.writers.setAttr(this.root, 'aria-label', this.deps.frameLabel());
  }

  update(state: TargetDotsState): void {
    const w = this.deps.writers;
    // Hidden rather than emptied: an empty bordered box floating over the world
    // is the thing players report as a bug, and the frame is genuinely absent
    // whenever the player has no dots out.
    w.setDisplay(this.root, state.count === 0 ? HIDDEN : SHOWN_FLEX);
    for (let i = 0; i < this.rows.length; i++) {
      const els = this.rows[i];
      if (i >= state.count) {
        w.setDisplay(els.row, HIDDEN);
        continue;
      }
      const model = state.rows[i];
      w.setDisplay(els.row, SHOWN_FLEX);
      if (els.iconKey !== model.iconKey) {
        els.iconKey = model.iconKey;
        w.setStyleProp(els.icon, 'background-image', this.deps.iconBackground(model.iconKey));
      }
      w.setWidth(els.fill, `${Math.round(model.fraction * 1000) / 10}%`);
      w.setAttr(els.fill, SCHOOL_ATTR, model.school || null);
      w.setText(els.label, this.deps.rowLabel(model.auraName, model.targetName));
      w.setText(
        els.time,
        `${formatNumber(model.remaining, {
          minimumFractionDigits: model.decimals,
          maximumFractionDigits: model.decimals,
        })}${this.deps.secondsSuffix()}`,
      );
      w.setDisplay(els.stacks, model.stacks > 0 ? SHOWN : HIDDEN);
      if (model.stacks > 0) w.setText(els.stacks, formatNumber(model.stacks));
      w.toggleClass(els.row, TARGET_CLASS, model.onCurrentTarget);
      w.toggleClass(els.row, EXPIRING_CLASS, model.expiring);
    }
    w.setDisplay(this.overflowEl, state.overflow > 0 ? SHOWN : HIDDEN);
    if (state.overflow > 0) {
      w.setText(this.overflowEl, this.deps.overflowLabel(state.overflow));
    }
  }
}
