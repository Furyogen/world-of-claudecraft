import * as THREE from 'three';
import { ATLANTIS_LAYOUT } from '../sim/content/atlantis';
import { WATER_LEVEL, zoneBiomeAt } from '../sim/world';

// Ambient sea-beasts for Atlantis — RENDER-ONLY decoration, no sim/IWorld
// state. Serpentine silhouettes circle the open water outside the dome glass:
// a head and a trail of back-humps that arc through the surface like a sea
// serpent swimming its rounds. Same contract as birds/fish/critters: a fixed
// pool, deterministic placement (mulberry32 off the world seed — the render
// convention forbids Math.random), hidden entirely outside the abyss biome.

const SERPENT_COUNT = 3;
const HUMPS_PER_SERPENT = 4;
const HUMP_SPACING = 0.34; // radians of path arc between humps
const VISIBLE_RANGE = 320; // hide the whole group when the player is far away

export interface SealifeView {
  group: THREE.Group;
  update(px: number, pz: number, dt: number): void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Serpent {
  parts: THREE.Mesh[]; // head first, then humps
  pathR: number;
  speed: number; // radians/second along the circle
  angle: number;
  bobPhase: number;
}

export function buildSealife(seed: number): SealifeView {
  const group = new THREE.Group();
  group.visible = false;
  const rng = mulberry32((seed ^ 0x5ea11fe) >>> 0);
  const L = ATLANTIS_LAYOUT;

  const hide = new THREE.MeshStandardMaterial({
    color: 0x142f38,
    roughness: 0.55,
    metalness: 0.05,
    emissive: 0x06222c,
    emissiveIntensity: 0.5,
  });
  const headGeo = new THREE.ConeGeometry(0.9, 2.6, 8);
  headGeo.rotateX(Math.PI / 2); // nose forward along +z of the mesh
  const humpGeo = new THREE.SphereGeometry(1.0, 10, 8);

  const serpents: Serpent[] = [];
  for (let i = 0; i < SERPENT_COUNT; i++) {
    const parts: THREE.Mesh[] = [];
    const head = new THREE.Mesh(headGeo, hide);
    head.scale.setScalar(1.15 + rng() * 0.5);
    parts.push(head);
    group.add(head);
    for (let k = 0; k < HUMPS_PER_SERPENT; k++) {
      const hump = new THREE.Mesh(humpGeo, hide);
      const s = 1.25 - k * 0.18;
      hump.scale.set(s, s * 0.75, s * 1.25);
      parts.push(hump);
      group.add(hump);
    }
    serpents.push({
      parts,
      pathR: L.dome.r + 14 + i * 9 + rng() * 4,
      speed: (0.05 + rng() * 0.05) * (rng() < 0.5 ? 1 : -1),
      angle: rng() * Math.PI * 2,
      bobPhase: rng() * Math.PI * 2,
    });
  }

  function update(px: number, pz: number, dt: number): void {
    const near =
      zoneBiomeAt(pz) === 'abyss' && Math.hypot(px - L.dome.x, pz - L.dome.z) < VISIBLE_RANGE;
    group.visible = near;
    if (!near) return;
    for (const s of serpents) {
      s.angle += s.speed * dt;
      s.bobPhase += dt * 0.9;
      for (let k = 0; k < s.parts.length; k++) {
        const a = s.angle - k * HUMP_SPACING * Math.sign(s.speed);
        const x = L.dome.x + Math.sin(a) * s.pathR;
        const z = L.dome.z + Math.cos(a) * s.pathR;
        // backs arc through the waterline; troughs sink out of sight
        const y = WATER_LEVEL - 0.7 + Math.sin(s.bobPhase + k * 0.9) * 1.0;
        const part = s.parts[k];
        part.position.set(x, y, z);
        // face along the direction of travel (tangent of the circle)
        const ta = a + (Math.PI / 2) * Math.sign(s.speed);
        part.rotation.y = Math.atan2(Math.sin(ta), Math.cos(ta));
      }
    }
  }

  return { group, update };
}
