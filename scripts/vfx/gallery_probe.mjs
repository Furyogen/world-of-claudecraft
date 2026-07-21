// Ability VFX gallery probe. Modes:
//   node scripts/_tmp_gallery_probe.mjs          , archetype sample set
//   node scripts/_tmp_gallery_probe.mjs --all    , every class/ability sweep
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../browser_path.mjs';

const OUT = 'tmp/vfx';
const ALL = process.argv.includes('--all');
const URL = 'http://localhost:5177/arc_bolt_preview.html?full';

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 240000,
  args: ['--use-angle=swiftshader', '--window-size=1280,760', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });

const errors = [];
let currentLabel = 'boot';
page.on('console', (m) => {
  if (m.type() === 'error') {
    errors.push({ at: currentLabel, text: m.text() });
    console.log(`[console.error @ ${currentLabel}]`, m.text().slice(0, 200));
  }
});
page.on('pageerror', (e) => {
  errors.push({ at: currentLabel, text: e.message });
  console.log(`[pageerror @ ${currentLabel}]`, e.message.slice(0, 300));
});

console.log('loading', URL);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__ab !== undefined && window.__ab.current !== null', {
  timeout: 90000,
  polling: 200,
});
console.log('gallery up; gl =', await page.evaluate(() => window.__ab.gl));

async function waitPhase(id, st, minT, timeout = 210000) {
  // SwiftShader runs the sim at ~15% speed, long windups need headroom
  await page.waitForFunction(
    (id2, s, mt) =>
      window.__ab?.current &&
      window.__ab.current.id === id2 &&
      window.__ab.state === s &&
      window.__ab.t >= mt,
    { timeout, polling: 100 },
    id,
    st,
    minT,
  );
}

async function snap(name) {
  const data = await page.evaluate(() => {
    window.__ab.composeShot();
    return window.__ab.shot();
  });
  writeFileSync(path.join(OUT, `g_${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
}

async function runAbility(cls, id, shots) {
  currentLabel = `${cls}/${id}`;
  await page.evaluate((c, i) => window.__ab.setAbility(c, i), cls, id);
  try {
    if (shots?.windup) {
      await waitPhase(id, 'windup', shots.windup);
      await snap(`${cls}_${id}_windup`);
    }
    // capture timing per archetype: beams only EXIST during the channel;
    // strikes peak at the contact frame; everything else waits for spirits,
    // motifs and linger effects to be readable
    const arch = await page.evaluate(() => window.__ab.current.archetype);
    const spec = await page.evaluate(() => window.__ab.spec);
    if (arch === 'beam') await waitPhase(id, 'channel', 1.1);
    else if (arch === 'strike' || arch === 'dash') await waitPhase(id, 'aftermath', 0.18);
    else if (arch === 'shout')
      await waitPhase(id, 'aftermath', 0.22); // ring wavefront mid-expansion
    else if (arch === 'bolt' && (spec?.bolt?.volley || spec?.bolt?.tracer))
      await waitPhase(id, 'aftermath', 0.15); // barrage/tracer still in the air
    else if (arch === 'bolt' || arch === 'burst' || arch === 'dot' || arch === 'nova')
      await waitPhase(id, 'aftermath', 0.28); // flipbook burst at full bloom
    else if (arch === 'summon')
      await waitPhase(id, 'aftermath', 0.8); // the summoned creature must be RISEN
    else if (arch === 'buff' || arch === 'cc') await waitPhase(id, 'aftermath', 0.55);
    else await waitPhase(id, 'aftermath', 0.45);
    await snap(`${cls}_${id}`);
    console.log('ok', cls, id, `(${arch})`);
  } catch (e) {
    errors.push({
      at: currentLabel,
      text: `TIMEOUT waiting for phases: ${e.message.slice(0, 120)}`,
    });
    console.log('TIMEOUT', cls, id);
  }
}

if (!ALL) {
  // arc bolt regression with full sequence
  currentLabel = 'shaman/lightning_bolt';
  await waitPhase('lightning_bolt', 'windup', 1.5);
  await snap('shaman_lightning_bolt_windup');
  await waitPhase('lightning_bolt', 'travel', 0.3); // bolt ~55% downrange, the coiled streak owns the frame
  await snap('shaman_lightning_bolt_travel');
  await waitPhase('lightning_bolt', 'aftermath', 0.3);
  await snap('shaman_lightning_bolt');
  console.log('arc bolt regression captured');
  const SAMPLE = [
    ['mage', 'fireball', { windup: 1.4 }], // bolt, orb windup (no circle now)
    ['mage', 'frost_nova', null], // nova, vortex windup
    ['mage', 'polymorph', null], // cc + SPECTRAL SHEEP
    ['warrior', 'charge', null], // dash + SPECTRAL BULL
    ['warrior', 'slam', { windup: 1.2 }], // strike, stance windup + groundSlam
    ['warlock', 'summon_voidwalker', null], // summon, rune circle kept
    ['paladin', 'holy_light', { windup: 1.6 }], // heal, ascend windup
    ['shaman', 'lightning_shield', null], // buff sparks orbit
    ['shaman', 'ghost_wolf', null], // SPIRIT WOLF circling
    ['shaman', 'rockbiter_weapon', null], // weapon windup + weaponGlow buff
    ['rogue', 'stealth', null], // buff veil
    ['druid', 'bear_form', null], // morph + SPECTRAL BEAR
    ['druid', 'rake', null], // strike (claws once unveil pass sets it)
    ['hunter', 'raptor_strike', null], // strike + SPECTRAL RAPTOR
    ['priest', 'mind_flay', null], // beam
  ];
  for (const [cls, id, shots] of SAMPLE) await runAbility(cls, id, shots);
} else {
  const list = await page.evaluate(() => window.__ab.list());
  for (const [cls, ids] of Object.entries(list)) {
    for (const id of ids) await runAbility(cls, id, null);
  }
}

writeFileSync(path.join(OUT, 'gallery_probe_errors.json'), JSON.stringify(errors, null, 1));
console.log(`done, ${errors.length} error(s); log at gallery_probe_errors.json`);
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
