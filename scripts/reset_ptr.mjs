#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPtrResetPlan } from '../deploy/ptr_reset_core.mjs';

const APP_DIR = '/opt/eastbrook-ptr';
const MARKER_PATH = '/etc/world-of-claudecraft/ptr-environment';
const BRANCH = 'release/v0.24.0-ptr';

function usage() {
  console.log(`Usage:
  node scripts/reset_ptr.mjs [--commit <full-sha>] [--confirm <environment-id>]
  node scripts/reset_ptr.mjs --execute --commit <full-sha> --confirm <environment-id>

Without --execute, the command validates the live PTR identity and prints the
argv-only reset plan. It performs no reset.`);
}

function parseArgs(argv) {
  const parsed = { execute: false, commit: null, confirm: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--execute') parsed.execute = true;
    else if (arg === '--commit' || arg === '--confirm') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--commit') parsed.commit = value;
      else parsed.confirm = value;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (parsed.execute && (!parsed.commit || !parsed.confirm)) {
    throw new Error('--execute requires both --commit and --confirm');
  }
  return parsed;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? APP_DIR,
    encoding: options.inherit ? undefined : 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.inherit ? '' : `: ${(result.stderr ?? '').trim()}`;
    throw new Error(`${command} exited ${result.status}${detail}`);
  }
  return options.inherit ? '' : (result.stdout ?? '').trim();
}

function parseEnvFile(path) {
  const values = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error(`invalid environment line in ${path}`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function discoverContext(args) {
  const appDir = realpathSync(process.cwd());
  const fileEnv = parseEnvFile(resolve(appDir, '.env'));
  const env = { ...fileEnv, ...process.env };
  const markerValues = parseEnvFile(MARKER_PATH);
  const markerStat = statSync(MARKER_PATH);

  run('git', ['fetch', '--quiet', 'origin', BRANCH], { cwd: appDir });
  const headSha = run('git', ['rev-parse', 'HEAD'], { cwd: appDir });
  const fetchedSha = run('git', ['rev-parse', 'FETCH_HEAD'], { cwd: appDir });
  const branch = run('git', ['branch', '--show-current'], { cwd: appDir });
  const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: appDir });
  const clean =
    run('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: appDir,
    }) === '';

  const containerName = 'eastbrook-ptr-postgres';
  const container = JSON.parse(run('docker', ['inspect', containerName], { cwd: appDir }))[0];
  const containerLabels = container?.Config?.Labels ?? {};
  const postgresMount = (container?.Mounts ?? []).find(
    (mount) => mount.Destination === '/var/lib/postgresql/data',
  );
  if (!postgresMount?.Name) throw new Error('PTR Postgres data volume is not mounted');
  const volume = JSON.parse(
    run('docker', ['volume', 'inspect', postgresMount.Name], { cwd: appDir }),
  )[0];
  const project = containerLabels['com.docker.compose.project'] ?? '';
  const volumeNames = run(
    'docker',
    ['volume', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${project}`],
    { cwd: appDir },
  )
    .split('\n')
    .filter(Boolean);

  const psql = (sql) =>
    run(
      'docker',
      [
        'exec',
        containerName,
        'psql',
        '--username',
        'eastbrook',
        '--dbname',
        env.POSTGRES_DB ?? '',
        '--tuples-only',
        '--no-align',
        '--command',
        sql,
      ],
      { cwd: appDir },
    );
  const identity = psql(
    "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') FROM pg_database WHERE datname = current_database()",
  );
  const databases = psql('SELECT datname FROM pg_database ORDER BY datname')
    .split('\n')
    .filter(Boolean);

  return {
    execute: args.execute,
    appDir,
    env: {
      COMPOSE_PROJECT_NAME: env.COMPOSE_PROJECT_NAME,
      DEPLOY_ENV: env.DEPLOY_ENV,
      REALM_NAME: env.REALM_NAME,
      PBE_BOOST_ACCOUNTS: env.PBE_BOOST_ACCOUNTS,
      PTR_RESET_ALLOWED: env.PTR_RESET_ALLOWED,
      PTR_ENVIRONMENT_ID: env.PTR_ENVIRONMENT_ID,
      PUBLIC_ORIGIN: env.PUBLIC_ORIGIN,
      POSTGRES_DB: env.POSTGRES_DB,
    },
    marker: {
      path: MARKER_PATH,
      ownerUid: markerStat.uid,
      mode: markerStat.mode & 0o777,
      environmentId: markerValues.PTR_ENVIRONMENT_ID,
      publicOrigin: markerValues.PUBLIC_ORIGIN,
      appDir: markerValues.APP_DIR,
      composeProject: markerValues.COMPOSE_PROJECT_NAME,
      postgresDb: markerValues.POSTGRES_DB,
    },
    git: { origin, branch, headSha, fetchedSha, clean },
    compose: {
      project,
      workingDir: containerLabels['com.docker.compose.project.working_dir'] ?? '',
      postgresContainer: containerName,
      postgresVolume: {
        name: postgresMount.Name,
        mountTarget: postgresMount.Destination,
        labels: volume?.Labels ?? {},
      },
      otherVolumes: volumeNames.filter((name) => name !== postgresMount.Name),
    },
    database: { name: env.POSTGRES_DB, identity, databases },
    confirmEnvironmentId: args.confirm ?? markerValues.PTR_ENVIRONMENT_ID,
    approvedCommit: args.commit ?? headSha,
  };
}

function printPlan(plan) {
  console.log(
    plan.dryRun ? 'PTR reset dry run, no commands executed.' : 'PTR reset execution plan:',
  );
  for (const [index, step] of plan.steps.entries()) {
    console.log(`${index + 1}. ${JSON.stringify([step.command, ...step.args])}`);
  }
}

function executePlan(plan, context) {
  if (process.getuid?.() !== 0) throw new Error('--execute must run as root');
  for (const step of plan.steps) {
    run(step.command, step.args, { cwd: context.appDir, inherit: true });
  }
  appendFileSync(
    '/var/log/eastbrook-ptr-reset.log',
    `${new Date().toISOString()} commit=${context.approvedCommit} environment=${context.env.PTR_ENVIRONMENT_ID}\n`,
    { mode: 0o600 },
  );
}

try {
  const args = parseArgs(process.argv.slice(2));
  const context = discoverContext(args);
  const plan = buildPtrResetPlan(context);
  printPlan(plan);
  if (!plan.dryRun) executePlan(plan, context);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
