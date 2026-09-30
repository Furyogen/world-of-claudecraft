// The desktop character-select shared Enter World button painter, moved out of
// src/main.ts (the monolith ratchet) unchanged in behavior. The action itself is
// decided by the pure src/net/charselect_action.ts core; main.ts passes it in,
// since src/ui never imports src/net. The type below is its structural slice.

import { type TranslationKey, t } from './i18n';

export interface CharselectEnterButtonAction {
  kind: 'enter' | 'takeover' | 'disabled';
  labelKey: TranslationKey;
  titleKey: TranslationKey | null;
}

// Reflect the selected character's primary action on the desktop shared Enter
// World button: Enter World for a ready character, Take Over for one online
// elsewhere, and disabled (with a hint) while a forced rename is pending. A
// no-op when the button is absent (mobile/narrow layouts use per-row buttons).
export function paintCharselectEnterButton(action: CharselectEnterButtonAction): void {
  const btn = document.getElementById('btn-charselect-enter') as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = action.kind === 'disabled';
  // Drive BOTH the i18n key and the rendered text/title, so a later language
  // switch (translatePage re-applies every [data-i18n]/[data-i18n-title]) rerenders
  // the current dynamic state instead of clobbering it back to the static "Enter
  // World". Same approach as applyServerMode.
  btn.setAttribute('data-i18n', action.labelKey);
  btn.textContent = t(action.labelKey);
  if (action.titleKey) {
    btn.setAttribute('data-i18n-title', action.titleKey);
    btn.title = t(action.titleKey);
  } else {
    btn.removeAttribute('data-i18n-title');
    btn.removeAttribute('title');
  }
}
