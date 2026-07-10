// Pure, host-agnostic view model for the talents window.
//
// The UI edits a local staged TalentAllocation and this core projects only the
// contract surface the painter needs: specialization selection, choice-row counts,
// and whether the staged allocation validates at the player's current level.

import { CHOICE_ROW_LEVELS } from '../sim/content/choice_rows';
import {
  type SpecDef,
  type TalentAllocation,
  talentsFor,
  validateAllocation,
} from '../sim/content/talents';
import type { PlayerClass } from '../sim/types';

// Deprecated tree-layout exports kept inert while non-UI lanes remove old tests.
export const TALENT_CELL_W = 86;
export const TALENT_CELL_H = 70;
export const TALENT_NODE_SIZE = 46;
export const TALENT_TOP_PAD = 6;

export interface TalentSpecVM {
  spec: SpecDef;
  selected: boolean;
}

export interface TalentsView {
  specs: TalentSpecVM[];
  rowsPicked: number;
  rowsUnlocked: number;
  valid: boolean;
}

function pickedRows(stage: TalentAllocation): number {
  let count = 0;
  for (const level of CHOICE_ROW_LEVELS) {
    if (stage.rows?.[level]) count++;
  }
  return count;
}

function unlockedRows(playerLevel: number): number {
  return CHOICE_ROW_LEVELS.filter((level) => level <= playerLevel).length;
}

export function buildTalentsView(
  stage: TalentAllocation,
  cls: PlayerClass,
  playerLevel: number,
): TalentsView {
  const ct = talentsFor(cls);
  return {
    specs: (ct?.specs ?? []).map((spec) => ({ spec, selected: stage.spec === spec.id })),
    rowsPicked: pickedRows(stage),
    rowsUnlocked: unlockedRows(playerLevel),
    valid: validateAllocation(cls, stage, playerLevel).ok,
  };
}
