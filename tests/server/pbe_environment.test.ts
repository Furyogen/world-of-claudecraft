// PBE is destructive convenience behavior. It must be impossible to enable on
// an ordinary or production server by setting one permissive flag.
process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:9/unused';

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/http/config';
import { pbeBoostEnabled } from '../../server/pbe_boost';
import { validatePbeEnvironment } from '../../server/pbe_environment';

const PTR_ID = '8f1d7e2c4b6a9031d5e7f9a2c4b60813';

const validPtrEnv = (): NodeJS.ProcessEnv => ({
  DATABASE_URL: 'postgres://ptr:secret@postgres:5432/eastbrook_ptr',
  PBE_BOOST_ACCOUNTS: '1',
  DEPLOY_ENV: 'ptr',
  REALM_NAME: 'PTR',
  PTR_ENVIRONMENT_ID: PTR_ID,
  PUBLIC_ORIGIN: 'https://ptr.worldofclaudecraft.example',
});

describe('validatePbeEnvironment', () => {
  it('keeps ordinary and production environments disabled', () => {
    expect(validatePbeEnvironment({})).toEqual({ enabled: false });
    expect(validatePbeEnvironment({ NODE_ENV: 'production' })).toEqual({ enabled: false });
    expect(validatePbeEnvironment({ PBE_BOOST_ACCOUNTS: '0' })).toEqual({ enabled: false });
  });

  it('enables PBE only with the complete dedicated PTR identity', () => {
    expect(validatePbeEnvironment(validPtrEnv())).toEqual({ enabled: true });
    expect(pbeBoostEnabled(validPtrEnv())).toBe(true);
  });

  it.each([
    ['missing DEPLOY_ENV', { DEPLOY_ENV: undefined }],
    ['production deployment', { DEPLOY_ENV: 'production' }],
    ['wrong realm', { REALM_NAME: 'Claudemoon' }],
    ['missing realm', { REALM_NAME: undefined }],
    ['missing environment id', { PTR_ENVIRONMENT_ID: undefined }],
    ['short environment id', { PTR_ENVIRONMENT_ID: 'ptr' }],
    ['missing database URL', { DATABASE_URL: undefined }],
    [
      'production database',
      { DATABASE_URL: 'postgres://eastbrook:secret@postgres:5432/eastbrook' },
    ],
    [
      'non-Compose database host',
      { DATABASE_URL: 'postgres://eastbrook:secret@prod-db:5432/eastbrook_ptr' },
    ],
    ['missing public origin', { PUBLIC_ORIGIN: undefined }],
    ['production public origin', { PUBLIC_ORIGIN: 'https://worldofclaudecraft.com' }],
    ['non-PTR public origin', { PUBLIC_ORIGIN: 'https://staging.worldofclaudecraft.example' }],
  ])('rejects PBE when %s', (_label, override) => {
    const env = { ...validPtrEnv(), ...override };
    expect(() => validatePbeEnvironment(env)).toThrow(/PBE|PTR/);
    expect(() => pbeBoostEnabled(env)).toThrow(/PBE|PTR/);
  });

  it('is consumed by the startup config edge, which fails closed before serving', () => {
    expect(() => loadConfig(validPtrEnv())).not.toThrow();
    expect(() =>
      loadConfig({
        ...validPtrEnv(),
        DEPLOY_ENV: 'production',
        REALM_NAME: 'Claudemoon',
      }),
    ).toThrow(/PBE|PTR/);
  });
});
