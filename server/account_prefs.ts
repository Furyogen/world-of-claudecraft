// Account-preference sync API: the endpoints that let the Esc-menu settings, the
// account-wide keybind layout, and each character's action-bar pages follow an
// account across browsers and the desktop app (mobile native apps opt out on the
// client). Scaffolded by `npm run new:endpoint`, then filled in as the two-route
// (GET read, PUT write) preference surface.
//
//   GET /api/preferences   read every stored preference for the account
//   PUT /api/preferences   apply a { entries: { key: value } } batch (null deletes)
//
// Server-authority note: these values are OPAQUE client UI state, not gameplay.
// The server never interprets them; it authenticates the account, caps key/value
// size (account_prefs_validate.ts + the db caps), and stores/returns the JSON
// verbatim. It emits stable CODES, never English prose (the client localizes).

import {
  getAccountPreferences,
  type PrefEntry,
  PrefsKeyLimitError,
  putAccountPreferences,
} from './account_prefs_db';
import { parsePrefsWrite } from './account_prefs_validate';
import { pool } from './db';
import { ctxAccountId } from './http/context';
import { HttpError } from './http/errors';
import { withBody } from './http/middleware/body';
import { requireAccount } from './http/middleware/require_account';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';

// Body cap for the PUT: comfortably above a heavy first-sync batch (settings +
// account-wide keybinds + a multi-form character's action-bar pages coalesced into
// one debounced flush, each value ~1 KiB), so a legitimate sync never 413s, while
// the per-value / per-entry / total-key caps (account_prefs_validate.ts +
// account_prefs_db.ts) still bound abuse. Larger than the 64 KiB default withBody cap.
const PREFS_BODY_MAX_BYTES = 256 * 1024;

// Data-store seam. The real bundle binds the pg pool to the db-layer queries; a
// unit test swaps in a fake with no Postgres (the FakeDb pattern). Kept off the
// auth path, which requireAccount owns.
export interface AccountPrefsStore {
  getAccountPreferences(accountId: number): Promise<Record<string, unknown>>;
  putAccountPreferences(accountId: number, entries: readonly PrefEntry[]): Promise<void>;
}

const REAL_STORE: AccountPrefsStore = {
  getAccountPreferences: (accountId) => getAccountPreferences(pool, accountId),
  putAccountPreferences: (accountId, entries) => putAccountPreferences(pool, accountId, entries),
};
let store: AccountPrefsStore = REAL_STORE;

/** Override the data store with a fake (test-only; merges over the real reads). */
export function setAccountPrefsStoreForTests(overrides: Partial<AccountPrefsStore>): void {
  store = { ...REAL_STORE, ...overrides };
}

/** Restore the real data store after an override (test-only). */
export function resetAccountPrefsStoreForTests(): void {
  store = REAL_STORE;
}

/** GET /api/preferences: every stored preference for the authenticated account. */
async function getPreferencesHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  const prefs = await store.getAccountPreferences(accountId);
  json(ctx.res, 200, { prefs });
}

/** PUT /api/preferences: apply a validated batch of preference writes. */
async function putPreferencesHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  const parsed = parsePrefsWrite(ctx.body);
  if (!parsed.ok) throw new HttpError(400, 'account_prefs.invalid_input');
  try {
    await store.putAccountPreferences(accountId, parsed.entries);
  } catch (err) {
    // The per-account key cap is a client-input problem (too many keys), so it
    // surfaces as the same 400 invalid_input rather than a 500.
    if (err instanceof PrefsKeyLimitError) throw new HttpError(400, 'account_prefs.invalid_input');
    throw err;
  }
  json(ctx.res, 200, { ok: true });
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/preferences',
    surface: 'api',
    // A read-scoped token (companion/OAuth) may read preferences; a full session
    // may too. The moderation gate still applies to both.
    middleware: [requireAccount({ scope: 'read' })],
    handler: getPreferencesHandler,
  },
  {
    method: 'PUT',
    path: '/api/preferences',
    surface: 'api',
    // Writing preferences mutates account state, so it needs a full (active) token.
    middleware: [requireAccount({ scope: 'active' }), withBody(PREFS_BODY_MAX_BYTES)],
    handler: putPreferencesHandler,
  },
];
