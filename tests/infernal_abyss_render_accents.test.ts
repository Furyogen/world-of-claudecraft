import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { placeInfernalAbyssAtmosphere } from '../src/render/infernal_abyss_atmosphere';
import { placeInfernalAbyssFloorAccents } from '../src/render/infernal_abyss_floor_accents';
import { INFERNAL_ABYSS_LAYOUT } from '../src/sim/dungeon_layout';

describe('Infernal Abyss render accents', () => {
  it('consolidates the high-tier floor treatment into two authored meshes', () => {
    const group = new THREE.Group();
    const stats = placeInfernalAbyssFloorAccents(group, INFERNAL_ABYSS_LAYOUT, false);

    expect(stats).toMatchObject({
      drawCalls: 2,
      veinPaths: 34,
      crustPlates: 48,
    });
    expect(stats.veinSegments).toBeGreaterThan(100);
    expect(group.getObjectByName('infernal-abyss-crust-islands')).toBeInstanceOf(THREE.Mesh);
    expect(group.getObjectByName('infernal-abyss-molten-floor-veins')).toBeInstanceOf(THREE.Mesh);
  });

  it('retains the landmark fractures while reducing low-tier geometry', () => {
    const highGroup = new THREE.Group();
    const lowGroup = new THREE.Group();
    const high = placeInfernalAbyssFloorAccents(highGroup, INFERNAL_ABYSS_LAYOUT, false);
    const low = placeInfernalAbyssFloorAccents(lowGroup, INFERNAL_ABYSS_LAYOUT, true);

    expect(low.drawCalls).toBe(2);
    expect(low.veinPaths).toBeLessThan(high.veinPaths);
    expect(low.veinSegments).toBeLessThan(high.veinSegments);
    expect(low.crustPlates).toBeLessThan(high.crustPlates);
    expect(low.triangles).toBeLessThan(high.triangles);
  });

  it('keeps the cavern atmosphere at a fixed draw-call budget on both tiers', () => {
    const highGroup = new THREE.Group();
    const lowGroup = new THREE.Group();
    const high = placeInfernalAbyssAtmosphere(highGroup, INFERNAL_ABYSS_LAYOUT, false);
    const low = placeInfernalAbyssAtmosphere(lowGroup, INFERNAL_ABYSS_LAYOUT, true);

    expect(high).toMatchObject({ drawCalls: 8, lavafalls: 8, emberMotes: 250 });
    expect(low).toMatchObject({ drawCalls: 7, lavafalls: 5, emberMotes: 0 });
    expect(low.stalactites).toBeLessThan(high.stalactites);
    expect(low.chasmCrags).toBeLessThan(high.chasmCrags);
    expect(highGroup.getObjectByName('infernal-abyss-atmosphere')).toBeInstanceOf(THREE.Group);
  });
});
