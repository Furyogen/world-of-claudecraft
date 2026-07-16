// Registry of the dungeons whose interiors use the authored room-graph seam
// (DungeonLayout.rooms/doors/barriers/decor) and are therefore editable in the
// editor's dungeon mode. Legacy pillar/tomb interiors (crypt, sanctum, temple,
// arena, nythraxis) stay code-authored and are deliberately not listed.
import { DUNGEONS, instanceOrigin } from '../../sim/data';
import type { DungeonLayout } from '../../sim/dungeon_layout';
import { INFERNAL_ABYSS_LAYOUT } from '../../sim/dungeon_layout';

export interface AuthoredDungeonEntry {
  /** DungeonDef id (sim/data DUNGEONS key). */
  id: string;
  /** DungeonDef.interior key the renderer/collider builders dispatch on. */
  interior: string;
  /** Exported const name in src/sim/dungeon_layout.ts the save endpoint rewrites. */
  constName: string;
  layout: DungeonLayout;
}

export const AUTHORED_DUNGEONS: readonly AuthoredDungeonEntry[] = [
  {
    id: 'infernal_abyss',
    interior: 'infernal_abyss',
    constName: 'INFERNAL_ABYSS_LAYOUT',
    layout: INFERNAL_ABYSS_LAYOUT,
  },
];

/** Instance-space origin of the first slot of an authored dungeon: where the
 *  editor camera flies and the coordinate frame edits happen in. */
export function authoredDungeonOrigin(entry: AuthoredDungeonEntry): { x: number; z: number } {
  const def = DUNGEONS[entry.id];
  return instanceOrigin(def.index, 0);
}
