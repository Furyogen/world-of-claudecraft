// Pure request validation for the account-preference sync PUT (no IO, no pg, no
// http). Decides whether a client's { entries: { [key]: value } } batch is
// acceptable and normalizes it into the flat PrefEntry[] the db layer applies. The
// server owns these limits regardless of what the client claims, so the whole
// batch is rejected (not silently trimmed) when any key or value is out of bounds:
// a well-behaved client never trips them, and a misbehaving one gets no partial
// write. Kept separate from account_prefs_db.ts (SQL) and account_prefs.ts (the
// http shell) so it unit-tests directly, the wallet_link.ts / wallet.ts split.

import {
  MAX_PREF_ENTRIES_PER_REQUEST,
  MAX_PREF_KEY_LENGTH,
  MAX_PREF_VALUE_BYTES,
  PREF_KEY_PATTERN,
  type PrefEntry,
} from './account_prefs_db';

export type ParsePrefsResult = { ok: true; entries: PrefEntry[] } | { ok: false };

/**
 * Validate and normalize a preference-write body. Accepts a `{ entries: {...} }`
 * object whose values are opaque JSON (null/undefined mean "delete this key"). On
 * any shape, key-charset, count, or value-size violation returns { ok: false }; the
 * handler maps that to a single 400 code. A value that cannot be JSON-serialized
 * (a function, a bigint, a circular object) is rejected the same way.
 */
export function parsePrefsWrite(body: unknown): ParsePrefsResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const entriesRaw = (body as Record<string, unknown>).entries;
  if (!entriesRaw || typeof entriesRaw !== 'object' || Array.isArray(entriesRaw)) {
    return { ok: false };
  }
  const map = entriesRaw as Record<string, unknown>;
  const keys = Object.keys(map);
  if (keys.length === 0 || keys.length > MAX_PREF_ENTRIES_PER_REQUEST) return { ok: false };
  const entries: PrefEntry[] = [];
  for (const key of keys) {
    if (key.length > MAX_PREF_KEY_LENGTH || !PREF_KEY_PATTERN.test(key)) return { ok: false };
    const value = map[key];
    if (value === null || value === undefined) {
      entries.push({ key, value: null });
      continue;
    }
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(value);
    } catch {
      return { ok: false }; // circular / non-serializable
    }
    // JSON.stringify returns undefined for a bare function/symbol/undefined value.
    if (typeof serialized !== 'string') return { ok: false };
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PREF_VALUE_BYTES) return { ok: false };
    entries.push({ key, value });
  }
  return { ok: true, entries };
}
