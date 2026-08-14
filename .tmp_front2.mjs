// Front view of the Pet Rock. The follow camera rewrites camYaw every frame, so
// instead of fighting it we reflect the camera through the player's own look
// target in a rAF that runs AFTER the renderer's, giving a convention-free
// front view without touching game code.
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

// Orbit override: angle 0 keeps the shipped rear view, PI mirrors to the front.
await page.evaluate(() => {
  const r = window.__game.renderer;
  window.__shot = { angle: Math.PI, dist: 1.0, lift: 0 };
  const spin = () => {
    const cam = r.camera;
    const look = r.cameraLookAt;
    if (cam && look) {
      const dx = cam.position.x - look.x;
      const dz = cam.position.z - look.z;
      const a = window.__shot.angle;
      const nx = dx * Math.cos(a) - dz * Math.sin(a);
      const nz = dx * Math.sin(a) + dz * Math.cos(a);
      cam.position.set(
        look.x + nx * window.__shot.dist,
        look.y + (cam.position.y - look.y) * window.__shot.dist + window.__shot.lift,
        look.z + nz * window.__shot.dist,
      );
      cam.lookAt(look.x, look.y, look.z);
      cam.updateMatrixWorld(true);
    }
    requestAnimationFrame(spin);
  };
  requestAnimationFrame(spin);
});
await sleep(1200);

const shots = [
  ['front', Math.PI, 0.75],
  ['front-three-quarter', Math.PI * 0.72, 0.75],
  ['side', Math.PI / 2, 0.8],
];
for (const [label, angle, dist] of shots) {
  await page.evaluate((s) => { window.__shot.angle = s.angle; window.__shot.dist = s.dist; }, { angle, dist });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/pet-rock-${label}.png` });
  console.log('shot', label);
}
await browser.close();
