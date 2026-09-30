// The staff-only login mode choice on the character-select screen: "Normal"
// or "Incognito" (server/incognito.ts). Incognito asks the server to hide the
// account's wallet, Discord, and identity flair from other players for the
// session it is about to enter; the integrations themselves keep working.
//
// The thin painter over the pure view-core in login_mode_view.ts. The choice
// is offered only to a staff account (the whoami `admin` flag), and the server
// re-checks staff on the handshake, so a forged request from an ordinary
// account is inert. The last choice is remembered per browser as a
// convenience; storage failures (private mode, blocked site data) fall back to
// Normal.

import { t } from './i18n';
import {
  incognitoRequested,
  type LoginMode,
  loginModeView,
  parseLoginMode,
} from './login_mode_view';

export const LOGIN_MODE_STORAGE_KEY = 'woc.loginMode';

export interface LoginModeChoice {
  /** Show or hide the choice for the signed-in account (false on sign-out). */
  setAdmin(isAdmin: boolean): void;
  /** True when the next world entry should ask for incognito. Deliberately
   *  NOT gated on the async whoami answer: an entry (or a boot resume) that
   *  outran it would otherwise silently drop the mode. The server honors the
   *  request for staff alone, so a stale pick on a non-staff account is inert. */
  incognito(): boolean;
}

interface ModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readStoredMode(storage: ModeStorage | null): LoginMode {
  try {
    return parseLoginMode(storage?.getItem(LOGIN_MODE_STORAGE_KEY));
  } catch {
    return 'normal';
  }
}

function writeStoredMode(storage: ModeStorage | null, mode: LoginMode): void {
  try {
    storage?.setItem(LOGIN_MODE_STORAGE_KEY, mode);
  } catch {
    /* storage unavailable: the choice holds for this page only */
  }
}

/**
 * Paint the choice into `root` (the `#charselect-login-mode` slot on the
 * character-select roster). A null root (a layout without the slot) still
 * tracks the mode so entry stays correct. Buttons carry data-i18n so a later
 * language switch re-translates them in place.
 */
export function createLoginModeChoice(
  root: HTMLElement | null,
  storage: ModeStorage | null = safeLocalStorage(),
): LoginModeChoice {
  let isAdmin = false;
  let mode = readStoredMode(storage);

  const paint = () => {
    if (!root) return;
    const view = loginModeView(isAdmin, mode);
    root.hidden = !view.visible;
    if (!view.visible) {
      root.replaceChildren();
      return;
    }
    const label = document.createElement('div');
    label.className = 'cs-login-mode-label';
    label.id = 'charselect-login-mode-label';
    label.setAttribute('data-i18n', 'character.loginMode.label');
    label.textContent = t('character.loginMode.label');
    const seg = document.createElement('div');
    seg.className = 'ui-seg cs-login-mode-seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-labelledby', label.id);
    for (const opt of view.options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ui-seg-tab${opt.on ? ' is-on' : ''}`;
      btn.setAttribute('aria-pressed', opt.on ? 'true' : 'false');
      btn.dataset.mode = opt.mode;
      btn.setAttribute('data-i18n', opt.labelKey);
      btn.textContent = t(opt.labelKey);
      btn.addEventListener('click', () => {
        if (mode === opt.mode) return;
        mode = opt.mode;
        writeStoredMode(storage, mode);
        paint();
        root.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus();
      });
      seg.appendChild(btn);
    }
    const hint = document.createElement('div');
    hint.className = 'cs-login-mode-hint';
    hint.setAttribute('data-i18n', view.hintKey);
    hint.textContent = t(view.hintKey);
    root.replaceChildren(label, seg, hint);
  };

  paint();
  return {
    setAdmin(next: boolean) {
      if (next === isAdmin) return;
      isAdmin = next;
      paint();
    },
    incognito: () => incognitoRequested(mode),
  };
}

function safeLocalStorage(): ModeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
