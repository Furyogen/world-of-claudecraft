// Pure, DOM-free core of the account preference sync: the write-coalescing buffer
// and the GET-response normalizer. No fetch, no timers, no storage, so it unit-tests
// directly in Node. The stateful net wrapper (debounce + fetch) lives in
// cloud_prefs.ts and consumes these.

// A pending value: any JSON value to upsert, or null to delete the key. undefined is
// never stored (the sink converts a removal to null).
export type PrefValue = unknown;

/**
 * Coalesces per-key writes between flushes: the LAST write for a key wins, so a
 * burst of rebinds or slot drags collapses to one entry per key. A delete (null)
 * and an upsert are both just the latest value for that key.
 */
export class PrefsWriteBuffer {
  private readonly pending = new Map<string, PrefValue>();

  add(key: string, value: PrefValue): void {
    this.pending.set(key, value);
  }

  get size(): number {
    return this.pending.size;
  }

  /** Snapshot the pending writes as a plain object and clear the buffer. */
  drain(): Record<string, PrefValue> {
    const out: Record<string, PrefValue> = {};
    for (const [key, value] of this.pending) out[key] = value;
    this.pending.clear();
    return out;
  }

  /**
   * Re-add entries from a failed push WITHOUT clobbering a key the caller has
   * written again since (that newer write is the one that should reach the server).
   */
  restore(entries: Record<string, PrefValue>): void {
    for (const [key, value] of Object.entries(entries)) {
      if (!this.pending.has(key)) this.pending.set(key, value);
    }
  }
}

/**
 * Pull the `{ prefs: { key: value } }` map out of a GET /api/preferences body,
 * tolerating any malformed shape (returns an empty map rather than throwing). The
 * values are the parsed JSON the client originally stored.
 */
export function normalizePrefsResponse(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const prefs = (raw as { prefs?: unknown }).prefs;
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return {};
  return prefs as Record<string, unknown>;
}
