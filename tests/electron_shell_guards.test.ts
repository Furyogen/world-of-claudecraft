import { describe, expect, it } from 'vitest';
import {
  appNavigationOrigins,
  deriveOrigin,
  navigationAllowed,
  originAllowed,
} from '../electron/shell_guards.cjs';

const APP = 'app://worldofclaudecraft';
const DEV = 'http://127.0.0.1:5173';

describe('deriveOrigin (app:// origin-"null" trap)', () => {
  it('derives protocol//host for the app scheme instead of collapsing to "null"', () => {
    expect(deriveOrigin('app://worldofclaudecraft/index.html')).toBe('app://worldofclaudecraft');
    expect(deriveOrigin('app://worldofclaudecraft')).toBe('app://worldofclaudecraft');
    // Every app:// host shares the SAME opaque URL.origin ("null"); protocol//host keeps them apart.
    expect(deriveOrigin('app://otherhost/x')).toBe('app://otherhost');
  });

  it('derives normal origins for http/https', () => {
    expect(deriveOrigin('https://evil.com/a?b=c')).toBe('https://evil.com');
    expect(deriveOrigin('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173');
  });

  it('returns null on a malformed or host-less URL', () => {
    expect(deriveOrigin('not a url')).toBeNull();
    expect(deriveOrigin('http://')).toBeNull();
    expect(deriveOrigin('')).toBeNull();
  });
});

describe('originAllowed', () => {
  const allowed = new Set([APP, DEV]);
  it('allows the app origin regardless of path', () => {
    expect(originAllowed('app://worldofclaudecraft/index.html', allowed)).toBe(true);
    expect(originAllowed('app://worldofclaudecraft/assets/main-abc.js', allowed)).toBe(true);
  });
  it('denies a different app host, foreign https, and malformed URLs', () => {
    expect(originAllowed('app://otherhost/', allowed)).toBe(false);
    expect(originAllowed('https://evil.com', allowed)).toBe(false);
    expect(originAllowed('http://', allowed)).toBe(false);
  });
});

describe('appNavigationOrigins', () => {
  it('always includes the app origin and nothing else without a dev server', () => {
    const origins = appNavigationOrigins(APP, undefined);
    expect(origins.has(APP)).toBe(true);
    expect(origins.size).toBe(1);
  });
  it('adds the dev-server origin when running against Vite', () => {
    const origins = appNavigationOrigins(APP, `${DEV}/`);
    expect(origins.has(APP)).toBe(true);
    expect(origins.has(DEV)).toBe(true);
  });
});

describe('navigationAllowed', () => {
  const main = new Set([APP, DEV]);
  it('allows main-frame navigation within the app and dev origins', () => {
    expect(navigationAllowed('app://worldofclaudecraft/play', true, main)).toBe(true);
    expect(navigationAllowed('http://127.0.0.1:5173/x', true, main)).toBe(true);
  });
  it('blocks main-frame navigation to a foreign origin', () => {
    expect(navigationAllowed('https://evil.com', true, main)).toBe(false);
    expect(navigationAllowed('app://otherhost/', true, main)).toBe(false);
  });
  it('blocks the embedded widget origin in the main frame but allows it in a subframe', () => {
    const turnstile = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    expect(navigationAllowed(turnstile, true, main)).toBe(false);
    expect(navigationAllowed(turnstile, false, main)).toBe(true);
  });
  it('denies a malformed navigation URL', () => {
    expect(navigationAllowed('::: not a url', true, main)).toBe(false);
  });
});
