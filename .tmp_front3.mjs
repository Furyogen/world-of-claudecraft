// Front view: turn the RIDER to face the camera rather than moving the camera.
// The follow camera owns its own yaw every frame, but the entity's facing is sim
// state the renderer reads, so holding facing at camera+PI presents the front.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './scripts/browser_path.mjs';
import { enterOfflineGame } from './scripts/enter_offline_game.mjs';
import { suppressGpuNotice } from './scripts/lib/gpu_notice_suppress.mjs';

const OUT = 'C:/Users/xdutoit/AppData/Local/Temp/claude/C--Users-xdutoit-Documents-GitHub-world-of-claudecraft/51aa566b-6b8d-4fc3-a946-501761a4ff8e/scratchpad/frontshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await suppressGpuNotice(page);
await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 120000 });
await enterOfflineGame(page, {
  charClass: 'warrior', charName: 'Rider', settleMs: 3500,
  gameBootTimeoutMs: 90000, selectorTimeoutMs: 60000,
});
await page.evaluate(() => {
  const sim = window.__game.sim;
  sim.setPlayerLevel(20, sim.playerId);
  sim.players.get(sim.playerId).ridingTrained = true;
  sim.addItem('reins_pet_rock', 1);
  sim.useItem('reins_pet_rock', sim.playerId);
  const p = sim.player;
  p.maxHp = 99999;
  p.hp = 99999;
});
await page.waitForFunction(() => window.__game.sim.player.mountKey === 'pet_rock', { timeout: 40000, polling: 250 });
await page.waitForFunction(
  () => window.__game.renderer?.views?.get(window.__game.sim.playerId)?.mountVisualKey === 'mount_pet_rock',
  { timeout: 40000, polling: 300 },
);
await sleep(1500);
await page.evaluate(() => {
  const ui = document.querySelector('#ui');
  if (ui) ui.style.display = 'none';
});

const probe = await page.evaluate(() => {
  const r = window.__game.renderer;
  const p = window.__game.sim.player;
  return { camYaw: r.camYaw, facing: p.facing, keys: Object.keys(p).filter((k) => /fac|yaw|rot/i.test(k)) };
});
console.log('probe', probe);

// Hold facing opposite the camera every frame; the view also carries an
// interpolated facing, so pin that too or it eases back over a few frames.
await page.evaluate(() => {
  const r = window.__game.renderer;
  const sim = window.__game.sim;
  window.__face = { delta: Math.PI };
  const hold = () => {
    const p = sim.player;
    const v = r.views?.get(sim.playerId);
    const target = (r.camYaw ?? 0) + window.__face.delta;
    if (p) p.facing = target;
    if (v) {
      if ('interpFacing' in v) v.interpFacing = target;
      if ('lastInterpFacing' in v) v.lastInterpFacing = target;
      if (v.group) v.group.rotation.y = target;
    }
    requestAnimationFrame(hold);
  };
  requestAnimationFrame(hold);
});
await sleep(1500);

for (const [label, delta] of [['front', Math.PI], ['three-quarter', Math.PI * 0.75]]) {
  await page.evaluate((d) => { window.__face.delta = d; }, delta);
  await sleep(900);
  await page.screenshot({ path: `${OUT}/pet-rock-${label}.png` });
  console.log('shot', label);
}
await browser.close();
