// Pure fail-closed gate for temporary PTR account seeding. The convenience
// flag alone is never sufficient: a dedicated deployment identity and realm
// must agree before the feature can turn on.

export interface PbeEnvironmentState {
  readonly enabled: boolean;
}

const DISABLED: PbeEnvironmentState = Object.freeze({ enabled: false });
const ENABLED: PbeEnvironmentState = Object.freeze({ enabled: true });
const PTR_ID_PATTERN = /^[a-f0-9]{32,128}$/i;
const PTR_DATABASE = 'eastbrook_ptr';
const PTR_DATABASE_HOST = 'postgres';

function requirePtrDatabase(raw: string | undefined): void {
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    throw new Error('PBE_BOOST_ACCOUNTS requires the dedicated PTR DATABASE_URL');
  }
  if (
    (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
    url.hostname !== PTR_DATABASE_HOST ||
    (url.port !== '' && url.port !== '5432') ||
    url.pathname !== `/${PTR_DATABASE}`
  ) {
    throw new Error('PBE_BOOST_ACCOUNTS requires the dedicated PTR DATABASE_URL');
  }
}

function requirePtrOrigin(raw: string | undefined): void {
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    throw new Error('PBE_BOOST_ACCOUNTS requires a dedicated PTR PUBLIC_ORIGIN');
  }
  const labels = url.hostname.toLowerCase().split('.');
  const identifiesPtr = labels.some(
    (label) => label === 'ptr' || label.startsWith('ptr-') || label.endsWith('-ptr'),
  );
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    !identifiesPtr ||
    url.hostname.toLowerCase() === 'worldofclaudecraft.com'
  ) {
    throw new Error('PBE_BOOST_ACCOUNTS requires a dedicated PTR PUBLIC_ORIGIN');
  }
}

export function validatePbeEnvironment(env: NodeJS.ProcessEnv): PbeEnvironmentState {
  if (env.PBE_BOOST_ACCOUNTS !== '1') return DISABLED;
  if (env.DEPLOY_ENV !== 'ptr') {
    throw new Error('PBE_BOOST_ACCOUNTS requires DEPLOY_ENV=ptr');
  }
  if (env.REALM_NAME !== 'PTR') {
    throw new Error('PBE_BOOST_ACCOUNTS requires REALM_NAME=PTR');
  }
  if (!PTR_ID_PATTERN.test(env.PTR_ENVIRONMENT_ID ?? '')) {
    throw new Error('PBE_BOOST_ACCOUNTS requires a high-entropy PTR_ENVIRONMENT_ID');
  }
  requirePtrDatabase(env.DATABASE_URL);
  requirePtrOrigin(env.PUBLIC_ORIGIN);
  return ENABLED;
}
