// WCAG-chrome + no-magic source guard for the spellbook window DOM painter.
//
// The painter's DOM methods need a document, so they are not exercised in this Node
// suite; the pure decisions it renders are covered by tests/spellbook_view.test.ts.
// This guard pins the a11y-bearing markup (real close button + listitem rows +
// toggle aria-pressed + focus-return) and the no-magic-values contract (no literal
// colors in TS), plus the hud.update() refresh call site.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../src/ui/spellbook_window.ts', import.meta.url), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('spellbook_window: WCAG chrome (rows + toggles + focus-return)', () => {
  it('drives the panel from the pure view core', () => {
    expect(code).toContain('buildSpellbookView(');
  });

  it('gives the close control a real button with an aria-label', () => {
    expect(code).toContain('class="x-btn" data-close aria-label=');
    expect(code).toContain("t('abilityUi.spellbook.close')");
  });

  it('renders the dialog role + the spell list role', () => {
    // the dialog identity is set via the shared markDialogRoot helper (its own writes
    // are unit-tested in dialog_root.test.ts); the spell list/listitem roles stay inline.
    expect(code).toContain("markDialogRoot(el, { label: t('abilityUi.spellbook.title') })");
    expect(code).toContain("list.setAttribute('role', 'list')");
    expect(code).toContain("setAttribute('role', 'listitem')");
  });

  it('renders the hotbar toggle as a button with aria-pressed state', () => {
    expect(code).toMatch(/toggle\.className = [`']spell-hotbar-toggle/);
    expect(code).toContain("toggle.setAttribute('aria-pressed'");
    expect(code).toContain('this.deps.removeFromBar(id)');
    expect(code).toContain('this.deps.addToBar(id)');
  });

  it('keeps passive spellbook rows informational, without add or drag affordances', () => {
    expect(code).toContain('known && isAbilityActionBarEligible(def)');
  });

  it('keeps the reset-bar button gated on the form-bars flag', () => {
    expect(code).toContain('const resetBtnHtml = view.hasFormBars');
    expect(code).toContain('data-reset-bar');
    expect(code).toContain("t('abilityUi.spellbook.resetBar')");
  });

  it('captures + restores the opener focus on open/close (WCAG 2.2 AA focus-return)', () => {
    expect(code).toContain('this.openerFocus = this.deps.captureFocus()');
    expect(code).toContain('this.deps.restoreFocus(this.openerFocus)');
  });

  it('captures the opener BEFORE closing other windows (order is load-bearing)', () => {
    // A sibling window's own focus-return on close must not clobber the opener we
    // restore to, so the capture has to happen before closeOthers(). Both calls
    // appear exactly once (in toggle()), so the order check is unambiguous.
    expect(code.indexOf('this.openerFocus = this.deps.captureFocus()')).toBeLessThan(
      code.indexOf('this.deps.closeOthers()'),
    );
  });
});

describe('spellbook_window: the pinned Attack row', () => {
  it('renders the Attack row first, from the pure view attackOnBar state', () => {
    expect(code).toContain('this.appendAttackRow(list, view.attackOnBar)');
    expect(code.indexOf('this.appendAttackRow(list')).toBeLessThan(
      code.indexOf('for (const row of view.rows) this.appendRow(list, row, view.managerMode)'),
    );
    expect(code).toContain('attackOnBar: this.deps.attackOnBar()');
  });

  it('reuses the existing Attack name/tooltip keys (no new player strings)', () => {
    expect(code).toContain("t('abilityUi.actionBar.attackName')");
    expect(code).toContain("t('abilityUi.actionBar.attackTooltip')");
    expect(code).toContain("iconDataUrl('ability', 'attack')");
  });

  it('routes the toggle through setAttackOnBar with aria-pressed state', () => {
    expect(code).toContain('this.deps.setAttackOnBar(!this.deps.attackOnBar())');
    expect(code).toContain("toggle.dataset.attackToggle = '1'");
  });

  it('keeps the per-frame refresh syncing the Attack toggle (options can flip it)', () => {
    expect(code).toContain("querySelector<HTMLButtonElement>('[data-attack-toggle]')");
    expect(code).toContain("attackBtn.setAttribute('aria-pressed'");
  });
});

describe('spellbook_window: mobile action-ring page label (Phase 4, touch-only)', () => {
  it('feeds abilityIdByBarSlot through to the pure view core', () => {
    expect(code).toContain('abilityIdByBarSlot: this.deps.abilityIdByBarSlot()');
  });

  it('gates the page label on both a non-null mobilePage AND touch mode', () => {
    expect(code).toContain('row.mobilePage !== null');
    expect(code).toContain("document.body.classList.contains('mobile-touch')");
  });

  it('renders the label through t() with the localized page-label key', () => {
    expect(code).toContain("t('hudChrome.mobile.spellbookPageLabel'");
  });

  it('converts the zero-indexed view page to a one-indexed user-facing label', () => {
    expect(code).toContain('page: this.formatAbilityNumber(row.mobilePage + 1)');
  });
});

describe('spellbook_window: no magic values (DOM painter)', () => {
  it('carries no literal hex or rgb color in TS (colors live in the stylesheet)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('carries no literal em dash in source', () => {
    expect(src.includes('—'), 'em dash found').toBe(false);
  });
});

describe('spellbook_window: hud.update() refresh call site', () => {
  it('drives the open spellbook from hud.update() through tickOpen while displayed', () => {
    // Pin the hud.ts call site so a refactor cannot silently stop the open
    // spellbook from tracking action-bar AND talent changes. tickOpen re-renders
    // on a resolved-numbers change, else falls back to the cheap toggle refresh.
    expect(hud).toContain('if (this.spellbookWindow.isOpen) this.spellbookWindow.tickOpen();');
  });

  it('keeps the in-place refresh updating the aria-pressed + disabled state per toggle', () => {
    // The call-site guard above proves the refresh fires; this pins what it WRITES.
    // refreshHotbarControls keys off `btn` (vs appendRow's `toggle`), so the row
    // guard does not cover this path: without these, the open spellbook's toggles
    // would stop tracking the bar (the whole reason this path is not-cold).
    expect(code).toContain("btn.setAttribute('aria-pressed'");
    expect(code).toContain('btn.disabled = !onBar && !hasFree');
  });

  it('elides the per-frame toggle writes to on-bar flips only (this runs every frame)', () => {
    // refreshHotbarControls fires on EVERY animation frame while the window is open, so
    // the +/- text, the remove class, the aria-pressed, and the i18n-backed aria-label
    // are gated on an actual on-bar membership flip (read from aria-pressed, which
    // appendRow seeds), not rewritten unconditionally. Only `disabled` stays per-frame
    // (it depends on hasFree). A revert to unconditional writes drops this guard.
    expect(code).toContain("(btn.getAttribute('aria-pressed') === 'true') !== onBar");
  });
});

describe('spellbook_window: tooltip/summary reflect talent changes (tooltip parity)', () => {
  it('re-renders the open window only when a resolved ability number changed', () => {
    // tickOpen compares a content signature (id/rank/cost/cast/cooldown) of
    // world.known, not its array identity: the online mirror rebuilds that array
    // every snapshot, so reference equality would rebuild the DOM every frame. A
    // real change (e.g. a talent dropping Wicked Slash cost 45 -> 40) rebuilds the
    // row summaries; an unchanged frame falls back to the cheap toggle refresh.
    expect(code).toContain('tickOpen()');
    expect(code).toContain(
      'SpellbookWindow.knownSig(this.deps.world().known) !== this.lastKnownSig',
    );
    expect(code).toContain('this.lastKnownSig = SpellbookWindow.knownSig(world.known)');
    // the signature carries the numbers a row summary paints, so a cost/cooldown
    // change flips it (a bare id:rank would miss a same-rank talent cost cut).
    expect(code).toMatch(/knownSig[\s\S]*k\.def\.id.*k\.rank.*k\.cost.*k\.castTime.*k\.cooldown/);
  });

  it('preserves scroll position and keyboard focus across the talent-driven rebuild', () => {
    // render() rebuilds the list via innerHTML and the window root is the scroll
    // container, so the rebuild must restore scrollTop and refocus the row/toggle
    // the user was on (by ability id), or a talent change would jump the list to
    // the top and drop focus (a WCAG focus-loss regression).
    expect(code).toContain('rerenderPreservingView()');
    expect(code).toContain('const scrollTop = root.scrollTop');
    expect(code).toContain('root.scrollTop = scrollTop');
    expect(code).toContain('el.dataset.abilityId = row.abilityId');
    expect(code).toContain('(root.querySelector(refocus) as HTMLElement | null)?.focus()');
  });

  it('resolves each row tooltip LIVE at hover, not the render-time capture', () => {
    // A talent allocated while the spellbook is open reassigns world.known with a
    // new cost/damage; the hover tooltip must reflect it even before the next
    // tickOpen rebuild lands, so it resolves the ability fresh by id.
    expect(code).toContain(
      'this.deps.world().known.find((k) => k.def.id === known.def.id) ?? known',
    );
  });
});

// ---------------------------------------------------------------------------
// Skills Manager: the two footer buttons and the two per-row controls. Source
// guards in the spirit of the rest of this file (the window builds DOM against
// index.html, so its wiring is pinned by structure + string, not by rendering).
// ---------------------------------------------------------------------------

describe('spellbook_window: the Skills Manager footer', () => {
  it('renders both footer buttons AFTER the spell list, at the window bottom', () => {
    expect(code).toContain('this.appendFooter(el, view.managerMode, view.locked)');
    // The footer must come after the rows, so it lands at the bottom of the panel.
    expect(code.indexOf('for (const row of view.rows)')).toBeLessThan(
      code.indexOf('this.appendFooter(el'),
    );
  });

  it('drives both toggles from the persisted state and writes back through the deps', () => {
    expect(code).toContain('this.deps.setManagerMode(!this.deps.managerMode())');
    expect(code).toContain('this.deps.setTrackersLocked(!this.deps.trackersLocked())');
    // Reads flow into the pure view, so the button pressed states come from one place.
    expect(code).toContain('managerMode: this.deps.managerMode()');
    expect(code).toContain('locked: this.deps.trackersLocked()');
    expect(code).toContain('tracking: this.deps.tracking()');
  });

  it('states each toggle as an aria-pressed button with a distinct on/off name', () => {
    expect(code).toContain("btn.setAttribute('aria-pressed', pressed ? 'true' : 'false')");
    for (const key of [
      'hudChrome.skillTracker.managerButtonOnAria',
      'hudChrome.skillTracker.managerButtonOffAria',
      'hudChrome.skillTracker.lockButtonOnAria',
      'hudChrome.skillTracker.lockButtonOffAria',
    ]) {
      expect(code).toContain(`t('${key}')`);
    }
  });
});

describe('spellbook_window: the Skills Manager row controls', () => {
  it('appends the display + type controls only in manager mode, and only when trackable', () => {
    expect(code).toContain(
      'if (managerMode && row.trackable) this.appendManagerControls(el, row, name)',
    );
  });

  it('appends them AFTER the hotbar toggle, so they sit at the row right edge', () => {
    expect(code.indexOf('el.appendChild(toggle)')).toBeLessThan(
      code.indexOf('if (managerMode && row.trackable)'),
    );
  });

  it('routes the display toggle and the type cycle through the deps', () => {
    expect(code).toContain('this.deps.setTracked(row.abilityId, !row.tracked)');
    expect(code).toContain(
      'this.deps.setTrackDisplay(row.abilityId, nextSkillTrackerDisplay(row.trackDisplay))',
    );
  });

  it('renders both controls as localized, accessibly named buttons', () => {
    // The display toggle is a real aria-pressed toggle (it mirrors an interface
    // setting); the type button is a cycling button whose name states the value.
    expect(code).toContain("display.setAttribute('aria-pressed', row.tracked ? 'true' : 'false')");
    expect(code).toContain("t('hudChrome.skillTracker.displayAria', { name })");
    expect(code).toContain("t('hudChrome.skillTracker.typeAria'");
    // The type label resolves through one helper, so pin the two keys it picks
    // between rather than a t() call shape biome may wrap.
    expect(code).toContain("'hudChrome.skillTracker.typeBar'");
    expect(code).toContain("'hudChrome.skillTracker.typeSquare'");
  });

  it('keeps keyboard focus on the exact control across the click rebuild', () => {
    // Each click re-renders; without these the focus would fall back to the row.
    expect(code).toContain('refocus = `[data-track-toggle="${trackToggle}"]`');
    expect(code).toContain('refocus = `[data-track-type="${trackType}"]`');
    expect(code).toContain('refocus = `[data-footer-btn="${footerBtn}"]`');
  });

  it('renders no raw player-facing string: every label goes through t()', () => {
    // The two glyph-free labels included: a bare 'On' / 'Off' string would be an
    // untranslatable leak, so they must resolve through the catalog like the rest.
    expect(code).toContain("'hudChrome.skillTracker.displayOn'");
    expect(code).toContain("'hudChrome.skillTracker.displayOff'");
    expect(code).toContain("t('hudChrome.skillTracker.managerHint'");
  });
});
