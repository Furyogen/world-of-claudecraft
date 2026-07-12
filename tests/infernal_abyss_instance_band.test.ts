import { describe, expect, it } from 'vitest';
import {
  ARENA_X,
  DUNGEONS,
  dungeonAt,
  instanceOrigin,
  isArenaPos,
  isDelvePos,
} from '../src/sim/data';

describe('Infernal Abyss instance band', () => {
  it('resolves index 6 beyond the finite arena band without overlapping delves', () => {
    const origin = instanceOrigin(DUNGEONS.infernal_abyss.index, 0);
    expect(origin.x).toBe(4500);
    expect(dungeonAt(origin.x)?.id).toBe('infernal_abyss');
    expect(isArenaPos(origin.x)).toBe(false);
    expect(isDelvePos(origin.x)).toBe(false);
  });

  it('keeps the Ashen Coliseum classified as arena, not a dungeon', () => {
    expect(isArenaPos(ARENA_X)).toBe(true);
    expect(dungeonAt(ARENA_X)).toBeNull();
  });
});
