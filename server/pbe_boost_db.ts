// PostgreSQL transaction for PTR registration. The account and exact
// nine-character roster commit together or not at all. Before the first insert,
// the live database name and database comment must match the host-specific PTR
// identity, so copied environment strings cannot point this path at production.

import { ALL_CLASSES } from '../src/sim/types';
import { type AccountRow, createAccountWithClient, pool, type RequestMetadata } from './db';
import type { BoostRosterRow } from './pbe_boost';
import { REALM } from './realm';

const PTR_DATABASE = 'eastbrook_ptr';
const PTR_REALM = 'PTR';
const PTR_ID_PATTERN = /^[a-f0-9]{32,128}$/i;

function requireExactRoster(rows: readonly BoostRosterRow[]): void {
  if (
    rows.length !== ALL_CLASSES.length ||
    rows.some((row, index) => row.cls !== ALL_CLASSES[index])
  ) {
    throw new Error('PBE registration requires the exact ordered nine-class roster');
  }
}

export async function createPbeAccountWithRoster(
  username: string,
  passwordHash: string,
  meta: RequestMetadata,
  rows: readonly BoostRosterRow[],
): Promise<AccountRow> {
  requireExactRoster(rows);
  const expectedIdentity = process.env.PTR_ENVIRONMENT_ID ?? '';
  if (REALM !== PTR_REALM || !PTR_ID_PATTERN.test(expectedIdentity)) {
    throw new Error('PBE registration requires the live PTR realm identity');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const identity = await client.query<{ name: string; identity: string | null }>(
      `SELECT current_database() AS name,
              shobj_description(oid, 'pg_database') AS identity
         FROM pg_database
        WHERE datname = current_database()`,
    );
    const live = identity.rows[0];
    if (live?.name !== PTR_DATABASE || live.identity !== expectedIdentity) {
      throw new Error('PBE registration refused: live database is not the dedicated PTR');
    }

    const account = await createAccountWithClient(client, username, passwordHash, meta);
    for (const row of rows) {
      await client.query(
        `INSERT INTO characters (account_id, name, class, realm, level, state)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [account.id, row.name, row.cls, REALM, row.state.level, JSON.stringify(row.state)],
      );
    }
    await client.query('COMMIT');
    return account;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
