// The Summon Mount icon's image (the look comes from mount_spell_icon_core.ts):
// a worn skin draws its store art, the same painting the Cosmetics window and
// the store show; a mount draws its reins art, the same painting the bags show.

import { isMountSkinId } from '../sim/content/mount_skins';
import { DEFAULT_MOUNT } from '../sim/content/mounts';
import { mountItemId } from '../sim/mounts';
import { iconDataUrl } from './icons';
import { mountSkinArt } from './woc_store_view';

/** The image URL for a Summon Mount look (mountSpellLook's presentation key). */
export function mountSpellIconUrl(look: string): string {
  if (isMountSkinId(look)) return mountSkinArt(look);
  return iconDataUrl('item', mountItemId(look) ?? mountItemId(DEFAULT_MOUNT) ?? '');
}
