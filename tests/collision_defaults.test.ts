import { describe, expect, it } from 'vitest';
import { applyDefaultCollision, defaultCollisionForAsset } from '../src/editor/collision_defaults';
import type { AssetPlacement } from '../src/editor/custom_map';
import { analyzeBakedFootprint, autoCollideRadius } from '../src/sim/asset_collision';
import { collideRadiusFor } from '../src/sim/map_doc';

function placement(assetId: string, collide = true): AssetPlacement {
  return { assetId, x: 0, z: 0, rotY: 0, scale: 1, collide };
}

describe('defaultCollisionForAsset', () => {
  it('keeps the bake for walkable and pass-through assets', () => {
    // Stairs bake an empty box list on purpose (deck lives in ASSET_RAMPS).
    expect(defaultCollisionForAsset('biome/cave_stairs').kind).toBe('baked');
    // Arches must stay enterable (keyword guard).
    expect(defaultCollisionForAsset('biome/city_arch').kind).toBe('baked');
    expect(defaultCollisionForAsset('dungeon/arch_gate').kind).toBe('baked');
  });

  it('keeps the bake for skeletal/frame-like box sets', () => {
    // Two posts + a crossbar: coverage far below the solid threshold.
    expect(defaultCollisionForAsset('biome/camp_fire_stand').kind).toBe('baked');
  });

  it('gives solid boxy assets a single fitted box', () => {
    const d = defaultCollisionForAsset('biome/city_crate');
    expect(d.kind).toBe('box');
    if (d.kind === 'box') {
      const a = analyzeBakedFootprint('biome/city_crate');
      expect(a).not.toBeNull();
      expect(d.box).toEqual(a?.union);
      expect(d.box.hx).toBeGreaterThan(0.5);
    }
  });

  it('gives round solids a plain circle', () => {
    expect(defaultCollisionForAsset('props/barrel').kind).toBe('circle');
  });

  it('never touches non-catalogue ids (imported models keep their bake)', () => {
    expect(defaultCollisionForAsset('user/abc123').kind).toBe('baked');
    expect(defaultCollisionForAsset('local/def456').kind).toBe('baked');
  });

  it('makes the legacy circle fallback explicit for bake-less assets', () => {
    // quest items and similar small GLBs have no bake entry.
    const anyCircle = defaultCollisionForAsset('quest/nonexistent_thing');
    expect(anyCircle.kind).toBe('baked'); // not in catalog either -> untouched
  });
});

describe('applyDefaultCollision', () => {
  it('stamps circle defaults as basic mode', () => {
    const p = placement('props/barrel');
    applyDefaultCollision(p);
    expect(p.collisionMode).toBe('basic');
    expect(p.hitboxes).toBeUndefined();
  });

  it('stamps box defaults as one editable hitbox', () => {
    const p = placement('biome/city_crate');
    applyDefaultCollision(p);
    expect(p.collisionMode).toBe('baked');
    expect(p.hitboxes).toHaveLength(1);
  });

  it('leaves pass-through assets and non-colliding placements alone', () => {
    const arch = placement('biome/city_arch');
    applyDefaultCollision(arch);
    expect(arch.collisionMode).toBeUndefined();
    expect(arch.hitboxes).toBeUndefined();

    const off = placement('props/barrel', false);
    applyDefaultCollision(off);
    expect(off.collisionMode).toBeUndefined();
  });
});

describe('autoCollideRadius', () => {
  it('fits the baked footprint in basic mode', () => {
    const fitted = autoCollideRadius('props/barrel', 1, 'basic');
    const a = analyzeBakedFootprint('props/barrel');
    expect(a).not.toBeNull();
    expect(fitted).toBeCloseTo(Math.min(30, Math.max(0.1, a?.fitRadius ?? 0)), 5);
  });

  it('scales with the placement and keeps the factor fallback elsewhere', () => {
    const r1 = autoCollideRadius('props/barrel', 1, 'basic');
    const r2 = autoCollideRadius('props/barrel', 2, 'basic');
    expect(r2).toBeCloseTo(Math.min(30, r1 * 2), 5);
    expect(autoCollideRadius('props/barrel', 2, 'baked')).toBe(collideRadiusFor(2, 'props/barrel'));
  });
});
