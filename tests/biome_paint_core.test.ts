import { describe, expect, it } from 'vitest';
import {
  finestPaintCell,
  growBiomePaint,
  MAX_PAINT_CELLS,
  resampleBiomePaint,
} from '../src/editor/biome_paint_core';
import type { BiomePaint } from '../src/sim/types';

function grid(cell: number, cols: number, rows: number, fill = 255): BiomePaint {
  return {
    cell,
    cols,
    rows,
    originX: -10,
    originZ: -20,
    ids: new Array(cols * rows).fill(fill),
  };
}

describe('finestPaintCell', () => {
  it('gives small maps (interiors, arenas, squares to ~500yd) 0.25yd cells', () => {
    expect(finestPaintCell(60, 60)).toBe(0.25);
    expect(finestPaintCell(100, 100)).toBe(0.25);
    expect(finestPaintCell(400, 400)).toBe(0.25);
  });

  it('gives large maps 0.5yd cells', () => {
    // A full-size custom world (the editor's Open World preset area).
    expect(finestPaintCell(360, 1080)).toBe(0.5);
    // The big-square case the budget is sized for.
    expect(finestPaintCell(1000, 1000)).toBe(0.5);
  });

  it('gives the biggest worlds 1yd cells', () => {
    // 900 wide, ~1920 deep: 0.5yd would be ~6.9M cells, over the budget.
    expect(finestPaintCell(900, 1920)).toBe(1);
  });

  it('never exceeds the cell budget', () => {
    for (const [w, d] of [
      [100, 100],
      [600, 600],
      [900, 1920],
      [4000, 4000],
    ]) {
      const cell = finestPaintCell(w, d);
      const cols = Math.ceil(w / cell) + 1;
      const rows = Math.ceil(d / cell) + 1;
      if (cell < 4) expect(cols * rows).toBeLessThanOrEqual(MAX_PAINT_CELLS);
    }
  });
});

describe('resampleBiomePaint', () => {
  it('returns null when already at or below the target cell', () => {
    expect(resampleBiomePaint(grid(2, 10, 10), 2)).toBeNull();
    expect(resampleBiomePaint(grid(1, 10, 10), 2)).toBeNull();
  });

  it('upsamples 4yd to 2yd preserving the painted footprint', () => {
    const bp = grid(4, 4, 4);
    // Paint old cell (col 1, row 2) with biome 3.
    bp.ids[2 * 4 + 1] = 3;
    const fine = resampleBiomePaint(bp, 2);
    expect(fine).not.toBeNull();
    if (!fine) return;
    expect(fine.cell).toBe(2);
    expect(fine.cols).toBe(8);
    expect(fine.rows).toBe(8);
    expect(fine.originX).toBe(bp.originX);
    expect(fine.originZ).toBe(bp.originZ);
    // The old painted cell covered world cols [4yd..8yd) x rows [8yd..12yd)
    // from the origin: exactly new cols 2..3 x rows 4..5.
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const painted = c >= 2 && c <= 3 && r >= 4 && r <= 5;
        expect(fine.ids[r * 8 + c]).toBe(painted ? 3 : 255);
      }
    }
  });

  it('keeps the custom swatch list by reference', () => {
    const bp = grid(4, 2, 2);
    bp.custom = [{ id: 200, color: 0xff00ff }];
    const fine = resampleBiomePaint(bp, 1);
    expect(fine?.custom).toBe(bp.custom);
  });

  it('refuses a resample that would exceed the sanitizer cap', () => {
    // 4000x4000 world at 4yd = 1000x1000 cells; 1yd would be 16M cells.
    expect(resampleBiomePaint(grid(4, 1000, 1000), 1)).toBeNull();
  });
});

describe('growBiomePaint', () => {
  it('returns null when the grid already covers the bounds', () => {
    // grid(): origin (-10, -20); 4yd cells, 10x12 -> covers x -10..30, z -20..28.
    const bp = grid(4, 10, 12);
    expect(growBiomePaint(bp, { minX: -10, maxX: 26, minZ: -20, maxZ: 24 })).toBeNull();
  });

  it('grows east/north keeping origin and painted cells in place', () => {
    const bp = grid(4, 4, 4);
    bp.ids[1 * 4 + 2] = 7;
    const grown = growBiomePaint(bp, { minX: -10, maxX: 30, minZ: -20, maxZ: 20 });
    expect(grown).not.toBeNull();
    if (!grown) return;
    expect(grown.originX).toBe(bp.originX);
    expect(grown.originZ).toBe(bp.originZ);
    expect(grown.cols).toBeGreaterThan(bp.cols);
    expect(grown.rows).toBeGreaterThan(bp.rows);
    expect(grown.ids[1 * grown.cols + 2]).toBe(7);
  });

  it('grows west/south snapping the origin down in whole cells', () => {
    const bp = grid(4, 4, 4);
    bp.ids[0] = 9; // cell at world (-10..-6, -20..-16)
    const grown = growBiomePaint(bp, { minX: -21, maxX: 6, minZ: -33, maxZ: -4 });
    expect(grown).not.toBeNull();
    if (!grown) return;
    // Origin moved down by an integer number of cells.
    expect((bp.originX - grown.originX) % bp.cell).toBe(0);
    expect((bp.originZ - grown.originZ) % bp.cell).toBe(0);
    expect(grown.originX).toBeLessThanOrEqual(-21);
    expect(grown.originZ).toBeLessThanOrEqual(-33);
    const padW = (bp.originX - grown.originX) / bp.cell;
    const padS = (bp.originZ - grown.originZ) / bp.cell;
    expect(grown.ids[padS * grown.cols + padW]).toBe(9);
    // New cells are unpainted.
    expect(grown.ids[0]).toBe(255);
  });

  it('keeps the custom swatch list by reference and refuses the cap', () => {
    const bp = grid(4, 2, 2);
    bp.custom = [{ id: 200, color: 0xff00ff }];
    const grown = growBiomePaint(bp, { minX: -30, maxX: 30, minZ: -40, maxZ: 40 });
    expect(grown?.custom).toBe(bp.custom);
    // 0.25yd cells over a huge rect would blow the sanitizer cap: keep old.
    const fine = grid(0.25, 100, 100);
    expect(growBiomePaint(fine, { minX: -600, maxX: 600, minZ: -600, maxZ: 600 })).toBeNull();
  });
});
