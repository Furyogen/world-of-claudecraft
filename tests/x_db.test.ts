import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  accountForX,
  consumeXOAuthState,
  consumeXPendingLogin,
  createXPendingLogin,
  linkXToAccount,
  peekXPendingLogin,
  setXPromptHidden,
  xPromptHiddenForAccount,
} from '../server/x_db';

type Result = { rows: unknown[]; rowCount: number };
type Handler = (sql: string, params: unknown[]) => Result;

function makePool(handler: Handler) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: s, params });
    return Promise.resolve(handler(s, params));
  };
  const pool = { query } as unknown as Pool;
  return { pool, calls, didRun: (frag: string) => calls.some((c) => c.sql.includes(frag)) };
}

const NONE: Result = { rows: [], rowCount: 0 };

describe('linkXToAccount', () => {
  it('refuses when the X id already belongs to a different account', async () => {
    const { pool, didRun } = makePool((s) => {
      if (s.includes('SELECT account_id FROM x_links WHERE x_user_id'))
        return { rows: [{ account_id: 99 }], rowCount: 1 };
      return NONE;
    });
    const ok = await linkXToAccount(pool, 1, {
      xUserId: '2244994945',
      username: 'TwitterDev',
      displayName: 'X Dev',
      profileImageUrl: null,
      verified: true,
      verifiedType: 'blue',
    });
    expect(ok).toBe(false);
    expect(didRun('INSERT INTO x_links')).toBe(false);
  });

  it('links when the X id is free', async () => {
    const { pool, didRun } = makePool((s) => {
      if (s.includes('SELECT account_id FROM x_links WHERE x_user_id')) return NONE;
      if (s.includes('INSERT INTO x_links')) return { rows: [], rowCount: 1 };
      return NONE;
    });
    const ok = await linkXToAccount(pool, 1, {
      xUserId: '2244994945',
      username: 'TwitterDev',
      displayName: 'X Dev',
      profileImageUrl: 'https://pbs.twimg.com/a.jpg',
      verified: true,
      verifiedType: 'blue',
    });
    expect(ok).toBe(true);
    expect(didRun('INSERT INTO x_links')).toBe(true);
  });

  it('treats a unique-violation race as already-owned', async () => {
    const { pool } = makePool((s) => {
      if (s.includes('SELECT account_id FROM x_links WHERE x_user_id')) return NONE;
      if (s.includes('INSERT INTO x_links')) {
        const err = Object.assign(new Error('dup'), { code: '23505' });
        throw err;
      }
      return NONE;
    });
    await expect(
      linkXToAccount(pool, 1, {
        xUserId: '2244994945',
        username: 'TwitterDev',
        displayName: null,
        profileImageUrl: null,
        verified: false,
        verifiedType: null,
      }),
    ).resolves.toBe(false);
  });
});

describe('accountForX', () => {
  it('returns the owning account or null', async () => {
    const { pool } = makePool((s) =>
      s.includes('SELECT account_id FROM x_links WHERE x_user_id')
        ? { rows: [{ account_id: 7 }], rowCount: 1 }
        : NONE,
    );
    expect(await accountForX(pool, '2244994945')).toBe(7);
    const empty = makePool(() => NONE);
    expect(await accountForX(empty.pool, '2244994945')).toBeNull();
  });
});

describe('consumeXOAuthState', () => {
  it('returns a live state row and null for missing/expired', async () => {
    const row = {
      state: 'st',
      code_verifier: 'v',
      mode: 'login',
      account_id: null,
      redirect_to: null,
    };
    const live = makePool((s) =>
      s.includes('DELETE FROM x_oauth_states') ? { rows: [row], rowCount: 1 } : NONE,
    );
    expect(await consumeXOAuthState(live.pool, 'st')).toEqual(row);
    const dead = makePool(() => NONE);
    expect(await consumeXOAuthState(dead.pool, 'st')).toBeNull();
  });
});

describe('x pending logins', () => {
  const row = {
    token: 'tok',
    x_user_id: '2244994945',
    x_username: 'TwitterDev',
    x_display_name: 'X Dev',
    x_profile_image_url: null,
    x_verified: true,
    x_verified_type: 'blue',
  };

  it('creates, peeks, and consumes pending logins', async () => {
    const insert = makePool((s) =>
      s.includes('INSERT INTO x_pending_logins') ? { rows: [], rowCount: 1 } : NONE,
    );
    await createXPendingLogin(insert.pool, {
      token: 'tok',
      xUserId: '2244994945',
      username: 'TwitterDev',
      displayName: 'X Dev',
      profileImageUrl: null,
      verified: true,
      verifiedType: 'blue',
      ttlMinutes: 15,
    });
    expect(insert.didRun('INSERT INTO x_pending_logins')).toBe(true);

    const live = makePool((s) =>
      s.includes('SELECT') && s.includes('FROM x_pending_logins')
        ? { rows: [row], rowCount: 1 }
        : NONE,
    );
    expect(await peekXPendingLogin(live.pool, 'tok')).toEqual(row);
    const consume = makePool((s) =>
      s.includes('DELETE FROM x_pending_logins') ? { rows: [row], rowCount: 1 } : NONE,
    );
    expect(await consumeXPendingLogin(consume.pool, 'tok')).toEqual(row);
  });
});

describe('x prompt flag', () => {
  it('reads and writes the account-level prompt hidden flag', async () => {
    const { pool, calls } = makePool((s) => {
      if (s.includes('SELECT x_link_prompt_hidden')) {
        return { rows: [{ x_link_prompt_hidden: true }], rowCount: 1 };
      }
      return NONE;
    });
    await expect(xPromptHiddenForAccount(pool, 1)).resolves.toBe(true);
    await setXPromptHidden(pool, 1, true);
    expect(calls.some((c) => c.sql.includes('UPDATE accounts SET x_link_prompt_hidden'))).toBe(
      true,
    );
  });
});
