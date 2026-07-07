// Pure, host-agnostic view model for the CLAUDIUM cosmetic-store SKU inspect
// detail view (shown BEFORE purchase) and the local try-on preview descriptor.
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md
// Conventions; reference claudium_view.ts / vendor_view.ts). It projects one
// cosmetic-store row into the detail model the window paints: the larger art, the
// name, the kind, the Claudium price plus its USD equivalent at the display peg,
// and any flavor/description the SKU payload carried. It also decides whether a
// local try-on is offered (only when the SKU carries a preview appearance
// descriptor). DOM-free and i18n-free so tests/claudium_inspect_view.test.ts
// drives it directly; it derives no prices (the service owns them), only projects.

import type { CosmeticPreview } from '../world_api/cosmetics';
import { type ClaudiumStoreRow, claudiumToUsd } from './claudium_view';

export type { CosmeticPreview };

/** The detail model for one inspected cosmetic-store SKU. */
export interface ClaudiumInspectModel {
  itemId: string;
  name: string;
  kind: 'cosmetic' | 'skin' | 'item';
  /** The Claudium cost, carried through verbatim from the service. */
  costClaudium: number;
  /** The USD equivalent at the display peg (a number the consumer formats). */
  costUsd: number;
  /** The larger art URL the SKU carried, or null when it carried none. */
  art: string | null;
  /** The flavor/description the SKU carried, or null when it carried none. */
  description: string | null;
  /** The try-on appearance descriptor, or null when this SKU cannot be previewed. */
  preview: CosmeticPreview | null;
  /** True only when a try-on preview is available (the SKU carried a descriptor). */
  canTryOn: boolean;
}

/**
 * Project a cosmetic-store row into the inspect detail model. The USD equivalent
 * is the ONLY arithmetic (claudiumToUsd, a pure peg multiply of a service integer);
 * everything else is carried through verbatim. A SKU with no preview descriptor is
 * not try-on-able (canTryOn=false, preview=null), so the window offers no try-on.
 */
export function buildClaudiumInspectModel(
  row: ClaudiumStoreRow,
  usdPerClaudium: number | null,
): ClaudiumInspectModel {
  const preview = row.preview ?? null;
  return {
    itemId: row.itemId,
    name: row.name,
    kind: row.kind,
    costClaudium: row.costClaudium,
    costUsd: claudiumToUsd(row.costClaudium, usdPerClaudium),
    art: row.art ?? null,
    description: row.description ?? null,
    preview,
    canTryOn: preview !== null,
  };
}
