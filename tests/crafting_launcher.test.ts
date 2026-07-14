// Source-guard suite for the Crafting window launchers (issue #1865, the
// deeds_window.test.ts pattern): the desktop micro-menu button and the mobile
// More-tray button in BOTH entry HTMLs, the hud.ts click + keycap wiring, the
// mobile callback chain, the T-keybind dispatch that must keep working, the
// ui_icons glyph, and the reused i18n key. Behavior of the crafting window
// itself is covered in tests/crafting_view.test.ts; these pins keep the
// launchers honest.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

const hud = read('../src/ui/hud.ts');
const mainSrc = read('../src/main.ts');
const mobileControlsSrc = read('../src/game/mobile_controls.ts');
const keybindsSrc = read('../src/game/keybinds.ts');
const uiIcons = read('../src/ui/ui_icons.ts');
const chrome = read('../src/ui/i18n.catalog/hud_chrome.ts');
const indexHtml = read('../index.html');
const playHtml = read('../play.html');

describe('desktop micro-menu launcher', () => {
  it('ships the side-menu Crafting button in BOTH game entries, under Bags', () => {
    for (const html of [indexHtml, playHtml]) {
      expect(html).toMatch(/id="mm-crafting"[^>]*data-icon="crafting"/);
      expect(html).toMatch(/id="mm-crafting"[^>]*data-i18n-title="hudChrome\.crafting\.title"/);
      // Dock order: bags, then crafting, then the arena activity cluster.
      const bag = html.indexOf('id="mm-bag"');
      const crafting = html.indexOf('id="mm-crafting"');
      const arena = html.indexOf('id="mm-arena"');
      expect(bag).toBeGreaterThan(-1);
      expect(crafting).toBeGreaterThan(bag);
      expect(arena).toBeGreaterThan(crafting);
    }
  });

  it('binds the click and repaints the keycap from the live binding', () => {
    expect(hud).toContain(
      "$('#mm-crafting').addEventListener('click', () => this.toggleCrafting());",
    );
    expect(hud).toContain("['#mm-crafting', 'crafting', 'hudChrome.crafting.title'],");
  });
});

describe('mobile More-tray launcher', () => {
  it('ships the More-tray Crafting button in BOTH game entries (the /play shared-entry trap)', () => {
    for (const html of [indexHtml, playHtml]) {
      expect(html).toMatch(/id="mobile-crafting"[^>]*data-icon="crafting"/);
      expect(html).toMatch(/id="mobile-crafting"[^>]*data-i18n-title="hudChrome\.crafting\.title"/);
      // Tray order mirrors the desktop rationale: right after Bags.
      const bags = html.indexOf('id="mobile-bags"');
      const crafting = html.indexOf('id="mobile-crafting"');
      const spellbook = html.indexOf('id="mobile-spellbook"');
      expect(bags).toBeGreaterThan(-1);
      expect(crafting).toBeGreaterThan(bags);
      expect(spellbook).toBeGreaterThan(crafting);
    }
  });

  it('routes the tray tap through the MobileControls callback chain', () => {
    expect(mobileControlsSrc).toContain('onCrafting(): void;');
    expect(mobileControlsSrc).toContain(
      "this.bindButton('mobile-crafting', () => this.callbacks.onCrafting());",
    );
    expect(mainSrc).toContain('onCrafting: () => hud.toggleCrafting(),');
  });
});

describe('shared behavior across all screen sizes', () => {
  it('keeps the T keybind path unchanged (both launchers toggle the same window)', () => {
    expect(keybindsSrc).toContain(
      "{ id: 'crafting', label: 'Crafting', category: 'Interface', kind: 'edge', defaults: ['KeyT'] },",
    );
    expect(mainSrc).toContain("case 'crafting':");
  });

  it('registers the crafting glyph so hydrateIcons does not silently skip it', () => {
    expect(uiIcons).toMatch(/\|\s*'crafting';/);
    expect(uiIcons).toMatch(/crafting:\n?\s*'<path /);
  });

  it('reuses the already-translated crafting window title for every launcher label', () => {
    expect(chrome).toContain("title: 'Crafting',");
    // Both surfaces and the mobile label span all read the same key, so the
    // desktop tooltip and the tray caption can never drift apart.
    for (const html of [indexHtml, playHtml]) {
      expect(html).toMatch(
        /id="mobile-crafting"[^>]*>\s*<span class="mobile-label" data-i18n="hudChrome\.crafting\.title">/,
      );
    }
  });
});
