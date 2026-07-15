import type { PlayerClass } from '../../src/sim/types';

/** Independent release oracle: the winning v0.24 roster, in canonical display order. */
export const EXPECTED_PLAYER_CLASSES = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
] as const satisfies readonly PlayerClass[];

export const EXPECTED_PLAYER_CLASS_IDS = [...EXPECTED_PLAYER_CLASSES] as readonly string[];
