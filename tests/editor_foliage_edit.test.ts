import { afterEach, describe, expect, it } from 'vitest';
import {
  ambientDecorationKey,
  ambientDecorationsToPlacements,
  closestAmbientTrees,
} from '../src/editor/foliage_edit_core';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import type { Decoration } from '../src/sim/world';
import { decorationKey, generateDecorationsInBounds } from '../src/sim/world';

afterEach(() => setActiveWorldContent(null));

const decorations: Decoration[] = [
  { kind: 'tree', x: 10, z: 20, scale: 1, variant: 2, biome: 'vale' },
  { kind: 'tree2', x: 30, z: 40, scale: 2, variant: 1, biome: 'vale' },
  { kind: 'tree2', x: 50, z: 60, scale: 1, variant: 0, biome: 'dusk' },
  { kind: 'rock', x: 70, z: 80, scale: 1.5, variant: 2, biome: 'peaks' },
];

describe('ambientDecorationsToPlacements', () => {
  it('preserves every anchor as an editable colliding placement', () => {
    const placements = ambientDecorationsToPlacements(decorations);
    expect(placements).toHaveLength(decorations.length);
    expect(placements.map(({ x, z, collide }) => ({ x, z, collide }))).toEqual([
      { x: 10, z: 20, collide: true },
      { x: 30, z: 40, collide: true },
      { x: 50, z: 60, collide: true },
      { x: 70, z: 80, collide: true },
    ]);
  });

  it('maps procedural species to matching foliage catalog assets and sizes', () => {
    const placements = ambientDecorationsToPlacements(decorations);
    expect(placements.map((placement) => placement.assetId)).toEqual([
      'foliage/pine_4',
      'foliage/oak_2',
      'foliage/twisted_1',
      'foliage/rock_3',
    ]);
    expect(placements[0].scale).toBeCloseTo(1.1);
    expect(placements[1].scale).toBeCloseTo(2.3);
    expect(placements[2].scale).toBeCloseTo(0.5);
    expect(placements[3].scale).toBeCloseTo(0.93);
  });

  it('is deterministic and retains the procedural rock shape variation', () => {
    const first = ambientDecorationsToPlacements(decorations);
    const second = ambientDecorationsToPlacements(decorations);
    expect(second).toEqual(first);
    expect(first[3].scaleX).toBeTypeOf('number');
    expect(first[3].scaleY).toBeTypeOf('number');
    expect(first[3].scaleZ).toBeTypeOf('number');
  });

  it('selects a deterministic nearest batch around the camera focus', () => {
    const nearest = closestAmbientTrees(decorations, { x: 31, z: 39 }, 2);
    expect(nearest).toEqual([decorations[1], decorations[0]]);
    expect(nearest.map(ambientDecorationKey)).toEqual([
      'tree2:30.000:40.000',
      'tree:10.000:20.000',
    ]);
    expect(closestAmbientTrees(decorations, { x: 70, z: 80 }, 1)).toEqual([decorations[2]]);
  });

  it('suppresses converted ambient anchors while leaving nearby foliage procedural', () => {
    const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    const before = generateDecorationsInBounds(20061, bounds);
    expect(before.length).toBeGreaterThan(1);
    const excluded = decorationKey(before[0]);
    setActiveWorldContent({ ...BUILTIN_WORLD, decorationExclusions: [excluded] });
    const after = generateDecorationsInBounds(20061, bounds);
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((decoration) => decorationKey(decoration) === excluded)).toBe(false);
  });
});
