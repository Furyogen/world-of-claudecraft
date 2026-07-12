// Infernal Abyss authored dressing. The room graph and collision radii live in
// sim/dungeon_layout.ts; this module only turns those decor records into visuals.
import * as THREE from 'three';
import type { DungeonLayout } from '../sim/dungeon_layout';
import type { AuthoredDecor } from '../sim/dungeon_rooms';
import { loadGltf } from './assets/loader';
import { registerPreload } from './assets/preload';
import { sharedUniforms } from './gfx';

const PROP_URLS: Record<string, string> = {
  abyssal_heart_altar: 'models/props/abyssal_heart_altar.glb',
  infernal_forge_anvil: 'models/props/infernal_forge_anvil.glb',
  chained_demon_obelisk: 'models/props/chained_demon_obelisk.glb',
  lost_armory_weapon_rack: 'models/props/lost_armory_weapon_rack.glb',
  lava_brazier: 'models/props/lava_brazier.glb',
};

const sources = new Map<string, THREE.Object3D>();
let assetsPromise: Promise<void> | null = null;
let lavaMat: THREE.ShaderMaterial | null = null;
let poolGeo: THREE.CircleGeometry | null = null;
let fissureGeo: THREE.PlaneGeometry | null = null;

export function ensureInfernalAbyssAssets(): Promise<void> {
  assetsPromise ??= Promise.all(
    Object.entries(PROP_URLS).map(async ([key, url]) => {
      const gltf = await loadGltf(url);
      sources.set(key, gltf.scene);
    }),
  ).then(() => undefined);
  return assetsPromise;
}

if (typeof window !== 'undefined') registerPreload(ensureInfernalAbyssAssets());

function lavaMaterial(): THREE.ShaderMaterial {
  if (lavaMat) return lavaMat;
  lavaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      #include <fog_pars_vertex>
      void main() {
        vP = position.xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vP;
      #include <fog_pars_fragment>
      void main() {
        float a = sin(vP.x * 1.25 + uTime * 0.9 + sin(vP.y * 0.7));
        float b = cos(vP.y * 1.05 - uTime * 0.65 + sin(vP.x * 0.55));
        float crust = smoothstep(0.15, 0.78, abs(a * b));
        float pulse = 0.78 + 0.22 * sin(uTime * 1.6 + vP.x * 0.3 + vP.y * 0.2);
        vec3 hot = vec3(1.0, 0.28, 0.015) * pulse;
        vec3 dark = vec3(0.16, 0.012, 0.004);
        gl_FragColor = vec4(mix(hot, dark, crust), 0.96);
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  return lavaMat;
}

function placeLava(group: THREE.Group, decor: AuthoredDecor, lowGfx: boolean): void {
  const scale = decor.scale ?? 1;
  let geometry: THREE.BufferGeometry;
  if (decor.key === 'lava_pool') {
    poolGeo ??= new THREE.CircleGeometry(5, 40).rotateX(-Math.PI / 2);
    geometry = poolGeo;
  } else {
    fissureGeo ??= new THREE.PlaneGeometry(2.2, 10, 1, 1).rotateX(-Math.PI / 2);
    geometry = fissureGeo;
  }
  const mesh = new THREE.Mesh(geometry, lavaMaterial());
  mesh.position.set(decor.x, 0.035, decor.z);
  mesh.rotation.y = decor.yaw;
  mesh.scale.setScalar(scale);
  mesh.renderOrder = 1;
  group.add(mesh);
  if (!lowGfx) {
    const light = new THREE.PointLight(0xff4a12, 22 * Math.min(1.8, scale), 22 + scale * 6, 2);
    light.position.set(decor.x, 1.1, decor.z);
    light.userData.baseIntensity = light.intensity;
    group.add(light);
  }
}

function placeProp(group: THREE.Group, decor: AuthoredDecor, lowGfx: boolean): void {
  const source = sources.get(decor.key);
  if (!source) return;
  const model = source.clone(true);
  model.position.set(decor.x, 0, decor.z);
  model.rotation.y = decor.yaw;
  model.scale.setScalar(decor.scale ?? 1);
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = !lowGfx;
    node.receiveShadow = true;
  });
  group.add(model);
}

export function placeInfernalAbyssDressing(
  group: THREE.Group,
  layout: DungeonLayout,
  lowGfx: boolean,
): void {
  for (const decor of layout.decor ?? []) {
    if (decor.key === 'lava_pool' || decor.key === 'lava_fissure') {
      placeLava(group, decor, lowGfx);
    } else {
      placeProp(group, decor, lowGfx);
    }
  }
}
