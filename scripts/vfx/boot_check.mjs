// Fast boot check of the PR-branch gallery: catalog size, a marquee new
// ability from each rework, no page errors.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new', protocolTimeout: 240000,
  args: ['--use-angle=swiftshader', '--window-size=1280,760'],
});
const page = await browser.newPage();
let bad = 0;
page.on('pageerror', (e) => { bad++; console.log('[pageerror]', e.message.slice(0, 250)); });
page.on('console', (m) => { if (m.type() === 'error') { bad++; console.log('[console.error]', m.text().slice(0, 200)); } });
await page.goto('http://localhost:5177/arc_bolt_preview.html?full', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__ab && window.__ab.current', { timeout: 120000, polling: 200 });
const list = await page.evaluate(() => window.__ab.list());
const total = Object.values(list).reduce((n, l) => n + l.length, 0);
console.log('catalog:', total, 'abilities;', Object.entries(list).map(([c, l]) => `${c}:${l.length}`).join(' '));
for (const [cls, id] of [['mage', 'meteor'], ['mage', 'temporal_rewind'], ['warrior', 'heroic_leap'], ['warlock', 'chaos_bolt']]) {
  if (!list[cls]?.includes(id)) { console.log('MISSING', cls, id); bad++; continue; }
  await page.evaluate((c, i) => window.__ab.setAbility(c, i), cls, id);
  try {
    await page.waitForFunction(
      (i) => window.__ab.current && window.__ab.current.id === i && window.__ab.state === 'aftermath' && window.__ab.t >= 0.25,
      { timeout: 210000, polling: 150 }, id);
    console.log('ok', cls, id);
  } catch { console.log('TIMEOUT', cls, id); bad++; }
}
console.log(`done — ${bad} problem(s)`);
await browser.close();
process.exit(bad ? 1 : 0);
