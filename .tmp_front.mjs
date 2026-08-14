// Front-facing captures of the Pet Rock: orbit the follow camera around the
// standing rider (renderer.camYaw) instead of driving movement, so the mount
// holds its rest pose and the shot is a clean product view.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './scripts/browser_path.mjs';
import { enterOfflineGame } from './scripts/enter_offline_game.mjs';
import { suppressGpuNotice } from './scripts/lib/gpu_notice_suppress.mjs';

const OUT = 'C:/Users/xdutoit/AppData/Local/Temp/claude/C--Users-xdutoit-Documents-GitHub-world-of-claudecraft/51aa566b-6b8d-4fc3-a946-501761a4ff8e/scratchpad/frontshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
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

// Hide the HUD so the shot is the mount, not the chrome.
await page.evaluate(() => {
  const ui = document.querySelector('#ui');
  if (ui) ui.style.display = 'none';
});
await sleep(400);

const facing = await page.evaluate(() => window.__game.sim.player.facing ?? 0);
console.log('player facing', facing);

const views = [
  ['front', 0],
  ['front-three-quarter', Math.PI / 4],
  ['side', Math.PI / 2],
  ['back', Math.PI],
];
for (const [label, delta] of views) {
  await page.evaluate(
    (args) => {
      const r = window.__game.renderer;
      r.camYaw = args.facing + args.delta;
      r.camPitch = 0.22;
      r.camDist = 7.5;
    },
    { facing, delta },
  );
  await sleep(900);
  await page.screenshot({ path: `${OUT}/pet-rock-${label}.png` });
  console.log('shot', label);
}
await browser.close();
