// Buff system proofs:
//  1. persistence — a buff's visual survives to the very END of its stage time
//  2. stacking  — two concurrent buffs render together (hunter combo beats 1+2)
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../browser_path.mjs';

const OUT = 'tmp/vfx';
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new', protocolTimeout: 300000,
  args: ['--use-angle=swiftshader', '--window-size=1280,760', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
let bad = 0;
page.on('pageerror', (e) => { bad++; console.log('[pageerror]', e.message.slice(0, 250)); });
await page.goto('http://localhost:5177/arc_bolt_preview.html?full', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__ab && window.__ab.current', { timeout: 90000, polling: 200 });

const snap = async (name) => {
  const data = await page.evaluate(() => { window.__ab.composeShot(); return window.__ab.shot(); });
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
};

// -- 1. persistence: the buff visual is still alive DEEP into the aftermath
const PERSIST = [
  ['paladin', 'blessing_of_might'],
  ['warrior', 'battle_shout'], // shout with a rally-buff block
  ['druid', 'thorns'], // deadly_poison is rim-only by design (weapon slot went to instant_poison)
];
for (const [cls, id] of PERSIST) {
  await page.evaluate((c, i) => window.__ab.setAbility(c, i), cls, id);
  try {
    // late-frame: ≥78% through the aftermath AND the orbit still registered
    await page.waitForFunction((i) => {
      const ab = window.__ab;
      if (!ab.current || ab.current.id !== i || ab.state !== 'aftermath') return false;
      const dur = Math.max(ab.spec.linger ?? 0, 3.2) * 0.78;
      return ab.t >= dur && ab.buffs >= 1;
    }, { timeout: 240000, polling: 150 }, id);
    await snap(`buff_persist_${id}`);
    console.log('ok persist', cls, id);
  } catch { console.log('FAIL persist', cls, id, '(orbit died early or never registered)'); bad++; }
}

// -- 2. stacking: hunter combo beats 1+2 are both buffs — both must be live
await page.evaluate(() => window.__ab.setAbility('hunter', 'aspect_of_the_hawk'));
await page.waitForFunction('window.__ab.current && window.__ab.current.id === "aspect_of_the_hawk"', { timeout: 60000, polling: 200 });
await page.evaluate(() => document.getElementById('btnCombo').click());
try {
  await page.waitForFunction(() => {
    const ab = window.__ab;
    return ab.current && ab.current.id === 'rapid_fire' && ab.state === 'aftermath' && ab.t >= 0.5 && ab.buffs >= 2;
  }, { timeout: 280000, polling: 150 });
  const n = await page.evaluate(() => window.__ab.buffs);
  await snap('buff_stack_hunter');
  console.log(`ok stack — ${n} concurrent buffs live (wings + heartbeat)`);
} catch { console.log('FAIL stack — second buff did not coexist with the first'); bad++; }
await page.evaluate(() => document.getElementById('btnCombo').click()); // combo off

console.log(`done — ${bad} problem(s)`);
await browser.close();
process.exit(bad ? 1 : 0);
