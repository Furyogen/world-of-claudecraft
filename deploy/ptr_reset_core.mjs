// Pure validation and command planning for the destructive PTR reset. This
// module performs no IO and never launches a process. The CLI must discover a
// live context, validate it here, and only then decide whether to print or run
// the argv-only plan.

const APP_DIR = '/opt/eastbrook-ptr';
const PROJECT = 'eastbrook-ptr';
const DATABASE = 'eastbrook_ptr';
const REALM = 'PTR';
const MARKER_PATH = '/etc/world-of-claudecraft/ptr-environment';
const ORIGIN = 'https://github.com/levy-street/world-of-claudecraft.git';
const BRANCH = 'release/v0.24.0-ptr';
const PG_CONTAINER = 'eastbrook-ptr-postgres';
const PG_VOLUME = 'eastbrook-ptr_eastbrook_ptr_pgdata';
const PG_VOLUME_LABEL = 'eastbrook_ptr_pgdata';
const PG_MOUNT = '/var/lib/postgresql/data';
const PTR_ID = /^[a-f0-9]{32,128}$/i;
const GIT_SHA = /^[a-f0-9]{40,64}$/i;
const ALLOWED_DATABASES = new Set(['postgres', 'template0', 'template1', DATABASE]);

function fail(message) {
  throw new Error(`PTR reset refused: ${message}`);
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} does not match the dedicated PTR identity`);
}

function validatePtrOrigin(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
      fail('PUBLIC_ORIGIN must be a bare HTTPS PTR origin');
    }
    const identifiesPtr = url.hostname
      .toLowerCase()
      .split('.')
      .some((label) => label === 'ptr' || label.startsWith('ptr-') || label.endsWith('-ptr'));
    if (!identifiesPtr) {
      fail('PUBLIC_ORIGIN must identify a PTR hostname');
    }
    if (url.hostname.toLowerCase() === 'worldofclaudecraft.com') {
      fail('PUBLIC_ORIGIN resolves to production');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PTR reset refused:')) throw error;
    fail('PUBLIC_ORIGIN is invalid');
  }
}

export function validatePtrResetContext(context) {
  if (!context || typeof context !== 'object') fail('context is missing');
  requireEqual(context.appDir, APP_DIR, 'application path');

  const env = context.env ?? {};
  requireEqual(env.COMPOSE_PROJECT_NAME, PROJECT, 'COMPOSE_PROJECT_NAME');
  requireEqual(env.DEPLOY_ENV, 'ptr', 'DEPLOY_ENV');
  requireEqual(env.REALM_NAME, REALM, 'REALM_NAME');
  requireEqual(env.PBE_BOOST_ACCOUNTS, '1', 'PBE_BOOST_ACCOUNTS');
  requireEqual(env.PTR_RESET_ALLOWED, '1', 'PTR_RESET_ALLOWED');
  requireEqual(env.POSTGRES_DB, DATABASE, 'POSTGRES_DB');
  if (!PTR_ID.test(env.PTR_ENVIRONMENT_ID ?? '')) {
    fail('PTR_ENVIRONMENT_ID is missing or too weak');
  }
  validatePtrOrigin(env.PUBLIC_ORIGIN ?? '');

  const marker = context.marker ?? {};
  requireEqual(marker.path, MARKER_PATH, 'marker path');
  requireEqual(marker.ownerUid, 0, 'marker owner');
  requireEqual(marker.mode, 0o600, 'marker mode');
  requireEqual(marker.environmentId, env.PTR_ENVIRONMENT_ID, 'marker environment id');
  requireEqual(marker.publicOrigin, env.PUBLIC_ORIGIN, 'marker public origin');
  requireEqual(marker.appDir, APP_DIR, 'marker application path');
  requireEqual(marker.composeProject, PROJECT, 'marker Compose project');
  requireEqual(marker.postgresDb, DATABASE, 'marker database');
  requireEqual(context.confirmEnvironmentId, env.PTR_ENVIRONMENT_ID, 'operator confirmation');

  const git = context.git ?? {};
  requireEqual(git.origin, ORIGIN, 'git origin');
  requireEqual(git.branch, BRANCH, 'git branch');
  if (git.clean !== true) fail('source worktree is not clean');
  if (!GIT_SHA.test(git.headSha ?? '')) fail('git HEAD is not a full commit id');
  requireEqual(git.fetchedSha, git.headSha, 'fetched commit');
  requireEqual(context.approvedCommit, git.headSha, 'approved commit');

  const compose = context.compose ?? {};
  requireEqual(compose.project, PROJECT, 'Compose project');
  requireEqual(compose.workingDir, APP_DIR, 'Compose working directory');
  requireEqual(compose.postgresContainer, PG_CONTAINER, 'Postgres container');
  const volume = compose.postgresVolume ?? {};
  requireEqual(volume.name, PG_VOLUME, 'Postgres volume');
  requireEqual(volume.mountTarget, PG_MOUNT, 'Postgres mount target');
  requireEqual(volume.labels?.['com.docker.compose.project'], PROJECT, 'volume project label');
  requireEqual(
    volume.labels?.['com.docker.compose.volume'],
    PG_VOLUME_LABEL,
    'volume identity label',
  );
  if ((compose.otherVolumes ?? []).includes(PG_VOLUME)) {
    fail('Postgres volume is also listed as a non-Postgres volume');
  }

  const database = context.database ?? {};
  requireEqual(database.name, DATABASE, 'connected database');
  requireEqual(database.identity, env.PTR_ENVIRONMENT_ID, 'database identity');
  const databases = database.databases ?? [];
  if (!Array.isArray(databases) || databases.length === 0) fail('database inventory is missing');
  for (const name of databases) {
    if (!ALLOWED_DATABASES.has(name)) fail('database cluster contains an unexpected database');
  }
  if (!databases.includes(DATABASE)) fail('PTR database is missing');

  return context;
}

function composeArgs(...args) {
  return [
    'compose',
    '--file',
    'docker-compose.yml',
    '--file',
    'docker-compose.ptr.yml',
    '--project-name',
    PROJECT,
    ...args,
  ];
}

export function buildPtrResetPlan(context) {
  validatePtrResetContext(context);
  const dryRun = context.execute !== true;
  const backupDir = '/var/backups/eastbrook-ptr';
  const backupName = `eastbrook-ptr-${context.approvedCommit.slice(0, 12)}.dump`;
  const containerBackup = `/tmp/${backupName}`;
  const hostBackup = `${backupDir}/${backupName}`;
  const databaseComment = `COMMENT ON DATABASE ${DATABASE} IS '${context.env.PTR_ENVIRONMENT_ID}'`;

  return Object.freeze({
    dryRun,
    steps: Object.freeze([
      {
        command: 'install',
        args: ['--directory', '--mode', '0700', '--owner', 'root', '--group', 'root', backupDir],
      },
      { command: 'docker', args: composeArgs('stop', 'game') },
      {
        command: 'docker',
        args: [
          'exec',
          PG_CONTAINER,
          'pg_dump',
          '--username',
          'eastbrook',
          '--dbname',
          DATABASE,
          '--format=custom',
          `--file=${containerBackup}`,
        ],
      },
      { command: 'docker', args: ['cp', `${PG_CONTAINER}:${containerBackup}`, hostBackup] },
      { command: 'chmod', args: ['0600', hostBackup] },
      {
        command: 'docker',
        args: [
          'run',
          '--rm',
          '--volume',
          `${backupDir}:/backup:ro`,
          'postgres:16-alpine',
          'pg_restore',
          '--list',
          `/backup/${backupName}`,
        ],
      },
      { command: 'docker', args: ['rm', '--force', PG_CONTAINER] },
      { command: 'docker', args: ['volume', 'rm', PG_VOLUME] },
      { command: 'docker', args: composeArgs('up', '--detach', '--wait', 'postgres') },
      {
        command: 'docker',
        args: composeArgs(
          'exec',
          '--no-TTY',
          'postgres',
          'psql',
          '--username',
          'eastbrook',
          '--dbname',
          DATABASE,
          '--set',
          'ON_ERROR_STOP=1',
          '--command',
          databaseComment,
        ),
      },
      { command: 'docker', args: composeArgs('up', '--detach', '--build', 'game') },
    ]),
  });
}
