// The Gauntlet recruiter dialog (Maro Half-Mask, the Herald). A small `.window`
// panel the player opens by interacting with the recruiter NPC. Two stages:
//  - main: pitches the event, shows the live lobby status while a lobby is
//    filling, and offers Join the Queue / Spectate / Practice (the primary
//    button relabels to the matching leave while queued / lobbied / running).
//    While the event window is closed a note explains why the queue and the
//    stands are shut (Practice stays open).
//  - pick: the practice picker, pushed by the Practice button. One card per
//    game (name + how-it-plays line, reusing the trial hint keys) plus the
//    featured Full Gauntlet card, and a Back button that returns to main.
// Hud owns the open/close orchestration and the focus bridge (windowFocus);
// this module renders one panel and reports back through the injected deps,
// holding no Sim reference.
//
// It builds its structure once on open (stable Close + action + picker buttons,
// wired once) and refreshes only the dynamic status text + action labels per
// frame, so the focus trap and listeners survive the live lobby countdown.

import { GAUNTLET } from '../sim/content/gauntlet';
import type { GauntletTrialKind } from '../sim/types';
import type { GauntletRunView } from '../world_api/gauntlet';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { svgIcon } from './ui_icons';

const INT = { maximumFractionDigits: 0 } as const;

// The six trials' display names (hud_chrome.ts trialNames). A static map, not a
// template string, so every key stays a literal the i18n scanner sees.
const TRIAL_NAME_KEYS: Record<GauntletTrialKind, TranslationKey> = {
  sentinel: 'hudChrome.gauntlet.trialNames.sentinel',
  sigils: 'hudChrome.gauntlet.trialNames.sigils',
  pull: 'hudChrome.gauntlet.trialNames.pull',
  echo: 'hudChrome.gauntlet.trialNames.echo',
  span: 'hudChrome.gauntlet.trialNames.span',
  court: 'hudChrome.gauntlet.trialNames.court',
};

// Each pick card's one-line "how it plays" description: the existing trial
// hint keys, reused verbatim (the echo pairs its watch + answer sentences;
// they render as separate spans, never concatenated into one string).
const TRIAL_DESC_KEYS: Record<GauntletTrialKind, TranslationKey[]> = {
  sentinel: ['hudChrome.gauntlet.hint.sentinel'],
  sigils: ['hudChrome.gauntlet.hint.sigils'],
  pull: ['hudChrome.gauntlet.hint.pull'],
  echo: ['hudChrome.gauntlet.hint.echoWatch', 'hudChrome.gauntlet.hint.echoAnswer'],
  span: ['hudChrome.gauntlet.hint.span'],
  court: ['hudChrome.gauntlet.hint.court'],
};

/** Hud-supplied glue; the window reaches into Hud only through these. */
export interface GauntletRecruitWindowDeps {
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onJoinQueue(): void;
  onSpectate(): void;
  /** Start a practice run: `trial` is the chosen game's index into the trial
   * sequence, or null for the full six-trial run. */
  onPractice(trial: number | null): void;
  onLeave(): void;
}

/** The live status the window renders from (Hud feeds it per frame while open). */
export interface GauntletRecruitStatus {
  eventOpen: boolean;
  run: GauntletRunView | null;
  queuePosition: number; // 1-based place in the rolling queue, 0 when not queued
  spectating: boolean; // free-roaming spectator (distinct from a knocked-out contestant)
  time: number;
}

export class GauntletRecruitWindow {
  private openerFocus: HTMLElement | null = null;
  private mainEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private countdownEl: HTMLElement | null = null;
  private closedNoteEl: HTMLElement | null = null;
  private noteEl: HTMLElement | null = null;
  // The primary action button: it re-labels per state and dispatches join-queue
  // when idle, else the unified leave (dequeue / withdraw / stop spectating). The
  // spectate + practice buttons only show in the idle state.
  private primaryBtn: HTMLButtonElement | null = null;
  private spectateBtn: HTMLButtonElement | null = null;
  private practiceBtn: HTMLButtonElement | null = null;
  // The pick stage: one card per practice choice plus the Back return.
  private pickerEl: HTMLElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private pickerBtns: { btn: HTMLButtonElement; trial: number | null }[] = [];
  private stage: 'main' | 'pick' = 'main';
  // What the primary button currently dispatches, so its one click listener stays
  // stable across per-frame relabels.
  private primaryMode: 'joinQueue' | 'leave' = 'joinQueue';

  constructor(private readonly deps: GauntletRecruitWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  open(status: GauntletRecruitStatus): void {
    // Capture the opener BEFORE closing siblings so their focus-return cannot
    // clobber the element we restore to on close (WCAG 2.4.3).
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.build();
    this.stage = 'main';
    this.deps.root().style.display = 'block';
    this.deps.root().dataset.windowOpen = '1';
    this.update(status);
    this.primaryBtn?.focus();
  }

  close(): void {
    const el = this.deps.root();
    if (el.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    el.style.display = 'none';
    delete el.dataset.windowOpen;
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  /**
   * Per-frame refresh while open. Five states drive the main stage's buttons +
   * status (spectating / queued / filling lobby / live run / idle); the pick
   * stage only shows from idle and drops back to main the moment the player
   * stops being idle (a queue pop cannot leave a stale picker up).
   */
  update(status: GauntletRecruitStatus): void {
    if (!this.isOpen) return;
    const spectating = status.spectating;
    const queued = status.queuePosition > 0;
    const inLobby = !spectating && status.run?.phase === 'lobby';
    const inRun = !spectating && !!status.run && !inLobby;
    const idle = !spectating && !queued && !status.run;

    if (!idle) this.stage = 'main';
    if (this.mainEl) this.mainEl.hidden = this.stage !== 'main';
    if (this.pickerEl) this.pickerEl.hidden = this.stage !== 'pick';
    if (this.stage === 'pick') return; // the pick stage is static (built + labeled once)

    // The primary button: join the queue only in the idle state, else a leave.
    this.primaryMode = idle ? 'joinQueue' : 'leave';
    if (this.primaryBtn) {
      const label = spectating
        ? 'hudChrome.gauntlet.stopSpectating'
        : queued
          ? 'hudChrome.gauntlet.leaveQueue'
          : inLobby
            ? 'hudChrome.gauntlet.withdraw'
            : inRun
              ? 'hudChrome.gauntlet.leave'
              : 'hudChrome.gauntlet.joinQueue';
      this.primaryBtn.textContent = t(label as TranslationKey);
      this.primaryBtn.disabled = idle && !status.eventOpen;
    }
    // Spectate + Practice are only offered from the idle state. Practice is always
    // enabled (an always-on training harness); Spectate needs the event open.
    if (this.spectateBtn) {
      this.spectateBtn.hidden = !idle;
      this.spectateBtn.disabled = !status.eventOpen;
      this.spectateBtn.textContent = t('hudChrome.gauntlet.spectate');
    }
    if (this.practiceBtn) {
      this.practiceBtn.hidden = !idle;
      this.practiceBtn.textContent = t('hudChrome.gauntlet.practice');
    }
    // Why the queue/stands are shut: only while idle with the window closed.
    if (this.closedNoteEl) {
      this.closedNoteEl.hidden = !idle || status.eventOpen;
      this.closedNoteEl.textContent = t('hudChrome.gauntlet.eventClosedNote');
    }
    if (this.noteEl) {
      this.noteEl.hidden = !idle;
      this.noteEl.textContent = t('hudChrome.gauntlet.practiceNote');
    }

    if (this.statusEl && this.countdownEl) {
      if (queued) {
        this.statusEl.textContent = t('hudChrome.gauntlet.queuePosition', {
          n: formatNumber(status.queuePosition, INT),
        });
        this.statusEl.hidden = false;
        this.countdownEl.hidden = true;
      } else if (inLobby && status.run) {
        const seconds = Math.max(0, Math.ceil(status.run.endsAt - status.time));
        this.statusEl.textContent = t('hudChrome.gauntlet.lobbyJoined', {
          count: formatNumber(status.run.survivors, INT),
        });
        this.countdownEl.textContent = t('hudChrome.gauntlet.lobbyCountdown', {
          seconds: formatNumber(seconds, INT),
        });
        this.statusEl.hidden = false;
        this.countdownEl.hidden = false;
      } else {
        this.statusEl.hidden = true;
        this.countdownEl.hidden = true;
      }
    }
  }

  private build(): void {
    const el = this.deps.root();
    markDialogRoot(el, { labelledBy: 'gauntlet-recruit-title' });
    const title: TranslationKey = 'hudChrome.gauntlet.title';
    const close: TranslationKey = 'questUi.dialog.close';
    const pitch: TranslationKey = 'hudChrome.gauntlet.pitch';
    el.innerHTML =
      `<div class="panel-title"><span id="gauntlet-recruit-title">${esc(t(title))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t(close))}">${svgIcon('close')}</button></div>` +
      `<div class="gr-main">` +
      `<div class="gr-pitch">${esc(t(pitch))}</div>` +
      `<div class="gr-status" role="status" hidden></div>` +
      `<div class="gr-countdown" role="status" hidden></div>` +
      `<div class="gr-actions">` +
      `<button type="button" class="btn gr-action gr-primary"></button>` +
      `<button type="button" class="btn gr-spectate" hidden></button>` +
      `<button type="button" class="btn gr-practice" hidden></button>` +
      `</div>` +
      `<div class="gr-closed-note" hidden></div>` +
      `<div class="gr-note" hidden></div>` +
      `</div>` +
      `<div class="gr-picker" hidden>` +
      `<div class="gr-picker-title" id="gauntlet-practice-pick-title">${esc(t('hudChrome.gauntlet.practicePickTitle'))}</div>` +
      `<div class="gr-picker-list" role="group" aria-labelledby="gauntlet-practice-pick-title"></div>` +
      `<button type="button" class="btn gr-back">${esc(t('hud.options.back'))}</button>` +
      `</div>`;
    el.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.mainEl = el.querySelector('.gr-main');
    this.statusEl = el.querySelector('.gr-status');
    this.countdownEl = el.querySelector('.gr-countdown');
    this.closedNoteEl = el.querySelector('.gr-closed-note');
    this.noteEl = el.querySelector('.gr-note');
    this.primaryBtn = el.querySelector('.gr-primary');
    this.spectateBtn = el.querySelector('.gr-spectate');
    this.practiceBtn = el.querySelector('.gr-practice');
    this.pickerEl = el.querySelector('.gr-picker');
    this.backBtn = el.querySelector('.gr-back');
    // One pick card per choice: the featured full run first, then the six
    // games in trial order, each a name over its how-it-plays line. Built and
    // labeled once with stable listeners (the pick stage is static).
    const list = el.querySelector('.gr-picker-list');
    this.pickerBtns = [];
    if (list) {
      const choices: (number | null)[] = [null, ...GAUNTLET.trials.map((_, i) => i)];
      for (const trial of choices) {
        const kind = trial === null ? null : GAUNTLET.trials[trial];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = trial === null ? 'btn gr-pick gr-pick-full' : 'btn gr-pick';
        const name = document.createElement('span');
        name.className = 'gr-pick-name';
        if (kind !== null) {
          const num = document.createElement('span');
          num.className = 'gr-pick-num';
          num.textContent = formatNumber((trial ?? 0) + 1, INT);
          name.appendChild(num);
        }
        name.appendChild(
          document.createTextNode(
            kind === null ? t('hudChrome.gauntlet.practiceFull') : t(TRIAL_NAME_KEYS[kind]),
          ),
        );
        btn.appendChild(name);
        const desc = document.createElement('span');
        desc.className = 'gr-pick-desc';
        const descKeys =
          kind === null
            ? (['hudChrome.gauntlet.practiceNote'] as TranslationKey[])
            : TRIAL_DESC_KEYS[kind];
        for (const key of descKeys) {
          const part = document.createElement('span');
          part.textContent = t(key);
          desc.appendChild(part);
        }
        btn.appendChild(desc);
        btn.addEventListener('click', () => this.deps.onPractice(trial));
        list.appendChild(btn);
        this.pickerBtns.push({ btn, trial });
      }
    }
    // Stable listeners; update() only relabels + toggles visibility, so the focus
    // trap and these handlers survive the per-frame refresh.
    this.primaryBtn?.addEventListener('click', () => {
      if (this.primaryMode === 'joinQueue') this.deps.onJoinQueue();
      else this.deps.onLeave();
    });
    this.spectateBtn?.addEventListener('click', () => this.deps.onSpectate());
    // Practice pushes the pick stage (the actual start dispatches from a card);
    // Back pops it. Both move focus so the keyboard never lands in a hidden tree.
    this.practiceBtn?.addEventListener('click', () => {
      this.stage = 'pick';
      if (this.mainEl) this.mainEl.hidden = true;
      if (this.pickerEl) this.pickerEl.hidden = false;
      this.pickerBtns[0]?.btn.focus();
    });
    this.backBtn?.addEventListener('click', () => {
      this.stage = 'main';
      if (this.pickerEl) this.pickerEl.hidden = true;
      if (this.mainEl) this.mainEl.hidden = false;
      this.practiceBtn?.focus();
    });
  }
}
