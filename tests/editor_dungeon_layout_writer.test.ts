import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatDungeonLayoutLiteral,
  replaceLayoutConst,
} from '../src/editor/dungeon/dungeon_layout_writer_core';
import { INFERNAL_ABYSS_LAYOUT } from '../src/sim/dungeon_layout';

// The layout serializer: a REAL evaluated round-trip against the authored
// Infernal Abyss layout, literal style pins, and the brace-aware const
// replacer applied to the actual src/sim/dungeon_layout.ts source.

const LAYOUT_SOURCE_PATH = join(process.cwd(), 'src/sim/dungeon_layout.ts');

function expectDeepClose(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number');
    expect(Math.abs((actual as number) - expected), path).toBeLessThan(1e-9);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((item, i) => {
      expectDeepClose((actual as unknown[])[i], item, `${path}[${i}]`);
    });
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    const expectedKeys = Object.keys(expected as Record<string, unknown>)
      .filter((key) => (expected as Record<string, unknown>)[key] !== undefined)
      .sort();
    const actualKeys = Object.keys(actual as Record<string, unknown>)
      .filter((key) => (actual as Record<string, unknown>)[key] !== undefined)
      .sort();
    expect(actualKeys, path).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expectDeepClose(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    }
    return;
  }
  expect(actual, path).toBe(expected);
}

describe('editor dungeon layout writer', () => {
  it('emits a literal that evaluates back to the exact Infernal Abyss layout', () => {
    const literal = formatDungeonLayoutLiteral(INFERNAL_ABYSS_LAYOUT);
    const evaluated = new Function('Math', `return ${literal}`)(Math);
    expectDeepClose(evaluated, INFERNAL_ABYSS_LAYOUT, 'layout');
  });

  it('pins the authored source style: pretty yaws and one-line room entries', () => {
    const literal = formatDungeonLayoutLiteral(INFERNAL_ABYSS_LAYOUT);
    expect(literal).toContain("{ id: 'ashen_descent_entrance', x0: -18, x1: 18, z0: -25, z1: 5 },");
    expect(literal).toContain('yaw: Math.PI / 2');
    expect(literal).toContain('yaw: -Math.PI / 2');
    expect(literal).toContain('yaw: Math.PI,');
    expect(literal).toContain('yaw: 0.18');
    expect(literal).toContain('  zMin: -25,');
    expect(literal).toContain('  dais: { x: 0, z: 222, r: 18 },');
    expect(literal).toContain('  pillars: [],');
    expect(literal).toContain('  tombs: [],');
    expect(literal).toContain('  stubs: [],');
    expect(literal).toContain("{ x: -39, z: 54, hw: 13, hd: 1, style: 'maze' },");
    expect(literal.startsWith('{\n')).toBe(true);
    expect(literal.endsWith('\n}')).toBe(true);
    // No line exceeds the repo lineWidth (the export prefix is not part of the literal).
    for (const line of literal.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });

  it('replaces one layout const in the real source file, leaving the rest intact', () => {
    const source = readFileSync(LAYOUT_SOURCE_PATH, 'utf8');
    const replaced = replaceLayoutConst(source, 'INFERNAL_ABYSS_LAYOUT', '{ zMin: 0 }');
    expect(replaced).toContain('export const INFERNAL_ABYSS_LAYOUT: DungeonLayout = { zMin: 0 };');
    // Everything before the const is byte-identical.
    const constStart = source.indexOf('export const INFERNAL_ABYSS_LAYOUT');
    expect(constStart).toBeGreaterThan(0);
    expect(replaced.startsWith(source.slice(0, constStart))).toBe(true);
    // Everything after the original const's semicolon is byte-identical.
    const arenaStart = source.indexOf('// The Ashen Coliseum');
    expect(arenaStart).toBeGreaterThan(constStart);
    expect(replaced.endsWith(source.slice(arenaStart))).toBe(true);
    // The neighbours survive.
    expect(replaced).toContain('export const CRYPT_LAYOUT: DungeonLayout = {');
    expect(replaced).toContain('export const ARENA_LAYOUT: DungeonLayout = {');
    expect(replaced).toContain('export function layoutColliders(');
    // The old literal body is gone.
    expect(replaced).not.toContain("id: 'ashen_descent_entrance'");
  });

  it('round-trips the formatted literal through the real source file', () => {
    const source = readFileSync(LAYOUT_SOURCE_PATH, 'utf8');
    const literal = formatDungeonLayoutLiteral(INFERNAL_ABYSS_LAYOUT);
    const replaced = replaceLayoutConst(source, 'INFERNAL_ABYSS_LAYOUT', literal);
    expect(replaced).toContain(`export const INFERNAL_ABYSS_LAYOUT: DungeonLayout = ${literal};`);
    // Replacing with a formatted literal keeps the rest of the file intact.
    expect(replaced).toContain('export const SANCTUM_LAYOUT: DungeonLayout =');
    expect(replaced).toContain('export const NYTHRAXIS_LAYOUT: DungeonLayout =');
  });

  it('throws when the const does not exist', () => {
    const source = readFileSync(LAYOUT_SOURCE_PATH, 'utf8');
    expect(() => replaceLayoutConst(source, 'NOPE_LAYOUT', '{}')).toThrow(/NOPE_LAYOUT/);
  });
});
