// Both retained HTTP dispatchers must delegate the PTR-only post-registration
// behavior through one helper so rollback mode cannot silently skip PBE seeding.
process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:9/unused';

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const buildBoostRoster = vi.hoisted(() => vi.fn());
const createPbeAccountWithRoster = vi.hoisted(() => vi.fn());

vi.mock('../../server/pbe_boost', () => ({ buildBoostRoster }));
vi.mock('../../server/pbe_boost_db', () => ({ createPbeAccountWithRoster }));

import { createRegistrationAccount } from '../../server/pbe_registration';

const PTR_ENV = {
  PBE_BOOST_ACCOUNTS: '1',
  DEPLOY_ENV: 'ptr',
  REALM_NAME: 'PTR',
  PTR_ENVIRONMENT_ID: '8f1d7e2c4b6a9031d5e7f9a2c4b60813',
  DATABASE_URL: 'postgres://eastbrook:secret@postgres:5432/eastbrook_ptr',
  PUBLIC_ORIGIN: 'https://ptr.worldofclaudecraft.example',
};

async function withEnv(env: Record<string, string | undefined>, run: () => Promise<void>) {
  const before = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const ACCOUNT = { id: 18, username: 'tester', password_hash: 'hash' };
const ROSTER = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
].map((cls, index) => ({
  name: `Ptrname${String.fromCharCode(65 + index)}`,
  cls,
  state: { level: 20 },
}));

describe('createRegistrationAccount', () => {
  it('delegates unchanged to normal account creation when PBE seeding is disabled', async () => {
    buildBoostRoster.mockReset();
    createPbeAccountWithRoster.mockReset();
    const createNormalAccount = vi.fn().mockResolvedValue(ACCOUNT);
    await withEnv({ PBE_BOOST_ACCOUNTS: undefined }, async () => {
      await expect(
        createRegistrationAccount('tester', 'hash', { ip: '127.0.0.1' }, createNormalAccount),
      ).resolves.toEqual(ACCOUNT);
    });
    expect(createNormalAccount).toHaveBeenCalledExactlyOnceWith('tester', 'hash', {
      ip: '127.0.0.1',
    });
    expect(buildBoostRoster).not.toHaveBeenCalled();
    expect(createPbeAccountWithRoster).not.toHaveBeenCalled();
  });

  it('creates the account and exact roster in one PTR transaction', async () => {
    buildBoostRoster.mockReset().mockResolvedValueOnce(ROSTER);
    createPbeAccountWithRoster.mockReset().mockResolvedValueOnce(ACCOUNT);
    const createNormalAccount = vi.fn();
    await withEnv(PTR_ENV, async () => {
      await expect(
        createRegistrationAccount('tester', 'hash', { userAgent: 'browser' }, createNormalAccount),
      ).resolves.toEqual(ACCOUNT);
    });
    expect(createNormalAccount).not.toHaveBeenCalled();
    expect(createPbeAccountWithRoster).toHaveBeenCalledExactlyOnceWith(
      'tester',
      'hash',
      { userAgent: 'browser' },
      ROSTER,
    );
  });

  it('regenerates the whole roster after a character-name conflict', async () => {
    const conflict = Object.assign(new Error('name collision'), {
      code: '23505',
      constraint: 'characters_realm_lower_name_unique',
    });
    buildBoostRoster.mockReset().mockResolvedValue(ROSTER);
    createPbeAccountWithRoster
      .mockReset()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValue(ACCOUNT);
    await withEnv(PTR_ENV, async () => {
      await expect(createRegistrationAccount('tester', 'hash', {}, vi.fn())).resolves.toEqual(
        ACCOUNT,
      );
    });
    expect(buildBoostRoster).toHaveBeenCalledTimes(2);
    expect(createPbeAccountWithRoster).toHaveBeenCalledTimes(2);
  });

  it('does not retry an account username conflict', async () => {
    const conflict = Object.assign(new Error('username collision'), {
      code: '23505',
      constraint: 'accounts_username_key',
    });
    buildBoostRoster.mockReset().mockResolvedValue(ROSTER);
    createPbeAccountWithRoster.mockReset().mockRejectedValue(conflict);
    await withEnv(PTR_ENV, async () => {
      await expect(createRegistrationAccount('tester', 'hash', {}, vi.fn())).rejects.toBe(conflict);
    });
    expect(buildBoostRoster).toHaveBeenCalledOnce();
    expect(createPbeAccountWithRoster).toHaveBeenCalledOnce();
  });

  it('bounds repeated character-name retries and leaves no committed account', async () => {
    const conflict = Object.assign(new Error('name collision'), {
      code: '23505',
      constraint: 'characters_realm_lower_name_unique',
    });
    buildBoostRoster.mockReset().mockResolvedValue(ROSTER);
    createPbeAccountWithRoster.mockReset().mockRejectedValue(conflict);
    await withEnv(PTR_ENV, async () => {
      await expect(createRegistrationAccount('tester', 'hash', {}, vi.fn())).rejects.toThrow(
        /name generation exhausted/i,
      );
    });
    expect(buildBoostRoster).toHaveBeenCalledTimes(8);
    expect(createPbeAccountWithRoster).toHaveBeenCalledTimes(8);
  });
});

describe('registration dispatcher parity', () => {
  it('routes both registration twins through createRegistrationAccount', () => {
    const legacy = readFileSync('server/main.ts', 'utf8');
    const migrated = readFileSync('server/auth_routes.ts', 'utf8');
    for (const source of [legacy, migrated]) {
      expect(source).toMatch(/createRegistrationAccount\(/);
      expect(source).not.toMatch(/\bcompletePbeRegistration\b|\bboostAccountCharacters\b/);
    }
  });
});
