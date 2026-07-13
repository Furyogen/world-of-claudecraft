// Editor -> game play-test handoff. Stashes a WorldContent (built from the current
// CustomMap via custom_map.customMapToWorldContent) in sessionStorage and navigates
// to the game page, which boots OFFLINE into that world (see game/editor_playtest.ts
// + main.ts). Offline-only: playtest never talks to the server.

import { EDITOR_PLAYTEST_KEY } from '../game/editor_playtest';
import { encodeBiomePaintIdsRle } from '../sim/map_doc';
import type { WorldContent } from '../sim/types';
import type { CustomMap } from './custom_map';
import { parseMap, serializeMapCompact } from './persist';

// The game's fixed offline world seed: using it makes the play-test heightfield
// match what the editor previews for the built-in terrain.
export const DEFAULT_PLAYTEST_SEED = 20061;

// sessionStorage key holding the meta.id of the map that launched the last
// playtest in this tab. The editor writes it on launch (after a full local
// save) and reads it on boot, so the game's "Back to Editor" button lands on
// the same map instead of a blank document.
export const PLAYTEST_RESUME_KEY = 'woc_editor_playtest_resume';

// Full editor-document recovery for the rare case where the local map store is
// unavailable during launch. The game still receives WorldContent below; this
// copy is only for the editor if the user comes back from a failed navigation.
export const PLAYTEST_RECOVERY_KEY = 'woc_editor_playtest_recovery';

export interface PlaytestOptions {
  seed: number;
  playerClass: string;
  playerName: string;
}

// A fine paint grid's plain ids array is several MB of JSON — past the
// sessionStorage quota ("storage blocked" on Playtest). Ship it run-length
// encoded (shared codec in sim/map_doc); the game-side reader expands it
// before the world boots. Small grids stay plain.
const IDS_RLE_MIN = 4096;

export function savePlaytestRecoveryDraft(map: CustomMap): boolean {
  try {
    sessionStorage.setItem(PLAYTEST_RECOVERY_KEY, serializeMapCompact(map));
    return true;
  } catch {
    return false;
  }
}

export function loadPlaytestRecoveryDraft(): CustomMap | null {
  try {
    const raw = sessionStorage.getItem(PLAYTEST_RECOVERY_KEY);
    return raw ? parseMap(raw) : null;
  } catch {
    return null;
  }
}

export function clearPlaytestRecoveryDraft(mapId?: string): void {
  try {
    if (mapId) {
      const map = loadPlaytestRecoveryDraft();
      if (map && map.meta.id !== mapId) return;
    }
    sessionStorage.removeItem(PLAYTEST_RECOVERY_KEY);
  } catch {
    // Blocked storage: a stale recovery draft is harmless.
  }
}

// Stash the world and navigate to the game. Returns false if storage is blocked
// (the caller can surface that); navigation is skipped so the editor stays put.
export function launchPlaytest(world: WorldContent, opts: PlaytestOptions): boolean {
  let content: unknown = world;
  const bp = world.biomePaint;
  if (bp && Array.isArray(bp.ids) && bp.ids.length >= IDS_RLE_MIN) {
    const { ids, ...rest } = bp;
    content = { ...world, biomePaint: { ...rest, idsRle: encodeBiomePaintIdsRle(ids) } };
  }
  const payload = JSON.stringify({
    content,
    seed: opts.seed,
    playerClass: opts.playerClass,
    playerName: opts.playerName,
  });
  let stored = false;
  try {
    sessionStorage.setItem(EDITOR_PLAYTEST_KEY, payload);
    stored = true;
  } catch {
    stored = false;
  }
  if (stored) window.location.href = '/index.html';
  return stored;
}
