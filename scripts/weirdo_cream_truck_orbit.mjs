// The Weirdo Cream truck showcase: a full 360-degree orbit at ultra graphics,
// stationary, jumping on a loop so the roof chime keeps firing.
//
//   node scripts/weirdo_cream_truck_orbit.mjs        (needs `npm run dev`)
//
// Stationary on purpose. The point of this capture is the CAB (the driver has to
// read as sitting in it, unclipped, from every angle) and the jump (which is
// what triggers the five-second chime), neither of which a driving shot shows
// well. The camera does the moving instead: one continuous revolution while the
// truck idles and hops in place.
//
// Frames are captured on a fixed schedule and encoded with the bundled ffmpeg,
// so the output is an MP4 plus a GIF with no external tooling.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { dismissEntryOverlays, enterOfflineGame } from './enter_offline_game.mjs';
import { FFMPEG_PATH } from './sfx/ffmpeg_paths.mjs';

const BASE = process.env.GAME_URL ?? 'http://localhost:5173';
// Ultra tier plus a high-DPI viewport: this is the "show me the graphics" pass,
// not a perf capture.
const URL = `${BASE}/?gfx=ultra`;
const OUT_DIR = process.env.OUT_DIR ?? 'docs/screenshots/weirdo-cream-truck/showcase';
const FRAME_DIR = 'tmp/weirdo_orbit_frames';
const FRAMES = Number(process.env.FRAMES ?? 120);
const FPS = 24;
/** Jump every this many frames, so several chimes land across the revolution. */
const JUMP_EVERY = 24;

fs.rmSync(FRAME_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: [
    '--window-size=1280,720',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1',
    // Required wherever this runs as root (CI containers, the cloud session
    // box); Chromium refuses to start otherwise.
    '--no-sandbox',
  ],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR:', error.message));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await page.goto(URL, { waitUntil: 'load', timeout: 240_000 });
// Use the shared entry rather than hand-driving the pre-game UI: it dismisses
// the three overlays that must never appear in a capture (intro logo, tutorial,
// and the camera-mode prompt). Hand-rolling this is exactly how the first pass
// ended up with the camera prompt sitting in the middle of all 120 frames.
// The timeouts are wide because software rendering makes world entry minutes.
await enterOfflineGame(page, {
  charClass: 'warrior',
  charName: 'Luffy',
  settleMs: 4000,
  gameBootTimeoutMs: 300_000,
  selectorTimeoutMs: 180_000,
});
await dismissEntryOverlays(page);

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20, sim.playerId);
  sim.addItem('reins_weirdo_cream_truck', 1);
  // Riding is gated on the skill Marla sells for 80g; grant it on the meta
  // rather than walking the capture to the stables and through a purchase.
  const meta = sim.meta(sim.playerId);
  if (meta) meta.ridingTrained = true;
});
await sleep(500);

// Riding is an ITEM USE. This build deliberately has no selected mount and no
// picker (see src/world_api/mounts.ts): using the reins routes through
// summonMountItem and starts the summon channel, which takes a few seconds to
// land. Retry the use rather than poll it, so one refused attempt (a stray
// combat flag, a not-yet-settled spawn) does not burn the whole window.
let mounted = false;
for (let attempt = 0; attempt < 10 && !mounted; attempt++) {
  await page.evaluate(() => window.__game.sim.useItem('reins_weirdo_cream_truck'));
  try {
    await page.waitForFunction(() => window.__game.sim.player.mountKey === 'weirdo_cream_truck', {
      timeout: 8000,
      polling: 250,
    });
    mounted = true;
  } catch {
    // fall through and try again
  }
}
if (!mounted) throw new Error('could not summon the Weirdo Cream truck');

// The mount GLB is lazyPreload: wait for the visual, not a fixed nap.
await page.waitForFunction(
  () => !!window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisual,
  { timeout: 120_000, polling: 300 },
);
await sleep(1500);

// Hide the HUD: this is an asset showcase, not a UI shot.
await page.evaluate(() => {
  const ui = document.querySelector('#ui');
  if (ui) ui.style.display = 'none';
  // The headless run has no GPU, so the client shows a software-rendering
  // warning toast; it is not part of the asset.
  for (const node of document.querySelectorAll('.gpu-warning, .toast, .notice-banner')) {
    node.style.display = 'none';
  }
});
await sleep(1200);

console.log(`capturing ${FRAMES} frames...`);
for (let frame = 0; frame < FRAMES; frame++) {
  const yaw = (frame / FRAMES) * Math.PI * 2;
  await page.evaluate((y) => {
    const input = window.__game.input;
    if (input) {
      input.camYaw = y;
      // POSITIVE looks DOWN here (src/game/input.ts: camPitch is positive
      // looking down, default 0.32). A negative value aims at empty sky, which
      // is what turned the first capture into 120 grey frames.
      input.camPitch = 0.24;
    }
  }, yaw);
  if (frame % JUMP_EVERY === 0) {
    await page.keyboard.down('Space');
    await sleep(60);
    await page.keyboard.up('Space');
  }
  await sleep(45);
  await page.screenshot({
    path: path.join(FRAME_DIR, `f${String(frame).padStart(4, '0')}.png`),
  });
}
await browser.close();
console.log('frames captured, encoding...');

const mp4 = path.join(OUT_DIR, 'orbit-ultra.mp4');
const gif = path.join(OUT_DIR, 'orbit-ultra.gif');
const palette = path.join(FRAME_DIR, 'palette.png');
const input = path.join(FRAME_DIR, 'f%04d.png');
const run = (args) => execFileSync(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });

run([
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-framerate',
  String(FPS),
  '-i',
  input,
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-crf',
  '18',
  '-vf',
  'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  mp4,
]);
run([
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-i',
  input,
  '-vf',
  'fps=16,scale=720:-1:flags=lanczos,palettegen=stats_mode=diff',
  palette,
]);
run([
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-framerate',
  String(FPS),
  '-i',
  input,
  '-i',
  palette,
  '-lavfi',
  'fps=16,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse',
  gif,
]);

console.log(`mp4: ${mp4} (${(fs.statSync(mp4).size / 1024).toFixed(0)} KB)`);
console.log(`gif: ${gif} (${(fs.statSync(gif).size / 1024).toFixed(0)} KB)`);
