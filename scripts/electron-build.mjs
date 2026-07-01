import { spawnSync } from 'node:child_process';

const mode = process.argv[2] ?? 'build';
if (!['pack', 'build'].includes(mode)) {
  console.error(`unknown electron build mode: ${mode}`);
  process.exit(1);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronBuilderCommand =
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const defaultOrigin = 'https://worldofclaudecraft.com';
const env = {
  ...process.env,
  VITE_DESKTOP_APP: '1',
  VITE_DESKTOP_API_ORIGIN: process.env.VITE_DESKTOP_API_ORIGIN ?? defaultOrigin,
};

// A macOS build with no real Developer ID configured must still LAUNCH. On Apple Silicon
// the kernel SIGKILLs any invalidly-signed binary, and the electronFuses flip
// (package.json build.electronFuses) rewrites the Electron executable, which invalidates the
// prebuilt ad-hoc signature and the surrounding bundle seal. When no real signing certificate
// is present, tell electron-builder to ad-hoc sign the whole bundle itself via mac.identity
// "-": its @electron/osx-sign pass runs AFTER the fuse flip and re-seals every nested binary,
// producing a valid ad-hoc signature that launches with no manual `codesign` step.
//
// This is scoped to LOCAL/UNSIGNED test builds and never weakens the deferred production
// signing path (B1: Developer ID + notarization): a real identity is signalled by CSC_LINK
// (a .p12 path/base64) or CSC_NAME (an identity name), the two standard electron-builder
// inputs used in CI. When either is set, this override is skipped and the real certificate
// signs the app. A local Developer ID discovered only from the keychain (no CSC_* env) is
// also forced to ad-hoc here (matching electron-builder's own mac.identity "-" semantics);
// to produce a real-signed build locally, set CSC_NAME to that identity. macOS-only: mac
// signing is a no-op on other hosts.
const macSigningConfigured = Boolean(process.env.CSC_LINK) || Boolean(process.env.CSC_NAME);
const adhocMacSign =
  process.platform === 'darwin' && !macSigningConfigured ? ['--config.mac.identity=-'] : [];

function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(npmCommand, ['run', 'build']);
run(electronBuilderCommand, [...(mode === 'pack' ? ['--dir'] : []), ...adhocMacSign]);
