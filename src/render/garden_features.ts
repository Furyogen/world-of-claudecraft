// The Evergarden's dressing, render-only: marble statues down the Statuary
// Walk and in the Fountain Court, the tiered fountain itself at the maze's
// heart, clipped topiary forms scattered over the lawns (the hedge maze is
// terrain, world.ts owns it), and the specimen elders at the greatTrees
// spots (the same records the sim's trunk colliders use). Same contract as
// the sibling realm modules: build once, update(time) animates gently.
import * as THREE from 'three';
import { EVERGARDEN_PROPS, EVERGARDEN_ZONE } from '../sim/content/evergarden';
import { hash2 } from '../sim/rng';
import {
  gardenLandness,
  inGardenMaze,
  roadDistance,
  terrainHeight,
  WATER_LEVEL,
} from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX } from './gfx';

export interface GardenFeaturesView {
  group: THREE.Group;
  update(time: number): void;
}

const GARDEN_ZMIN = 700;
const GARDEN_ZMAX = 1260;

// The specimen elders reuse the twisted-elder model the Hollow, the
// Wraithwood, and the Palmreach already preload, regrown into clipped
// evergreen giants.
const GREAT_TREE_URL = '/models/foliage/twisted_1.glb';
let greatTreeScene: THREE.Group | null = null;
registerPreload(
  loadGltf(GREAT_TREE_URL).then((gltf) => {
    greatTreeScene = gltf.scene;
  }),
);

function mat(color: number, rough = 0.85): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true })
    : new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function mergeGeos(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
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
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return out;
}

// A weathered garden statue: a plinth, a robed figure, a bowed head. Kept
// abstract on purpose: at game distance it reads as statuary, not a person.
function statueGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const plinth = new THREE.BoxGeometry(1.5, 0.9, 1.5);
  plinth.translate(0, 0.45, 0);
  parts.push(plinth.toNonIndexed());
  const robe = new THREE.CylinderGeometry(0.28, 0.52, 2.1, 6);
  robe.translate(0, 0.9 + 1.05, 0);
  parts.push(robe.toNonIndexed());
  const shoulders = new THREE.SphereGeometry(0.34, 6, 5);
  shoulders.scale(1.2, 0.7, 0.9);
  shoulders.translate(0, 3.0, 0);
  parts.push(shoulders.toNonIndexed());
  const head = new THREE.SphereGeometry(0.2, 6, 5);
  head.translate(0.05, 3.32, 0.08); // bowed, a little forward
  parts.push(head.toNonIndexed());
  return mergeGeos(parts);
}

// Three clipped topiary forms for the lawns: a ball on a stem, a tiered
// triple-ball, and a garden cone. The living topiary (the mobs) are the
// creature rigs; these are the ones still holding their shape.
function topiaryGeos(): THREE.BufferGeometry[] {
  const stem = (h: number): THREE.BufferGeometry => {
    const g = new THREE.CylinderGeometry(0.09, 0.12, h, 5);
    g.translate(0, h / 2, 0);
    return g.toNonIndexed();
  };
  const ball = (r: number, y: number): THREE.BufferGeometry => {
    const g = new THREE.SphereGeometry(r, 7, 6);
    g.translate(0, y, 0);
    return g.toNonIndexed();
  };
  const single = mergeGeos([stem(1.0), ball(0.85, 1.6)]);
  const tiered = mergeGeos([stem(2.4), ball(0.75, 1.0), ball(0.55, 2.0), ball(0.38, 2.75)]);
  const coneG = new THREE.ConeGeometry(0.85, 2.6, 7);
  coneG.translate(0, 1.3 + 0.3, 0);
  const cone = mergeGeos([stem(0.5), coneG.toNonIndexed()]);
  return [single, tiered, cone];
}

const MARBLE = 0xcfcdc2;
const TOPIARY_TINTS = [0x3f7e3c, 0x4a8a4e, 0x356e34];

// The Fountain Court's centerpiece: a two-tier stone fountain with a still
// water disc in each basin (the shimmer is the water shader's job elsewhere;
// here a gentle emissive-free blue reads as water at court scale).
function buildFountain(x: number, z: number, y: number): THREE.Group {
  const g = new THREE.Group();
  const stone = mat(0xb8b4a6, 0.9);
  const water = new THREE.MeshBasicMaterial({ color: 0x69b8c4, transparent: true, opacity: 0.85 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.3, 0.9, 14), stone);
  basin.position.set(x, y + 0.45, z);
  g.add(basin);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.85, 14), water);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, y + 0.82, z);
  g.add(pool);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.7, 8), stone);
  column.position.set(x, y + 1.7, z);
  g.add(column);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.9, 0.5, 12), stone);
  bowl.position.set(x, y + 2.6, z);
  g.add(bowl);
  const bowlPool = new THREE.Mesh(new THREE.CircleGeometry(1.05, 12), water);
  bowlPool.rotation.x = -Math.PI / 2;
  bowlPool.position.set(x, y + 2.82, z);
  g.add(bowlPool);
  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 6), stone);
  finial.position.set(x, y + 3.4, z);
  g.add(finial);
  g.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return g;
}

export function buildGardenFeatures(seed: number): GardenFeaturesView {
  const group = new THREE.Group();
  group.name = 'garden-features';

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

  // --- the Statuary Walk: paired statues flanking the road to the maze,
  // plus four watchers inside the Fountain Court ---
  {
    const spots: { x: number; z: number; y: number; s: number; rot: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const z = 840 + i * 17;
      for (const x of [353, 367]) {
        const y = terrainHeight(x, z, seed);
        if (y < WATER_LEVEL + 0.5) continue;
        spots.push({
          x,
          z,
          y: y - 0.1,
          s: 0.95 + hash2(x, z, seed + 6101) * 0.15,
          // each faces the walk, weathered a few degrees off true
          rot: (x < 360 ? 1 : -1) * (Math.PI / 2) + (hash2(z, x, seed + 6111) - 0.5) * 0.3,
        });
      }
    }
    for (const [x, z] of [
      [350, 1008],
      [370, 1008],
      [350, 1025],
      [370, 1025],
    ]) {
      const y = terrainHeight(x, z, seed);
      spots.push({
        x,
        z,
        y: y - 0.1,
        s: 1.05,
        rot: Math.atan2(360 - x, 1016.5 - z), // all four face the fountain
      });
    }
    instance(statueGeo(), mat(MARBLE, 0.75), spots);
  }

  // --- the fountain at the heart of the Great Maze ---
  {
    const y = terrainHeight(360, 1016.5, seed);
    if (y > WATER_LEVEL) group.add(buildFountain(360, 1016.5, y - 0.1));
  }

  // --- the topiary forms: a deterministic scatter over the open lawns,
  // clear of the maze, the hamlet, the roads, and the water ---
  {
    const geos = topiaryGeos();
    const spotSets: { x: number; z: number; y: number; s: number; rot: number; tint: number }[][] =
      [[], [], []];
    const hub = EVERGARDEN_ZONE.hub;
    for (let gx = 184; gx <= 536; gx += 12) {
      for (let gz = GARDEN_ZMIN + 14; gz <= GARDEN_ZMAX - 10; gz += 12) {
        const r = hash2(gx, gz, seed + 6201);
        if (r > 0.34) continue;
        const x = gx + (hash2(gx, gz, seed + 6211) - 0.5) * 9;
        const z = gz + (hash2(gz, gx, seed + 6221) - 0.5) * 9;
        if (inGardenMaze(x, z)) continue;
        if (Math.hypot(x - hub.x, z - hub.z) < hub.radius + 8) continue;
        if (gardenLandness(x, z) < 0.22) continue;
        if (roadDistance(x, z) < 8) continue;
        const y = terrainHeight(x, z, seed);
        if (y < WATER_LEVEL + 1.2 || y > 12) continue;
        const kind = Math.floor(hash2(x, z, seed + 6231) * 3) % 3;
        spotSets[kind].push({
          x,
          z,
          y: y - 0.12,
          s: 0.8 + hash2(z, x, seed + 6241) * 0.6,
          rot: hash2(x + 3, z - 3, seed + 6251) * Math.PI * 2,
          tint: TOPIARY_TINTS[Math.floor(hash2(x, z, seed + 6261) * 3) % 3],
        });
      }
    }
    const leafMat = mat(0xffffff, 0.85);
    for (let k = 0; k < 3; k++) instance(geos[k], leafMat, spotSets[k], true);
  }

  // --- the specimen elders: the twisted giant regrown clipped and green ---
  {
    const clipped = new Map<string, THREE.Material>();
    const clip = (source: THREE.Material): THREE.Material => {
      let m2 = clipped.get(source.uuid);
      if (!m2) {
        m2 = source.clone();
        const c = (m2 as THREE.MeshStandardMaterial).color;
        if (c) c.multiply(new THREE.Color(0.62, 0.98, 0.64));
        clipped.set(source.uuid, m2);
      }
      return m2;
    };
    const trees = EVERGARDEN_PROPS.greatTrees ?? [];
    if (greatTreeScene) {
      for (const t of trees) {
        const y = terrainHeight(t.x, t.z, seed);
        if (y < WATER_LEVEL) continue;
        const tree = greatTreeScene.clone(true);
        const scale = t.r * (2.4 + hash2(t.x, t.z, seed + 6301) * 0.5);
        tree.position.set(t.x, y - 0.2, t.z);
        tree.scale.setScalar(scale);
        tree.rotation.y = hash2(t.z, t.x, seed + 6311) * Math.PI * 2;
        tree.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.material = Array.isArray(mesh.material)
              ? mesh.material.map(clip)
              : clip(mesh.material);
          }
        });
        group.add(tree);
      }
    }
  }

  return {
    group,
    update(): void {
      // still air over still water: the fountain holds its pose, the global
      // wind shader sways the modeled foliage
    },
  };
}
