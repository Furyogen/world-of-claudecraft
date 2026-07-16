// The Willowfen's dressing, render-only: weeping willows trailing over the
// pools, lily pads drifting on the still water, and flowering hedge tufts.
// Same contract as the sibling realm modules: build once, update(time)
// animates gently, no lights needed (the fen is bright).
import * as THREE from 'three';
import { WILLOWFEN_ZONE } from '../sim/content/willowfen';
import { hash2 } from '../sim/rng';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { GFX } from './gfx';

export interface FenFeaturesView {
  group: THREE.Group;
  update(time: number): void;
}

const FEN_ZMIN = 180;
const FEN_ZMAX = 700;
const WILLOW_TINTS = [0x8fc47e, 0x7eb474, 0xa2d488];
const BLOOM_TINTS = [0xf2a8c8, 0xf2e0a0, 0xd8b8f2, 0xffffff, 0xf2a88f];

function mat(opts: {
  color: number;
  roughness?: number;
  flatShading?: boolean;
  transparent?: boolean;
  opacity?: number;
}): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        color: opts.color,
        roughness: opts.roughness ?? 0.85,
        flatShading: opts.flatShading ?? true,
        transparent: opts.transparent ?? false,
        opacity: opts.opacity ?? 1,
      })
    : new THREE.MeshLambertMaterial({
        color: opts.color,
        flatShading: opts.flatShading ?? true,
        transparent: opts.transparent ?? false,
        opacity: opts.opacity ?? 1,
      });
}

// A weeping willow: short trunk, a soft dome, and a skirt of hanging strand
// cylinders drooping below the dome's rim (the strands are what sell it).
function willowGeos(): { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 6);
  trunk.translate(0, 1.3, 0);
  const parts: THREE.BufferGeometry[] = [];
  const dome = new THREE.SphereGeometry(2.4, 8, 6);
  dome.scale(1, 0.72, 1);
  dome.translate(0, 3.1, 0);
  parts.push(dome.toNonIndexed());
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    const rad = 2.05 + (i % 3) * 0.18;
    const len = 2.4 + ((i * 7) % 5) * 0.28;
    const strand = new THREE.CylinderGeometry(0.055, 0.03, len, 4);
    strand.translate(Math.sin(ang) * rad, 3.0 - len / 2, Math.cos(ang) * rad);
    parts.push(strand.toNonIndexed());
  }
  // merge by hand (few parts, simple attributes)
  let total = 0;
  for (const g of parts) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  let off = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, off);
    norm.set(g.getAttribute('normal').array as Float32Array, off);
    off += g.getAttribute('position').count * 3;
  }
  const canopy = new THREE.BufferGeometry();
  canopy.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  canopy.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return { trunk: trunk.toNonIndexed(), canopy };
}

export function buildFenFeatures(seed: number): FenFeaturesView {
  const group = new THREE.Group();
  group.name = 'fen-features';

  const instance = (
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    spots: { x: number; z: number; y: number; s: number; rot: number; tint?: number }[],
    tinted = false,
  ) => {
    if (spots.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, material, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach((sp, i) => {
      q.setFromAxisAngle(up, sp.rot);
      v.set(sp.x, sp.y, sp.z);
      sc.set(sp.s, sp.s, sp.s);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
      if (tinted && sp.tint !== undefined) mesh.setColorAt(i, new THREE.Color(sp.tint));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };

  // --- weeping willows: thickest at the pool shores, scattered elsewhere ---
  {
    const geos = willowGeos();
    const spots: { x: number; z: number; y: number; s: number; rot: number; tint: number }[] = [];
    for (const lake of WILLOWFEN_ZONE.lakes) {
      const count = 3 + Math.floor(hash2(lake.x, lake.z, seed + 2101) * 3);
      for (let k = 0; k < count; k++) {
        const ang = hash2(k, lake.x + lake.z, seed + 2111) * Math.PI * 2;
        const dist = lake.radius + 4 + hash2(lake.x, k, seed + 2121) * 6;
        const x = lake.x + Math.sin(ang) * dist;
        const z = lake.z + Math.cos(ang) * dist;
        if (z < FEN_ZMIN + 8 || z > FEN_ZMAX - 8) continue;
        const y = terrainHeight(x, z, seed);
        if (y < WATER_LEVEL + 0.6) continue;
        spots.push({
          x,
          z,
          y,
          s: 0.9 + hash2(k, lake.z, seed + 2131) * 0.9,
          rot: hash2(lake.x + k, k, seed + 2141) * Math.PI * 2,
          tint: WILLOW_TINTS[Math.floor(hash2(k, lake.x - k, seed + 2151) * WILLOW_TINTS.length)],
        });
      }
    }
    instance(geos.trunk, mat({ color: 0x7a6248 }), spots);
    instance(geos.canopy, mat({ color: 0xffffff, roughness: 0.8 }), spots, true);
  }

  // --- lily pads: flat bright discs drifting on every pool ---
  const pads: THREE.Mesh[] = [];
  {
    const padGeo = new THREE.CircleGeometry(0.55, 7);
    const padMat = mat({ color: 0x6aa858, roughness: 0.7, flatShading: false });
    for (const lake of WILLOWFEN_ZONE.lakes) {
      const count = 4 + Math.floor(hash2(lake.z, lake.x, seed + 2201) * 5);
      for (let k = 0; k < count; k++) {
        const ang = hash2(k * 3, lake.x, seed + 2211) * Math.PI * 2;
        const dist = Math.sqrt(hash2(lake.z, k * 5, seed + 2221)) * lake.radius * 0.8;
        const x = lake.x + Math.sin(ang) * dist;
        const z = lake.z + Math.cos(ang) * dist;
        if (terrainHeight(x, z, seed) > WATER_LEVEL - 0.4) continue;
        const pad = new THREE.Mesh(padGeo, padMat);
        pad.rotation.x = -Math.PI / 2;
        pad.rotation.z = hash2(k, lake.x + 7, seed + 2231) * Math.PI * 2;
        const s = 0.7 + hash2(lake.x, k + 11, seed + 2241) * 1;
        pad.scale.setScalar(s);
        pad.position.set(x, WATER_LEVEL + 0.08, z);
        pad.userData.phase = hash2(x, z, seed + 2251) * Math.PI * 2;
        pads.push(pad);
        group.add(pad);
      }
    }
  }

  // --- flowering hedges: puffball bushes with bloom tints, near roadsides
  // and shores across the whole band ---
  {
    const bloomGeo = new THREE.IcosahedronGeometry(0.8, 0);
    bloomGeo.scale(1, 0.7, 1);
    const geo = bloomGeo.toNonIndexed();
    const spots: { x: number; z: number; y: number; s: number; rot: number; tint: number }[] = [];
    for (let gx = -520; gx <= -200; gx += 11) {
      for (let gz = FEN_ZMIN + 30; gz <= FEN_ZMAX - 60; gz += 11) {
        const r = hash2(gx, gz, seed + 2301);
        if (r > 0.42) continue;
        const x = gx + (hash2(gx, gz, seed + 2311) - 0.5) * 10;
        const z = gz + (hash2(gz, gx, seed + 2321) - 0.5) * 10;
        const y = terrainHeight(x, z, seed);
        if (y < WATER_LEVEL + 0.8) continue;
        spots.push({
          x,
          z,
          y: y + 0.3,
          s: 0.6 + hash2(gx + 1, gz, seed + 2331) * 1.1,
          rot: hash2(gx, gz + 1, seed + 2341) * Math.PI * 2,
          tint: BLOOM_TINTS[Math.floor(hash2(gx - 1, gz, seed + 2351) * BLOOM_TINTS.length)],
        });
      }
    }
    instance(geo, mat({ color: 0xffffff, roughness: 0.85 }), spots, true);
  }

  return {
    group,
    update(time: number): void {
      // lily pads bob almost imperceptibly
      for (const pad of pads) {
        pad.position.y = WATER_LEVEL + 0.08 + Math.sin(time * 0.8 + pad.userData.phase) * 0.03;
      }
    },
  };
}
