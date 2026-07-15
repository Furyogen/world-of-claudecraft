// Contract for PTR account seeding: construct the complete nine-class roster
// before the first write, then hand it to one transaction-backed persistence seam.
process.env.DATABASE_URL ??= 'postgres://unused:unused@localhost:9/unused';

import { describe, expect, it } from 'vitest';
import { BOOST_CLASSES, BOOST_LEVEL, buildBoostRoster } from '../../server/pbe_boost';
import type { CharacterState } from '../../src/sim/sim';
import type { PlayerClass } from '../../src/sim/types';

const EXPECTED_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

type RosterRow = {
  readonly name: string;
  readonly cls: PlayerClass;
  readonly state: CharacterState;
};

function deterministicRand(): (maxExclusive: number) => number {
  let draw = 0;
  return (maxExclusive) => (draw++ * 17 + 3) % maxExclusive;
}

describe('buildBoostRoster atomic roster contract', () => {
  it('defines exactly the winning nine-class roster in stable order', () => {
    expect(BOOST_CLASSES).toEqual(EXPECTED_CLASSES);
  });

  it('prebuilds all nine validated rows before the database transaction begins', async () => {
    const rows: readonly RosterRow[] = await buildBoostRoster(deterministicRand());
    expect(rows.map((row) => row.cls)).toEqual(EXPECTED_CLASSES);
    expect(new Set(rows.map((row) => row.name)).size).toBe(EXPECTED_CLASSES.length);
    for (const row of rows) expect(row.state.level).toBe(BOOST_LEVEL);
  });

  it('fails collision exhaustion before returning a writable roster', async () => {
    await expect(buildBoostRoster(() => 0)).rejects.toThrow(/name|unique|roster/i);
  });
});
