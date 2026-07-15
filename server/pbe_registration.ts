// Shared account-creation coordinator used by both retained registration HTTP
// dispatchers. Production delegates to the established account insert. On the
// fully identified PTR only, it builds the exact roster first and commits the
// account plus all nine characters in one database transaction.

import { type AccountRow, createAccount, type RequestMetadata } from './db';
import { logger } from './http/logger';
import { buildBoostRoster } from './pbe_boost';
import { createPbeAccountWithRoster } from './pbe_boost_db';
import { validatePbeEnvironment } from './pbe_environment';

const ROSTER_WRITE_ATTEMPTS = 8;
const CHARACTER_NAME_CONSTRAINTS = new Set([
  'characters_name_key',
  'characters_realm_name',
  'characters_realm_lower_name_unique',
]);

type NormalAccountCreator = typeof createAccount;

function isCharacterNameConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const pg = error as { code?: unknown; constraint?: unknown };
  return (
    pg.code === '23505' &&
    typeof pg.constraint === 'string' &&
    CHARACTER_NAME_CONSTRAINTS.has(pg.constraint)
  );
}

export async function createRegistrationAccount(
  username: string,
  passwordHash: string,
  meta: RequestMetadata,
  createNormalAccount: NormalAccountCreator = createAccount,
): Promise<AccountRow> {
  if (!validatePbeEnvironment(process.env).enabled) {
    return createNormalAccount(username, passwordHash, meta);
  }

  for (let attempt = 1; attempt <= ROSTER_WRITE_ATTEMPTS; attempt++) {
    const roster = await buildBoostRoster();
    try {
      const account = await createPbeAccountWithRoster(username, passwordHash, meta, roster);
      logger.info({ accountId: account.id, boosted: roster.length }, 'pbe account boost complete');
      return account;
    } catch (error) {
      if (!isCharacterNameConflict(error)) throw error;
      if (attempt === ROSTER_WRITE_ATTEMPTS) {
        throw new Error('PBE roster name generation exhausted', { cause: error });
      }
      logger.warn({ attempt }, 'pbe roster name collision; rebuilding roster');
    }
  }
  throw new Error('PBE roster creation exhausted');
}
