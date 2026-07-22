import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new', protocolTimeout: 120000,
  args: ['--use-angle=swiftshader', '--window-size=1280,760'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 250)); });
await page.evaluateOnNewDocument(() => {
  const prev = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
  localStorage.setItem('woc_settings', JSON.stringify({ ...prev, abilityVfx: true }));
});
await page.goto('http://localhost:5177/', { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
console.log('btn-offline present:', await page.evaluate(() => !!document.querySelector('#btn-offline')));
await page.evaluate(() => document.querySelector('#btn-offline')?.click());
await new Promise((r) => setTimeout(r, 1500));
const state1 = await page.evaluate(() => ({
  offlineSelect: !!document.querySelector('#offline-select'),
  classes: [...document.querySelectorAll('#offline-select .mini-class')].map((e) => e.getAttribute('data-class')),
  startBtn: !!document.querySelector('#btn-start-offline'),
  visibleButtons: [...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.id || b.textContent?.slice(0, 24)).slice(0, 14),
}));
console.log('after offline click:', JSON.stringify(state1, null, 1));
await page.evaluate(() => document.querySelector('#offline-select .mini-class[data-class="shaman"]')?.click());
await new Promise((r) => setTimeout(r, 600));
const nameState = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input')].filter((i) => i.offsetParent);
  return inputs.map((i) => ({ id: i.id, name: i.name, ph: i.placeholder, type: i.type, cls: i.className.slice(0, 40) }));
});
console.log('visible inputs:', JSON.stringify(nameState, null, 1));
await page.evaluate(() => {
  const input = [...document.querySelectorAll('input')].find((i) => i.offsetParent && i.type !== 'checkbox');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'Stormtest');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 400));
const preClick = await page.evaluate(() => {
  const btn = document.querySelector('#btn-start-offline');
  const input = [...document.querySelectorAll('input')].find((i) => i.offsetParent && i.type !== 'checkbox');
  return { btn: !!btn, btnDisabled: btn?.disabled, btnText: btn?.textContent?.slice(0, 30), inputValue: input?.value };
});
console.log('pre-click:', JSON.stringify(preClick));
await page.evaluate(() => document.querySelector('#btn-start-offline')?.click());
await new Promise((r) => setTimeout(r, 1000));
const postClick = await page.evaluate(() => {
  const err = [...document.querySelectorAll('.error, .form-error, [class*="error"]')].filter((e) => e.offsetParent).map((e) => e.textContent?.slice(0, 80));
  return { errors: err.slice(0, 5), offlineSelectStill: !!document.querySelector('#offline-select')?.offsetParent };
});
console.log('post-click:', JSON.stringify(postClick));
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await page.evaluate(() => ({ game: !!window.__game, sim: !!window.__game?.sim, player: !!window.__game?.sim?.player, bodyCls: document.body.className.slice(0, 60) }));
  console.log(`${(i + 1) * 5}s:`, JSON.stringify(s));
  if (s.player) break;
}
writeSync();
function writeSync() {}
const buf = await page.screenshot({ type: 'png' });
writeFileSync('tmp/vfx/boot_debug.png', buf);
console.log('screenshot → tmp/vfx/boot_debug.png');
await browser.close();
