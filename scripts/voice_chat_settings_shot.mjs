// Proximity voice chat: screenshot the new "Voice Chat (Proximity)" toggle in
// the Esc > Audio options panel, off and on. Offline flow (no server needed
// for the screenshot itself). Writes PNGs to tmp/.

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

import { BROWSER_PATH as EDGE } from './browser_path.mjs';

const URL = process.env.GAME_URL ?? 'http://localhost:5173';
const CLASS = process.env.GAME_CLASS ?? 'mage';
fs.mkdirSync('tmp', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = (sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await tap('#btn-offline');
await wait(200);
await page.evaluate(() => {
  const n = document.querySelector('#char-name');
  if (n) {
    n.value = 'Proximity';
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await tap(`#offline-select .mini-class[data-class="${CLASS}"]`);
await tap('#btn-start-offline');
await wait(3000);
await page.waitForFunction(() => !!window.__game?.hud, { timeout: 20000 }).catch(() => {});
// The start screen sometimes lingers past this point in a headless run
// (unrelated to this feature); force it hidden so #ui isn't display:none via
// the `body:has(#start-screen:not([style*="display: none"])) #ui` CSS rule.
await page.evaluate(() => {
  document.querySelector('#start-screen')?.remove();
  document.querySelector('#ui')?.style.setProperty('display', 'block', 'important');
});

// Open the Esc menu, then click the "Audio" entry (the sub-view where the
// new toggle lives).
await page.evaluate(() => window.__game.hud.toggleOptionsMenu());
await wait(300);
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('#options-menu .opt-btn'));
  buttons.find((b) => /audio/i.test(b.textContent ?? ''))?.click();
});
await wait(600);

const panelBox = async () => {
  const r = await page.evaluate(() => {
    const el = document.querySelector('#options-menu');
    return el ? el.getBoundingClientRect().toJSON() : null;
  });
  return r
    ? {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      }
    : null;
};

let box = await panelBox();
if (box) await page.screenshot({ path: 'tmp/voice_chat_settings_audio_panel_off.png', clip: box });

// Click the toggle itself to show the real on-state (headless Chrome denies
// getUserMedia by default, which is fine: the UI still flips to ON before
// the async permission result lands, exactly as it would mid-prompt for a
// real player).
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#options-menu .set-row'));
  const row = rows.find(
    (r) => r.querySelector('.set-name')?.textContent === 'Voice Chat (Proximity)',
  );
  row?.querySelector('button')?.click();
});
await wait(300);
box = await panelBox();
if (box) await page.screenshot({ path: 'tmp/voice_chat_settings_audio_panel_on.png', clip: box });

if (errors.length) console.log(`PAGE ERRORS:\n${errors.join('\n')}`);
console.log(
  'wrote tmp/voice_chat_settings_audio_panel_off.png, tmp/voice_chat_settings_audio_panel_on.png',
);
await browser.close();
