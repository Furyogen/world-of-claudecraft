// The Drakelands' volcanic dressing, all render-only: glowing lava surfaces
// in the shaped basins (world.ts EMBER_LAVA_POOLS), ember plumes rising off
// them, and the Bloodglass Fields' red crystal spurs. Same contract as
// realm_flora: build once, update(time) animates, lights join the renderer's
// rank-culled fireLights budget.
import * as THREE from 'three';
import { hash2 } from '../sim/rng';
import { EMBER_LAVA_POOLS, terrainHeight } from '../sim/world';
import { GFX } from './gfx';

export interface EmberFeaturesView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  update(time: number): void;
}

// The Bloodglass Fields: shard clusters seeded around the POI.
const BLOODGLASS = { x: -90, z: 1890, r: 42 };
const BLOODGLASS_TINTS = [0xd83a2c, 0xb82838, 0xe85838];

function shardGeo(): THREE.BufferGeometry {
  // a stretched octahedron reads as a glassy spur in the flat-shaded style
  const geo = new THREE.OctahedronGeometry(1, 0);
  geo.scale(0.38, 1.7, 0.38);
  return geo.toNonIndexed();
}

export function buildEmberFeatures(seed: number): EmberFeaturesView {
  const group = new THREE.Group();
  group.name = 'ember-features';
  const glowLights: THREE.PointLight[] = [];
  const pulsingLava: THREE.MeshBasicMaterial[] = [];

  // --- lava surfaces: unlit molten discs with a dark-crust texture (bright
  // cracks between cooled plates, like a real lava lake), each riding above
  // its own basin floor; the point light carries the glow onto the rocks ---
  const lavaTex = lavaTexture();
  for (const pool of EMBER_LAVA_POOLS) {
    const lavaMat = new THREE.MeshBasicMaterial({
      color: 0xffb060,
      map: lavaTex ?? undefined,
      transparent: true,
      opacity: 0.98,
      depthWrite: false,
    });
    pulsingLava.push(lavaMat);
    const lava = new THREE.Mesh(new THREE.CircleGeometry(pool.r * 0.98, 22), lavaMat);
    lava.rotation.x = -Math.PI / 2;
    // seated into the bowl like water in its basin: just above the shaped
    // floor, so the disc edge tucks under the rising basin walls instead of
    // hovering over the outer skirt (0.9 still clears the LOD undershoot)
    lava.position.set(pool.x, pool.floor + 0.9, pool.z);
    group.add(lava);
    const light = new THREE.PointLight(0xff5a18, 8, pool.r * 3.4, 2);
    light.position.set(pool.x, pool.floor + 2.6, pool.z);
    light.userData.baseIntensity = 8;
    glowLights.push(light);
    group.add(light);
  }

  // --- bloodglass shards: instanced clusters with a dim inner glow ---
  const spots: { x: number; z: number; y: number; s: number; rot: number; tint: number }[] = [];
  for (let k = 0; k < 46; k++) {
    const ang = hash2(k, 11, seed + 901) * Math.PI * 2;
    const dist = Math.sqrt(hash2(k, 23, seed + 911)) * BLOODGLASS.r;
    const x = BLOODGLASS.x + Math.sin(ang) * dist;
    const z = BLOODGLASS.z + Math.cos(ang) * dist;
    const y = terrainHeight(x, z, seed);
    if (y < 0) continue;
    spots.push({
      x,
      z,
      y,
      s: 0.7 + hash2(k, 37, seed + 921) * 2.4,
      rot: hash2(k, 41, seed + 931) * Math.PI * 2,
      tint: BLOODGLASS_TINTS[Math.floor(hash2(k, 53, seed + 941) * BLOODGLASS_TINTS.length)],
    });
  }
  if (spots.length > 0) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb03028,
      emissive: 0x8a1410,
      emissiveIntensity: GFX.composer ? 0.5 : 0.35,
      roughness: 0.35,
      flatShading: true,
    });
    const mesh = new THREE.InstancedMesh(shardGeo(), mat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const qTilt = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const tiltAxis = new THREE.Vector3();
    spots.forEach((sp, i) => {
      q.setFromAxisAngle(up, sp.rot);
      tiltAxis.set(Math.sin(sp.rot * 3.1), 0, Math.cos(sp.rot * 3.1)).normalize();
      qTilt.setFromAxisAngle(tiltAxis, (hash2(i, 61, seed + 951) - 0.5) * 0.7);
      q.premultiply(qTilt);
      v.set(sp.x, sp.y + sp.s * 0.55, sp.z);
      sc.set(sp.s, sp.s, sp.s);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
      mesh.setColorAt(i, new THREE.Color(sp.tint));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    const fieldLight = new THREE.PointLight(0xc82818, 5, 30, 2);
    fieldLight.position.set(
      BLOODGLASS.x,
      terrainHeight(BLOODGLASS.x, BLOODGLASS.z, seed) + 3,
      BLOODGLASS.z,
    );
    fieldLight.userData.baseIntensity = 5;
    glowLights.push(fieldLight);
    group.add(fieldLight);
  }

  // --- bone fields: ivory remains scattered near the graveyards and the
  // open waste (procedural skulls and rib shards, instanced) ---
  {
    const boneGeo = new THREE.IcosahedronGeometry(0.42, 0);
    boneGeo.scale(1, 0.72, 0.85);
    const ribGeo = new THREE.TorusGeometry(0.55, 0.07, 5, 8, Math.PI);
    const merged: { g: THREE.BufferGeometry; skull: boolean }[] = [
      { g: boneGeo.toNonIndexed(), skull: true },
      { g: ribGeo.toNonIndexed(), skull: false },
    ];
    const FIELDS = [
      { x: -6, z: 1712, r: 22 },
      { x: -60, z: 1796, r: 24 },
      { x: 92, z: 1732, r: 20 },
      { x: 10, z: 1860, r: 34 },
    ];
    for (const part of merged) {
      const spots2: { x: number; z: number; y: number; s: number; rot: number }[] = [];
      FIELDS.forEach((f, fi) => {
        for (let k = 0; k < 9; k++) {
          const ang = hash2(k + fi * 31, 7, seed + 971) * Math.PI * 2;
          const dist = Math.sqrt(hash2(k, fi + 13, seed + 981)) * f.r;
          const x = f.x + Math.sin(ang) * dist;
          const z = f.z + Math.cos(ang) * dist;
          const y = terrainHeight(x, z, seed);
          if (y < 0) continue;
          spots2.push({
            x,
            z,
            y: y + 0.1,
            s: 0.7 + hash2(k, fi, seed + 991) * 1.1,
            rot: hash2(fi, k, seed + 995) * Math.PI * 2,
          });
        }
      });
      if (spots2.length === 0) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: part.skull ? 0xe8e0d0 : 0xdcd2be,
        roughness: 0.9,
        flatShading: true,
      });
      const mesh = new THREE.InstancedMesh(part.g, mat, spots2.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      spots2.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp.rot);
        v.set(sp.x, sp.y, sp.z);
        sc.set(sp.s, sp.s, sp.s);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  return {
    group,
    glowLights,
    update(time: number): void {
      // the lava breathes: a slow molten pulse shared by every pool
      const pulse = 0.88 + Math.sin(time * 0.7) * 0.08 + Math.sin(time * 2.3) * 0.04;
      for (const mat of pulsingLava) {
        mat.opacity = pulse;
        if (mat.map) mat.map.offset.x = (time * 0.006) % 1;
      }
    },
  };
}

// Dark cooled crust broken by white-hot cracks: drawn once, scrolled slowly.
function lavaTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ff8a20';
  ctx.fillRect(0, 0, 128, 128);
  // cooled plates: dark blobs leaving bright molten seams between them
  for (let i = 0; i < 46; i++) {
    const x = (i * 37) % 128;
    const y = (i * 59) % 128;
    const r = 7 + ((i * 13) % 12);
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(30,8,4,0.95)');
    g.addColorStop(0.75, 'rgba(46,12,6,0.85)');
    g.addColorStop(1, 'rgba(46,12,6,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // white-hot flecks along the seams
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255,240,180,0.9)' : 'rgba(255,180,80,0.7)';
    ctx.fillRect((i * 43) % 128, (i * 71) % 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
