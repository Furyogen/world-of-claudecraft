import { describe, expect, it } from 'vitest';
import { WARRIOR_V024_HOTBAR_ADDITION_IDS } from '../src/sim/character_content_revision';
import { ABILITIES } from '../src/sim/data';
import type { HotbarAction } from '../src/ui/hotbar';
import {
  runStableWarriorHotbarMigration,
  stableWarriorHotbarMarkerKey,
} from '../src/ui/warrior_hotbar_migration';

class RecordingStorage {
  readonly values = new Map<string, string>();
  readonly calls: string[] = [];
  throwOnGet = false;
  throwOnSetKey: string | null = null;

  getItem(key: string): string | null {
    this.calls.push(`get:${key}`);
    if (this.throwOnGet) throw new Error('storage read failed');
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.calls.push(`set:${key}`);
    if (this.throwOnSetKey === key) throw new Error('storage write failed');
    this.values.set(key, value);
  }
}

const hotbarKey = 'woc_hotbar_warrior_Vanguard';
const markerKey = stableWarriorHotbarMarkerKey(hotbarKey);
const baseActions: HotbarAction[] = [
  { type: 'ability', id: 'heroic_strike' },
  { type: 'item', id: 'baked_bread' },
  { type: 'ability', id: 'retired_v023_spell' },
  null,
];

function run(storage: RecordingStorage, over: Record<string, unknown> = {}) {
  return runStableWarriorHotbarMigration({
    storage,
    playerClass: 'warrior',
    form: 'normal',
    hasStoredBar: true,
    hotbarKey,
    actions: baseActions,
    knownAbilityIds: ['heroic_strike', 'pummel'],
    additionIds: ['pummel'],
    ...over,
  });
}

describe('stable Warrior normal-bar migration coordinator', () => {
  it('derives the one-shot marker by appending the literal _v024 suffix', () => {
    // The marker key is persisted in every migrated player's localStorage;
    // changing the suffix would orphan those markers and re-run the migration
    // on bars the players already curated.
    expect(stableWarriorHotbarMarkerKey('woc_hotbar_warrior_Vanguard')).toBe(
      'woc_hotbar_warrior_Vanguard_v024',
    );
  });

  it('seeds only explicit castable additions, never passives or stance-bar abilities', () => {
    expect(WARRIOR_V024_HOTBAR_ADDITION_IDS).toContain('pummel');
    for (const id of WARRIOR_V024_HOTBAR_ADDITION_IDS) {
      expect(ABILITIES[id], id).toBeDefined();
      expect(ABILITIES[id]?.passive, id).not.toBe(true);
      expect(ABILITIES[id]?.exclusiveGroup, id).not.toBe('warrior_stance');
    }
  });

  it('writes the reconciled current bar before the one-shot marker', () => {
    const storage = new RecordingStorage();

    const result = run(storage);

    expect(result).toEqual({
      actions: [
        { type: 'ability', id: 'heroic_strike' },
        { type: 'item', id: 'baked_bread' },
        { type: 'ability', id: 'pummel' },
        null,
      ],
      changed: true,
      completed: true,
    });
    expect(storage.calls).toEqual([`get:${markerKey}`, `set:${hotbarKey}`, `set:${markerKey}`]);
    expect(storage.values.get(markerKey)).toBe('1');
  });

  it('does not read or write for another class/form or an incomplete mirror', () => {
    for (const over of [{ playerClass: 'mage' }, { form: 'sport' }, { knownAbilityIds: [] }]) {
      const storage = new RecordingStorage();
      expect(run(storage, over)).toEqual({
        actions: baseActions,
        changed: false,
        completed: false,
      });
      expect(storage.calls).toEqual([]);
    }
  });

  it('stamps the marker for a fresh bar so a later stored bar is never re-reconciled', () => {
    // First login of a post-v0.24 warrior (or a new device): the slot sync
    // seeds and saves the full kit, so there is nothing to migrate, but the
    // marker must still land or the SECOND login would re-insert additions
    // the player dragged off in session one.
    const storage = new RecordingStorage();
    expect(run(storage, { hasStoredBar: false })).toEqual({
      actions: baseActions,
      changed: false,
      completed: true,
    });
    expect(storage.calls).toEqual([`get:${markerKey}`, `set:${markerKey}`]);
    expect(storage.values.get(markerKey)).toBe('1');
  });

  it('honors an existing marker without reading any hotbar key', () => {
    const storage = new RecordingStorage();
    storage.values.set(markerKey, '1');

    expect(run(storage)).toEqual({ actions: baseActions, changed: false, completed: true });
    expect(storage.calls).toEqual([`get:${markerKey}`]);
  });

  it('fails closed when storage cannot be read or the reconciled bar cannot be saved', () => {
    const readFailure = new RecordingStorage();
    readFailure.throwOnGet = true;
    expect(run(readFailure)).toEqual({ actions: baseActions, changed: false, completed: false });
    expect(readFailure.calls).toEqual([`get:${markerKey}`]);

    const writeFailure = new RecordingStorage();
    writeFailure.throwOnSetKey = hotbarKey;
    expect(run(writeFailure)).toEqual({ actions: baseActions, changed: false, completed: false });
    expect(writeFailure.calls).toEqual([`get:${markerKey}`, `set:${hotbarKey}`]);
    expect(writeFailure.values.has(markerKey)).toBe(false);
  });

  it('returns the saved bar when only the marker write fails so a retry is idempotent', () => {
    const storage = new RecordingStorage();
    storage.throwOnSetKey = markerKey;

    const first = run(storage);
    expect(first.changed).toBe(true);
    expect(first.completed).toBe(false);
    expect(storage.values.get(hotbarKey)).toBe(JSON.stringify(first.actions));

    storage.calls.length = 0;
    const second = run(storage, { actions: first.actions });
    expect(second).toEqual({ actions: first.actions, changed: false, completed: false });
    expect(storage.calls).toEqual([`get:${markerKey}`, `set:${markerKey}`]);
  });
});
