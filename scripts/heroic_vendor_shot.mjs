// Visual proof for the Heroic Marks vendor PR: (1) the character window
// paperdoll with the new neck + ring1/ring2 slots filled, (2) the Heroic
// Quartermaster shop window with the marks balance and mixed affordability.
//   node scripts/heroic_vendor_shot.mjs    (needs `npm run dev` on :5173)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1600,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
const jsClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.click();
  }, sel);
await new Promise((r) => setTimeout(r, 400));
await jsClick('#btn-offline');
await new Promise((r) => setTimeout(r, 300));
await page.type('#char-name', 'Vexbuyer');
await jsClick('#offline-select .mini-class[data-class="warrior"]');
await jsClick('#btn-start-offline');
await page.waitForFunction(() => window.__game?.sim?.player, { timeout: 40000 });
await new Promise((r) => setTimeout(r, 2000));

// Skip the intro cinematic (it keeps #ui hidden until dismissed).
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 600));
// Dismiss the new-adventurer tutorial overlay, which otherwise intercepts input.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /skip tutorial/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

// Level to cap, grant + equip the jewelry, open the character window.
await page.evaluate(() => {
  const { sim, hud } = window.__game;
  const pid = sim.player.id;
  sim.setPlayerLevel(20, pid);
  sim.addItem('yumis_best_pendant', 1, pid);
  sim.addItem('ring_of_the_nine', 1, pid);
  sim.addItem('nielas_band', 1, pid);
  sim.equipItem('yumis_best_pendant', pid);
  sim.equipItem('ring_of_the_nine', pid);
  sim.equipItem('nielas_band', pid);
  sim.tick();
  hud.toggleChar();
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'tmp/heroic_paperdoll.png' });
console.log('shot: tmp/heroic_paperdoll.png');

// Close the char window, teleport to the Highwatch quartermaster, open the shop
// with a balance that affords the rings (12) but not the pendants (16).
await page.evaluate(() => {
  const { sim, hud } = window.__game;
  hud.toggleChar();
  const pid = sim.player.id;
  sim.addItem('heroic_mark', 14, pid);
  const npc = [...sim.entities.values()].find((e) => e.templateId === 'heroic_quartermaster');
  if (!npc) throw new Error('quartermaster not spawned');
  const p = sim.entities.get(pid);
  p.pos = { x: npc.pos.x + 1.5, y: npc.pos.y, z: npc.pos.z + 1.5 };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  sim.tick();
  hud.openHeroicVendor(npc.id);
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: 'tmp/heroic_vendor.png' });
console.log('shot: tmp/heroic_vendor.png');

await browser.close();
