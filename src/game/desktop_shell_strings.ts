// The Electron main process has no i18n runtime, but its crash dialogs are
// player-visible, so the renderer pushes t()-rendered strings over the
// wocDesktop bridge at boot and on every locale flip. The main-process side
// caches them (electron/shell_strings.cjs) and falls back to English only for
// a crash that happens before this module ever ran. The payload keys form a
// cross-boundary contract with DEFAULT_SHELL_STRINGS over there, pinned by
// tests/desktop_shell_strings.test.ts.

import type { DesktopBridge } from '../runtime';
import { t } from '../ui/i18n';

export function desktopShellStringsPayload(): Record<string, string> {
  return {
    crashTitle: t('desktop.crash.title'),
    crashBody: t('desktop.crash.body'),
    crashReload: t('desktop.crash.reload'),
    crashQuit: t('desktop.crash.quit'),
    fatalTitle: t('desktop.crash.title'),
    fatalBody: t('desktop.crash.fatalBody'),
  };
}

export function initDesktopShellStrings(bridge: DesktopBridge): void {
  if (typeof bridge.setShellStrings !== 'function') return;
  const push = (): void => {
    void bridge.setShellStrings?.(desktopShellStringsPayload());
  };
  push();
  document.addEventListener('woc:languagechange', push);
}
