// Account preference sync client: hydrates the account's saved settings / keybinds
// / action bars from the server at login and pushes local changes back, debounced.
// It is deliberately best-effort and offline-first: localStorage stays the source of
// truth, a failed pull leaves the device's own values in place, and a failed push is
// retried on the next flush. main.ts owns the wiring (transport + SyncedStorage);
// this module owns the debounce and the HTTP shape.

import { apiUrl } from '../client_origin';
import { normalizePrefsResponse, PrefsWriteBuffer, type PrefValue } from './cloud_prefs_core';

/** The two network operations the sync needs, injectable so tests use a fake. */
export interface PrefsTransport {
  /** GET the account's stored preferences as a { key: value } map. */
  fetchAll(): Promise<Record<string, unknown>>;
  /** PUT a batch of writes ({ key: value }, null value deletes the key). */
  push(entries: Record<string, PrefValue>): Promise<void>;
}

/** Default debounce: long enough to coalesce a burst of rebinds / slot drags. */
export const DEFAULT_PREFS_DEBOUNCE_MS = 1500;
// Bounds so a slow realm never stalls world entry (read) or wedges the flush (write).
const FETCH_TIMEOUT_MS = 5000;
const PUSH_TIMEOUT_MS = 8000;

export class CloudPrefsSync {
  private readonly buffer = new PrefsWriteBuffer();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(
    private readonly transport: PrefsTransport,
    private readonly debounceMs: number = DEFAULT_PREFS_DEBOUNCE_MS,
  ) {}

  /**
   * Pull the account's saved preferences and apply each to the passed sink (the raw
   * localStorage, so the writes do NOT echo back as pushes). Swallows a failed pull:
   * the device keeps its own local values, which the first local change re-seeds to
   * the account.
   */
  async hydrate(apply: (key: string, value: unknown) => void): Promise<void> {
    let prefs: Record<string, unknown> = {};
    try {
      prefs = await this.transport.fetchAll();
    } catch {
      return;
    }
    for (const [key, value] of Object.entries(prefs)) apply(key, value);
  }

  /** Queue a synced write (value null deletes the key) and arm the debounce. */
  enqueue(key: string, value: PrefValue): void {
    this.buffer.add(key, value);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Push the pending batch now. On failure, restore it and re-arm for retry. */
  async flush(): Promise<void> {
    if (this.flushing || this.buffer.size === 0) return;
    this.flushing = true;
    const batch = this.buffer.drain();
    try {
      await this.transport.push(batch);
    } catch {
      this.buffer.restore(batch);
      this.schedule();
    } finally {
      this.flushing = false;
    }
  }
}

/**
 * The production transport: authenticated GET/PUT against /api/preferences on the
 * current realm origin. `token` and `base` are read lazily so a realm switch or a
 * token refresh is picked up on the next call.
 */
export function httpPrefsTransport(deps: {
  token(): string | null;
  base(): string;
}): PrefsTransport {
  return {
    async fetchAll() {
      const token = deps.token();
      if (!token) return {};
      // Bounded so a slow/hung prefs read never stalls world entry: on timeout the
      // fetch aborts, hydrate swallows it, and the device keeps its local values.
      const res = await fetch(apiUrl('/api/preferences', deps.base()), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return {};
      return normalizePrefsResponse(await res.json().catch(() => ({})));
    },
    async push(entries) {
      const token = deps.token();
      if (!token) return;
      const res = await fetch(apiUrl('/api/preferences', deps.base()), {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries }),
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`preferences push failed: ${res.status}`);
    },
  };
}
