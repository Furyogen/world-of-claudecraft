// Thin DOM painter for the spellbook window.
//
// The consumer half of the pure-core + thin-painter split: it paints #spellbook
// from the structured SpellbookView (spellbook_view.ts) and owns the window's DOM
// wiring (per-row hotbar toggle, drag-to-bar, tooltips, the per-form reset button,
// the WCAG focus opener). The pure core decides the class kit order + each row's
// learned / rank / on-bar / disabled state; this module renders that, resolves the
// localized name / summary / icon, and routes the hotbar + drag commands back
// through injected callbacks. It holds no Sim reference and reaches into Hud only
// through its deps.
//
// Ability icons resolve via iconDataUrl (the procedural ability-icon source), not
// the PainterHost item-icon helper: that helper paints ItemDef rows, and the
// spellbook renders abilities. It is NOT a canvas window (colors live in the
// extracted stylesheet, no literal hex/px in TS). refreshHotbarControls
// is the one not-cold touch: hud.update() calls it while the window is open so the
// +/- toggles track action-bar changes without a full rebuild.

import { audio } from '../game/audio';
import { ABILITIES, CLASSES } from '../sim/data';
import type { ResolvedAbility } from '../sim/sim';
import type { AbilityDef } from '../sim/types';
import type { IWorld } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { classDisplayName, tEntity } from './entity_i18n';
import { esc } from './esc';
import {
  encodeHotbarAction,
  HOTBAR_ACTION_MIME,
  isAbilityActionBarEligible,
} from './hud/action_bar/hotbar';
import { formatNumber, t } from './i18n';
import { iconDataUrl } from './icons';
import {
  nextSkillTrackerDisplay,
  type SkillTrackerConfig,
  type SkillTrackerDisplay,
} from './skill_tracker_core';
import { buildSpellbookView, type SpellbookRow } from './spellbook_view';
import { svgIcon } from './ui_icons';

/**
 * Hud-supplied glue. The spellbook renders from IWorld + these callbacks; it never
 * reaches into Hud directly. abilitySummary/abilityTooltip resolve the localized
 * ability copy Hud owns; the bar / drag callbacks keep the action-bar state on the
 * HUD; captureFocus/restoreFocus add the WCAG focus-return the inline site lacked.
 */
export interface SpellbookWindowDeps {
  root(): HTMLElement;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  hideTooltip(): void;
  attachTooltip(el: HTMLElement, html: () => string): void;
  /** describeAbilitySummary(known, player.resourceType), localized Hud-side. */
  abilitySummary(known: ResolvedAbility): string;
  /** The full ability tooltip markup (Hud-owned). */
  abilityTooltip(known: ResolvedAbility): string;
  /** Ability ids currently on the action bar. */
  barAbilityIds(): string[];
  /** The hotbar's ability id per bar slot (index 0 = barSlot 1), used to derive
   *  each row's mobile action-ring page (Phase 4, touch-only presentation). */
  abilityIdByBarSlot(): (string | null)[];
  /** The action bar has at least one empty slot. */
  hasFreeSlot(): boolean;
  /** The Attack toggle currently occupies bar slot 0 (showAttackButton on). */
  attackOnBar(): boolean;
  /** Restore (true) or remove (false) the Attack toggle on bar slot 0; routes
   *  through the same Interface showAttackButton setting the options window and
   *  the slot's right-click use, so all three controls stay one state. */
  setAttackOnBar(on: boolean): void;
  /** Place an ability on the first free slot; returns whether it changed. */
  addToBar(abilityId: string): boolean;
  /** Remove an ability from the bar; returns whether it changed. */
  removeFromBar(abilityId: string): boolean;
  /** The class has per-form bars (druid), enabling the reset-bar button. */
  hasFormBars(): boolean;
  /** Reset the active form bar to its default kit. */
  resetFormBar(): void;
  setDragAction(action: { type: 'ability'; id: string } | null): void;
  clearActionDropTargets(): void;
  // --- Skills Manager (the alternate spellbook + the HUD trackers it drives) ---
  /** Manager mode is on: the spell list also renders each trackable row's display
   *  toggle and tracker-type button. Persisted by Hud as an Interface setting. */
  managerMode(): boolean;
  /** Turn manager mode on/off. Toggling it OFF also hides every tracker frame and
   *  bar (the Hud stops painting them), which is the master switch the owner
   *  asked for. */
  setManagerMode(on: boolean): void;
  /** Whether the HUD tracker frames are locked in place. */
  trackersLocked(): boolean;
  /** Lock (true) or unlock (false) the tracker frames for dragging. */
  setTrackersLocked(locked: boolean): void;
  /** The player's stored per-ability tracker selection for the current class. */
  tracking(): SkillTrackerConfig;
  /** Turn one ability's tracker display on/off (the manager's first button). */
  setTracked(abilityId: string, tracked: boolean): void;
  /** Set one ability's tracker type (the manager's second button). */
  setTrackDisplay(abilityId: string, display: SkillTrackerDisplay): void;
}

export class SpellbookWindow {
  private openerFocus: HTMLElement | null = null;
  // Signature of the resolved abilities the last render painted (id/rank/cost/
  // cast/cooldown). Talent allocation while the window is open reassigns
  // world.known with new numbers; comparing this per frame lets tickOpen rebuild
  // the row summaries so their cost/cast/cooldown never go stale (tooltip parity).
  private lastKnownSig = '';

  constructor(private readonly deps: SpellbookWindowDeps) {}

  // Cheap content signature of the fields a row summary displays. Reference
  // equality on world.known will not do: the online mirror rebuilds that array
  // every snapshot, so only the VALUES tell us a talent actually changed a number.
  private static knownSig(known: readonly ResolvedAbility[]): string {
    let sig = '';
    for (const k of known) sig += `${k.def.id}:${k.rank}:${k.cost}:${k.castTime}:${k.cooldown}|`;
    return sig;
  }

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    // Capture the opener BEFORE closing other windows, so a sibling window's own
    // focus-return on close cannot clobber the element we restore to (WCAG).
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.render();
    this.deps.root().style.display = 'block';
    (this.deps.root().querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    el.style.display = 'none';
    this.deps.hideTooltip();
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  // Per-frame entry while the window is open. Rebuilds the whole list only when a
  // resolved ability's numbers changed (a talent allocation reassigns world.known),
  // so row summaries reflect current cost/cast/cooldown; otherwise it just does the
  // cheap in-place +/- toggle refresh. Hover tooltips resolve live regardless (see
  // appendRow), so this covers the always-visible row text, not the tooltip.
  tickOpen(): void {
    if (SpellbookWindow.knownSig(this.deps.world().known) !== this.lastKnownSig) {
      this.rerenderPreservingView();
      return;
    }
    this.refreshHotbarControls();
  }

  // render() rebuilds the list via innerHTML, and the window root is the scroll
  // container, so a mid-session rebuild would jump the scroll to top and drop the
  // keyboard user's focus. Preserve both across the talent-driven rebuild: capture
  // scrollTop and the focused element's identity (a row or its +/- toggle, keyed by
  // ability id; or the close/reset control), then restore after the render.
  private rerenderPreservingView(): void {
    const root = this.deps.root();
    const scrollTop = root.scrollTop;
    const active = document.activeElement as HTMLElement | null;
    let refocus: string | null = null;
    if (active && root.contains(active)) {
      const id = active.dataset.abilityId;
      // The Skills Manager controls are keyed by their own data attributes (not
      // data-ability-id), so a player toggling a row's display or type with the
      // keyboard keeps focus on that exact control across the rebuild each click
      // triggers. Same for the two footer toggles.
      const trackToggle = active.dataset.trackToggle;
      const trackType = active.dataset.trackType;
      const footerBtn = active.dataset.footerBtn;
      if (trackToggle) refocus = `[data-track-toggle="${trackToggle}"]`;
      else if (trackType) refocus = `[data-track-type="${trackType}"]`;
      else if (footerBtn) refocus = `[data-footer-btn="${footerBtn}"]`;
      else if (id && active.classList.contains('spell-hotbar-toggle'))
        refocus = `.spell-hotbar-toggle[data-ability-id="${id}"]`;
      else if (id && active.classList.contains('spell-row'))
        refocus = `.spell-row[data-ability-id="${id}"]`;
      else if (active.hasAttribute('data-reset-bar')) refocus = '[data-reset-bar]';
      else if (active.hasAttribute('data-close')) refocus = '[data-close]';
    }
    this.render();
    root.scrollTop = scrollTop;
    if (refocus) (root.querySelector(refocus) as HTMLElement | null)?.focus();
  }

  render(): void {
    const el = this.deps.root();
    const world = this.deps.world();
    this.lastKnownSig = SpellbookWindow.knownSig(world.known);
    const classId = world.cfg.playerClass;
    const cls = CLASSES[classId];
    // The kit list is the display order, but spec signatures and other talent grants are
    // known WITHOUT being in the base kit (e.g. mortal_strike, chain_heal, stormstrike), so
    // append any known-but-not-in-kit ability so the spellbook shows everything the player has.
    const kit = cls.abilities;
    const grantedExtra = world.known
      .map((k) => k.def.id)
      .filter((id) => !kit.includes(id) && !!ABILITIES[id]);
    const view = buildSpellbookView({
      classId,
      abilities: [...kit, ...grantedExtra],
      known: world.known,
      barAbilityIds: this.deps.barAbilityIds(),
      abilityIdByBarSlot: this.deps.abilityIdByBarSlot(),
      hasFreeSlot: this.deps.hasFreeSlot(),
      attackOnBar: this.deps.attackOnBar(),
      hasFormBars: this.deps.hasFormBars(),
      spec: world.talentSpec,
      level: world.player.level,
      managerMode: this.deps.managerMode(),
      locked: this.deps.trackersLocked(),
      tracking: this.deps.tracking(),
    });
    const className = classDisplayName(view.classId);
    markDialogRoot(el, { label: t('abilityUi.spellbook.title') });
    // "Reset bar" only applies to classes with per-form bars (druid); other classes
    // have a single bar, so the button is omitted for them.
    const resetBtnHtml = view.hasFormBars
      ? `<button type="button" class="x-btn spellbook-reset" data-reset-bar aria-label="${esc(t('abilityUi.spellbook.resetBarAria'))}">${esc(t('abilityUi.spellbook.resetBar'))}</button>`
      : '';
    el.innerHTML = `<div class="panel-title"><span>${esc(t('abilityUi.spellbook.title'))} <span class="spellbook-class">${esc(t('abilityUi.spellbook.classSubtitle', { className }))}</span></span><div class="panel-title-actions">${resetBtnHtml}<button type="button" class="x-btn" data-close aria-label="${esc(t('abilityUi.spellbook.close'))}">${svgIcon('close')}</button></div></div>`;
    // Manager mode is a class on the root, so the stylesheet can widen the rows
    // and reveal the per-row controls without a second render path.
    el.classList.toggle('spellbook-manager', view.managerMode);
    const list = document.createElement('div');
    list.className = 'spell-list';
    list.setAttribute('role', 'list');
    el.appendChild(list);
    if (view.managerMode) this.appendManagerHint(list, view.trackedCount);
    this.appendAttackRow(list, view.attackOnBar);
    for (const row of view.rows) this.appendRow(list, row, view.managerMode);
    if (view.empty) {
      const empty = document.createElement('div');
      empty.className = 'spell-sub';
      empty.textContent = t('abilityUi.spellbook.empty');
      list.appendChild(empty);
    }
    this.appendFooter(el, view.managerMode, view.locked);
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    const resetBtn = el.querySelector('[data-reset-bar]');
    resetBtn?.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    resetBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deps.resetFormBar();
      audio.click();
    });
  }

  // In-place refresh of the per-row hotbar toggles, called from hud.update() while
  // the window is open so the +/- state tracks action-bar changes (drag-drop,
  // keybind use) without a full rebuild. Mirrors the inline refreshSpellbookHotbar
  // controls but scoped to this window's root.
  refreshHotbarControls(): void {
    // The Attack toggle tracks the Interface showAttackButton setting, which can
    // flip while the window is open (the options window, or a right-click on the
    // slot-0 button itself). Same elision discipline as the ability toggles:
    // rewrite only when the on-bar state actually flips.
    const attackBtn = this.deps.root().querySelector<HTMLButtonElement>('[data-attack-toggle]');
    if (attackBtn) {
      const onBar = this.deps.attackOnBar();
      if ((attackBtn.getAttribute('aria-pressed') === 'true') !== onBar) {
        attackBtn.textContent = onBar ? '-' : '+';
        attackBtn.classList.toggle('remove', onBar);
        attackBtn.setAttribute('aria-pressed', onBar ? 'true' : 'false');
        attackBtn.setAttribute(
          'aria-label',
          t(onBar ? 'hudChrome.spellbook.removeFromBarAria' : 'hudChrome.spellbook.addToBarAria', {
            name: t('abilityUi.actionBar.attackName'),
          }),
        );
      }
    }
    const barIds = new Set(this.deps.barAbilityIds());
    const hasFree = this.deps.hasFreeSlot();
    this.deps
      .root()
      .querySelectorAll<HTMLButtonElement>('.spell-hotbar-toggle')
      .forEach((btn) => {
        const id = btn.dataset.abilityId;
        if (!id) return;
        const onBar = barIds.has(id);
        // Elide the toggle-state writes: this runs every frame while the window is
        // open, but the +/- text, the remove class, and the accessible name only
        // change when on-bar membership flips (a drag-drop / keybind use), which
        // aria-pressed already records. Recomputing the i18n name + rewriting the
        // attribute every frame was avoidable churn (matches the elided-writer
        // doctrine). `disabled` stays per-frame: it also depends
        // on hasFree, which can change without an on-bar flip.
        if ((btn.getAttribute('aria-pressed') === 'true') !== onBar) {
          btn.textContent = onBar ? '-' : '+';
          btn.classList.toggle('remove', onBar);
          btn.setAttribute('aria-pressed', onBar ? 'true' : 'false');
          // Keep the accessible name in sync with the toggle state: a spoken
          // action ("Add/Remove {name} to action bar"), not a bare +/- glyph.
          // Same key pair as appendRow.
          const def = ABILITIES[id];
          if (def)
            btn.setAttribute(
              'aria-label',
              t(
                onBar
                  ? 'hudChrome.spellbook.removeFromBarAria'
                  : 'hudChrome.spellbook.addToBarAria',
                {
                  name: this.abilityName(def),
                },
              ),
            );
        }
        btn.disabled = !onBar && !hasFree;
      });
  }

  // The pinned basic Attack row, first in the list (classic spellbooks lead with
  // Attack). Attack is not an ability: its +/- toggle restores or removes the
  // fixed Attack button on bar slot 0 through the same Interface
  // showAttackButton setting the options window drives, so a player who
  // right-clicked the button away can always get it back from here. Reuses the
  // existing attackName/attackTooltip keys and the add/remove aria pair; no new
  // player strings.
  private appendAttackRow(list: HTMLElement, onBar: boolean): void {
    const name = t('abilityUi.actionBar.attackName');
    const summary = t('abilityUi.actionBar.attackTooltip');
    const el = document.createElement('div');
    el.className = 'spell-row';
    el.tabIndex = 0;
    el.setAttribute('role', 'listitem');
    // No aria-label override: the row's own localized text (name + summary) is
    // the accessible content, unlike ability rows whose label folds in rank.
    el.innerHTML = `<div class="spell-icon" style="background-image:url(${iconDataUrl('ability', 'attack')})"></div>
        <div class="spell-text"><div class="spell-name">${esc(name)}</div>
        <div class="spell-sub">${esc(summary)}</div></div>`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `spell-hotbar-toggle${onBar ? ' remove' : ''}`;
    toggle.dataset.attackToggle = '1';
    toggle.textContent = onBar ? '-' : '+';
    toggle.setAttribute(
      'aria-label',
      t(onBar ? 'hudChrome.spellbook.removeFromBarAria' : 'hudChrome.spellbook.addToBarAria', {
        name,
      }),
    );
    toggle.setAttribute('aria-pressed', onBar ? 'true' : 'false');
    toggle.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    toggle.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deps.setAttackOnBar(!this.deps.attackOnBar());
      audio.click();
      this.refreshHotbarControls();
    });
    el.appendChild(toggle);
    this.deps.attachTooltip(
      el,
      () =>
        `<div class="tt-title">${esc(t('abilityUi.actionBar.attackName'))}</div><div class="tt-sub">${esc(t('abilityUi.actionBar.attackTooltip'))}</div>`,
    );
    list.appendChild(el);
  }

  // The one-line explanation at the top of manager mode: what the two per-row
  // controls do, plus how many rows are currently switched on. Cold path, rebuilt
  // with the list.
  private appendManagerHint(list: HTMLElement, trackedCount: number): void {
    const hint = document.createElement('div');
    hint.className = 'spell-manager-hint';
    hint.textContent = t('hudChrome.skillTracker.managerHint', {
      count: this.formatAbilityNumber(trackedCount),
    });
    list.appendChild(hint);
  }

  // The bottom-right footer: the "Skills manager" mode toggle and the tracker
  // "Lock" toggle. Both are aria-pressed toggle buttons (the interface-settings
  // convention the rest of the HUD uses), and both re-render the window in place
  // so the row controls and the pressed states never drift from the stored state.
  private appendFooter(root: HTMLElement, managerMode: boolean, locked: boolean): void {
    const footer = document.createElement('div');
    footer.className = 'spellbook-footer';
    const manager = this.footerButton(
      'spellbook-manager-btn',
      t('hudChrome.skillTracker.managerButton'),
      managerMode
        ? t('hudChrome.skillTracker.managerButtonOnAria')
        : t('hudChrome.skillTracker.managerButtonOffAria'),
      managerMode,
    );
    manager.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deps.setManagerMode(!this.deps.managerMode());
      audio.click();
      this.rerenderPreservingView();
    });
    const lock = this.footerButton(
      'spellbook-lock-btn',
      t('hudChrome.skillTracker.lockButton'),
      locked
        ? t('hudChrome.skillTracker.lockButtonOnAria')
        : t('hudChrome.skillTracker.lockButtonOffAria'),
      locked,
    );
    lock.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deps.setTrackersLocked(!this.deps.trackersLocked());
      audio.click();
      this.rerenderPreservingView();
    });
    footer.appendChild(manager);
    footer.appendChild(lock);
    root.appendChild(footer);
  }

  private footerButton(
    cls: string,
    label: string,
    ariaLabel: string,
    pressed: boolean,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `x-btn ${cls}${pressed ? ' active' : ''}`;
    btn.dataset.footerBtn = cls;
    btn.textContent = label;
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.setAttribute('aria-label', ariaLabel);
    btn.title = ariaLabel;
    btn.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    return btn;
  }

  // The two Skills Manager controls on one trackable row: the display ON/OFF
  // toggle, then the tracker "type" button that steps square <-> bar. Both mutate
  // the stored per-class selection through the deps and re-render in place so the
  // manager hint's count and the HUD trackers follow immediately.
  private appendManagerControls(el: HTMLElement, row: SpellbookRow, name: string): void {
    const group = document.createElement('div');
    group.className = 'spell-track-controls';

    const display = document.createElement('button');
    display.type = 'button';
    display.className = `spell-track-toggle${row.tracked ? ' on' : ''}`;
    display.dataset.trackToggle = row.abilityId;
    display.textContent = t(
      row.tracked ? 'hudChrome.skillTracker.displayOn' : 'hudChrome.skillTracker.displayOff',
    );
    display.setAttribute('aria-pressed', row.tracked ? 'true' : 'false');
    display.setAttribute('aria-label', t('hudChrome.skillTracker.displayAria', { name }));
    display.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    display.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deps.setTracked(row.abilityId, !row.tracked);
      audio.click();
      this.rerenderPreservingView();
    });

    const type = document.createElement('button');
    type.type = 'button';
    type.className = 'spell-track-type';
    type.dataset.trackType = row.abilityId;
    type.dataset.display = row.trackDisplay;
    type.textContent = this.trackDisplayLabel(row.trackDisplay);
    type.setAttribute(
      'aria-label',
      t('hudChrome.skillTracker.typeAria', {
        name,
        type: this.trackDisplayLabel(row.trackDisplay),
      }),
    );
    // The type button only matters once the display is on; keep it visible but
    // inert otherwise, so the row's layout never shifts as the toggle flips.
    type.disabled = !row.tracked;
    type.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    type.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deps.setTrackDisplay(row.abilityId, nextSkillTrackerDisplay(row.trackDisplay));
      audio.click();
      this.rerenderPreservingView();
    });

    group.appendChild(display);
    group.appendChild(type);
    el.appendChild(group);
  }

  private trackDisplayLabel(display: SkillTrackerDisplay): string {
    return t(
      display === 'bar' ? 'hudChrome.skillTracker.typeBar' : 'hudChrome.skillTracker.typeSquare',
    );
  }

  private appendRow(list: HTMLElement, row: SpellbookRow, managerMode: boolean): void {
    const def = ABILITIES[row.abilityId];
    const known = row.known;
    const el = document.createElement('div');
    el.className = `spell-row${known ? '' : ' locked'}`;
    el.tabIndex = 0;
    el.setAttribute('role', 'listitem');
    // Ability id on the row so a talent-driven rerenderPreservingView() can restore
    // scroll focus to the same row after it rebuilds the list.
    el.dataset.abilityId = row.abilityId;
    const locked = !known;
    const summary = known ? this.deps.abilitySummary(known) : '';
    const name = this.abilityName(def);
    const learnLevel = this.formatAbilityNumber(def.learnLevel);
    el.setAttribute(
      'aria-label',
      known
        ? t('abilityUi.spellbook.knownAbilityAria', {
            name,
            rank: this.formatAbilityNumber(known.rank),
            summary,
          })
        : t('abilityUi.spellbook.unlearnedAbilityAria', { name, level: learnLevel }),
    );
    el.innerHTML = `<div class="spell-icon" style="background-image:url(${iconDataUrl('ability', row.abilityId)})"></div>
        <div class="spell-text"><div class="spell-name">${esc(name)}${known && known.rank > 1 ? ` <span class="spell-rank">${esc(t('abilityUi.tooltip.rank', { rank: this.formatAbilityNumber(known.rank) }))}</span>` : ''}</div>
        <div class="spell-sub">${locked ? esc(t('abilityUi.spellbook.trainableAtLevel', { level: learnLevel })) : esc(summary)}</div></div>`;
    if (known && isAbilityActionBarEligible(def)) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = `spell-hotbar-toggle${row.onBar ? ' remove' : ''}`;
      toggle.dataset.abilityId = known.def.id;
      toggle.textContent = row.onBar ? '-' : '+';
      toggle.setAttribute(
        'aria-label',
        t(
          row.onBar ? 'hudChrome.spellbook.removeFromBarAria' : 'hudChrome.spellbook.addToBarAria',
          {
            name,
          },
        ),
      );
      toggle.setAttribute('aria-pressed', row.onBar ? 'true' : 'false');
      toggle.disabled = row.toggleDisabled;
      // Touch-only page label (Phase 4): names which mobile action-ring page
      // (Phase 1) this bar-assigned row's slot falls on, so a touch player who
      // added it from the spellbook knows where to find it on the ring. Desktop
      // rendering is untouched (row.mobilePage is still computed either way, but
      // the label never appends without the touch gate).
      if (row.mobilePage !== null && document.body.classList.contains('mobile-touch')) {
        const pageLabel = document.createElement('span');
        pageLabel.className = 'spell-mobile-page';
        pageLabel.textContent = t('hudChrome.mobile.spellbookPageLabel', {
          page: this.formatAbilityNumber(row.mobilePage + 1),
        });
        el.appendChild(pageLabel);
      }
      toggle.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      toggle.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = known.def.id;
        const changed = this.deps.barAbilityIds().includes(id)
          ? this.deps.removeFromBar(id)
          : this.deps.addToBar(id);
        if (!changed) return;
        audio.click();
        this.refreshHotbarControls();
      });
      el.appendChild(toggle);
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        const action = { type: 'ability' as const, id: known.def.id };
        this.deps.setDragAction(action);
        this.writeDraggedAction(e.dataTransfer, action);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        this.deps.hideTooltip();
      });
      el.addEventListener('dragend', () => {
        this.deps.setDragAction(null);
        this.deps.clearActionDropTargets();
      });
    }
    // Skills Manager: the display + type controls, appended AFTER the hotbar
    // toggle so they sit at the row's right edge exactly as the owner asked.
    // Untrackable rows (unlearned, or an ability with no aura and no cooldown)
    // get nothing, so the manager never offers a switch that could not light up.
    if (managerMode && row.trackable) this.appendManagerControls(el, row, name);
    if (known) {
      // Resolve every learned ability LIVE at hover time, including informational
      // passive rows that deliberately have no action-bar controls.
      this.deps.attachTooltip(el, () => {
        const live = this.deps.world().known.find((k) => k.def.id === known.def.id) ?? known;
        return this.deps.abilityTooltip(live);
      });
    } else {
      this.deps.attachTooltip(
        el,
        () =>
          `<div class="tt-title">${esc(name)}</div><div class="tt-sub">${esc(t('abilityUi.spellbook.learnAtLevel', { level: learnLevel }))}</div>`,
      );
    }
    list.appendChild(el);
  }

  // Reproduced from the exported hotbar encoder so cross-window drag state stays on
  // the HUD via the deps (mirrors bags_window).
  private writeDraggedAction(
    dt: DataTransfer | null,
    action: { type: 'ability'; id: string },
  ): void {
    if (!dt) return;
    dt.setData(HOTBAR_ACTION_MIME, encodeHotbarAction(action));
    dt.setData('text/plain', action.id);
  }

  private abilityName(def: AbilityDef): string {
    return tEntity({ kind: 'ability', id: def.id, field: 'name' });
  }

  private formatAbilityNumber(value: number): string {
    return formatNumber(value, { maximumFractionDigits: 1 });
  }
}
