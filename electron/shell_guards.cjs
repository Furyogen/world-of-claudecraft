'use strict';

// Pure, Node-testable guards for the Electron shell. electron/main.cjs is a CommonJS
// entry that runs outside tsc and vitest, so the origin-comparison and navigation
// logic (and, added alongside their consumers, the CSP builder and trusted-sender
// check) live here where a Vitest can import and exercise them directly
// (tests/electron_shell_guards.test.ts). No electron imports.

// Derive a comparable origin from a URL string as `${protocol}//${host}`. This is
// deliberately NOT `new URL(x).origin`: app:// is a non-standard scheme, so Node's
// URL reports its origin as the literal string "null" and every app:// host
// collapses to that same "null", which would defeat an origin allow-list. Returns
// null on a parse failure (or a URL with no host) so callers deny.
function deriveOrigin(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return null;
  }
  if (!parsed.protocol || !parsed.host) return null;
  return `${parsed.protocol}//${parsed.host}`;
}

function toOriginSet(origins) {
  return origins instanceof Set ? origins : new Set(origins);
}

// True when urlString's derived origin is a member of allowedOrigins (an iterable of
// `${protocol}//${host}` strings). Parse failures and host-less URLs deny.
function originAllowed(urlString, allowedOrigins) {
  const origin = deriveOrigin(urlString);
  if (!origin) return false;
  return toOriginSet(allowedOrigins).has(origin);
}

// The origins the MAIN frame may navigate to: the app origin always, plus the
// dev-server origin when running against Vite (devServerUrl set).
function appNavigationOrigins(appOrigin, devServerUrl) {
  const origins = new Set();
  const app = deriveOrigin(appOrigin);
  if (app) origins.add(app);
  if (devServerUrl) {
    const dev = deriveOrigin(devServerUrl);
    if (dev) origins.add(dev);
  }
  return origins;
}

// Third-party origins the app legitimately embeds in a SUBFRAME only (never the main
// frame): the Cloudflare Turnstile bot-gate renders in its own cross-origin iframe.
const EMBEDDED_SUBFRAME_ORIGINS = new Set(['https://challenges.cloudflare.com']);

// Decide whether a navigation to `url` is permitted. Main-frame navigations may only
// target the app or dev origin (the top-level hijack surface that setWindowOpenHandler
// does not cover); subframes may additionally load the embedded widget origins. A
// parse failure denies.
function navigationAllowed(
  url,
  isMainFrame,
  mainFrameOrigins,
  subframeOrigins = EMBEDDED_SUBFRAME_ORIGINS,
) {
  const origin = deriveOrigin(url);
  if (!origin) return false;
  if (toOriginSet(mainFrameOrigins).has(origin)) return true;
  if (!isMainFrame && toOriginSet(subframeOrigins).has(origin)) return true;
  return false;
}

module.exports = {
  deriveOrigin,
  originAllowed,
  appNavigationOrigins,
  navigationAllowed,
  EMBEDDED_SUBFRAME_ORIGINS,
};
