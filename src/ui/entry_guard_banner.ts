// Start-screen banner shown after the world-entry crash guard lowered the graphics
// preset (src/game/entry_crash_guard.ts): the player's previous entry attempt killed
// the WebView process, so they never saw an error. This tells them what happened and
// where the graphics control is, on the one screen the recovery guarantees they reach.
// Thin DOM painter over the static #entry-guard-banner shell in index.html.

import { type TranslationKey, t } from './i18n';

const PRESET_LABEL_KEYS: Record<number, TranslationKey> = {
  1: 'hud.options.graphicsPresetLow',
  2: 'hud.options.graphicsPresetMedium',
  3: 'hud.options.graphicsPresetHigh',
  4: 'hud.options.graphicsPresetUltra',
  5: 'hud.options.graphicsPresetAdvanced',
};

/** Localized display name for a graphicsPreset settings value. */
export function graphicsPresetDisplayName(preset: number): string {
  const key = PRESET_LABEL_KEYS[Math.round(preset)];
  return key ? t(key) : t('hud.options.graphicsPresetLow');
}

/**
 * Reveal the banner with the recovered preset named in the body. Safe to call on
 * entries whose DOM lacks the banner shell (play.html): it no-ops.
 */
export function showEntryGuardBanner(preset: number): void {
  const banner = document.getElementById('entry-guard-banner');
  if (!banner) return;
  const body = banner.querySelector<HTMLElement>('.entry-guard-body');
  if (body) {
    body.textContent = t('entryGuard.body', { preset: graphicsPresetDisplayName(preset) });
  }
  banner.hidden = false;
  const dismiss = banner.querySelector<HTMLButtonElement>('.entry-guard-dismiss');
  // dataset guard: a repeat call (re-shown banner) must not stack dismiss listeners.
  if (dismiss && !dismiss.dataset.wired) {
    dismiss.dataset.wired = '1';
    dismiss.addEventListener('click', () => {
      banner.hidden = true;
    });
  }
}
