// One-call composition of the desktop-shell niceties the game client provides
// when running inside the Electron wrapper: pushing t()-localized strings for
// main-process dialogs and rendering the auto-update toast. src/main.ts calls
// this once (gated on DESKTOP_APP); every piece degrades to a no-op when the
// bridge or a bridge method is absent (older installed shell, plain browser).

import { desktopBridge } from '../runtime';
import { initDesktopUpdateToast } from '../ui/desktop_update_toast';
import { initDesktopShellStrings } from './desktop_shell_strings';

export function initDesktopShellIntegration(): void {
  const bridge = desktopBridge();
  if (!bridge) return;
  initDesktopShellStrings(bridge);
  initDesktopUpdateToast(bridge);
}
