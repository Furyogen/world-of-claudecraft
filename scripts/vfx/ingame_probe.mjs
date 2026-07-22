// In-game slice E2E: offline shaman, "Ability VFX (beta)" pre-enabled, casts
// Arc Bolt (lightning_bolt) at a wolf and screenshots windup / flight / impact.
// Asserts: no page errors, the spec-driven path actually handled the spellfx.
// Needs the dev server on :5177 (launch config "gallery-pr").
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const OUT = 'tmp/vfx';
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH, headless: 'new', protocolTimeout: 300000,
  args: ['--use-angle=swiftshader', '--window-size=1280,760', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
let bad = 0;
// environmental noise, not slice regressions: the :8787 game server is not
// running (offline play needs none, but the homepage still polls /api), and
// the training-dummy GLB preload gap pre-dates this branch
const ENV_NOISE = /502|Failed to fetch project stats|character asset not preloaded/;
page.on('pageerror', (e) => { bad++; console.log('[pageerror]', e.message.slice(0, 300)); });
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (ENV_NOISE.test(text)) return;
  bad++; console.log('[console.error]', text.slice(0, 200));
});

// enable the beta toggle before the app boots (Settings loads from this blob)
await page.evaluateOnNewDocument(() => {
  const prev = JSON.parse(localStorage.getItem('woc_settings') ?? '{}');
  localStorage.setItem('woc_settings', JSON.stringify({ ...prev, abilityVfx: true }));
});
await page.goto('http://localhost:5177/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#btn-offline', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => document.querySelector('#btn-offline').click());
await page.waitForSelector('#offline-select .mini-class[data-class="shaman"]', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#offline-select .mini-class[data-class="shaman"]').click());
// the offline flow requires a character name (letters only, classic rule)
await page.evaluate(() => {
  const input = document.querySelector('#offline-select input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'Stormtest');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.evaluate(() => document.querySelector('#btn-start-offline').click());
// v0.28 Welcome Screen sits between Enter World and startGame; Continue enables at once offline
await page.waitForFunction('(() => { const b = document.querySelector("#ws-continue"); return b && !b.disabled; })()', { timeout: 30000, polling: 200 });
await page.evaluate(() => document.querySelector('#ws-continue').click());
await page.waitForFunction('window.__game && window.__game.sim && window.__game.sim.player', { timeout: 180000, polling: 250 });
await new Promise((r) => setTimeout(r, 4000)); // let the world + prewarm settle

// clear onboarding chrome so the screenshots show the fight: camera prompt,
// tutorial banner, and the no-GPU toast (SwiftShader always trips it). These
// mount at different times after world entry, so keep sweeping.
await page.evaluate(() => {
  const sweep = () => {
    document.querySelector('.camera-prompt-confirm')?.click();
    for (const b of document.querySelectorAll('button')) {
      const tx = b.textContent?.trim() ?? '';
      if (/^(skip tutorial|dismiss)$/i.test(tx)) b.click();
    }
  };
  sweep();
  setInterval(sweep, 500);
});
await new Promise((r) => setTimeout(r, 3000));

const snap = async (name) => {
  const buf = await page.screenshot({ type: 'png' });
  writeFileSync(path.join(OUT, `${name}.png`), buf);
  console.log('shot', name);
};

const known = await page.evaluate(() => window.__game.sim.known.map((k) => k.def.id));
console.log('known:', JSON.stringify(known));
if (!known.includes('lightning_bolt')) { console.log('FAIL: no lightning_bolt'); process.exit(1); }

// stage the fight: teleport beside the nearest wolf, face it, target it
const ok = await page.evaluate(() => {
  const g = window.__game;
  const sim = g.sim;
  const p = sim.player;
  let wolf = null, d = 1e9;
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead) {
      const dd = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      if (dd < d) { d = dd; wolf = e; }
    }
  }
  if (!wolf) return null;
  p.pos.x = wolf.pos.x + 28; p.pos.z = wolf.pos.z; // near max range → ~1.1s bolt flight
  p.hp = p.maxHp;
  sim.targetEntity(wolf.id);
  p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
  g.input.camYaw = p.facing;
  return wolf.id;
});
if (ok == null) { console.log('FAIL: no mob found'); process.exit(1); }

// cast and photograph the three beats
await page.evaluate(() => window.__game.sim.castAbility('lightning_bolt'));
await page.waitForFunction('window.__game.sim.player.castingAbility === "lightning_bolt"', { timeout: 20000, polling: 100 });
await new Promise((r) => setTimeout(r, 900));
await snap('ingame_arcbolt_windup');
await page.waitForFunction('window.__game.sim.player.castingAbility === null', { timeout: 30000, polling: 30 });
// snapshot the instant a live bolt exists (engine debug counters prove flight
// even when SwiftShader screenshot latency misses the frame)
await page.waitForFunction('(window.__abilityVfxLive?.bolts ?? 0) > 0', { timeout: 5000, polling: 16 }).catch(() => {});
const midFlight = await page.evaluate(() => ({ ...window.__abilityVfxLive }));
console.log('mid-flight counters:', JSON.stringify(midFlight));
await snap('ingame_arcbolt_flight');
await new Promise((r) => setTimeout(r, 300));
await snap('ingame_arcbolt_impact');
await new Promise((r) => setTimeout(r, 500));
await snap('ingame_arcbolt_residual');

// the rest of the level-1 kit through the new path: instant self-buff
// (rockbiter -> weapon-glow buff orbit) and a heal (healing wave -> glow ring)
await page.evaluate(() => window.__game.sim.castAbility('rockbiter_weapon'));
// the imbue aura should start a persistent orbit (aura-driven, 5 min duration)
await page.waitForFunction('(window.__abilityVfxLive?.buffs ?? 0) > 0', { timeout: 8000, polling: 100 }).catch(() => {});
const buffLive = await page.evaluate(() => ({ ...window.__abilityVfxLive }));
console.log('post-rockbiter counters:', JSON.stringify(buffLive));
await new Promise((r) => setTimeout(r, 1500));
await snap('ingame_rockbiter_buff');
await page.evaluate(() => window.__game.sim.castAbility('healing_wave'));
await page.waitForFunction('window.__game.sim.player.castingAbility === null', { timeout: 30000, polling: 30 });
await new Promise((r) => setTimeout(r, 300));
await snap('ingame_healing_wave');

const handled = await page.evaluate(() => window.__abilityVfxHandled ?? 0);
const live = await page.evaluate(() => ({ ...window.__abilityVfxLive }));
console.log('spec-path handled spellfx count:', handled);
console.log('engine counters:', JSON.stringify(live));
console.log(`done — ${bad} error(s); handled=${handled}; ribVMax=${live.ribVMax}; buffs=${live.buffs}`);
await browser.close();
process.exit(bad > 0 || handled < 1 || !(live.ribVMax > 0) || !(live.buffs > 0) ? 1 : 0);
