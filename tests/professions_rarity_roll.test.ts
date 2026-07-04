import { describe, expect, it } from 'vitest';
import {
  MATERIAL_RARITY_MAX_PROFICIENCY,
  type MaterialRarity,
  rollMaterialRarity,
} from '../src/sim/professions/gathering';
import { Rng } from '../src/sim/rng';

const TIERS: MaterialRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

function tally(proficiency: number, trials: number, seed: number): Record<MaterialRarity, number> {
  const rng = new Rng(seed);
  const counts: Record<MaterialRarity, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
  };
  for (let i = 0; i < trials; i++) {
    counts[rollMaterialRarity(proficiency, rng)]++;
  }
  return counts;
}

describe('material rarity roll (#1122)', () => {
  it('is a pure function of (proficiency, rng): same seed and proficiency reproduce identical results', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    const rollsA = Array.from({ length: 50 }, () => rollMaterialRarity(40, a));
    const rollsB = Array.from({ length: 50 }, () => rollMaterialRarity(40, b));
    expect(rollsA).toEqual(rollsB);
  });

  it('draws exactly one rng value per roll', () => {
    let draws = 0;
    const rng = new Rng(1);
    rng.setObserver(() => {
      draws++;
    });
    rollMaterialRarity(50, rng);
    expect(draws).toBe(1);
  });

  it('at proficiency 0, every roll is common', () => {
    const counts = tally(0, 2000, 42);
    expect(counts.common).toBe(2000);
    expect(counts.uncommon + counts.rare + counts.epic + counts.legendary).toBe(0);
  });

  it('a negative or NaN proficiency clamps the same as 0 (every roll is common)', () => {
    const negative = tally(-50, 500, 42);
    expect(negative.common).toBe(500);
    // NaN survives Math.max/Math.min, so the clamp pins it to 0 explicitly; an
    // unclamped NaN would fail every weight comparison and land legendary.
    const nan = tally(Number.NaN, 500, 42);
    expect(nan.common).toBe(500);
    expect(nan).toEqual(negative);
  });

  it('at high proficiency, non-trivial chances of uncommon, rare, epic, and legendary appear', () => {
    const counts = tally(MATERIAL_RARITY_MAX_PROFICIENCY, 20000, 99);
    // Exact fixed-seed pin, matching the documented weight shares at p=100
    // (common 0, uncommon 60, rare 30, epic 8, legendary 2 out of 100).
    expect(counts).toEqual({ common: 0, uncommon: 11958, rare: 6026, epic: 1617, legendary: 399 });
  });

  it('proficiency above the max clamps to the max (identical distribution)', () => {
    const atMax = tally(MATERIAL_RARITY_MAX_PROFICIENCY, 5000, 11);
    const overMax = tally(MATERIAL_RARITY_MAX_PROFICIENCY * 10, 5000, 11);
    expect(overMax).toEqual(atMax);
  });

  it('higher proficiency strictly does not decrease the chance of every non-common tier', () => {
    const sampleProficiencies = [0, 10, 25, 50, 75, 100];
    const trials = 40000;
    const seed = 2024;
    let prevRates: Record<MaterialRarity, number> | null = null;
    for (const p of sampleProficiencies) {
      const counts = tally(p, trials, seed);
      const rates = Object.fromEntries(TIERS.map((t) => [t, counts[t] / trials])) as Record<
        MaterialRarity,
        number
      >;
      if (prevRates) {
        for (const tier of ['uncommon', 'rare', 'epic', 'legendary'] as const) {
          // Generous tolerance for sampling noise: a strictly monotonic formula
          // should never regress by more than a hair below the previous sample.
          expect(rates[tier]).toBeGreaterThanOrEqual(prevRates[tier] - 0.01);
        }
      }
      prevRates = rates;
    }
  });

  it('the weight formula keeps the tier set fixed to the standard item rarity ladder minus poor', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const tier = rollMaterialRarity(50, rng);
      expect(TIERS).toContain(tier);
    }
  });
});
