// What the Summon Mount spell's icon shows (src/sim/content/mount_spell.ts):
// the worn mount skin when the rider wears one, else the mount a press will
// summon (src/sim/mount_spell.ts mountSpellMountKey: the fastest reins in the
// bags, else in the bank), else the default mount for a rider who owns none.
// The result is a mount PRESENTATION key (mountPresentationKey: a skin id or a
// mount key), the same key the model, sound, and cast bar resolve, so the icon
// never disagrees with what appears.
//
// DOM-free and i18n-free; the URL half lives in mount_spell_icon.ts.

import { mountPresentationKey } from '../sim/content/mount_skins';
import { DEFAULT_MOUNT, type MountKey } from '../sim/content/mounts';
import { mountSpellMountKey } from '../sim/mount_spell';

/** Action-bar icon-key prefix for the Summon Mount slot (action_bar_view.ts):
 *  the key carries the look, so a skin change repaints the slot by itself. */
export const MOUNT_SPELL_ICON_PREFIX = 'mountspell:';

/** The presentation key the Summon Mount icon draws. */
export function mountSpellLook(
  mountSkinId: string | null | undefined,
  bags: readonly { itemId: string }[],
  ownedMounts: () => readonly MountKey[],
): string {
  const summoned = mountSpellMountKey(bags, ownedMounts) ?? DEFAULT_MOUNT;
  return mountPresentationKey(summoned, mountSkinId);
}

/** The action-bar icon key for the Summon Mount slot. */
export function mountSpellIconKey(look: string): string {
  return `${MOUNT_SPELL_ICON_PREFIX}${look}`;
}
