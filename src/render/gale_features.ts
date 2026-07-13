// The Galecrest's dressing, render-only: the Old Beacon lighthouse on its
// head (with a slowly turning light, the realm's landmark from anywhere on
// the downs), sea stacks standing off the Shear, and the ribs of old hulls
// half-buried on the Wreckfields. Same contract as the sibling realm
// modules: build once, update(time) turns the beacon.
import * as THREE from 'three';
import { hash2 } from '../sim/rng';
import { galeLandness, terrainHeight, WATER_LEVEL } from '../sim/world';
import { GFX } from './gfx';

export interface GaleFeaturesView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  update(time: number): void;
}

const BEACON = { x: 498, z: 308 };
// stacks stand in the water off the Shear's cliffs
const SEA_STACKS = [
  { x: 496, z: 512, r: 4.2, h: 22 },
  { x: 510, z: 546, r: 3.4, h: 17 },
  { x: 488, z: 576, r: 5.0, h: 26 },
  { x: 522, z: 492, r: 2.8, h: 13 },
  { x: 504, z: 608, r: 3.8, h: 19 },
  { x: 474, z: 616, r: 3.0, h: 15 },
] as const;
// hull ribs on the Wreckfields beach: position, heading, rib count, size
const WRECKS = [
  { x: 322, z: 656, rot: 0.7, ribs: 7, r: 5.2 },
  { x: 356, z: 666, rot: -0.9, ribs: 5, r: 3.8 },
  { x: 300, z: 634, rot: 2.2, ribs: 6, r: 4.4 },
] as const;

function mat(color: number, rough = 0.85): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true })
    : new THREE.MeshLambertMaterial({ color, flatShading: true });
}

export function buildGaleFeatures(seed: number): GaleFeaturesView {
  const group = new THREE.Group();
  group.name = 'gale-features';
  const glowLights: THREE.PointLight[] = [];

  // --- the Old Beacon: a tapered stone tower, gallery, and lamp room ---
  const beaconY = terrainHeight(BEACON.x, BEACON.z, seed);
  const beam = new THREE.Group();
  {
    const stone = mat(0xe8e4da, 0.85);
    const trim = mat(0x8a4438, 0.8);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.4, 16, 10), stone);
    tower.position.set(BEACON.x, beaconY + 8, BEACON.z);
    group.add(tower);
    // two painted bands so the tower reads as a lighthouse, not a chimney
    for (const [by, br] of [
      [4.5, 3.06],
      [10.5, 2.68],
    ]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(br + 0.06, br + 0.14, 1.6, 10), trim);
      band.position.set(BEACON.x, beaconY + by, BEACON.z);
      group.add(band);
    }
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.5, 10), trim);
    gallery.position.set(BEACON.x, beaconY + 16.2, BEACON.z);
    group.add(gallery);
    const lampRoom = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 2.2, 8),
      new THREE.MeshStandardMaterial({
        color: 0xfff2c0,
        emissive: 0xffc860,
        emissiveIntensity: 1.6,
        roughness: 0.4,
      }),
    );
    lampRoom.position.set(BEACON.x, beaconY + 17.6, BEACON.z);
    group.add(lampRoom);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.6, 8), trim);
    cap.position.set(BEACON.x, beaconY + 19.5, BEACON.z);
    group.add(cap);
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    // the turning light: two opposed additive cones riding a pivot
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    for (const flip of [1, -1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4.2, 60, 12, 1, true), beamMat);
      cone.rotation.z = (flip * Math.PI) / 2;
      cone.position.x = flip * 30;
      beam.add(cone);
    }
    beam.position.set(BEACON.x, beaconY + 17.6, BEACON.z);
    group.add(beam);
    const light = new THREE.PointLight(0xffd890, 5, 40, 2);
    light.position.set(BEACON.x, beaconY + 17.6, BEACON.z);
    light.userData.baseIntensity = 5;
    glowLights.push(light);
    group.add(light);
  }

  // --- the sea stacks off the Shear ---
  {
    const stackGeo = new THREE.CylinderGeometry(0.55, 1, 1, 7);
    const stackMat = mat(0x74787c, 0.95);
    const mesh = new THREE.InstancedMesh(stackGeo.toNonIndexed(), stackMat, SEA_STACKS.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    SEA_STACKS.forEach((s, i) => {
      const bed = Math.min(terrainHeight(s.x, s.z, seed), WATER_LEVEL - 1);
      q.setFromAxisAngle(up, hash2(s.x, s.z, seed + 7301) * Math.PI * 2);
      v.set(s.x, bed + s.h / 2, s.z);
      sc.set(s.r, s.h, s.r);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // --- the Wreckfields: hull ribs arcing out of the shingle ---
  {
    const ribGeo = new THREE.TorusGeometry(1, 0.08, 5, 10, Math.PI);
    const ribMat = mat(0x5a5048, 0.9);
    let count = 0;
    for (const w of WRECKS) count += w.ribs;
    const mesh = new THREE.InstancedMesh(ribGeo.toNonIndexed(), ribMat, count);
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let i = 0;
    for (const w of WRECKS) {
      const dx = Math.sin(w.rot);
      const dz = Math.cos(w.rot);
      for (let k = 0; k < w.ribs; k++) {
        const t = (k - (w.ribs - 1) / 2) * 1.7;
        const x = w.x + dx * t;
        const z = w.z + dz * t;
        const y = terrainHeight(x, z, seed);
        // ribs shrink toward bow and stern, like a keel picked clean
        const shape = 1 - Math.abs(k - (w.ribs - 1) / 2) / w.ribs;
        const r = w.r * (0.6 + shape * 0.5);
        q.setFromEuler(e.set(0, w.rot + Math.PI / 2, (hash2(x, z, seed + 7401) - 0.5) * 0.24));
        v.set(x, y - 0.4, z);
        sc.set(r, r, r);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  return {
    group,
    glowLights,
    update(time: number): void {
      // the beacon turns, slow and steady, the way it always has
      beam.rotation.y = time * 0.45;
    },
  };
}
