# Desktop release runbook (Electron: website download + Steam)

How to build, sign, publish, and verify the World of ClaudeCraft desktop app.
One codebase produces two distribution channels:

| Channel | Command | Output | Updates |
|---|---|---|---|
| website | `npm run electron:build` | `release/` installers + update feed files | in-app via electron-updater |
| steam | `npm run electron:build:steam` | `release-steam/` loose per-OS layouts | SteamPipe depots only (in-app updater OFF) |

The channel is stamped into the packaged `package.json` as `wocDesktop.distribution`
(electron-builder `extraMetadata`, wired in `scripts/electron-build.mjs` +
`scripts/electron-builder-config.mjs`); the shell resolves it at runtime in
`electron/desktop_config.cjs`. The updater runs only for a PACKAGED WEBSITE build;
there is deliberately no way to force it on in a Steam build. To try either channel
unpacked, set `WOC_DISTRIBUTION=website|steam` on `npm run electron:dev`.

`npm run electron:pack` / `electron:pack:steam` are the fast local variants
(`--dir`, host arch only, no installers). Release builds use the full arch matrix in
`package.json` `build`: macOS universal (dmg + zip), Windows x64 + arm64 (nsis + zip),
Linux x64 + arm64 (AppImage + deb).

Build each OS on its own runner (mac artifacts on macOS, Windows artifacts on Windows,
Linux artifacts on Linux). Cross-building is not part of this runbook.

## What the maintainer must provision (one-time)

| Item | Used for | Where it goes |
|---|---|---|
| Apple Developer Program membership (USD 99/yr) | macOS signing + notarization | developer.apple.com |
| Developer ID Application certificate (.p12 export) | macOS signing | CI secret `CSC_LINK` (base64) + `CSC_KEY_PASSWORD` |
| App Store Connect API key (Team Key, App Manager role) | notarization (notarytool) | CI secrets `APPLE_API_KEY` (path to .p8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Azure subscription + Artifact Signing account (Basic, USD 9.99/mo, 5000 sigs) | Windows signing | account + certificate profile in the Azure portal (needs identity validation; individuals: US/Canada only, orgs also EU/UK) |
| Azure service principal with "Trusted Signing Certificate Profile Signer" role | CI auth for signing | CI secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` |
| Update host: a static HTTPS host / bucket serving `https://updates.worldofclaudecraft.com/desktop/` | website auto-update feed + installer downloads | e.g. Cloudflare R2 bucket behind that hostname (any static host works; the app only GETs) |
| Steam partner account + app ID + three depot IDs | Steam distribution | partner.steamgames.com |
| Optional: a crash-minidump endpoint (e.g. a Sentry project's minidump URL) | crash uploads | build env `WOC_CRASH_SUBMIT_URL` (https only) |

Never commit any of these values; they are env vars in CI or the local shell.

## macOS: signing + notarization

Config already in the repo: `hardenedRuntime: true`, entitlements
(`build/entitlements.mac.plist`: `allow-jit`, `allow-unsigned-executable-memory`,
`disable-library-validation`), universal dmg + zip targets, and the
`enableEmbeddedAsarIntegrityValidation` + `onlyLoadAppFromAsar` fuses.

- Signing activates automatically when `CSC_LINK` + `CSC_KEY_PASSWORD` (or `CSC_NAME`
  for a keychain identity) are set. Without them, local builds fall back to AD-HOC
  signing (`--config.mac.identity=-`, wired in `scripts/electron-build.mjs`) so a dev
  build still launches on Apple Silicon. Ad-hoc builds are for local testing only:
  on current macOS (15+) an unnotarized quarantined download shows "damaged / can't
  be opened" and only launches via System Settings > Privacy & Security > Open Anyway
  or `xattr -r -d com.apple.quarantine <app>`.
- Notarization activates automatically when the `APPLE_API_KEY` +` APPLE_API_KEY_ID`
  + `APPLE_API_ISSUER` env vars are present (electron-builder submits via notarytool
  and staples the ticket). `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` +
  `APPLE_TEAM_ID` also work.
- HARD DEPENDENCY: macOS auto-update does not apply unless the app is signed with a
  real Developer ID AND notarized. The updater consumes the ZIP target (which is why
  zip stays in the mac target list). Ship no public mac build without both.
- Verify after a signed build: `codesign --verify --deep --strict "release/mac-universal/World of ClaudeCraft.app"`
  and `spctl -a -t exec -vv <app>` says "accepted, source=Notarized Developer ID".

## Windows: Azure Artifact Signing

Signing activates when all four `WIN_SIGN_*` env vars are present at build time on a
Windows runner (injected as `win.azureSignOptions` by `scripts/electron-build.mjs`):

- `WIN_SIGN_PUBLISHER_NAME`: must EXACTLY match the certificate subject CN (the
  validated legal name).
- `WIN_SIGN_ENDPOINT`: the regional endpoint, e.g. `https://eus.codesigning.azure.net`.
- `WIN_SIGN_ACCOUNT_NAME`: the Artifact Signing account name.
- `WIN_SIGN_PROFILE_NAME`: the certificate profile name.

Auth comes from `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET`
(electron-builder drives the TrustedSigning PowerShell module, which reads the
standard Azure EnvironmentCredential). Timestamping defaults to Microsoft's server.

SmartScreen reality: a newly signed app STILL shows "Windows protected your PC" until
the file hash + publisher accumulate reputation (weeks, hundreds of clean installs).
EV certificates no longer bypass this (Microsoft, 2026); do not buy one for that.
Reputation persists across releases signed with the same identity, so it fades.

## Linux

No artifact signing (electron-builder 26 has none built in; per-file signatures are
not customary). Publish SHA256 checksums next to the artifacts:
`shasum -a 256 release/*.AppImage release/*.deb > SHA256SUMS`. AppImage is the
auto-updatable target; deb users update manually or via a future repo.

## Publishing a website update

1. Bump `version` in `package.json` (the feed is version-ordered; see rollback).
2. Build on each OS runner with signing env present: `npm run electron:build`.
3. Upload from `release/` to the update host directory (keep filenames exactly):
   - macOS: `world-of-claudecraft-<v>-mac-universal.dmg` (download page),
     `...-mac-universal.zip` + `.zip.blockmap` (updater), `latest-mac.yml`.
   - Windows: `...-win-x64.exe` / `...-win-arm64.exe` (NSIS) + `.exe.blockmap`,
     `latest.yml` (covers both arches), plus the zips if you publish them.
   - Linux: `...-linux-x64.AppImage` / `...-linux-arm64.AppImage` (blockmap data is
     embedded), `latest-linux.yml`, plus the debs for the download page.
4. The running app checks 15 seconds after launch and every 4 hours
   (`electron/updater.cjs`), downloads in the background, toasts the player
   ("restart now" or install-on-quit), and applies deltas via blockmap when the host
   supports HTTP range requests (best-effort; full download is the fallback).

Staged rollout: after uploading, hand-edit `stagingPercentage: N` (0-100) into the
`latest*.yml` you want to stage; each install hashes a persistent per-machine UUID
against N, so the cohort is stable. Raise N to widen, delete the line to finish.

Rollback: you cannot re-publish the same or a lower version; installs that already
took the bad build compare versions and will NOT downgrade. Pulling a bad release =
publish a HIGHER version containing the fix (and/or drop `stagingPercentage` to 0 to
stop further spread while you build it).

Linux AppImage caveat: the updater requires the `APPIMAGE` env (set automatically
when running a real AppImage); running the raw unpacked binary logs an updater error
and skips, by design.

## Steam

Build: `npm run electron:build:steam` on each OS runner (signing env still applies on
mac; Steam mac builds must ALSO be Developer ID signed + notarized). Output layouts
in `release-steam/`:

- `mac-universal/World of ClaudeCraft.app` (one universal .app)
- `win-unpacked/` (x64; Windows-on-ARM runs it via emulation)
- `linux-unpacked/` (x64)

Depot layout (one app, three depots, one package):

| Depot | Content root | OS filter |
|---|---|---|
| `<appid>1` | `win-unpacked/*` | Windows, 64-bit |
| `<appid>2` | `World of ClaudeCraft.app` (the loose bundle) | macOS |
| `<appid>3` | `linux-unpacked/*` | Linux, 64-bit |

Launch options (one per OS): Windows `World of ClaudeCraft.exe`; macOS
`World of ClaudeCraft.app` (app-bundle launch picks the best arch on Apple Silicon);
Linux `world-of-claudecraft` (the executable inside linux-unpacked).

Rules that keep this working:
- Upload the mac depot from a macOS or Linux machine (a Windows upload destroys the
  symlinks inside `Electron Framework.framework` and the signature with them).
  Upload the loose `.app` directory; never a zip or dmg (SteamPipe installs files
  as-is and preserves the notarized signature).
- Do NOT apply the Valve DRM wrapper on any platform (it rewrites the exe like a
  packer, is unavailable for mac, and Valve itself calls it weak).
- No Steamworks SDK is linked, which Valve explicitly supports; consequences:
  no achievements/cloud/rich presence, and the Steam OVERLAY does not hook the game.
  Accepted for v1. If overlay/achievements are ever wanted, that is a steamworks.js
  (or successor) project with its own CI gate; do not bolt it on casually.
- Updates ship as new SteamPipe builds promoted to the default branch; the in-app
  updater is off in this channel (runtime stamp) AND the build has no publish feed
  (no app-update.yml), so there is nothing to disable manually. Steam policy is that
  updates flow through Steam; keep it that way.
- `steam_appid.txt` is not needed (SDK never initialized) and must not ship.

## Error logging, crash dumps, privacy

- Shell log file (rotating, 5 MB + one archive; paths follow the package NAME,
  verified on a packaged build): macOS
  `~/Library/Logs/world-of-claudecraft/main.log`; Windows
  `%USERPROFILE%\\AppData\\Roaming\\world-of-claudecraft\\logs\\main.log`; Linux
  `~/.config/world-of-claudecraft/logs/main.log`. Contains the startup banner
  (version/channel/updater state), GPU status (including a warning if WebGL fell
  back to software), updater activity, renderer console warnings/errors, uncaught
  renderer errors (clamped + secret-redacted, capped per session), and crash/
  recovery events. Ask players to attach it to bug reports.
- Native crash minidumps (Crashpad, all processes) accumulate under the directory
  logged at startup (`app.getPath('crashDumps')`). By default nothing is uploaded
  anywhere. If `WOC_CRASH_SUBMIT_URL` (https) is set at BUILD time, dumps upload
  compressed + rate-limited to that endpoint; any multipart minidump receiver works,
  including a Sentry project's `/minidump/` ingest URL, with no SDK added.
- Privacy: logs stay on the player's machine; the only optional transmission is the
  minidump upload above (process memory snapshots; treat the endpoint as sensitive
  and say so in the privacy policy before enabling it). The log redaction strips
  bearer tokens and obvious credential patterns before writing.

## Post-release verification checklist (each OS, each channel)

1. Fresh install, launch: window appears, no Gatekeeper/SmartScreen block (signed
   builds), log file created, startup banner shows the right `version`,
   `distribution`, and `updaterEnabled`.
2. GPU: log shows `[gpu] feature status` with hardware WebGL2 (no
   `software only`, no SwiftShader/llvmpipe renderer, no softwareRendering warning).
3. Login both paths: email/password in-app, and Discord via the external browser +
   `worldofclaudecraft://desktop-login` deep link handoff (app focuses and enters
   the world; second-instance and cold-start deep links both work).
4. Play 5 minutes: steady frame rate, alt-tab out/in does not hitch or freeze the
   world (backgroundThrottling stays off).
5. Website channel only: with a higher-version build on the feed, the update toast
   appears, "Restart now" applies it, and a player who quits instead gets it on next
   launch. Steam channel: confirm the log says the updater is disabled and no
   update network traffic occurs.
6. Crash surfaces: `kill -SEGV <renderer pid>` (or close via task manager twice)
   produces the log entries, the bounded auto-reload, then the localized
   Reload/Quit dialog; a minidump lands in crashDumps.
7. `npm test` green at the built commit; `tests/electron_*.test.ts` cover the
   shell's pure logic.

## Version pinning

Electron is `^43.0.0` (current stable, EOL 2027-01-05; the lockfile pins the exact
patch). Before bumping to 44 (stable ~2026-08-25): audit renderer `clipboard` usage
(removed from renderers in 44) and drop any 32-bit expectations. electron-builder
stays on 26.x (27 is an ESM-only alpha); electron-updater 6.x (7 is an ESM alpha).
