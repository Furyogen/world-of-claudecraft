import { describe, expect, it } from 'vitest';
import {
  CHOICE_ROW_LEVELS,
  CHOICE_ROWS,
  type ChoiceRowAllocation,
} from '../src/sim/content/choice_rows';
import {
  cloneAllocation,
  emptyAllocation,
  type TalentAllocation,
  talentsFor,
  validateAllocation,
} from '../src/sim/content/talents';
import type { PlayerClass } from '../src/sim/types';
import { buildTalentsView } from '../src/ui/talents_view';

const CLS: PlayerClass = 'warrior';

const alloc = (over: Partial<TalentAllocation> = {}): TalentAllocation => ({
  spec: null,
  rows: {},
  ...over,
});

const rowOption = (cls: PlayerClass, rowIndex: number, optionIndex = 0): string =>
  CHOICE_ROWS[cls].rows[rowIndex].options[optionIndex].id;

const rowsUnlocked = (level: number): number =>
  CHOICE_ROW_LEVELS.filter((rowLevel) => rowLevel <= level).length;

const rowsPicked = (rows: ChoiceRowAllocation): number => Object.keys(rows).length;

describe('buildTalentsView contract', () => {
  it('projects spec cards and row counts from an empty staged build', () => {
    const view = buildTalentsView(emptyAllocation(), CLS, 4);
    const specs = talentsFor(CLS)!.specs;

    expect(view).toEqual({
      specs: specs.map((spec) => ({ spec, selected: false })),
      rowsPicked: 0,
      rowsUnlocked: 0,
      valid: true,
    });
  });

  it('marks the selected spec and counts picked and unlocked rows at the player level', () => {
    const stage = alloc({
      spec: 'arms',
      rows: { 5: rowOption(CLS, 0), 8: rowOption(CLS, 1), 11: rowOption(CLS, 2) },
    });
    const view = buildTalentsView(stage, CLS, 11);
    expect(view.specs.map((entry) => [entry.spec.id, entry.selected])).toEqual([
      ['arms', true],
      ['fury', false],
      ['prot', false],
    ]);
    expect(view.rowsPicked).toBe(3);
    expect(view.rowsUnlocked).toBe(3);
    expect(view.valid).toBe(true);
  });

  it('computes validity through validateAllocation at the same player level', () => {
    const lockedRow = alloc({ rows: { 20: rowOption(CLS, 5) } });
    const unknownSpec = alloc({ spec: 'unknown' });

    expect(buildTalentsView(lockedRow, CLS, 19).valid).toBe(
      validateAllocation(CLS, lockedRow, 19).ok,
    );
    expect(buildTalentsView(unknownSpec, CLS, 20).valid).toBe(
      validateAllocation(CLS, unknownSpec, 20).ok,
    );
    expect(buildTalentsView(lockedRow, CLS, 19).valid).toBe(false);
    expect(buildTalentsView(unknownSpec, CLS, 20).valid).toBe(false);
  });

  it('is a pure projection that does not mutate the staged allocation', () => {
    const stage = alloc({ spec: 'prot', rows: { 5: rowOption(CLS, 0, 1) } });
    const before = cloneAllocation(stage);

    expect(buildTalentsView(stage, CLS, 20)).toEqual(
      buildTalentsView(cloneAllocation(stage), CLS, 20),
    );
    expect(stage).toEqual(before);
  });
});

describe('buildTalentsView parity from world-shaped seeds', () => {
  interface TalentsSeed {
    cfg: { playerClass: PlayerClass };
    level: number;
    talents: TalentAllocation;
    talentPoints(): { total: number; spent: number };
  }

  function simShaped(talents: TalentAllocation, level: number): TalentsSeed {
    return {
      cfg: { playerClass: CLS },
      level,
      talents,
      talentPoints: () => ({ total: rowsUnlocked(level), spent: rowsPicked(talents.rows) }),
    };
  }

  function clientWorldShaped(talents: TalentAllocation, level: number): TalentsSeed {
    return {
      cfg: { playerClass: CLS },
      level,
      talents: cloneAllocation(talents),
      talentPoints(): { total: number; spent: number } {
        return { total: rowsUnlocked(this.level), spent: rowsPicked(this.talents.rows) };
      },
    };
  }

  function viewFrom(seed: TalentsSeed) {
    return buildTalentsView(cloneAllocation(seed.talents), seed.cfg.playerClass, seed.level);
  }

  it('yields identical views from Sim-shaped and ClientWorld-shaped seeds', () => {
    const stage = alloc({
      spec: 'arms',
      rows: { 5: rowOption(CLS, 0, 1), 14: rowOption(CLS, 3, 1) },
    });
    const level = 14;
    const sim = simShaped(stage, level);
    const client = clientWorldShaped(stage, level);

    expect(sim.talentPoints()).toEqual(client.talentPoints());
    expect(viewFrom(sim)).toEqual(viewFrom(client));
  });
});
