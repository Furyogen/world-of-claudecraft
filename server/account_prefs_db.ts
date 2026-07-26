// Account-scoped client-preference sync store (SQL only). One small key/value bag
// per account: the Esc-menu settings, the account-wide keybind layout, and each
// character's action-bar pages. It lets those preferences follow an account across
// browsers and the desktop app instead of living only in one device's
// localStorage. Schema is a const string appended to ensureSchema() in db.ts (like
// DISCORD_SCHEMA / MAPS_SCHEMA); every query function takes the shared `pool` as an
// argument so this module never imports db.ts, keeping the cycle out.
//
// The stored values are OPAQUE JSON the client owns. The server never interprets
// them: it enforces only key shape and size caps, and runs every value straight
// back to the same client that wrote it. It is deliberately NOT the character save
// (that stays authoritative JSONB in characters.state); losing or ignoring a
// preference row only drops a cosmetic UI layout, never gameplay state.

import type { Pool } from 'pg';

export const ACCOUNT_PREFERENCES_SCHEMA = `
-- One row per (account, preference key). key is the client's localStorage key
-- (settings, keybinds, per-character hotbar pages); value is the opaque JSON blob
-- the client stored there. ON DELETE CASCADE so deleting an account drops its
-- preferences. account_id leads the PRIMARY KEY, so the per-account read is a
-- covered index range scan.
CREATE TABLE IF NOT EXISTS account_preferences (
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);
`;

// Caps. A synced account holds settings (1 key) + keybinds (1 key) + a handful of
// action-bar pages and migration markers per character. The limits are generous
// headroom for a heavy multi-character account while stopping the bag from being
// abused as free arbitrary storage. Enforced server-side regardless of what the
// client sends.
export const MAX_PREF_KEYS = 400;
export const MAX_PREF_VALUE_BYTES = 8192;
export const MAX_PREF_KEY_LENGTH = 160;
// Per-request batch cap: a full first-sync of a many-character account still fits,
// but one request can never rewrite an unbounded number of rows.
export const MAX_PREF_ENTRIES_PER_REQUEST = 200;
// Only client keys of this shape are accepted. Every synced key is a `woc_`
// localStorage key (settings/keybinds/hotbar); the charset covers the `:` and `_`
// separators those keys use and nothing that could smuggle SQL or control bytes
// (the value is parameterized regardless, this is defense in depth + tidiness).
export const PREF_KEY_PATTERN = /^woc_[A-Za-z0-9_:.-]{1,156}$/;

export interface PrefEntry {
  key: string;
  // undefined / null both DELETE the key; any other JSON value UPSERTs it.
  value: unknown;
}

/** Raised when a write would push the account over MAX_PREF_KEYS. */
export class PrefsKeyLimitError extends Error {
  constructor() {
    super('account preference key limit exceeded');
    this.name = 'PrefsKeyLimitError';
  }
}

/** Every stored preference for an account: { [key]: value }. Empty when none. */
export async function getAccountPreferences(
  pool: Pool,
  accountId: number,
): Promise<Record<string, unknown>> {
  const res = await pool.query<{ key: string; value: unknown }>(
    'SELECT key, value FROM account_preferences WHERE account_id = $1',
    [accountId],
  );
  const out: Record<string, unknown> = {};
  for (const row of res.rows) out[row.key] = row.value;
  return out;
}

/**
 * Apply a batch of preference writes atomically. An entry whose value is null or
 * undefined DELETES that key; any other value UPSERTs it. The whole batch runs in
 * one transaction so a client sync is all-or-nothing, and the per-account key cap
 * is re-checked inside the transaction AFTER the writes (so a client that also
 * clears keys in the same batch can always stay under the cap). A batch that would
 * leave the account above MAX_PREF_KEYS rolls back and throws PrefsKeyLimitError.
 * Callers validate key shape and value size BEFORE calling (cheap, DB-free).
 */
export async function putAccountPreferences(
  pool: Pool,
  accountId: number,
  entries: readonly PrefEntry[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const entry of entries) {
      if (entry.value === null || entry.value === undefined) {
        await client.query('DELETE FROM account_preferences WHERE account_id = $1 AND key = $2', [
          accountId,
          entry.key,
        ]);
        continue;
      }
      await client.query(
        `INSERT INTO account_preferences (account_id, key, value, updated_at)
         VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (account_id, key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [accountId, entry.key, JSON.stringify(entry.value)],
      );
    }
    const count = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM account_preferences WHERE account_id = $1',
      [accountId],
    );
    if (Number(count.rows[0]?.count ?? '0') > MAX_PREF_KEYS) {
      await client.query('ROLLBACK');
      throw new PrefsKeyLimitError();
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
