import { describe, expect, it } from 'vitest';
import { DEFAULT_SHELL_STRINGS } from '../electron/shell_strings.cjs';
import { desktopShellStringsPayload } from '../src/game/desktop_shell_strings';

// Cross-boundary contract: the renderer pushes t()-localized strings for the
// main process's crash dialogs (desktop-set-strings). The payload must cover
// exactly the keys electron/shell_strings.cjs knows, and in English the pushed
// values must MATCH the electron-side defaults, so the pre-push fallback (a
// crash before the client booted) reads identically to the first push.
describe('desktopShellStringsPayload', () => {
  it('covers exactly the DEFAULT_SHELL_STRINGS keys', () => {
    expect(Object.keys(desktopShellStringsPayload()).sort()).toEqual(
      Object.keys(DEFAULT_SHELL_STRINGS).sort(),
    );
  });

  it('matches the electron-side English defaults value for value', () => {
    const payload = desktopShellStringsPayload();
    for (const [key, value] of Object.entries(DEFAULT_SHELL_STRINGS)) {
      expect(payload[key], key).toBe(value);
    }
  });
});
