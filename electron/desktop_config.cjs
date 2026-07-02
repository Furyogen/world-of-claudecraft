'use strict';

// Pure, Node-testable resolution of the desktop shell's runtime configuration:
// which distribution channel this build is (website download vs Steam depot),
// whether the in-app auto-updater may run, and where crash minidumps may be
// submitted. Lives beside shell_guards.cjs for the same reason: electron/main.cjs
// runs outside tsc and vitest, so every decision worth pinning is made here where
// tests/electron_desktop_config.test.ts can exercise it directly. No electron
// imports; callers pass everything in.
//
// The channel is stamped into the PACKAGED package.json by scripts/electron-build.mjs
// (electron-builder extraMetadata writes a `wocDesktop` object), because a shipped
// app has no build-time env: the Steam depot and the website installer are the same
// code and differ only by this stamp. WOC_DISTRIBUTION overrides it for local
// testing of either path in `electron .` / electron:dev.

const DISTRIBUTIONS = new Set(['website', 'steam']);

// Resolve the distribution channel. Precedence: WOC_DISTRIBUTION env (local
// testing) over the packaged wocDesktop.distribution stamp, defaulting to
// 'website'. Unknown values collapse to the default rather than throwing: a
// half-stamped build must still launch, and 'website' is the safe channel
// (its only extra behavior, the updater, is additionally gated on isPackaged).
function resolveDistribution({ packagedMetadata, env } = {}) {
  const fromEnv = env?.WOC_DISTRIBUTION;
  if (typeof fromEnv === 'string' && DISTRIBUTIONS.has(fromEnv)) return fromEnv;
  const stamped = packagedMetadata?.wocDesktop?.distribution;
  if (typeof stamped === 'string' && DISTRIBUTIONS.has(stamped)) return stamped;
  return 'website';
}

// The crash-minidump submit URL, if the maintainer provisioned one at build time
// (stamped like the distribution; WOC_CRASH_SUBMIT_URL overrides for testing).
// Only https: is accepted: minidumps can contain process memory, so they never
// travel over cleartext. Empty string means "keep dumps local only".
function resolveCrashSubmitUrl({ packagedMetadata, env } = {}) {
  const candidates = [env?.WOC_CRASH_SUBMIT_URL, packagedMetadata?.wocDesktop?.crashSubmitUrl];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') continue;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol === 'https:') return candidate;
  }
  return '';
}

// The one gate the auto-updater honors. Steam builds MUST NOT self-update
// (SteamPipe owns updates; Valve's guidance is explicit), and an unpackaged
// checkout has nothing to update, so the updater runs only for a packaged
// website build. There is deliberately no env escape hatch to force it ON in
// a Steam build; WOC_DISTRIBUTION=website on a dev checkout still stays off
// via isPackaged.
function updaterAllowed({ distribution, isPackaged }) {
  return isPackaged === true && distribution === 'website';
}

// One-call summary used by electron/main.cjs at startup.
function resolveDesktopConfig({ packagedMetadata, env, isPackaged } = {}) {
  const distribution = resolveDistribution({ packagedMetadata, env });
  return {
    distribution,
    updaterEnabled: updaterAllowed({ distribution, isPackaged }),
    crashSubmitUrl: resolveCrashSubmitUrl({ packagedMetadata, env }),
  };
}

module.exports = {
  resolveDistribution,
  resolveCrashSubmitUrl,
  updaterAllowed,
  resolveDesktopConfig,
};
