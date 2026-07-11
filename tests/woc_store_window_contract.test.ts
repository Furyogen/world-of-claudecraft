import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const storeWindow = readFileSync(
  new URL('../src/ui/daily_rewards_window.ts', import.meta.url),
  'utf8',
);
const claudiumWindow = readFileSync(
  new URL('../src/ui/claudium_window.ts', import.meta.url),
  'utf8',
);
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('WOC Store window contract', () => {
  it('opens on the Store tab and keeps Daily Rewards as a sub-tab', () => {
    expect(storeWindow).toContain("private tab: 'store' | 'rewards' = 'store'");
    expect(storeWindow).toContain('data-woc-store-tab="store"');
    expect(storeWindow).toContain('data-woc-store-tab="rewards"');
  });

  it('offers a Claudium top-up when the selected skin is unaffordable', () => {
    const purchase = storeWindow.slice(storeWindow.indexOf('private requestArmoryPurchase'));
    expect(purchase).toContain('if (!row.affordable)');
    expect(purchase).toContain("t('hudChrome.wocStore.needMoreTitle')");
    expect(purchase).toContain('() => this.deps.openClaudium?.()');
  });

  it('marks owned skins and prevents another purchase attempt', () => {
    expect(storeWindow).toContain('armory-state');
    expect(storeWindow).toContain('if (row.owned || !row.purchasable) return;');
  });

  it('sells only the Season 1 Armory (no legacy cosmetics grid)', () => {
    expect(storeWindow).not.toContain('woc-store-grid');
    expect(storeWindow).not.toContain('storeCardHtml');
    expect(storeWindow).not.toContain('buildWocStoreRows');
  });

  it('keeps the Claudium window focused on currency purchases', () => {
    expect(claudiumWindow).not.toContain('private storeHtml(');
    expect(claudiumWindow).not.toContain('data-item=');
    expect(claudiumWindow).toContain('cl-pack-art');
    expect(claudiumWindow).toContain('/claudium/icons/stack_');
  });

  it('keeps storefront content mounted while a background refresh is loading', () => {
    expect(storeWindow).toContain('data-woc-store-loading');
    expect(storeWindow).toContain(
      "setAttribute('aria-busy', this.storeLoading ? 'true' : 'false')",
    );
    expect(storeWindow).not.toContain('if (this.storeLoading) {\n      body.innerHTML');
  });

  it('refreshes only store balance and catalog while the WOC Store is open', () => {
    const storeWiring = hud.slice(hud.indexOf('storeSnapshot: async () =>'));
    expect(storeWiring.slice(0, storeWiring.indexOf('spendStoreItem:'))).toContain(
      'this.claudiumHooks?.storeSnapshot()',
    );

    const hook = main.slice(main.indexOf('storeSnapshot: async () =>'));
    const storeSnapshot = hook.slice(0, hook.indexOf('snapshot: async () =>'));
    expect(storeSnapshot).toContain('economy.balance()');
    expect(storeSnapshot).toContain('economy.store()');
    expect(storeSnapshot).not.toContain('economy.skus()');
    expect(storeSnapshot).not.toContain("economy.price('woc')");
    expect(storeSnapshot).not.toContain('economy.nativePrice(');
  });
});
