// The staff-only login mode choice's pure view-core: which options the
// character-select roster shows, which is on, the hint under them, and whether
// the next world entry asks for incognito (server/incognito.ts). DOM-free; the
// painter is login_mode_choice.ts, pinned by tests/login_mode_choice.test.ts.

import type { TranslationKey } from './i18n';

export type LoginMode = 'normal' | 'incognito';

const MODES: readonly LoginMode[] = ['normal', 'incognito'];

const MODE_LABEL_KEYS: Record<LoginMode, TranslationKey> = {
  normal: 'character.loginMode.normal',
  incognito: 'character.loginMode.incognito',
};

export interface LoginModeOptionView {
  mode: LoginMode;
  labelKey: TranslationKey;
  on: boolean;
}

export interface LoginModeView {
  /** Staff only: an ordinary account never sees the choice. */
  visible: boolean;
  options: LoginModeOptionView[];
  hintKey: TranslationKey;
}

/** Read a stored mode; anything but the exact 'incognito' literal is Normal. */
export function parseLoginMode(raw: unknown): LoginMode {
  return raw === 'incognito' ? 'incognito' : 'normal';
}

/** What the painter draws for a (staff?, chosen mode) pair. */
export function loginModeView(isAdmin: boolean, mode: LoginMode): LoginModeView {
  return {
    visible: isAdmin,
    options: MODES.map((m) => ({ mode: m, labelKey: MODE_LABEL_KEYS[m], on: m === mode })),
    hintKey:
      mode === 'incognito' ? 'character.loginMode.incognitoHint' : 'character.loginMode.normalHint',
  };
}

/**
 * Whether the next world entry asks for incognito: the stored pick alone.
 * Not gated on staff here on purpose: the client learns staff from an async
 * whoami that a fast Enter World or a boot resume can outrun, and dropping the
 * mode then would re-broadcast the flair the player chose to hide. The server
 * (server/incognito.ts negotiateIncognito) is the staff gate.
 */
export function incognitoRequested(mode: LoginMode): boolean {
  return mode === 'incognito';
}
