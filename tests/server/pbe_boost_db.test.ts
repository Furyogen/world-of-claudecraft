// Transaction characterization for the real PBE registration database seam.
// The fake client records SQL boundaries only; no PostgreSQL process is contacted.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterState } from '../../src/sim/sim';
import type { PlayerClass } from '../../src/sim/types';

const connect = vi.hoisted(() => vi.fn());
const createAccountWithClient = vi.hoisted(() => vi.fn());

vi.mock('../../server/db', () => ({
  createAccountWithClient,
  pool: { connect },
}));
vi.mock('../../server/realm', () => ({ REALM: 'PTR' }));

import { createPbeAccountWithRoster } from '../../server/pbe_boost_db';

const PTR_ID = '8f1d7e2c4b6a9031d5e7f9a2c4b60813';
const CLASSES: readonly PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

function roster(classes: readonly PlayerClass[] = CLASSES) {
  return classes.map((cls, index) => ({
    cls,
    name: `Ptrname${String.fromCharCode(65 + index)}`,
    state: { level: 20 } as CharacterState,
  }));
}

function fakeClient(
  options: {
    failCharacterInsert?: number;
    uniqueCharacterInsert?: number;
    databaseName?: string;
    databaseIdentity?: string;
  } = {},
) {
  const calls: { text: string; values?: unknown[] }[] = [];
  let characterInsert = 0;
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    if (text.includes('shobj_description')) {
      return {
        rowCount: 1,
        rows: [
          {
            name: options.databaseName ?? 'eastbrook_ptr',
            identity: options.databaseIdentity ?? PTR_ID,
          },
        ],
      };
    }
    if (text.includes('INSERT INTO accounts')) {
      return {
        rowCount: 1,
        rows: [{ id: 42, username: values?.[0], password_hash: values?.[1] }],
      };
    }
    if (text.includes('INSERT INTO characters')) {
      characterInsert++;
      if (characterInsert === options.uniqueCharacterInsert) {
        throw Object.assign(new Error('name collision'), {
          code: '23505',
          constraint: 'characters_realm_lower_name_unique',
        });
      }
      if (characterInsert === options.failCharacterInsert) {
        throw new Error('forced insert failure');
      }
    }
    return { rowCount: 0, rows: [] };
  });
  const release = vi.fn();
  const client = { query, release };
  connect.mockResolvedValue(client);
  createAccountWithClient.mockImplementation(
    async (receivedClient, username: string, passwordHash: string, meta: unknown) => {
      expect(receivedClient).toBe(client);
      const result = await receivedClient.query(
        `INSERT INTO accounts (username, password_hash, created_ip, created_user_agent, password_set)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, password_hash`,
        [username, passwordHash, meta, null, true],
      );
      return result.rows[0];
    },
  );
  return { calls, query, release };
}

beforeEach(() => {
  connect.mockReset();
  createAccountWithClient.mockReset();
  process.env.PTR_ENVIRONMENT_ID = PTR_ID;
});

describe('createPbeAccountWithRoster', () => {
  it('inserts the account and exact nine-class roster under one BEGIN and COMMIT', async () => {
    const db = fakeClient();
    const account = await createPbeAccountWithRoster(
      'tester',
      'password-hash',
      { ip: '127.0.0.1' },
      roster(),
    );

    const accountInsert = db.calls.findIndex((call) => call.text.includes('INSERT INTO accounts'));
    const characterInserts = db.calls.filter((call) =>
      call.text.includes('INSERT INTO characters'),
    );
    expect(account).toEqual({ id: 42, username: 'tester', password_hash: 'password-hash' });
    expect(db.calls[0].text).toBe('BEGIN');
    expect(accountInsert).toBeGreaterThan(0);
    expect(characterInserts).toHaveLength(CLASSES.length);
    expect(characterInserts.map((call) => call.values?.[2])).toEqual(CLASSES);
    expect(characterInserts.every((call) => call.values?.[3] === 'PTR')).toBe(true);
    expect(characterInserts.every((call) => call.values?.[4] === 20)).toBe(true);
    expect(db.calls.at(-1)?.text).toBe('COMMIT');
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('rolls back the account and every character when any roster insert fails', async () => {
    const db = fakeClient({ failCharacterInsert: 5 });
    await expect(createPbeAccountWithRoster('tester', 'hash', {}, roster())).rejects.toThrow(
      'forced insert failure',
    );
    expect(db.calls.some((call) => call.text === 'COMMIT')).toBe(false);
    expect(db.calls.at(-1)?.text).toBe('ROLLBACK');
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('rolls back and preserves the character-name constraint for bounded outer retry', async () => {
    const db = fakeClient({ uniqueCharacterInsert: 1 });
    await expect(createPbeAccountWithRoster('tester', 'hash', {}, roster())).rejects.toMatchObject({
      code: '23505',
      constraint: 'characters_realm_lower_name_unique',
    });
    expect(db.calls.at(-1)?.text).toBe('ROLLBACK');
  });

  it('fails closed before account creation when the live database is not the PTR target', async () => {
    for (const options of [
      { databaseName: 'eastbrook' },
      { databaseIdentity: 'different-environment' },
    ]) {
      const db = fakeClient(options);
      await expect(createPbeAccountWithRoster('tester', 'hash', {}, roster())).rejects.toThrow(
        /PTR|database/i,
      );
      expect(createAccountWithClient).not.toHaveBeenCalled();
      expect(db.calls.at(-1)?.text).toBe('ROLLBACK');
      createAccountWithClient.mockClear();
    }
  });

  it('rejects anything other than the exact ordered nine-class roster before connecting', async () => {
    await expect(
      createPbeAccountWithRoster('tester', 'hash', {}, roster(CLASSES.slice(0, 8))),
    ).rejects.toThrow(/exact.*class|roster/i);
    await expect(
      createPbeAccountWithRoster('tester', 'hash', {}, roster([...CLASSES].reverse())),
    ).rejects.toThrow(/exact.*class|roster/i);
    expect(connect).not.toHaveBeenCalled();
  });
});
