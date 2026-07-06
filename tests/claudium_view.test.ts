import { describe, expect, it } from 'vitest';
import { buildClaudiumView, type ClaudiumViewInput } from '../src/ui/claudium_view';

// The pure Claudium view core is DOM/i18n/net-free, so it drives directly here.
// Two states matter: a funded state (service on) and the service-off disabled
// state (balance null). The core recomputes NOTHING; it only projects the
// service payloads into render rows + per-rail availability.

const funded: ClaudiumViewInput = {
  balance: 1250,
  skus: [
    { sku: 's1', usd: 1, claudium: 100 },
    { sku: 's10', usd: 10, claudium: 1000 },
    { sku: 's100', usd: 100, claudium: 10000 },
  ],
  price: { usdPerClaudium: 0.01, wocBaseUnitsPerClaudium: 42 },
  storeItems: [
    { itemId: 'hat', name: 'Golden Hat', kind: 'cosmetic', costClaudium: 500 },
    { itemId: 'skin', name: 'Ember Skin', kind: 'skin', costClaudium: 2000 },
  ],
};

describe('buildClaudiumView disabled state (service off)', () => {
  it('renders a clean empty state when balance is null, not an error', () => {
    const view = buildClaudiumView({
      balance: null,
      skus: [],
      price: { usdPerClaudium: null, wocBaseUnitsPerClaudium: null },
      storeItems: [],
    });
    expect(view.disabled).toBe(true);
    expect(view.hasBalance).toBe(false);
    expect(view.balance).toBeNull();
    expect(view.buyRows).toEqual([]);
    expect(view.storeRows).toEqual([]);
    expect(view.rails).toEqual({ stripe: false, woc: false });
    expect(view.buyDisabled).toBe(true);
  });

  it('stays disabled even if skus/price somehow arrive with a null balance', () => {
    // A null balance is authoritative: the service is off, so nothing transacts.
    const view = buildClaudiumView({
      balance: null,
      skus: [{ sku: 's1', usd: 1, claudium: 100 }],
      price: { usdPerClaudium: 0.01, wocBaseUnitsPerClaudium: 42 },
      storeItems: [{ itemId: 'hat', name: 'Hat', kind: 'cosmetic', costClaudium: 500 }],
    });
    expect(view.disabled).toBe(true);
    expect(view.buyRows).toEqual([]);
    expect(view.storeRows).toEqual([]);
    expect(view.buyDisabled).toBe(true);
  });
});

describe('buildClaudiumView funded state (service on)', () => {
  it('maps the SKU ladder verbatim into buy rows', () => {
    const view = buildClaudiumView(funded);
    expect(view.disabled).toBe(false);
    expect(view.hasBalance).toBe(true);
    expect(view.balance).toBe(1250);
    expect(view.buyRows).toEqual([
      { sku: 's1', usd: 1, claudium: 100 },
      { sku: 's10', usd: 10, claudium: 1000 },
      { sku: 's100', usd: 100, claudium: 10000 },
    ]);
  });

  it('maps the store catalog verbatim into store rows', () => {
    const view = buildClaudiumView(funded);
    expect(view.storeRows).toEqual([
      { itemId: 'hat', name: 'Golden Hat', kind: 'cosmetic', costClaudium: 500 },
      { itemId: 'skin', name: 'Ember Skin', kind: 'skin', costClaudium: 2000 },
    ]);
  });

  it('enables both rails when there are skus and the woc oracle price is present', () => {
    const view = buildClaudiumView(funded);
    expect(view.rails).toEqual({ stripe: true, woc: true });
    expect(view.buyDisabled).toBe(false);
  });

  it('disables the woc rail when the oracle price is null (oracle down)', () => {
    const view = buildClaudiumView({
      ...funded,
      price: { usdPerClaudium: 0.01, wocBaseUnitsPerClaudium: null },
    });
    expect(view.rails).toEqual({ stripe: true, woc: false });
    // Stripe still works, so buying is not disabled.
    expect(view.buyDisabled).toBe(false);
  });

  it('disables both rails when there are no skus (stripe needs a rung, woc needs both)', () => {
    const view = buildClaudiumView({ ...funded, skus: [] });
    expect(view.rails).toEqual({ stripe: false, woc: false });
    expect(view.buyDisabled).toBe(true);
    // A zero balance is still a funded (known) state, distinct from the null/off state.
  });

  it('treats a zero balance as a known funded state, not the disabled state', () => {
    const view = buildClaudiumView({ ...funded, balance: 0 });
    expect(view.disabled).toBe(false);
    expect(view.hasBalance).toBe(true);
    expect(view.balance).toBe(0);
  });
});

describe('buildClaudiumView is a pure projection', () => {
  it('returns identical structure for identical input (no hidden state)', () => {
    expect(buildClaudiumView(funded)).toEqual(buildClaudiumView(funded));
  });
});
