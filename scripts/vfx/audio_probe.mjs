// Audio engine verification: sound ON, exercise every palette identity, all
// windup beds, beams, motif foley, spirit calls, and a full combo chain.
// WebAudio graph mistakes (bad ramp targets, stopped-node reuse) throw — a
// clean run across the whole surface is the pass condition.
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from '../browser_path.mjs';

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  protocolTimeout: 300000,
  args: ['--use-angle=swiftshader', '--window-size=1280,760', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
let bad = 0;
page.on('pageerror', (e) => { bad++; console.log('[pageerror]', e.message.slice(0, 300)); });
page.on('console', (m) => { if (m.type() === 'error') { bad++; console.log('[console.error]', m.text().slice(0, 250)); } });

await page.goto('http://localhost:5177/arc_bolt_preview.html?full', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__ab && window.__ab.current', { timeout: 90000, polling: 200 });
// turn sound ON
const sndState = await page.evaluate(() => { document.getElementById('btnSound').click(); return document.getElementById('btnSound').textContent; });
console.log('sound:', sndState);

async function run(cls, id, minT = 0.3) {
  await page.evaluate((c, i) => window.__ab.setAbility(c, i), cls, id);
  await page.waitForFunction(
    (i, mt) => window.__ab.current && window.__ab.current.id === i && window.__ab.state === 'aftermath' && window.__ab.t >= mt,
    { timeout: 90000, polling: 100 }, id, minT
  );
  console.log('ok', cls, id);
}

// palette + system coverage
await run('shaman', 'lightning_bolt', 0.5);   // runes bed, breath duck, storm impact, thunder finisher
await run('mage', 'fireball');                // fire: whoomph + crackle ticks + heat
await run('mage', 'frostbolt');               // frost: shatter pings + crystalline ring
await run('mage', 'arcane_missiles');         // beam start/tick crescendo/stop + orbitals
await run('mage', 'polymorph', 0.5);          // the sheep speaks
await run('mage', 'frost_nova', 0.4);         // vortex bed + pillars foley
await run('warrior', 'battle_shout');         // formant war-cry
await run('warrior', 'charge', 0.4);          // dash wind + bull call
await run('warrior', 'slam', 0.4);            // weapon bed + fissure rumble
await run('paladin', 'holy_light', 0.4);      // ascend choral bed + heal + fountain
await run('paladin', 'judgement', 0.4);       // cross bell + gold impact
await run('warlock', 'summon_voidwalker', 0.6); // portal drone + voidwalker moan
await run('warlock', 'corruption');           // shadow sub-drop + swarm
await run('warlock', 'drain_life', 0.5);      // drain beam
await run('druid', 'bear_form', 0.5);         // bear growl
await run('druid', 'rake');                   // claws + physical
await run('rogue', 'slice_and_dice');         // bladestorm swishes + buff arpeggio
await run('hunter', 'aimed_shot', 0.4);       // arrow + max-stack physical crack
await run('priest', 'mind_flay', 0.4);        // shadow beam

// full combo with escalation + finisher duck
await page.evaluate(() => {
  const sel = document.getElementById('selClass');
  sel.value = 'warrior';
  sel.dispatchEvent(new Event('change'));
});
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => document.getElementById('btnCombo').click());
for (const id of ['charge', 'red_harvest', 'thunder_clap', 'execute']) {
  await page.waitForFunction(
    (i) => window.__ab.current && window.__ab.current.id === i && window.__ab.state === 'aftermath' && window.__ab.t >= 0.2,
    { timeout: 120000, polling: 100 }, id
  );
  console.log('combo ok', id);
}
console.log(`done — ${bad} error(s)`);
await browser.close();
process.exit(bad ? 1 : 0);
