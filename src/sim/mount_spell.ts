// Which mount the Summon Mount spell rides. The default mount (DEFAULT_MOUNT,
// the Valorsteed: the first mount anyone can buy) whenever the player owns it,
// its reins in bags or bank; a worn mount skin only changes how it LOOKS
// (content/mount_skins.ts). A rider who never bought it gets the fastest mount
// whose reins are in the bags, else the fastest banked one, the earlier catalog
// entry winning a speed tie. A pure leaf shared by the sim cast
// (mounts.ts castMountSpell) and the client icon (src/ui/mount_spell_icon_core.ts),
// so the spell's icon always shows the mount a press will summon. The bag scan
// allocates nothing: the HUD runs it per frame.

import { DEFAULT_MOUNT, MOUNT_KEYS, MOUNTS, type MountKey } from './content/mounts';
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
 *  read only when the bags hold no default-mount reins. */
export function mountSpellMountKey(
  bags: readonly { itemId: string }[],
  owned: () => readonly MountKey[],
): MountKey | null {
  let bagged: MountKey | null = null;
  for (const slot of bags) {
    const def = ITEMS[slot.itemId];
    if (def?.kind !== 'mount' || !isMountKey(def.mount)) continue;
    if (def.mount === DEFAULT_MOUNT) return DEFAULT_MOUNT;
    bagged = faster(bagged, def.mount);
  }
  const all = owned();
  if (all.includes(DEFAULT_MOUNT)) return DEFAULT_MOUNT;
  if (bagged !== null) return bagged;
  let banked: MountKey | null = null;
  for (const key of all) if (isMountKey(key)) banked = faster(banked, key);
  return banked;
}
