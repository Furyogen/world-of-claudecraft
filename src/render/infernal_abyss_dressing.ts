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
    // fog: true + the fog GLSL chunks require the fog uniforms to exist:
    // refreshFogUniforms writes fogColor/fogNear/fogFar (or fogDensity) every
    // frame and crashes the whole render loop on a material that lacks them.
    // uTime stays the LIVE shared object (never cloned) so the lava animates.
    uniforms: {
      uTime: sharedUniforms.uTime,
      fogColor: { value: new THREE.Color(0x140406) },
      fogNear: { value: 1 },
      fogFar: { value: 120 },
      fogDensity: { value: 0.00025 },
    },
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

// Brazier light on the pillar-torch contract (see dungeon.ts addPillarTorch):
// initial intensity 10, budget-managed via userData.baseIntensity on high tier,
// short throw on low. The braziers are the interior's primary light source; the
// lava lights below are the bonus ember wash.
const BRAZIER_LIGHT_COLOR = 0xff7a2a;
const BRAZIER_LIGHT_Y = 2.8;
const BRAZIER_LIGHT_DISTANCE = 34;
const BRAZIER_LIGHT_DISTANCE_LOW = 22;
const BRAZIER_LIGHT_INTENSITY_HIGH = 46;
// A dim warm ember ambient so no room reads pure black away from a light
// source (the global underground hemi is a cold 0.22). High tier only: low
// gfx never applies the underground dimming, so it is already readable.
const EMBER_HEMI_SKY = 0x8a3a1e;
const EMBER_HEMI_GROUND = 0x140505;
const EMBER_HEMI_INTENSITY = 0.5;

function placeLava(
  group: THREE.Group,
  decor: AuthoredDecor,
  lowGfx: boolean,
  fireLights: THREE.PointLight[],
): void {
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
    // Join the renderer's ranked point-light budget: an unbudgeted light
    // inflates numPointLights and recompiles every lit material as it streams.
    fireLights.push(light);
  }
}

function placeProp(
  group: THREE.Group,
  decor: AuthoredDecor,
  lowGfx: boolean,
  fireLights: THREE.PointLight[],
): void {
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
  if (decor.key === 'lava_brazier') {
    const light = new THREE.PointLight(
      BRAZIER_LIGHT_COLOR,
      10,
      lowGfx ? BRAZIER_LIGHT_DISTANCE_LOW : BRAZIER_LIGHT_DISTANCE,
      2,
    );
    if (!lowGfx) light.userData.baseIntensity = BRAZIER_LIGHT_INTENSITY_HIGH;
    light.position.set(decor.x, BRAZIER_LIGHT_Y, decor.z);
    group.add(light);
    fireLights.push(light);
  }
}

export function placeInfernalAbyssDressing(
  group: THREE.Group,
  layout: DungeonLayout,
  lowGfx: boolean,
  fireLights: THREE.PointLight[],
): void {
  for (const decor of layout.decor ?? []) {
    if (decor.key === 'lava_pool' || decor.key === 'lava_fissure') {
      placeLava(group, decor, lowGfx, fireLights);
    } else {
      placeProp(group, decor, lowGfx, fireLights);
    }
  }
  if (!lowGfx) {
    const ember = new THREE.HemisphereLight(
      EMBER_HEMI_SKY,
      EMBER_HEMI_GROUND,
      EMBER_HEMI_INTENSITY,
    );
    group.add(ember);
  }
}
