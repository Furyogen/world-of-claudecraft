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
  ],
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR:', error.message));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jsClick = (selector) =>
  page.evaluate((value) => {
    const element = document.querySelector(value);
    if (!element) throw new Error(`missing ${value}`);
    element.click();
  }, selector);

await page.goto(URL, { waitUntil: 'load', timeout: 120_000 });
await page.waitForSelector('#btn-offline', { timeout: 120_000 });
await sleep(400);
await jsClick('#btn-offline');
await sleep(300);
await page.type('#char-name', 'Luffy');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 60_000 });
await sleep(2500);
await page.evaluate(() => {
  const button = [...document.querySelectorAll('button')].find((candidate) =>
    /skip tutorial/i.test(candidate.textContent || ''),
  );
  button?.click();
});
await sleep(500);

await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20, sim.playerId);
  sim.addItem('reins_weirdo_cream_truck', 1);
  sim.selectMount('weirdo_cream_truck');
});
await sleep(400);
await page.waitForFunction(
  () => {
    const sim = window.__game.sim;
    if (!sim.player.mountKey) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true }));
    }
    return sim.player.mountKey === 'weirdo_cream_truck';
  },
  { timeout: 20_000, polling: 250 },
);
await page.waitForFunction(
  () => !!window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisual,
  { timeout: 40_000, polling: 300 },
);
// Hide the HUD: this is an asset showcase, not a UI shot.
await page.evaluate(() => {
  const ui = document.querySelector('#ui');
  if (ui) ui.style.display = 'none';
});
await sleep(1200);

console.log(`capturing ${FRAMES} frames...`);
for (let frame = 0; frame < FRAMES; frame++) {
  const yaw = (frame / FRAMES) * Math.PI * 2;
  await page.evaluate((y) => {
    const input = window.__game.input;
    if (input) {
      input.camYaw = y;
      // A slight downward look keeps the whole vehicle plus the rider framed.
      input.camPitch = -0.16;
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
