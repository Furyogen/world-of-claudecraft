import { describe, expect, it } from 'vitest';
import {
  appNavigationOrigins,
  buildContentSecurityPolicy,
  deriveOrigin,
  extractInlineScriptHashes,
  navigationAllowed,
  originAllowed,
  withCspHeader,
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

describe('extractInlineScriptHashes', () => {
  it('hashes inline scripts and skips external and empty ones', () => {
    const html = [
      '<script src="/assets/main.js"></script>',
      "<script>console.log('boot');</script>",
      '<script></script>',
      '<script type="application/ld+json">{"a":1}</script>',
    ].join('\n');
    const hashes = extractInlineScriptHashes(html);
    // The external-src and empty scripts produce no hash; the two inline bodies do.
    // The boot script's hash is a known-answer sha256 base64.
    expect(hashes).toContain('sha256-4U2nQ7ITQ/rEbjI/yjhM48+cOPZaU2gKejSgBqiZtLY=');
    expect(hashes).toHaveLength(2);
    expect(hashes.every((h) => h.startsWith('sha256-'))).toBe(true);
  });
});

describe('buildContentSecurityPolicy', () => {
  const csp = buildContentSecurityPolicy({
    apiOrigin: 'https://worldofclaudecraft.com',
    scriptHashes: ['sha256-abc123'],
  });
  const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `));

  it('is strict by default and never uses unsafe-eval or inline script', () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
  });

  it('allows wasm and embeds the inline script hashes', () => {
    expect(directive('script-src')).toContain("'wasm-unsafe-eval'");
    expect(directive('script-src')).toContain("'sha256-abc123'");
  });

  it('lists the HTTPS API origin and wss: explicitly in connect-src', () => {
    expect(directive('connect-src')).toContain('https://worldofclaudecraft.com');
    expect(directive('connect-src')).toContain('wss:');
  });

  it('mirrors the web build: Google Fonts, worker blobs, and the Turnstile frame', () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain('frame-src https://challenges.cloudflare.com');
  });
});

describe('withCspHeader', () => {
  it('adds the CSP header and preserves status, statusText, and content-type', () => {
    const upstream = new Response('body', {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/javascript' },
    });
    const csp = "default-src 'self'";
    const wrapped = withCspHeader(upstream, csp);
    expect(wrapped.headers.get('Content-Security-Policy')).toBe(csp);
    expect(wrapped.headers.get('Content-Type')).toBe('application/javascript');
    expect(wrapped.status).toBe(200);
    expect(wrapped.statusText).toBe('OK');
  });
});
