import { type HotbarAction, reconcileStableWarriorHotbar } from './hotbar';

export interface HotbarMigrationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StableWarriorHotbarMigrationInput {
  storage: HotbarMigrationStorage | null;
  playerClass: string;
  form: string;
  hasStoredBar: boolean;
  hotbarKey: string;
  actions: readonly HotbarAction[];
  knownAbilityIds: readonly string[];
  additionIds: readonly string[];
}

export interface StableWarriorHotbarMigrationResult {
  actions: HotbarAction[];
  changed: boolean;
  completed: boolean;
}

export function stableWarriorHotbarMarkerKey(hotbarKey: string): string {
  return `${hotbarKey}_v024`;
}

function unchanged(
  actions: readonly HotbarAction[],
  completed = false,
): StableWarriorHotbarMigrationResult {
  return { actions: [...actions], changed: false, completed };
}

// Coordinates the one-shot browser-local stable-Warrior normal-bar migration.
// It never reads the bar itself: Hud has already loaded the current character's
// normal key and supplies that parsed layout. The reconciled bar is persisted
// before its marker so a failed write remains safely retryable.
export function runStableWarriorHotbarMigration(
  input: StableWarriorHotbarMigrationInput,
): StableWarriorHotbarMigrationResult {
  if (
    input.playerClass !== 'warrior' ||
    input.form !== 'normal' ||
    !input.storage ||
    input.knownAbilityIds.length === 0
  ) {
    return unchanged(input.actions);
  }

  const markerKey = stableWarriorHotbarMarkerKey(input.hotbarKey);
  try {
    if (input.storage.getItem(markerKey) === '1') return unchanged(input.actions, true);
  } catch {
    return unchanged(input.actions);
  }

  if (!input.hasStoredBar) {
    // Nothing to migrate on a fresh bar: the slot sync seeds the full current
    // kit and saves it. Stamp the marker now so the NEXT login's stored bar
    // (already v0.24-native) is never re-reconciled, which would resurrect
    // additions the player deliberately dragged off in their first session.
    try {
      input.storage.setItem(markerKey, '1');
    } catch {
      return unchanged(input.actions);
    }
    return unchanged(input.actions, true);
  }

  const reconciled = reconcileStableWarriorHotbar(
    input.actions,
    input.knownAbilityIds,
    input.additionIds,
  );
  if (reconciled.changed) {
    try {
      input.storage.setItem(input.hotbarKey, JSON.stringify(reconciled.actions));
    } catch {
      return unchanged(input.actions);
    }
  }

  try {
    input.storage.setItem(markerKey, '1');
  } catch {
    return { ...reconciled, completed: false };
  }
  return { ...reconciled, completed: true };
}
