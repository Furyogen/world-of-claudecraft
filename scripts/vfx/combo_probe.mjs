// Combo-mode probe: runs the warrior and mage rotations end-to-end,
// screenshotting each step's impact (the mage chain proves residue interplay).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../browser_path.mjs';

const OUT = 'tmp/vfx';
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 240000,
  args: ['--use-angle=swiftshader', '--window-size=1280,760', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
let bad = 0;
page.on('pageerror', (e) => {
  bad++;
  console.log('[pageerror]', e.message.slice(0, 250));
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    bad++;
    console.log('[console.error]', m.text().slice(0, 200));
  }
});

await page.goto('http://localhost:5177/arc_bolt_preview.html?full', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction('window.__ab && window.__ab.current', { timeout: 90000, polling: 200 });

async function snap(name) {
  const d = await page.evaluate(() => window.__ab.shot());
  writeFileSync(path.join(OUT, `combo_${name}.png`), Buffer.from(d.split(',')[1], 'base64'));
}
async function waitAbilityImpact(id, minT = 0.15) {
  await page.waitForFunction(
    (i, mt) =>
      window.__ab.current &&
      window.__ab.current.id === i &&
      window.__ab.state === 'aftermath' &&
      window.__ab.t >= mt,
    { timeout: 120000, polling: 100 },
    id,
    minT,
  );
}

for (const [cls, seq] of [
  ['warrior', ['charge', 'red_harvest', 'thunder_clap', 'execute']],
  ['mage', ['frostbolt', 'fireball', 'fire_blast', 'frost_nova']],
]) {
  // select class, then enable combo mode (starts the chain from step 1)
  await page.evaluate((c) => window.__ab.setAbility(c, null ?? undefined), cls).catch(() => {});
  await page.evaluate((c) => {
    const sel = document.getElementById('selClass');
    sel.value = c;
    sel.dispatchEvent(new Event('change'));
  }, cls);
  await new Promise((r) => setTimeout(r, 1500));
  const comboBtn = await page.evaluate(() => {
    const b = document.getElementById('btnCombo');
    if (!b.classList.contains('on')) b.click();
    return b.classList.contains('on');
  });
  console.log(cls, 'combo enabled:', comboBtn);
  for (let i = 0; i < seq.length; i++) {
    await waitAbilityImpact(seq[i], 0.18);
    await snap(`${cls}_${i + 1}_${seq[i]}`);
    console.log('ok', cls, `${i + 1}/${seq.length}`, seq[i]);
  }
  // turn combo off before switching class
  await page.evaluate(() => {
    const b = document.getElementById('btnCombo');
    if (b.classList.contains('on')) b.click();
  });
  await new Promise((r) => setTimeout(r, 400));
}
console.log(`done, ${bad} error(s)`);
await browser.close();
process.exit(bad ? 1 : 0);
