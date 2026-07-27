import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudPrefsSync, type PrefsTransport } from '../src/net/cloud_prefs';
import { normalizePrefsResponse, PrefsWriteBuffer } from '../src/net/cloud_prefs_core';

describe('PrefsWriteBuffer', () => {
  it('coalesces per-key writes, last write wins', () => {
    const buf = new PrefsWriteBuffer();
    buf.add('woc_settings', { a: 1 });
    buf.add('woc_settings', { a: 2 });
    buf.add('woc_keybinds', null);
    expect(buf.size).toBe(2);
    expect(buf.drain()).toEqual({ woc_settings: { a: 2 }, woc_keybinds: null });
    expect(buf.size).toBe(0);
  });

  it('restore re-adds only keys not written since', () => {
    const buf = new PrefsWriteBuffer();
    buf.add('woc_settings', { a: 3 }); // a newer write for woc_settings
    buf.restore({ woc_settings: { a: 1 }, woc_keybinds: { b: 1 } });
    expect(buf.drain()).toEqual({ woc_settings: { a: 3 }, woc_keybinds: { b: 1 } });
  });
});

describe('normalizePrefsResponse', () => {
  it('extracts the prefs map and tolerates junk', () => {
    expect(normalizePrefsResponse({ prefs: { woc_settings: { a: 1 } } })).toEqual({
      woc_settings: { a: 1 },
    });
    expect(normalizePrefsResponse(null)).toEqual({});
    expect(normalizePrefsResponse({})).toEqual({});
    expect(normalizePrefsResponse({ prefs: [] })).toEqual({});
    expect(normalizePrefsResponse('nope')).toEqual({});
  });
});

describe('CloudPrefsSync', () => {
  function fakeTransport(): PrefsTransport & {
    pushed: Array<Record<string, unknown>>;
    fetchResult: Record<string, unknown>;
    failNext: boolean;
  } {
    const state = {
      pushed: [] as Array<Record<string, unknown>>,
      fetchResult: {} as Record<string, unknown>,
      failNext: false,
      async fetchAll() {
        return state.fetchResult;
      },
      async push(entries: Record<string, unknown>) {
        if (state.failNext) {
          state.failNext = false;
          throw new Error('push failed');
        }
        state.pushed.push(entries);
      },
    };
    return state;
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hydrate applies each fetched key to the sink', async () => {
    const t = fakeTransport();
    t.fetchResult = { woc_settings: { a: 1 }, woc_keybinds: { b: 2 } };
    const applied: Array<[string, unknown]> = [];
    await new CloudPrefsSync(t).hydrate((k, v) => applied.push([k, v]));
    expect(applied).toEqual([
      ['woc_settings', { a: 1 }],
      ['woc_keybinds', { b: 2 }],
    ]);
  });

  it('hydrate swallows a transport failure (keeps local values)', async () => {
    const t = fakeTransport();
    t.fetchAll = async () => {
      throw new Error('offline');
    };
    const applied: unknown[] = [];
    await new CloudPrefsSync(t).hydrate((k) => applied.push(k));
    expect(applied).toEqual([]);
  });

  it('debounces a burst into one coalesced push', async () => {
    const t = fakeTransport();
    const sync = new CloudPrefsSync(t, 100);
    sync.enqueue('woc_settings', { a: 1 });
    sync.enqueue('woc_settings', { a: 2 });
    sync.enqueue('woc_keybinds', null);
    expect(t.pushed).toEqual([]); // not flushed yet
    await vi.advanceTimersByTimeAsync(100);
    expect(t.pushed).toEqual([{ woc_settings: { a: 2 }, woc_keybinds: null }]);
  });

  it('restores the batch and retries after a failed push', async () => {
    const t = fakeTransport();
    t.failNext = true;
    const sync = new CloudPrefsSync(t, 100);
    sync.enqueue('woc_settings', { a: 1 });
    await vi.advanceTimersByTimeAsync(100); // first flush fails, re-arms
    expect(t.pushed).toEqual([]);
    await vi.advanceTimersByTimeAsync(100); // retry succeeds
    expect(t.pushed).toEqual([{ woc_settings: { a: 1 } }]);
  });
});
