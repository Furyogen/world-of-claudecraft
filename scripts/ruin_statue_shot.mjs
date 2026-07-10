// Screenshot harness for the new Zone 2 ruin-ring decorative statue
// (public/models/props/ruin_statue.glb, placed via ZONE2_PROPS.statues).
// Boots the offline world, teleports the player to the statue's anchor
// (109, 429), and frames it at max graphics.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const URL = `${process.env.GAME_URL ?? 'http://localhost:5173'}/?gfx=ultra`;
fs.mkdirSync('tmp', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await page.evaluate(() => document.querySelector('#btn-offline').click());
await sleep(300);
await page.type('#char-name', 'Statuewatch');
await page.click('#offline-select .mini-class[data-class="warrior"]');
await page.click('#btn-start-offline');
await page.waitForFunction(() => window.__game?.hud && window.__game?.renderer, { timeout: 60000 });
await sleep(2500);

await page.evaluate(() => {
  const p = window.__game.sim.player;
  // statue anchor: zone2 ZONE2_PROPS.statues = { x: 109, z: 429 }
  p.pos.x = 109;
  p.pos.z = 421;
  p.facing = 0;
  window.__game.input.camYaw = 0;
  window.__game.input.camDist = 7;
  window.__game.input.camPitch = 0.12;
  // clear the drowned-dead camp mobs near the ring, screenshot-only cleanup
  // (this is a visual verification script, not a gameplay test)
  const sim = window.__game.sim;
  for (const [id, e] of sim.entities) {
    if (e.kind === 'mob' && Math.hypot(e.pos.x - 105, e.pos.z - 432) < 30) {
      sim.entities.delete(id);
    }
  }
});
await sleep(600);
await page.screenshot({ path: 'tmp/ruin-statue.png' });
console.log('screenshot -> tmp/ruin-statue.png');

await browser.close();
