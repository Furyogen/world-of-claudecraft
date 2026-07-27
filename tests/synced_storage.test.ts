import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultPrefStorage,
  isSyncedPrefKey,
  type PrefStorage,
  SyncedStorage,
} from '../src/game/synced_storage';

function memStorage(): PrefStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('isSyncedPrefKey', () => {
  it('matches settings, the account-wide keybind key, and every hotbar key', () => {
    expect(isSyncedPrefKey('woc_settings')).toBe(true);
    expect(isSyncedPrefKey('woc_keybinds')).toBe(true);
    expect(isSyncedPrefKey('woc_hotbar_mage_Gandalf')).toBe(true);
    expect(isSyncedPrefKey('woc_hotbar_mage_Gandalf_bear')).toBe(true);
    expect(isSyncedPrefKey('woc_hotbar_mage_Gandalf:s0')).toBe(true);
  });

  it('does NOT sync per-character keybind scopes or unrelated keys', () => {
    // Per-character (offline) keybind scopes never sync; only the bare account key.
    expect(isSyncedPrefKey('woc_keybinds:char:5')).toBe(false);
    expect(isSyncedPrefKey('woc_keybinds:offline:mage:Gandalf')).toBe(false);
    expect(isSyncedPrefKey('woc_theme')).toBe(false);
    expect(isSyncedPrefKey('woc_spawn_intro_seen:char:5')).toBe(false);
  });
});

describe('SyncedStorage', () => {
  it('reads and writes through to the inner storage', () => {
    const inner = memStorage();
    const store = new SyncedStorage(inner, () => {});
    store.setItem('woc_settings', '{"a":1}');
    expect(store.getItem('woc_settings')).toBe('{"a":1}');
    expect(inner.map.get('woc_settings')).toBe('{"a":1}');
    store.removeItem('woc_settings');
    expect(inner.map.has('woc_settings')).toBe(false);
  });

  it('notifies onWrite ONLY for synced keys, with the value or null on removal', () => {
    const inner = memStorage();
    const writes: Array<[string, string | null]> = [];
    const store = new SyncedStorage(inner, (k, v) => writes.push([k, v]));
    store.setItem('woc_settings', '{"a":1}'); // synced
    store.setItem('woc_theme', 'dark'); // not synced
    store.removeItem('woc_keybinds'); // synced delete
    store.removeItem('woc_theme'); // not synced
    expect(writes).toEqual([
      ['woc_settings', '{"a":1}'],
      ['woc_keybinds', null],
    ]);
  });
});

describe('defaultPrefStorage', () => {
  const original = globalThis.localStorage;
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
  });

  it('delegates to globalThis.localStorage', () => {
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
      },
      configurable: true,
    });
    const store = defaultPrefStorage();
    store.setItem('woc_settings', 'x');
    expect(store.getItem('woc_settings')).toBe('x');
    store.removeItem('woc_settings');
    expect(store.getItem('woc_settings')).toBeNull();
  });

  it('never throws when storage access throws (private mode)', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('blocked');
      },
      configurable: true,
    });
    const store = defaultPrefStorage();
    expect(() => store.setItem('woc_settings', 'x')).not.toThrow();
    expect(store.getItem('woc_settings')).toBeNull();
    expect(() => store.removeItem('woc_settings')).not.toThrow();
  });
});
