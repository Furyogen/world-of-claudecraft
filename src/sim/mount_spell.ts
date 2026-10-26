// Which mount the Summon Mount spell rides: the fastest mount the player owns
// (reins in bags or bank, src/sim/mounts.ts ownedMounts), the earlier catalog
// entry winning a speed tie. A pure leaf shared by the sim cast
// (mounts.ts castMountSpell) and the client icon (src/ui/mount_spell_icon.ts),
// so the spell's icon always shows the mount the press will summon.

import { MOUNTS, type MountKey } from './content/mounts';

/** The mount a Summon Mount press summons, or null when nothing is owned.
 *  `owned` is in catalog order, as ownedMounts() returns it. */
export function mountSpellMountKey(owned: readonly MountKey[]): MountKey | null {
  let best: MountKey | null = null;
  for (const key of owned) {
    const def = MOUNTS[key];
    if (!def) continue;
    if (best === null || def.moveSpeedPct > MOUNTS[best].moveSpeedPct) best = key;
  }
  return best;
}
