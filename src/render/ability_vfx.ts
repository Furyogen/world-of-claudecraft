// Spec-driven per-ability VFX — the in-game port of the gallery prototype
// (/arc_bolt_preview.js), vertical slice: shaman kit only, behind the
// "Ability VFX (beta)" settings toggle. Everything else falls through to the
// legacy Vfx ladder in renderer.ts.
//
// Hardening contract (docs/ability-vfx-gallery.md, Phase B):
// - pooled meshes/sprites, preallocated scratch vectors, no per-frame allocs on
//   steady-state paths (bolt-shape regen is throttled to ~33 Hz and bounded);
// - zero owned point lights — flashes ride the shared LightPulses pool via
//   pulseAt; particles ride the shared Vfx points pool (quality-governed);
// - HDR colors gate on GFX.composer (read lazily — initGfxTier reassigns GFX);
// - null anchors fail soft (interest streaming: events can precede views);
// - bookkeeping maps are pruned; clear() releases transients for prewarm.
//
// Event keying (renderer-side only — no sim/parity changes in this slice):
// - timed/channeled casts: castStart carries the ability id; a `justDone`
//   grace map survives the castStop→spellfx same-tick ordering;
// - instants: (school, fx) disambiguates within the shaman kit;
// - weaponAura/shout spellfx already carry `ability`.
import * as THREE from 'three';
import { GFX } from './gfx';
import type { Vfx } from './vfx';
import type { SimEvent, Entity } from '../sim/types';
import {
  ABILITY_VFX_SPECS,
  AURA_NAME_TO_ID,
  SLICE_ABILITY_IDS,
  type AbilityVfxSpec,
} from './ability_vfx_specs.generated';

type AnchorFn = (id: number, heightFrac: number) => THREE.Vector3 | null;
type PulseFn = (id: number, school: string, intensity: number, duration: number) => void;
type GetEntityFn = (id: number) => Entity | undefined;

const hdr = (k: number) => (GFX.composer ? k : 1);

// ---------------------------------------------------------------- palettes
interface Pal { core: THREE.Color; main: THREE.Color; glow: THREE.Color; ion: THREE.Color; accent: THREE.Color }
const WHITE = new THREE.Color(0xffffff);
function makePal(mainHex: number, accentHex: number): Pal {
  const main = new THREE.Color(mainHex);
  return {
    main,
    core: main.clone().lerp(WHITE, 0.78),
    glow: main.clone().multiplyScalar(0.5),
    ion: main.clone().lerp(WHITE, 0.45),
    accent: new THREE.Color(accentHex),
  };
}
const PALETTES: Record<string, Pal> = {
  physical: makePal(0xdfe6ee, 0xb8c4d2),
  fire: makePal(0xff7a2a, 0xffd23e),
  frost: makePal(0x8ed2ff, 0xe8f6ff),
  nature: makePal(0x86e86a, 0xc8f09a),
  storm: {
    main: new THREE.Color(0x5aa4ff),
    core: new THREE.Color(0xd8ecff),
    glow: new THREE.Color(0x2c62e0),
    ion: new THREE.Color(0x9fd0ff),
    accent: new THREE.Color(0x8fd6ff),
  },
  holy: makePal(0xffe9a0, 0xffc85e),
  shadow: makePal(0x9a5df0, 0x5d2fa8),
  arcane: makePal(0xd98aff, 0x8a6cff),
  blood: makePal(0xff5a4d, 0xb8241a),
  moon: makePal(0xcfd6ff, 0x9a8cff),
  venom: makePal(0xb8e83e, 0x6a9a1a),
  gold: makePal(0xffd76a, 0xffb02e),
};
function palFor(spec: AbilityVfxSpec | undefined, school: string): Pal {
  const base = PALETTES[spec?.palette ?? school] ?? PALETTES.physical;
  if (!spec?.tint && !spec?.hot) return base;
  const p: Pal = { core: base.core.clone(), main: base.main.clone(), glow: base.glow.clone(), ion: base.ion.clone(), accent: base.accent.clone() };
  if (spec.tint) {
    const tc = new THREE.Color(spec.tint);
    p.main.lerp(tc, 0.65);
    p.ion.lerp(tc, 0.45);
    p.glow.lerp(tc, 0.5);
  }
  if (spec.hot) {
    p.core.lerp(WHITE, spec.hot);
    p.main.lerp(WHITE, spec.hot * 0.4);
  }
  return p;
}

// ---------------------------------------------------------------- textures
function canvasTex(size: number, paint: (g: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  paint(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function glowTex(): THREE.Texture {
  return canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
}
function noiseTex(): THREE.Texture {
  return canvasTex(128, (g, s) => {
    const img = g.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 220;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}
function runeTex(): THREE.Texture {
  return canvasTex(256, (g, s) => {
    const c = s / 2;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 4;
    g.beginPath(); g.arc(c, c, c - 8, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.arc(c, c, c - 26, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = c - 24, r1 = c - 10;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      g.stroke();
      // small glyph strokes on the inner ring
      const ga = a + 0.13;
      g.beginPath();
      g.moveTo(c + Math.cos(ga) * (r0 - 14), c + Math.sin(ga) * (r0 - 14));
      g.lineTo(c + Math.cos(ga) * (r0 - 4), c + Math.sin(ga) * (r0 - 4));
      g.stroke();
    }
  });
}

// ---------------------------------------------------------------- ribbons
// One mesh, one draw call, rebuilt between begin()/commit(); drawRange 0 when
// empty so the stale tail costs nothing (same discipline as the gallery).
const RIB_MAXV = 2048;
const RIB_MAXI = RIB_MAXV * 3;
class RibbonBatch {
  geo = new THREE.BufferGeometry();
  pos = new Float32Array(RIB_MAXV * 3);
  col = new Float32Array(RIB_MAXV * 3);
  idx = new Uint16Array(RIB_MAXI);
  mesh: THREE.Mesh;
  v = 0;
  i = 0;
  private wasEmpty = true;
  private t1 = new THREE.Vector3();
  private t2 = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  constructor(scene: THREE.Scene, private camera: THREE.Camera) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.userData.renderCategory = 'vfx';
    scene.add(this.mesh);
  }
  begin(): void { this.v = 0; this.i = 0; }
  add(pts: THREE.Vector3[], width: number, color: THREE.Color, mul: number, taper = 1): void {
    const n = pts.length;
    if (n < 2 || this.v + n * 2 > RIB_MAXV || this.i + (n - 1) * 6 > RIB_MAXI) return;
    this.camera.getWorldPosition(this.camPos);
    const base = this.v;
    for (let k = 0; k < n; k++) {
      const p = pts[k];
      this.t1.subVectors(pts[Math.min(n - 1, k + 1)], pts[Math.max(0, k - 1)]);
      this.t2.subVectors(this.camPos, p);
      this.t1.cross(this.t2).normalize();
      const u = k / (n - 1);
      const pinch = taper > 0 ? Math.min(1, 4 * u * (1 - u) + (1 - taper)) : 1;
      const w = width * pinch * 0.5;
      const vi = (base + k * 2) * 3;
      this.pos[vi] = p.x + this.t1.x * w; this.pos[vi + 1] = p.y + this.t1.y * w; this.pos[vi + 2] = p.z + this.t1.z * w;
      this.pos[vi + 3] = p.x - this.t1.x * w; this.pos[vi + 4] = p.y - this.t1.y * w; this.pos[vi + 5] = p.z - this.t1.z * w;
      const r = color.r * mul, g = color.g * mul, b = color.b * mul;
      this.col[vi] = r; this.col[vi + 1] = g; this.col[vi + 2] = b;
      this.col[vi + 3] = r; this.col[vi + 4] = g; this.col[vi + 5] = b;
    }
    for (let k = 0; k < n - 1; k++) {
      const a = base + k * 2;
      this.idx[this.i++] = a; this.idx[this.i++] = a + 1; this.idx[this.i++] = a + 2;
      this.idx[this.i++] = a + 1; this.idx[this.i++] = a + 3; this.idx[this.i++] = a + 2;
    }
    this.v += n * 2;
  }
  commit(): void {
    const empty = this.i === 0;
    if (empty) {
      if (!this.wasEmpty) { this.wasEmpty = true; this.geo.setDrawRange(0, 0); }
      return;
    }
    this.wasEmpty = false;
    const up = (attr: THREE.BufferAttribute, count: number) => {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, count);
      attr.needsUpdate = true;
    };
    up(this.geo.attributes.position as THREE.BufferAttribute, this.v * 3);
    up(this.geo.attributes.color as THREE.BufferAttribute, this.v * 3);
    up(this.geo.index as THREE.BufferAttribute, this.i);
    this.geo.setDrawRange(0, this.i);
  }
  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// jagged bolt generator — midpoint displacement + recursive branches.
// Allocates, but only on throttled regens (~33 Hz per live bolt), never per frame.
interface BoltLine { pts: THREE.Vector3[]; intensity: number }
function genBolt(a: THREE.Vector3, b: THREE.Vector3, opts: { jag?: number; subdiv?: number; branchP?: number; depth?: number; branchScale?: number } = {}, out: BoltLine[] = [], intensity = 1): BoltLine[] {
  const { jag = 0.14, subdiv = 4, branchP = 0.3, depth = 1, branchScale = 0.42 } = opts;
  let pts = [a.clone(), b.clone()];
  const totalLen = a.distanceTo(b);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const perp1 = new THREE.Vector3(dir.y, -dir.x + 0.31, dir.z + 0.17).cross(dir).normalize();
  const perp2 = new THREE.Vector3().crossVectors(dir, perp1);
  let amp = totalLen * jag;
  for (let s = 0; s < subdiv; s++) {
    const next = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const mid = pts[k].clone().lerp(pts[k + 1], 0.5);
      mid.addScaledVector(perp1, (Math.random() - 0.5) * amp);
      mid.addScaledVector(perp2, (Math.random() - 0.5) * amp);
      next.push(mid, pts[k + 1]);
      if (depth > 0 && Math.random() < branchP) {
        const bEnd = mid.clone()
          .addScaledVector(perp1, (Math.random() - 0.5) * totalLen * branchScale)
          .addScaledVector(perp2, (Math.random() - 0.5) * totalLen * branchScale)
          .addScaledVector(dir, totalLen * 0.15 * Math.random());
        genBolt(mid, bEnd, { jag, subdiv: Math.max(1, subdiv - 2), branchP: branchP * 0.5, depth: depth - 1, branchScale }, out, intensity * 0.45);
      }
    }
    pts = next;
    amp *= 0.55;
  }
  out.push({ pts, intensity });
  return out;
}

// ---------------------------------------------------------------- ring pool
const RING_SHADER = {
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform float uProgress; uniform vec3 uColor; uniform float uIntensity; uniform sampler2D uNoise;
    varying vec2 vUv;
    void main(){
      vec2 d2 = vUv - 0.5;
      float d = length(d2) * 2.0;
      float ang = atan(d2.y, d2.x + 1e-6);
      float band = smoothstep(uProgress - 0.32, uProgress - 0.06, d) * (1.0 - smoothstep(uProgress - 0.03, uProgress, d));
      float n = texture2D(uNoise, vec2(ang * 0.6366, d * 1.4 - uProgress * 0.35)).r;
      band *= smoothstep(0.18, 0.62, n + (1.0 - uProgress) * 0.45);
      float fade = pow(1.0 - uProgress, 1.35);
      vec3 col = uColor * uIntensity * (0.6 + 1.6 * band);
      gl_FragColor = vec4(col * band * fade, band * fade);
    }`,
};
interface RingSlot { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; age: number; dur: number; live: boolean }
class RingPool {
  slots: RingSlot[] = [];
  constructor(scene: THREE.Scene, noise: THREE.Texture, count = 10) {
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uProgress: { value: 1 }, uColor: { value: new THREE.Color() }, uIntensity: { value: 1 }, uNoise: { value: noise } },
        ...RING_SHADER,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      mesh.userData.renderCategory = 'vfx';
      scene.add(mesh);
      this.slots.push({ mesh, mat, age: 0, dur: 1, live: false });
    }
  }
  spawn(pos: THREE.Vector3, maxR: number, dur: number, color: THREE.Color, intensity: number, vertical: boolean, camera: THREE.Camera): void {
    const s = this.slots.find((x) => !x.live) ?? this.slots.reduce((a, b) => (a.age / a.dur > b.age / b.dur ? a : b));
    s.live = true;
    s.age = 0;
    s.dur = dur;
    s.mesh.position.copy(pos);
    if (vertical) s.mesh.quaternion.copy(camera.quaternion);
    else s.mesh.rotation.set(-Math.PI / 2, 0, 0);
    s.mesh.scale.setScalar(maxR * 2);
    s.mat.uniforms.uColor.value.copy(color);
    s.mat.uniforms.uIntensity.value = intensity;
    s.mat.uniforms.uProgress.value = 0;
    s.mesh.visible = true;
  }
  update(dt: number): void {
    for (const s of this.slots) {
      if (!s.live) continue;
      s.age += dt;
      const t = Math.min(1, s.age / s.dur);
      s.mat.uniforms.uProgress.value = 1 - Math.pow(1 - t, 4);
      if (t >= 1) { s.live = false; s.mesh.visible = false; }
    }
  }
  clear(): void { for (const s of this.slots) { s.live = false; s.mesh.visible = false; } }
  dispose(scene: THREE.Scene): void {
    for (const s of this.slots) { scene.remove(s.mesh); s.mat.dispose(); }
    this.slots[0]?.mesh.geometry.dispose();
  }
}

// ---------------------------------------------------------------- module
interface LiveBolt {
  from: THREE.Vector3; targetId: number; pos: THREE.Vector3; dir: THREE.Vector3;
  spec: AbilityVfxSpec; pal: Pal; school: string; speed: number;
  cache: BoltLine[] | null; cacheAnchor: THREE.Vector3; flick: number; coil: number;
  head: THREE.Sprite;
}
interface TransientBolt { lines: BoltLine[]; life: number; maxLife: number; width: number; pal: Pal; mul: number }
interface CastFx { ability: string; spec: AbilityVfxSpec; pal: Pal; school: string; t: number; dur: number; rune: THREE.Mesh | null }
interface Residual { targetId: number; pal: Pal; left: number; arcT: number }
interface BuffFx { entityId: number; ability: string; pal: Pal; orbit: string; left: number; sprites: THREE.Sprite[]; phase: number; arcT: number }

const CAST_HEIGHT = 0.62;
const CHEST = 0.55;
const JUSTDONE_TTL = 1.2;
// instant-ability keying inside the shaman kit: (school|fx) → ability id
const INSTANT_KEY: Record<string, string> = {
  'fire|projectile': 'flame_shock',
  'frost|projectile': 'frost_shock',
  'nature|projectile': 'earth_shock',
};

export class AbilityVfx {
  quality = 1;
  private castMap = new Map<number, CastFx>();
  private justDone = new Map<number, { ability: string; left: number }>();
  private bolts: LiveBolt[] = [];
  private transients: TransientBolt[] = [];
  private residuals: Residual[] = [];
  private buffs = new Map<string, BuffFx>();
  private ribbons: RibbonBatch;
  private rings: RingPool;
  private texGlow: THREE.Texture;
  private texNoise: THREE.Texture;
  private texRune: THREE.Texture;
  private spritePool: THREE.Sprite[] = [];
  private runePool: THREE.Mesh[] = [];
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  // Live counters for E2E probes / diagnostics — one persistent object,
  // mutated in place each frame (never re-created).
  private debug = { bolts: 0, buffs: 0, ribV: 0, ribVMax: 0, frames: 0 };

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private anchor: AnchorFn,
    private getEntity: GetEntityFn,
    private ground: (x: number, z: number) => number,
    private pulseAt: PulseFn,
    private vfx: Vfx,
  ) {
    this.texGlow = glowTex();
    this.texNoise = noiseTex();
    this.texRune = runeTex();
    (globalThis as { __abilityVfxLive?: object }).__abilityVfxLive = this.debug;
    this.ribbons = new RibbonBatch(scene, camera);
    this.rings = new RingPool(scene, this.texNoise);
    for (let i = 0; i < 20; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.texGlow, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, opacity: 0,
      }));
      s.visible = false;
      s.userData.renderCategory = 'vfx';
      scene.add(s);
      this.spritePool.push(s);
    }
    const runeGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(runeGeo, new THREE.MeshBasicMaterial({
        map: this.texRune, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, opacity: 0,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 3;
      m.userData.renderCategory = 'vfx';
      scene.add(m);
      this.runePool.push(m);
    }
  }

  setQuality(q: number): void { this.quality = Math.max(0.3, Math.min(1, q)); }

  private takeSprite(): THREE.Sprite | null {
    const s = this.spritePool.find((x) => !x.visible) ?? null;
    if (s) s.visible = true;
    return s;
  }
  private freeSprite(s: THREE.Sprite): void {
    s.visible = false;
    (s.material as THREE.SpriteMaterial).opacity = 0;
  }
  private specFor(id: string | undefined): AbilityVfxSpec | undefined {
    return id && SLICE_ABILITY_IDS.has(id) ? ABILITY_VFX_SPECS[id] : undefined;
  }

  // ---------------------------------------------------------------- events
  onCastStart(ev: Extract<SimEvent, { type: 'castStart' }>): void {
    const spec = this.specFor(ev.ability);
    if (!spec) return;
    const e = this.getEntity(ev.entityId);
    const school = ABILITY_VFX_SPECS[ev.ability]?.palette ?? 'nature';
    const cast: CastFx = { ability: ev.ability, spec, pal: palFor(spec, school), school, t: 0, dur: ev.time, rune: null };
    if (e && (spec.windupStyle === 'runes' || (spec.windup ?? 0) >= 1.2)) {
      const rune = this.runePool.find((r) => !r.visible) ?? null;
      if (rune) {
        rune.position.set(e.pos.x, this.ground(e.pos.x, e.pos.z) + 0.06, e.pos.z);
        rune.scale.setScalar(4.2);
        (rune.material as THREE.MeshBasicMaterial).color.copy(cast.pal.main).multiplyScalar(hdr(1.7));
        (rune.material as THREE.MeshBasicMaterial).opacity = 0;
        rune.visible = true;
        cast.rune = rune;
      }
    }
    this.castMap.set(ev.entityId, cast);
  }

  onCastStop(ev: Extract<SimEvent, { type: 'castStop' }>): void {
    const cast = this.castMap.get(ev.entityId);
    if (!cast) return;
    this.castMap.delete(ev.entityId);
    if (cast.rune) {
      (cast.rune.material as THREE.MeshBasicMaterial).opacity = 0;
      cast.rune.visible = false;
    }
    if (!ev.success) return;
    this.justDone.set(ev.entityId, { ability: cast.ability, left: JUSTDONE_TTL });
    // self-staged completions (heals/buffs) fire here — no spellfx needed
    if (cast.spec.archetype === 'heal' || cast.spec.archetype === 'buff') {
      const at = this.anchor(ev.entityId, CHEST);
      if (at) {
        this.rings.spawn(this.v1.set(at.x, at.y - 1.1, at.z), 2.4, 0.7, cast.pal.main, hdr(1.3), false, this.camera);
        this.vfx.healGlow(ev.entityId);
        this.pulseAt(ev.entityId, cast.school, 4 * (cast.spec.power ?? 1), 0.5);
      }
      this.startBuffOrbit(ev.entityId, cast.ability, cast.spec, cast.pal);
    }
  }

  /**
   * Aura lifecycle → buff orbit lifetime. Sim `aura` events carry the English
   * ability name; slice buffs start their orbit on gain (covers instants like
   * weapon imbues that emit no spellfx) and fade out when the aura drops, so
   * the visual tracks the buff's real duration. Returns true when this aura
   * belongs to the slice (skip the legacy buff swirl).
   */
  onAura(targetId: number, name: string, gained: boolean): boolean {
    const id = AURA_NAME_TO_ID[name];
    if (!id) return false;
    const spec = ABILITY_VFX_SPECS[id];
    if (!spec?.buff) return false;
    const key = `${targetId}:${id}`;
    if (!gained) {
      const b = this.buffs.get(key);
      if (b) b.left = Math.min(b.left, 0.5); // graceful fade instead of a hard pop
      return true;
    }
    const pal = palFor(spec, spec.palette ?? 'nature');
    if (!this.buffs.has(key)) {
      // celebrate first application (re-applications just refresh the timer)
      const at = this.anchor(targetId, CHEST);
      if (at) {
        this.rings.spawn(this.v1.set(at.x, at.y - 1.1, at.z), 2.1, 0.6, pal.main, hdr(1.3), false, this.camera);
        this.pulseAt(targetId, spec.palette ?? 'nature', 4 * (spec.power ?? 1), 0.45);
      }
    }
    // interest-scope safety net online: if the fade event never arrives, the
    // orbit still dies on its own well past any real buff duration
    this.startBuffOrbit(targetId, id, spec, pal, 3600);
    return true;
  }

  /** Returns true when this event was drawn by the spec path (skip legacy particles). */
  tryHandleSpellfx(ev: Extract<SimEvent, { type: 'spellfx' }>): boolean {
    const src = this.getEntity(ev.sourceId);
    // resolve the ability id: explicit → just-completed cast → kit heuristics
    let id: string | undefined = ev.ability;
    if (!id) {
      const jd = this.justDone.get(ev.sourceId);
      if (jd) id = jd.ability;
    }
    // templateId doubles as the class for player entities (types.ts Entity)
    const srcIsShaman = src?.kind === 'player' && src.templateId === 'shaman';
    if (!id && srcIsShaman) id = INSTANT_KEY[`${ev.school}|${ev.fx}`];
    if (ev.fx === 'chainHeal' && srcIsShaman) id = 'chain_heal';
    const spec = this.specFor(id);
    if (!spec || !id) return false;
    // headless E2E visibility (dev harness only — same pattern as __game)
    (window as unknown as { __abilityVfxHandled?: number }).__abilityVfxHandled =
      ((window as unknown as { __abilityVfxHandled?: number }).__abilityVfxHandled ?? 0) + 1;

    const pal = palFor(spec, ev.school);
    if (ev.fx === 'lightning' || ev.fx === 'projectile' || ev.fx === 'heavyBolt') {
      const from = this.anchor(ev.sourceId, CAST_HEIGHT);
      const to = this.anchor(ev.targetId, CHEST);
      if (!from || !to) return false;
      this.launchBolt(from, ev.targetId, spec, pal, ev.school);
      if (spec.bolt?.leader) this.leaderStroke(from, to, pal);
      return true;
    }
    if (ev.fx === 'chainHeal') {
      const from = this.anchor(ev.sourceId, CAST_HEIGHT);
      const to = this.anchor(ev.targetId, CHEST);
      if (!from || !to) return false;
      this.spawnArc(from, to, pal, 0.22, 0.5);
      this.vfx.healGlow(ev.targetId);
      this.pulseAt(ev.targetId, ev.school, 4, 0.4);
      return true;
    }
    if (ev.fx === 'weaponAura' || ev.fx === 'shout') {
      const at = this.anchor(ev.sourceId, CHEST);
      if (!at) return false;
      this.rings.spawn(this.v1.set(at.x, at.y - 1.1, at.z), (spec.shout?.radius ?? 4) * 0.8, 0.55, pal.main, hdr(1.6), false, this.camera);
      this.pulseAt(ev.sourceId, ev.school, 5, 0.45);
      this.startBuffOrbit(ev.sourceId, id, spec, pal);
      return true;
    }
    if (ev.fx === 'tick' || ev.fx === 'nova') {
      const at = this.anchor(ev.targetId, ev.fx === 'nova' ? 0.15 : CHEST);
      if (!at) return false;
      this.impact(at, ev.targetId, spec, pal, ev.school, ev.fx === 'tick' ? 0.45 : 1);
      return true;
    }
    return false;
  }

  tryHandleSpellfxAt(ev: Extract<SimEvent, { type: 'spellfxAt' }>): boolean {
    const srcId = ev.sourceId ?? -1;
    const jd = this.justDone.get(srcId);
    const spec = this.specFor(jd?.ability);
    if (!spec || spec.archetype !== 'nova') return false;
    const pal = palFor(spec, ev.school);
    const gy = this.ground(ev.x, ev.z);
    const radius = ev.radius ?? spec.nova?.radius ?? 6;
    this.rings.spawn(this.v1.set(ev.x, gy + 0.06, ev.z), radius, 0.6, pal.main, hdr(1.8), false, this.camera);
    this.rings.spawn(this.v2.set(ev.x, gy + 0.06, ev.z), radius * 0.6, 0.5, pal.accent, hdr(1.4), false, this.camera);
    this.v3.set(ev.x, gy + 0.4, ev.z);
    this.vfx.burst(this.v3, ev.school, Math.round(30 * this.quality), 1.4);
    if (ev.sourceId !== undefined) this.pulseAt(ev.sourceId, ev.school, 7, 0.5);
    return true;
  }

  // ---------------------------------------------------------------- pieces
  private launchBolt(from: THREE.Vector3, targetId: number, spec: AbilityVfxSpec, pal: Pal, school: string): void {
    const head = this.takeSprite();
    if (!head) return;
    const mat = head.material as THREE.SpriteMaterial;
    mat.color.copy(pal.core).multiplyScalar(hdr(3));
    mat.opacity = 0.95;
    head.scale.setScalar(0.55 * (spec.bolt?.headScale ?? 1));
    head.position.copy(from);
    this.bolts.push({
      from: from.clone(), targetId, pos: from.clone(), dir: new THREE.Vector3(1, 0, 0),
      spec, pal, school, speed: spec.bolt?.speed ?? 26,
      cache: null, cacheAnchor: from.clone(), flick: 0, coil: 0, head,
    });
  }

  private leaderStroke(from: THREE.Vector3, to: THREE.Vector3, pal: Pal): void {
    this.transients.push({ lines: genBolt(from, to, { jag: 0.16, subdiv: 5, branchP: 0.3, depth: 1 }), life: 0.07, maxLife: 0.07, width: 0.035, pal, mul: hdr(1.6) });
  }

  private spawnArc(from: THREE.Vector3, to: THREE.Vector3, pal: Pal, width: number, life: number): void {
    const mid = from.clone().lerp(to, 0.5);
    mid.y += from.distanceTo(to) * 0.18;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const a = from.clone().lerp(mid, t);
      const b = mid.clone().lerp(to, t);
      pts.push(a.lerp(b, t));
    }
    this.transients.push({ lines: [{ pts, intensity: 1 }], life, maxLife: life, width, pal, mul: hdr(2) });
  }

  private impact(at: THREE.Vector3, targetId: number, spec: AbilityVfxSpec, pal: Pal, school: string, scale: number): void {
    const power = (spec.power ?? 1) * scale;
    const gy = this.ground(at.x, at.z);
    this.rings.spawn(this.v1.set(at.x, gy + 0.06, at.z), 3.6 * power, 0.55, pal.main, hdr(1.7), false, this.camera);
    this.rings.spawn(this.v2.copy(at), 2.6 * power, 0.4, pal.ion, hdr(1.2), true, this.camera);
    this.vfx.burst(at, school, Math.round(26 * power * this.quality), power);
    this.pulseAt(targetId, school, 6 * power, 0.45);
    const storm = (spec.palette ?? school) === 'storm';
    if (storm) {
      this.crawlArcs(targetId, pal, 4);
      if (spec.linger) this.residuals.push({ targetId, pal, left: Math.min(spec.linger, 4), arcT: 0.2 });
    }
  }

  private crawlArcs(targetId: number, pal: Pal, n: number): void {
    const c = this.anchor(targetId, CHEST);
    if (!c) return;
    for (let i = 0; i < n; i++) {
      const a = this.v1.set(c.x + (Math.random() - 0.5) * 0.9, c.y + (Math.random() - 0.6) * 1.6, c.z + (Math.random() - 0.5) * 0.9);
      const b = this.v2.set(c.x + (Math.random() - 0.5) * 0.9, c.y + (Math.random() - 0.6) * 1.6, c.z + (Math.random() - 0.5) * 0.9);
      this.transients.push({ lines: genBolt(a, b, { jag: 0.3, subdiv: 3, branchP: 0.2, depth: 0 }), life: 0.12 + Math.random() * 0.12, maxLife: 0.2, width: 0.04, pal, mul: hdr(2.4) });
    }
  }

  private startBuffOrbit(entityId: number, ability: string, spec: AbilityVfxSpec, pal: Pal, dur?: number): void {
    const orbit = spec.buff?.orbit ?? (spec.palette === 'storm' ? 'sparks' : 'none');
    if (orbit === 'none') return;
    const key = `${entityId}:${ability}`;
    const prev = this.buffs.get(key);
    // aura-driven starts carry the real lifetime; never let a same-tick spellfx
    // restart shorten an orbit the aura event already stretched
    const left = Math.max(prev?.left ?? 0, dur ?? Math.min(20, (spec.linger ?? 8) * 3));
    if (prev) { for (const s of prev.sprites) this.freeSprite(s); }
    const sprites: THREE.Sprite[] = [];
    const n = Math.min(3, Number(spec.buff?.o?.n ?? 3));
    for (let i = 0; i < n; i++) {
      const s = this.takeSprite();
      if (!s) break;
      const m = s.material as THREE.SpriteMaterial;
      m.color.copy(pal.core).multiplyScalar(hdr(2.2));
      m.opacity = 0;
      s.scale.setScalar(Number(spec.buff?.o?.size ?? 0.35));
      sprites.push(s);
    }
    this.buffs.set(key, {
      entityId, ability, pal, orbit,
      left,
      sprites, phase: Math.random() * Math.PI * 2, arcT: 1,
    });
  }

  // ---------------------------------------------------------------- frame
  update(dt: number): void {
    this.ribbons.begin();

    // cast windups
    for (const [id, cast] of this.castMap) {
      cast.t += dt;
      const e = this.getEntity(id);
      if (!e) { this.castMap.delete(id); if (cast.rune) cast.rune.visible = false; continue; }
      const p = Math.min(1, cast.t / Math.max(0.2, cast.dur));
      this.vfx.castSparkle(id, cast.school, dt);
      if (cast.rune) {
        const m = cast.rune.material as THREE.MeshBasicMaterial;
        m.opacity = Math.min(0.85, p * 2) * this.quality;
        cast.rune.rotation.z += dt * 0.45;
        cast.rune.position.set(e.pos.x, this.ground(e.pos.x, e.pos.z) + 0.06, e.pos.z);
      }
    }

    // just-done grace window
    for (const [id, jd] of this.justDone) {
      jd.left -= dt;
      if (jd.left <= 0) this.justDone.delete(id);
    }

    // live bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const to = this.anchor(b.targetId, CHEST);
      if (!to) { this.freeSprite(b.head); this.bolts.splice(i, 1); continue; }
      this.v1.subVectors(to, b.pos);
      const dist = this.v1.length();
      const step = b.speed * dt;
      if (dist <= Math.max(0.5, step)) {
        this.freeSprite(b.head);
        this.bolts.splice(i, 1);
        this.impact(to, b.targetId, b.spec, b.pal, b.school, 1);
        continue;
      }
      this.v1.normalize();
      b.dir.lerp(this.v1, 0.4).normalize();
      b.pos.addScaledVector(b.dir, step);
      b.head.position.copy(b.pos);
      if (b.spec.bolt?.jagged) {
        b.flick -= dt;
        if (!b.cache || b.flick <= 0) {
          b.flick = 0.03;
          const tail = b.pos.clone().addScaledVector(b.dir, -Math.min(3.5, dist * 0.5 + 1));
          b.cache = genBolt(tail, b.pos, { jag: 0.12, subdiv: 4, branchP: 0.3, depth: 1 });
          b.cacheAnchor.copy(b.pos);
        } else {
          this.v2.copy(b.pos).sub(b.cacheAnchor);
          if (this.v2.lengthSq() > 1e-9) {
            for (const line of b.cache) for (const p of line.pts) p.add(this.v2);
            b.cacheAnchor.copy(b.pos);
          }
        }
        for (const line of b.cache) {
          this.ribbons.add(line.pts, 0.3 * line.intensity * this.quality, b.pal.main, hdr(1.4) * line.intensity, 1);
          this.ribbons.add(line.pts, 0.09 * line.intensity * this.quality, b.pal.core, hdr(3) * line.intensity, 1);
        }
      } else {
        // simple comet trail
        this.v2.copy(b.pos).addScaledVector(b.dir, -1.4);
        this.transients.push({ lines: [{ pts: [this.v2.clone(), b.pos.clone()], intensity: 1 }], life: 0.1, maxLife: 0.1, width: 0.18, pal: b.pal, mul: hdr(1.2) });
      }
      if (b.spec.bolt?.coils) {
        b.coil += dt * 9 * Math.PI * 2;
        for (const dir of [1, -1]) {
          const pts: THREE.Vector3[] = [];
          for (let k = 0; k < 12; k++) {
            const u = k / 11;
            const ang = b.coil * dir + u * 7.5 * dir;
            this.v2.copy(b.pos).addScaledVector(b.dir, -u * 1.9);
            this.v3.set(0, 1, 0).cross(b.dir).normalize();
            const up = this.v1.copy(b.dir).cross(this.v3).normalize();
            const r = 0.28 * (1 - u * 0.5);
            this.v2.addScaledVector(this.v3, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r);
            pts.push(this.v2.clone());
          }
          this.ribbons.add(pts, 0.07 * this.quality, b.pal.ion, hdr(2.2), 0.6);
        }
      }
    }

    // transient bolt shapes
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i];
      t.life -= dt;
      if (t.life <= 0) { this.transients.splice(i, 1); continue; }
      const fade = t.life / t.maxLife;
      for (const line of t.lines) {
        this.ribbons.add(line.pts, t.width * (0.6 + fade * 0.4), t.pal.main, t.mul * fade * line.intensity, 1);
      }
    }

    // storm residuals: the victim stays electrified
    for (let i = this.residuals.length - 1; i >= 0; i--) {
      const r = this.residuals[i];
      r.left -= dt;
      if (r.left <= 0 || !this.getEntity(r.targetId)) { this.residuals.splice(i, 1); continue; }
      r.arcT -= dt;
      if (r.arcT <= 0) {
        r.arcT = 0.35 + Math.random() * 0.3;
        this.crawlArcs(r.targetId, r.pal, 1);
      }
    }

    // buff orbits (band: shoulders — the slice's persistent read)
    for (const [key, b] of this.buffs) {
      b.left -= dt;
      const c = this.anchor(b.entityId, 0.72);
      if (b.left <= 0 || !c) {
        for (const s of b.sprites) this.freeSprite(s);
        this.buffs.delete(key);
        continue;
      }
      const fade = Math.min(1, b.left / 0.5) * this.quality;
      const t = performance.now() / 1000;
      b.sprites.forEach((s, k) => {
        const a = b.phase + t * 2.2 + (k / Math.max(1, b.sprites.length)) * Math.PI * 2;
        s.position.set(c.x + Math.cos(a) * 0.55, c.y + Math.sin(t * 2 + k * 2) * 0.12, c.z + Math.sin(a) * 0.55);
        (s.material as THREE.SpriteMaterial).opacity = 0.85 * fade;
      });
      if (b.orbit === 'sparks' && b.sprites.length >= 2) {
        b.arcT -= dt;
        if (b.arcT <= 0) {
          b.arcT = 0.5 + Math.random() * 0.6;
          const i = Math.floor(Math.random() * b.sprites.length);
          const j = (i + 1) % b.sprites.length;
          this.transients.push({
            lines: genBolt(b.sprites[i].position, b.sprites[j].position, { jag: 0.3, subdiv: 3, branchP: 0.1, depth: 0 }),
            life: 0.08, maxLife: 0.08, width: 0.025, pal: b.pal, mul: hdr(2.4),
          });
        }
      }
    }

    this.rings.update(dt);
    this.ribbons.commit();
    // E2E/live introspection: mutate the one persistent object (no per-frame allocs)
    this.debug.bolts = this.bolts.length;
    this.debug.buffs = this.buffs.size;
    this.debug.ribV = this.ribbons.v;
    if (this.ribbons.v > this.debug.ribVMax) this.debug.ribVMax = this.ribbons.v;
    this.debug.frames++;
  }

  /** Drop every transient (prewarm frames + world teardown call this). */
  clear(): void {
    for (const b of this.bolts) this.freeSprite(b.head);
    this.bolts.length = 0;
    this.transients.length = 0;
    this.residuals.length = 0;
    for (const [, b] of this.buffs) for (const s of b.sprites) this.freeSprite(s);
    this.buffs.clear();
    for (const [, c] of this.castMap) if (c.rune) c.rune.visible = false;
    this.castMap.clear();
    this.justDone.clear();
    this.rings.clear();
    this.ribbons.begin();
    this.ribbons.commit();
  }

  /** Compile every material off-screen so the first real cast never hitches. */
  prewarm(at: THREE.Vector3): void {
    const pal = PALETTES.storm;
    this.rings.spawn(this.v1.copy(at), 2, 0.3, pal.main, 1, false, this.camera);
    this.rings.spawn(this.v2.copy(at), 2, 0.3, pal.ion, 1, true, this.camera);
    this.transients.push({ lines: genBolt(at, this.v3.copy(at).setY(at.y + 3)), life: 0.1, maxLife: 0.1, width: 0.1, pal, mul: 1 });
    const s = this.takeSprite();
    if (s) {
      s.position.copy(at);
      (s.material as THREE.SpriteMaterial).opacity = 0.01;
      this.freeSprite(s);
    }
    const rune = this.runePool[0];
    if (rune) {
      rune.position.copy(at);
      (rune.material as THREE.MeshBasicMaterial).opacity = 0.01;
      rune.visible = true;
      // hidden again on the clear() that follows prewarm
    }
  }
}
