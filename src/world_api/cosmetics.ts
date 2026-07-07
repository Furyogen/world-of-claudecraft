export interface AccountCosmetics {
  completedQuestIds: string[];
  mechChromaIds: string[];
}

/**
 * A local try-on appearance descriptor: the skin index + catalog + held-weapon
 * model to show on the player's own character WITHOUT owning it. It is a pure
 * data shape (the seam stays string-free of any i18n/DOM): the store hands one to
 * previewCosmetic to preview a cosmetic or weapon skin, and clearCosmeticPreview
 * reverts. It grants nothing and never persists.
 */
export interface CosmeticPreview {
  skin: number;
  catalog: 'class' | 'mech';
  mainhandItemId: string | null;
}

export interface IWorldCosmetics {
  accountCosmetics: AccountCosmetics;
  changeSkin(skin: number, catalog?: 'class' | 'mech'): void;
  // Lock in a skin from the cosmetic skin-select event overlay. The server
  // re-validates the choice against the rank it rolled (skinEvent) and consumes
  // the event token; the offline Sim resolves it directly.
  claimEventSkin(skin: number): void;
  unequipMechChroma(chromaId: string): void;
  /**
   * Locally preview a cosmetic / weapon skin on the player's own character model
   * WITHOUT owning it: it writes only the render-only appearance fields on the
   * local player entity (skin, skinCatalog, mainhand weapon model), backing up the
   * real appearance on the first call. It grants NO ownership, sends NO command,
   * and does NOT persist (the offline Sim never touches saved meta; the online
   * ClientWorld never sends a wire command). clearCosmeticPreview restores the
   * real appearance; the preview also reverts on window close, purchase, or logout.
   */
  previewCosmetic(preview: CosmeticPreview): void;
  /** Revert any active try-on preview, restoring the real (owned) appearance. */
  clearCosmeticPreview(): void;
}
