import puppeteer from 'puppeteer-core';
import { BROWSER_PATH as EDGE } from './scripts/browser_path.mjs';
import { enterOfflineGame } from './scripts/enter_offline_game.mjs';
import { suppressGpuNotice } from './scripts/lib/gpu_notice_suppress.mjs';
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await suppressGpuNotice(page);
await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 120000 });
await enterOfflineGame(page, { charClass: 'warrior', charName: 'Rider', settleMs: 3000, gameBootTimeoutMs: 90000, selectorTimeoutMs: 60000 });
console.log(await page.evaluate(() => {
  const g = window.__game;
  return {
    gameKeys: Object.keys(g),
    camLike: Object.keys(g).filter((k) => /cam|view|input/i.test(k)),
    rendererCam: g.renderer && typeof g.renderer.camera,
    rendererKeys: Object.keys(g.renderer ?? {}).filter((k) => /cam|yaw|orbit/i.test(k)),
  };
}));
await browser.close();
