// Which mount the Summon Mount spell rides: the fastest mount whose reins are in
// the player's BAGS (the reins a bag click would use), the earlier catalog entry
// winning a speed tie; only when the bags hold none, the fastest banked one (a
// banked reins still owns its mount, src/sim/mounts.ts mountOwned). A pure leaf
// shared by the sim cast (mounts.ts castMountSpell) and the client icon
// (src/ui/mount_spell_icon_core.ts), so the spell's icon always shows the mount
// a press will summon. The bag scan allocates nothing: the HUD runs it per frame.

import { MOUNT_KEYS, MOUNTS, type MountKey } from './content/mounts';
import { ITEMS } from './data';

const CATALOG_ORDER = new Map<MountKey, number>(MOUNT_KEYS.map((key, i) => [key, i]));

function isMountKey(key: string): key is MountKey {
  return Object.hasOwn(MOUNTS, key);
}

/** The faster of two mounts; on a tie, the earlier catalog entry. */
function faster(best: MountKey | null, key: MountKey): MountKey {
  if (best === null) return key;
  const a = MOUNTS[best].moveSpeedPct;
  const b = MOUNTS[key].moveSpeedPct;
  if (a !== b) return b > a ? key : best;
  return (CATALOG_ORDER.get(key) ?? 0) < (CATALOG_ORDER.get(best) ?? 0) ? key : best;
}

/** The mount a Summon Mount press summons, or null when nothing is owned.
 *  `bags` is the player's bag inventory; `owned` (bags + bank, ownedMounts) is
 *  read only when the bags hold no reins. */
export function mountSpellMountKey(
  bags: readonly { itemId: string }[],
  owned: () => readonly MountKey[],
): MountKey | null {
  let best: MountKey | null = null;
  for (const slot of bags) {
    const def = ITEMS[slot.itemId];
    if (def?.kind === 'mount' && isMountKey(def.mount)) best = faster(best, def.mount);
  }
  if (best !== null) return best;
  for (const key of owned()) if (isMountKey(key)) best = faster(best, key);
  return best;
}
