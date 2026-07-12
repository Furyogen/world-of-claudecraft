import { describe, expect, it } from 'vitest';
import { instanceOrigin } from '../src/sim/data';
import { INFERNAL_ABYSS_LAYOUT } from '../src/sim/dungeon_layout';
import { infernalAbyssLocalToCanvas, infernalAbyssMapModel } from '../src/ui/infernal_abyss_map';
import { minimapMode } from '../src/ui/minimap_markers';
import type { IWorld } from '../src/world_api';

const SIZE = 162;
const PAD = 8;

function worldAt(x: number, z: number): IWorld {
  return {
    player: { id: 1, pos: { x, y: 0, z }, facing: 0 },
    entities: new Map(),
    delveRun: null,
  } as unknown as IWorld;
}

describe('Infernal Abyss minimap mode', () => {
  it('selects the schematic only in the Infernal Abyss dungeon band', () => {
    const infernalOrigin = instanceOrigin(6, 0);
    expect(minimapMode(worldAt(infernalOrigin.x, infernalOrigin.z))).toBe('infernalAbyss');
    expect(minimapMode(worldAt(0, 100))).toBe('overworld');
  });
});

describe('Infernal Abyss map projection', () => {
  it('projects the authored room bounds into the padded canvas and mirrors X', () => {
    expect(infernalAbyssLocalToCanvas(-62, -25, SIZE, PAD)).toEqual({ cx: 154, cy: 8 });
    expect(infernalAbyssLocalToCanvas(66, 219, SIZE, PAD)).toEqual({ cx: 8, cy: 154 });
    expect(infernalAbyssLocalToCanvas(2, 97, SIZE, PAD)).toEqual({ cx: 81, cy: 81 });
  });

  it('derives every room and door primitive from the canonical layout', () => {
    const origin = instanceOrigin(6, 2);
    const model = infernalAbyssMapModel(worldAt(origin.x + 2, origin.z + 97), SIZE, PAD);

    expect(model.rooms.map((room) => room.id)).toEqual(
      INFERNAL_ABYSS_LAYOUT.rooms?.map((room) => room.id),
    );
    expect(model.doors).toHaveLength(INFERNAL_ABYSS_LAYOUT.doors?.length ?? 0);
    expect(model.player.cx).toBe(81);
    expect(model.player.cy).toBe(81);
    expect(Math.abs(model.player.angle)).toBe(0);
  });
});
