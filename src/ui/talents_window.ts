// Thin DOM painter for the talents & specializations window.
//
// The consumer half of the pure-core + thin-painter split: it paints
// #talents-window from the structured TalentsView (talents_view.ts) and owns the
// interactive wiring (spec/choices tabs, the spec radiogroup, the choice rows,
// and the build/loadout footer). It composes the shared
// PainterHostPresentation bag (only attachTooltip is relevant for this window) plus
// the talents-specific glue Hud injects.
//
// STAGED-EDIT MODEL: the user edits a LOCAL mutable buffer (a `cloneAllocation` of
// the live IWorld.talents). Hud owns that single buffer; this painter reads it via
// `deps.getStage()` and replaces it via `deps.setStage()`, and the mutation handlers
// (setSpec / row pick / footer reset) mutate that same object IN PLACE before
// re-deriving + repainting. The build only commits to the server-authoritative
// IWorld on save / loadout-switch / delete (deps.saveLoadout / switchLoadout /
// deleteLoadout), never inline. The painter never clones a second buffer of its own.
//
// No raw hex: inline colors reference --color-* custom properties via TAL_COLOR.
// No em dashes anywhere (the mastery / choice separator is ASCII " - ").

import {
  cloneAllocation,
  exportBuild,
  FIRST_TALENT_LEVEL,
  importBuild,
  type SavedLoadout,
  type TalentAllocation,
  talentsFor,
  validateAllocation,
} from '../sim/content/talents';
import { ABILITIES } from '../sim/data';
import { MAX_LEVEL, type PlayerClass } from '../sim/types';
import { buildChoiceRowsView } from './choice_rows_view';
import { markDialogRoot } from './dialog_root';
import { classDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';
import { iconDataUrl } from './icons';
import type { PainterHostPresentation } from './painter_host';
import { rovingTarget } from './roving_index';
import { roleLabel, tTalent } from './talent_i18n';
import { buildTalentsView, type TalentsView } from './talents_view';
import { svgIcon } from './ui_icons';

/**
 * Hud-supplied glue. attachTooltip comes from the shared PainterHostPresentation
 * bag; the rest is talents-specific: the host owns the #talents-window element, the
 * single staged edit buffer (getStage/setStage), the world reads that seed + gate the
 * buffer, the loadout commit surface, and the shared HUD chrome components (dropdown
 * + dialogs + error toast). The module never reaches into Hud directly.
 */
export interface TalentsWindowDeps extends PainterHostPresentation {
  /** The #talents-window root (Hud owns the id; the painter stays instance-parameterized). */
  root(): HTMLElement;
  hideTooltip(): void;
  // Focus management (WCAG 2.2 AA): capture the opener on open, restore it on close.
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  // The host-owned staged edit buffer (a clone of IWorld.talents); NOT IWorld-derived.
  getStage(): TalentAllocation | null;
  setStage(stage: TalentAllocation | null): void;
  // World reads: the seed + player level + the saved loadouts. Read, not mutated.
  playerClass(): PlayerClass;
  playerLevel(): number;
  currentAllocation(): TalentAllocation;
  activeLoadout(): number;
  loadouts(): readonly SavedLoadout[];
  /** The current per-class action-bar ability ids, for saving alongside a build. */
  currentBar(): (string | null)[];
  // Loadout commit surface (server-authoritative IWorld; the only commit path).
  saveLoadout(name: string, bar: (string | null)[], alloc: TalentAllocation): void;
  switchLoadout(index: number): void;
  deleteLoadout(index: number): void;
  applyLoadoutBar(bar: (string | null)[]): void;
  // Shared HUD chrome components.
  buildDropdown(
    options: { value: string; label: string }[],
    current: string,
    onChange: (value: string) => void,
    placeholder: string,
    a11y: { ariaLabel?: string; labelledBy?: string },
  ): HTMLElement;
  inputDialog(opts: {
    title: string;
    label?: string;
    value?: string;
    placeholder?: string;
    multiline?: boolean;
    readOnly?: boolean;
    copy?: boolean;
    selectText?: boolean;
    okText?: string;
    cancelText?: string;
    onOk?: (value: string) => void;
  }): void;
  confirmDialog(
    title: string,
    body: string,
    okText: string,
    cancelText: string,
    onOk: () => void,
  ): void;
  showError(text: string): void;
}

// Talent palette: CSS custom properties (no raw hex in the painter).
// classAccent/signature reuse existing tokens; the rest are --color-talent-* tokens
// added in tokens.css with the exact pre-existing hex so render stays byte-identical.
const TAL_COLOR = {
  classAccent: 'var(--color-text-muted)',
  signature: 'var(--gold)',
  choiceSel: 'var(--gold)',
  choiceDim: 'var(--color-talent-opt-dim)',
  hint: 'var(--color-talent-hint)',
  dormant: 'var(--color-talent-dormant)',
} as const;

function signatureName(abilityId: string): string {
  return ABILITIES[abilityId]
    ? tEntity({ kind: 'ability', id: abilityId, field: 'name' })
    : abilityId;
}

function rowChoiceIconDataUrl(option: { icon: string }): string {
  return iconDataUrl('ability', option.icon);
}

function cloneContractAllocation(alloc: TalentAllocation): TalentAllocation {
  const cloned = cloneAllocation(alloc);
  return { spec: cloned.spec, rows: { ...(cloned.rows ?? {}) } } as TalentAllocation;
}

export class TalentsWindow {
  private tab: 'spec' | 'choices' = 'choices';
  // The element to refocus when the window closes (WCAG 2.2 AA focus return).
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly deps: TalentsWindowDeps) {}

  /** Open the window: seed a fresh staged buffer from the live build, paint, show. */
  open(): void {
    this.returnFocus = this.deps.captureFocus();
    this.tab = 'choices';
    this.deps.setStage(cloneContractAllocation(this.deps.currentAllocation()));
    this.render();
    this.deps.root().style.display = 'block';
  }

  /** Close the window: hide, drop the tooltip, discard the buffer, restore focus. */
  close(): void {
    const el = this.deps.root();
    el.style.display = 'none';
    this.deps.hideTooltip();
    this.deps.setStage(null);
    const target = this.returnFocus;
    this.returnFocus = null;
    this.deps.restoreFocus(target);
  }

  render(): void {
    const el = this.deps.root();
    // Early-return when hidden AND no staged buffer (nothing to repaint).
    if (el.style.display !== 'block' && this.deps.getStage() === null) return;
    // WCAG 2.2 AA: name the focus-trapped root so AT users entering the trap
    // land on a labeled dialog, not an anonymous group. innerHTML below replaces the
    // children, not these own-element attributes, so setting them once per render is
    // idempotent and covers both the coming-soon and the populated branch.
    markDialogRoot(el, { label: t('game.talents.title') });
    const cls = this.deps.playerClass();
    // A real <button> close (was a non-focusable <span>): keyboard-reachable and named,
    // matching the sibling cold windows. focusFirst skips [data-close] on open.
    const close = `<button type="button" class="x-btn" data-close aria-label="${esc(t('game.talents.close'))}">${svgIcon('close')}</button>`;
    if (!talentsFor(cls)) {
      el.innerHTML =
        `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:${TAL_COLOR.classAccent};font-size:11px">${esc(classDisplayName(cls))}</span></span>${close}</div>` +
        `<div class="tal-empty tal-coming-soon" data-talents-coming-soon>` +
        `<b>${t('game.talents.comingSoonTitle')}</b>` +
        `<span>${t('game.talents.comingSoonBody')}</span>` +
        `</div>`;
      el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
      return;
    }
    // Create-on-first-open: ensure the staged buffer exists, seeded from the live build.
    let stage = this.deps.getStage();
    if (!stage) {
      stage = cloneContractAllocation(this.deps.currentAllocation());
      this.deps.setStage(stage);
    }
    const playerLevel = this.deps.playerLevel();
    const view = buildTalentsView(stage, cls, playerLevel);

    el.innerHTML =
      `<div class="panel-title"><span>${t('game.talents.title')} <span style="color:${TAL_COLOR.classAccent};font-size:11px">${esc(classDisplayName(cls))}</span></span>${close}</div>` +
      `<div class="tal-head"><span>${t('game.talents.choicesTab')}: <b>${view.rowsPicked}</b> / ${view.rowsUnlocked}</span></div>` +
      `<div class="tal-help">${esc(t('game.talents.pointSource').replace('{first}', String(FIRST_TALENT_LEVEL)).replace('{cap}', String(MAX_LEVEL)))}</div>` +
      `<div class="tal-tabs" role="tablist" aria-label="${esc(t('game.talents.title'))}">` +
      `<div class="tal-tab${this.tab === 'spec' ? ' active' : ''}" role="tab" tabindex="${this.tab === 'spec' ? '0' : '-1'}" aria-selected="${this.tab === 'spec'}" aria-controls="tal-body" data-tab="spec"><span class="tal-tab-label">${t('game.talents.specTab')}</span></div>` +
      `<div class="tal-tab${this.tab === 'choices' ? ' active' : ''}" role="tab" tabindex="${this.tab === 'choices' ? '0' : '-1'}" aria-selected="${this.tab === 'choices'}" aria-controls="tal-body" data-tab="choices"><span class="tal-tab-label">${t('game.talents.choicesTab')}</span><span class="tt-pts">${view.rowsPicked}/${view.rowsUnlocked}</span></div>` +
      `</div><div id="tal-body" role="tabpanel"></div>` +
      this.footerHtml(view);

    const switchTab = (tab: HTMLElement): void => {
      this.tab = tab.dataset.tab as 'spec' | 'choices';
      this.render();
    };
    // WAI-ARIA tabs: roving arrow navigation (Left/Right/Home/End) plus Enter/Space.
    // switchTab re-renders the window; the root persists, so focus the freshly active
    // tab afterward to keep the roving-tabindex focus on the selected tab.
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('.tal-tab'));
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => switchTab(tab));
      tab.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const next = rovingTarget(ke.key, i, tabs.length, 'horizontal');
        if (next !== null) {
          ke.preventDefault();
          const target = tabs[next];
          if (target && target !== tab) {
            switchTab(target);
            (el.querySelector('.tal-tab.active') as HTMLElement | null)?.focus();
          }
          return;
        }
        this.keyboardActivate(ke, () => switchTab(tab));
      });
    });
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());

    const body = el.querySelector('#tal-body') as HTMLElement;
    if (this.tab === 'choices') {
      this.paintChoiceRows(body, stage);
    } else {
      this.paintSpecTab(body, view, stage);
    }
    this.wireFooter(el, stage, playerLevel);
  }

  private paintChoiceRows(body: HTMLElement, stage: TalentAllocation): void {
    const cls = this.deps.playerClass();
    const level = this.deps.playerLevel();
    const rowsView = buildChoiceRowsView(cls, level, stage.rows ?? {});
    const wrap = document.createElement('div');
    wrap.className = 'tal-rows';
    for (const [rowIndex, row] of rowsView.rows.entries()) {
      const rowEl = document.createElement('div');
      rowEl.className = `tal-row${row.unlocked ? '' : ' locked'}`;
      const head = document.createElement('div');
      head.className = 'tal-row-head';
      head.innerHTML =
        `<span class="tal-row-lvl">${row.level}</span>` +
        (row.unlocked
          ? ''
          : `<span class="tal-row-lock">${esc(
              t('game.talents.rowUnlocks').replace('{level}', String(row.level)),
            )}</span>`);
      rowEl.appendChild(head);
      const opts = document.createElement('div');
      opts.className = 'tal-row-opts';
      opts.setAttribute('role', 'radiogroup');
      opts.setAttribute('aria-label', `${t('game.talents.choicesTab')} ${row.level}`);
      const rowOptCards: HTMLElement[] = [];
      const pickedIndex = row.options.findIndex((opt) => opt.picked);
      const rovingIndex = pickedIndex >= 0 ? pickedIndex : 0;
      for (const [optionIndex, { option, picked }] of row.options.entries()) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `tal-row-opt${picked ? ' sel' : ''}`;
        card.setAttribute('role', 'radio');
        card.setAttribute('tabindex', row.unlocked && optionIndex === rovingIndex ? '0' : '-1');
        card.setAttribute('aria-checked', String(picked));
        card.disabled = !row.unlocked;
        const label = tTalent({ kind: 'talentChoice', choice: option, field: 'name' });
        const description = tTalent({ kind: 'talentChoice', choice: option, field: 'description' });
        card.innerHTML =
          `<span class="tco-icon" style="background-image:url(${esc(
            rowChoiceIconDataUrl(option),
          )})"></span>` + `<span class="tal-row-opt-name">${esc(label)}</span>`;
        this.deps.attachTooltip(card, () => {
          let html = `<div class="tt-name">${esc(label)}</div>`;
          html += `<div class="tt-desc">${esc(description)}</div>`;
          if (!row.unlocked) {
            html += `<div class="tt-sub" style="color:${TAL_COLOR.dormant}">${esc(
              t('game.talents.rowUnlocks').replace('{level}', String(row.level)),
            )}</div>`;
          }
          return html;
        });
        card.addEventListener('click', () => {
          if (!row.unlocked || picked) return;
          this.pickRowChoice(stage, row.level, option.id);
        });
        card.addEventListener('keydown', (e) => {
          const ke = e as KeyboardEvent;
          const i = rowOptCards.indexOf(card);
          const next = rovingTarget(ke.key, i, rowOptCards.length, 'both');
          if (next !== null) {
            ke.preventDefault();
            this.pickRowChoice(stage, row.level, row.options[next].option.id);
            (
              this.deps
                .root()
                .querySelectorAll('.tal-row-opts')
                [rowIndex]?.querySelector('.tal-row-opt.sel') as HTMLElement | null
            )?.focus();
            return;
          }
          this.keyboardActivate(ke, () => this.pickRowChoice(stage, row.level, option.id));
        });
        rowOptCards.push(card);
        opts.appendChild(card);
      }
      rowEl.appendChild(opts);
      wrap.appendChild(rowEl);
    }
    body.appendChild(wrap);
  }

  private paintSpecTab(body: HTMLElement, view: TalentsView, stage: TalentAllocation): void {
    const picker = document.createElement('div');
    picker.className = 'tal-specs';
    picker.setAttribute('role', 'radiogroup');
    picker.setAttribute('aria-label', t('game.talents.specTab'));
    // WAI-ARIA radiogroup: arrow keys move focus among the spec radios and select on
    // move (setSpec re-renders; the root persists, so focus the new selected card).
    const specCards: { el: HTMLElement; id: string }[] = [];
    for (const specVM of view.specs) {
      const sp = specVM.spec;
      const card = document.createElement('div');
      const selected = specVM.selected;
      card.className = `tal-spec${selected ? ' sel' : ''}`;
      card.setAttribute('role', 'radio');
      card.setAttribute('tabindex', selected || !stage.spec ? '0' : '-1');
      card.setAttribute('aria-checked', String(selected));
      const specName = tTalent({ kind: 'talentSpec', spec: sp, field: 'name' });
      const specDescription = tTalent({ kind: 'talentSpec', spec: sp, field: 'description' });
      const masteryName = tTalent({ kind: 'talentMastery', spec: sp, field: 'name' });
      const masteryDescription = tTalent({ kind: 'talentMastery', spec: sp, field: 'description' });
      card.setAttribute('aria-label', `${specName}, ${roleLabel(sp.role)}`);
      card.innerHTML = `<div class="ts-icon">${esc(sp.icon)}</div><div class="ts-name">${esc(specName)}</div><div class="ts-role">${roleLabel(sp.role)}</div>`;
      this.deps.attachTooltip(
        card,
        () =>
          `<div class="tt-title">${esc(specName)}</div><div class="tt-sub">${esc(specDescription)}</div>` +
          `<div class="tt-sub" style="color:${TAL_COLOR.signature}">${t('game.talents.signature')}: ${esc(signatureName(sp.signature))}</div>` +
          `<div class="tt-sub">${t('game.talents.mastery')}: ${esc(masteryName)} - ${esc(masteryDescription)}</div>`,
      );
      card.addEventListener('click', () => this.setSpec(stage, sp.id));
      card.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        const i = specCards.findIndex((c) => c.el === card);
        const next = rovingTarget(ke.key, i, specCards.length, 'both');
        if (next !== null) {
          ke.preventDefault();
          this.setSpec(stage, specCards[next].id);
          (this.deps.root().querySelector('.tal-spec.sel') as HTMLElement | null)?.focus();
          return;
        }
        this.keyboardActivate(ke, () => this.setSpec(stage, sp.id));
      });
      specCards.push({ el: card, id: sp.id });
      picker.appendChild(card);
    }
    body.appendChild(picker);
    if (!stage.spec) {
      const e = document.createElement('div');
      e.className = 'tal-empty';
      e.textContent = t('game.talents.chooseSpec');
      body.appendChild(e);
    }
  }

  private setSpec(stage: TalentAllocation, specId: string): void {
    if (stage.spec === specId) return;
    stage.spec = specId;
    this.render();
  }

  private pickRowChoice(stage: TalentAllocation, level: number, optionId: string): void {
    if (stage.rows?.[level] === optionId) return;
    // Stage the pick; the footer Apply commits the whole allocation through the
    // one authoritative path (the server re-validates every level gate).
    stage.rows = { ...(stage.rows ?? {}), [level]: optionId };
    this.deps.hideTooltip();
    this.render();
  }

  private footerHtml(view: TalentsView): string {
    const valid = view.valid;
    return (
      `<div class="tal-foot">` +
      `<section class="tal-build-card tal-build-current" aria-label="${esc(t('game.talents.currentBuild'))}">` +
      `<div class="tal-build-head"><span>${t('game.talents.currentBuild')}</span><span class="tal-loadslot"></span></div>` +
      `<div class="tal-build-actions">` +
      `<button class="btn tal-primary" data-act="save"${valid ? '' : ' disabled'}>${t('game.talents.saveBuild')}</button>` +
      `<button class="btn tal-secondary" data-act="export">${t('game.talents.export')}</button>` +
      `<button class="btn tal-secondary" data-act="del"${this.deps.activeLoadout() >= 0 ? '' : ' disabled'}>${t('game.talents.deleteBuild')}</button>` +
      `<button class="btn tal-secondary" data-act="clear"${view.rowsPicked > 0 ? '' : ' disabled'}>${t('game.talents.clear')}</button>` +
      `</div>` +
      `<div class="tal-build-help">${t('game.talents.currentBuildHint')}</div>` +
      `</section>` +
      `<section class="tal-build-card tal-build-create" aria-label="${esc(t('game.talents.createBuild'))}">` +
      `<div class="tal-build-head"><span>${t('game.talents.createBuild')}</span></div>` +
      `<div class="tal-build-actions">` +
      `<button class="btn tal-primary" data-act="new"${valid ? '' : ' disabled'}>${t('game.talents.newBuild')}</button>` +
      `<button class="btn tal-secondary" data-act="import">${t('game.talents.import')}</button>` +
      `</div>` +
      `<div class="tal-build-help">${t('game.talents.createBuildHint')}</div>` +
      `</section>` +
      `</div>`
    );
  }

  private wireFooter(el: HTMLElement, stage: TalentAllocation, playerLevel: number): void {
    const cls = this.deps.playerClass();
    el.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
      stage.rows = {};
      this.render();
    });
    const saveStagedBuild = (name: string): void => {
      const n = name.trim();
      if (!n) return;
      this.deps.saveLoadout(n, this.deps.currentBar(), cloneContractAllocation(stage));
      this.deps.setStage(cloneContractAllocation(stage));
      this.render();
    };
    const promptNewBuild = (): void => {
      this.deps.inputDialog({
        title: t('game.talents.saveBuildAs'),
        label: t('game.talents.namePrompt'),
        value: t('hudChrome.talents.defaultBuildName', { n: this.deps.loadouts().length + 1 }),
        okText: t('game.talents.save'),
        selectText: true,
        onOk: saveStagedBuild,
      });
    };
    el.querySelector('[data-act="save"]')?.addEventListener('click', () => {
      if (!validateAllocation(cls, stage, playerLevel).ok) {
        this.deps.showError(t('game.talents.buildInvalid'));
        return;
      }
      const activeLoadout = this.deps.activeLoadout();
      const active = activeLoadout >= 0 ? this.deps.loadouts()[activeLoadout] : null;
      if (active) saveStagedBuild(active.name);
      else promptNewBuild();
    });
    el.querySelector('[data-act="new"]')?.addEventListener('click', () => {
      if (!validateAllocation(cls, stage, playerLevel).ok) {
        this.deps.showError(t('game.talents.buildInvalid'));
        return;
      }
      promptNewBuild();
    });
    // in-app loadout dropdown (shared component, no native <select>)
    const slot = el.querySelector('.tal-loadslot');
    if (slot) {
      const loadouts = this.deps.loadouts();
      const activeLoadout = this.deps.activeLoadout();
      const opts = loadouts.length
        ? loadouts.map((l, i) => ({ value: String(i), label: l.name }))
        : [{ value: '-1', label: t('game.talents.noBuilds') }];
      const current = activeLoadout >= 0 ? String(activeLoadout) : loadouts.length ? '' : '-1';
      slot.replaceWith(
        this.deps.buildDropdown(
          opts,
          current,
          (v) => {
            const i = parseInt(v, 10);
            const lo = this.deps.loadouts()[i];
            if (!lo) return;
            this.deps.switchLoadout(i);
            this.deps.applyLoadoutBar(lo.bar);
            this.deps.setStage(cloneContractAllocation(lo.alloc));
            this.render();
          },
          t('game.talents.loadouts'),
          { ariaLabel: t('game.talents.loadouts') },
        ),
      );
    }
    el.querySelector('[data-act="del"]')?.addEventListener('click', () => {
      const activeLoadout = this.deps.activeLoadout();
      if (activeLoadout < 0) {
        this.deps.showError(t('game.talents.selectBuildFirst'));
        return;
      }
      const active = this.deps.loadouts()[activeLoadout];
      if (!active) {
        this.deps.showError(t('game.talents.selectBuildFirst'));
        return;
      }
      const body = t('game.talents.deleteBuildBody', { name: active.name });
      this.deps.confirmDialog(
        t('game.talents.deleteBuildTitle'),
        body,
        t('game.talents.deleteBuildConfirm'),
        t('game.talents.cancel'),
        () => {
          this.deps.deleteLoadout(this.deps.activeLoadout());
          this.render();
        },
      );
    });
    el.querySelector('[data-act="export"]')?.addEventListener('click', () => {
      const activeLoadout = this.deps.activeLoadout();
      const active = activeLoadout >= 0 ? this.deps.loadouts()[activeLoadout] : null;
      this.deps.inputDialog({
        title: t('game.talents.export'),
        label: t('game.talents.exportTitle'),
        value: exportBuild(cls, cloneContractAllocation(active?.alloc ?? stage)),
        multiline: true,
        readOnly: true,
        copy: true,
        cancelText: t('game.talents.close'),
      });
    });
    el.querySelector('[data-act="import"]')?.addEventListener('click', () => {
      this.deps.inputDialog({
        title: t('game.talents.import'),
        label: t('game.talents.importPrompt'),
        placeholder: 'eyJ2Ijoy...',
        multiline: true,
        okText: t('game.talents.import'),
        onOk: (str) => {
          const res = importBuild(str.trim());
          if (!res.ok || res.cls !== cls) {
            this.deps.showError(t('game.talents.invalidBuild'));
            return;
          }
          this.deps.setStage(cloneContractAllocation(res.alloc));
          this.render();
        },
      });
    });
  }

  private keyboardActivate(e: KeyboardEvent, action: () => void): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    action();
  }
}
