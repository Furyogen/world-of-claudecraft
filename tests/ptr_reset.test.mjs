import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPtrResetPlan, validatePtrResetContext } from '../deploy/ptr_reset_core.mjs';

const PTR_ID = '8f1d7e2c4b6a9031d5e7f9a2c4b60813';
const SHA = 'fb061ae160d311400a09601103200e806db94bf3fb061ae160d311400a096011';
const APP_DIR = '/opt/eastbrook-ptr';
const PROJECT = 'eastbrook-ptr';
const PG_VOLUME = 'eastbrook-ptr_eastbrook_ptr_pgdata';

function validContext() {
  return {
    appDir: APP_DIR,
    env: {
      COMPOSE_PROJECT_NAME: PROJECT,
      DEPLOY_ENV: 'ptr',
      REALM_NAME: 'PTR',
      PBE_BOOST_ACCOUNTS: '1',
      PTR_RESET_ALLOWED: '1',
      PTR_ENVIRONMENT_ID: PTR_ID,
      PUBLIC_ORIGIN: 'https://ptr.worldofclaudecraft.example',
      POSTGRES_DB: 'eastbrook_ptr',
    },
    marker: {
      path: '/etc/world-of-claudecraft/ptr-environment',
      ownerUid: 0,
      mode: 0o600,
      environmentId: PTR_ID,
      publicOrigin: 'https://ptr.worldofclaudecraft.example',
      appDir: APP_DIR,
      composeProject: PROJECT,
      postgresDb: 'eastbrook_ptr',
    },
    git: {
      origin: 'https://github.com/levy-street/world-of-claudecraft.git',
      branch: 'release/v0.24.0-ptr',
      headSha: SHA,
      fetchedSha: SHA,
      clean: true,
    },
    compose: {
      project: PROJECT,
      workingDir: APP_DIR,
      postgresContainer: 'eastbrook-ptr-postgres',
      postgresVolume: {
        name: PG_VOLUME,
        mountTarget: '/var/lib/postgresql/data',
        labels: {
          'com.docker.compose.project': PROJECT,
          'com.docker.compose.volume': 'eastbrook_ptr_pgdata',
        },
      },
      otherVolumes: ['eastbrook-ptr_wikidb', 'eastbrook-ptr_wiki_images'],
    },
    database: {
      name: 'eastbrook_ptr',
      identity: PTR_ID,
      databases: ['postgres', 'template0', 'template1', 'eastbrook_ptr'],
    },
    confirmEnvironmentId: PTR_ID,
    approvedCommit: SHA,
  };
}

function changed(mutator) {
  const context = structuredClone(validContext());
  mutator(context);
  return context;
}

describe('validatePtrResetContext', () => {
  it('accepts only a fully identified, isolated PTR database and Compose project', () => {
    expect(() => validatePtrResetContext(validContext())).not.toThrow();
  });

  it.each([
    ['production-like app path', (c) => (c.appDir = '/opt/eastbrook')],
    ['wrong deployment type', (c) => (c.env.DEPLOY_ENV = 'production')],
    ['wrong realm', (c) => (c.env.REALM_NAME = 'Claudemoon')],
    ['reset permission absent', (c) => (c.env.PTR_RESET_ALLOWED = '0')],
    ['PBE seeding absent', (c) => (c.env.PBE_BOOST_ACCOUNTS = '0')],
    ['production-like origin', (c) => (c.env.PUBLIC_ORIGIN = 'https://worldofclaudecraft.com')],
    ['marker not root owned', (c) => (c.marker.ownerUid = 1000)],
    ['marker is group readable', (c) => (c.marker.mode = 0o640)],
    ['confirmation mismatch', (c) => (c.confirmEnvironmentId = 'different-environment')],
    ['database identity mismatch', (c) => (c.database.identity = 'different-environment')],
    ['marker database mismatch', (c) => (c.marker.postgresDb = 'eastbrook')],
    ['production database name', (c) => (c.database.name = 'eastbrook')],
    ['unexpected database present', (c) => c.database.databases.push('eastbrook')],
    ['dirty source worktree', (c) => (c.git.clean = false)],
    ['unapproved head', (c) => (c.git.headSha = '0'.repeat(64))],
    ['wrong Compose project', (c) => (c.compose.project = 'eastbrook')],
    ['wrong Compose workdir', (c) => (c.compose.workingDir = '/opt/eastbrook')],
    [
      'wrong volume project label',
      (c) => (c.compose.postgresVolume.labels['com.docker.compose.project'] = 'eastbrook'),
    ],
    ['wrong volume mount', (c) => (c.compose.postgresVolume.mountTarget = '/var/lib/mysql')],
  ])('rejects %s before producing destructive commands', (_label, mutate) => {
    expect(() => validatePtrResetContext(changed(mutate))).toThrow();
  });
});

describe('buildPtrResetPlan', () => {
  it('defaults to a dry run with argv-only steps scoped to the verified Postgres volume', () => {
    const plan = buildPtrResetPlan(validContext());
    expect(plan.dryRun).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const step of plan.steps) {
      expect(typeof step.command).toBe('string');
      expect(Array.isArray(step.args)).toBe(true);
      expect(step.args.every((arg) => typeof arg === 'string')).toBe(true);
    }

    const tokens = plan.steps.flatMap((step) => [step.command, ...step.args]);
    expect(tokens).toContain('pg_dump');
    expect(tokens).toContain('pg_restore');
    expect(tokens).toContain(PG_VOLUME);
    expect(tokens).not.toContain('down');
    expect(tokens).not.toContain('discord-bot');
    expect(tokens.join(' ')).not.toMatch(/mediawiki|wikidb|wiki_images/);

    const installIndex = plan.steps.findIndex((step) => step.command === 'install');
    const copyIndex = plan.steps.findIndex(
      (step) => step.command === 'docker' && step.args[0] === 'cp',
    );
    const chmodIndex = plan.steps.findIndex((step) => step.command === 'chmod');
    const verifyIndex = plan.steps.findIndex((step) => step.args.includes('pg_restore'));
    expect(plan.steps[installIndex]?.args).toEqual([
      '--directory',
      '--mode',
      '0700',
      '--owner',
      'root',
      '--group',
      'root',
      '/var/backups/eastbrook-ptr',
    ]);
    expect(plan.steps[chmodIndex]?.args[0]).toBe('0600');
    expect(installIndex).toBeLessThan(copyIndex);
    expect(copyIndex).toBeLessThan(chmodIndex);
    expect(chmodIndex).toBeLessThan(verifyIndex);
  });

  it('marks a plan destructive only after explicit execute opt-in with matching guards', () => {
    const context = { ...validContext(), execute: true };
    expect(buildPtrResetPlan(context).dryRun).toBe(false);
    expect(() =>
      buildPtrResetPlan({ ...context, confirmEnvironmentId: 'wrong-environment' }),
    ).toThrow();
    expect(() => buildPtrResetPlan({ ...context, approvedCommit: '0'.repeat(64) })).toThrow();
  });
});

describe('PTR Compose isolation', () => {
  it('overrides every host port and persistent mount with PTR-only values', () => {
    const compose = readFileSync('docker-compose.ptr.yml', 'utf8');
    expect(compose.match(/!override/g)).toHaveLength(7);
    expect(compose).toContain("'127.0.0.1:5434:5432'");
    expect(compose).toContain("'127.0.0.1:8877:8787'");
    expect(compose).toContain("'127.0.0.1:8081:80'");
    expect(compose).not.toContain("'127.0.0.1:5433:5432'");
    expect(compose).not.toContain("'127.0.0.1:8787:8787'");
    expect(compose).not.toContain("'127.0.0.1:8080:80'");
    expect(compose).toContain('eastbrook_ptr_pgdata:/var/lib/postgresql/data');
    expect(compose).toContain('eastbrook_ptr_wikidb:/var/lib/mysql');
    expect(compose).toContain('eastbrook_ptr_wiki_images:/var/www/html/images');
    expect(compose).toContain('media-cache-ptr}:/app/dist/media');
  });
});
