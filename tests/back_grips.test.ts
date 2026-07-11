// src/render/characters/back_grips.ts: the pure on-back transform table for
// sheathed weapons (family dispatch, side mirroring, unknown-family fallback).
import { describe, expect, it } from 'vitest';
import { backGripFor, quatFromEulerXYZ } from '../src/render/characters/back_grips';

function quatLength(q: [number, number, number, number]): number {
  return Math.hypot(q[0], q[1], q[2], q[3]);
}

describe('quatFromEulerXYZ', () => {
  it('matches known rotations', () => {
    expect(quatFromEulerXYZ(0, 0, 0)).toEqual([0, 0, 0, 1]);
    const [x, y, z, w] = quatFromEulerXYZ(0, Math.PI, 0);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(1, 12);
    expect(z).toBeCloseTo(0, 12);
    expect(w).toBeCloseTo(0, 12);
  });

  it('always yields a unit quaternion', () => {
    for (const [x, y, z] of [
      [0.3, -1.2, 2.9],
      [Math.PI * 0.85, 0, 0],
      [-0.5, 0.5, -2.2],
    ]) {
      expect(quatLength(quatFromEulerXYZ(x, y, z))).toBeCloseTo(1, 12);
    }
  });
});

describe('backGripFor', () => {
  it('an unknown family and null fall back to the same default', () => {
    expect(backGripFor('NOT_A_FAMILY', 'r')).toEqual(backGripFor(null, 'r'));
  });

  it('families dispatch to distinct transforms (long hafts vs short blades)', () => {
    const staff = backGripFor('2H_Staff', 'r');
    const knife = backGripFor('Knife', 'r');
    expect(staff.position).not.toEqual(knife.position);
    // Crossbows lie flat across the back: a different rotation axis entirely.
    const bow = backGripFor('2H_Crossbow', 'r');
    expect(bow.quaternion).not.toEqual(staff.quaternion);
  });

  it('mirrors the left side across X so dual-wield reads crossed', () => {
    const r = backGripFor('Knife', 'r');
    const l = backGripFor('Knife', 'l');
    expect(l.position[0]).toBeCloseTo(-r.position[0], 12);
    expect(l.position[1]).toBeCloseTo(r.position[1], 12);
    expect(l.position[2]).toBeCloseTo(r.position[2], 12);
    expect(l.quaternion).not.toEqual(r.quaternion);
    expect(quatLength(l.quaternion)).toBeCloseTo(1, 12);
  });

  it('every declared family yields a unit quaternion', () => {
    for (const fam of [
      '1H_Sword',
      '2H_Sword',
      '1H_Axe',
      '2H_Axe',
      '2H_Staff',
      'Knife',
      '1H_Wand',
      '1H_Crossbow',
      '2H_Crossbow',
      'VAR_SWORD',
      'VAR_DAGGER',
      'VAR_STAFF',
      'VAR_AXE',
      'VAR_POLEARM',
      'VAR_WAND',
    ]) {
      expect(quatLength(backGripFor(fam, 'r').quaternion), fam).toBeCloseTo(1, 12);
      expect(quatLength(backGripFor(fam, 'l').quaternion), fam).toBeCloseTo(1, 12);
    }
  });
});
