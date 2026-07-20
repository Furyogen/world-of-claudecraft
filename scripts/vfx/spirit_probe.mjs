// Snapshot spirit apparitions mid-life (they load async + fade in).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const OUT = 'tmp/vfx';
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new', protocolTimeout: 180000,
  args: ['--use-angle=swiftshader', '--window-size=1280,760', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
let bad = 0;
page.on('pageerror', (e) => { bad++; console.log('[pageerror]', e.message.slice(0, 200)); });
await page.goto('http://localhost:5177/arc_bolt_preview.html?full', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__ab && window.__ab.current', { timeout: 90000, polling: 200 });
await page.evaluate(() => window.__ab.prewarmSpirits()); // GLBs cached before any timed capture

// 6th column: shot must contain a LIVE spirit (guards against empty frames)
// shot list matches the DIRECTOR'S POLICY: animal spirits druid-only (+ the
// subject-of-the-spell exceptions), monsters on warlock
const SHOTS = [
  ['mage', 'polymorph', 'aftermath', 1.0, 'spirit_sheep', true],
  ['shaman', 'ghost_wolf', 'aftermath', 1.3, 'spirit_wolf', true],
  ['druid', 'bear_form', 'aftermath', 0.9, 'spirit_bear', true],
  ['druid', 'tigers_fury', 'aftermath', 0.8, 'spirit_tiger', true],
  ['druid', 'travel_form', 'aftermath', 0.9, 'spirit_travel_stag', true],
  ['hunter', 'tame_beast', 'aftermath', 1.0, 'spirit_tamed', true],
  ['druid', 'mark_of_the_wild', 'aftermath', 0.9, 'spirit_stag', true],
  ['paladin', 'blessing_of_might', 'aftermath', 1.2, 'buff_wings', false],
  ['paladin', 'judgement', 'aftermath', 0.55, 'judgement_gavel', false],
  ['warlock', 'summon_infernal', 'aftermath', 1.0, 'spirit_infernal', true],
  ['warlock', 'summon_felguard', 'aftermath', 1.0, 'spirit_felguard', true],
  ['druid', 'rake', 'aftermath', 0.12, 'claws_rake', false],
];
for (const [cls, id, st, minT, name, needSp] of SHOTS) {
  await page.evaluate((c, i) => window.__ab.setAbility(c, i), cls, id);
  try {
    await page.waitForFunction(
      (i, s, mt, sp) => window.__ab.current && window.__ab.current.id === i && window.__ab.state === s && window.__ab.t >= mt && (!sp || window.__ab.spirits > 0),
      { timeout: 60000, polling: 100 }, id, st, minT, needSp
    );
    const data = await page.evaluate(() => { window.__ab.composeShot(); return window.__ab.shot(); });
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log('ok', name);
  } catch { console.log('TIMEOUT', name); bad++; }
}
console.log(`done — ${bad} problem(s)`);
await browser.close();
process.exit(bad ? 1 : 0);
