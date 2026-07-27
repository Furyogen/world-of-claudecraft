process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_account_prefs_test';

import type * as http from 'node:http';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetAccountPrefsStoreForTests,
  routes,
  setAccountPrefsStoreForTests,
} from '../../server/account_prefs';
import {
  getAccountPreferences,
  MAX_PREF_ENTRIES_PER_REQUEST,
  MAX_PREF_VALUE_BYTES,
  type PrefEntry,
  PrefsKeyLimitError,
  putAccountPreferences,
} from '../../server/account_prefs_db';
import { parsePrefsWrite } from '../../server/account_prefs_validate';
import { compose } from '../../server/http/compose';
import type { Ctx, Method, RouteDef } from '../../server/http/types';
import { fakeCtx } from './helpers';

interface FakeResShape {
  statusCode: number;
  body: string;
}

function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeResShape;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

function route(method: Method): RouteDef {
  const found = routes.find((r) => r.method === method);
  if (!found) throw new Error(`no ${method} route`);
  return found;
}

/** Run the full onion (auth middleware + handler) as the dispatcher would. */
function runFullRoute(r: RouteDef, ctx: Ctx): Promise<void> {
  return compose([...(r.middleware ?? [])])(ctx, async () => {
    await r.handler(ctx);
  });
}

afterEach(() => resetAccountPrefsStoreForTests());

// ---------------------------------------------------------------------------
// Pure validation core.
// ---------------------------------------------------------------------------
describe('parsePrefsWrite', () => {
  it('normalizes a mixed upsert/delete batch', () => {
    const result = parsePrefsWrite({
      entries: { woc_settings: { a: 1 }, woc_keybinds: null, woc_hotbar_mage_Gan: [1, 2] },
    });
    expect(result).toEqual({
      ok: true,
      entries: [
        { key: 'woc_settings', value: { a: 1 } },
        { key: 'woc_keybinds', value: null },
        { key: 'woc_hotbar_mage_Gan', value: [1, 2] },
      ],
    });
  });

  it('rejects a non-object body and a missing entries map', () => {
    expect(parsePrefsWrite(null).ok).toBe(false);
    expect(parsePrefsWrite([]).ok).toBe(false);
    expect(parsePrefsWrite({}).ok).toBe(false);
    expect(parsePrefsWrite({ entries: [] }).ok).toBe(false);
    expect(parsePrefsWrite({ entries: {} }).ok).toBe(false); // empty batch
  });

  it('rejects a key outside the woc_ allowlist charset', () => {
    expect(parsePrefsWrite({ entries: { evil_key: 1 } }).ok).toBe(false);
    expect(parsePrefsWrite({ entries: { 'woc_bad key': 1 } }).ok).toBe(false);
    expect(parsePrefsWrite({ entries: { woc_ok: 1 } }).ok).toBe(true);
  });

  it('rejects a value over the byte cap and a non-serializable value', () => {
    const big = 'x'.repeat(MAX_PREF_VALUE_BYTES + 1);
    expect(parsePrefsWrite({ entries: { woc_settings: big } }).ok).toBe(false);
    expect(parsePrefsWrite({ entries: { woc_settings: () => 1 } }).ok).toBe(false);
  });

  it('rejects a batch past the per-request entry cap', () => {
    const entries: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_PREF_ENTRIES_PER_REQUEST; i++) entries[`woc_k${i}`] = 1;
    expect(parsePrefsWrite({ entries }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB layer against a fake pool (no Postgres): routes deletes vs upserts, maps the
// read, and enforces the per-account key cap inside the transaction.
// ---------------------------------------------------------------------------
describe('account_prefs_db', () => {
  function fakePool(seed: Record<string, unknown> = {}, keyCount = 0) {
    const bag = new Map(Object.entries(seed));
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
        if (sql.startsWith('DELETE')) {
          bag.delete(String(params?.[1]));
          return { rows: [] };
        }
        if (sql.startsWith('INSERT')) {
          bag.set(String(params?.[1]), JSON.parse(String(params?.[2])));
          return { rows: [] };
        }
        if (sql.includes('count(*)')) {
          return { rows: [{ count: String(keyCount || bag.size) }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async () => ({
        rows: [...bag.entries()].map(([key, value]) => ({ key, value })),
      })),
    } as unknown as Pool;
    return { pool, client, bag, calls };
  }

  it('reads every stored key into a plain object', async () => {
    const { pool } = fakePool({ woc_settings: { a: 1 }, woc_keybinds: { b: 2 } });
    expect(await getAccountPreferences(pool, 7)).toEqual({
      woc_settings: { a: 1 },
      woc_keybinds: { b: 2 },
    });
  });

  it('upserts non-null values and deletes null ones, then commits', async () => {
    const { pool, bag, client } = fakePool({ woc_keybinds: { old: true } });
    const entries: PrefEntry[] = [
      { key: 'woc_settings', value: { v: 1 } },
      { key: 'woc_keybinds', value: null },
    ];
    await putAccountPreferences(pool, 7, entries);
    expect(bag.get('woc_settings')).toEqual({ v: 1 });
    expect(bag.has('woc_keybinds')).toBe(false);
    const issued = client.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0]);
    expect(issued).toContain('BEGIN');
    expect(issued).toContain('COMMIT');
    expect(issued).not.toContain('ROLLBACK');
  });

  it('rolls back and throws when the key cap is exceeded', async () => {
    const { pool, client } = fakePool({}, /* keyCount */ 100000);
    await expect(
      putAccountPreferences(pool, 7, [{ key: 'woc_settings', value: 1 }]),
    ).rejects.toBeInstanceOf(PrefsKeyLimitError);
    const issued = client.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0]);
    expect(issued).toContain('ROLLBACK');
    expect(issued).not.toContain('COMMIT');
  });
});

// ---------------------------------------------------------------------------
// Handlers, driven through the routes with the store faked.
// ---------------------------------------------------------------------------
describe('account_prefs handlers', () => {
  const account = { accountId: 42, scope: 'full' as const };

  it('GET returns the account preferences', async () => {
    setAccountPrefsStoreForTests({
      getAccountPreferences: async (id) => {
        expect(id).toBe(42);
        return { woc_settings: { a: 1 } };
      },
    });
    const ctx = fakeCtx({ method: 'GET', url: '/api/preferences', account });
    await route('GET').handler(ctx);
    expect(captured(ctx.res)).toEqual({ status: 200, body: { prefs: { woc_settings: { a: 1 } } } });
  });

  it('PUT applies a validated batch and returns ok', async () => {
    const applied: PrefEntry[] = [];
    setAccountPrefsStoreForTests({
      putAccountPreferences: async (id, entries) => {
        expect(id).toBe(42);
        applied.push(...entries);
      },
    });
    const ctx = fakeCtx({
      method: 'PUT',
      url: '/api/preferences',
      account,
      body: { entries: { woc_settings: { a: 1 }, woc_keybinds: null } },
    });
    await route('PUT').handler(ctx);
    expect(captured(ctx.res)).toEqual({ status: 200, body: { ok: true } });
    expect(applied).toEqual([
      { key: 'woc_settings', value: { a: 1 } },
      { key: 'woc_keybinds', value: null },
    ]);
  });

  it('PUT rejects an invalid body with account_prefs.invalid_input', async () => {
    const ctx = fakeCtx({ method: 'PUT', url: '/api/preferences', account, body: { entries: 5 } });
    await expect(route('PUT').handler(ctx)).rejects.toMatchObject({
      status: 400,
      code: 'account_prefs.invalid_input',
    });
  });

  it('PUT maps the key-cap error to a 400 invalid_input', async () => {
    setAccountPrefsStoreForTests({
      putAccountPreferences: async () => {
        throw new PrefsKeyLimitError();
      },
    });
    const ctx = fakeCtx({
      method: 'PUT',
      url: '/api/preferences',
      account,
      body: { entries: { woc_settings: 1 } },
    });
    await expect(route('PUT').handler(ctx)).rejects.toMatchObject({
      status: 400,
      code: 'account_prefs.invalid_input',
    });
  });

  it('401s without a bearer token (DB-free, through the auth middleware)', async () => {
    const ctx = fakeCtx({ method: 'GET', url: '/api/preferences' });
    await expect(runFullRoute(route('GET'), ctx)).rejects.toMatchObject({ status: 401 });
  });
});
