// The Palmreach's dressing: the three shipped beach-palm models instanced over
// the beach shelf, giant vine-hung banyans at the greatTrees spots (the same
// records the sim's trunk colliders use), and vine curtains under their crowns.
// The palms' placement AND their trunk colliders come from reachPalmSpots(seed)
// in world.ts, so what you see on the strand is exactly what the sim blocks.
// Same contract as the sibling realm modules: build once, update(time) animates
// gently.
import * as THREE from 'three';
import { PALMREACH_PROPS } from '../sim/content/palmreach';
import { hash2 } from '../sim/rng';
import { type ReachPalm, reachPalmSpots, terrainHeight, WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { GFX } from './gfx';

export interface JungleFeaturesView {
  group: THREE.Group;
  update(time: number): void;
}

// The three beach-palm models, instanced per variant so the whole strand is a
// handful of draws. Preloaded at import; buildJungleFeatures reads the cache.
const PALM_URLS = [
  '/models/biome/beach_palm_1.glb',
  '/models/biome/beach_palm_2.glb',
  '/models/biome/beach_palm_3.glb',
];
const palmScenes: (THREE.Group | null)[] = [null, null, null];
PALM_URLS.forEach((url, i) => {
  registerPreload(
    loadGltf(url).then((gltf) => {
      palmScenes[i] = gltf.scene;
    }),
  );
});

interface PalmPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

// Bake a preloaded palm GLB into instanceable parts. The shipped models are
// meshopt-quantized, so attributes are converted to float32 before the node
// transform is folded into the geometry — writing world-space values back into
// normalized int16 attributes would clip (same recipe as foliage.ts).
function bakePalmParts(scene: THREE.Group): PalmPart[] {
  scene.updateMatrixWorld(true);
  const parts: PalmPart[] = [];
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry;
    const geo = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const attr = src.getAttribute(name);
      if (!attr) continue;
      const out = new Float32Array(attr.count * attr.itemSize);
      for (let i = 0; i < attr.count; i++)
        for (let j = 0; j < attr.itemSize; j++)
          out[i * attr.itemSize + j] = attr.getComponent(i, j);
      geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
    }
    if (src.index) geo.setIndex(src.index.clone());
    geo.applyMatrix4(mesh.matrixWorld);
    parts.push({ geometry: geo, material: mesh.material });
  });
  return parts;
}

// The banyans reuse the twisted-elder model the Hollow's centerpiece and the
// Wraithwood's giants wear (already preloaded twice over, so free), regrown
// lush and hung with vines.
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

export function buildJungleFeatures(seed: number): JungleFeaturesView {
  const group = new THREE.Group();
  group.name = 'jungle-features';

  // --- the palms: the three beach models instanced across the strand, each
  // at the deterministic spot (world.ts) the sim also gives a trunk collider,
  // so the strand you walk matches the one the sim blocks ---
  {
    const byVariant: ReachPalm[][] = [[], [], []];
    for (const sp of reachPalmSpots(seed)) byVariant[sp.variant]?.push(sp);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    byVariant.forEach((list, variant) => {
      const scene = palmScenes[variant];
      if (!scene || list.length === 0) return;
      for (const part of bakePalmParts(scene)) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((sp, i) => {
          q.setFromAxisAngle(up, sp.rot);
          v.set(sp.x, sp.y, sp.z);
          sc.set(sp.scale, sp.scale, sp.scale);
          mesh.setMatrixAt(i, m.compose(v, q, sc));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    });
  }

  // --- the banyans: the twisted elder regrown lush, hung with vines ---
  {
    const lushened = new Map<string, THREE.Material>();
    const lushen = (source: THREE.Material): THREE.Material => {
      let m2 = lushened.get(source.uuid);
      if (!m2) {
        m2 = source.clone();
        const c = (m2 as THREE.MeshStandardMaterial).color;
        if (c) c.multiply(new THREE.Color(0.75, 1.05, 0.7));
        lushened.set(source.uuid, m2);
      }
      return m2;
    };
    const vineGeo = new THREE.CylinderGeometry(0.05, 0.028, 1, 3);
    vineGeo.translate(0, -0.5, 0); // hangs from its anchor
    const vineMat = mat(0x4a8c46, 0.9);
    const vineSpots: { x: number; z: number; y: number; s: number; rot: number }[] = [];
    const trees = PALMREACH_PROPS.greatTrees ?? [];
    if (greatTreeScene) {
      for (const t of trees) {
        const y = terrainHeight(t.x, t.z, seed);
        if (y < WATER_LEVEL) continue;
        const tree = greatTreeScene.clone(true);
        const scale = t.r * (2.5 + hash2(t.x, t.z, seed + 5201) * 0.5);
        tree.position.set(t.x, y - 0.2, t.z);
        tree.scale.setScalar(scale);
        tree.rotation.y = hash2(t.z, t.x, seed + 5211) * Math.PI * 2;
        tree.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.material = Array.isArray(mesh.material)
              ? mesh.material.map(lushen)
              : lushen(mesh.material);
          }
        });
        group.add(tree);
        // the vine curtain: strands hung in a ring under the crown
        const crownR = scale * 1.6;
        const crownY = y + scale * 2.6;
        const strands = 10 + Math.floor(hash2(t.x, t.z, seed + 5221) * 6);
        for (let k = 0; k < strands; k++) {
          const ang = (k / strands) * Math.PI * 2 + hash2(k, t.x, seed + 5231);
          const rad = crownR * (0.5 + hash2(k, t.z, seed + 5241) * 0.5);
          const len = 4 + hash2(t.x + k, t.z - k, seed + 5251) * 6;
          vineSpots.push({
            x: t.x + Math.sin(ang) * rad,
            z: t.z + Math.cos(ang) * rad,
            y: crownY + hash2(k, k + 1, seed + 5261) * scale * 0.8,
            s: len,
            rot: 0,
          });
        }
      }
    }
    // vines scale on Y only: compose with a per-instance non-uniform scale
    if (vineSpots.length > 0) {
      const mesh = new THREE.InstancedMesh(vineGeo, vineMat, vineSpots.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      vineSpots.forEach((sp, i) => {
        v.set(sp.x, sp.y, sp.z);
        sc.set(1, sp.s, 1);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  return {
    group,
    update(): void {
      // still air: the global wind shader sways the modeled foliage; the
      // strand itself holds its pose
    },
  };
}
