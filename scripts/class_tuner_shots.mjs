// Local capture tool for the Class Power Tuner admin page (docs/balance/
// class-power-tuner.md and its PDF). Shoots the real Svelte dashboard against a
// REAL server serving the REAL GET/POST /admin/api/class-tuning endpoints, so
// every slider, value readout and badge in the documentation is what an
// operator actually sees rather than a mockup.
//
// Dev-only, not wired into any npm script or CI gate. Needs:
//   - a Postgres the server can reach (npm run db:up, or a local cluster)
//   - a server started on SERVER_URL, with an account holding the `tuner` role:
//       node scripts/grant_admin.mjs <username> --roles tuner
//   - a vite dev client on GAME_URL with WOC_DEV_API_TARGET pointed at SERVER_URL
//
// Usage:
//   GAME_URL=http://127.0.0.1:5195 SERVER_URL=http://127.0.0.1:8791 \
//     ADMIN_USER=balancelead ADMIN_PASS='...' \
//     SHOTS_DIR=docs/screenshots/class-power-tuner \
//     node scripts/class_tuner_shots.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { assertLoopbackUrl } from './lib/loopback_guard.mjs';

const GAME_URL = process.env.GAME_URL ?? 'http://127.0.0.1:5195';
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8791';
const ADMIN_USER = process.env.ADMIN_USER ?? 'balancelead';
const ADMIN_PASS = process.env.ADMIN_PASS ?? '';
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots/class-power-tuner';

// This script mints an admin bearer into localStorage on GAME_URL and posts a
// tuning document, so both targets must be loopback (the mob_stall_repro.mjs
// policy shared by every account-touching capture script here).
assertLoopbackUrl(SERVER_URL, 'SERVER_URL');
assertLoopbackUrl(GAME_URL, 'GAME_URL');

const DESKTOP = { width: 1600, height: 1200, deviceScaleFactor: 1 };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adminToken() {
  const res = await fetch(`${SERVER_URL}/admin/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const body = await res.json();
  if (!body?.data?.token) throw new Error(`admin login failed: ${JSON.stringify(body)}`);
  return body.data.token;
}

/** Put the realm back to shipped numbers so a re-run starts from a clean page. */
async function resetTuning(token) {
  await fetch(`${SERVER_URL}/admin/api/class-tuning`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ document: { version: 1, abilities: {} }, note: 'capture reset' }),
  });
}

async function shoot(page, name) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`[shot] ${OUT}/${name}.png`);
}

async function openTuner(page, token, viewport) {
  await page.setViewport(viewport);
  await page.goto(`${GAME_URL}/admin.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('claudecraft_admin_token', t);
    localStorage.setItem('claudecraft_admin_name', 'balancelead');
  }, token);
  await page.goto(`${GAME_URL}/admin.html?page=class-tuning`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('Class Power Tuner'), {
    timeout: 30_000,
  });
  await sleep(600);
}

/** Click the class tab whose label matches, then let the list settle. */
async function selectClass(page, className) {
  const clicked = await page.evaluate((name) => {
    const tab = [...document.querySelectorAll('button.class-tab')].find(
      (b) => b.textContent.trim().split(/\s+/)[0] === name,
    );
    if (!tab) return false;
    tab.click();
    return true;
  }, className);
  if (!clicked) throw new Error(`class tab not found: ${className}`);
  await sleep(500);
}

/** Open the Weapons window, the tab that sits after the nine class tabs. */
async function selectWeapons(page) {
  const clicked = await page.evaluate(() => {
    const tab = document.querySelector('button.weapons-tab');
    if (!tab) return false;
    tab.click();
    return true;
  });
  if (!clicked) throw new Error('weapons tab not found');
  await sleep(500);
}

/** Click a spec tab inside the open class window by its position (0 = All specs). */
async function selectSpec(page, index) {
  const label = await page.evaluate((i) => {
    const tabs = [...document.querySelectorAll('button.spec-tab')];
    if (!tabs[i]) return null;
    tabs[i].click();
    return tabs[i].textContent.trim();
  }, index);
  if (label === null) throw new Error(`spec tab ${index} not found`);
  await sleep(500);
  return label;
}

async function search(page, needle) {
  await page.evaluate((value) => {
    const input = document.querySelector('input[type="search"]');
    if (!input) throw new Error('search input missing');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, needle);
  await sleep(400);
}

/** Drag one slider by setting its value the way a real input event would. */
async function moveSlider(page, abilityId, channel, factor) {
  await page.evaluate(
    (id, ch, value) => {
      const input = document.getElementById(`slider-${id}-${ch}`);
      if (!input) throw new Error(`slider missing: ${id}/${ch}`);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    abilityId,
    channel,
    factor,
  );
  await sleep(300);
}

async function main() {
  const token = await adminToken();
  await resetTuning(token);

  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();

  try {
    // 1. The page as an operator first sees it: every class window, druid open.
    await openTuner(page, token, DESKTOP);
    await selectClass(page, 'Druid');
    await shoot(page, '01-overview-druid');

    // 2. The worked example from the brief: druid Briarguard's reflect damage.
    await search(page, 'briar');
    await shoot(page, '02-druid-thorns-shipped');
    await moveSlider(page, 'thorns', 'damage_reflect', 0.7);
    await shoot(page, '03-druid-thorns-nerfed');

    // 3. A multi-aspect ability: every channel one spell exposes at once.
    await search(page, 'moonfire');
    await shoot(page, '04-druid-moonfire-channels');

    // 4. A spec filter inside a class window: the first real spec, not "All specs".
    await selectClass(page, 'Warrior');
    await search(page, '');
    console.log(`[spec] warrior spec tab: ${await selectSpec(page, 1)}`);
    await shoot(page, '05-warrior-spec-filter');

    // 5. A healer class, to show the heal/HoT/absorb channels.
    await selectClass(page, 'Priest');
    await search(page, 'heal');
    await shoot(page, '06-priest-heal-channels');

    // 6. The two reworked classes the tuner exists to rebalance against.
    await selectClass(page, 'Mage');
    await search(page, 'fire');
    await shoot(page, '07-mage-overview');

    // 7. Save, so the pending-restart badge and the audit trail are real.
    await page.evaluate(() => {
      const note = document.querySelector('input[type="text"]');
      if (!note) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(note, 'Trim druid Briarguard reflect by 30% (capture)');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(200);
    await page.evaluate(() => {
      const save = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === 'Save tuning',
      );
      save?.click();
    });
    await sleep(1500);
    await selectClass(page, 'Druid');
    await search(page, 'briar');
    await shoot(page, '08-saved-pending-restart');

    // 8. The change history, expanded.
    await page.evaluate(() => {
      const panel = [...document.querySelectorAll('details')].find((d) =>
        d.textContent.includes('Change history'),
      );
      if (panel) panel.open = true;
    });
    await sleep(500);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(300);
    await shoot(page, '09-change-history');

    // 9. The Weapons window: auto-attack damage and swing timer per weapon.
    await selectWeapons(page);
    await shoot(page, '12-weapons-overview');
    await search(page, 'shortsword');
    await shoot(page, '13-weapon-shipped');
    await moveSlider(page, 'worn_sword', 'swing_damage', 1.6);
    await moveSlider(page, 'worn_sword', 'swing_speed', 1.3);
    await shoot(page, '14-weapon-tuned');
    // A class's own ranged profile (hunter Auto Shot, caster wands) is kit, not loot.
    await search(page, 'hunter');
    await shoot(page, '15-weapon-class-ranged');

    // 10. Mobile: the operator surface has to work on a phone too.
    await openTuner(page, token, MOBILE);
    await selectClass(page, 'Druid');
    await shoot(page, '10-mobile-overview');
    await search(page, 'briar');
    await shoot(page, '11-mobile-ability-card');

    // Leave the realm as we found it.
    await resetTuning(token);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
