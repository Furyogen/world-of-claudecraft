// The client-preference storage seam shared by the settings, keybind, and
// action-bar subsystems, plus the hook that mirrors their writes to the account
// preference sync (server/account_prefs.ts). Everything here is a thin wrapper over
// the same synchronous localStorage the subsystems already use, so the offline-first
// behavior is unchanged: reads are instant and local, and the cloud push is a
// best-effort side effect layered on top. Pure and DOM-guarded so it imports cleanly
// under Vitest's plain-Node env.
//
// Scope decision (account-wide vs per-character) lives at the call sites, not here:
// main.ts constructs the account-wide Keybinds/Settings and the per-character
// ActionBarController against the SAME SyncedStorage, and isSyncedPrefKey below is
// the single allowlist of which localStorage keys are eligible to leave the device.

/** The minimal storage surface Settings / Keybinds / ActionBarController depend on. */
export type PrefStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// The three synced key families. Settings is one account-global blob; the
// account-wide keybind layout is the bare legacy key (main.ts constructs online
// Keybinds with an empty scope so it reads/writes exactly this key); every
// action-bar page, form variant, seeding marker, and attack slot is a
// `woc_hotbar_`-prefixed per-character key.
export const SETTINGS_STORAGE_KEY = 'woc_settings';
export const KEYBINDS_STORAGE_KEY = 'woc_keybinds';
export const HOTBAR_STORAGE_PREFIX = 'woc_hotbar_';

/**
 * True for a localStorage key whose value should sync to the account. The
 * account-wide keybind key matches EXACTLY (the per-character `woc_keybinds:...`
 * scopes, used offline, never sync); settings match exactly; every `woc_hotbar_`
 * action-bar key syncs by prefix.
 */
export function isSyncedPrefKey(key: string): boolean {
  return (
    key === SETTINGS_STORAGE_KEY ||
    key === KEYBINDS_STORAGE_KEY ||
    key.startsWith(HOTBAR_STORAGE_PREFIX)
  );
}

/** A localStorage-backed PrefStorage that never throws (private mode / no DOM). */
export function defaultPrefStorage(): PrefStorage {
  return {
    getItem(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        /* storage unavailable */
      }
    },
    removeItem(key) {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        /* storage unavailable */
      }
    },
  };
}

/** Called on every synced write: the new string value, or null on removal. */
export type PrefWriteSink = (key: string, value: string | null) => void;

/**
 * A PrefStorage that forwards every read and write to an inner storage (the real
 * localStorage) AND notifies `onWrite` for keys that pass `isSynced`, so the sync
 * layer can push them to the account. Reads are untouched: the inner storage stays
 * the source of truth, and the sink is a pure side effect. Hydration writes go
 * straight to the inner storage (not through this wrapper), so pulling the account's
 * saved values never echoes back out as a push.
 */
export class SyncedStorage implements PrefStorage {
  constructor(
    private readonly inner: PrefStorage,
    private readonly onWrite: PrefWriteSink,
    private readonly isSynced: (key: string) => boolean = isSyncedPrefKey,
  ) {}

  getItem(key: string): string | null {
    return this.inner.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.inner.setItem(key, value);
    if (this.isSynced(key)) this.onWrite(key, value);
  }

  removeItem(key: string): void {
    this.inner.removeItem(key);
    if (this.isSynced(key)) this.onWrite(key, null);
  }
}
