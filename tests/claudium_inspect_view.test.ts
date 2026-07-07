import { describe, expect, it } from 'vitest';
import { buildClaudiumInspectModel } from '../src/ui/claudium_inspect_view';
import { CLAUDIUM_USD_PEG, type ClaudiumStoreRow } from '../src/ui/claudium_view';

// The pure SKU-inspect view core: it projects one cosmetic-store row into the
// detail model the window paints BEFORE purchase (larger art, name, kind, Claudium
// price + USD equivalent, flavor text) and decides whether a local try-on is
// offered (only when the SKU carries a preview descriptor). It derives no prices.

function row(overrides: Partial<ClaudiumStoreRow> = {}): ClaudiumStoreRow {
  return {
    itemId: 'cosmetic_aurora',
    name: 'Aurora Cloak',
    kind: 'cosmetic',
    costClaudium: 2500,
    art: null,
    description: null,
    preview: null,
    ...overrides,
  };
}

describe('buildClaudiumInspectModel', () => {
  it('carries the SKU fields through verbatim and computes the USD equivalent at the peg', () => {
    const model = buildClaudiumInspectModel(
      row({
        art: '/ui/claudium/aurora.webp',
        description: 'Woven from the last light of a dying star.',
        kind: 'skin',
      }),
      0.02, // $0.02 per Claudium
    );
    expect(model.itemId).toBe('cosmetic_aurora');
    expect(model.name).toBe('Aurora Cloak');
    expect(model.kind).toBe('skin');
    expect(model.costClaudium).toBe(2500);
    // Pure peg multiply of the service integer: 2500 * 0.02 = 50.
    expect(model.costUsd).toBeCloseTo(50, 10);
    expect(model.art).toBe('/ui/claudium/aurora.webp');
    expect(model.description).toBe('Woven from the last light of a dying star.');
  });

  it('falls back to the default peg when usdPerClaudium is null', () => {
    const model = buildClaudiumInspectModel(row({ costClaudium: 100 }), null);
    expect(model.costUsd).toBeCloseTo(100 * CLAUDIUM_USD_PEG, 10);
  });

  it('offers a try-on only when the SKU carries a preview descriptor', () => {
    const withPreview = buildClaudiumInspectModel(
      row({ preview: { skin: 3, catalog: 'mech', mainhandItemId: 'wep_sunblade' } }),
      0.01,
    );
    expect(withPreview.canTryOn).toBe(true);
    expect(withPreview.preview).toEqual({
      skin: 3,
      catalog: 'mech',
      mainhandItemId: 'wep_sunblade',
    });

    const noPreview = buildClaudiumInspectModel(row(), 0.01);
    expect(noPreview.canTryOn).toBe(false);
    expect(noPreview.preview).toBeNull();
  });

  it('normalizes an omitted art / description / preview to null (no fabrication)', () => {
    // A row whose optional inspect fields were never populated by the service.
    const bare = {
      itemId: 'item_x',
      name: 'Mystery',
      kind: 'item',
      costClaudium: 10,
    } as unknown as ClaudiumStoreRow;
    const model = buildClaudiumInspectModel(bare, 0.01);
    expect(model.art).toBeNull();
    expect(model.description).toBeNull();
    expect(model.preview).toBeNull();
    expect(model.canTryOn).toBe(false);
  });
});
