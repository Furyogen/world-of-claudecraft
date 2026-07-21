// ============================================================================
// WoC ABILITY VFX GALLERY, every class, every ability (dev page, not shipped)
// ----------------------------------------------------------------------------
// Working prototype of the proposed spec-driven ability_vfx.ts:
//   - AbilityVfxSpec per ability (ability_specs.js) over shared ARCHETYPE
//     interpreters: bolt burst strike nova beam dot heal buff shout summon
//     cc dash, all composed from the five primitives:
//       ShockRing / RibbonTrail / FlipbookQuad / GroundDecal / LightPulsePool
//   - Named palettes (school colors from vfx.ts SCHOOL_COLORS + specials)
//   - Timing anatomy: windup converge → 80-120ms HDR>=3x release flash →
//     impact stacked inside 150ms → 1-2s linger. Every curve eased.
//   - Receiver feedback: emissive+fresnel shell, crit hitstop, camera kick.
//   - Real class models: manifest.ts kit (show-list / tint / weapon grips),
//     game clips (Idle / Spellcasting / Spellcast_Shoot / attacks / Cheer).
// Matches the game stack: three r165, RenderPass→UnrealBloom→OutputPass, ACES,
// bloom 0.85/0.32/0.55 with HDR multipliers (the hdr() recipe).
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CATALOG } from './ability_catalog.js';
import { SPECS } from './ability_specs.js';

// ---------------------------------------------------------------- utilities
let rngState = 1337;
function rnd() {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}
const rr = (a, b) => a + (b - a) * rnd();
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutQuart = (t) => 1 - (1 - t) ** 4;
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const easeInCubic = (t) => t * t * t;
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

// ---------------------------------------------------------------- palettes
const WHITE = new THREE.Color(0xffffff);
function makePal(mainHex, accentHex, smokeHex = 0x2b3240, sfx = 'thwack') {
  const main = new THREE.Color(mainHex);
  return {
    main,
    core: main.clone().lerp(WHITE, 0.78),
    glow: main.clone().multiplyScalar(0.5),
    ion: main.clone().lerp(WHITE, 0.45),
    accent: new THREE.Color(accentHex),
    smoke: new THREE.Color(smokeHex),
    sfx,
  };
}
const PALETTES = {
  physical: makePal(0xdfe6ee, 0xb8c4d2, 0x32302a, 'thwack'), // steel-white, gold belongs to HOLY alone
  fire: makePal(0xff7a2a, 0xffd23e, 0x3a2c22, 'fire'),
  frost: makePal(0x8ed2ff, 0xe8f6ff, 0x2a333e, 'frost'),
  arcane: makePal(0xd98aff, 0x8a6cff, 0x322a3e, 'arcane'),
  shadow: makePal(0x9a5df0, 0x5d2fa8, 0x261f33, 'shadow'),
  holy: makePal(0xffe9a0, 0xffc85e, 0x3a352a, 'holy'),
  nature: makePal(0x86e86a, 0xc8f09a, 0x283626, 'nature'),
  blood: makePal(0xff5a4d, 0xb8241a, 0x33231f, 'thwack'),
  moon: makePal(0xcfd6ff, 0x9a8cff, 0x2b2f42, 'arcane'),
  venom: makePal(0xb8e83e, 0x6a9a1a, 0x2b331f, 'nature'),
  gold: makePal(0xffd76a, 0xffb02e, 0x3a3324, 'holy'),
  storm: {
    // the approved Arc Bolt colors, verbatim
    main: new THREE.Color(0x5aa4ff),
    core: new THREE.Color(0xd8ecff),
    glow: new THREE.Color(0x2c62e0),
    ion: new THREE.Color(0x9fd8ff),
    accent: new THREE.Color(0x8a6cff),
    smoke: new THREE.Color(0x2b3646),
    sfx: 'zap',
  },
};
const BLOOM = { strength: 0.32, radius: 0.55, threshold: 0.85 }; // game post.ts
const HDR = (k) => k; // composer always on here (game gates via hdr())

// ---------------------------------------------------------------- canvas tex
function makeCanvas(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  fn(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function softDotTex() {
  return makeCanvas(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
}

function glowRadialTex() {
  return makeCanvas(128, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    r.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
}

function starTex() {
  return makeCanvas(64, (g, s) => {
    const c = s / 2;
    g.translate(c, c);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.shadowColor = 'rgba(255,255,255,0.8)';
    g.shadowBlur = 6;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? c * 0.85 : c * 0.32;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  });
}

function ribbonTex() {
  const t = makeCanvas(64, (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0.0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.32, 'rgba(255,255,255,0.25)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(0.68, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function fbmTex(size = 256, oct = 4) {
  return makeCanvas(size, (g, s) => {
    const img = g.createImageData(s, s);
    const grid = 8;
    const lat = [];
    for (let o = 0; o < oct; o++) {
      const n = grid << o,
        layer = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) layer[i] = rnd();
      lat.push({ n, layer });
    }
    const sample = (l, x, y) => {
      const n = l.n;
      const xi = Math.floor(x),
        yi = Math.floor(y);
      const xf = x - xi,
        yf = y - yi;
      const sx = xf * xf * (3 - 2 * xf),
        sy = yf * yf * (3 - 2 * yf);
      const at = (ix, iy) => l.layer[(((iy % n) + n) % n) * n + (((ix % n) + n) % n)];
      const a = at(xi, yi),
        b = at(xi + 1, yi),
        c2 = at(xi, yi + 1),
        d = at(xi + 1, yi + 1);
      return a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy;
    };
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        let v = 0,
          amp = 0.5;
        for (let o = 0; o < oct; o++) {
          v += sample(lat[o], (x / s) * lat[o].n, (y / s) * lat[o].n) * amp;
          amp *= 0.5;
        }
        const q = Math.floor(clamp01(v) * 255);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = q;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  });
}

// near-white so uColor tinting carries the palette
function runeRingTex() {
  return makeCanvas(512, (g, s) => {
    const c = s / 2;
    g.strokeStyle = 'rgba(240,245,255,0.95)';
    g.lineCap = 'round';
    g.shadowColor = 'rgba(235,240,255,0.9)';
    g.shadowBlur = 6;
    for (const [r, w] of [
      [224, 9],
      [204, 4],
      [140, 6],
      [126, 3],
    ]) {
      g.lineWidth = w;
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const gx = c + Math.cos(a) * 172,
        gy = c + Math.sin(a) * 172;
      g.save();
      g.translate(gx, gy);
      g.rotate(a + Math.PI / 2);
      g.lineWidth = 5.5;
      const strokes = 3 + Math.floor(rnd() * 3);
      for (let st = 0; st < strokes; st++) {
        g.beginPath();
        g.moveTo(rr(-16, 16), rr(-20, 20));
        g.lineTo(rr(-16, 16), rr(-20, 20));
        if (rnd() < 0.6) g.lineTo(rr(-16, 16), rr(-20, 20));
        g.stroke();
      }
      g.restore();
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + 0.13;
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 46, c + Math.sin(a) * 46);
      g.lineTo(c + Math.cos(a) * (86 + rnd() * 24), c + Math.sin(a) * (86 + rnd() * 24));
      g.stroke();
    }
  });
}

function scorchTex() {
  return makeCanvas(256, (g, s) => {
    const c = s / 2;
    for (let i = 0; i < 340; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() ** 1.6 * c * 0.92;
      const rad = rr(6, 26) * (1 - (d / c) * 0.7);
      const alpha = 0.16 * (1 - d / c);
      g.fillStyle = `rgba(4,6,10,${alpha.toFixed(3)})`;
      g.beginPath();
      g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, rad, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function crackGlowTex() {
  return makeCanvas(256, (g, s) => {
    const c = s / 2;
    g.strokeStyle = 'rgba(245,248,255,0.9)';
    g.lineCap = 'round';
    g.shadowColor = 'rgba(215,220,235,0.9)';
    g.shadowBlur = 7;
    for (let k = 0; k < 7; k++) {
      const a0 = (k / 7) * Math.PI * 2 + rr(-0.2, 0.2);
      let x = c,
        y = c,
        a = a0,
        d = 0;
      g.lineWidth = 3.2;
      g.beginPath();
      g.moveTo(x, y);
      while (d < c * 0.86) {
        const step = rr(9, 20);
        a += rr(-0.55, 0.55);
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
        d += step;
        g.lineTo(x, y);
        if (rnd() < 0.3) {
          g.moveTo(x, y);
          g.lineTo(
            x + Math.cos(a + rr(-1.4, 1.4)) * rr(8, 22),
            y + Math.sin(a + rr(-1.4, 1.4)) * rr(8, 22),
          );
          g.moveTo(x, y);
        }
        g.lineWidth = Math.max(0.6, g.lineWidth * 0.92);
      }
      g.stroke();
    }
  });
}

// angular radiating fractures (rime), straight lines, sharp branch angles
function shardCrackTex() {
  return makeCanvas(256, (g, s) => {
    const c = s / 2;
    g.strokeStyle = 'rgba(245,248,255,0.9)';
    g.lineCap = 'butt';
    g.shadowColor = 'rgba(220,228,245,0.9)';
    g.shadowBlur = 5;
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rr(-0.15, 0.15);
      let x = c,
        y = c,
        d = 0;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x, y);
      let ang = a;
      while (d < c * 0.88) {
        const step = rr(18, 34);
        x += Math.cos(ang) * step;
        y += Math.sin(ang) * step;
        d += step;
        g.lineTo(x, y);
        ang += rnd() < 0.5 ? rr(0.3, 0.5) : rr(-0.5, -0.3); // hard kinks
        if (rnd() < 0.45) {
          // sharp side fracture
          g.moveTo(x, y);
          const ba = ang + (rnd() < 0.5 ? 1.1 : -1.1);
          g.lineTo(x + Math.cos(ba) * rr(10, 24), y + Math.sin(ba) * rr(10, 24));
          g.moveTo(x, y);
        }
        g.lineWidth = Math.max(0.8, g.lineWidth * 0.85);
      }
      g.stroke();
    }
  });
}

// soft sunburst residue (holy/moon impacts)
function raysDecalTex() {
  return makeCanvas(256, (g, s) => {
    const c = s / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c * 0.5);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c, c, c * 0.5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineCap = 'round';
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + (k % 2) * 0.1;
      const inner = c * 0.22,
        outer = c * (k % 2 ? 0.55 : 0.85) * rr(0.85, 1);
      g.lineWidth = k % 2 ? 2 : 4;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
      g.lineTo(c + Math.cos(a) * outer, c + Math.sin(a) * outer);
      g.stroke();
    }
  });
}

// spectral paw print (spirit footprints)
function pawTex() {
  return makeCanvas(64, (g, _s) => {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.shadowColor = 'rgba(255,255,255,0.7)';
    g.shadowBlur = 4;
    g.beginPath();
    g.ellipse(32, 40, 11, 9, 0, 0, Math.PI * 2);
    g.fill(); // pad
    for (const [x, y, r] of [
      [16, 24, 5],
      [27, 17, 5.5],
      [39, 17, 5.5],
      [48, 24, 5],
    ]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill(); // toes
    }
  });
}

// small angular chip (physical/nature debris)
function chipTex() {
  return makeCanvas(32, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.moveTo(16, 4);
    g.lineTo(27, 14);
    g.lineTo(20, 28);
    g.lineTo(7, 22);
    g.closePath();
    g.fill();
  });
}

function smokeTex() {
  return makeCanvas(128, (g, s) => {
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2,
        d = rnd() ** 1.4 * s * 0.3;
      const x = s / 2 + Math.cos(a) * d,
        y = s / 2 + Math.sin(a) * d;
      const rad = rr(10, 30);
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,0.10)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// 8x8 flipbooks, one NEUTRAL grayscale sheet per elemental style, tinted per
// palette via uTint. Built lazily on first use, cached.
const flipbookCache = new Map();
function flipbookSheet(style) {
  if (flipbookCache.has(style)) return flipbookCache.get(style);
  const GRID = 8,
    CELL = 128;
  const tex = makeCanvas(GRID * CELL, (g) => {
    for (let f = 0; f < GRID * GRID; f++) {
      const t = f / (GRID * GRID - 1);
      const cx = (f % GRID) * CELL + CELL / 2;
      const cy = Math.floor(f / GRID) * CELL + CELL / 2;
      g.save();
      g.beginPath();
      g.rect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);
      g.clip();
      g.globalCompositeOperation = 'lighter';
      drawFlipFrame[style](g, cx, cy, t);
      g.restore();
    }
  });
  flipbookCache.set(style, tex);
  return tex;
}
const drawFlipFrame = {
  electric(g, cx, cy, t) {
    // the original: flash → eroding ring → filaments
    const flashA = Math.max(0, 1 - t * 2.6) ** 1.7;
    if (flashA > 0.01) {
      const r0 = 8 + 30 * easeOutCubic(Math.min(1, t * 3));
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r0);
      grad.addColorStop(0, `rgba(255,255,255,${flashA})`);
      grad.addColorStop(0.5, `rgba(210,214,224,${(flashA * 0.6).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(150,155,170,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, r0, 0, Math.PI * 2);
      g.fill();
    }
    const ringR = 8 + 50 * easeOutQuart(t);
    g.strokeStyle = `rgba(215,220,232,${((1 - t) ** 1.4 * 0.9).toFixed(3)})`;
    g.lineWidth = 6.5 * (1 - t) + 1.2;
    g.shadowColor = 'rgba(210,214,226,0.8)';
    g.shadowBlur = 8;
    g.beginPath();
    g.arc(cx, cy, ringR, 0, Math.PI * 2);
    g.stroke();
    g.shadowBlur = 0;
    const nFil = Math.max(2, Math.floor(11 * (1 - t * 0.7)));
    g.strokeStyle = `rgba(240,243,250,${((1 - t) ** 1.2).toFixed(3)})`;
    g.lineWidth = 2.1 * (1 - t) + 0.5;
    for (let k = 0; k < nFil; k++) {
      const a = rnd() * Math.PI * 2;
      let x = cx + Math.cos(a) * 6,
        y = cy + Math.sin(a) * 6,
        ang = a,
        d = 0;
      g.beginPath();
      g.moveTo(x, y);
      const reach = ringR * rr(0.75, 1.2);
      while (d < reach) {
        const step = rr(5, 11);
        ang += rr(-0.6, 0.6);
        x += Math.cos(ang) * step;
        y += Math.sin(ang) * step;
        d += step;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    if (t > 0.45) drawSmokeBlobs(g, cx, cy, t, 5, 8 + 50 * easeOutQuart(t) * 0.7);
  },
  flame(g, cx, cy, t) {
    // roiling fire: blobs rise and lick upward
    const n = Math.max(3, Math.floor(12 * (1 - t * 0.5)));
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const spread = 10 + 34 * easeOutCubic(t);
      const x = cx + Math.cos(a) * spread * rr(0.2, 1);
      const y = cy + Math.sin(a) * spread * rr(0.15, 0.7) - t * 34 * rr(0.4, 1); // rises
      const rad = rr(8, 22) * (1 - t * 0.45);
      const heat = rr(0.55, 1);
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(255,255,255,${((1 - t) ** 1.1 * heat).toFixed(3)})`);
      grad.addColorStop(0.45, `rgba(200,200,205,${((1 - t) ** 1.3 * heat * 0.7).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(120,120,125,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    if (t < 0.3) {
      // ignition flash
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 26);
      grad.addColorStop(0, `rgba(255,255,255,${(1 - t / 0.3).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, 26, 0, Math.PI * 2);
      g.fill();
    }
    if (t > 0.4) drawSmokeBlobs(g, cx, cy - t * 26, t, 6, 34);
  },
  shatter(g, cx, cy, t) {
    // angular shards flying outward + glints
    const e = easeOutQuart(t);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.4;
      const d = 6 + 52 * e * rr(0.75, 1);
      const x = cx + Math.cos(a) * d,
        y = cy + Math.sin(a) * d;
      const len = rr(8, 18) * (1 - t * 0.5),
        wid = len * 0.36;
      const rot = a + e * rr(1, 3);
      const alpha = (1 - t) ** 1.15;
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.fillStyle = `rgba(235,240,248,${alpha.toFixed(3)})`;
      g.beginPath();
      g.moveTo(0, -len / 2);
      g.lineTo(wid / 2, len / 4);
      g.lineTo(0, len / 2);
      g.lineTo(-wid / 2, len / 4);
      g.closePath();
      g.fill();
      g.restore();
    }
    // crystalline glints (plus signs)
    g.strokeStyle = `rgba(255,255,255,${((1 - t) ** 1.6).toFixed(3)})`;
    g.lineWidth = 1.6;
    for (let k = 0; k < 5; k++) {
      const a = rnd() * Math.PI * 2,
        d = rr(4, 40 * e + 8);
      const x = cx + Math.cos(a) * d,
        y = cy + Math.sin(a) * d,
        s = rr(3, 7);
      g.beginPath();
      g.moveTo(x - s, y);
      g.lineTo(x + s, y);
      g.moveTo(x, y - s);
      g.lineTo(x, y + s);
      g.stroke();
    }
    if (t < 0.25) {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 24);
      grad.addColorStop(0, `rgba(255,255,255,${(1 - t / 0.25).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, 24, 0, Math.PI * 2);
      g.fill();
    }
  },
  radiance(g, cx, cy, t) {
    // gentle glory: soft bloom + rotating rays
    const glowR = 14 + 30 * easeOutCubic(Math.min(1, t * 1.6));
    const alpha = (1 - t) ** 1.15;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
    grad.addColorStop(0.55, `rgba(230,232,238,${(alpha * 0.5).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(200,202,210,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, glowR, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(255,255,255,${(alpha * 0.85).toFixed(3)})`;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + t * 0.7;
      const inner = glowR * 0.4,
        outer = glowR * rr(1.15, 1.7);
      g.lineWidth = k % 3 === 0 ? 2.4 : 1.1;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      g.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      g.stroke();
    }
  },
  void(g, cx, cy, t) {
    // implosion: ring contracts, tendrils curl inward
    const ringR = 56 * (1 - easeOutCubic(t)) + 7;
    const alpha = Math.min(1, t * 2.5) ** 0.8 * (1 - t) ** 0.55;
    g.strokeStyle = `rgba(225,220,240,${alpha.toFixed(3)})`;
    g.lineWidth = 5 * (1 - t) + 1.6;
    g.shadowColor = 'rgba(200,190,230,0.8)';
    g.shadowBlur = 9;
    g.beginPath();
    g.arc(cx, cy, ringR, 0, Math.PI * 2);
    g.stroke();
    g.shadowBlur = 0;
    g.lineWidth = 1.8;
    for (let k = 0; k < 7; k++) {
      const a0 = (k / 7) * Math.PI * 2 + t * 2;
      g.beginPath();
      for (let s = 0; s <= 8; s++) {
        const u = s / 8;
        const a = a0 + u * 1.6;
        const d = ringR + (1 - u) * 22;
        const x = cx + Math.cos(a) * d,
          y = cy + Math.sin(a) * d;
        s === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(210,205,232,${(alpha * 0.7).toFixed(3)})`;
      g.stroke();
    }
    if (t > 0.72) {
      // collapse pop
      const p = (t - 0.72) / 0.28;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 30 * p + 6);
      grad.addColorStop(0, `rgba(255,255,255,${(1 - p).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, 30 * p + 6, 0, Math.PI * 2);
      g.fill();
    }
  },
  verdant(g, cx, cy, t) {
    // petals/leaves spiraling out on soft bloom
    const e = easeOutCubic(t);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, 20 + 18 * e);
    grad.addColorStop(0, `rgba(245,248,242,${((1 - t) ** 1.3).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(210,220,205,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, 20 + 18 * e, 0, Math.PI * 2);
    g.fill();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + e * 2.4 + k * 0.4;
      const d = 6 + 44 * e * rr(0.7, 1);
      const x = cx + Math.cos(a) * d,
        y = cy + Math.sin(a) * d;
      const alpha = (1 - t) ** 1.1;
      g.save();
      g.translate(x, y);
      g.rotate(a + e * 3);
      g.fillStyle = `rgba(235,242,230,${alpha.toFixed(3)})`;
      g.beginPath();
      g.ellipse(0, 0, rr(6, 10) * (1 - t * 0.4), rr(2.5, 4), 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  },
};
function drawSmokeBlobs(g, cx, cy, t, n, spread) {
  const sA = Math.max(0, (t - 0.4) * 0.55 * (1 - t));
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2,
      d = rr(8, spread);
    const x = cx + Math.cos(a) * d,
      y = cy + Math.sin(a) * d;
    const rad = rr(12, 26);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(120,124,136,${sA.toFixed(3)})`);
    grad.addColorStop(1, 'rgba(120,124,136,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
}

function groundTexture() {
  const t = makeCanvas(512, (g, s) => {
    g.fillStyle = '#1a2130';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2400; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? 'rgba(8,10,15,0.35)' : 'rgba(46,58,76,0.18)';
      g.beginPath();
      g.arc(rnd() * s, rnd() * s, rr(0.6, 3.4), 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(58,74,100,0.14)';
    g.lineWidth = 1.1;
    for (let i = 0; i < 26; i++) {
      let x = rnd() * s,
        y = rnd() * s,
        a = rnd() * Math.PI * 2;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 14; k++) {
        a += rr(-0.7, 0.7);
        x += Math.cos(a) * 12;
        y += Math.sin(a) * 12;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function totemTexture() {
  const t = makeCanvas(256, (g, s) => {
    g.fillStyle = '#241a10';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(14,10,6,${rr(0.2, 0.5).toFixed(2)})`;
      g.lineWidth = rr(1, 3);
      g.beginPath();
      g.moveTo(rnd() * s, 0);
      g.bezierCurveTo(rnd() * s, s * 0.3, rnd() * s, s * 0.7, rnd() * s, s);
      g.stroke();
    }
    g.strokeStyle = 'rgba(150,210,255,0.9)';
    g.lineWidth = 4;
    g.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const y0 = 26 + k * 46;
      for (let st = 0; st < 3; st++) {
        g.beginPath();
        g.moveTo(s / 2 + rr(-18, 18), y0 + rr(-14, 14));
        g.lineTo(s / 2 + rr(-18, 18), y0 + rr(-14, 14));
        g.stroke();
      }
    }
  });
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- renderer
const app = document.getElementById('app');
const flashEl = document.getElementById('flash');
const phaseEl = document.getElementById('phase');
const infoEl = document.getElementById('abilityInfo');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const glDbg = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
const glName = glDbg
  ? String(renderer.getContext().getParameter(glDbg.UNMASKED_RENDERER_WEBGL))
  : '';
const params = new URLSearchParams(location.search);
const LOW_GPU =
  (/swiftshader|llvmpipe|software|basic render/i.test(glName) || params.has('low')) &&
  !params.has('full');
const RES_SCALE = LOW_GPU ? 0.38 : 1;
renderer.setPixelRatio(LOW_GPU ? 1 : Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth * RES_SCALE, window.innerHeight * RES_SCALE, false);
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
app.appendChild(renderer.domElement);
if (LOW_GPU) console.warn(`[vfx gallery] software GL (${glName}), reduced resolution`);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.FogExp2(0x080c15, 0.015);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
const shakeGroup = new THREE.Group();
shakeGroup.add(camera);
scene.add(shakeGroup);
camera.position.set(2.2, 3.4, 13.6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.4, 2.0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 4;
controls.maxDistance = 34;
controls.maxPolarAngle = 1.48;

// screen-space distortion: impact ripples, heat shimmer, frost-kissed edges
const DistortShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRipples: {
      value: [
        new THREE.Vector4(0, 0, 9, 0),
        new THREE.Vector4(0, 0, 9, 0),
        new THREE.Vector4(0, 0, 9, 0),
        new THREE.Vector4(0, 0, 9, 0),
      ],
    },
    uHeat: { value: new THREE.Vector4(0, 0, 0.001, 0) },
    uFrost: { value: 0 },
    uTime: { value: 0 },
    uNoise: { value: null },
    uAspect: { value: 1 },
    uTintC: { value: new THREE.Vector3(1, 1, 1) },
    uTintAmt: { value: 0 },
    uInvert: { value: 0 },
    uCA: { value: 0 },
    uGrain: { value: 0.02 },
    uRadial: { value: new THREE.Vector4(0.5, 0.5, 0, 0) },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D uNoise;
    uniform vec4 uRipples[4]; uniform vec4 uHeat; uniform float uFrost; uniform float uTime; uniform float uAspect;
    uniform vec3 uTintC; uniform float uTintAmt; uniform float uInvert;
    uniform float uCA; uniform float uGrain; uniform vec4 uRadial;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 suv = vec2(vUv.x * uAspect, vUv.y);
      for (int i = 0; i < 4; i++) {
        vec4 r = uRipples[i];
        if (r.w <= 0.0) continue;
        vec2 c = vec2(r.x * uAspect, r.y);
        float d = distance(suv, c);
        float wave = sin((d - r.z * 1.4) * 42.0) * exp(-d * 5.0) * exp(-r.z * 4.5) * r.w;
        vec2 dir = d > 0.0001 ? (suv - c) / d : vec2(0.0);
        uv += dir * wave * 0.02;
      }
      if (uHeat.w > 0.0) {
        vec2 hc = vec2(uHeat.x * uAspect, uHeat.y);
        float m = exp(-pow(distance(suv, hc) / max(uHeat.z, 0.001), 2.0));
        vec2 n = texture2D(uNoise, uv * 5.0 + vec2(0.0, -uTime * 0.9)).rg - 0.5;
        uv += n * 0.014 * m * uHeat.w;
      }
      // chromatic aberration: lenses complain when magic detonates
      vec4 col;
      if (uCA > 0.0005) {
        vec2 dc = (uv - 0.5) * uCA;
        col = vec4(texture2D(tDiffuse, uv + dc).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - dc).b, 1.0);
      } else {
        col = texture2D(tDiffuse, uv);
      }
      // radial blur burst on the big finishers
      if (uRadial.z > 0.001) {
        vec2 rc = vec2(uRadial.x, uRadial.y);
        vec2 rd = uv - rc;
        vec4 acc = col;
        for (int i = 1; i <= 4; i++) {
          acc += texture2D(tDiffuse, uv - rd * uRadial.z * float(i) * 0.02);
        }
        col = acc * 0.2;
      }
      if (uFrost > 0.001) {
        float edge = smoothstep(0.45, 1.05, length(vUv - 0.5) * 1.9);
        float n = texture2D(uNoise, vUv * 6.0).r;
        float f = edge * uFrost;
        col.rgb = mix(col.rgb, vec3(0.75, 0.86, 1.0), f * (0.35 + 0.4 * n));
        col.rgb += vec3(0.5, 0.7, 1.0) * pow(n, 6.0) * f * 0.8;
      }
      col.rgb = mix(col.rgb, col.rgb * uTintC, uTintAmt);      // elemental grade shift
      if (uInvert > 0.5) col.rgb = vec3(1.2) - col.rgb;         // anime impact frame
      // cinematic vignette + breathing film grain
      float vig = 1.0 - smoothstep(0.5, 1.3, length(vUv - 0.5) * 1.65);
      col.rgb *= 0.84 + 0.16 * vig;
      float gr = fract(sin(dot(vUv + fract(uTime * 7.0), vec2(12.9898, 78.233))) * 43758.5453);
      col.rgb += (gr - 0.5) * uGrain;
      gl_FragColor = col;
    }`,
};

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(
  new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    BLOOM.strength,
    BLOOM.radius,
    BLOOM.threshold,
  ),
);
const distortPass = new ShaderPass(DistortShader);
composer.addPass(distortPass);
composer.addPass(new OutputPass());

const ripples = []; // {world, age, strength}
let heatSrc = null; // {world|follow(), radius, strength, until}
let frostVal = 0;
function spawnRipple(pos, strength = 1) {
  ripples.push({ world: pos.clone(), age: 0, strength: 0.55 * strength });
  if (ripples.length > 4) ripples.shift();
}
function heatAt(pos, dur, radius = 0.16, strength = 1) {
  heatSrc = { world: pos.clone(), follow: null, radius, strength, until: dur };
}
function heatFollow(fn, radius = 0.12, strength = 0.8) {
  heatSrc = { world: null, follow: fn, radius, strength, until: 0.15 }; // refreshed while followed
}
function frostEdge(v) {
  frostVal = Math.max(frostVal, Math.min(v, 0.55));
} // corner kiss, never a whiteout
let gradeAmt = 0,
  caAmt = 0,
  radialAmt = 0;
const radialWorld = new THREE.Vector3();
function gradePulse(r, g, b, amt) {
  distortPass.uniforms.uTintC.value.set(r, g, b);
  gradeAmt = Math.max(gradeAmt, amt);
}
function caPulse(v) {
  caAmt = Math.max(caAmt, v);
}
function radialBurst(worldPos, v = 1) {
  radialWorld.copy(worldPos);
  radialAmt = Math.max(radialAmt, v);
}
const _proj = new THREE.Vector3();
function updateDistortion(dt, realDt) {
  const u = distortPass.uniforms;
  u.uTime.value = perfNow;
  u.uAspect.value = camera.aspect;
  for (let i = 0; i < 4; i++) {
    const r = ripples[i];
    const v = u.uRipples.value[i];
    if (!r) {
      v.w = 0;
      continue;
    }
    r.age += dt;
    if (r.age > 0.9) {
      v.w = 0;
      continue;
    }
    _proj.copy(r.world).project(camera);
    if (_proj.z > 1 || _proj.z < -1) {
      v.w = 0;
      continue;
    }
    v.set((_proj.x + 1) / 2, (_proj.y + 1) / 2, r.age, r.strength);
  }
  while (ripples.length && ripples[0].age > 0.9) ripples.shift();
  if (heatSrc) {
    heatSrc.until -= dt;
    if (heatSrc.until <= 0) {
      heatSrc = null;
      u.uHeat.value.w = 0;
    } else {
      const p = heatSrc.follow ? heatSrc.follow() : heatSrc.world;
      _proj.copy(p).project(camera);
      if (_proj.z > 1) u.uHeat.value.w = 0;
      else
        u.uHeat.value.set(
          (_proj.x + 1) / 2,
          (_proj.y + 1) / 2,
          heatSrc.radius,
          heatSrc.strength * Math.min(1, heatSrc.until / 0.2),
        );
    }
  } else u.uHeat.value.w = 0;
  frostVal = Math.max(0, frostVal - realDt * 0.7);
  u.uFrost.value = frostVal;
  gradeAmt = Math.max(0, gradeAmt - realDt * 2.2);
  u.uTintAmt.value = gradeAmt;
  u.uInvert.value = impactFrames > 0 ? 1 : 0;
  if (impactFrames > 0) impactFrames--;
  caAmt = Math.max(0, caAmt - realDt * 2.6);
  u.uCA.value = caAmt * 0.011;
  radialAmt = Math.max(0, radialAmt - realDt * 2.4);
  if (radialAmt > 0.001) {
    _proj.copy(radialWorld).project(camera);
    u.uRadial.value.set((_proj.x + 1) / 2, (_proj.y + 1) / 2, _proj.z <= 1 ? radialAmt : 0, 0);
  } else u.uRadial.value.z = 0;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth * RES_SCALE, window.innerHeight * RES_SCALE, false);
  composer.setSize(window.innerWidth * RES_SCALE, window.innerHeight * RES_SCALE);
});

const TEX = {
  dot: softDotTex(),
  glow: glowRadialTex(),
  ribbon: ribbonTex(),
  star: starTex(),
  noise: fbmTex(256, 4),
  rune: runeRingTex(),
  scorch: scorchTex(),
  cracks: crackGlowTex(),
  shards: shardCrackTex(),
  rays: raysDecalTex(),
  paw: pawTex(),
  chip: chipTex(),
  smoke: smokeTex(),
};
TEX.noise.wrapS = TEX.noise.wrapT = THREE.RepeatWrapping;
distortPass.uniforms.uNoise.value = TEX.noise;

// per-palette elemental styling: which flipbook sheet, ground decal, and
// debris the impact stack uses
const PAL_STYLE = {
  storm: { sheet: 'electric', decal: 'char', debris: 'sparks' },
  arcane: { sheet: 'electric', decal: 'char', debris: 'sparks' },
  physical: { sheet: 'electric', decal: 'char', debris: 'chips' },
  fire: { sheet: 'flame', decal: 'char', debris: 'smolder' },
  blood: { sheet: 'flame', decal: 'char', debris: 'smolder' },
  frost: { sheet: 'shatter', decal: 'rime', debris: 'shards' },
  moon: { sheet: 'radiance', decal: 'rays', debris: 'sparks' },
  holy: { sheet: 'radiance', decal: 'rays', debris: 'sparks' },
  gold: { sheet: 'radiance', decal: 'rays', debris: 'sparks' },
  shadow: { sheet: 'void', decal: 'char', debris: 'sparks' },
  venom: { sheet: 'void', decal: 'char', debris: 'smolder' },
  nature: { sheet: 'verdant', decal: 'char', debris: 'chips' },
};

// ---------------------------------------------------------------- environment
const CASTER_POS = new THREE.Vector3(-8.5, 0, 0);
const TARGET_POS = new THREE.Vector3(8.5, 0, 0);
const MELEE_X = TARGET_POS.x - 1.9;

const groundCloudT = { value: 0 };
{
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTexture(),
    roughness: 0.96,
    metalness: 0,
  });
  // drifting cloud shadows crawl across the arena floor
  groundMat.onBeforeCompile = (sh) => {
    sh.uniforms.uCloudT = groundCloudT;
    sh.uniforms.uCloudTex = { value: TEX.noise };
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uCloudT; uniform sampler2D uCloudTex;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float cl = texture2D(uCloudTex, vMapUv * 2.6 + vec2(uCloudT * 0.009, uCloudT * 0.005)).r;
        diffuseColor.rgb *= 0.78 + 0.28 * smoothstep(0.32, 0.72, cl);`,
      );
  };
  const ground = new THREE.Mesh(new THREE.CircleGeometry(38, 72), groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // the moon presides over the arena
  const moonHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: TEX.glow,
      color: 0x9fb2e0,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  moonHalo.scale.setScalar(26);
  moonHalo.position.set(-28, 27, -49);
  scene.add(moonHalo);
  const moonDisc = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: TEX.dot,
      color: 0xe8eeff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  moonDisc.scale.setScalar(7.5);
  moonDisc.position.set(-28, 27, -49);
  scene.add(moonDisc);

  const domeTex = makeCanvas(256, (g, s) => {
    const grad = g.createLinearGradient(0, s, 0, 0);
    grad.addColorStop(0, '#0c1424');
    grad.addColorStop(0.4, '#070b16');
    grad.addColorStop(1, '#04060c');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  domeTex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 16),
    new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide, fog: false }),
  );
  scene.add(dome);

  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(260 * 3);
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2,
      e = rr(0.12, 1.35),
      r = 100;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(
    new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        size: 0.5,
        map: TEX.dot,
        transparent: true,
        opacity: 0.65,
        color: 0xbdd4ff,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    ),
  );

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x1d2430,
    roughness: 0.95,
    flatShading: true,
  });
  for (let i = 0; i < 12; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rr(0.5, 2.1), 0), rockMat);
    const a = rnd() * Math.PI * 2,
      d = rr(17, 31);
    rock.position.set(Math.cos(a) * d, rr(-0.3, 0.15), Math.sin(a) * d);
    rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    scene.add(rock);
  }

  window._mist = [];
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: TEX.smoke,
        color: 0x3d5578,
        transparent: true,
        opacity: 0.05,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sp.scale.setScalar(rr(9, 16));
    sp.position.set(rr(-16, 16), rr(0.6, 1.6), rr(-9, 9));
    sp.userData.vx = rr(0.08, 0.25);
    scene.add(sp);
    window._mist.push(sp);
  }
}

// living sky: aurora curtains that answer the magic below
const AURORA_BASE = new THREE.Color(0x3aa88a);
const auroraTint = AURORA_BASE.clone();
const _acol = new THREE.Color(),
  _acol2 = new THREE.Color();
let auroraFlash = 0;
const AUR_PTS = [0, 1, 2].map(() => Array.from({ length: 17 }, () => new THREE.Vector3())); // zero per-frame allocation
function updateAurora(dt) {
  // ribbon writer, runs between begin/commit
  const target =
    state === 'windup' && ctx
      ? _acol.copy(AURORA_BASE).lerp(ctx.pal.main, 0.55)
      : _acol.copy(AURORA_BASE);
  auroraTint.lerp(target, 1 - Math.exp(-dt * 1.1));
  auroraFlash = Math.max(0, auroraFlash - dt * 1.6);
  for (let band = 0; band < 3; band++) {
    const pts = AUR_PTS[band];
    const y0 = 24 + band * 4.5;
    for (let s = 0; s <= 16; s++) {
      const u = s / 16;
      const w1 = Math.sin(u * 5.2 + perfNow * 0.21 + band * 1.7);
      const w2 = Math.sin(u * 11.7 - perfNow * 0.13 + band * 3.1);
      pts[s].set(-52 + u * 104, y0 + w1 * 2.4 + w2 * 0.9, -46 - band * 3 + w2 * 1.2);
    }
    const breathe = (0.5 + 0.5 * Math.sin(perfNow * 0.3 + band * 2.2)) * 0.5 + 0.3;
    const col = _acol2.copy(auroraTint).lerp(WHITE, auroraFlash * 0.7);
    ribbons.add(pts, 4.5 - band * 0.9, col, HDR(0.5 + auroraFlash * 1.7) * breathe, 0.4, 0.12);
  }
}

const HEMI_BASE = 1.05;
const hemi = new THREE.HemisphereLight(0x35486e, 0x0e1118, HEMI_BASE);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x93aade, 1.5);
moon.position.set(-18, 26, -14);
scene.add(moon);
const fill = new THREE.DirectionalLight(0x3d5480, 0.55);
fill.position.set(6, 12, 20);
scene.add(fill);

function blobShadow(x, z, r) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 24),
    new THREE.MeshBasicMaterial({
      map: TEX.glow,
      color: 0x000000,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.012, z);
  m.renderOrder = 1;
  scene.add(m);
  return m;
}
const casterShadow = blobShadow(CASTER_POS.x, CASTER_POS.z, 1.15);
blobShadow(TARGET_POS.x, TARGET_POS.z, 1.05);

// ---------------------------------------------------------------- class rigs
// Kit data lifted from src/render/characters/manifest.ts (player classes).
const M = '/models';
const CLASS_VISUALS = {
  warrior: {
    url: `${M}/chars/players/knight.glb`,
    show: ['Knight_Helmet', 'Knight_Cape'],
    attach: [{ url: `${M}/weapons/sword_1handed.glb`, bone: 'handslot.r', acc: '1H_Sword' }],
    attacks: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal'],
  },
  paladin: {
    url: `${M}/chars/players/paladin.glb`,
    attach: [{ url: `${M}/weapons/axe_1handed.glb`, bone: 'handslot.r', acc: '1H_Axe' }],
    attacks: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal'],
  },
  hunter: {
    url: `${M}/chars/players/ranger.glb`,
    attach: [{ url: `${M}/weapons/crossbow_1handed.glb`, bone: 'handslot.r', acc: '1H_Crossbow' }],
    attacks: ['2H_Ranged_Shoot'],
  },
  rogue: {
    url: `${M}/chars/players/rogue.glb`,
    show: ['Rogue_Cape'],
    attach: [
      { url: `${M}/weapons/dagger.glb`, bone: 'handslot.r', acc: 'Knife' },
      { url: `${M}/weapons/dagger.glb`, bone: 'handslot.l', acc: 'Knife' },
    ],
    attacks: ['Dualwield_Melee_Attack_Chop'],
  },
  priest: {
    url: `${M}/chars/players/mage.glb`,
    show: [],
    attach: [{ url: `${M}/weapons/staff.glb`, bone: 'handslot.r', acc: '2H_Staff' }],
    tint: 0xf0e9d6,
    tintStrength: 0.5,
    attacks: ['2H_Melee_Attack_Chop'],
  },
  mage: {
    url: `${M}/chars/players/mage.glb`,
    show: ['Mage_Cape'],
    attach: [{ url: `${M}/weapons/staff.glb`, bone: 'handslot.r', acc: '2H_Staff' }],
    attacks: ['2H_Melee_Attack_Chop'],
  },
  warlock: {
    url: `${M}/chars/players/mage.glb`,
    show: [],
    attach: [
      { url: `${M}/weapons/wand.glb`, bone: 'handslot.r', acc: '1H_Wand' },
      { url: `${M}/weapons/spellbook_open.glb`, bone: 'handslot.l', gripRef: 'Spellbook_open' },
    ],
    tint: 0x8d5fd3,
    tintStrength: 0.45,
    attacks: ['Spellcast_Shoot'],
  },
  shaman: {
    url: `${M}/chars/players/barbarian.glb`,
    show: ['Barbarian_BearHat'],
    attach: [{ url: `${M}/weapons/axe_1handed.glb`, bone: 'handslot.r', acc: '1H_Axe' }],
    tint: 0x6f8fc9,
    tintStrength: 0.4,
    attacks: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal'],
  },
  druid: {
    url: `${M}/chars/players/druid.glb`,
    attach: [{ url: `${M}/weapons/staff.glb`, bone: 'handslot.r', acc: '2H_Staff' }],
    attacks: ['2H_Melee_Attack_Chop'],
  },
};
// authored grip fallbacks from assets.ts KAYKIT_HAND_GRIPS
const GRIPS = {
  '1H_Axe': {
    r: { p: [0.231697, 0.382471, 0], q: [0, 1, 0, 0], s: 0.622211 },
    l: { p: [-0.231697, 0.382471, 0], q: [0, 0, 0, 1], s: 0.622211 },
  },
  '1H_Sword': {
    r: { p: [0, 0.555174, 0], q: [0, 1, 0, 0], s: 0.8876 },
    l: { p: [0, 0.555174, 0], q: [0, 0, 0, 1], s: 0.8876 },
  },
  '1H_Crossbow': {
    r: { p: [0.2286, 0.0213, -0.0012], q: [0, Math.SQRT1_2, 0, Math.SQRT1_2], s: 0.6109 },
  },
  '2H_Staff': { r: { p: [-0.0427, 0.1769, 0], q: [0, 1, 0, 0], s: 1.0773 } },
  Knife: {
    r: { p: [-0.0095, 0.378, 0], q: [0, 1, 0, 0], s: 0.6029 },
    l: { p: [0.0095, 0.378, 0], q: [0, 0, 0, 1], s: 0.6029 },
  },
  '1H_Wand': { r: { p: [0, 0.2174, 0], q: [0, 1, 0, 0], s: 0.4831 } },
};

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const gltfCache = new Map();
async function loadGlb(url) {
  if (!gltfCache.has(url)) {
    const pack = window.__ASSET_PACK__; // single-file build: models packed inline
    if (pack?.index[url]) {
      const [off, len] = pack.index[url];
      const buf = pack.blob.slice(off, off + len).buffer;
      gltfCache.set(url, new Promise((res, rej) => gltfLoader.parse(buf, '', res, rej)));
    } else {
      gltfCache.set(url, gltfLoader.loadAsync(url));
    }
  }
  return gltfCache.get(url);
}

const rigs = new Map();
async function loadRig(cls) {
  if (rigs.has(cls)) return rigs.get(cls);
  const def = CLASS_VISUALS[cls];
  const charG = await loadGlb(def.url);
  // mage.glb serves priest/mage/warlock, every rig gets a skeleton-safe clone
  const model = skeletonClone(charG.scene);

  if (def.show) {
    const keep = new Set(def.show);
    model.traverse((o) => {
      if (o.isMesh && !o.isSkinnedMesh && !keep.has(o.name)) o.visible = false;
    });
  }
  if (def.tint !== undefined) {
    const tint = new THREE.Color(def.tint);
    model.traverse((o) => {
      if (o.isMesh && o.material && !Array.isArray(o.material)) {
        o.material = o.material.clone();
        o.material.color.lerp(tint, def.tintStrength ?? 0.4);
      }
    });
  }

  // normalize on the idle-POSED body (bind pose floats the feet)
  const mixer = new THREE.AnimationMixer(model);
  const clips = new Map(charG.animations.map((c) => [c.name, c]));
  const idleClip = clips.get('Idle');
  if (idleClip) {
    mixer.clipAction(idleClip).play();
    mixer.update(Math.min(0.5, idleClip.duration * 0.5));
  }
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 2) {
      v.fromBufferAttribute(pos, i);
      o.applyBoneTransform(i, v);
      v.applyMatrix4(o.matrixWorld);
      bounds.expandByPoint(v);
    }
  });
  mixer.stopAllAction();
  const scale = 2.6 / Math.max(1e-3, bounds.max.y - bounds.min.y);

  // weapon attachments with authored grips
  for (const att of def.attach ?? []) {
    const bone =
      model.getObjectByName(att.bone) ?? model.getObjectByName(att.bone.replace(/[[\].:/]/g, ''));
    if (!bone) continue;
    const wG = await loadGlb(att.url);
    let payload = wG.scene.clone(true); // static meshes, plain deep clone, shared geo/mats
    if (payload.children.length === 1) {
      const holder = new THREE.Group();
      const child = payload.children[0];
      holder.scale.copy(child.scale);
      child.scale.set(1, 1, 1);
      child.position.set(0, 0, 0);
      child.rotation.set(0, 0, 0);
      payload.remove(child);
      holder.add(child);
      payload = holder;
    }
    const side = att.bone.replace(/[[\].:/]/g, '').endsWith('l') ? 'l' : 'r';
    const refName =
      side === 'l' && att.acc === 'Knife' ? 'Knife_Offhand' : (att.gripRef ?? att.acc);
    const ref = refName
      ? (model.getObjectByName(refName) ?? model.getObjectByName(refName.replace(/[[\].:/]/g, '')))
      : null;
    if (ref) {
      payload.position.copy(ref.position);
      payload.quaternion.copy(ref.quaternion);
      payload.scale.copy(ref.scale);
    } else if (att.acc && GRIPS[att.acc]) {
      const grip = side === 'l' ? (GRIPS[att.acc].l ?? GRIPS[att.acc].r) : GRIPS[att.acc].r;
      payload.position.set(...grip.p);
      payload.quaternion.set(...grip.q);
      payload.scale.setScalar(grip.s);
    }
    bone.add(payload);
  }

  // private material clones per rig, the buff rim glow writes emissive and
  // must never leak across classes sharing a GLB (mage.glb serves three)
  const rigMats = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = list.map((m) => m.clone());
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
    for (const c of cloned) {
      if (c.emissive === undefined) continue;
      // TRUE fresnel rim: buff glow lives on the silhouette edge, flat
      // emissive repaints the whole body into a cutout; a rim OUTLINES it
      c.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           float rimW = pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 1.7);
           totalEmissiveRadiance *= 0.22 + rimW * 2.8;`,
        );
      };
      rigMats.push(c);
    }
  });

  model.scale.setScalar(scale);
  model.position.y = -bounds.min.y * scale;
  model.rotation.y = Math.PI / 2;

  const g = new THREE.Group();
  g.position.copy(CASTER_POS);
  g.add(model);
  g.visible = false;
  scene.add(g);

  let current = null;
  // freeze the body on the contact frame, the swing "bites"
  const hold = (d) => {
    if (!current) return;
    const a = current;
    const prev = a.timeScale;
    a.timeScale = 0.07;
    setTimeoutSim(d, () => {
      a.timeScale = prev;
    });
  };
  const play = (name, { loop = true, fade = 0.2, timeScale = 1 } = {}) => {
    const clip = clips.get(name);
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (current === next && loop) return;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = timeScale;
    next.play();
    if (current && current !== next) next.crossFadeFrom(current, fade, false);
    current = next;
  };

  const fallbackHand = new THREE.Object3D();
  fallbackHand.position.set(0.55, 1.5, 0);
  g.add(fallbackHand);
  const handL =
    model.getObjectByName('handslot.l') ?? model.getObjectByName('handslotl') ?? fallbackHand;
  const handR =
    model.getObjectByName('handslot.r') ?? model.getObjectByName('handslotr') ?? fallbackHand;

  const rig = {
    cls,
    group: g,
    model,
    mixer,
    play,
    hold,
    handL,
    handR,
    attacks: def.attacks,
    mats: rigMats,
    clipDur: (n) => clips.get(n)?.duration ?? 0.6,
  };
  rigs.set(cls, rig);
  return rig;
}

// ---------------------------------------------------------------- target dummy
function buildDummy() {
  const g = new THREE.Group();
  g.position.copy(TARGET_POS);
  const mats = [];
  const mk = (color, rough = 0.9) => {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: rough,
      emissive: 0x2f6bff,
      emissiveIntensity: 0,
    });
    mats.push(m);
    return m;
  };
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.26, 18), mk(0x3a4048));
  base.position.y = 0.13;
  g.add(base);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 2.1, 12), mk(0x4a3a26));
  post.position.y = 1.3;
  g.add(post);
  const barPivot = new THREE.Group();
  barPivot.position.y = 1.82;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 10), mk(0x4a3a26));
  bar.rotation.x = Math.PI / 2;
  barPivot.add(bar);
  g.add(barPivot);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 12), mk(0x6a5a33));
  head.position.y = 2.42;
  g.add(head);
  for (const dz of [-0.8, 0.8]) {
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mk(0x54442c));
    fist.position.set(0, 1.82, dz);
    g.add(fist);
  }
  scene.add(g);

  const shellMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x5aa4ff) },
      uIntensity: { value: 0 },
      uTime: { value: 0 },
      uNoise: { value: TEX.noise },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uIntensity; uniform float uTime; uniform sampler2D uNoise;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
        float n = texture2D(uNoise, vUv * 3.0 + vec2(uTime * 0.6, uTime * -0.35)).r;
        float a = fres * (0.5 + 0.7 * n) * uIntensity;
        gl_FragColor = vec4(uColor * (1.0 + fres * 2.0) * uIntensity, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.5, 6, 18), shellMat);
  shell.position.set(TARGET_POS.x, 1.5, TARGET_POS.z);
  shell.visible = false;
  scene.add(shell);

  return {
    group: g,
    mats,
    shell,
    shellMat,
    barPivot,
    head,
    headBaseY: 2.42,
    hitPos: new THREE.Vector3(TARGET_POS.x - 0.25, 1.75, TARGET_POS.z),
  };
}
const dummy = buildDummy();

// caster-side fresnel shell (self buffs/heals), humanoid capsule, follows rig
const casterShellMat = dummy.shellMat.clone();
casterShellMat.uniforms = THREE.UniformsUtils.clone(dummy.shellMat.uniforms);
casterShellMat.uniforms.uNoise.value = TEX.noise;
const casterShell = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.35, 6, 18), casterShellMat);
casterShell.visible = false;
scene.add(casterShell);

function buildTotems() {
  const tex = totemTexture();
  const out = [];
  for (const dz of [-2.3, 2.3]) {
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.9,
      emissive: 0x4d9fff,
      emissiveMap: tex,
      emissiveIntensity: 0.18,
    });
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 2.5, 10), mat);
    t.position.set(CASTER_POS.x - 1.9, 1.25, dz);
    scene.add(t);
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x24303e, roughness: 0.85 }),
    );
    cap.position.set(CASTER_POS.x - 1.9, 2.72, dz);
    scene.add(cap);
    blobShadow(CASTER_POS.x - 1.9, dz, 0.5);
    out.push(mat);
  }
  return out;
}
const totemMats = buildTotems();

// ---------------------------------------------------------------- ribbons
const MAXV = 16384,
  MAXI = MAXV * 3; // index budget matches worst-case segments
class RibbonMesh {
  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAXV * 3);
    this.col = new Float32Array(MAXV * 3);
    this.uv = new Float32Array(MAXV * 2);
    this.idx = new Uint32Array(MAXI);
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'color',
      new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'uv',
      new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage),
    );
    this.flow = new Float32Array(MAXV);
    this.geo.setAttribute(
      'aFlow',
      new THREE.BufferAttribute(this.flow, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    // energy visibly FLOWS along beams/trails via scrolling fBm
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: TEX.ribbon }, uNoise: { value: TEX.noise }, uTime: { value: 0 } },
      vertexShader: `
        attribute float aFlow;
        varying vec2 vUv; varying vec3 vColor; varying float vFlow;
        void main() {
          vUv = uv; vColor = color; vFlow = aFlow;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uMap; uniform sampler2D uNoise; uniform float uTime;
        varying vec2 vUv; varying vec3 vColor; varying float vFlow;
        void main() {
          vec4 base = texture2D(uMap, vUv);
          float flow = 1.0;
          if (vFlow != 0.0) {
            flow = 0.5 + 1.0 * texture2D(uNoise, vec2(vUv.x * 1.1 - uTime * 1.8 * vFlow, vUv.y * 0.4)).r;
          }
          gl_FragColor = vec4(vColor * flow, base.a * min(flow, 1.15));
        }`,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.v = 0;
    this.i = 0;
    this._t1 = new THREE.Vector3();
    this._t2 = new THREE.Vector3();
    this._t3 = new THREE.Vector3();
  }
  begin() {
    this.v = 0;
    this.i = 0;
  }
  add(pts, width, color, hdrMul, taper = 1, flow = 0) {
    const n = pts.length;
    if (n < 2 || this.v + n * 2 > MAXV || this.i + (n - 1) * 6 > MAXI) return;
    const camPos = camera.getWorldPosition(this._t3);
    const base = this.v;
    for (let k = 0; k < n; k++) {
      const p = pts[k];
      const prev = pts[Math.max(0, k - 1)],
        next = pts[Math.min(n - 1, k + 1)];
      this._t1.subVectors(next, prev);
      this._t2.subVectors(camPos, p);
      this._t1.cross(this._t2).normalize();
      const u = k / (n - 1);
      const pinch = taper > 0 ? Math.min(1, 4 * u * (1 - u) + (1 - taper)) : 1;
      const w = width * pinch * 0.5;
      const vi = (base + k * 2) * 3;
      this.pos[vi] = p.x + this._t1.x * w;
      this.pos[vi + 1] = p.y + this._t1.y * w;
      this.pos[vi + 2] = p.z + this._t1.z * w;
      this.pos[vi + 3] = p.x - this._t1.x * w;
      this.pos[vi + 4] = p.y - this._t1.y * w;
      this.pos[vi + 5] = p.z - this._t1.z * w;
      const r = color.r * hdrMul,
        g2 = color.g * hdrMul,
        b = color.b * hdrMul;
      this.col[vi] = r;
      this.col[vi + 1] = g2;
      this.col[vi + 2] = b;
      this.col[vi + 3] = r;
      this.col[vi + 4] = g2;
      this.col[vi + 5] = b;
      const ui = (base + k * 2) * 2;
      this.uv[ui] = u * 3;
      this.uv[ui + 1] = 0;
      this.uv[ui + 2] = u * 3;
      this.uv[ui + 3] = 1;
      this.flow[base + k * 2] = flow;
      this.flow[base + k * 2 + 1] = flow;
    }
    for (let k = 0; k < n - 1; k++) {
      const a = base + k * 2;
      this.idx[this.i++] = a;
      this.idx[this.i++] = a + 1;
      this.idx[this.i++] = a + 2;
      this.idx[this.i++] = a + 1;
      this.idx[this.i++] = a + 3;
      this.idx[this.i++] = a + 2;
    }
    this.v += n * 2;
  }
  commit() {
    this.mat.uniforms.uTime.value = perfNow % 3600;
    const emptyNow = this.i === 0;
    if (emptyNow) {
      // nothing drawn, the stale GPU tail is invisible, skip the upload
      if (!this._wasEmpty) {
        this._wasEmpty = true;
        this.geo.setDrawRange(0, 0);
      }
      return;
    }
    this._wasEmpty = false;
    const up = (attr, count) => {
      attr.clearUpdateRanges();
      if (count > 0) attr.addUpdateRange(0, count);
      attr.needsUpdate = true;
    };
    up(this.geo.attributes.position, this.v * 3);
    up(this.geo.attributes.color, this.v * 3);
    up(this.geo.attributes.uv, this.v * 2);
    up(this.geo.attributes.aFlow, this.v);
    up(this.geo.index, this.i);
    this.geo.setDrawRange(0, this.i);
  }
}
const ribbons = new RibbonMesh();

// jagged bolt generator, midpoint displacement + recursive branches
function genBolt(
  a,
  b,
  { jag = 0.14, subdiv = 5, branchP = 0.3, depth = 2, branchScale = 0.42 } = {},
  out = [],
  intensity = 1,
) {
  let pts = [a.clone(), b.clone()];
  const totalLen = a.distanceTo(b);
  const bv1 = new THREE.Vector3().subVectors(b, a).normalize();
  const bv2 = new THREE.Vector3(bv1.y, -bv1.x + 0.31, bv1.z + 0.17).cross(bv1).normalize();
  const bv3 = new THREE.Vector3().crossVectors(bv1, bv2);
  let amp = totalLen * jag;
  for (let s = 0; s < subdiv; s++) {
    const next = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const mid = pts[k].clone().lerp(pts[k + 1], 0.5);
      mid.addScaledVector(bv2, rr(-amp, amp));
      mid.addScaledVector(bv3, rr(-amp, amp));
      next.push(mid, pts[k + 1]);
    }
    pts = next;
    amp *= 0.52;
  }
  out.push({ pts, intensity });
  if (depth > 0) {
    for (let k = 2; k < pts.length - 2; k += 2) {
      if (rnd() > branchP) continue;
      const dir = pts[k + 1]
        .clone()
        .sub(pts[k - 1])
        .normalize();
      dir.addScaledVector(bv2, rr(-0.9, 0.9)).addScaledVector(bv3, rr(-0.9, 0.9)).normalize();
      const end = pts[k].clone().addScaledVector(dir, totalLen * branchScale * rr(0.4, 1));
      genBolt(
        pts[k],
        end,
        {
          jag: jag * 1.3,
          subdiv: Math.max(2, subdiv - 2),
          branchP: branchP * 0.6,
          depth: depth - 1,
          branchScale,
        },
        out,
        intensity * 0.45,
      );
    }
  }
  return out;
}

// smooth arc between two points with sideways bow (comet paths, slash arcs)
function smoothArc(a, b, bow = 0.4, segs = 16, up = 0) {
  const pts = [];
  const dir = b.clone().sub(a);
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(bow);
  for (let i = 0; i < segs; i++) {
    const u = i / (segs - 1);
    const p = a.clone().lerp(b, u);
    const arc = Math.sin(u * Math.PI);
    p.add(side.clone().multiplyScalar(arc));
    p.y += up * arc;
    pts.push(p);
  }
  return pts;
}

const boltFx = [];
function spawnBoltFx(cfg) {
  boltFx.push({
    age: 0,
    lastGen: -1,
    cache: [],
    life: cfg.life ?? 0.2,
    flicker: cfg.flicker ?? 0.045,
    width: cfg.width ?? 0.1,
    glowWidth: cfg.glowWidth ?? (cfg.width ?? 0.1) * 3.2,
    hdr: cfg.hdr ?? 2.5,
    gen: cfg.gen,
    curve: cfg.curve ?? ((t) => (1 - t) ** 0.7),
    colCore: cfg.colCore,
    colGlow: cfg.colGlow,
  });
}
function updateBoltFx(dt) {
  for (let i = boltFx.length - 1; i >= 0; i--) {
    const fx = boltFx[i];
    fx.age += dt;
    if (fx.age >= fx.life) {
      boltFx.splice(i, 1);
      continue;
    }
    if (fx.age - fx.lastGen >= fx.flicker) {
      fx.lastGen = fx.age;
      fx.cache = fx.gen();
    }
    const k = fx.curve(fx.age / fx.life);
    for (const line of fx.cache) {
      ribbons.add(
        line.pts,
        fx.glowWidth * line.intensity,
        fx.colGlow,
        HDR(1.3) * k * line.intensity,
        1,
      );
      ribbons.add(
        line.pts,
        fx.width * line.intensity,
        fx.colCore,
        HDR(fx.hdr) * k * line.intensity,
        1,
      );
    }
  }
}

// ---------------------------------------------------------------- pools
class Pool {
  constructor(count, size, tex, gravity, fadePow = 1.4, bounce = false) {
    this.count = count;
    this.n = 0;
    this.gravity = gravity;
    this.fadePow = fadePow;
    this.bounce = bounce;
    this.p = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.c = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.geo.setAttribute(
      'color',
      new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.points = new THREE.Points(
      this.geo,
      new THREE.PointsMaterial({
        size,
        map: tex,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        toneMapped: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
    this.geo.setDrawRange(0, 0);
  }
  spawn(x, y, z, vx, vy, vz, life, r, g, b) {
    if (this.n >= this.count) return;
    const i = this.n++;
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.base[i * 3] = r;
    this.base[i * 3 + 1] = g;
    this.base[i * 3 + 2] = b;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        for (let k = 0; k < 3; k++) {
          this.p[i * 3 + k] = this.p[l * 3 + k];
          this.vel[i * 3 + k] = this.vel[l * 3 + k];
          this.base[i * 3 + k] = this.base[l * 3 + k];
        }
        this.life[i] = this.life[l];
        this.max[i] = this.max[l];
        i--;
        continue;
      }
      this.vel[i * 3 + 1] -= this.gravity * dt;
      this.p[i * 3] += this.vel[i * 3] * dt;
      this.p[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.bounce && this.p[i * 3 + 1] < 0.05 && this.vel[i * 3 + 1] < 0) {
        this.p[i * 3 + 1] = 0.05;
        this.vel[i * 3 + 1] = Math.abs(this.vel[i * 3 + 1]) > 0.5 ? -this.vel[i * 3 + 1] * 0.42 : 0;
        this.vel[i * 3] *= 0.66;
        this.vel[i * 3 + 2] *= 0.66;
      }
      const f = clamp01(this.life[i] / this.max[i]) ** this.fadePow;
      this.c[i * 3] = this.base[i * 3] * f;
      this.c[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.c[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    const emptyNow = this.n === 0;
    if (emptyNow) {
      // draw range 0 hides the stale tail, no upload needed
      if (!this._wasEmpty) {
        this._wasEmpty = true;
        this.geo.setDrawRange(0, 0);
      }
      return;
    }
    this._wasEmpty = false;
    const pa = this.geo.attributes.position,
      ca = this.geo.attributes.color;
    pa.clearUpdateRanges();
    ca.clearUpdateRanges();
    pa.addUpdateRange(0, this.n * 3);
    ca.addUpdateRange(0, this.n * 3);
    pa.needsUpdate = true;
    ca.needsUpdate = true;
    this.geo.setDrawRange(0, this.n);
  }
}
const sparkPool = new Pool(2048, 0.13, TEX.dot, 9.5, 1.2);
const emberPool = new Pool(1024, 0.24, TEX.glow, 1.2, 1.6);
const riserPool = new Pool(768, 0.2, TEX.glow, -0.7, 1.5);
const debrisPool = new Pool(512, 0.16, TEX.chip, 13, 1.1, true); // bouncing shards/chips
const smolderPool = new Pool(384, 0.2, TEX.glow, 10, 2.2, true); // embers that land + glow

// physicalized debris flavored by the palette's element
function spawnDebris(kind, pos, pal, count) {
  if (kind === 'shards') {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2,
        sp = rr(3, 8);
      debrisPool.spawn(
        pos.x,
        pos.y,
        pos.z,
        Math.cos(a) * sp,
        rr(2, 6),
        Math.sin(a) * sp,
        rr(0.8, 1.4),
        pal.ion.r * HDR(1.9),
        pal.ion.g * HDR(1.9),
        pal.ion.b * HDR(1.9),
      );
    }
  } else if (kind === 'smolder') {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2,
        sp = rr(2, 6);
      smolderPool.spawn(
        pos.x,
        pos.y,
        pos.z,
        Math.cos(a) * sp,
        rr(1.5, 5),
        Math.sin(a) * sp,
        rr(1.4, 2.2),
        pal.main.r * HDR(2),
        pal.main.g * HDR(2),
        pal.main.b * HDR(2),
      );
    }
  } else if (kind === 'chips') {
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2,
        sp = rr(2.5, 7);
      debrisPool.spawn(
        pos.x,
        pos.y,
        pos.z,
        Math.cos(a) * sp,
        rr(2, 5),
        Math.sin(a) * sp,
        rr(0.6, 1.1),
        0.55,
        0.5,
        0.42,
      ); // dim stone/wood chips
    }
  } // 'sparks' handled by the existing spark shower
}

function burst(pool, x, y, z, n, speed, life, col, hdrMul, upBias = 0.4) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2,
      e = (rr(-0.5, 1) * Math.PI) / 2;
    const s = speed * rr(0.35, 1);
    pool.spawn(
      x,
      y,
      z,
      Math.cos(a) * Math.cos(e) * s,
      (Math.sin(e) + upBias) * s,
      Math.sin(a) * Math.cos(e) * s,
      life * rr(0.5, 1),
      col.r * hdrMul,
      col.g * hdrMul,
      col.b * hdrMul,
    );
  }
}

// velocity streaks: motion-smeared shrapnel drawn as 2-point ribbons
const streaksList = [];
function spawnStreaks(pos, col, n, speed) {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2,
      e = (rr(-0.2, 1.1) * Math.PI) / 2;
    const s = speed * rr(0.5, 1.3);
    streaksList.push({
      p: pos.clone(),
      v: new THREE.Vector3(
        Math.cos(a) * Math.cos(e) * s,
        (Math.sin(e) + 0.35) * s,
        Math.sin(a) * Math.cos(e) * s,
      ),
      life: rr(0.18, 0.34),
      max: 0.34,
      col,
    });
  }
}
const _sPair = [new THREE.Vector3(), new THREE.Vector3()]; // reused, add() copies immediately
function updateStreaks(dt) {
  // runs between ribbons.begin/commit
  for (let i = streaksList.length - 1; i >= 0; i--) {
    const s = streaksList[i];
    s.life -= dt;
    if (s.life <= 0) {
      streaksList.splice(i, 1);
      continue;
    }
    s.v.y -= 16 * dt;
    s.p.addScaledVector(s.v, dt);
    const fade = clamp01(s.life / s.max);
    _sPair[0].copy(s.p).addScaledVector(s.v, -0.045);
    _sPair[1].copy(s.p);
    ribbons.add(_sPair, 0.045 + s.v.length() * 0.002, s.col, HDR(2.4) * fade, 0);
  }
}

// contact shadows: a dark pulse that grounds every blast
const contactShadows = [];
function spawnContactShadow(pos, r) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({
      map: TEX.glow,
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(pos.x, 0.018, pos.z);
  m.renderOrder = 1;
  scene.add(m);
  contactShadows.push({ m, age: 0, r });
}
function updateContactShadows(dt) {
  for (let i = contactShadows.length - 1; i >= 0; i--) {
    const c = contactShadows[i];
    c.age += dt;
    const t = clamp01(c.age / 0.45);
    c.m.scale.setScalar(c.r * (0.7 + easeOutCubic(t) * 0.9));
    c.m.material.opacity = 0.42 * Math.sin(Math.min(1, t) * Math.PI);
    if (t >= 1) {
      scene.remove(c.m);
      c.m.material.dispose();
      c.m.geometry.dispose();
      contactShadows.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- shock rings
const ringMatProto = new THREE.ShaderMaterial({
  uniforms: {
    uProgress: { value: 0 },
    uColor: { value: new THREE.Color() },
    uIntensity: { value: 1 },
    uNoise: { value: TEX.noise },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float uProgress; uniform vec3 uColor; uniform float uIntensity; uniform sampler2D uNoise;
    varying vec2 vUv;
    void main() {
      vec2 d2 = vUv - 0.5;
      float d = length(d2) * 2.0;
      float ang = atan(d2.y, d2.x + 1e-6); // guarded: atan(0,0) is undefined → NaN into bloom
      float band = smoothstep(uProgress - 0.32, uProgress - 0.06, d) * (1.0 - smoothstep(uProgress - 0.03, uProgress, d));
      float n = texture2D(uNoise, vec2(ang * 0.6366, d * 1.4 - uProgress * 0.35)).r;
      band *= smoothstep(0.18, 0.62, n + (1.0 - uProgress) * 0.45);
      float fade = pow(1.0 - uProgress, 1.35);
      vec3 col = uColor * uIntensity * (0.6 + 1.6 * band);
      gl_FragColor = vec4(col * band * fade, band * fade);
    }`,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const shockRings = [];
function spawnRing(pos, maxR, dur, color, intensity, vertical = false) {
  const mat = ringMatProto.clone();
  mat.uniforms.uNoise.value = TEX.noise;
  mat.uniforms.uColor.value = color.clone();
  mat.uniforms.uIntensity.value = intensity;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.position.copy(pos);
  if (vertical) m.lookAt(camera.getWorldPosition(new THREE.Vector3()));
  else m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(maxR * 2);
  m.renderOrder = 5;
  scene.add(m);
  shockRings.push({ m, mat, age: 0, dur });
}
function updateRings(dt) {
  for (let i = shockRings.length - 1; i >= 0; i--) {
    const r = shockRings[i];
    r.age += dt;
    const t = clamp01(r.age / r.dur);
    r.mat.uniforms.uProgress.value = easeOutQuart(t);
    if (t >= 1) {
      scene.remove(r.m);
      r.mat.dispose();
      r.m.geometry.dispose();
      shockRings.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- flipbook
const flipMat = new THREE.ShaderMaterial({
  uniforms: {
    uMap: { value: null },
    uFrame: { value: 0 },
    uOpacity: { value: 1 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uHdr: { value: 1 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D uMap; uniform float uFrame; uniform float uOpacity; uniform vec3 uTint; uniform float uHdr;
    varying vec2 vUv;
    vec4 cell(float f) {
      f = clamp(f, 0.0, 63.0);
      float col = mod(f, 8.0), row = floor(f / 8.0);
      vec2 uv = (vUv + vec2(col, 7.0 - row)) / 8.0;
      return texture2D(uMap, uv);
    }
    void main() {
      float fi = floor(uFrame);
      vec4 a = cell(fi), b = cell(fi + 1.0);
      vec4 s = mix(a, b, fract(uFrame));
      gl_FragColor = vec4(s.rgb * uTint * uHdr, s.a) * uOpacity;
    }`,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const flipbooks = [];
function spawnFlipbook(pos, size, dur, hdrMul, tint, style = 'electric') {
  const mat = flipMat.clone();
  mat.uniforms.uMap.value = flipbookSheet(style);
  mat.uniforms.uHdr.value = hdrMul;
  mat.uniforms.uTint.value.copy(tint);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.position.copy(pos);
  m.renderOrder = 8;
  scene.add(m);
  flipbooks.push({ m, mat, age: 0, dur, size });
}
function updateFlipbooks(dt) {
  for (let i = flipbooks.length - 1; i >= 0; i--) {
    const f = flipbooks[i];
    f.age += dt;
    const t = clamp01(f.age / f.dur);
    f.mat.uniforms.uFrame.value = t * 63;
    f.mat.uniforms.uOpacity.value = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    f.m.scale.setScalar(f.size * (0.65 + 0.55 * easeOutCubic(t)));
    f.m.quaternion.copy(camera.quaternion);
    if (t >= 1) {
      scene.remove(f.m);
      f.mat.dispose();
      f.m.geometry.dispose();
      flipbooks.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- decals
// dissolve semantics: visible where noise > uDissolve (1 = hidden, 0 = shown)
function decalMaterial(map, hdrMul) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uNoise: { value: TEX.noise },
      uColor: { value: new THREE.Color(0x5aa4ff) },
      uDissolve: { value: 1 },
      uHdr: { value: hdrMul },
      uSpin: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform sampler2D uNoise; uniform vec3 uColor;
      uniform float uDissolve; uniform float uHdr; uniform float uSpin;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float cs = cos(uSpin), sn = sin(uSpin);
        vec2 ruv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
        vec4 tex = texture2D(uMap, ruv);
        float n = texture2D(uNoise, vUv * 2.3).r;
        float body = tex.a * smoothstep(uDissolve, uDissolve + 0.14, n);
        float edge = (smoothstep(uDissolve - 0.02, uDissolve + 0.04, n) - smoothstep(uDissolve + 0.08, uDissolve + 0.16, n)) * tex.a;
        vec3 col = tex.rgb * uColor * uHdr + vec3(0.92, 0.95, 1.0) * edge * uHdr * 2.0;
        gl_FragColor = vec4(col, clamp(body + edge, 0.0, 1.0));
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
// reusable caster-side rune projector (cast circles, heal glyphs, portals)
const runeMat = decalMaterial(TEX.rune, HDR(1.6));
const runeMesh = new THREE.Mesh(new THREE.CircleGeometry(2.05, 48), runeMat);
runeMesh.rotation.x = -Math.PI / 2;
runeMesh.position.set(CASTER_POS.x, 0.03, CASTER_POS.z);
runeMesh.renderOrder = 2;
runeMesh.visible = false;
scene.add(runeMesh);
// second projector for summon portals (can overlap the cast circle)
const portalMat = decalMaterial(TEX.rune, HDR(1.8));
const portalMesh = new THREE.Mesh(new THREE.CircleGeometry(1.3, 40), portalMat);
portalMesh.rotation.x = -Math.PI / 2;
portalMesh.renderOrder = 2;
portalMesh.visible = false;
scene.add(portalMesh);

const scorchDark = new THREE.Mesh(
  new THREE.CircleGeometry(1.9, 32),
  new THREE.MeshBasicMaterial({
    map: TEX.scorch,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    color: 0x000000,
  }),
);
scorchDark.rotation.x = -Math.PI / 2;
scorchDark.position.set(TARGET_POS.x, 0.025, TARGET_POS.z);
scorchDark.renderOrder = 2;
scene.add(scorchDark);
const crackMat = decalMaterial(TEX.cracks, HDR(2.2));
crackMat.uniforms.uHdr.value = 0;
const crackMesh = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), crackMat);
crackMesh.rotation.x = -Math.PI / 2;
crackMesh.position.set(TARGET_POS.x, 0.035, TARGET_POS.z);
crackMesh.renderOrder = 3;
crackMesh.visible = false;
scene.add(crackMesh);

// ---------------------------------------------------------------- light shafts
// volumetric-feel cones for sky-beams, ascend windups, heals
const shaftMatProto = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color() },
    uIntensity: { value: 1 },
    uTime: { value: 0 },
    uNoise: { value: null },
    uFade: { value: 1 },
  },
  vertexShader: `
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uIntensity; uniform float uTime; uniform sampler2D uNoise; uniform float uFade;
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() {
      float streaks = 0.55 + 0.7 * texture2D(uNoise, vec2(vUv.x * 2.0, vUv.y * 1.4 - uTime * 0.45)).r;
      float vert = 0.3 + 0.7 * (1.0 - vUv.y);
      float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
      float a = vert * streaks * edge * uIntensity * uFade;
      gl_FragColor = vec4(uColor * (1.4 + streaks), a);
    }`,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const shafts = [];
function spawnShaft(pos, { radius = 1.1, height = 13, color, dur = 0.55, intensity = 1 } = {}) {
  intensity = Math.min(intensity, 1.3); // ACES must keep internal structure, no flat-white cores
  const mat = shaftMatProto.clone();
  mat.uniforms.uNoise.value = TEX.noise;
  mat.uniforms.uColor.value.copy(color);
  mat.uniforms.uIntensity.value = intensity;
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.38, radius, height, 20, 1, true),
    mat,
  );
  m.position.set(pos.x, height / 2, pos.z);
  m.renderOrder = 5;
  scene.add(m);
  const rec = {
    m,
    mat,
    age: 0,
    dur,
    end() {
      if (this.dur > this.age + 0.3) this.dur = this.age + 0.3;
    },
  };
  shafts.push(rec);
  return rec;
}
function updateShafts(dt) {
  for (let i = shafts.length - 1; i >= 0; i--) {
    const s = shafts[i];
    s.age += dt;
    s.mat.uniforms.uTime.value = perfNow;
    const t = s.dur === Infinity ? 0 : clamp01(s.age / s.dur);
    s.mat.uniforms.uFade.value =
      Math.min(1, s.age / 0.15) * (s.dur === Infinity ? 1 : (1 - t) ** 1.1);
    if (t >= 1) {
      scene.remove(s.m);
      s.mat.dispose();
      s.m.geometry.dispose();
      shafts.splice(i, 1);
    }
  }
}
function clearShafts() {
  for (const s of shafts) s.end();
}

// ---------------------------------------------------------------- light pulses
class LightPulsePool {
  constructor(n) {
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 26, 2);
      scene.add(l);
      this.lights.push({ l, age: 1e9, dur: 1, peak: 0 });
    }
  }
  pulse(pos, color, peak, dur) {
    let best = this.lights[0];
    for (const s of this.lights) if (s.age / s.dur > best.age / best.dur) best = s;
    best.l.position.copy(pos);
    best.l.color.copy(color);
    best.age = 0;
    best.dur = dur;
    best.peak = peak;
  }
  update(dt) {
    for (const s of this.lights) {
      s.age += dt;
      const t = clamp01(s.age / s.dur);
      s.l.intensity =
        t >= 1 ? 0 : s.peak * (t < 0.1 ? easeOutCubic(t / 0.1) : easeOutExpo(1 - (t - 0.1) / 0.9));
    }
  }
}
const lightPulses = new LightPulsePool(4);
const chargeLight = new THREE.PointLight(0x6fb4ff, 0, 20, 2);
scene.add(chargeLight);
const projLight = new THREE.PointLight(0x7fc0ff, 0, 22, 2);
scene.add(projLight);

// ---------------------------------------------------------------- orb + flashes
// ---------------------------------------------------------------- projectile identity meshes
// Bolts stop being one shared comet: fire tumbles a molten rock, frost spins a
// shard cluster, shadow writhes, hunters loose an actual arrow.
const PROJ_DEFAULT = {
  fire: 'rock',
  blood: 'rock',
  frost: 'shard',
  moon: 'shard',
  shadow: 'wisp',
  venom: 'wisp',
};
let projMesh = null;
function buildProjMesh(style, pal) {
  const g = new THREE.Group();
  const add = (geo, color, hdr, opts = {}) => {
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: color.clone().multiplyScalar(HDR(hdr)),
        transparent: true,
        opacity: opts.opacity ?? 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    g.add(m);
    return m;
  };
  if (style === 'shard') {
    for (let i = 0; i < 3; i++) {
      const s = add(new THREE.OctahedronGeometry(rr(0.09, 0.15), 0), pal.ion, 2.2);
      s.position.set(rr(-0.12, 0.12), rr(-0.12, 0.12), rr(-0.12, 0.12));
      s.scale.y = rr(1.6, 2.2); // elongated crystals
      s.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    }
    g.userData.spin = 7;
  } else if (style === 'rock') {
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.17, 1),
      new THREE.MeshBasicMaterial({ color: 0x1c0e06, toneMapped: false }),
    ); // dark molten core
    g.add(core);
    add(new THREE.IcosahedronGeometry(0.2, 1), pal.main, 1.5, { opacity: 0.4 }); // heat shell
    g.userData.spin = 3.2;
  } else if (style === 'wisp') {
    for (let i = 0; i < 3; i++) {
      const s = add(new THREE.SphereGeometry(rr(0.08, 0.13), 10, 8), pal.main, 1.6, {
        opacity: 0.65,
      });
      s.userData.ph = rnd() * 6.28;
    }
    g.userData.writhe = true;
  } else if (style === 'arrow') {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.55, 6),
      new THREE.MeshBasicMaterial({ color: 0x2a1e10, toneMapped: false }),
    );
    shaft.rotation.z = -Math.PI / 2; // lie along +X
    g.add(shaft);
    const tip = add(new THREE.ConeGeometry(0.035, 0.12, 8), pal.core, 2.6);
    tip.rotation.z = -Math.PI / 2;
    tip.position.x = 0.32;
    g.userData.arrow = true;
  }
  scene.add(g);
  return g;
}
function clearProjMesh() {
  if (!projMesh) return;
  projMesh.traverse((o) => {
    if (o.isMesh) {
      o.material.dispose();
      o.geometry.dispose();
    }
  });
  scene.remove(projMesh);
  projMesh = null;
}
const _projQuat = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);
function updateProjMesh(dt) {
  if (!projMesh) return;
  projMesh.position.copy(projPos);
  if (projMesh.userData.arrow) {
    projMesh.quaternion.copy(_projQuat.setFromUnitVectors(_xAxis, projDir));
  } else if (projMesh.userData.spin) {
    projMesh.rotation.x += dt * projMesh.userData.spin;
    projMesh.rotation.y += dt * projMesh.userData.spin * 0.7;
  }
  if (projMesh.userData.writhe) {
    projMesh.children.forEach((c, i) => {
      const ph = c.userData.ph + perfNow * 6;
      c.position.set(
        Math.sin(ph + i * 2.1) * 0.14,
        Math.cos(ph * 1.3 + i) * 0.12,
        Math.sin(ph * 0.7 + i * 4) * 0.14,
      );
    });
  }
}

const orbShellMat = dummy.shellMat.clone();
orbShellMat.uniforms = THREE.UniformsUtils.clone(dummy.shellMat.uniforms);
orbShellMat.uniforms.uNoise.value = TEX.noise;
const orbShell = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), orbShellMat);
orbShell.visible = false;
scene.add(orbShell);
function sprite(tex) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  s.visible = false;
  scene.add(s);
  return s;
}
const orbCore = sprite(TEX.glow),
  orbHalo = sprite(TEX.glow);
const releaseFlash = sprite(TEX.glow),
  impactFlash = sprite(TEX.glow);
const headCore = sprite(TEX.glow),
  headHalo = sprite(TEX.glow);

// smoke
const smokes = [];
function spawnSmoke(pos, n, colorHex) {
  for (let i = 0; i < n; i++) {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: TEX.smoke,
        color: colorHex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    sp.position.set(pos.x + rr(-0.6, 0.6), pos.y + rr(-0.4, 0.6), pos.z + rr(-0.6, 0.6));
    sp.scale.setScalar(rr(1.0, 1.8));
    sp.material.rotation = rnd() * Math.PI * 2;
    scene.add(sp);
    smokes.push({
      sp,
      age: 0,
      dur: rr(1.7, 2.4),
      rise: rr(0.5, 0.9),
      spin: rr(-0.5, 0.5),
      grow: rr(0.9, 1.6),
    });
  }
}
function updateSmokes(dt) {
  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i];
    s.age += dt;
    const t = clamp01(s.age / s.dur);
    s.sp.position.y += s.rise * dt;
    s.sp.scale.addScalar(s.grow * dt);
    s.sp.material.rotation += s.spin * dt;
    s.sp.material.opacity = 0.34 * easeInOutSine(t < 0.25 ? t / 0.25 : 1) * (1 - t) ** 1.3;
    if (t >= 1) {
      scene.remove(s.sp);
      s.sp.material.dispose();
      smokes.splice(i, 1);
    }
  }
}

// drip emitters (DoT linger: fire embers rise, shadow drips fall)
const drips = [];
function spawnDrips(pos, pal, dur, style, rate = 14) {
  drips.push({ pos: pos.clone(), pal, until: dur, style, rate });
}
function updateDrips(dt) {
  for (let i = drips.length - 1; i >= 0; i--) {
    const d = drips[i];
    d.until -= dt;
    if (d.until <= 0) {
      drips.splice(i, 1);
      continue;
    }
    if (rnd() < dt * d.rate) {
      const x = d.pos.x + rr(-0.4, 0.4),
        y = d.pos.y + rr(-0.8, 0.8),
        z = d.pos.z + rr(-0.4, 0.4);
      const c = d.pal.ion,
        h = HDR(1.6);
      if (d.style === 'rise')
        riserPool.spawn(
          x,
          y,
          z,
          rr(-0.15, 0.15),
          rr(0.4, 1),
          rr(-0.15, 0.15),
          rr(0.6, 1.2),
          c.r * h,
          c.g * h,
          c.b * h,
        );
      else
        emberPool.spawn(
          x,
          y + 0.5,
          z,
          rr(-0.2, 0.2),
          rr(-0.4, -0.1),
          rr(-0.2, 0.2),
          rr(0.6, 1.1),
          c.r * h,
          c.g * h,
          c.b * h,
        );
    }
  }
}

// ---------------------------------------------------------------- spirit apparitions
// Ghostly creature spirits conjured from the game's own creature GLBs, a
// druid's Maul summons a spectral bear through the strike, Polymorph flashes
// the sheep itself, Ghost Wolf runs a lap around the shaman.
const SPIRIT_URLS = {
  wolf: '/models/creatures/wolf_basic.glb',
  bear: '/models/creatures/yetialt.glb',
  raptor: '/models/creatures/velociraptor.glb',
  stag: '/models/creatures/stag.glb',
  fox: '/models/creatures/fox.glb',
  bull: '/models/creatures/bull.glb',
  sheep: '/models/creatures/alpaca.glb',
  hawk: '/models/creatures/dragonevolved.glb',
  demon: '/models/creatures/demon.glb',
  voidwalker: '/models/creatures/demonalt.glb',
  ghost: '/models/creatures/ghost.glb',
  spider: '/models/creatures/spider.glb',
  boar: '/models/creatures/wild_boar.glb',
};
const spirits = [];
let loopToken = 0;
// canonical species heights (world units), normalization must keep the food
// chain readable: a bull dwarfs the fox, the bear dwarfs everyone
const SPIRIT_HEIGHT = {
  fox: 0.8,
  sheep: 1.1,
  wolf: 1.15,
  boar: 1.0,
  raptor: 1.7,
  stag: 2.0,
  bull: 2.2,
  bear: 2.5,
  hawk: 1.4,
  demon: 1.0,
  voidwalker: 2.4,
  ghost: 1.6,
  spider: 0.9,
};
async function spawnSpirit({
  model,
  at,
  path = 'rise',
  scale = 1,
  dur = 1.5,
  dirX = 1,
  tint,
  dim,
  atKind = 'caster',
  follow = false,
}) {
  const url = SPIRIT_URLS[model];
  if (!url) return;
  const token = loopToken;
  let g;
  try {
    g = await loadGlb(url);
  } catch (e) {
    console.warn('[spirit] load failed', model, url, e?.message ?? e);
    return;
  }
  if (token !== loopToken) return; // loop reset while loading
  const pal = ctx ? ctx.pal : PALETTES.storm;
  const root = skeletonClone(g.scene);
  // choreography that overlaps a body runs dimmer so additive stacking never
  // clips the silhouette to white; spec.dim tunes further
  const overlaps =
    (path === 'rise' && atKind === 'caster') ||
    path === 'swoop' ||
    (path === 'pounce' && atKind === 'target');
  const ghostMul = (overlaps ? 1.3 : scale >= 1.05 ? 1.45 : 1.9) * (dim ?? 1);
  if (path === 'rise' && atKind === 'caster') at = at.clone().add(new THREE.Vector3(0.8, 0, 1.25)); // loom BESIDE, not inside
  const baseCol = tint ? new THREE.Color(tint) : pal.ion.clone();
  const mat = new THREE.MeshBasicMaterial({
    color: baseCol.multiplyScalar(HDR(ghostMul)),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false, // depth-tested: a body, not a sticker
  });
  // noise dissolve with a hot edge, apparitions materialize, not fade
  const uDissolve = { value: 1 };
  mat.defines = { USE_UV: '' };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = uDissolve;
    shader.uniforms.uNoiseTex = { value: TEX.noise };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uDissolve; uniform sampler2D uNoiseTex;',
      )
      .replace(
        '#include <opaque_fragment>',
        `
        float gn = texture2D(uNoiseTex, vUv * 2.0).r;
        float gvis = smoothstep(uDissolve, uDissolve + 0.18, gn);
        float gedge = smoothstep(uDissolve - 0.03, uDissolve + 0.05, gn) - smoothstep(uDissolve + 0.1, uDissolve + 0.2, gn);
        diffuseColor.rgb += diffuseColor.rgb * gedge * 2.5;
        diffuseColor.a *= gvis;
        #include <opaque_fragment>`,
      );
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(() => mat) : mat;
    o.frustumCulled = false;
    o.renderOrder = 9; // ghosts draw over everything, they're apparitions
  });
  // measure the SKINNED body like prepareVisual, raw geometry bounds lie for
  // rigged creatures (armature node scales carry the real size)
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3();
  const mv = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      mv.fromBufferAttribute(pos, i);
      o.applyBoneTransform(i, mv);
      mv.applyMatrix4(o.matrixWorld);
      bb.expandByPoint(mv);
    }
  });
  if (bb.isEmpty()) bb.setFromObject(root); // static-mesh creatures
  const h = Math.max(0.001, bb.max.y - bb.min.y);
  const targetH = (SPIRIT_HEIGHT[model] ?? 1.9) * scale;
  const s = targetH / h;
  root.scale.setScalar(s);
  root.position.y = -bb.min.y * s;
  root.rotation.y = Math.PI / 2; // creatures face +Z; holder yaw owns facing from here
  const holder = new THREE.Group();
  holder.add(root);
  holder.position.copy(at);
  scene.add(holder);
  // clips match INTENT: locomotion while moving, idle while standing, and the
  // attack fired only at the moment that earns it (pass-through, landing)
  const mixer = new THREE.AnimationMixer(root);
  const names = g.animations.map((c) => c.name);
  const findClip = (list) => list.find((n) => names.includes(n));
  const MOVE = findClip([
    'Gallop',
    'Run',
    'Fast_Flying',
    'Walk',
    'Move1 (jump)',
    'Spider_Walk',
    'Walking_A',
  ]);
  const IDLE = findClip(['Idle', 'Flying_Idle', 'Idle1', 'Idle_Combat', 'Spider_Idle']);
  const ATK = findClip([
    'Attack',
    'Attack1 (marracca)',
    'Attack_Headbutt',
    'Punch',
    'Spider_Attack',
  ]);
  const TEMPO =
    {
      bear: 0.85,
      bull: 1.0,
      wolf: 1.15,
      fox: 1.25,
      raptor: 1.3,
      sheep: 0.9,
      hawk: 1.1,
      stag: 0.95,
      demon: 0.9,
      voidwalker: 0.7,
      ghost: 0.6,
      spider: 1.1,
      boar: 1.1,
    }[model] ?? 1;
  const mkAction = (name, loop = true) => {
    if (!name) return null;
    const a = mixer.clipAction(g.animations.find((c) => c.name === name));
    a.timeScale = TEMPO * (loop ? 1 : 1.15);
    if (!loop) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    return a;
  };
  const moving = path !== 'rise';
  const moveA = mkAction(moving ? (MOVE ?? IDLE) : (IDLE ?? MOVE));
  if (moveA) moveA.play();
  const atkA = mkAction(ATK, false);
  if (atkA && moveA) {
    mixer.addEventListener('finished', (e) => {
      // bite done → back to stride
      if (e.action === atkA) {
        moveA.reset().play();
        atkA.crossFadeTo(moveA, 0.12, false);
      }
    });
  }
  spirits.push({
    holder,
    mixer,
    mat,
    age: 0,
    dur,
    path,
    from: at.clone(),
    dirX,
    token,
    model,
    follow,
    uDissolve,
    pal,
    trail: [],
    prevPos: at.clone(),
    lastFoot: at.clone(),
    footSide: 1,
    chestY: targetH * 0.45,
    heightN: targetH,
    tempo: TEMPO,
    moveA,
    atkA,
    atkFired: false,
    yaw: 0,
  });
  lightPulses.pulse(at.clone().add(new THREE.Vector3(0, 1.2, 0)), pal.ion, 90, 0.5);
  sfx.spirit(model, panOf(at.x)); // every apparition speaks
  // grand entrance: apparitions announce themselves
  if (path === 'rise') {
    spawnSmoke(at.clone().add(new THREE.Vector3(0, 0.6, 0)), model === 'sheep' ? 6 : 4, 0xd8dde6);
    spawnRing(new THREE.Vector3(at.x, 0.05, at.z), 1.7 * scale, 0.5, pal.ion, HDR(1.2));
  } else if (path === 'lunge' || path === 'pounce') {
    spawnRing(new THREE.Vector3(at.x, 0.05, at.z), 1.3 * scale, 0.4, pal.ion, HDR(1.0));
    burst(emberPool, at.x, 0.15, at.z, 8, 2, 0.5, pal.ion, HDR(1.2), 0.7); // kicked-up dust
  }
  if (scale >= 1.05) trauma = Math.max(trauma, 0.22); // big spirits shake the earth
}
function updateSpirits(dt) {
  for (let i = spirits.length - 1; i >= 0; i--) {
    const sp = spirits[i];
    sp.age += dt;
    const t = clamp01(sp.age / sp.dur);
    if (t >= 1 || sp.token !== loopToken) {
      scene.remove(sp.holder);
      sp.mat.dispose();
      spirits.splice(i, 1);
      continue;
    }
    sp.mixer.update(dt);
    const o = Math.min(sp.age / 0.25, 1, (sp.dur - sp.age) / 0.35);
    sp.mat.opacity = 0.75 * clamp01(o);
    // dissolve: materialize in over 0.3s, unravel over the last 0.35s
    if (sp.age < 0.3) sp.uDissolve.value = 1 - (sp.age / 0.3) * 0.9;
    else if (sp.dur - sp.age < 0.35)
      sp.uDissolve.value = 0.1 + (1 - (sp.dur - sp.age) / 0.35) * 0.9;
    else sp.uDissolve.value = 0.1;
    const f = sp.from,
      d = sp.dirX;
    const fireAtk = () => {
      if (sp.atkFired || !sp.atkA) return;
      sp.atkFired = true;
      sp.atkA.reset().play();
      if (sp.moveA) sp.moveA.crossFadeTo(sp.atkA, 0.08, false);
    };
    if (sp.follow && rig) {
      // dash afterimage: the spirit runs WITH the caster
      sp.holder.position.set(
        rig.group.position.x - 1.5 * d,
        f.y + Math.abs(Math.sin(sp.age * 9)) * 0.22,
        f.z + 0.6,
      );
      if (rig.group.position.x >= MELEE_X - 0.6) fireAtk();
    } else if (sp.path === 'lunge') {
      // gather speed, strike as it passes through
      const u = easeInOutSine(t);
      sp.holder.position.set(f.x + (u * 6.4 - 2.8) * d, f.y, f.z);
      if (t > 0.38) fireAtk();
    } else if (sp.path === 'pounce') {
      // stalk → leap → land in the strike
      let x,
        y = f.y;
      if (t < 0.4) {
        x = f.x + (-2.2 + easeInOutSine(t / 0.4) * 1.2) * d;
      } else if (t < 0.85) {
        const u = (t - 0.4) / 0.45;
        x = f.x + (-1.0 + u * 3.2) * d;
        y = f.y + Math.sin(u * Math.PI) * 1.7;
        if (u > 0.55) fireAtk();
      } else {
        x = f.x + 2.2 * d;
      }
      sp.holder.position.set(x, y, f.z);
    } else if (sp.path === 'circle') {
      // considered three-quarter lap, eased in and out
      const u = easeInOutSine(t);
      const a = -Math.PI / 2 + u * Math.PI * 1.5;
      sp.holder.position.set(f.x + Math.cos(a) * 1.95, f.y, f.z + Math.sin(a) * 1.95);
    } else if (sp.path === 'swoop') {
      // committed dive, body pitched to the slope
      // low point clamped: talons rake just above head height, never through the body
      sp.holder.position.set(
        f.x + (t * 12 - 6) * d,
        Math.max(f.y + 5.5 - Math.sin(t * Math.PI) * 5, 1.55),
        f.z,
      );
      if (t > 0.42 && t < 0.6) fireAtk(); // talons at the bottom of the dive
      // the dragon rig only reads as a bird of prey with wings locked open -
      // freeze the flap through the dive, resume on the strike
      if (sp.model === 'hawk' && sp.moveA)
        sp.moveA.timeScale = t > 0.22 && t < 0.62 && !sp.atkFired ? sp.tempo * 0.1 : sp.tempo;
    } else {
      // rise: calm, ceremonial presence, with a slow surveying turn
      let y = f.y + Math.sin(perfNow * 1.8) * 0.05;
      if (sp.model === 'sheep' && t > 0.4 && t < 0.55)
        y += Math.sin(((t - 0.4) / 0.15) * Math.PI) * 0.4; // startled half-hop
      sp.holder.position.set(f.x, y, f.z);
      sp.holder.rotation.y = Math.sin(t * Math.PI * 0.9) * 0.55;
    }
    // every moving spirit FACES its motion, turning smoothly
    if (sp.path !== 'rise') {
      tmpA.subVectors(sp.holder.position, sp.prevPos);
      if (tmpA.lengthSq() > 1e-7) {
        const targetYaw = Math.atan2(-tmpA.z, tmpA.x);
        let dy = targetYaw - sp.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        sp.yaw += dy * Math.min(1, dt * 9);
        sp.holder.rotation.y = sp.yaw;
        if (sp.path === 'swoop') {
          const horiz = Math.sqrt(tmpA.x * tmpA.x + tmpA.z * tmpA.z);
          sp.holder.rotation.z = Math.max(
            -0.55,
            Math.min(0.55, Math.atan2(tmpA.y, horiz + 1e-4) * 0.8),
          );
        }
      }
    }
    // spectral shed
    if (rnd() < dt * 14) {
      const p = sp.holder.position;
      emberPool.spawn(
        p.x + rr(-0.5, 0.5),
        p.y + rr(0.3, 1.4),
        p.z + rr(-0.5, 0.5),
        rr(-0.2, 0.2),
        rr(0.1, 0.5),
        rr(-0.2, 0.2),
        rr(0.4, 0.8),
        sp.mat.color.r * 0.7,
        sp.mat.color.g * 0.7,
        sp.mat.color.b * 0.7,
      );
    }
    const moving = sp.path !== 'rise';
    if (moving) {
      // spectral after-trail through the chest line
      sp.trail.unshift(sp.holder.position.clone().add(tmpC.set(0, sp.chestY, 0)));
      if (sp.trail.length > 9) sp.trail.pop();
      if (sp.trail.length > 3)
        ribbons.add(sp.trail, 0.55, sp.pal.ion, HDR(0.9) * clamp01(o), 0.85, 0.6);
      // spectral footprints on grounded paths
      if (
        (sp.path === 'lunge' || sp.path === 'circle') &&
        sp.holder.position.distanceTo(sp.lastFoot) > 0.5
      ) {
        tmpA.subVectors(sp.holder.position, sp.prevPos);
        if (tmpA.lengthSq() > 1e-6) {
          tmpA.normalize();
          spawnFootprint(sp.holder.position, tmpA, sp.footSide, sp.pal, 0.16 * sp.heightN); // small spirits leave small prints
          sp.footSide *= -1;
          sp.lastFoot.copy(sp.holder.position);
        }
      }
    }
    sp.prevPos.copy(sp.holder.position);
  }
}

// spectral footprints left by grounded spirits
const footprints = [];
function spawnFootprint(pos, dir, side, pal, size = 0.3) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: TEX.paw,
      color: pal.ion.clone().multiplyScalar(HDR(1.7)),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = -Math.atan2(dir.z, dir.x) + Math.PI / 2;
  m.position.set(pos.x - dir.z * side * 0.17, 0.022, pos.z + dir.x * side * 0.17);
  m.renderOrder = 3;
  scene.add(m);
  footprints.push({ m, age: 0 });
}
function updateFootprints(dt) {
  for (let i = footprints.length - 1; i >= 0; i--) {
    const f = footprints[i];
    f.age += dt;
    const t = clamp01(f.age / 1.5);
    f.m.material.opacity = 0.85 * (1 - t) ** 1.4;
    if (t >= 1) {
      scene.remove(f.m);
      f.m.material.dispose();
      f.m.geometry.dispose();
      footprints.splice(i, 1);
    }
  }
}
function clearFootprints() {
  for (const f of footprints) {
    scene.remove(f.m);
    f.m.material.dispose();
    f.m.geometry.dispose();
  }
  footprints.length = 0;
}

// persistent buff visuals, every lasting effect gets its own body language.
// MULTI-BUFF: a registry keyed by ability id; each STYLE owns a distinct body
// band (feet runes / waist plates / shoulder sparks / back wings / weapon glow /
// leg speedlines / chest heartbeat / rising leaves) so any combination STACKS
// without visual collision. Recasting an ability replaces only its own entry.
const buffOrbits = new Map();
const ORBIT_TEX = { star: 'star', glow: 'glow', paw: 'paw', rays: 'rays', chip: 'chip' };
function startBuffOrbit(style, pal, dur, key = ctx?.id ?? 'anon', o = {}) {
  clearBuffOrbit(key);
  if (style === 'none') return;
  const sprites = [];
  const meshes = [];
  // per-buff DNA: o.n count, o.size, o.tex, o.rate speed, o.weave bob, o.incline
  // tilt, same band, unmistakably different buffs
  const spriteCount =
    o.n ?? (style === 'sparks' ? 3 : style === 'runes' ? 4 : style === 'halo' ? 3 : 0);
  const tex =
    TEX[ORBIT_TEX[o.tex] ?? (style === 'runes' ? 'star' : style === 'halo' ? 'star' : 'glow')];
  if (style === 'sparks' || style === 'runes' || style === 'halo') {
    for (let i = 0; i < spriteCount; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          color: pal.core.clone().multiplyScalar(HDR(style === 'sparks' ? 2.6 : 2.2)),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      s.scale.setScalar(o.size ?? (style === 'sparks' ? 0.5 : style === 'halo' ? 0.28 : 0.42));
      scene.add(s);
      sprites.push(s);
    }
  }
  if (style === 'plates') {
    // orbiting shield facets (barriers, armors, barkskin)
    for (let i = 0; i < (o.n ?? 4); i++) {
      // soft-edged gradient panels, hard untextured quads read as debug geometry
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62 * (o.size ?? 1), 0.82 * (o.size ?? 1)),
        new THREE.MeshBasicMaterial({
          map: TEX.glow,
          color: pal.main.clone().multiplyScalar(HDR(1.9)),
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      scene.add(m);
      meshes.push(m);
    }
  }
  buffOrbits.set(key, {
    style,
    pal,
    until: dur,
    dur,
    sprites,
    meshes,
    phase: rnd() * 6.28,
    beat: 0,
    hist: [],
    o,
    tick: rr(0.5, 1.5),
  });
}
function disposeOrbit(bo) {
  for (const s of bo.sprites) {
    scene.remove(s);
    s.material.dispose();
  }
  for (const m of bo.meshes) {
    scene.remove(m);
    m.material.dispose();
    m.geometry.dispose();
  }
}
function clearBuffOrbit(key) {
  if (key !== undefined) {
    const bo = buffOrbits.get(key);
    if (bo) {
      disposeOrbit(bo);
      buffOrbits.delete(key);
    }
    return;
  }
  for (const bo of buffOrbits.values()) disposeOrbit(bo);
  buffOrbits.clear();
}
function updateBuffOrbit(dt) {
  if (!rig) return;
  for (const [key, bo] of buffOrbits) updateOneOrbit(key, bo, dt);
}
function updateOneOrbit(key, bo, dt) {
  bo.until -= dt;
  if (bo.until <= 0) {
    disposeOrbit(bo);
    buffOrbits.delete(key);
    return;
  }
  const fade = Math.min(1, bo.until / 0.4);
  const c = rig.group.position;
  const t = perfNow;
  const pal = bo.pal;
  const o = bo.o ?? {};
  const rate = o.rate ?? 1;
  // quiet living foley: a held buff is HEARD breathing, not just seen
  bo.tick -= dt;
  if (bo.tick <= 0 && sndOn) {
    bo.tick =
      (o.tickEvery ??
        { leaves: 2.5, halo: 3, runes: 2.2, plates: 1.9, weaponGlow: 2.2, wings: 2.6 }[bo.style] ??
        999) * rr(0.85, 1.2);
    const pan = panOf(c.x);
    if (bo.style === 'leaves')
      sfx.tone2({ freq: rr(620, 720), dur: 0.4, gain: 0.045, pan, verb: 0.5 });
    else if (bo.style === 'halo')
      sfx.partials({ freqs: [1046, 1568], dur: 0.6, gain: 0.035, stagger: 0.03, pan, verb: 0.55 });
    else if (bo.style === 'runes')
      sfx.tone2({
        freq: 220,
        dur: 0.5,
        gain: 0.04,
        type: 'sine',
        vibRate: 4,
        vibDepth: 0.02,
        pan,
        verb: 0.4,
      });
    else if (bo.style === 'plates')
      sfx.partials({ freqs: [820, 1240], dur: 0.18, gain: 0.03, stagger: 0.004, pan, verb: 0.3 });
    else if (bo.style === 'weaponGlow')
      sfx.noise2({ dur: 0.25, freq: 3400, gain: 0.03, type: 'bandpass', q: 6, pan, verb: 0.3 });
    else if (bo.style === 'wings')
      sfx.noise2({
        dur: 0.5,
        freq: 900,
        sweep: 500,
        gain: 0.035,
        type: 'bandpass',
        q: 1.2,
        attack: 0.15,
        pan,
        verb: 0.4,
      });
  }
  if (bo.style === 'sparks' || bo.style === 'runes' || bo.style === 'halo') {
    // band discipline: halo crowns the HEAD, sparks orbit the SHOULDERS, runes
    // circle the ANKLES, all three stack with waist plates without collision
    bo.sprites.forEach((s, k) => {
      const a =
        bo.phase +
        t * (bo.style === 'sparks' ? 2.6 : bo.style === 'halo' ? 0.8 : 1.1) * rate +
        (k / bo.sprites.length) * Math.PI * 2;
      const r = o.radius ?? (bo.style === 'sparks' ? 0.72 : bo.style === 'halo' ? 0.4 : 1.05);
      const weave = o.weave ?? (bo.style === 'sparks' ? 0.16 : 0.08);
      const baseY = bo.style === 'sparks' ? 1.72 : bo.style === 'halo' ? 2.6 : 0.32;
      const y = baseY + Math.sin(t * 2 * rate + k * 2) * weave + Math.sin(a) * (o.incline ?? 0);
      s.position.set(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
      s.material.opacity = fade;
    });
    if (bo.style === 'sparks' && rnd() < dt * 8) {
      const i = Math.floor(rnd() * bo.sprites.length);
      const j = (i + 1) % bo.sprites.length;
      const a = bo.sprites[i].position.clone(),
        b = bo.sprites[j].position.clone();
      spawnBoltFx({
        life: 0.08,
        flicker: 0.04,
        width: 0.025,
        hdr: 2.6,
        colCore: pal.core,
        colGlow: pal.main,
        gen: () => genBolt(a, b, { jag: 0.3, subdiv: 3, branchP: 0.1, depth: 0 }),
      });
    }
  } else if (bo.style === 'leaves') {
    if (rnd() < dt * (o.density ?? 12)) {
      const a = rnd() * Math.PI * 2,
        r = rr(0.4, o.spread ?? 0.9);
      riserPool.spawn(
        c.x + Math.cos(a) * r,
        rr(0.1, 1.6),
        c.z + Math.sin(a) * r,
        Math.cos(a + 1.8) * 0.5,
        rr(0.4, 0.9) * (o.up ?? 1),
        Math.sin(a + 1.8) * 0.5,
        rr(0.9, 1.5),
        pal.ion.r * HDR(1.6) * fade,
        pal.ion.g * HDR(1.6) * fade,
        pal.ion.b * HDR(1.6) * fade,
      );
    }
  } else if (bo.style === 'wings') {
    // spectral pinions with a translucent membrane
    const ribs = o.ribs ?? 6;
    const span = o.span ?? 1;
    const flap = Math.sin(t * (o.flapRate ?? 1.3)) * 0.3;
    for (const side of [-1, 1]) {
      let innerTip = null,
        outerTip = null;
      for (let f = 0; f < ribs; f++) {
        const u = f / (ribs - 1);
        const rootP = new THREE.Vector3(c.x - 0.28, 1.72, c.z + side * 0.18);
        const tip = new THREE.Vector3(
          c.x - (0.95 + u * 0.75) * span,
          1.9 + (0.85 - u * 1.1) * span + flap * (0.4 + u * 0.65),
          c.z + side * (0.6 + u * 0.95) * span,
        );
        ribbons.add(
          smoothArc(rootP, tip, 0.16 * side, 8, 0.14),
          0.18 * (1 - u * 0.45),
          pal.ion,
          HDR(2.4) * fade * (1 - u * 0.3),
          0.7,
        );
        if (f === 0) innerTip = tip;
        if (f === ribs - 1) outerTip = tip;
      }
      // membrane: soft wide spans so the fan reads as a surface, not quills
      ribbons.add(
        smoothArc(innerTip, outerTip, 0.2 * side, 8, 0),
        0.5,
        pal.glow,
        HDR(0.7) * fade,
        0.5,
      );
      ribbons.add(
        smoothArc(
          new THREE.Vector3(c.x - 0.3, 1.75, c.z + side * 0.2),
          outerTip,
          0.24 * side,
          8,
          0.1,
        ),
        0.38,
        pal.glow,
        HDR(0.5) * fade,
        0.5,
      );
    }
    if (rnd() < dt * 6) {
      riserPool.spawn(
        c.x - rr(0.6, 1.2),
        rr(1.2, 2.4),
        c.z + rr(-1, 1),
        0,
        -0.35,
        0,
        rr(0.8, 1.4),
        pal.ion.r * fade,
        pal.ion.g * fade,
        pal.ion.b * fade,
      ); // drifting feather-motes
    }
  } else if (bo.style === 'weaponGlow') {
    // enchanted weapon shimmer + trail
    rig.handR.getWorldPosition(tmpA);
    tmpA.y += 0.12;
    bo.hist.unshift(tmpA.clone());
    if (bo.hist.length > 9) bo.hist.pop();
    if (bo.hist.length > 3) ribbons.add(bo.hist, 0.16, pal.main, HDR(1.6) * fade, 0.85);
    if (rnd() < dt * 10) {
      sparkPool.spawn(
        tmpA.x + rr(-0.1, 0.1),
        tmpA.y + rr(-0.15, 0.25),
        tmpA.z + rr(-0.1, 0.1),
        rr(-0.3, 0.3),
        rr(0.2, 0.7),
        rr(-0.3, 0.3),
        rr(0.25, 0.5),
        pal.core.r * HDR(2) * fade,
        pal.core.g * HDR(2) * fade,
        pal.core.b * HDR(2) * fade,
      );
    }
  } else if (bo.style === 'plates') {
    bo.meshes.forEach((m, k) => {
      const a = bo.phase + t * 0.9 + (k / bo.meshes.length) * Math.PI * 2;
      // waist band, below shoulder sparks, above ankle runes
      m.position.set(
        c.x + Math.cos(a) * 0.9,
        1.05 + Math.sin(t * 1.6 + k * 1.7) * 0.1,
        c.z + Math.sin(a) * 0.9,
      );
      m.lookAt(c.x, m.position.y, c.z);
      m.rotateZ(Math.sin(t * 1.1 + k * 2.4) * 0.35); // a living roll, never a static billboard
      m.material.opacity = 0.7 * fade;
    });
  } else if (bo.style === 'heartbeat') {
    // pounding pulse rings off the chest
    bo.beat -= dt;
    if (bo.beat <= 0) {
      bo.beat = o.bpm ? 60 / o.bpm : 0.72; // frenzy buffs race, fortitude thumps slow
      spawnRing(
        new THREE.Vector3(c.x, 1.5, c.z),
        o.ringR ?? 1.5,
        0.5,
        pal.main,
        HDR(1.5) * fade,
        true,
      );
      casterGlowV = Math.max(casterGlowV, 1.3 * fade);
      if (sndOn) sfx.heartbeat(panOf(c.x));
    }
  } else if (bo.style === 'speedlines') {
    // wind-blur streaks, LEG band, under everything else
    for (let k = 0; k < 3; k++) {
      if (rnd() > 0.6) continue;
      const y = rr(0.3, 1.25);
      const z0 = c.z + rr(-0.6, 0.6);
      const a = new THREE.Vector3(c.x + rr(0.4, 1.4), y, z0);
      const b = new THREE.Vector3(c.x - rr(0.9, 1.9), y + rr(-0.1, 0.1), z0);
      ribbons.add(smoothArc(a, b, 0.03, 6, 0), 0.05, pal.ion, HDR(1.6) * fade * rr(0.4, 1), 0.9);
    }
  }
}

// persistent target burn (DoTs hold their look for the duration), the read is
// body emissive + drips + palette flares; the capsule shell is retired (it read
// as a debug collider)
let burnFx = null;
function startBurn(pal, dur, drip, palName = ctx?.palName) {
  burnFx = { pal, until: dur, dur, drip, palName, arcT: 0, grumbled: false };
  spawnDrips(dummy.hitPos, pal, dur, drip, 16);
  for (const m of dummy.mats) m.emissive.setHex(pal.main.getHex());
}
function updateBurn(dt) {
  if (!burnFx) return;
  burnFx.until -= dt;
  if (burnFx.until <= 0) {
    burnFx = null;
    return;
  }
  const fade = Math.min(1, burnFx.until / 0.8);
  targetGlow = Math.max(targetGlow, (1.0 + Math.sin(perfNow * 8) * 0.3) * fade);
  if (rnd() < dt * 5) {
    // occasional flare
    const p2 = randomOnDummy();
    emberPool.spawn(
      p2.x,
      p2.y,
      p2.z,
      rr(-0.2, 0.2),
      burnFx.drip === 'rise' ? rr(0.5, 1.2) : rr(-0.6, -0.2),
      rr(-0.2, 0.2),
      rr(0.4, 0.8),
      burnFx.pal.main.r * HDR(1.8),
      burnFx.pal.main.g * HDR(1.8),
      burnFx.pal.main.b * HDR(1.8),
    );
  }
  if (burnFx.palName === 'storm') {
    // residual storm: arcs keep crawling the victim
    burnFx.arcT -= dt;
    if (burnFx.arcT <= 0) {
      burnFx.arcT = rr(0.35, 0.6);
      const a1 = randomOnDummy(),
        a2 = randomOnDummy();
      spawnBoltFx({
        life: rr(0.12, 0.2),
        flicker: 0.04,
        width: 0.04,
        hdr: 2.4,
        colCore: burnFx.pal.core,
        colGlow: burnFx.pal.main,
        gen: () => genBolt(a1, a2, { jag: 0.3, subdiv: 3, branchP: 0.2, depth: 0 }),
      });
      burst(
        sparkPool,
        dummy.hitPos.x,
        dummy.hitPos.y,
        dummy.hitPos.z,
        3,
        3,
        0.3,
        burnFx.pal.ion,
        HDR(2),
        0.3,
      );
      if (!burnFx.grumbled && burnFx.until < burnFx.dur * 0.5) {
        // the storm grumbles once, high above
        burnFx.grumbled = true;
        lightPulses.pulse(
          new THREE.Vector3(dummy.hitPos.x, 8, dummy.hitPos.z),
          burnFx.pal.ion,
          90,
          0.5,
        );
      }
    }
  }
}

// orbiting stun stars / cc swirl
const orbiters = [];
function spawnOrbitStars(center, pal, dur, n = 5) {
  const sprites = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: TEX.star,
        color: pal.core.clone().multiplyScalar(HDR(1.8)),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    s.scale.setScalar(0.28);
    scene.add(s);
    sprites.push(s);
  }
  orbiters.push({ sprites, center: center.clone(), age: 0, dur, phase: rnd() * 6.28 });
}
function updateOrbiters(dt) {
  for (let i = orbiters.length - 1; i >= 0; i--) {
    const o = orbiters[i];
    o.age += dt;
    const t = clamp01(o.age / o.dur);
    const fade = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
    o.sprites.forEach((s, k) => {
      const a = o.phase + o.age * 5.2 + (k / o.sprites.length) * Math.PI * 2;
      s.position.set(
        o.center.x + Math.cos(a) * 0.55,
        o.center.y + Math.sin(o.age * 3 + k) * 0.06,
        o.center.z + Math.sin(a) * 0.55,
      );
      s.material.opacity = fade;
    });
    if (t >= 1) {
      for (const s of o.sprites) {
        scene.remove(s);
        s.material.dispose();
      }
      orbiters.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- audio
// A designed procedural sound engine (no files, same invariant as the game):
// master bus with generated convolver reverb + compressor, stereo positioning
// across the arena, 12 palette impact identities, windup beds per charge
// style, motif foley, spirit creature calls, and slow-mo pitch tracking.
function panOf(x) {
  return Math.max(-0.7, Math.min(0.7, x / 11));
}

// release-sample family per palette (12 palettes share 8 recorded releases)
const RELEASE_FAM = {
  fire: 'fire',
  blood: 'fire',
  frost: 'frost',
  moon: 'frost',
  arcane: 'arcane',
  shadow: 'shadow',
  venom: 'shadow',
  holy: 'holy',
  gold: 'holy',
  nature: 'nature',
  storm: 'storm',
  physical: 'physical',
};
const MOTIF_SAMPLE = {
  fissure: 'motif_fissure',
  gavel: 'motif_gavel',
  chains: 'motif_chains',
  vines: 'motif_vines',
  pillars: 'motif_pillars',
  crescents: 'motif_slashes',
  bladestorm: 'motif_slashes',
  implosion: 'motif_implosion',
  swarm: 'motif_swarm',
};

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.verbIn = null;
    this.noiseBuf = null;
    this.bed = null;
    this.travelH = null;
    this.beamH = null;
    this.loops = new Set();
    this.intensity = 1;
    this.volume = 1;
    // generated-sample layer: recorded one-shots (sfx_pack.json / __SFX_PACK__)
    // layered over the synth engine; loops stay procedural (they must crescendo
    // with cast progress and pitch-bend in slow-mo)
    this.samples = new Map();
    this.packLoaded = false;
    this.sampleMode = false;
  }
  async loadPack() {
    if (this.packLoaded || !this.ctx) return;
    let raw = window.__SFX_PACK__;
    if (!raw) {
      try {
        const r = await fetch('/sfx_pack.json');
        if (r.ok) raw = await r.json();
      } catch {
        /* synth-only */
      }
    }
    if (!raw) return;
    const b64buf = (b64) => {
      const s = atob(b64);
      const u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      return u.buffer;
    };
    for (const [id, takes] of Object.entries(raw)) {
      const bufs = [],
        gains = [];
      for (const b64 of takes) {
        try {
          const buf = await this.ctx.decodeAudioData(b64buf(b64));
          let peak = 0; // normalize per take so the mix stays consistent
          for (let ch = 0; ch < buf.numberOfChannels; ch++) {
            const d2 = buf.getChannelData(ch);
            for (let i = 0; i < d2.length; i += 7) peak = Math.max(peak, Math.abs(d2[i]));
          }
          bufs.push(buf);
          gains.push(peak > 0.01 ? Math.min(2.5, 0.8 / peak) : 1);
        } catch {
          /* corrupt take, drop it */
        }
      }
      if (bufs.length) this.samples.set(id, { bufs, gains, next: Math.floor(rnd() * bufs.length) });
    }
    this.packLoaded = this.samples.size > 0;
    this.sampleMode = this.packLoaded;
    if (this.packLoaded) {
      console.log(`[sfx] generated pack loaded: ${this.samples.size} sounds`);
      updateAbBtn();
    }
  }
  _beefCurve(amount) {
    // cached soft-saturation curves, crunch without fizz
    this._curves ??= new Map();
    const key = Math.round(amount * 20);
    let c = this._curves.get(key);
    if (!c) {
      const k = 1 + amount * 6;
      const norm = Math.tanh(k);
      c = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = i / 511.5 - 1;
        c[i] = Math.tanh(k * x) / norm;
      }
      this._curves.set(key, c);
    }
    return c;
  }
  sample(
    id,
    {
      pan = 0,
      gain = 1,
      verb = 0.2,
      rate = 0,
      delay = 0,
      beef = 0.12,
      subOct = false,
      soft = false,
    } = {},
  ) {
    if (!this.on || !this.sampleMode) return false;
    const e = this.samples.get(id);
    if (!e) return false;
    const k = e.next++ % e.bufs.length; // round-robin takes, no machine-gunning
    const t = this._now() + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = e.bufs[k];
    src.playbackRate.value = (rate || rr(0.95, 1.06)) * Math.max(0.55, timeScale ** 0.6);
    const g = this.ctx.createGain();
    g.gain.value = gain * e.gains[k] * this.intensity;
    const out = this._out(pan, verb);
    let dest = out;
    if (beef > 0.02) {
      // the beef bus: saturation drive + low-shelf body + presence bite
      const sh = this.ctx.createWaveShaper();
      sh.curve = this._beefCurve(beef);
      const shelf = this.ctx.createBiquadFilter();
      shelf.type = 'lowshelf';
      shelf.frequency.value = 170;
      shelf.gain.value = 3 + beef * 5;
      let tail = shelf;
      if (soft) {
        // screech control: shave the piercing top instead of boosting it
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 4200;
        lp.Q.value = 0.6;
        shelf.connect(lp);
        tail = lp;
      } else {
        const pres = this.ctx.createBiquadFilter();
        pres.type = 'peaking';
        pres.frequency.value = 2700;
        pres.Q.value = 0.9;
        pres.gain.value = 1.5 + beef * 3;
        shelf.connect(pres);
        tail = pres;
      }
      sh.connect(shelf);
      tail.connect(out);
      g.gain.value *= 1 / (1 + beef * 0.5); // drive compensation
      dest = sh;
    } else if (soft) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4200;
      lp.Q.value = 0.6;
      lp.connect(out);
      dest = lp;
    }
    src.connect(g);
    g.connect(dest);
    src.start(t);
    if (subOct) {
      // octave-down double of the same take, instant chest-cavity body
      const s2 = this.ctx.createBufferSource();
      s2.buffer = e.bufs[k];
      s2.playbackRate.value = src.playbackRate.value * 0.5;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      const g2 = this.ctx.createGain();
      g2.gain.value = g.gain.value * 0.55;
      s2.connect(lp);
      lp.connect(g2);
      g2.connect(dest);
      s2.start(t);
    }
    return true;
  }
  enable() {
    if (!this.ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      const ctx = this.ctx;
      // master → compressor → out
      this.master = ctx.createGain();
      this.master.gain.value = 0.4;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 4;
      comp.attack.value = 0.011;
      comp.release.value = 0.3; // slower attack, transients PUNCH through
      this.master.connect(comp);
      comp.connect(ctx.destination);
      // generated hall: 1.6s stereo exponential-decay noise, softened
      const irLen = Math.floor(ctx.sampleRate * 1.6);
      const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < irLen; i++) {
          const w = (Math.random() * 2 - 1) * Math.exp((-4 * i) / irLen);
          lp += 0.22 * (w - lp); // one-pole soften
          d[i] = lp;
        }
      }
      const verb = ctx.createConvolver();
      verb.buffer = ir;
      this.verbIn = ctx.createGain();
      this.verbIn.gain.value = 1;
      const verbHp = ctx.createBiquadFilter();
      verbHp.type = 'highpass';
      verbHp.frequency.value = 200;
      verbHp.Q.value = 0.7;
      const wet = ctx.createGain();
      wet.gain.value = 0.4;
      // wet return goes through MASTER so volume/duck govern the tails too,
      // and the highpass keeps the sub octave out of the hall
      this.verbIn.connect(verbHp);
      verbHp.connect(verb);
      verb.connect(wet);
      wet.connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const nd = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
    }
    this.ctx.resume();
    this.loadPack(); // async; synth-only until (and unless) the pack arrives
  }
  get on() {
    return !!this.ctx && sndOn;
  }
  _applyMaster(tc = 0.02) {
    if (this.master)
      this.master.gain.setTargetAtTime(0.4 * this.volume * (this._duckF ?? 1), this._now(), tc);
  }
  setVolume(v) {
    this.volume = v;
    this._applyMaster(0.05);
  }
  setIntensity(m) {
    this.intensity = m;
  }
  _now() {
    return this.ctx.currentTime;
  }
  _out(pan = 0, verb = 0.15) {
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(this.master);
    if (verb > 0.01) {
      const s = this.ctx.createGain();
      s.gain.value = verb;
      p.connect(s);
      s.connect(this.verbIn);
    }
    return g;
  }
  // ---- primitives ----------------------------------------------------------
  tone2({
    freq,
    dur = 0.3,
    gain = 0.2,
    type = 'sine',
    slide = 0,
    delay = 0,
    pan = 0,
    verb = 0.15,
    attack = 0.01,
    vibRate = 0,
    vibDepth = 0,
    fmRatio = 0,
    fmDepth = 0,
  }) {
    if (!this.on) return;
    const t = this._now() + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(18, slide), t + dur);
    if (vibRate) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = vibRate;
      const lg = this.ctx.createGain();
      lg.gain.value = vibDepth * freq;
      lfo.connect(lg);
      lg.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
    }
    if (fmRatio) {
      const mod = this.ctx.createOscillator();
      mod.frequency.value = freq * fmRatio;
      const mg = this.ctx.createGain();
      mg.gain.value = fmDepth;
      mod.connect(mg);
      mg.connect(o.frequency);
      mod.start(t);
      mod.stop(t + dur + 0.1);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain * this.intensity), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this._out(pan, verb));
    o.start(t);
    o.stop(t + dur + 0.1);
  }
  noise2({
    dur = 0.3,
    freq = 800,
    gain = 0.3,
    type = 'lowpass',
    q = 1,
    sweep = 0,
    delay = 0,
    pan = 0,
    verb = 0.1,
    attack = 0.002,
  }) {
    if (!this.on) return;
    const t = this._now() + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain * this.intensity), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this._out(pan, verb));
    src.start(t, Math.random());
    src.stop(t + dur + 0.1);
  }
  partials({
    freqs,
    dur = 0.8,
    gain = 0.2,
    type = 'sine',
    stagger = 0,
    delay = 0,
    pan = 0,
    verb = 0.35,
  }) {
    freqs.forEach((f, i) => {
      this.tone2({
        freq: f,
        dur: dur * (1 - i * 0.08),
        gain: gain / (1 + i * 0.7),
        type,
        delay: delay + i * stagger,
        pan,
        verb,
      });
    });
  }
  ticks({ n = 6, over = 0.4, fLo = 3000, fHi = 6500, gain = 0.08, pan = 0, tone = false }) {
    for (let i = 0; i < n; i++) {
      const d = Math.random() * over;
      if (tone)
        this.tone2({
          freq: fLo + Math.random() * (fHi - fLo),
          dur: 0.09,
          gain,
          delay: d,
          pan: pan + (Math.random() - 0.5) * 0.3,
          verb: 0.3,
        });
      else
        this.noise2({
          dur: 0.04,
          freq: fLo + Math.random() * (fHi - fLo),
          gain,
          type: 'highpass',
          delay: d,
          pan: pan + (Math.random() - 0.5) * 0.3,
        });
    }
  }
  sub({ from = 110, to = 35, dur = 0.5, gain = 0.5, delay = 0, pan = 0 }) {
    this.tone2({
      freq: from,
      slide: to,
      dur,
      gain: gain * (this._subScale ?? 1),
      type: 'sine',
      delay,
      pan,
      verb: 0,
      attack: 0.006,
    });
  }
  formant({
    f0 = 120,
    dur = 0.4,
    gain = 0.35,
    bands = [
      [750, 5],
      [1250, 7],
    ],
    slide = 0,
    pan = 0,
    verb = 0.2,
  }) {
    if (!this.on) return;
    const t = this._now();
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    const out = this._out(pan, verb);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain * this.intensity), t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [f, q] of bands) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      o.connect(bp);
      bp.connect(g);
    }
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  _loop(build) {
    // registered loop for slow-mo pitch tracking; returns handle
    if (!this.on) return null;
    const h = { oscs: [], srcs: [], gain: null, baseGain: 0, stop: null };
    build(h);
    this.loops.add(h);
    h.stop = (fade = 0.08) => {
      const t = this._now();
      if (h.gain) {
        h.gain.gain.cancelScheduledValues(t);
        h.gain.gain.setValueAtTime(Math.max(0.0001, h.gain.gain.value), t);
        h.gain.gain.exponentialRampToValueAtTime(0.0001, t + fade);
      }
      for (const { o } of h.oscs) o.stop(t + fade + 0.05);
      for (const { s } of h.srcs) s.stop(t + fade + 0.05);
      this.loops.delete(h);
    };
    return h;
  }
  frame(timeScale) {
    // slow-mo drops the pitch of every live loop
    if (!this.ctx || this.loops.size === 0) return;
    const mul = Math.max(0.5, timeScale ** 0.6);
    const cents = 1200 * Math.log2(mul);
    for (const h of this.loops) {
      for (const e of h.oscs) e.o.detune.setTargetAtTime(cents, this._now(), 0.03);
      for (const e of h.srcs) e.s.playbackRate.setTargetAtTime(e.base * mul, this._now(), 0.03);
    }
  }
  duck(amount = 0.4, dur = 0.28) {
    if (!this.on) return;
    this._duckF = 1 - amount;
    this._applyMaster(0.008);
    // restore rides the sim clock (sticky: survives ability switches, so the
    // master can never be left stuck ducked)
    this._duckId = (this._duckId ?? 0) + 1;
    const id = this._duckId;
    setTimeoutSim(
      dur,
      () => {
        if (this._duckId === id) {
          this._duckF = 1;
          this._applyMaster(0.09);
        }
      },
      true,
    );
  }
  // ---- windup beds per charge style ---------------------------------------
  bedStart(style, _palName, dur, pan = 0) {
    if (!this.on) return;
    this.bedStop();
    const t = this._now();
    this.bed = this._loop((h) => {
      const g = this.ctx.createGain();
      h.gain = g;
      g.gain.setValueAtTime(0.0001, t);
      const out = this._out(pan, style === 'ascend' || style === 'runes' ? 0.45 : 0.15);
      g.connect(out);
      const mkOsc = (type, f) => {
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.start(t);
        h.oscs.push({ o });
        return o;
      };
      const mkSrc = (rate = 1) => {
        const s = this.ctx.createBufferSource();
        s.buffer = this.noiseBuf;
        s.loop = true;
        s.playbackRate.value = rate;
        s.start(t, Math.random());
        h.srcs.push({ s, base: rate });
        return s;
      };
      if (style === 'orb' || style === 'weapon') {
        const o1 = mkOsc('sawtooth', 52),
          o2 = mkOsc('sawtooth', 52.8);
        o1.frequency.exponentialRampToValueAtTime(style === 'weapon' ? 240 : 190, t + dur);
        o2.frequency.exponentialRampToValueAtTime(style === 'weapon' ? 243 : 193, t + dur);
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 1.6;
        f.frequency.setValueAtTime(280, t);
        f.frequency.exponentialRampToValueAtTime(style === 'weapon' ? 3400 : 2400, t + dur);
        o1.connect(f);
        o2.connect(f);
        f.connect(g);
        if (style === 'weapon') {
          // metallic shing rising with the enchantment
          const s = mkSrc(1);
          const bf = this.ctx.createBiquadFilter();
          bf.type = 'bandpass';
          bf.Q.value = 9;
          bf.frequency.setValueAtTime(2200, t);
          bf.frequency.exponentialRampToValueAtTime(4200, t + dur);
          const sg = this.ctx.createGain();
          sg.gain.value = 0.35;
          s.connect(bf);
          bf.connect(sg);
          sg.connect(g);
        }
        g.gain.exponentialRampToValueAtTime(0.1 * this.intensity, t + dur * 0.85);
        h.bedTarget = 0.1;
      } else if (style === 'runes') {
        const o1 = mkOsc('sawtooth', 55),
          o2 = mkOsc('sawtooth', 82.5);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 320;
        o1.connect(f);
        o2.connect(f);
        f.connect(g);
        const s = mkSrc(0.9); // ritual whisper bed
        const wf = this.ctx.createBiquadFilter();
        wf.type = 'highpass';
        wf.frequency.value = 4200;
        const wg = this.ctx.createGain();
        wg.gain.value = 0.06;
        const lfo = mkOsc('sine', 5.5);
        const lg = this.ctx.createGain();
        lg.gain.value = 0.04;
        lfo.connect(lg);
        lg.connect(wg.gain);
        s.connect(wf);
        wf.connect(wg);
        wg.connect(g);
        g.gain.exponentialRampToValueAtTime(0.14 * this.intensity, t + dur * 0.7);
        h.bedTarget = 0.14;
        // bell tolls at the third marks, cancelled if the bed dies first
        this.partials({ freqs: [392, 587], dur: 1.1, gain: 0.1, stagger: 0.02, pan, verb: 0.5 });
        setTimeoutSim(dur * 0.55, () => {
          if (this.bed === h)
            this.partials({
              freqs: [523, 785],
              dur: 1.1,
              gain: 0.12,
              stagger: 0.02,
              pan,
              verb: 0.5,
            });
        });
      } else if (style === 'vortex') {
        const s = mkSrc(1);
        const f = this.ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 2.2;
        f.frequency.setValueAtTime(380, t);
        f.frequency.exponentialRampToValueAtTime(1600, t + dur);
        s.connect(f);
        f.connect(g);
        g.gain.exponentialRampToValueAtTime(0.22 * this.intensity, t + dur * 0.8);
        h.bedTarget = 0.22;
      } else if (style === 'ascend') {
        for (const [f, det] of [
          [220, 0],
          [277, 3],
          [330, -3],
          [440, 5],
        ]) {
          const o = mkOsc('sine', f);
          o.detune.value = det;
          const og = this.ctx.createGain();
          og.gain.value = 0.22;
          o.connect(og);
          og.connect(g);
        }
        g.gain.exponentialRampToValueAtTime(0.12 * this.intensity, t + dur * 0.9);
        h.bedTarget = 0.12;
      } else if (style === 'stance') {
        const s = mkSrc(0.7);
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 130;
        s.connect(f);
        f.connect(g);
        const creak = mkOsc('sawtooth', 84);
        const cf = this.ctx.createBiquadFilter();
        cf.type = 'lowpass';
        cf.frequency.value = 240;
        const cg = this.ctx.createGain();
        cg.gain.value = 0.1;
        const am = mkOsc('sine', 2.8);
        const ag = this.ctx.createGain();
        ag.gain.value = 0.08;
        am.connect(ag);
        ag.connect(cg.gain);
        creak.connect(cf);
        cf.connect(cg);
        cg.connect(g);
        g.gain.exponentialRampToValueAtTime(0.16 * this.intensity, t + Math.min(0.4, dur));
        h.bedTarget = 0.16;
      } else {
        // none
        g.gain.setValueAtTime(0.0001, t);
      }
      h.baseGain = 1;
    });
  }
  bedBreath(held) {
    // the held-breath beat silences the bed, then it slams back
    if (!this.bed?.gain) return;
    const t = this._now();
    if (held) {
      this.bed.gain.gain.cancelScheduledValues(t);
      this.bed.gain.gain.setTargetAtTime(0.02, t, 0.03);
    } else {
      this.bed.gain.gain.setTargetAtTime((this.bed.bedTarget ?? 0.13) * this.intensity, t, 0.015);
    }
  }
  bedStop() {
    if (this.bed) {
      this.bed.stop(0.06);
      this.bed = null;
    }
  }
  // compat shims (old call names)
  chargeStart(dur) {
    this.bedStart(
      ctx ? ctx.windupStyle : 'orb',
      ctx ? ctx.palName : 'storm',
      dur,
      ctx && rig ? panOf(rig.group.position.x) : 0,
    );
  }
  chargeStop() {
    this.bedStop();
  }
  crackle() {
    this.noise2({
      dur: 0.05,
      freq: 5200 + Math.random() * 2600,
      gain: 0.05,
      type: 'highpass',
      q: 0.7,
      pan: rig ? panOf(rig.group.position.x) : 0,
    });
  }
  // ---- projectile travel ----------------------------------------------------
  travelStart(palName) {
    this.travelStop();
    if (!this.on) return;
    const t = this._now();
    if (palName === 'arcane' || palName === 'moon') {
      // magical projectiles hum, not hiss
      const f0 = palName === 'arcane' ? 880 : 520;
      this.travelH = this._loop((h) => {
        const g = this.ctx.createGain();
        g.gain.value = 0.05;
        h.gain = g;
        for (const det of [0, 4.5]) {
          const o = this.ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f0 + det;
          o.connect(g);
          o.start(t);
          h.oscs.push({ o });
        }
        g.connect(this._out(0, 0.15));
      });
      return;
    }
    const cfg = {
      fire: [700, 'lowpass', 0.09],
      blood: [600, 'lowpass', 0.08],
      frost: [6200, 'highpass', 0.05],
      shadow: [900, 'bandpass', 0.06],
      storm: [2600, 'bandpass', 0.06],
      venom: [700, 'bandpass', 0.07],
      holy: [5500, 'highpass', 0.04],
      gold: [5500, 'highpass', 0.04],
    }[palName] ?? [3100, 'bandpass', 0.05];
    this.travelH = this._loop((h) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      s.playbackRate.value = 1;
      const f = this.ctx.createBiquadFilter();
      f.type = cfg[1];
      f.frequency.value = cfg[0];
      f.Q.value = 2.2;
      const g = this.ctx.createGain();
      g.gain.value = cfg[2];
      h.gain = g;
      s.connect(f);
      f.connect(g);
      g.connect(this._out(0, 0.08));
      s.start(t, Math.random());
      h.srcs.push({ s, base: 1 });
    });
  }
  travelStop() {
    if (this.travelH) {
      this.travelH.stop(0.05);
      this.travelH = null;
    }
  }
  sizzleStart() {
    this.travelStart(ctx ? ctx.palName : 'storm');
  }
  sizzleStop() {
    this.travelStop();
  }
  // ---- beams: a hum that crescendos with the channel ------------------------
  beamStart(_palName, pan = 0) {
    this.beamStop();
    if (!this.on) return;
    const t = this._now();
    this.beamH = this._loop((h) => {
      const o1 = this.ctx.createOscillator();
      o1.type = 'sawtooth';
      o1.frequency.value = 108;
      const o2 = this.ctx.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.value = 109.5;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 750;
      f.Q.value = 3;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09 * this.intensity, t + 0.25);
      o1.connect(f);
      o2.connect(f);
      f.connect(g);
      g.connect(this._out(pan, 0.2));
      o1.start(t);
      o2.start(t);
      h.oscs.push({ o: o1 }, { o: o2 });
      h.gain = g;
      h.filter = f;
    });
  }
  beamTick(i, _total, pan = 0) {
    if (this.beamH?.filter)
      this.beamH.filter.frequency.setTargetAtTime(750 + i * 380, this._now(), 0.06);
    if (this.beamH?.gain)
      this.beamH.gain.gain.setTargetAtTime((0.09 + i * 0.03) * this.intensity, this._now(), 0.06);
    this.tone2({
      freq: 320 * 1.122 ** i,
      dur: 0.16,
      gain: 0.16,
      type: 'triangle',
      pan,
      verb: 0.25,
    });
  }
  beamStop() {
    if (this.beamH) {
      this.beamH.stop(0.1);
      this.beamH = null;
    }
  }
  // ---- the 12 palette impact identities -------------------------------------
  impact(
    palName,
    { pan = 0, scale = 1, crit = false, finisher = false, lite = false, sample = null } = {},
  ) {
    if (!this.on) return;
    const I = Math.min(1.5, scale) * (lite ? 0.6 : 1);
    const d = finisher ? 0.035 : 0; // pre-gap: silence, then the hit
    if (finisher) this.duck(0.45, 0.05); // duck only the pre-gap, the hit itself blooms out of the silence
    // generated-sample path: the recording carries the character; synthesis
    // keeps supplying what recordings can't, sub weight, crit sting, finisher toll
    // a spec-authored bespoke id (impact.sample) wins when the pack carries it;
    // otherwise the palette identity plays, so a missing take degrades silently
    const sampleKey = sample && this.samples.has(sample) ? sample : `imp_${palName}`;
    if (this.sampleMode && this.samples.has(sampleKey)) {
      // full beef: saturation crunch + octave-down body double, scaled by power
      this.sample(sampleKey, {
        pan,
        gain: Math.min(1.4, 0.5 + 0.5 * I) * (lite ? 0.5 : 1),
        verb: 0.22,
        delay: d,
        beef: lite ? 0.2 : 0.3 + 0.15 * I,
        subOct: !lite,
      });
      if (!lite) {
        this._subScale = crit || finisher ? 0.45 : 1;
        this.sub({
          from: 120,
          to: I >= 1.2 ? 26 : 32,
          dur: 0.45 * (0.7 + 0.3 * I),
          gain: 0.5 * I,
          delay: d,
          pan,
        });
        this._subScale = 1;
      }
      if (crit && !lite) {
        this.noise2({ dur: 0.08, freq: 8200, gain: 0.35, type: 'highpass', delay: d, pan });
        this.sub({ from: 60, to: 24, dur: 0.8, gain: 0.55, delay: d + 0.02, pan });
      }
      if (finisher)
        this.partials({ freqs: [65, 98], dur: 1.2, gain: 0.3, type: 'triangle', pan, verb: 0.5 });
      return;
    }
    // when the crit adds its own deep sub, the recipe's sub steps aside
    this._subScale = lite ? 0 : crit || finisher ? 0.45 : 1;
    const P = {
      storm: () => {
        this.noise2({ dur: 0.1, freq: 7500, gain: 0.5 * I, type: 'highpass', delay: d, pan });
        this.noise2({ dur: 0.9, freq: 420, gain: 0.42 * I, delay: d, pan, verb: 0.2 });
        this.sub({
          from: 130,
          to: I >= 1.2 ? 26 : 32,
          dur: 0.55 * (0.7 + 0.3 * I),
          gain: 0.55 * I,
          delay: d,
          pan,
        });
        this.ticks({ n: Math.round(6 * (0.6 + 0.5 * I)), over: 0.4, gain: 0.07 * I, pan });
      },
      fire: () => {
        this.noise2({ dur: 0.5, freq: 520, sweep: 90, gain: 0.55 * I, delay: d, pan, verb: 0.15 });
        this.sub({
          from: 100,
          to: I >= 1.2 ? 32 : 40,
          dur: 0.45 * (0.7 + 0.3 * I),
          gain: 0.5 * I,
          delay: d,
          pan,
        });
        this.ticks({
          n: Math.round(9 * (0.6 + 0.5 * I)),
          over: 0.55,
          fLo: 2800,
          fHi: 6000,
          gain: 0.09 * I,
          pan,
        });
      },
      blood: () => {
        this.noise2({
          dur: 0.28,
          freq: 1200,
          sweep: 300,
          gain: 0.32 * I,
          type: 'bandpass',
          q: 3,
          delay: d,
          pan,
        });
        this.noise2({ dur: 0.22, freq: 180, sweep: 90, gain: 0.45 * I, delay: d, pan });
        this.sub({ from: 85, to: 45, dur: 0.3, gain: 0.5 * I, delay: d, pan });
        this.sub({ from: 70, to: 40, dur: 0.26, gain: 0.4 * I, delay: d + 0.26, pan });
      }, // wet squelch signature
      frost: () => {
        this.ticks({ n: 11, over: 0.28, fLo: 1900, fHi: 5400, gain: 0.1 * I, pan, tone: true });
        this.partials({
          freqs: [1780, 2350, 3160],
          dur: 0.85,
          gain: 0.16 * I,
          stagger: 0.015,
          pan,
          verb: 0.45,
        });
        this.noise2({ dur: 0.3, freq: 7000, gain: 0.28 * I, type: 'highpass', delay: d, pan });
      },
      moon: () => {
        this.tone2({ freq: 1320, dur: 0.6, gain: 0.2 * I, delay: d, pan, verb: 0.45 });
        this.noise2({
          dur: 0.7,
          freq: 4200,
          gain: 0.1 * I,
          type: 'highpass',
          attack: 0.15,
          delay: d,
          pan,
          verb: 0.5,
        });
        this.partials({
          freqs: [1174, 880, 587],
          dur: 1.3,
          gain: 0.12 * I,
          stagger: 0.06,
          pan,
          verb: 0.55,
        });
      }, // lunar glass: airy + falling cold partials, no FM zip (that's arcane's)
      arcane: () => {
        this.tone2({
          freq: 700,
          slide: 1500,
          dur: 0.28,
          gain: 0.28 * I,
          fmRatio: 1.6,
          fmDepth: 380,
          delay: d,
          pan,
          verb: 0.25,
        });
        this.partials({
          freqs: [1320, 1980],
          dur: 0.6,
          gain: 0.13 * I,
          stagger: 0.03,
          pan,
          verb: 0.35,
        });
      },
      shadow: () => {
        this.sub({ from: 160, to: 26, dur: 0.7, gain: 0.55 * I, delay: d, pan });
        this.noise2({ dur: 0.7, freq: 380, gain: 0.35 * I, attack: 0.1, delay: d, pan, verb: 0.3 });
        this.noise2({
          dur: 0.5,
          freq: 5200,
          gain: 0.1 * I,
          type: 'highpass',
          delay: d + 0.08,
          pan,
          verb: 0.4,
        });
      },
      venom: () => {
        for (let i = 0; i < 4; i++)
          this.tone2({
            freq: 300 - i * 40,
            slide: 140,
            dur: 0.12,
            gain: 0.16 * I,
            delay: d + i * 0.06,
            pan,
          });
        this.noise2({ dur: 0.6, freq: 5200, gain: 0.14 * I, type: 'highpass', delay: d, pan });
      },
      holy: () => {
        this.partials({
          freqs: [523, 785, 1046, 1568],
          dur: 1.2,
          gain: 0.26 * I,
          stagger: 0.025,
          pan,
          verb: 0.55,
        });
        this.noise2({
          dur: 0.25,
          freq: 3000,
          gain: 0.12 * I,
          type: 'highpass',
          delay: d,
          pan,
          verb: 0.4,
        });
      },
      gold: () => {
        this.partials({
          freqs: [2140, 3420, 5580],
          dur: 0.42,
          gain: 0.2 * I,
          stagger: 0.02,
          pan,
          verb: 0.3,
        });
        this.partials({
          freqs: [523, 784],
          dur: 0.9,
          gain: 0.16 * I,
          stagger: 0.04,
          pan,
          verb: 0.45,
        });
        this.sub({ from: 110, to: 60, dur: 0.35, gain: 0.3 * I, delay: d, pan });
      }, // struck treasure, not a second choir
      nature: () => {
        this.tone2({ freq: 175, dur: 0.12, gain: 0.35 * I, type: 'triangle', delay: d, pan });
        this.noise2({
          dur: 0.45,
          freq: 1150,
          gain: 0.24 * I,
          type: 'bandpass',
          q: 2,
          delay: d,
          pan,
        });
      },
      physical: () => {
        this.tone2({
          freq: 420,
          slide: 300,
          dur: 0.14,
          gain: 0.3 * I,
          type: 'triangle',
          delay: d,
          pan,
        });
        this.noise2({ dur: 0.16, freq: 260, gain: 0.5 * I, delay: d, pan });
        this.sub({ from: 82, to: 50, dur: 0.24, gain: 0.42 * I, delay: d, pan });
        this.partials({ freqs: [2870, 3350], dur: 0.15, gain: 0.13 * I, pan, verb: 0.2 });
      }, // woody body knock leads
    };
    (P[palName] ?? P.physical)();
    // weight arrives with power, not loudness alone: big hits in sub-less
    // palettes earn a body thump
    if (
      I >= 1.15 &&
      !lite &&
      !['storm', 'fire', 'blood', 'shadow', 'physical', 'gold'].includes(palName)
    ) {
      this.sub({ from: 92, to: 44, dur: 0.28 + 0.1 * I, gain: 0.22 * I, delay: d, pan });
    }
    this._subScale = 1;
    if (crit && !lite) {
      this.noise2({ dur: 0.08, freq: 8200, gain: 0.35, type: 'highpass', delay: d, pan });
      this.sub({ from: 60, to: 24, dur: 0.8, gain: 0.55, delay: d + 0.02, pan });
    }
    if (finisher)
      this.partials({ freqs: [65, 98], dur: 1.2, gain: 0.3, type: 'triangle', pan, verb: 0.5 });
  }
  school(kind) {
    // legacy shim → nearest palette identity
    const map = {
      zap: 'storm',
      fire: 'fire',
      frost: 'frost',
      arcane: 'arcane',
      shadow: 'shadow',
      holy: 'holy',
      nature: 'nature',
      thwack: 'physical',
    };
    this.impact(map[kind] ?? 'physical', {});
  }
  impactExtra(crit) {
    if (crit) this.sub({ from: 60, to: 26, dur: 0.7, gain: 0.5 });
  }
  release(palName, pan = 0) {
    // cast lets go: whoosh + spectral snap
    if (
      this.sample(`rel_${RELEASE_FAM[palName] ?? 'arcane'}`, {
        pan,
        gain: 0.85,
        verb: 0.2,
        beef: 0.18,
      })
    )
      return;
    this.noise2({ dur: 0.3, freq: 1400, sweep: 420, gain: 0.28, type: 'bandpass', q: 1.2, pan });
    this.noise2({ dur: 0.07, freq: 6800, gain: 0.3, type: 'highpass', pan });
  }
  whoosh(pan = 0, big = false) {
    if (
      this.sample(big ? 'whoosh_heavy' : 'whoosh_blade', {
        pan,
        gain: big ? 0.9 : 0.7,
        beef: big ? 0.25 : 0.15,
      })
    )
      return;
    this.noise2({
      dur: big ? 0.22 : 0.13,
      freq: big ? 900 : 1300,
      sweep: big ? 300 : 600,
      gain: big ? 0.3 : 0.2,
      type: 'bandpass',
      q: 1.4,
      pan,
    });
  }
  thunder(pan = 0) {
    if (this.sample('thunder', { pan, gain: 1.2, verb: 0.35, beef: 0.35, subOct: true })) {
      this.sub({ from: 52, to: 24, dur: 1.1, gain: 0.45, delay: 0.05, pan }); // the recording rides real sub weight
      return;
    }
    this.noise2({ dur: 0.12, freq: 8000, gain: 0.55, type: 'highpass', q: 0.4, pan });
    this.noise2({ dur: 2.3, freq: 340, gain: 0.5, pan, verb: 0.4 });
    this.noise2({ dur: 1.6, freq: 130, gain: 0.4, pan, verb: 0.3 });
    this.sub({ from: 52, to: 24, dur: 1.1, gain: 0.5, delay: 0.05, pan });
    this.noise2({ dur: 0.55, freq: 900, gain: 0.16, delay: 0.42, pan: -pan * 0.6, verb: 0.55 }); // echo off the far hills
  }
  ambienceStart() {
    if (!this.on || this.amb) return;
    const t = this._now();
    this.amb = this._loop((h) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      s.playbackRate.value = 0.5;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 240;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 1.2);
      h.gain = g;
      s.connect(f);
      f.connect(g);
      g.connect(this._out(0, 0.3));
      s.start(t, Math.random());
      h.srcs.push({ s, base: 0.5 });
    });
  }
  ambienceStop() {
    if (this.amb) {
      this.amb.stop(0.4);
      this.amb = null;
    }
  }
  gust(pan = 0) {
    this.noise2({
      dur: 1.4,
      freq: 500,
      sweep: 1300,
      gain: 0.06,
      type: 'bandpass',
      q: 0.8,
      attack: 0.5,
      pan,
      verb: 0.3,
    });
  }
  heal(palName, pan = 0, sample = null) {
    // spec-authored bespoke heal id first (e.g. the temporal chime), then the school pair
    if (sample && this.sample(sample, { pan, gain: 0.8, verb: 0.4 })) return;
    if (
      this.sample(palName === 'nature' ? 'heal_nature' : 'heal_holy', { pan, gain: 0.8, verb: 0.4 })
    )
      return;
    const base = palName === 'nature' ? [392, 494, 587, 784] : [523, 659, 784, 1046];
    this.partials({ freqs: base, dur: 1.4, gain: 0.2, stagger: 0.09, pan, verb: 0.55 });
    this.noise2({
      dur: 0.8,
      freq: 2600,
      gain: 0.06,
      type: 'highpass',
      attack: 0.25,
      pan,
      verb: 0.5,
    });
  }
  chime() {
    this.heal('holy', 0);
  }
  buffCast(style, palName, pan = 0, sample = null) {
    // spec-authored bespoke id first (e.g. the Storm Chorus drums), then the style key
    if (sample && this.sample(sample, { pan, gain: 0.9, verb: 0.25, beef: 0.2 })) return;
    if (
      this.sample(
        style === 'veil' ? 'buff_veil' : style === 'morph' ? 'buff_morph' : 'buff_raise',
        { pan, gain: 0.75, verb: 0.25 },
      )
    )
      return;
    if (style === 'veil') {
      this.noise2({
        dur: 0.5,
        freq: 3400,
        gain: 0.14,
        type: 'highpass',
        attack: 0.12,
        pan,
        verb: 0.3,
      });
      return;
    }
    if (style === 'morph') {
      this.noise2({ dur: 0.32, freq: 500, sweep: 2400, gain: 0.22, type: 'bandpass', q: 2, pan }); // inward rush
      this.tone2({
        freq: 880,
        slide: 1500,
        dur: 0.2,
        gain: 0.14,
        type: 'triangle',
        delay: 0.28,
        pan,
        verb: 0.3,
      });
      return;
    }
    // raise: ascending sparkle arpeggio in the palette's mood
    const seq = ['holy', 'gold'].includes(palName)
      ? [523, 659, 784]
      : ['shadow', 'venom'].includes(palName)
        ? [392, 466, 587]
        : [440, 554, 659];
    seq.forEach((f, i) => {
      this.tone2({ freq: f, dur: 0.3, gain: 0.14, delay: i * 0.07, pan, verb: 0.35 });
    });
  }
  poof() {
    if (this.sample('poof', { gain: 0.8, verb: 0.25 })) return;
    this.noise2({ dur: 0.2, freq: 2600, gain: 0.3, type: 'highpass' });
    this.tone2({ freq: 880, slide: 1500, dur: 0.18, gain: 0.14, type: 'triangle' });
  }
  ccPoof(_pan = 0) {
    this.poof();
  }
  baa(pan = 0) {
    // the sheep. non-negotiable.
    this.tone2({
      freq: 620,
      slide: 540,
      dur: 0.2,
      gain: 0.24,
      type: 'sawtooth',
      fmRatio: 0.05,
      fmDepth: 210,
      pan,
      verb: 0.2,
    });
    this.tone2({
      freq: 560,
      slide: 470,
      dur: 0.24,
      gain: 0.2,
      type: 'sawtooth',
      fmRatio: 0.05,
      fmDepth: 190,
      delay: 0.22,
      pan,
      verb: 0.2,
    });
  }
  shout(_palName, pan = 0) {
    // an actual war-cry
    if (this.sample('shout_war', { pan, gain: 0.95, verb: 0.3, beef: 0.3 })) {
      this.sub({ from: 95, to: 55, dur: 0.35, gain: 0.3, pan }); // chest weight under the voice
      return;
    }
    this.formant({
      f0: 135,
      slide: 95,
      dur: 0.42,
      gain: 0.5,
      bands: [
        [760, 5],
        [1220, 7],
      ],
      pan,
      verb: 0.3,
    });
    this.noise2({ dur: 0.3, freq: 600, gain: 0.28, pan });
    this.sub({ from: 95, to: 55, dur: 0.35, gain: 0.35, pan });
  }
  roar() {
    this.shout('blood', rig ? panOf(rig.group.position.x) : 0);
  }
  portal(pan = 0) {
    if (this.sample('portal', { pan, gain: 0.9, verb: 0.4 })) return;
    this.tone2({ freq: 55, dur: 1.1, gain: 0.3, type: 'sawtooth', slide: 42, pan, verb: 0.4 });
    this.tone2({ freq: 63, dur: 1.1, gain: 0.22, type: 'sawtooth', slide: 48, pan, verb: 0.4 });
    this.noise2({
      dur: 0.9,
      freq: 1600,
      gain: 0.16,
      type: 'bandpass',
      q: 3,
      attack: 0.2,
      pan,
      verb: 0.45,
    });
  }
  dashWind(dur = 0.5, pan = 0) {
    if (this.sample('dash', { pan, gain: 0.8, beef: 0.2 })) return;
    this.noise2({ dur, freq: 950, sweep: 380, gain: 0.3, type: 'bandpass', q: 1.1, pan });
  }
  heartbeat(pan = 0) {
    this.sub({ from: 62, to: 44, dur: 0.14, gain: 0.26, pan });
    this.sub({ from: 56, to: 40, dur: 0.12, gain: 0.2, delay: 0.16, pan });
  }
  distantRumble() {
    this.noise2({
      dur: 1.1,
      freq: 210,
      gain: 0.05,
      verb: 0.5,
      attack: 0.3,
      pan: (Math.random() - 0.5) * 0.8,
    });
  }
  spirit(model, pan = 0) {
    // creature calls, every apparition speaks
    // the screechers sit back in the mix; the growlers can stay forward
    const SPIRIT_VOICE = {
      raptor: [0.5, true],
      hawk: [0.45, true],
      fox: [0.45, true],
      ghost: [0.55, true],
      sheep: [0.7, false],
    };
    const [vol, softV] = SPIRIT_VOICE[model] ?? [0.8, false];
    if (this.sample(`spirit_${model}`, { pan, gain: vol, verb: 0.4, soft: softV })) return;
    switch (model) {
      case 'wolf':
        this.tone2({
          freq: 400,
          slide: 640,
          dur: 0.5,
          gain: 0.2,
          type: 'sawtooth',
          vibRate: 5.5,
          vibDepth: 0.015,
          pan,
          verb: 0.5,
        });
        this.tone2({
          freq: 620,
          slide: 370,
          dur: 0.55,
          gain: 0.17,
          type: 'sawtooth',
          vibRate: 5,
          vibDepth: 0.02,
          delay: 0.48,
          pan,
          verb: 0.55,
        });
        break;
      case 'bear':
        this.formant({
          f0: 62,
          slide: 48,
          dur: 0.65,
          gain: 0.5,
          bands: [
            [290, 4],
            [620, 6],
          ],
          pan,
          verb: 0.35,
        });
        this.sub({ from: 70, to: 40, dur: 0.5, gain: 0.35, pan });
        break;
      case 'raptor':
        this.tone2({
          freq: 1500,
          slide: 820,
          dur: 0.18,
          gain: 0.2,
          type: 'square',
          pan,
          verb: 0.3,
        });
        this.noise2({ dur: 0.12, freq: 5200, gain: 0.12, type: 'highpass', delay: 0.05, pan });
        break;
      case 'hawk':
        this.tone2({
          freq: 2150,
          slide: 1150,
          dur: 0.4,
          gain: 0.16,
          vibRate: 11,
          vibDepth: 0.03,
          pan,
          verb: 0.45,
        });
        break;
      case 'bull':
        this.noise2({ dur: 0.14, freq: 220, gain: 0.35, pan });
        this.sub({ from: 75, to: 45, dur: 0.3, gain: 0.4, delay: 0.1, pan });
        break;
      case 'sheep':
        this.baa(pan);
        break;
      case 'demon':
        this.formant({
          f0: 55,
          dur: 0.7,
          gain: 0.45,
          bands: [
            [240, 4],
            [520, 6],
          ],
          slide: 42,
          pan,
          verb: 0.4,
        });
        this.tone2({ freq: 63, dur: 0.6, gain: 0.2, type: 'sawtooth', pan, verb: 0.4 });
        break;
      case 'voidwalker':
        this.tone2({
          freq: 112,
          slide: 66,
          dur: 1.1,
          gain: 0.24,
          vibRate: 3.2,
          vibDepth: 0.03,
          pan,
          verb: 0.6,
        });
        break;
      case 'ghost':
        this.tone2({
          freq: 820,
          slide: 340,
          dur: 0.95,
          gain: 0.14,
          vibRate: 6,
          vibDepth: 0.05,
          pan,
          verb: 0.65,
        });
        break;
      default:
        this.partials({ freqs: [660, 990], dur: 0.7, gain: 0.09, stagger: 0.05, pan, verb: 0.5 });
    }
  }
  motif(name, pan = 0) {
    // set-piece foley
    if (
      MOTIF_SAMPLE[name] &&
      this.sample(MOTIF_SAMPLE[name], {
        pan,
        gain: 0.85,
        verb: 0.3,
        beef: 0.3,
        subOct: name === 'gavel' || name === 'fissure' || name === 'pillars',
      })
    )
      return;
    switch (name) {
      case 'fissure':
        this.sub({ from: 90, to: 28, dur: 0.7, gain: 0.5, pan });
        this.noise2({ dur: 0.65, freq: 160, gain: 0.38, pan });
        this.ticks({ n: 5, over: 0.35, fLo: 900, fHi: 2200, gain: 0.1, pan });
        break;
      case 'vines':
        for (let i = 0; i < 2; i++)
          this.tone2({
            freq: 130 - i * 20,
            slide: 90,
            dur: 0.5,
            gain: 0.16,
            type: 'sawtooth',
            vibRate: 3,
            vibDepth: 0.06,
            delay: i * 0.18,
            pan,
            verb: 0.2,
          });
        break;
      case 'chains':
        for (let i = 0; i < 3; i++)
          this.partials({
            freqs: [820, 1240, 1660],
            dur: 0.22,
            gain: 0.14,
            stagger: 0.004,
            pan: pan + (i - 1) * 0.12,
            verb: 0.3,
          });
        break;
      case 'swarm':
        this.noise2({ dur: 0.55, freq: 950, gain: 0.2, type: 'bandpass', q: 3, pan, verb: 0.25 });
        break;
      case 'pillars':
        for (let i = 0; i < 5; i++) {
          this.noise2({
            dur: 0.12,
            freq: 210,
            gain: 0.26,
            delay: i * 0.09,
            pan: pan + (i - 2) * 0.1,
          });
          this.sub({ from: 72, to: 48, dur: 0.16, gain: 0.24, delay: i * 0.09, pan });
        }
        break;
      case 'orbitals':
        break; // the sequenced impacts already ring
      case 'cross':
        this.partials({ freqs: [1046, 1568], dur: 0.9, gain: 0.16, stagger: 0.02, pan, verb: 0.5 });
        break;
      case 'fountain':
        for (let i = 0; i < 6; i++)
          this.tone2({
            freq: 380 + Math.random() * 420,
            slide: 700,
            dur: 0.09,
            gain: 0.09,
            delay: Math.random() * 0.4,
            pan,
            verb: 0.3,
          });
        this.noise2({ dur: 0.7, freq: 1100, gain: 0.14, type: 'bandpass', q: 1.5, pan });
        break;
      case 'crescents':
        for (let i = 0; i < 2; i++)
          this.noise2({
            dur: 0.16,
            freq: 1900,
            sweep: 420,
            gain: 0.22,
            type: 'bandpass',
            q: 1.6,
            delay: i * 0.12,
            pan: pan + (i ? 0.2 : -0.2),
          });
        break;
      case 'bladestorm':
        for (let i = 0; i < 3; i++)
          this.noise2({
            dur: 0.15,
            freq: 1700,
            sweep: 500,
            gain: 0.18,
            type: 'bandpass',
            q: 1.5,
            delay: i * 0.14,
            pan: [-0.4, 0, 0.4][i],
          });
        break;
      case 'implosion':
        this.noise2({
          dur: 0.34,
          freq: 400,
          sweep: 2600,
          gain: 0.3,
          type: 'bandpass',
          q: 2,
          attack: 0.28,
          pan,
        });
        break;
      case 'barrier':
        for (let i = 0; i < 3; i++)
          this.partials({
            freqs: [2140, 2680],
            dur: 0.16,
            gain: 0.1,
            delay: i * 0.06,
            pan,
            verb: 0.35,
          });
        break;
      case 'gavel':
        this.sub({ from: 95, to: 30, dur: 0.5, gain: 0.5, delay: 0.2, pan });
        this.partials({
          freqs: [720, 1080, 1440],
          dur: 0.7,
          gain: 0.2,
          stagger: 0.005,
          delay: 0.2,
          pan,
          verb: 0.45,
        });
        this.noise2({ dur: 0.2, freq: 300, gain: 0.35, delay: 0.2, pan });
        break; // verdict lands
      case 'claws':
        for (let i = 0; i < 3; i++)
          this.noise2({
            dur: 0.13,
            freq: 2100,
            sweep: 600,
            gain: 0.2,
            type: 'bandpass',
            q: 1.8,
            delay: i * 0.05,
            pan: pan + (i - 1) * 0.1,
          });
        break;
    }
  }
  // very old positional-arg shims (a few direct call sites)
  noise(dur, freq, gain, type = 'lowpass', q = 1) {
    this.noise2({ dur, freq, gain, type, q });
  }
  tone(freq, dur, gain, type = 'sine', slideTo = 0, delay = 0) {
    this.tone2({ freq, dur, gain, type, slide: slideTo, delay });
  }
}
const sfx = new Sfx();
let sndOn = false;

// ---------------------------------------------------------------- camera feel
let trauma = 0,
  fovKick = 0;
const kickPos = new THREE.Vector3(),
  kickVel = new THREE.Vector3();
function addKick(dir, mag) {
  kickVel.addScaledVector(dir, mag);
}
// caster lean + receiver recoil springs, bodies acknowledge the magic
function updateBodyFeel(_dt, realDt) {
  let target = 0;
  if (state === 'windup' && ctx) target = -0.085 * easeInOutSine(clamp01(stateT / ctx.windup));
  bodyLeanVel += -90 * (bodyLean - target) * realDt;
  bodyLeanVel *= Math.max(0, 1 - 9 * realDt);
  bodyLean += bodyLeanVel * realDt;
  if (rig) rig.group.rotation.z = bodyLean;
  dummyRotVel += -60 * dummyRot * realDt;
  dummyRotVel *= Math.max(0, 1 - 5.5 * realDt);
  dummyRot += dummyRotVel * realDt;
  dummyRot = Math.max(-0.35, Math.min(0.35, dummyRot));
  dummy.group.rotation.z = dummyRot;
  // secondary animation: the crossbar swings and the head bobbles on their own springs
  barVel += -85 * barRot * realDt;
  barVel *= Math.max(0, 1 - 4.5 * realDt);
  barRot += barVel * realDt;
  dummy.barPivot.rotation.y = Math.max(-0.6, Math.min(0.6, barRot));
  headVel += -120 * headOff * realDt;
  headVel *= Math.max(0, 1 - 6 * realDt);
  headOff += headVel * realDt;
  dummy.head.position.y = dummy.headBaseY + Math.max(-0.12, Math.min(0.12, headOff));
}
function dummyKick(mag) {
  dummyRotVel -= mag;
  kickSign *= -1;
  barVel += mag * 1.6 * kickSign; // crossbar whips
  headVel += mag * 0.55; // head pops
}

function updateCameraFeel(_dt, realDt) {
  trauma = Math.max(0, trauma - realDt * 1.9);
  fovKick = Math.max(0, fovKick - realDt * 14);
  kickVel.addScaledVector(kickPos, -90 * realDt);
  kickVel.multiplyScalar(Math.max(0, 1 - 10 * realDt));
  kickPos.addScaledVector(kickVel, realDt);
  const sh = trauma * trauma;
  shakeGroup.position.set(
    kickPos.x + (rnd() - 0.5) * sh * 0.5,
    kickPos.y + (rnd() - 0.5) * sh * 0.5,
    kickPos.z + (rnd() - 0.5) * sh * 0.5,
  );
  shakeGroup.rotation.z = (rnd() - 0.5) * sh * 0.02;
  const f = 55 + fovKick;
  if (Math.abs(camera.fov - f) > 0.01) {
    camera.fov = f;
    camera.updateProjectionMatrix();
  }
}
let flashVal = 0;
function screenFlash(v) {
  flashVal = Math.max(flashVal, v);
}

// sim-clock timeouts, tagged with the ability generation so stale callbacks
// from a previous ability never fire into the new one's ctx (sticky = survives)
const simTimeouts = [];
let abilityToken = 0;
function setTimeoutSim(delay, fn, sticky = false) {
  simTimeouts.push({ left: delay, fn, tok: sticky ? -1 : abilityToken });
}
function updateSimTimeouts(dt) {
  for (let i = simTimeouts.length - 1; i >= 0; i--) {
    const e = simTimeouts[i];
    if (e.tok !== -1 && e.tok !== abilityToken) {
      simTimeouts.splice(i, 1);
      continue;
    }
    e.left -= dt;
    if (e.left <= 0) {
      simTimeouts.splice(i, 1);
      e.fn();
    }
  }
}

// ================================================================ SEQUENCER
const tmpA = new THREE.Vector3(),
  tmpB = new THREE.Vector3(),
  tmpC = new THREE.Vector3();
const orbPos = new THREE.Vector3();
const projPos = new THREE.Vector3(),
  projDir = new THREE.Vector3();
const trailHist = [];

let rig = null; // active class rig
let ctx = null; // current ability context
let state = 'idle',
  stateT = 0,
  loopCount = 0,
  isCrit = false;
let hitstopLeft = 0,
  timeScale = 1,
  slowMo = false,
  finisherOn = true,
  tourOn = false;
let userTimeScale = 1,
  cineOn = false,
  cineAngle = 0.6,
  cineAutoUntil = 0,
  cineShotIn = false,
  cineRadius = 9;
const cineFocus = new THREE.Vector3(0, 1.8, 0);
let comboOn = false,
  comboIx = 0;
let expoDipUntil = 0,
  impactFrames = 0;
let bodyLean = 0,
  bodyLeanVel = 0,
  dummyRot = 0,
  dummyRotVel = 0;
let barRot = 0,
  barVel = 0,
  headOff = 0,
  headVel = 0,
  kickSign = 1;
let skyFlickerNext = 1.2,
  coilPhase = 0,
  forkTimer = 0,
  groundArcTimer = 0;
let targetGlow = 0,
  shellGlow = 0,
  casterGlowV = 0,
  totemGlow = 0.18;
let scorchAlpha = 0,
  scorchMax = 0.85,
  crackDissolve = 1,
  runeDissolve = 1,
  portalDissolve = 1,
  _portalHdr = 0;
let finisherFired = false,
  finisherTimer = 0,
  idleResumed = true,
  critSlowUntil = 0,
  critSlowStart = 0;
let comboWear = 0,
  lastResiduePal = null; // combo mode: accumulated damage read + residue interactions
const rigGlowColor = new THREE.Color(0x88aaff); // caster body rim color (spec.rim or palette)

function fallbackSpec(meta) {
  const effs = new Set(meta.effects);
  const id = meta.id;
  if (meta.channel)
    return { archetype: 'beam', beam: { dur: 2.0, ticks: 4, drain: effs.has('drainTick') } };
  if (
    effs.has('summonDemon') ||
    effs.has('tamePet') ||
    effs.has('dismissPet') ||
    id === 'revive_pet'
  )
    return { archetype: 'summon' };
  if (effs.has('polymorph')) return { archetype: 'cc', cc: { style: 'poof' } };
  if (id === 'fear') return { archetype: 'cc', cc: { style: 'tendrils' } };
  if (effs.has('charge')) return { archetype: 'dash' };
  if (effs.has('heal') || effs.has('hot')) return { archetype: 'heal' };
  if (meta.targetType === 'self')
    return {
      archetype: 'buff',
      buff: {
        style:
          id.includes('stealth') || id.includes('prowl')
            ? 'veil'
            : id.includes('form') || id.includes('wolf')
              ? 'morph'
              : 'raise',
      },
    };
  if (
    effs.has('aoeAttackPower') ||
    effs.has('aoeAttackSpeed') ||
    id.includes('shout') ||
    id.includes('roar')
  )
    return { archetype: 'shout' };
  if ((effs.has('aoeDamage') || effs.has('aoeRoot')) && meta.range === 0)
    return { archetype: 'nova' };
  if (effs.has('stun') || effs.has('incapacitate') || effs.has('finisherStun')) {
    return meta.range <= 6
      ? { archetype: 'strike', strike: { stars: true } }
      : { archetype: 'cc', cc: { style: 'stars' } };
  }
  if (effs.has('dot') && !effs.has('directDamage') && !effs.has('weaponDamage')) {
    const rising = meta.school === 'fire' || meta.school === 'nature';
    return { archetype: 'dot', dot: { drip: rising ? 'rise' : 'fall' } };
  }
  if (
    effs.has('weaponDamage') ||
    effs.has('weaponStrike') ||
    effs.has('finisherDamage') ||
    (meta.range <= 6 && meta.school === 'physical')
  ) {
    return { archetype: 'strike' };
  }
  if (meta.range > 6 && meta.castTime > 0 && (effs.has('directDamage') || effs.has('judgement'))) {
    return { archetype: 'bolt', bolt: { speed: 26 } };
  }
  if (meta.range > 0) return { archetype: 'burst' };
  return { archetype: 'buff', buff: { style: 'raise' } };
}

// curated class rotations for combo showcase mode, each ends on its finisher,
// which is forced to crit. Residues persist between steps (mage's fireball
// flash-melts the frostbolt rime it just laid down).
// entries may be { id, at }, at:'melee' keeps the caster planted at the target
// (the warrior FIGHTS where charge put him), at:'target' detonates centered
// archetypes ON the victim (the mage's frost_nova freezes the dummy, not air)
const COMBOS = {
  warrior: [
    'charge',
    { id: 'red_harvest', at: 'melee' },
    { id: 'thunder_clap', at: 'melee' },
    'execute',
  ],
  mage: ['frostbolt', 'fireball', 'fire_blast', { id: 'frost_nova', at: 'target' }],
  rogue: ['ambush', 'sinister_strike', 'kidney_shot', 'eviscerate'],
  paladin: ['seal_of_righteousness', 'judgement', 'exorcism', 'holy_light'],
  hunter: ['aspect_of_the_hawk', 'rapid_fire', 'serpent_sting', 'aimed_shot'], // two stacked buffs (wings + heartbeat), then the hunt
  priest: ['power_word_shield', 'shadow_word_pain', 'mind_flay', 'mind_blast'],
  shaman: ['rockbiter_weapon', 'flame_shock', 'earth_shock', 'lightning_bolt'], // stormstrike was removed upstream
  warlock: ['corruption', 'immolate', 'drain_life', 'shadowburn'],
  druid: ['bear_form', 'bear_charge', 'maul', 'ferocious_bite'],
};

// per-clip blade-contact points (fraction of clip duration), feedback lands
// when the weapon visually connects, not when the clip starts
const CONTACT_FRAC = {
  '1H_Melee_Attack_Chop': 0.38,
  '1H_Melee_Attack_Slice_Diagonal': 0.4,
  Dualwield_Melee_Attack_Chop: 0.34,
  '2H_Melee_Attack_Chop': 0.45,
  Spellcast_Shoot: 0.3,
  '2H_Ranged_Shoot': 0.26,
};

// default charge-up language per archetype, the rune circle is no longer the
// universal windup; it's reserved for abilities that ask for it
const WINDUP_DEFAULT = {
  bolt: 'orb',
  burst: 'orb',
  strike: 'stance',
  nova: 'vortex',
  beam: 'orb',
  dot: 'orb',
  heal: 'ascend',
  buff: 'none',
  shout: 'stance',
  summon: 'runes',
  cc: 'orb',
  dash: 'stance',
};

function resolveSpec(cls, id) {
  const meta = CATALOG[cls].find((a) => a.id === id);
  const spec = { ...fallbackSpec(meta), ...(SPECS[id] ?? {}) };
  const palName =
    (spec.palette ?? meta.school) in PALETTES ? (spec.palette ?? meta.school) : 'physical';
  let pal = PALETTES[palName];
  // per-ability tone: accent override + hot shift split same-palette siblings
  if (spec.accent !== undefined || spec.hot !== undefined) {
    pal = { ...pal };
    if (spec.accent !== undefined) pal.accent = new THREE.Color(spec.accent);
    if (spec.hot) {
      pal.core = pal.core.clone().lerp(WHITE, spec.hot);
      pal.main = pal.main.clone().lerp(WHITE, spec.hot * 0.4);
    }
  }
  // spec.tint shifts the whole palette toward a hue, earth abilities pull the
  // steel physical palette amber, etc.
  if (spec.tint) {
    pal = { ...pal };
    const tc = new THREE.Color(spec.tint);
    pal.main = pal.main.clone().lerp(tc, 0.65);
    pal.core = pal.core.clone().lerp(tc.clone().lerp(WHITE, 0.5), 0.5);
    pal.ion = pal.ion.clone().lerp(tc, 0.45);
    pal.glow = pal.glow.clone().lerp(tc, 0.5);
  }
  const windup = spec.windup ?? (meta.castTime > 0 ? Math.min(2.2, meta.castTime) : 0.35);
  const windupStyle = spec.windupStyle ?? WINDUP_DEFAULT[spec.archetype] ?? 'orb';
  return {
    cls,
    id,
    meta,
    spec,
    pal,
    palName,
    power: spec.power ?? 1,
    windup,
    windupStyle,
    arch: ARCHETYPES[spec.archetype],
  };
}

// ---- shared building blocks -------------------------------------------------
function casterChest(out) {
  return out.copy(rig.group.position).add(tmpC.set(0, 1.55, 0));
}
function handMid(out) {
  rig.handL.getWorldPosition(tmpA);
  rig.handR.getWorldPosition(tmpB);
  out.copy(tmpA).add(tmpB).multiplyScalar(0.5);
  out.x += 0.3;
  return out;
}
function _focusPos(out) {
  // where the "impact" lands
  return ctx.self ? casterChest(out) : out.copy(dummy.hitPos);
}

// windup dispatch, six distinct charge-up languages
function windupFx(p, dt) {
  const st = ctx.windupStyle;
  const pal = ctx.pal;
  if (st === 'none') return;
  if (st === 'runes') {
    runeMesh.visible = true;
    placeRune();
    return windupCharge(p, dt, true);
  }
  if (st === 'orb') return windupCharge(p, dt, false);
  if (st === 'weapon') {
    // enchantment crawls up the weapon
    rig.handR.getWorldPosition(orbPos);
    orbPos.y += 0.15;
    orbShell.visible = false;
    orbCore.visible = orbHalo.visible = true;
    orbCore.position.copy(orbPos);
    orbCore.scale.setScalar(0.18 + p * 0.3);
    orbCore.material.color.copy(pal.core).multiplyScalar(HDR(2.4));
    orbCore.material.opacity = 0.3 + p * 0.6;
    orbHalo.position.copy(orbPos);
    orbHalo.scale.setScalar(0.6 + p * 1);
    orbHalo.material.color.copy(pal.glow).multiplyScalar(HDR(1.3));
    orbHalo.material.opacity = 0.15 + p * 0.3;
    chargeLight.position.copy(orbPos);
    chargeLight.color.copy(pal.main);
    chargeLight.intensity = 2 + easeInCubic(p) * 30;
    if (rnd() < dt * (8 + p * 26)) {
      // sparks climbing the blade
      sparkPool.spawn(
        orbPos.x + rr(-0.12, 0.12),
        orbPos.y + rr(-0.3, 0.15),
        orbPos.z + rr(-0.12, 0.12),
        rr(-0.2, 0.2),
        rr(0.5, 1.2),
        rr(-0.2, 0.2),
        rr(0.25, 0.45),
        pal.ion.r * HDR(2),
        pal.ion.g * HDR(2),
        pal.ion.b * HDR(2),
      );
    }
    if (rnd() < dt * p * 10) {
      const a = orbPos.clone(),
        b = orbPos.clone().add(new THREE.Vector3(rr(-0.5, 0.5), rr(-0.4, 0.5), rr(-0.5, 0.5)));
      spawnBoltFx({
        life: 0.07,
        flicker: 0.035,
        width: 0.02,
        hdr: 2.6,
        colCore: pal.core,
        colGlow: pal.main,
        gen: () => genBolt(a, b, { jag: 0.3, subdiv: 3, branchP: 0.1, depth: 0 }),
      });
    }
    return;
  }
  if (st === 'vortex') {
    // power spirals inward around the body
    casterChest(orbPos);
    const c = rig.group.position;
    const rate = 40 * (0.3 + p);
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && rnd() > n) break;
      n -= 1;
      const a = rnd() * Math.PI * 2;
      const R = rr(1.6, 2.6);
      const y = rr(0.1, 2.2);
      tmpA.set(c.x + Math.cos(a) * R, y, c.z + Math.sin(a) * R);
      // tangential + inward velocity = spiral
      tmpB
        .set(-Math.sin(a), 0.12, Math.cos(a))
        .multiplyScalar(3.2)
        .addScaledVector(tmpC.set(c.x - tmpA.x, 0, c.z - tmpA.z).normalize(), 2.2);
      emberPool.spawn(
        tmpA.x,
        tmpA.y,
        tmpA.z,
        tmpB.x,
        tmpB.y,
        tmpB.z,
        rr(0.35, 0.6),
        pal.ion.r * HDR(1.6),
        pal.ion.g * HDR(1.6),
        pal.ion.b * HDR(1.6),
      );
    }
    chargeLight.position.copy(orbPos);
    chargeLight.color.copy(pal.main);
    chargeLight.intensity = easeInCubic(p) * 34;
    return;
  }
  if (st === 'ascend') {
    // light gathers from above (holy/heals)
    casterChest(orbPos);
    const c = rig.group.position;
    if (rnd() < dt * (14 + p * 30)) {
      emberPool.spawn(
        c.x + rr(-0.7, 0.7),
        rr(2.8, 4),
        c.z + rr(-0.7, 0.7),
        rr(-0.05, 0.05),
        rr(-2.2, -1.4),
        rr(-0.05, 0.05),
        rr(0.7, 1.1),
        pal.ion.r * HDR(1.7),
        pal.ion.g * HDR(1.7),
        pal.ion.b * HDR(1.7),
      );
    }
    // held volumetric shaft, brightening with the cast (spec.shaft gates/scales it)
    const ascSc =
      ctx.spec.shaft === false ? 0 : typeof ctx.spec.shaft === 'number' ? ctx.spec.shaft : 1;
    if (!ctx.shaft && ascSc > 0)
      ctx.shaft = spawnShaft(new THREE.Vector3(c.x, 0, c.z), {
        radius: 1.15 * Math.max(0.4, ascSc),
        height: 7.5 * Math.max(0.5, ascSc),
        color: pal.glow,
        dur: Infinity,
        intensity: 0,
      });
    if (ctx.shaft)
      ctx.shaft.mat.uniforms.uIntensity.value = (0.25 + p * 0.85) * Math.min(1, ascSc + 0.3);
    orbCore.visible = true;
    orbShell.visible = orbHalo.visible = false;
    orbCore.position.copy(orbPos);
    orbCore.scale.setScalar(0.3 + p * 0.5);
    orbCore.material.color.copy(pal.core).multiplyScalar(HDR(2));
    orbCore.material.opacity = 0.2 + p * 0.6;
    chargeLight.position.set(c.x, 2.6, c.z);
    chargeLight.color.copy(pal.main);
    chargeLight.intensity = easeInCubic(p) * 40;
    return;
  }
  if (st === 'stance') {
    // grounded anticipation: dust, pebbles, late hand-glow
    const c = rig.group.position;
    if (rnd() < dt * 10) {
      emberPool.spawn(
        c.x + rr(-0.5, 0.5),
        0.08,
        c.z + rr(-0.5, 0.5),
        rr(-0.3, 0.3),
        rr(0.2, 0.6),
        rr(-0.3, 0.3),
        rr(0.3, 0.6),
        0.28,
        0.26,
        0.22,
      ); // dusty, not glowing
    }
    if (p > 0.45) windupHandGlow((p - 0.45) / 0.55, dt);
    return;
  }
}

function windupCharge(p, dt, full) {
  const pal = ctx.pal;
  orbVisible(true);
  handMid(orbPos);
  // authored beats: double-pulse at 50%, held breath at ~90% before release
  const beat = p > 0.48 && p < 0.56 ? Math.sin(((p - 0.48) / 0.08) * Math.PI) * 0.3 : 0;
  const breath = p > 0.86 && p < 0.965;
  if (breath !== ctx._breathSnd) {
    ctx._breathSnd = breath;
    sfx.bedBreath(breath);
  } // audio holds its breath too
  const orbScale = 0.34 * ctx.power;
  const orbR =
    orbScale *
    (0.25 + 0.75 * easeOutCubic(Math.min(p, breath ? 0.86 : 1))) *
    (1 + Math.sin(stateT * 31) * 0.06 * p * (breath ? 0.15 : 1) + beat);
  orbShell.position.copy(orbPos);
  orbShell.scale.setScalar(orbR);
  orbShellMat.uniforms.uIntensity.value = 0.5 + p * 1.3;
  orbShellMat.uniforms.uColor.value.copy(pal.main);
  orbCore.position.copy(orbPos);
  orbCore.scale.setScalar(orbR * (1.6 + p));
  orbCore.material.color.copy(pal.core).multiplyScalar(HDR(3));
  orbCore.material.opacity = 0.25 + p * 0.75;
  orbHalo.position.copy(orbPos);
  orbHalo.scale.setScalar(orbR * (4 + 3 * p));
  orbHalo.material.color.copy(pal.glow).multiplyScalar(HDR(1.4));
  orbHalo.material.opacity = 0.12 + p * 0.4;
  chargeLight.position.copy(orbPos);
  chargeLight.color.copy(pal.main);
  chargeLight.intensity =
    (3 + easeInCubic(p) * 58) * (breath ? 0.5 : 1) * (1 + beat) * (p > 0.965 ? 1.7 : 1);
  if (full) {
    runeDissolve = Math.max(0.1, 1 - easeOutCubic(clamp01(p * 2.2)) * 0.9);
    runeMat.uniforms.uDissolve.value = runeDissolve;
    runeMat.uniforms.uSpin.value = stateT * 0.45;
    runeMat.uniforms.uHdr.value = HDR(1.7 + p * 1.5);
    runeMat.uniforms.uColor.value.copy(pal.main);
  }
  // converge motes (the held breath silences them)
  const rate = 90 * (0.25 + p) * ctx.power * (full ? 1 : 0.4) * (breath ? 0.12 : 1);
  let n = rate * dt;
  while (n > 0) {
    if (n < 1 && rnd() > n) break;
    n -= 1;
    const a = rnd() * Math.PI * 2,
      e2 = rr(-0.6, 1.1);
    const R = rr(1.6, 2.8);
    tmpA.set(
      orbPos.x + Math.cos(a) * Math.cos(e2) * R,
      orbPos.y + Math.sin(e2) * R,
      orbPos.z + Math.sin(a) * Math.cos(e2) * R,
    );
    tmpB.copy(orbPos).sub(tmpA).normalize().multiplyScalar(rr(2.6, 4.2));
    emberPool.spawn(
      tmpA.x,
      tmpA.y,
      tmpA.z,
      tmpB.x,
      tmpB.y,
      tmpB.z,
      R / 3.4,
      ctx.pal.ion.r * HDR(1.5),
      ctx.pal.ion.g * HDR(1.5),
      ctx.pal.ion.b * HDR(1.5),
    );
  }
  if (full) {
    // risers off the circle + micro-arcs + ground arcs
    if (rnd() < dt * 26 * (0.3 + p)) {
      const a = rnd() * Math.PI * 2,
        R = rr(1.1, 2.05);
      riserPool.spawn(
        rig.group.position.x + Math.cos(a) * R,
        0.1,
        rig.group.position.z + Math.sin(a) * R,
        rr(-0.1, 0.1),
        rr(0.5, 1.3),
        rr(-0.1, 0.1),
        rr(0.7, 1.4),
        pal.main.r * HDR(1.4),
        pal.main.g * HDR(1.4),
        pal.main.b * HDR(1.4),
      );
    }
    if (rnd() < dt * (4 + p * 18)) {
      const p1 = orbPos
        .clone()
        .add(
          new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1))
            .normalize()
            .multiplyScalar(orbR * rr(0.8, 1.4)),
        );
      const p2 = orbPos
        .clone()
        .add(
          new THREE.Vector3(rr(-1, 1), rr(-1, 1), rr(-1, 1))
            .normalize()
            .multiplyScalar(orbR * rr(1.2, 2.6)),
        );
      spawnBoltFx({
        life: rr(0.06, 0.13),
        flicker: 0.03,
        width: 0.028,
        hdr: 2.8,
        colCore: pal.core,
        colGlow: pal.main,
        gen: () => genBolt(p1, p2, { jag: 0.34, subdiv: 3, branchP: 0.15, depth: 1 }),
      });
      if (sndOn && rnd() < 0.6) sfx.crackle();
    }
    groundArcTimer -= dt;
    if (groundArcTimer <= 0 && p > 0.25) {
      groundArcTimer = rr(0.12, 0.3) / (0.4 + p);
      const a = rnd() * Math.PI * 2;
      const start = new THREE.Vector3(
        rig.group.position.x + Math.cos(a) * rr(1.6, 2.05),
        0.05,
        rig.group.position.z + Math.sin(a) * rr(1.6, 2.05),
      );
      const end =
        rnd() < 0.5
          ? orbPos.clone()
          : new THREE.Vector3(
              rig.group.position.x + rr(-0.4, 0.4),
              rr(0.8, 1.6),
              rig.group.position.z + rr(-0.4, 0.4),
            );
      spawnBoltFx({
        life: rr(0.1, 0.18),
        flicker: 0.045,
        width: 0.04,
        hdr: 2.4,
        colCore: pal.core,
        colGlow: pal.main,
        gen: () => genBolt(start, end, { jag: 0.24, subdiv: 4, branchP: 0.2, depth: 1 }),
      });
    }
    if (ctx.palName === 'storm') {
      // storm anticipation is its own weather event
      // ionization streamers: the GROUND reaches up for the charge
      ctx.ionTimer = (ctx.ionTimer ?? 0) - dt;
      if (ctx.ionTimer <= 0 && p > 0.2) {
        ctx.ionTimer = rr(0.16, 0.3) / (0.3 + p);
        const ia = rnd() * Math.PI * 2,
          iR = rr(1.2, 2.0);
        const from = new THREE.Vector3(
          rig.group.position.x + Math.cos(ia) * iR,
          0.02,
          rig.group.position.z + Math.sin(ia) * iR,
        );
        const to = orbPos.clone();
        spawnBoltFx({
          life: 0.09,
          flicker: 0.04,
          width: 0.025,
          hdr: 2.2,
          colCore: pal.ion,
          colGlow: pal.main,
          gen: () => genBolt(from, to, { jag: 0.22, subdiv: 4, branchP: 0.15, depth: 0 }),
        });
      }
      if (p > 0.9 && !ctx.skyAnswered) {
        // held breath: the sky answers before the release
        ctx.skyAnswered = true;
        lightPulses.pulse(
          new THREE.Vector3(rig.group.position.x, 9, rig.group.position.z),
          pal.ion,
          260,
          0.4,
        );
        auroraFlash = Math.max(auroraFlash, 0.3);
      }
    }
  }
}

function hideOrb() {
  orbShell.visible = orbCore.visible = orbHalo.visible = false;
  chargeLight.intensity = 0;
}

function releaseFlashFx(scaleMul = 1) {
  const pal = ctx.pal;
  releaseFlash.position.copy(orbPos);
  releaseFlash.material.color.copy(pal.core).multiplyScalar(HDR(3.6));
  releaseFlash.visible = true;
  releaseFlash.userData.age = 0;
  releaseFlash.userData.scale = scaleMul;
  screenFlash(0.1);
  trauma = Math.max(trauma, 0.28);
  fovKick = 2.2 * ctx.power;
  lightPulses.pulse(orbPos, pal.core, 140 * ctx.power, 0.22);
  for (let i = 0; i < 5; i++) {
    const end = orbPos.clone().add(new THREE.Vector3(rr(-1.4, 1.4), rr(-0.9, 1.4), rr(-1.4, 1.4)));
    spawnBoltFx({
      life: 0.11,
      flicker: 0.035,
      width: 0.05,
      hdr: 3,
      colCore: pal.core,
      colGlow: pal.main,
      gen: () => genBolt(orbPos, end, { jag: 0.22, subdiv: 4, branchP: 0.2, depth: 1 }),
    });
  }
  burst(
    sparkPool,
    orbPos.x,
    orbPos.y,
    orbPos.z,
    Math.round(26 * ctx.power),
    7,
    0.5,
    pal.ion,
    HDR(2.2),
    0.25,
  );
}

function impactStack(pos, o = {}) {
  // spec-sculpted impact profile, the AUTHORED spec always wins over the
  // archetype's defaults (that's the whole point of per-ability identity)
  if (ctx.spec.impact) {
    const allowed = [
      'flipbook',
      'ring',
      'vRing',
      'sparks',
      'debris',
      'smoke',
      'light',
      'trail',
      'blood',
      'liteAudio',
      'sample',
    ]; // liteAudio: utility casts must not SOUND like cannon fire; sample: bespoke pack one-shot for marquee spells
    for (const k of allowed) if (ctx.spec.impact[k] !== undefined) o[k] = ctx.spec.impact[k];
  }
  if (o.scorch === undefined && ctx.spec.decal) o.scorch = true; // an authored decal implies ground wear
  const pal = ctx.pal;
  const style = PAL_STYLE[ctx.palName] ?? PAL_STYLE.physical;
  const critHit = isCrit && ctx.arch.canCrit;
  const critFinisher = critHit && (ctx.spec.finisher || ctx.power >= 1.3);
  const cs = (critHit ? 1.35 : 1) * ctx.power * (o.scale ?? 1);
  // crit finishers shift toward white-hot
  const hot = critFinisher ? 0.35 : critHit ? 0.15 : 0;
  const cMain = hot ? pal.main.clone().lerp(WHITE, hot) : pal.main;
  const cIon = hot ? pal.ion.clone().lerp(WHITE, hot) : pal.ion;
  const hdrBoost = critFinisher ? 1.3 : 1;
  if (o.flipbook !== false)
    spawnFlipbook(pos, 3.2 * cs, 0.5, HDR(1.25 * hdrBoost), cMain, style.sheet);
  if (o.ring !== false) {
    const rs = typeof o.ring === 'number' ? o.ring : 1; // numeric override scales the wavefront
    spawnRing(
      new THREE.Vector3(pos.x, 0.05, pos.z),
      4.6 * cs * rs,
      0.55,
      cMain,
      HDR(1.7 * hdrBoost),
    );
    setTimeoutSim(0.05, () =>
      spawnRing(new THREE.Vector3(pos.x, 0.05, pos.z), 2.8 * cs * rs, 0.45, pal.accent, HDR(1.3)),
    );
  }
  if (o.vRing !== false)
    spawnRing(
      pos.clone(),
      3.4 * cs * (typeof o.vRing === 'number' ? o.vRing : 1),
      0.4,
      cIon,
      HDR(1.2),
      true,
    );
  if (critFinisher) {
    // the death-sentence beat: second wave + white flash ring
    setTimeoutSim(0.12, () => {
      spawnRing(new THREE.Vector3(pos.x, 0.05, pos.z), 6 * cs, 0.6, pal.core, HDR(1.6));
      spawnRing(pos.clone(), 4.4 * cs, 0.5, WHITE, HDR(1.4), true);
    });
  }
  burst(
    sparkPool,
    pos.x,
    pos.y,
    pos.z,
    Math.round((o.sparks ?? 46) * cs),
    11 * cs,
    0.7,
    cIon,
    HDR(2.4 * hdrBoost),
    0.55,
  );
  burst(emberPool, pos.x, pos.y, pos.z, Math.round(18 * cs), 3.2, 1.1, cMain, HDR(1.6), 0.6);
  if (o.debris !== false) spawnDebris(style.debris, pos, pal, Math.round(10 * cs));
  // o.light ≤ 8 reads as a multiplier (authored specs), larger = absolute; capped
  // so no single impact nukes the exposure
  const lightAmt = o.light === undefined ? 260 : o.light <= 8 ? 260 * o.light : o.light;
  lightPulses.pulse(pos, cMain, Math.min(520, lightAmt * cs), 0.5);
  spawnRipple(pos, critFinisher ? 1.5 : 1); // screen-space shockwave
  caPulse(critFinisher ? 1 : 0.45); // lens flinches
  if (critFinisher) radialBurst(pos, 0.9); // trailer-grade radial blur
  spawnStreaks(pos, cIon, Math.round(9 * cs), 12 * cs); // velocity-smeared shrapnel
  spawnContactShadow(pos, 1.4 * cs);
  if (style.sheet === 'flame') heatAt(pos, 0.55); // lingering shimmer
  totemGlow = Math.max(totemGlow, 0.9); // the stage feels it
  impactFlash.position.copy(pos);
  impactFlash.material.color.copy(pal.core).multiplyScalar(HDR(3.2 * hdrBoost));
  impactFlash.visible = true;
  impactFlash.userData.age = 0;
  impactFlash.userData.mul = ctx.palName === 'storm' ? 0.8 : 1; // arcs, not halo, carry storm's silhouette
  if (o.scorch) {
    // an authored spec.decal overrides the palette's default ground language
    const decal =
      ctx.spec.decal === 'crack'
        ? 'crack'
        : ctx.spec.decal === 'scorch'
          ? 'char'
          : ctx.spec.decal === 'rune'
            ? 'rays'
            : style.decal;
    if (decal === 'char') {
      scorchDark.material.color.setHex(0x000000);
      scorchMax = 0.85;
    } else if (decal === 'rime') {
      scorchDark.material.color.setHex(0xcfe6ff);
      scorchMax = 0.3;
    } else {
      scorchMax = 0;
    }
    scorchDark.position.set(pos.x, 0.025, pos.z);
    crackMesh.position.set(pos.x, 0.035, pos.z);
    crackMat.uniforms.uMap.value =
      decal === 'rime' ? TEX.shards : decal === 'rays' ? TEX.rays : TEX.cracks;
    crackMat.uniforms.uColor.value.copy(pal.main);
    crackMesh.visible = true;
    scorchAlpha = 0.001;
    crackDissolve = 1;
    crackMat.uniforms.uHdr.value = HDR(2.2);
  }
  if (style.decal === 'rime' && !o.scorch && !ctx.self && ctx.spec.screenFx !== false)
    frostEdge(0.7); // screen frost kiss (spec can opt out)
  if (critFinisher) {
    hitstopLeft = 0.09;
    critSlowStart = perfNow + 0.09;
    critSlowUntil = critSlowStart + 0.7; // trailer speed-ramp window
  }
  // receiver feedback: body-conforming emissive, never the capsule shell (that
  // read as a debug collider, shells are reserved for true barrier specs)
  if (o.receiver === 'caster') {
    // drains: the energy arrives at the CASTER
    casterGlowV = Math.max(casterGlowV, 1.1 * cs);
    setRigGlow();
  } else if (ctx.self) {
    casterGlowV = Math.max(casterGlowV, 1.4 * cs);
    setRigGlow();
  } else {
    if (o.shell !== false) {
      targetGlow = 2.6 * cs;
      for (const m of dummy.mats) m.emissive.setHex(cMain.getHex());
    }
    dummyKick((0.85 + (critHit ? 0.45 : 0)) * Math.min(1.6, cs)); // the dummy rocks back
  }
  if (o.trail) spawnTrailArc(o.trail, pos, pal); // the weapon's crescent frozen at contact
  if (o.blood) spawnBloodFx(pos, cs); // bleeds BLEED: gashes, drips, a spreading pool
  if (comboOn) {
    // stacked damage accumulates: every combo hit leaves the dummy visibly worse
    comboWear = Math.min(1, comboWear + 0.22);
    if (lastResiduePal === 'frost' && ctx.palName === 'fire') {
      // fire flash-melts the rime
      spawnSmoke(pos, 12, 0xe8eef2);
      spawnRing(pos.clone(), 3.6, 0.5, WHITE, HDR(1.3), true);
      screenFlash(0.22);
      scorchDark.material.color.setHex(0x000000);
      scorchMax = 0.85; // rime → char
      lastResiduePal = null;
      sfx.noise2({
        dur: 0.7,
        freq: 3200,
        sweep: 500,
        gain: 0.3,
        type: 'bandpass',
        q: 1.2,
        pan: panOf(pos.x),
      }); // steam hiss
    }
  }
  // momentary elemental grade shift + anime impact frames on crit finishers
  const G = {
    flame: [1.18, 0.98, 0.85, 0.5],
    shatter: [0.85, 0.96, 1.2, 0.5],
    radiance: [1.15, 1.08, 0.9, 0.45],
    void: [0.95, 0.88, 1.12, 0.5],
    verdant: [0.95, 1.1, 0.92, 0.4],
    electric: [0.95, 1.02, 1.15, 0.4],
  }[style.sheet];
  gradePulse(G[0], G[1], G[2], G[3] * (o.flash ?? 1));
  if (critFinisher) impactFrames = 2;
  screenFlash((isCrit && ctx.arch.canCrit ? 0.35 : 0.22) * (o.flash ?? 1));
  trauma = Math.max(trauma, (isCrit && ctx.arch.canCrit ? 0.62 : 0.45) * (o.shake ?? 1));
  if (o.kick !== false)
    addKick(projDir, (isCrit && ctx.arch.canCrit ? 1.8 : 1) * 0.16 * (o.shake ?? 1));
  if (critHit && o.hitstop !== false && !critFinisher) hitstopLeft = Math.max(hitstopLeft, 0.06); // finisher owns its own ramp
  if (o.crawlArcs) {
    for (let i = 0; i < 6; i++) {
      setTimeoutSim(rr(0, 0.12), () => {
        const a1 = randomOnDummy(),
          a2 = randomOnDummy();
        spawnBoltFx({
          life: rr(0.14, 0.3),
          flicker: 0.04,
          width: 0.045,
          hdr: 2.6,
          colCore: pal.core,
          colGlow: pal.main,
          gen: () => genBolt(a1, a2, { jag: 0.3, subdiv: 4, branchP: 0.25, depth: 1 }),
        });
      });
    }
    // magnetized debris: chunks levitate on the charge, tethered to the ground
    // by hair-thin strands for a beat
    for (let i = 0; i < 5; i++) {
      const dx = pos.x + rr(-0.9, 0.9),
        dz = pos.z + rr(-0.9, 0.9);
      emberPool.spawn(
        dx,
        0.15,
        dz,
        rr(-0.05, 0.05),
        rr(0.4, 0.7),
        rr(-0.05, 0.05),
        rr(0.7, 1.1),
        pal.ion.r * HDR(1.4),
        pal.ion.g * HDR(1.4),
        pal.ion.b * HDR(1.4),
      );
      if (i < 3) {
        setTimeoutSim(rr(0.08, 0.3), () => {
          const g0 = new THREE.Vector3(dx, 0.02, dz);
          const g1 = new THREE.Vector3(dx + rr(-0.1, 0.1), rr(0.4, 0.9), dz + rr(-0.1, 0.1));
          spawnBoltFx({
            life: 0.07,
            flicker: 0.03,
            width: 0.015,
            hdr: 2.2,
            colCore: pal.ion,
            colGlow: pal.main,
            gen: () => genBolt(g0, g1, { jag: 0.25, subdiv: 3, branchP: 0, depth: 0 }),
          });
        });
      }
    }
  }
  if (o.smoke !== false) spawnSmoke(pos, 5, pal.smoke.getHex());
  sfx.impact(ctx.palName, {
    pan: panOf(pos.x),
    scale: cs,
    crit: critHit,
    finisher: critFinisher,
    lite: o.liteAudio === true && !critFinisher,
    sample: o.sample,
  });
}

function randomOnDummy() {
  const y = rr(0.3, 2.5);
  const r = y > 1.6 && y < 2.05 ? rr(0.2, 0.85) : rr(0.18, 0.34);
  const a = rnd() * Math.PI * 2;
  return new THREE.Vector3(TARGET_POS.x + Math.cos(a) * r, y, TARGET_POS.z + Math.sin(a) * r);
}

// caster body glow color: authored rim wins, else the school's main
function setRigGlow() {
  if (!ctx) return;
  if (ctx.spec.rim) rigGlowColor.set(ctx.spec.rim);
  else rigGlowColor.copy(ctx.pal.main);
}

// weapon-trail crescents, any archetype can stamp the swing that just happened
function spawnTrailArc(style, hp, pal) {
  const mk = (a, b, bow, w = 0.16, up = 0) => {
    const pts = smoothArc(a, b, bow, 14, up);
    spawnBoltFx({
      life: 0.7,
      flicker: 0.3,
      width: w,
      glowWidth: 0.5,
      hdr: 2.8,
      colCore: pal.core,
      colGlow: pal.main,
      curve: (t) => (t < 0.06 ? t / 0.06 : (1 - (t - 0.06) / 0.94) ** 1.1), // holds long enough to OWN the money shot
      gen: () => [{ pts, intensity: 1 }],
    });
  };
  const V = (x, y, z) => hp.clone().add(new THREE.Vector3(x, y, z));
  if (style === 'overhead') mk(V(-0.5, 1.5, rr(-0.15, 0.15)), V(0.25, -1.0, rr(-0.15, 0.15)), 0.35);
  else if (style === 'low') mk(V(-0.8, -1.05, -0.7), V(-0.8, -1.15, 0.7), 0.5);
  else if (style === 'riposte')
    mk(V(0.2, -0.95, rr(-0.25, 0.25)), V(-0.45, 1.35, rr(-0.25, 0.25)), 0.45);
  else if (style === 'x') {
    mk(V(-0.6, 1.1, -0.55), V(0.2, -0.8, 0.55), 0.3, 0.13);
    setTimeoutSim(0.07, () => mk(V(-0.6, 1.1, 0.55), V(0.2, -0.8, -0.55), -0.3, 0.13));
  } else if (style === 'sweep') mk(V(-0.6, 0.55, -1.5), V(-0.6, 0.35, 1.5), 0.9, 0.2);
  else mk(V(-0.65, 1.15, -0.45), V(0.15, -0.7, 0.5), 0.55); // 'arc': diagonal slash
}

// the bleed language: lingering gashes, falling drips, a spreading dark pool
function spawnBloodFx(pos, cs) {
  const bp = PALETTES.blood;
  for (const off of [-0.28, 0, 0.28]) {
    const a = pos.clone().add(new THREE.Vector3(-0.4, 0.55 + off, -0.15 + off));
    const b = pos.clone().add(new THREE.Vector3(0.25, -0.5 + off, 0.2 + off));
    const pts = smoothArc(a, b, 0.12, 8, 0);
    spawnBoltFx({
      life: 1.1,
      flicker: 0.5,
      width: 0.07,
      glowWidth: 0.18,
      hdr: 1.5,
      colCore: bp.main,
      colGlow: bp.glow,
      curve: (t) => (t < 0.1 ? t / 0.1 : (1 - (t - 0.1) / 0.9) ** 0.7),
      gen: () => [{ pts, intensity: 1 }],
    });
  }
  spawnDrips(pos, bp, Math.min(3.5, 2.2 * cs), 'fall', 12);
  scorchDark.material.color.setHex(0x2a060a); // the pool spreads dark, not black
  scorchMax = Math.max(scorchMax, 0.55);
  scorchDark.position.set(pos.x, 0.025, pos.z);
  scorchAlpha = Math.max(scorchAlpha, 0.001);
}

function fireFinisher() {
  const pal = ctx.pal;
  const hp = dummy.hitPos;
  const top = new THREE.Vector3(hp.x + rr(-1.5, 1.5), 26, hp.z + rr(-1.5, 1.5));
  spawnBoltFx({
    life: 0.38,
    flicker: 0.055,
    width: 0.3,
    glowWidth: 1.15,
    hdr: 4.4,
    colCore: pal.core,
    colGlow: pal.accent,
    curve: (t) => (t < 0.12 ? 1 : (1 - (t - 0.12) / 0.88) ** 1.6),
    gen: () =>
      genBolt(top, hp, { jag: 0.09, subdiv: 6, branchP: 0.42, depth: 2, branchScale: 0.3 }),
  });
  spawnRing(new THREE.Vector3(hp.x, 0.06, hp.z), 7, 0.7, pal.accent, HDR(1.5));
  spawnRing(hp.clone(), 5, 0.55, pal.core, HDR(1.2), true);
  spawnShaft(new THREE.Vector3(hp.x, 0, hp.z), {
    radius: 1,
    height: 15,
    color: pal.accent,
    dur: 0.5,
    intensity: 1,
  });
  spawnRipple(hp, 1.4);
  burst(sparkPool, hp.x, hp.y, hp.z, 40, 14, 0.8, pal.core, HDR(2.6), 0.7);
  lightPulses.pulse(new THREE.Vector3(hp.x, 6, hp.z), pal.accent, 420, 0.6);
  screenFlash(0.5);
  trauma = Math.max(trauma, 0.75);
  targetGlow = Math.max(targetGlow, 3.2);
  shellGlow = Math.max(shellGlow, 2);
  auroraFlash = 1; // the sky itself answers the thunderclap
  radialBurst(hp, 1);
  sfx.thunder(panOf(hp.x));
  // restrikes down the same channel, real lightning strikes twice, then again
  for (const [delay, w, hd] of [
    [0.14, 0.18, 3.2],
    [0.32, 0.1, 2.4],
  ]) {
    setTimeoutSim(delay, () => {
      if (!ctx) return;
      spawnBoltFx({
        life: 0.14,
        flicker: 0.04,
        width: w,
        glowWidth: w * 3.2,
        hdr: hd,
        colCore: pal.core,
        colGlow: pal.accent,
        gen: () => genBolt(top, hp, { jag: 0.07, subdiv: 5, branchP: 0.25, depth: 1 }),
      });
      lightPulses.pulse(new THREE.Vector3(hp.x, 5, hp.z), pal.accent, 200, 0.3);
      sfx.noise2({ dur: 0.5, freq: 420, gain: 0.3, pan: panOf(hp.x), verb: 0.35 });
      sfx.sub({ from: 48, to: 26, dur: 0.5, gain: 0.3, pan: panOf(hp.x) });
    });
  }
}

// ---- archetypes ------------------------------------------------------------
// Each: { melee?, canCrit?, aftermathDur, begin(), windup(p,dt), release(),
//         travel: null | {tick(dt)->bool done}, impact(), aftermath(p,dt) }
const ARCHETYPES = {
  bolt: {
    canCrit: true,
    aftermathDur: 2.2,
    begin() {
      sfx.chargeStart(ctx.windup / (slowMo ? 0.25 : userTimeScale));
      rig.play('Spellcasting', { fade: 0.25 });
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      rig.play(rig.cls === 'hunter' ? '2H_Ranged_Shoot' : 'Spellcast_Shoot', {
        loop: false,
        fade: 0.08,
        timeScale: 1.35,
      });
      handMid(orbPos);
      projPos.copy(orbPos);
      projDir.copy(dummy.hitPos).sub(projPos).normalize();
      trailHist.length = 0;
      // per-ability projectile silhouette
      const pStyle =
        ctx.spec.bolt?.style ??
        (ctx.cls === 'hunter' ? 'arrow' : (PROJ_DEFAULT[ctx.palName] ?? 'comet'));
      clearProjMesh();
      if (pStyle !== 'comet') projMesh = buildProjMesh(pStyle, ctx.pal);
      ctx.projStyle = pStyle;
      ctx.tracerFrom = orbPos.clone();
      releaseFlashFx();
      if (ctx.spec.bolt?.leader) {
        // real lightning: a dim leader finds the path, the return stroke ANSWERS
        const lFrom = orbPos.clone(),
          lTo = dummy.hitPos.clone();
        spawnBoltFx({
          life: 0.07,
          flicker: 0.03,
          width: 0.035,
          hdr: 1.6,
          colCore: ctx.pal.ion,
          colGlow: ctx.pal.main,
          gen: () => genBolt(lFrom, lTo, { jag: 0.18, subdiv: 5, branchP: 0.35, depth: 1 }),
        });
        setTimeoutSim(0.08, () => {
          if (!ctx) return;
          spawnBoltFx({
            life: 0.16,
            flicker: 0.05,
            width: 0.22,
            glowWidth: 1.0,
            hdr: 4.0,
            colCore: ctx.pal.core,
            colGlow: ctx.pal.accent,
            curve: (t) => (1 - t) ** 1.4,
            gen: () => genBolt(lFrom, lTo, { jag: 0.12, subdiv: 5, branchP: 0.3, depth: 1 }),
          });
          screenFlash(0.3);
          lightPulses.pulse(lFrom, ctx.pal.core, 320, 0.3);
        });
      }
      const volley = ctx.spec.bolt?.volley ?? 0; // staggered barrage riding behind the lead projectile
      for (let i = 1; i < volley; i++) {
        setTimeoutSim(i * 0.12, () => {
          if (!ctx || !rig) return;
          const from = handMid(new THREE.Vector3()).add(
            new THREE.Vector3(0, rr(-0.15, 0.2), rr(-0.3, 0.3)),
          );
          const to = dummy.hitPos.clone().add(new THREE.Vector3(0, rr(-0.35, 0.4), rr(-0.5, 0.5)));
          const pts = smoothArc(from, to, rr(-0.5, 0.5), 16, rr(0.1, 0.5));
          spawnBoltFx({
            life: 0.22,
            flicker: 0.05,
            width: 0.06,
            glowWidth: 0.2,
            hdr: 2.6,
            colCore: ctx.pal.core,
            colGlow: ctx.pal.main,
            curve: (t) => (1 - t) ** 1.1,
            gen: () => [{ pts, intensity: 1 }],
          });
          setTimeoutSim(0.18, () => {
            if (!ctx) return;
            burst(sparkPool, to.x, to.y, to.z, 8, 5, 0.4, ctx.pal.ion, HDR(2), 0.4);
            lightPulses.pulse(to, ctx.pal.main, 80, 0.2);
            sfx.impact(ctx.palName, { pan: panOf(to.x), scale: 0.4, lite: true });
          });
        });
      }
      sfx.bedStop();
      sfx.release(ctx.palName, panOf(orbPos.x));
      sfx.travelStart(ctx.palName);
      hideOrbSoon();
    },
    travel: {
      tick(dt) {
        const b = ctx.spec.bolt ?? {};
        const speed = b.speed ?? 26;
        const step = speed * dt;
        tmpA.copy(dummy.hitPos).sub(projPos);
        const dist = tmpA.length();
        if (dist <= Math.max(0.5, step)) return true;
        tmpA.normalize();
        projDir.lerp(tmpA, 0.4).normalize();
        projPos.addScaledVector(projDir, step);
        trailHist.unshift(projPos.clone());
        if (trailHist.length > 14) trailHist.pop();
        const pal = ctx.pal;
        if (b.jagged) {
          // flicker-cached: regen the tree ~every 0.03s, translate it with the
          // head in between (same trick as the beam cache, zero per-frame allocs)
          ctx.trailFlick = (ctx.trailFlick ?? 0) - dt;
          if (!ctx.trailCache || ctx.trailFlick <= 0) {
            ctx.trailFlick = 0.03;
            const tail = projPos.clone().addScaledVector(projDir, -Math.min(4.0, dist * 0.5 + 1.0));
            ctx.trailCache = genBolt(tail, projPos, {
              jag: 0.12,
              subdiv: 4,
              branchP: 0.3,
              depth: 1,
            });
            ctx.trailAnchor = (ctx.trailAnchor ?? new THREE.Vector3()).copy(projPos);
          } else {
            tmpB.copy(projPos).sub(ctx.trailAnchor);
            if (tmpB.lengthSq() > 1e-9) {
              for (const line of ctx.trailCache) for (const p of line.pts) p.add(tmpB);
              ctx.trailAnchor.copy(projPos);
            }
          }
          for (const line of ctx.trailCache) {
            ribbons.add(line.pts, 0.34 * line.intensity, pal.main, HDR(1.4) * line.intensity, 1);
            ribbons.add(line.pts, 0.1 * line.intensity, pal.core, HDR(3.0) * line.intensity, 1);
          }
        }
        if (b.coils) {
          coilPhase += dt * 9 * Math.PI * 2;
          for (const dir of [1, -1]) {
            const pts = [];
            for (let k = 0; k < 14; k++) {
              const u = k / 13;
              const ang = coilPhase * dir + u * 7.5 * dir;
              tmpB.copy(projPos).addScaledVector(projDir, -u * 1.9);
              tmpC.set(0, 1, 0).cross(projDir).normalize();
              const up = tmpA.copy(projDir).cross(tmpC).normalize();
              const r = 0.3 * (1 - u * 0.5); // reads at showcase distance
              tmpB.addScaledVector(tmpC, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r);
              pts.push(tmpB.clone());
            }
            ribbons.add(pts, 0.08, pal.ion, HDR(2.2), 0.6, 0.5);
          }
        }
        if (sndOn && ctx.palName === 'storm' && rnd() < dt * 8) sfx.crackle(); // charged air spits
        if (trailHist.length > 3) ribbons.add(trailHist, 0.5, pal.glow, HDR(1.1), 0.85, 0.8);
        if (ctx.palName === 'fire' || ctx.palName === 'blood') heatFollow(() => projPos, 0.13, 0.9);
        updateProjMesh(dt);
        const hs =
          (b.headScale ?? 1) *
          ctx.power *
          (ctx.projStyle === 'arrow' ? 0.35 : ctx.projStyle && ctx.projStyle !== 'comet' ? 0.7 : 1);
        const pulse = 1 + Math.sin(perfNow * 40) * 0.12;
        headCore.visible = headHalo.visible = true;
        headCore.position.copy(projPos);
        headHalo.position.copy(projPos);
        headCore.material.color.copy(pal.core).multiplyScalar(HDR(3.4));
        headHalo.material.color.copy(pal.main).multiplyScalar(HDR(1.5));
        headCore.scale.setScalar(0.55 * pulse * hs);
        headHalo.scale.setScalar(1.7 * pulse * hs);
        projLight.position.copy(projPos);
        projLight.color.copy(pal.main);
        projLight.intensity = 42;
        if (rnd() < dt * 60) {
          sparkPool.spawn(
            projPos.x,
            projPos.y,
            projPos.z,
            rr(-1.5, 1.5),
            rr(-0.5, 1.5),
            rr(-1.5, 1.5),
            rr(0.25, 0.5),
            pal.ion.r * HDR(2),
            pal.ion.g * HDR(2),
            pal.ion.b * HDR(2),
          );
        }
        const fe = b.forkEvery ?? 0;
        if (fe > 0) {
          forkTimer -= dt;
          if (forkTimer <= 0) {
            forkTimer = fe * rr(0.7, 1.5);
            const from = projPos.clone();
            const to = new THREE.Vector3(projPos.x + rr(-1, 2.5), 0.04, projPos.z + rr(-2, 2));
            spawnBoltFx({
              life: rr(0.08, 0.14),
              flicker: 0.04,
              width: 0.09,
              hdr: 2.2,
              colCore: pal.core,
              colGlow: pal.main,
              gen: () => genBolt(from, to, { jag: 0.2, subdiv: 4, branchP: 0.25, depth: 1 }),
            });
            lightPulses.pulse(to, pal.main, 60, 0.18);
            // each ground-fork leaves evidence: a spit of sparks at the strike point
            burst(sparkPool, to.x, 0.08, to.z, 4, 3, 0.35, pal.ion, HDR(2), 0.6);
          }
        }
        return false;
      },
    },
    impact() {
      headCore.visible = headHalo.visible = false;
      clearProjMesh();
      ctx.trailCache = null;
      sfx.sizzleStop();
      if (ctx.spec.bolt?.tracer && ctx.tracerFrom) {
        // the shot's path stays etched in the air
        const tFrom = ctx.tracerFrom.clone(),
          tTo = dummy.hitPos.clone();
        spawnBoltFx({
          life: 0.9,
          flicker: 0.35,
          width: 0.05,
          glowWidth: 0.16,
          hdr: 2.4,
          colCore: ctx.pal.core,
          colGlow: ctx.pal.ion,
          curve: (t) => (1 - t) ** 0.8,
          gen: () => [{ pts: smoothArc(tFrom, tTo, 0.02, 10, 0), intensity: 1 }],
        });
      }
      impactStack(dummy.hitPos, { scorch: true, crawlArcs: ctx.pal.sfx === 'zap' });
      applyResidual(); // ignite/rime/etc, spec.dot or linger holds on the target
      if (ctx.spec.finisher && finisherOn) {
        finisherFired = false;
        finisherTimer = 0;
      } else finisherFired = true;
    },
    aftermath(_p, dt) {
      standardAftermath(dt, true);
    },
  },

  burst: {
    canCrit: true,
    aftermathDur: 1.9,
    begin() {
      rig.play('Spellcasting', { fade: 0.2 });
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      const style = ctx.spec.burst?.style ?? 'link';
      rig.play(style === 'skybeam' ? 'Spellcast_Raise' : 'Spellcast_Shoot', {
        loop: false,
        fade: 0.08,
        timeScale: 1.4,
      });
      handMid(orbPos);
      projDir.copy(dummy.hitPos).sub(orbPos).normalize();
      releaseFlashFx(0.8);
      hideOrbSoon();
      if (style === 'link') {
        // instantaneous zap link
        const from = orbPos.clone(),
          to = dummy.hitPos.clone();
        spawnBoltFx({
          life: 0.12,
          flicker: 0.04,
          width: 0.06,
          hdr: 2.6,
          colCore: ctx.pal.core,
          colGlow: ctx.pal.main,
          gen: () => genBolt(from, to, { jag: 0.08, subdiv: 5, branchP: 0.12, depth: 1 }),
        });
      }
    },
    travel: {
      tick(_dt) {
        return stateT >= (ctx.spec.burst?.style === 'skybeam' ? 0.22 : 0.12);
      },
    },
    impact() {
      const style = ctx.spec.burst?.style ?? 'link';
      const pal = ctx.pal;
      const hp = dummy.hitPos;
      if (style === 'skybeam') {
        // column of judgement from the sky, spec.shaft slims it so the subject
        // inside stays readable (the verdict, not the wall of light, is the shot)
        const sbSc =
          ctx.spec.shaft === false ? 0 : typeof ctx.spec.shaft === 'number' ? ctx.spec.shaft : 1;
        if (sbSc > 0)
          spawnShaft(new THREE.Vector3(hp.x, 0, hp.z), {
            radius: 1.35 * sbSc,
            height: 14,
            color: pal.main,
            dur: 0.65,
            intensity: 1.2 * Math.min(1, sbSc + 0.2),
          });
        const top = new THREE.Vector3(hp.x, 14, hp.z);
        spawnBoltFx({
          life: 0.5,
          flicker: 0.12,
          width: 0.34,
          glowWidth: 1.5,
          hdr: 2.6,
          colCore: pal.core,
          colGlow: pal.main,
          curve: (t) => (t < 0.15 ? 1 : (1 - (t - 0.15) / 0.85) ** 1.5),
          gen: () => [{ pts: smoothArc(top, hp.clone(), 0.02, 10, 0), intensity: 1 }],
        });
        spawnBoltFx({
          life: 0.4,
          flicker: 0.08,
          width: 0.1,
          hdr: 3.4,
          colCore: pal.core,
          colGlow: pal.accent,
          gen: () => genBolt(top, hp, { jag: 0.02, subdiv: 4, branchP: 0.08, depth: 1 }),
        });
        lightPulses.pulse(new THREE.Vector3(hp.x, 5, hp.z), pal.main, 300, 0.55);
        impactStack(hp, { scale: 0.9, vRing: false, scorch: false, smoke: false });
      } else if (style === 'ground') {
        // eruption from beneath the target
        for (let i = 0; i < 4; i++) {
          const from = new THREE.Vector3(hp.x + rr(-0.5, 0.5), 0.02, hp.z + rr(-0.5, 0.5));
          const to = new THREE.Vector3(hp.x + rr(-0.4, 0.4), rr(1.8, 2.8), hp.z + rr(-0.4, 0.4));
          spawnBoltFx({
            life: rr(0.2, 0.32),
            flicker: 0.05,
            width: 0.09,
            hdr: 2.6,
            colCore: pal.core,
            colGlow: pal.main,
            gen: () => genBolt(from, to, { jag: 0.16, subdiv: 4, branchP: 0.25, depth: 1 }),
          });
        }
        burst(riserPool, hp.x, 0.2, hp.z, 20, 2.6, 1, pal.ion, HDR(1.9), 1.1);
        impactStack(hp, { scale: 0.85, vRing: false, scorch: true, flipbook: false });
      } else {
        impactStack(hp, { scale: 0.85, scorch: false });
      }
      applyResidual();
    },
    aftermath(_p, dt) {
      standardAftermath(dt, false);
    },
  },

  strike: {
    melee: true,
    canCrit: true,
    aftermathDur: 1.6,
    begin() {
      rig.play('Idle');
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      const name = rig.attacks[Math.floor(rnd() * rig.attacks.length)];
      rig.play(name, { loop: false, fade: 0.06, timeScale: 1.3 });
      ctx.contactAt = Math.max(0.08, (rig.clipDur(name) * (CONTACT_FRAC[name] ?? 0.35)) / 1.3);
      handMid(orbPos);
      projDir.copy(dummy.hitPos).sub(orbPos).normalize();
      sfx.whoosh(panOf(rig.group.position.x), (ctx.spec.strike?.swings ?? 1) > 1); // swing whoosh
    },
    travel: {
      tick(_dt) {
        return stateT >= (ctx.contactAt ?? 0.2);
      },
    }, // blade-contact frame
    impact() {
      const pal = ctx.pal;
      const hp = dummy.hitPos;
      const st = ctx.spec.strike ?? {};
      const arc = st.arc ?? 'horizontal';
      // slash ribbon by orientation, no two strikes in a kit should share one
      let a,
        b,
        bow = 0.8,
        up = 0;
      if (arc === 'vertical') {
        // overhead chop
        a = hp.clone().add(new THREE.Vector3(-0.5, 1.25, rr(-0.2, 0.2)));
        b = hp.clone().add(new THREE.Vector3(0.15, -0.95, rr(-0.2, 0.2)));
        bow = 0.35;
      } else if (arc === 'uppercut') {
        // rising cut, kicks skyward
        a = hp.clone().add(new THREE.Vector3(0.2, -0.9, rr(-0.3, 0.3)));
        b = hp.clone().add(new THREE.Vector3(-0.4, 1.3, rr(-0.3, 0.3)));
        bow = 0.45;
        addKick(new THREE.Vector3(0, 1, 0), 0.14);
      } else if (arc === 'thrust') {
        // straight lunge through the target
        a = hp.clone().add(new THREE.Vector3(-1.6, rr(-0.1, 0.1), rr(-0.1, 0.1)));
        b = hp.clone().add(new THREE.Vector3(0.7, rr(-0.1, 0.1), rr(-0.1, 0.1)));
        bow = 0.05;
      } else if (arc === 'claws') {
        // three parallel raking gashes
        for (const off of [-0.3, 0, 0.3]) {
          const ca = hp.clone().add(new THREE.Vector3(-0.55, 1.0, -0.5 + off));
          const cb = hp.clone().add(new THREE.Vector3(0.1, -0.7, 0.4 + off));
          const pts = smoothArc(ca, cb, 0.25, 10, 0);
          spawnBoltFx({
            life: 0.22,
            flicker: 0.11,
            width: 0.11,
            glowWidth: 0.34,
            hdr: 2.6,
            colCore: pal.core,
            colGlow: pal.main,
            curve: (t) => (1 - t) ** 1.3,
            gen: () => [{ pts, intensity: 1 }],
          });
        }
      } else if (arc === 'bite') {
        // jaws snapping shut
        const top = smoothArc(
          hp.clone().add(new THREE.Vector3(-0.75, 1.15, 0)),
          hp.clone().add(new THREE.Vector3(0.65, 0.15, 0)),
          0.45,
          10,
          0,
        );
        const bot = smoothArc(
          hp.clone().add(new THREE.Vector3(-0.75, -0.95, 0)),
          hp.clone().add(new THREE.Vector3(0.65, -0.05, 0)),
          -0.45,
          10,
          0,
        );
        for (const pts of [top, bot]) {
          spawnBoltFx({
            life: 0.2,
            flicker: 0.1,
            width: 0.15,
            glowWidth: 0.42,
            hdr: 2.7,
            colCore: pal.core,
            colGlow: pal.main,
            curve: (t) => (1 - t) ** 1.5,
            gen: () => [{ pts, intensity: 1 }],
          });
        }
        addKick(new THREE.Vector3(0, -0.6, 0), 0.1); // jaw clamp
      } else {
        // horizontal sweep
        const tilt = rr(-0.4, 0.4);
        a = hp.clone().add(new THREE.Vector3(-0.7, 0.35 + tilt, -0.85));
        b = hp.clone().add(new THREE.Vector3(-0.7, 0.1 + tilt, 0.85));
      }
      if (a) {
        // single-ribbon arcs (claws/bite draw their own)
        const arcPts = smoothArc(a, b, bow, 14, up);
        spawnBoltFx({
          life: 0.38,
          flicker: 0.16,
          width: arc === 'thrust' ? 0.1 : 0.16,
          glowWidth: 0.5,
          hdr: 2.8,
          colCore: pal.core,
          colGlow: pal.main,
          curve: (t) => (1 - t) ** 1.2,
          gen: () => [{ pts: arcPts, intensity: 1 }],
        });
      }
      rig.hold(0.11); // body bites on contact
      impactStack(hp, {
        scale: 0.8,
        flipbook: true,
        ring: !!st.groundSlam,
        vRing: false,
        sparks: 26,
        scorch: !!st.groundSlam,
        smoke: false,
      });
      if (st.groundSlam) {
        trauma = Math.max(trauma, 0.55);
        spawnRing(new THREE.Vector3(hp.x, 0.05, hp.z), 4.2 * ctx.power, 0.5, pal.main, HDR(1.6));
      }
      if (st.stars || ctx.spec.cc?.style === 'stars')
        spawnOrbitStars(new THREE.Vector3(hp.x, 2.55, hp.z), pal, 1.4);
      if (st.bleed) startBurn(pal, 2.6, 'fall'); // wound keeps weeping
      const swings = st.swings ?? 1;
      if (swings > 1) {
        setTimeoutSim(0.22, () => {
          rig.play(rig.attacks[Math.floor(rnd() * rig.attacks.length)], {
            loop: false,
            fade: 0.05,
            timeScale: 1.4,
          });
          setTimeoutSim(0.16, () =>
            impactStack(hp, {
              scale: 0.7,
              ring: false,
              vRing: false,
              sparks: 20,
              scorch: false,
              smoke: false,
            }),
          );
        });
      }
    },
    aftermath(_p, dt) {
      standardAftermath(dt, false);
    },
  },

  nova: {
    canCrit: true,
    aftermathDur: 2.0,
    centered: true,
    begin() {
      rig.play('Spellcasting', { fade: 0.15 });
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      rig.play('Spellcast_Raise', { loop: false, fade: 0.08, timeScale: 1.3 });
      casterChest(orbPos);
      projDir.set(0, -1, 0);
      releaseFlashFx(0.9);
      hideOrbSoon();
    },
    travel: {
      tick(_dt) {
        return stateT >= 0.1;
      },
    },
    impact() {
      const pal = ctx.pal;
      const c = ctx.novaCenter ?? rig.group.position; // combo beats can detonate ON the victim
      const radius = (ctx.spec.nova?.radius ?? 5) * ctx.power;
      const center = new THREE.Vector3(c.x, 0.05, c.z);
      spawnRing(center.clone(), radius, 0.6, pal.main, HDR(1.8));
      setTimeoutSim(0.06, () =>
        spawnRing(center.clone(), radius * 0.65, 0.5, pal.accent, HDR(1.4)),
      );
      spawnRing(new THREE.Vector3(c.x, 1.4, c.z), radius * 0.8, 0.45, pal.ion, HDR(1.2), true);
      // radial ground bolts
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + rr(-0.2, 0.2);
        const from = new THREE.Vector3(c.x, 0.35, c.z);
        const to = new THREE.Vector3(
          c.x + Math.cos(a) * radius * rr(0.7, 1),
          0.05,
          c.z + Math.sin(a) * radius * rr(0.7, 1),
        );
        spawnBoltFx({
          life: rr(0.14, 0.24),
          flicker: 0.05,
          width: 0.07,
          hdr: 2.4,
          colCore: pal.core,
          colGlow: pal.main,
          gen: () => genBolt(from, to, { jag: 0.16, subdiv: 4, branchP: 0.2, depth: 1 }),
        });
      }
      // ring of risers
      for (let i = 0; i < 22; i++) {
        const a = rnd() * Math.PI * 2,
          R = rr(0.5, radius * 0.9);
        riserPool.spawn(
          c.x + Math.cos(a) * R,
          0.15,
          c.z + Math.sin(a) * R,
          rr(-0.1, 0.1),
          rr(1, 2.4),
          rr(-0.1, 0.1),
          rr(0.5, 1),
          pal.ion.r * HDR(1.8),
          pal.ion.g * HDR(1.8),
          pal.ion.b * HDR(1.8),
        );
      }
      lightPulses.pulse(new THREE.Vector3(c.x, 1.5, c.z), pal.main, 300 * ctx.power, 0.5);
      screenFlash(0.24);
      trauma = Math.max(trauma, 0.5);
      // novas etch the ground in their OWN school's decal, never a leftover's
      const nStyle = PAL_STYLE[ctx.palName] ?? PAL_STYLE.physical;
      crackMat.uniforms.uMap.value =
        nStyle.decal === 'rime' ? TEX.shards : nStyle.decal === 'rays' ? TEX.rays : TEX.cracks;
      crackMesh.position.set(c.x, 0.035, c.z);
      crackMat.uniforms.uColor.value.copy(pal.main);
      crackMesh.visible = true;
      crackDissolve = 1;
      crackMat.uniforms.uHdr.value = HDR(2.0);
      const critHit = isCrit && ctx.arch.canCrit; // crits must SOUND like crits here too
      const critFinisher = critHit && (ctx.spec.finisher || ctx.power >= 1.3);
      sfx.impact(ctx.palName, {
        pan: panOf(c.x),
        scale: ctx.power * (critHit ? 1.35 : 1),
        crit: critHit,
        finisher: critFinisher,
        lite: ctx.spec.impact?.liteAudio === true && !critFinisher,
        sample: ctx.spec.impact?.sample,
      });
      sfx.gust(panOf(c.x)); // the blast wind reaches the mics
      // a self-centered nova may carry a lasting whirl or mark, same
      // persistence contract as the shout archetype (Bladestorm keeps spinning)
      if (ctx.spec.buff?.orbit && ctx.spec.buff.orbit !== 'none') {
        const dur = Math.max(ctx.spec.linger ?? 0, this.aftermathDur) - 0.1;
        startBuffOrbit(ctx.spec.buff.orbit, pal, dur, ctx.id, ctx.spec.buff?.o ?? {});
        ctx.buffHold = dur;
      }
    },
    aftermath(_p, dt) {
      standardAftermath(dt, true);
      // motifEvery: a channeled nova may loop its motifs through the held
      // window so a sustained spin never breaks (Bladestorm re-arms its slash
      // ribbons every beat; each re-fire brings its foley whoosh with it)
      if (ctx.spec.motifEvery && stateT < (ctx.buffHold ?? ctx.spec.linger ?? 0)) {
        ctx.motifClock = (ctx.motifClock ?? 0) + dt;
        if (ctx.motifClock >= ctx.spec.motifEvery) {
          ctx.motifClock = 0;
          runMotifs('release', rig.group.position);
          runMotifs('impact', rig.group.position);
        }
      }
    },
  },

  beam: {
    canCrit: false,
    aftermathDur: 1.4,
    begin() {
      rig.play('Spellcasting', { fade: 0.2 });
      ctx.beamTicks = 0;
      ctx.beamPulses = [];
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      handMid(orbPos);
      projDir.copy(dummy.hitPos).sub(orbPos).normalize();
      releaseFlashFx(0.6);
      sfx.bedStop();
      sfx.beamStart(ctx.palName, panOf(dummy.hitPos.x));
    },
    channel: true,
    channelTick(dt) {
      const b = ctx.spec.beam ?? {};
      const dur = b.dur ?? 2.0;
      const pal = ctx.pal;
      handMid(orbPos);
      const from = orbPos.clone(),
        to = dummy.hitPos.clone();
      // layered beam, energy visibly streams along it (reversed when draining)
      // and the channel CRESCENDOS: each tick thickens and brightens the beam
      const fdir = b.drain ? -1 : 1;
      const grow = 1 + ctx.beamTicks * 0.22;
      ctx.beamFlick = (ctx.beamFlick ?? 0) - dt;
      if (!ctx.beamCache || ctx.beamFlick <= 0) {
        // flicker cache: regen ~22x/s, not every frame
        ctx.beamFlick = 0.045;
        ctx.beamCache = genBolt(from, to, { jag: 0.035, subdiv: 4, branchP: 0.06, depth: 1 });
      }
      for (const line of ctx.beamCache) {
        ribbons.add(
          line.pts,
          0.5 * grow * line.intensity,
          pal.glow,
          HDR(1.1 * grow) * line.intensity,
          0.7,
          fdir,
        );
        ribbons.add(
          line.pts,
          0.16 * grow * line.intensity,
          pal.main,
          HDR(1.8) * line.intensity,
          0.7,
          fdir,
        );
        ribbons.add(
          line.pts,
          0.06 * grow * line.intensity,
          pal.core,
          HDR(3.0) * line.intensity,
          0.7,
          fdir * 1.4,
        );
      }
      // traveling pulses
      if (rnd() < dt * 14) ctx.beamPulses.push(b.drain ? 1 : 0);
      for (let i = ctx.beamPulses.length - 1; i >= 0; i--) {
        ctx.beamPulses[i] += (b.drain ? -dt : dt) * 1.6;
        const u = ctx.beamPulses[i];
        if (u < 0 || u > 1) {
          ctx.beamPulses.splice(i, 1);
          continue;
        }
        tmpA.copy(from).lerp(to, u);
        emberPool.spawn(
          tmpA.x,
          tmpA.y,
          tmpA.z,
          0,
          0,
          0,
          0.14,
          pal.core.r * HDR(2.4),
          pal.core.g * HDR(2.4),
          pal.core.b * HDR(2.4),
        );
      }
      chargeLight.position.copy(orbPos);
      chargeLight.color.copy(pal.main);
      chargeLight.intensity = 26;
      projLight.position.copy(to);
      projLight.color.copy(pal.main);
      projLight.intensity = 26;
      // periodic ticks on the receiver
      const ticks = b.ticks ?? 4;
      const tickAt = (ctx.beamTicks + 1) * (dur / ticks);
      if (stateT >= tickAt && ctx.beamTicks < ticks) {
        ctx.beamTicks++;
        const last = ctx.beamTicks === ticks;
        sfx.beamTick(ctx.beamTicks, ticks, panOf(dummy.hitPos.x));
        impactStack(b.drain ? casterChest(new THREE.Vector3()) : dummy.hitPos, {
          scale: last ? 0.95 : 0.42 + 0.13 * ctx.beamTicks,
          ring: last,
          vRing: false,
          flipbook: last,
          sparks: 14 + ctx.beamTicks * 4,
          scorch: false,
          smoke: false,
          hitstop: false,
          kick: false,
          shake: last ? 0.8 : 0.4,
          liteAudio: !last,
          receiver: b.drain ? 'caster' : undefined,
          shell: b.drain ? false : undefined,
        });
        if (b.drain) {
          // the victim visibly pays for what the caster gains
          targetGlow = Math.max(targetGlow, 0.8);
          for (const m of dummy.mats) m.emissive.setHex(pal.main.getHex());
          dummyKick(0.25);
        } else {
          targetGlow = Math.max(targetGlow, 1.4);
          for (const m of dummy.mats) m.emissive.setHex(pal.main.getHex());
        }
      }
      return stateT >= dur;
    },
    impact() {
      hideOrb();
      sfx.beamStop();
      projLight.intensity = 0;
    },
    aftermath(_p, dt) {
      standardAftermath(dt, false);
    },
  },

  dot: {
    canCrit: false,
    aftermathDur: 3.6,
    begin() {
      rig.play('Spellcasting', { fade: 0.2 });
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      rig.play('Spellcast_Shoot', { loop: false, fade: 0.08, timeScale: 1.4 });
      handMid(orbPos);
      projDir.copy(dummy.hitPos).sub(orbPos).normalize();
      releaseFlashFx(0.7);
      hideOrbSoon();
      const from = orbPos.clone(),
        to = dummy.hitPos.clone();
      spawnBoltFx({
        life: 0.16,
        flicker: 0.05,
        width: 0.05,
        hdr: 2.2,
        colCore: ctx.pal.core,
        colGlow: ctx.pal.main,
        gen: () => [{ pts: smoothArc(from, to, rr(-0.8, 0.8), 18, 0.6), intensity: 1 }],
      });
    },
    travel: {
      tick(_dt) {
        return stateT >= 0.16;
      },
    },
    impact() {
      impactStack(dummy.hitPos, {
        scale: 0.6,
        ring: false,
        sparks: 18,
        scorch: false,
        smoke: false,
      });
      // the DoT holds its look for the duration, and mid-combo it survives the
      // whole remaining chain (Red Harvest still bleeds while execute lands)
      let bDur = (ctx.spec.linger ?? this.aftermathDur) - 0.3;
      if (comboOn && comboIx < COMBOS[ctx.cls].length - 1) bDur = Math.max(bDur, 7);
      startBurn(ctx.pal, bDur, ctx.spec.dot?.drip ?? 'fall');
      lastResiduePal = ctx.palName;
    },
    aftermath(_p, dt) {
      standardAftermath(dt, false);
    },
  },

  heal: {
    canCrit: false,
    aftermathDur: 1.8,
    self: true,
    begin() {
      rig.play('Spellcasting', { fade: 0.25 });
      sfx.chargeStart(ctx.windup / (slowMo ? 0.25 : userTimeScale));
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      rig.play('Spellcast_Raise', { loop: false, fade: 0.1, timeScale: 1.1 });
      casterChest(orbPos);
      projDir.set(0, -1, 0);
      hideOrbSoon();
      sfx.chargeStop();
    },
    travel: {
      tick(_dt) {
        return stateT >= 0.1;
      },
    },
    impact() {
      const pal = ctx.pal;
      const c = casterChest(new THREE.Vector3());
      // the healing light scales with the prayer: lesser_heal whispers,
      // lay_on_hands floods, spec.shaft scales or suppresses the column so no
      // two heals in a kit share the same pillar
      const shaftSc =
        ctx.spec.shaft === false ? 0 : typeof ctx.spec.shaft === 'number' ? ctx.spec.shaft : 1;
      if (ctx.windupStyle !== 'none' && shaftSc > 0) {
        spawnShaft(new THREE.Vector3(c.x, 0, c.z), {
          radius: (0.55 + 0.45 * ctx.power) * shaftSc,
          height: (4 + 3.2 * ctx.power) * shaftSc,
          color: pal.main,
          dur: 0.5 + 0.4 * ctx.power,
          intensity: (0.45 + 0.45 * ctx.power) * Math.min(1, shaftSc + 0.25),
        });
      }
      setRigGlow();
      spawnRing(new THREE.Vector3(c.x, 0.05, c.z), 2.6 * ctx.power, 0.7, pal.main, HDR(1.3));
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2,
          R = rr(0.2, 1);
        riserPool.spawn(
          c.x + Math.cos(a) * R,
          rr(0.1, 1.6),
          c.z + Math.sin(a) * R,
          rr(-0.08, 0.08),
          rr(0.7, 1.5),
          rr(-0.08, 0.08),
          rr(0.9, 1.6),
          pal.ion.r * HDR(1.9),
          pal.ion.g * HDR(1.9),
          pal.ion.b * HDR(1.9),
        );
      }
      lightPulses.pulse(c, pal.main, 160 * ctx.power, 0.7);
      casterGlowV = 1.6 * ctx.power;
      casterShellMat.uniforms.uColor.value.copy(pal.main);
      screenFlash(0.08);
      sfx.heal(ctx.palName, panOf(c.x), ctx.spec.impact?.sample);
    },
    aftermath(_p, dt) {
      standardAftermath(dt, false);
    },
  },

  buff: {
    canCrit: false,
    aftermathDur: 3.2,
    self: true,
    begin() {
      rig.play('Idle');
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      const style = ctx.spec.buff?.style ?? 'raise';
      rig.play('Spellcast_Raise', { loop: false, fade: 0.1, timeScale: 1.25 });
      casterChest(orbPos);
      projDir.set(0, -1, 0);
      hideOrbSoon();
      if (style === 'morph') {
        // implosion + burst
        const c = orbPos.clone();
        for (let i = 0; i < 22; i++) {
          const a = rnd() * Math.PI * 2,
            e = rr(-0.6, 1.1),
            R = rr(1.2, 2);
          tmpA.set(
            c.x + Math.cos(a) * Math.cos(e) * R,
            c.y + Math.sin(e) * R,
            c.z + Math.sin(a) * Math.cos(e) * R,
          );
          tmpB.copy(c).sub(tmpA).normalize().multiplyScalar(rr(3.5, 5.5));
          emberPool.spawn(
            tmpA.x,
            tmpA.y,
            tmpA.z,
            tmpB.x,
            tmpB.y,
            tmpB.z,
            R / 4.5,
            ctx.pal.ion.r * HDR(1.8),
            ctx.pal.ion.g * HDR(1.8),
            ctx.pal.ion.b * HDR(1.8),
          );
        }
      }
    },
    travel: {
      tick(_dt) {
        return stateT >= 0.12;
      },
    },
    impact() {
      const style = ctx.spec.buff?.style ?? 'raise';
      const pal = ctx.pal;
      const c = casterChest(new THREE.Vector3());
      // rune flash under caster only when the buff's language IS runes -
      // wings/plates/speedlines/heartbeat own their whole silhouette
      const orbitStyle = ctx.spec.buff?.orbit ?? 'none';
      if (orbitStyle === 'runes' || orbitStyle === 'none') {
        runeMesh.visible = true;
        placeRune();
        runeMat.uniforms.uColor.value.copy(pal.main);
        runeMat.uniforms.uHdr.value = HDR(2.2);
        runeDissolve = 0.12;
        runeMat.uniforms.uDissolve.value = runeDissolve;
        ctx.runeFlash = true;
      }
      casterGlowV = (ctx.spec.buff?.shellDur ? 2 : 1.3) * ctx.power;
      setRigGlow(); // body rim in the buff's own color, no more debug-capsule pill
      casterShellMat.uniforms.uColor.value.copy(pal.main);
      sfx.buffCast(style, ctx.palName, panOf(c.x), ctx.spec.impact?.sample);
      if (style === 'veil') {
        spawnSmoke(c, 7, pal.smoke.getHex());
        casterGlowV = 0.8;
      } else if (style === 'morph') {
        impactFlash.position.copy(c);
        impactFlash.material.color.copy(pal.core).multiplyScalar(HDR(2.8));
        impactFlash.visible = true;
        impactFlash.userData.age = 0;
        burst(sparkPool, c.x, c.y, c.z, 24, 6, 0.6, pal.ion, HDR(2), 0.5);
        spawnSmoke(c, 4, pal.smoke.getHex());
        screenFlash(0.14);
      } else {
        burst(riserPool, c.x, c.y - 0.8, c.z, 16, 1.6, 1.1, pal.ion, HDR(1.7), 0.9);
      }
      spawnOrbitStarsSoft(c, pal);
      lightPulses.pulse(c, pal.main, 120, 0.5);
      // duration read: the buff visual must live EXACTLY as long as the ability
      // holds the stage (the state machine's aftermath), never expiring early
      const orbit =
        ctx.spec.buff?.orbit ??
        (pal === PALETTES.storm ? 'sparks' : style === 'raise' ? 'runes' : 'none');
      const dur = Math.max(ctx.spec.linger ?? 0, this.aftermathDur) - 0.1;
      startBuffOrbit(orbit, pal, dur, ctx.id, ctx.spec.buff?.o ?? {});
      ctx.buffHold = dur;
    },
    aftermath(_p, dt) {
      standardAftermath(dt, false);
      if (ctx.buffHold && stateT < ctx.buffHold) {
        // held state stays SUBTLE, the orbit/wings carry the read; the body
        // rim must never flatten the character into a silhouette
        casterGlowV = Math.max(
          casterGlowV,
          (0.42 + Math.sin(perfNow * 4) * 0.08) * Math.min(1, (ctx.buffHold - stateT) / 0.6),
        );
      }
      if (ctx.runeFlash) {
        runeDissolve = Math.min(1, runeDissolve + dt * 2.2);
        runeMat.uniforms.uDissolve.value = runeDissolve;
        if (runeDissolve >= 1) {
          runeMesh.visible = false;
          ctx.runeFlash = false;
        }
      }
    },
  },

  shout: {
    canCrit: false,
    aftermathDur: 1.6,
    self: true,
    centered: true,
    begin() {
      rig.play('Idle');
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      rig.play('Cheer', { loop: false, fade: 0.08, timeScale: 1.3 });
      casterChest(orbPos);
      projDir.set(0, -1, 0);
    },
    travel: {
      tick(_dt) {
        return stateT >= 0.22;
      },
    },
    impact() {
      const pal = ctx.pal;
      const radius = (ctx.spec.shout?.radius ?? 6) * ctx.power;
      const c = casterChest(new THREE.Vector3());
      setRigGlow();
      // the WAVEFRONT is the ability, staggered luminous rings that expose the
      // frame on their own, plus visible air distortion (these were black frames)
      const rs = typeof ctx.spec.impact?.ring === 'number' ? Math.min(2, ctx.spec.impact.ring) : 1;
      spawnRing(c.clone(), radius * 0.75, 0.5, pal.core, HDR(2.2 * rs), true);
      spawnRing(new THREE.Vector3(c.x, 0.05, c.z), radius, 0.55, pal.main, HDR(2.4 * rs));
      setTimeoutSim(0.08, () =>
        spawnRing(new THREE.Vector3(c.x, 0.05, c.z), radius * 1.25, 0.6, pal.accent, HDR(1.8 * rs)),
      );
      setTimeoutSim(0.16, () =>
        spawnRing(c.clone(), radius * 1.1, 0.55, pal.ion, HDR(1.4 * rs), true),
      );
      spawnRipple(c, 1.2); // the air itself bends with the cry
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const from = c.clone();
        const to = new THREE.Vector3(
          c.x + Math.cos(a) * radius * 0.8,
          c.y + rr(-0.6, 0.8),
          c.z + Math.sin(a) * radius * 0.8,
        );
        spawnBoltFx({
          life: 0.2,
          flicker: 0.07,
          width: 0.09,
          hdr: 2.2,
          colCore: pal.core,
          colGlow: pal.main,
          gen: () => [{ pts: smoothArc(from, to, rr(-0.5, 0.5), 12, rr(0, 0.5)), intensity: 1 }],
        });
      }
      for (let i = 0; i < 14; i++) {
        // the ground answers: kicked dust ring
        const a = rnd() * Math.PI * 2,
          R = rr(0.8, radius * 0.45);
        emberPool.spawn(
          c.x + Math.cos(a) * R,
          0.1,
          c.z + Math.sin(a) * R,
          Math.cos(a) * rr(0.6, 1.6),
          rr(0.3, 0.9),
          Math.sin(a) * rr(0.6, 1.6),
          rr(0.4, 0.8),
          0.3,
          0.28,
          0.24,
        );
      }
      casterGlowV = 1.6;
      casterShellMat.uniforms.uColor.value.copy(pal.main);
      const lm = ctx.spec.impact?.light;
      const shoutLight = lm === undefined ? 300 : lm <= 8 ? 300 * lm : lm;
      lightPulses.pulse(c, pal.main, Math.min(900, shoutLight * ctx.power), 0.55);
      if (ctx.spec.shout?.target) {
        // taunts: the VICTIM visibly hears it
        lightPulses.pulse(dummy.hitPos, pal.main, 200, 0.4);
        targetGlow = Math.max(targetGlow, 1.6);
        for (const m of dummy.mats) m.emissive.setHex(pal.main.getHex());
        dummyKick(0.5);
      }
      radialBurst(c, 0.5);
      trauma = Math.max(trauma, 0.4);
      screenFlash(0.16);
      // rally shouts leave a lasting mark on the shouter, same persistence
      // contract as the buff archetype (battle_shout's fervor holds visibly)
      if (ctx.spec.buff?.orbit && ctx.spec.buff.orbit !== 'none') {
        const dur = Math.max(ctx.spec.linger ?? 0, this.aftermathDur) - 0.1;
        startBuffOrbit(ctx.spec.buff.orbit, pal, dur, ctx.id, ctx.spec.buff?.o ?? {});
        ctx.buffHold = dur;
      }
      sfx.shout(ctx.palName, panOf(c.x));
      sfx.gust(panOf(c.x));
    },
    aftermath(_p, dt) {
      standardAftermath(dt, false);
    },
  },

  summon: {
    canCrit: false,
    aftermathDur: 2.2,
    self: true,
    begin() {
      rig.play('Spellcasting', { fade: 0.25 });
      sfx.chargeStart(ctx.windup / (slowMo ? 0.25 : userTimeScale));
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      rig.play('Spellcast_Raise', { loop: false, fade: 0.1 });
      casterChest(orbPos);
      projDir.set(0, -1, 0);
      hideOrbSoon();
      sfx.chargeStop();
    },
    travel: {
      tick(_dt) {
        return stateT >= 0.15;
      },
    },
    impact() {
      const pal = ctx.pal;
      const spot = new THREE.Vector3(rig.group.position.x + 2.2, 0, rig.group.position.z + 1.4);
      ctx.portalSpot = spot;
      portalMesh.position.set(spot.x, 0.04, spot.z);
      portalMat.uniforms.uColor.value.copy(pal.main);
      portalMat.uniforms.uHdr.value = HDR(2.2);
      portalDissolve = 1;
      _portalHdr = 1;
      portalMesh.visible = true;
      // rising pillar
      for (let i = 0; i < 3; i++) {
        const from = new THREE.Vector3(spot.x + rr(-0.4, 0.4), 0.05, spot.z + rr(-0.4, 0.4));
        const to = new THREE.Vector3(spot.x + rr(-0.3, 0.3), rr(2.2, 3.2), spot.z + rr(-0.3, 0.3));
        spawnBoltFx({
          life: 0.5,
          flicker: 0.06,
          width: 0.09,
          hdr: 2.2,
          colCore: pal.core,
          colGlow: pal.main,
          curve: (t) => (1 - t) ** 1.1,
          gen: () => genBolt(from, to, { jag: 0.14, subdiv: 4, branchP: 0.2, depth: 1 }),
        });
      }
      for (let i = 0; i < 20; i++) {
        const a = rnd() * Math.PI * 2,
          R = rr(0.2, 1.1);
        riserPool.spawn(
          spot.x + Math.cos(a) * R,
          0.1,
          spot.z + Math.sin(a) * R,
          rr(-0.05, 0.05),
          rr(1, 2.2),
          rr(-0.05, 0.05),
          rr(0.7, 1.3),
          pal.ion.r * HDR(1.9),
          pal.ion.g * HDR(1.9),
          pal.ion.b * HDR(1.9),
        );
      }
      spawnRing(new THREE.Vector3(spot.x, 0.06, spot.z), 2.2, 0.6, pal.main, HDR(1.5));
      spawnSmoke(new THREE.Vector3(spot.x, 0.6, spot.z), 5, pal.smoke.getHex());
      lightPulses.pulse(new THREE.Vector3(spot.x, 1.2, spot.z), pal.main, 200, 0.7);
      screenFlash(0.12);
      // a summon's SOUND follows its nature: demonic rituals drone through the
      // portal; bonds and revivals chime, a tamed beast is welcomed, not damned
      if (['shadow', 'fire', 'blood', 'venom'].includes(ctx.palName)) sfx.portal(panOf(spot.x));
      else {
        sfx.heal(ctx.palName === 'nature' ? 'nature' : 'holy', panOf(spot.x));
        sfx.buffCast('raise', ctx.palName, panOf(spot.x));
      }
    },
    aftermath(p, dt) {
      standardAftermath(dt, false);
      // portal dissolves in then back out
      if (p < 0.4) portalDissolve = Math.max(0.15, portalDissolve - dt * 4);
      else portalDissolve = Math.min(1, portalDissolve + dt * 1.4);
      portalMat.uniforms.uDissolve.value = portalDissolve;
      portalMat.uniforms.uSpin.value = perfNow * 0.8;
      if (p >= 1) portalMesh.visible = false;
    },
  },

  cc: {
    canCrit: false,
    aftermathDur: 2.0,
    begin() {
      rig.play('Spellcasting', { fade: 0.2 });
      if (ctx.windup > 0.8) sfx.chargeStart(ctx.windup / (slowMo ? 0.25 : userTimeScale));
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      rig.play('Spellcast_Shoot', { loop: false, fade: 0.08, timeScale: 1.3 });
      handMid(orbPos);
      projDir.copy(dummy.hitPos).sub(orbPos).normalize();
      releaseFlashFx(0.6);
      hideOrbSoon();
      sfx.chargeStop();
      const from = orbPos.clone(),
        to = dummy.hitPos.clone();
      spawnBoltFx({
        life: 0.14,
        flicker: 0.05,
        width: 0.05,
        hdr: 2.2,
        colCore: ctx.pal.core,
        colGlow: ctx.pal.main,
        gen: () => [{ pts: smoothArc(from, to, rr(-0.7, 0.7), 16, 0.5), intensity: 1 }],
      });
    },
    travel: {
      tick(_dt) {
        return stateT >= 0.15;
      },
    },
    impact() {
      const style = ctx.spec.cc?.style ?? 'poof';
      const pal = ctx.pal;
      const hp = dummy.hitPos;
      if (style === 'poof') {
        impactFlash.position.copy(hp);
        impactFlash.material.color.copy(pal.core).multiplyScalar(HDR(3));
        impactFlash.visible = true;
        impactFlash.userData.age = 0;
        burst(sparkPool, hp.x, hp.y, hp.z, 30, 5, 0.8, pal.ion, HDR(2), 0.7);
        spawnSmoke(hp, 6, pal.smoke.getHex());
        spawnRing(hp.clone(), 2.6, 0.5, pal.main, HDR(1.3), true);
        spawnOrbitStars(
          new THREE.Vector3(hp.x, 2.55, hp.z),
          pal,
          Math.max(1.8, (ctx.spec.linger ?? 0) - 0.2),
        );
        screenFlash(0.14);
        sfx.ccPoof(panOf(hp.x));
      } else if (style === 'tendrils') {
        for (let i = 0; i < 7; i++) {
          const a1 = randomOnDummy(),
            a2 = randomOnDummy();
          setTimeoutSim(rr(0, 0.2), () =>
            spawnBoltFx({
              life: rr(0.2, 0.4),
              flicker: 0.05,
              width: 0.05,
              hdr: 2.2,
              colCore: pal.core,
              colGlow: pal.main,
              gen: () => genBolt(a1, a2, { jag: 0.3, subdiv: 4, branchP: 0.3, depth: 1 }),
            }),
          );
        }
        spawnDrips(hp, pal, Math.max(2, (ctx.spec.linger ?? 0) - 0.2), 'fall');
        targetGlow = 2;
        dummy.shellMat.uniforms.uColor.value.copy(pal.main);
        dummy.shell.visible = true;
        shellGlow = 1.4;
        for (const m of dummy.mats) m.emissive.setHex(pal.main.getHex());
        sfx.impact('shadow', { pan: panOf(hp.x), scale: 0.7 });
      } else {
        // stars
        spawnOrbitStars(
          new THREE.Vector3(hp.x, 2.55, hp.z),
          pal,
          Math.max(1.8, (ctx.spec.linger ?? 0) - 0.2),
        );
        impactStack(hp, {
          scale: 0.55,
          ring: false,
          vRing: false,
          flipbook: false,
          sparks: 16,
          scorch: false,
          smoke: false,
        });
      }
      lightPulses.pulse(hp, pal.main, 140, 0.5);
    },
    aftermath(_p, dt) {
      standardAftermath(dt, false);
    },
  },

  dash: {
    canCrit: true,
    aftermathDur: 1.7,
    begin() {
      rig.play('Idle');
      ctx.dashTrail = [];
    },
    windup(p, dt) {
      windupFx(p, dt);
    },
    release() {
      rig.play('Running_A', { fade: 0.08, timeScale: 1.6 });
      casterChest(orbPos);
      projDir.copy(dummy.hitPos).sub(orbPos).setY(0).normalize();
      sfx.dashWind(0.5, panOf(rig.group.position.x));
    },
    travel: {
      tick(dt) {
        const speed = 26;
        rig.group.position.x = Math.min(MELEE_X, rig.group.position.x + speed * dt);
        casterShadow.position.x = rig.group.position.x;
        const c = casterChest(new THREE.Vector3());
        ctx.dashTrail.unshift(c.clone());
        if (ctx.dashTrail.length > 12) ctx.dashTrail.pop();
        if (ctx.dashTrail.length > 3)
          ribbons.add(ctx.dashTrail, 0.7, ctx.pal.main, HDR(1.2), 0.9, 0.8);
        if (rnd() < dt * 40) {
          emberPool.spawn(
            rig.group.position.x + rr(-0.3, 0.3),
            0.15,
            rig.group.position.z + rr(-0.3, 0.3),
            rr(-0.4, 0.4),
            rr(0.3, 1),
            rr(-0.4, 0.4),
            rr(0.3, 0.6),
            ctx.pal.ion.r,
            ctx.pal.ion.g,
            ctx.pal.ion.b,
          );
        }
        return rig.group.position.x >= MELEE_X - 0.01;
      },
    },
    impact() {
      rig.play(rig.attacks[0], { loop: false, fade: 0.06, timeScale: 1.3 });
      impactStack(dummy.hitPos, { scale: 0.9, scorch: false, smoke: false });
      spawnOrbitStars(new THREE.Vector3(dummy.hitPos.x, 2.55, dummy.hitPos.z), ctx.pal, 1.4);
    },
    aftermath(p, dt) {
      standardAftermath(dt, false);
      if (p > 0.6) rig.play('Idle', { fade: 0.3 });
    },
  },
};
ARCHETYPES.bolt.name = 'bolt';

function placeRune() {
  runeMesh.position.set(rig.group.position.x, 0.03, rig.group.position.z);
}
// residual duration read on the target for any damaging archetype whose spec
// carries dot params or a linger (ignite, rime slow, sting...)
function applyResidual() {
  if (ctx.self) return;
  if (ctx.spec.dot || ctx.spec.linger) {
    let dur = Math.max(1.5, (ctx.spec.linger ?? 3) - 0.3);
    if (comboOn && comboIx < COMBOS[ctx.cls].length - 1) dur = Math.max(dur, 7); // residue rides the whole chain
    startBurn(ctx.pal, dur, ctx.spec.dot?.drip ?? 'fall');
    lastResiduePal = ctx.palName;
  }
}
function orbVisible(v) {
  orbShell.visible = orbCore.visible = orbHalo.visible = v;
}
function hideOrbSoon() {
  setTimeoutSim(0.1, hideOrb);
}
function windupHandGlow(p, _dt) {
  handMid(orbPos);
  orbVisible(true);
  const pal = ctx.pal;
  orbShell.visible = false;
  orbCore.position.copy(orbPos);
  orbCore.scale.setScalar(0.3 + p * 0.25);
  orbCore.material.color.copy(pal.core).multiplyScalar(HDR(2));
  orbCore.material.opacity = 0.5 * p;
  orbHalo.position.copy(orbPos);
  orbHalo.scale.setScalar(0.9 + p * 0.6);
  orbHalo.material.color.copy(pal.glow).multiplyScalar(HDR(1.2));
  orbHalo.material.opacity = 0.25 * p;
  chargeLight.position.copy(orbPos);
  chargeLight.color.copy(pal.main);
  chargeLight.intensity = p * 16;
}
function spawnOrbitStarsSoft(c, pal) {
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2,
      R = rr(0.5, 0.9);
    riserPool.spawn(
      c.x + Math.cos(a) * R,
      c.y + rr(-1, 0.4),
      c.z + Math.sin(a) * R,
      Math.cos(a + 1.7) * 0.6,
      rr(0.3, 0.8),
      Math.sin(a + 1.7) * 0.6,
      rr(0.8, 1.4),
      pal.ion.r * HDR(1.6),
      pal.ion.g * HDR(1.6),
      pal.ion.b * HDR(1.6),
    );
  }
}

function standardAftermath(dt, groundBurn) {
  projLight.intensity = Math.max(0, projLight.intensity - dt * 300);
  if (runeMesh.visible && !ctx.runeFlash) {
    // cast circle burns out gracefully
    runeDissolve = Math.min(1, runeDissolve + dt * 1.2);
    runeMat.uniforms.uDissolve.value = runeDissolve;
    if (runeDissolve >= 1) runeMesh.visible = false;
  }
  if (scorchAlpha > 0) scorchAlpha = Math.min(scorchMax, scorchAlpha + dt * (groundBurn ? 6 : 2.5)); // pools (blood) spread even without a ground burn
  if (groundBurn) {
    crackDissolve = Math.max(0.12, crackDissolve - dt * 5);
    crackMat.uniforms.uDissolve.value = crackDissolve;
    crackMat.uniforms.uHdr.value = Math.max(0, crackMat.uniforms.uHdr.value - dt * 1.1);
  }
  targetGlow = Math.max(0, targetGlow - dt * 4.2);
  shellGlow = Math.max(0, shellGlow - dt * 3.4);
  casterGlowV = Math.max(0, casterGlowV - dt * (ctx.spec.buff?.shellDur ? 0.9 : 2.2));
  if (stateT >= 0.55 && !idleResumed) {
    idleResumed = true;
    rig.play('Idle', { fade: 0.4 });
  }
  // finisher (only when the spec asks)
  if (ctx.spec.finisher && finisherOn && !finisherFired) {
    finisherTimer += dt;
    if (finisherTimer >= 0.16) {
      finisherFired = true;
      fireFinisher();
    }
  }
}

// ---------------------------------------------------------------- state machine
function setState(s) {
  state = s;
  stateT = 0;
  if (cineOn) {
    // trailer language: wide on the windup, punch in for the hit
    if (s === 'release') cineShotIn = true;
    else if (s === 'idle' || s === 'windup') {
      // the combo finisher never cuts back to wide, the camera stays committed
      const finisherBeat = comboOn && ctx && comboIx === COMBOS[ctx.cls].length - 1;
      if (!finisherBeat) cineShotIn = false;
    }
    if (s === 'aftermath') cineAutoUntil = perfNow + 0.55; // auto slow-mo through the impact
  }
  const label = {
    idle: 'Idle',
    windup: 'Windup',
    release: 'Release',
    travel: ctx?.arch === ARCHETYPES.dash ? 'Charge!' : 'Travel',
    channel: 'Channel',
    aftermath: isCrit && ctx?.arch.canCrit ? 'Impact, CRIT' : 'Impact & linger',
  };
  phaseEl.textContent = label[s] ?? s;
}

// ---------------------------------------------------------------- signature motifs
// Composable set-piece layers, each ability stacks 1-2 of these on top of its
// archetype so no two abilities share a silhouette. spec.motifs: ['fissure',...]
const MOTIFS = {
  fissure: {
    phase: 'impact',
    run(at) {
      // ground splits toward the target
      const pal = ctx.pal;
      const from = new THREE.Vector3(rig.group.position.x + 1, 0.04, rig.group.position.z);
      const to = new THREE.Vector3(at.x, 0.04, at.z);
      spawnBoltFx({
        life: 0.8,
        flicker: 0.2,
        width: 0.16,
        glowWidth: 0.5,
        hdr: 2.2,
        colCore: pal.core,
        colGlow: pal.main,
        curve: (t) => (t < 0.2 ? t / 0.2 : (1 - (t - 0.2) / 0.8) ** 1.2),
        gen: () =>
          genBolt(from, to, { jag: 0.06, subdiv: 5, branchP: 0.3, depth: 1, branchScale: 0.2 }),
      });
      // dust erupting along the crack
      for (let i = 0; i < 6; i++) {
        const u = (i + 1) / 7;
        const p = from.clone().lerp(to, u);
        setTimeoutSim(u * 0.22, () =>
          burst(emberPool, p.x, 0.1, p.z, 5, 2.2, 0.6, ctx.pal.ion, HDR(1.5), 1),
        );
      }
      trauma = Math.max(trauma, 0.3);
    },
  },
  vines: {
    phase: 'impact',
    run(at) {
      // living coils climb the target
      const pal = ctx.pal;
      for (let i = 0; i < 5; i++) {
        const a0 = (i / 5) * Math.PI * 2;
        const pts = [];
        for (let s = 0; s <= 12; s++) {
          const u = s / 12;
          const ang = a0 + u * 4.2;
          const r = 0.75 - u * 0.35;
          pts.push(new THREE.Vector3(at.x + Math.cos(ang) * r, u * 2.5, at.z + Math.sin(ang) * r));
        }
        spawnBoltFx({
          life: rr(1.1, 1.5),
          flicker: 0.5,
          width: 0.09,
          glowWidth: 0.26,
          hdr: 1.8,
          colCore: pal.ion,
          colGlow: pal.main,
          curve: (t) => (t < 0.25 ? t / 0.25 : (1 - (t - 0.25) / 0.75) ** 0.8),
          gen: () => [{ pts, intensity: 1 }],
        });
      }
      burst(riserPool, at.x, 0.2, at.z, 12, 1.6, 1.2, ctx.pal.ion, HDR(1.6), 1);
    },
  },
  chains: {
    phase: 'impact',
    run(at) {
      // taut binding chains snap up from the earth
      const pal = ctx.pal;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const anchor = new THREE.Vector3(at.x + Math.cos(a) * 2.2, 0.03, at.z + Math.sin(a) * 2.2);
        const grip = new THREE.Vector3(
          at.x + Math.cos(a) * 0.25,
          rr(1.2, 1.9),
          at.z + Math.sin(a) * 0.25,
        );
        // segmented, angular, reads as links, not lightning
        const pts = [];
        for (let s = 0; s <= 8; s++) {
          const u = s / 8;
          const p = anchor.clone().lerp(grip, u);
          p.y += Math.sin(u * Math.PI) * -0.25; // sag then tension
          if (s % 2 === 1) p.add(tmpC.set(rr(-0.05, 0.05), rr(-0.05, 0.05), rr(-0.05, 0.05)));
          pts.push(p);
        }
        spawnBoltFx({
          life: 0.9,
          flicker: 0.45,
          width: 0.07,
          glowWidth: 0.2,
          hdr: 2.0,
          colCore: pal.core,
          colGlow: pal.accent,
          curve: (t) => (t < 0.12 ? t / 0.12 : (1 - (t - 0.12) / 0.88) ** 0.9),
          gen: () => [{ pts, intensity: 1 }],
        });
        lightPulses.pulse(anchor, pal.accent, 50, 0.3);
      }
    },
  },
  swarm: {
    phase: 'impact',
    run(at) {
      // dark shapes burst out and flee
      const pal = ctx.pal;
      for (let i = 0; i < 14; i++) {
        const a = rnd() * Math.PI * 2;
        emberPool.spawn(
          at.x,
          at.y ?? 1.5,
          at.z,
          Math.cos(a) * rr(2, 5),
          rr(1, 3.2),
          Math.sin(a) * rr(2, 5),
          rr(0.7, 1.2),
          pal.glow.r * HDR(1.4),
          pal.glow.g * HDR(1.4),
          pal.glow.b * HDR(1.4),
        );
      }
    },
  },
  pillars: {
    phase: 'impact',
    run(at) {
      // ring of sequential ground eruptions
      const _pal = ctx.pal;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const p = new THREE.Vector3(at.x + Math.cos(a) * 1.9, 0.02, at.z + Math.sin(a) * 1.9);
        setTimeoutSim(i * 0.09, () => {
          const top = p.clone().setY(rr(1.8, 2.6));
          spawnBoltFx({
            life: 0.28,
            flicker: 0.06,
            width: 0.12,
            hdr: 2.4,
            colCore: ctx.pal.core,
            colGlow: ctx.pal.main,
            gen: () => genBolt(p, top, { jag: 0.1, subdiv: 3, branchP: 0.15, depth: 0 }),
          });
          burst(riserPool, p.x, 0.15, p.z, 6, 2, 0.8, ctx.pal.ion, HDR(1.7), 1);
          lightPulses.pulse(p, ctx.pal.main, 70, 0.25);
        });
      }
    },
  },
  orbitals: {
    phase: 'impact',
    run(at) {
      // orbs circle in, then slam one-two-three
      const pal = ctx.pal;
      for (let i = 0; i < 3; i++) {
        setTimeoutSim(0.1 + i * 0.14, () => {
          const a = (i / 3) * Math.PI * 2 + perfNow;
          const from = new THREE.Vector3(
            at.x + Math.cos(a) * 1.8,
            (at.y ?? 1.5) + 0.8,
            at.z + Math.sin(a) * 1.8,
          );
          spawnBoltFx({
            life: 0.14,
            flicker: 0.05,
            width: 0.09,
            hdr: 2.8,
            colCore: pal.core,
            colGlow: pal.accent,
            gen: () => [
              {
                pts: smoothArc(from, new THREE.Vector3(at.x, at.y ?? 1.5, at.z), 0.4, 10, 0.2),
                intensity: 1,
              },
            ],
          });
          burst(sparkPool, at.x, at.y ?? 1.5, at.z, 8, 5, 0.4, pal.ion, HDR(2.2), 0.5);
          sfx.school(ctx.pal.sfx);
        });
      }
    },
  },
  cross: {
    phase: 'impact',
    run(at) {
      // radiant cross-flash
      const pal = ctx.pal;
      const c = new THREE.Vector3(at.x, at.y ?? 1.6, at.z);
      for (const [dx, dy] of [
        [0, 1.6],
        [1.3, 0],
      ]) {
        const a = c.clone().add(new THREE.Vector3(-dx, -dy, 0));
        const b = c.clone().add(new THREE.Vector3(dx, dy, 0));
        spawnBoltFx({
          life: 0.35,
          flicker: 0.2,
          width: 0.16,
          glowWidth: 0.55,
          hdr: 2.6,
          colCore: pal.core,
          colGlow: pal.main,
          curve: (t) => (1 - t) ** 1.2,
          gen: () => [{ pts: smoothArc(a, b, 0.01, 8, 0), intensity: 1 }],
        });
      }
    },
  },
  fountain: {
    phase: 'impact',
    run(at) {
      // arcing streams rain onto the point
      const pal = ctx.pal;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const from = new THREE.Vector3(at.x + Math.cos(a) * 2.4, 0.4, at.z + Math.sin(a) * 2.4);
        spawnBoltFx({
          life: 0.7,
          flicker: 0.16,
          width: 0.08,
          glowWidth: 0.24,
          hdr: 1.8,
          colCore: pal.ion,
          colGlow: pal.main,
          curve: (t) => Math.sin(t * Math.PI),
          gen: () => [
            {
              pts: smoothArc(from, new THREE.Vector3(at.x, 0.6, at.z), rr(-0.3, 0.3), 12, 2.2),
              intensity: 1,
            },
          ],
        });
      }
    },
  },
  crescents: {
    phase: 'impact',
    run(at) {
      // twin moon-blades sweep through
      const pal = ctx.pal;
      for (const side of [-1, 1]) {
        const a = new THREE.Vector3(at.x - 1.1 * side, (at.y ?? 1.6) + 1.1, at.z + 0.4 * side);
        const b = new THREE.Vector3(at.x + 1.1 * side, (at.y ?? 1.6) - 1.1, at.z - 0.4 * side);
        spawnBoltFx({
          life: 0.3,
          flicker: 0.15,
          width: 0.2,
          glowWidth: 0.6,
          hdr: 2.4,
          colCore: pal.core,
          colGlow: pal.accent,
          curve: (t) => (1 - t) ** 1.3,
          gen: () => [{ pts: smoothArc(a, b, 0.7 * side, 12, 0), intensity: 1 }],
        });
      }
    },
  },
  bladestorm: {
    phase: 'release',
    run(_at) {
      // slash ribbons whirl around the caster
      const pal = ctx.pal;
      const c = casterChest(new THREE.Vector3());
      for (let i = 0; i < 3; i++) {
        const ph = (i / 3) * Math.PI * 2;
        spawnBoltFx({
          life: 0.55,
          flicker: 0.03,
          width: 0.11,
          glowWidth: 0.3,
          hdr: 2.2,
          colCore: pal.core,
          colGlow: pal.main,
          curve: (t) => (1 - t) ** 0.8,
          gen: () => {
            const t0 = perfNow * 9 + ph;
            const pts = [];
            for (let s = 0; s <= 8; s++) {
              const a = t0 + (s / 8) * 1.6;
              pts.push(
                new THREE.Vector3(
                  c.x + Math.cos(a) * 1.1,
                  c.y + Math.sin(t0 * 0.7) * 0.3,
                  c.z + Math.sin(a) * 1.1,
                ),
              );
            }
            return [{ pts, intensity: 1 }];
          },
        });
      }
    },
  },
  implosion: {
    phase: 'release',
    run(at) {
      // space sucks inward before the hit
      const pal = ctx.pal;
      const c = new THREE.Vector3(at.x, at.y ?? 1.5, at.z);
      for (let i = 0; i < 18; i++) {
        const a = rnd() * Math.PI * 2,
          e = rr(-0.5, 1),
          R = rr(1.4, 2.4);
        tmpA.set(
          c.x + Math.cos(a) * Math.cos(e) * R,
          c.y + Math.sin(e) * R,
          c.z + Math.sin(a) * Math.cos(e) * R,
        );
        tmpB.copy(c).sub(tmpA).normalize().multiplyScalar(rr(4, 6));
        emberPool.spawn(
          tmpA.x,
          tmpA.y,
          tmpA.z,
          tmpB.x,
          tmpB.y,
          tmpB.z,
          R / 5,
          pal.glow.r * HDR(1.6),
          pal.glow.g * HDR(1.6),
          pal.glow.b * HDR(1.6),
        );
      }
    },
  },
  gavel: {
    phase: 'impact',
    run(at) {
      // a hammer of light descends and LANDS
      const pal = ctx.pal;
      // dark solid core inside its own additive rim, a shape backlit by light,
      // legible even inside a holy shaft (light-on-light never reads)
      const coreM = new THREE.MeshBasicMaterial({
        color: pal.main.clone().multiplyScalar(0.22),
        transparent: true,
        opacity: 0.95,
      });
      const rimM = new THREE.MeshBasicMaterial({
        color: pal.core.clone().multiplyScalar(HDR(2.2)),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.BackSide,
      });
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.55, 0.55), coreM);
      const headRim = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.7), rimM);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.9, 8), coreM);
      handle.position.y = 1.15;
      const grp = new THREE.Group();
      grp.add(head, headRim, handle);
      grp.position.set(at.x, 6.4, at.z);
      grp.rotation.z = 0.12;
      scene.add(grp);
      const born = perfNow;
      let landed = false;
      // three.js only fires onBeforeRender on renderable MESHES, never groups
      head.onBeforeRender = () => {
        const tt = perfNow - born;
        const u = clamp01(tt / 0.22);
        grp.position.y = 6.4 + (1.15 - 6.4) * u * u; // accelerates into the verdict
        if (u >= 1 && !landed) {
          landed = true;
          spawnRing(new THREE.Vector3(at.x, 0.05, at.z), 4.2, 0.5, pal.main, HDR(2.0));
          burst(sparkPool, at.x, 1.1, at.z, 26, 9, 0.6, pal.core, HDR(2.4), 0.5);
          lightPulses.pulse(new THREE.Vector3(at.x, 1.4, at.z), pal.core, 340, 0.4);
          trauma = Math.max(trauma, 0.5);
          screenFlash(0.2);
        }
        const fade = clamp01((1.15 - tt) / 0.35);
        coreM.opacity = 0.95 * fade;
        rimM.opacity = 0.85 * fade;
      };
      setTimeoutSim(
        1.25,
        () => {
          scene.remove(grp);
          coreM.dispose();
          rimM.dispose();
          head.geometry.dispose();
          headRim.geometry.dispose();
          handle.geometry.dispose();
        },
        true,
      ); // sticky: the cleanup must run even if the ability switches mid-swing
    },
  },
  claws: {
    phase: 'impact',
    run(at) {
      // three raking gashes across the anchor
      const pal = ctx.pal;
      for (const off of [-0.3, 0, 0.3]) {
        const ca = new THREE.Vector3(at.x - 0.55, (at.y ?? 1.3) + 0.85, at.z - 0.5 + off);
        const cb = new THREE.Vector3(at.x + 0.1, (at.y ?? 1.3) - 0.75, at.z + 0.4 + off);
        const pts = smoothArc(ca, cb, 0.25, 10, 0);
        spawnBoltFx({
          life: 0.3,
          flicker: 0.14,
          width: 0.11,
          glowWidth: 0.34,
          hdr: 2.6,
          colCore: pal.core,
          colGlow: pal.main,
          curve: (t) => (1 - t) ** 1.3,
          gen: () => [{ pts, intensity: 1 }],
        });
      }
      burst(sparkPool, at.x, at.y ?? 1.3, at.z, 10, 6, 0.5, pal.ion, HDR(2.2), 0.4);
    },
  },
  barrier: {
    phase: 'impact',
    run(_at) {
      // plates snap into a guarding arc
      const pal = ctx.pal;
      const c = rig.group.position;
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 0.35;
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(0.42, 0.6),
          new THREE.MeshBasicMaterial({
            color: pal.main.clone().multiplyScalar(HDR(1.8)),
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
          }),
        );
        m.position.set(
          c.x + Math.cos(a) * 1.15,
          1.35 + Math.abs(i - 2) * 0.1,
          c.z + Math.sin(a) * 1.15,
        );
        m.lookAt(c.x, 1.35, c.z);
        scene.add(m);
        const born = perfNow;
        shockRings.push({
          // reuse the ring updater lifecycle via a shim
          m,
          mat: {
            uniforms: { uProgress: { value: 0 } },
            dispose() {
              m.material.dispose();
            },
          },
          age: -i * 0.05,
          dur: 1.1,
        });
        m.onBeforeRender = () => {
          // simple envelope, no shader needed
          const t = clamp01((perfNow - born + i * 0.05) / 1.1);
          m.material.opacity = t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85) ** 1.4 * 0.75;
        };
      }
    },
  },
};
function runMotifs(phase, at) {
  if (!ctx?.spec?.motifs) return;
  for (const name of ctx.spec.motifs) {
    const m = MOTIFS[name];
    if (m && m.phase === phase) {
      m.run(at);
      sfx.motif(name, panOf(at.x)); // every set-piece has its foley
    }
  }
}

// impact + target-side spirit apparitions (spectral sheep on Polymorph, etc.)
function doImpact() {
  expoDipUntil = perfNow + 0.04; // anticipation dip: darken a breath before the bloom
  ctx.arch.impact();
  // motifs anchor where the archetype actually detonates, caster-centered
  // novas/shouts ring the CASTER, not the far-away dummy; spec.motifAt overrides
  // (a taunt's mark belongs on the VICTIM even though the shout is self-centered)
  const anchor =
    ctx.spec.motifAt === 'target'
      ? dummy.hitPos.clone()
      : ctx.spec.motifAt === 'caster'
        ? casterChest(new THREE.Vector3())
        : ctx.self || ctx.arch.centered
          ? casterChest(new THREE.Vector3())
          : dummy.hitPos.clone();
  runMotifs('impact', anchor);
  const spr = ctx.spec.spirit;
  if (spr && (spr.at ?? 'caster') !== 'caster') {
    const at =
      spr.at === 'portal' && ctx.portalSpot
        ? ctx.portalSpot.clone()
        : new THREE.Vector3(TARGET_POS.x - 1.2, 0, TARGET_POS.z + 0.9); // clear of the dummy
    const critScale = isCrit && ctx.arch.canCrit ? 1.25 : 1;
    spawnSpirit({
      ...spr,
      scale: (spr.scale ?? 1) * critScale,
      at,
      dirX: 1,
      atKind: spr.at ?? 'target',
    });
  }
}

function resetTransients(soft = false) {
  if (!soft) boltFx.length = 0; // soft (combo) keeps self-expiring residues alive across beats
  sfx.chargeStop();
  sfx.sizzleStop();
  sfx.beamStop();
  clearShafts();
  clearProjMesh();
  heatSrc = null;
  if (ctx) ctx.shaft = null;
  if (!soft) {
    // combo steps keep burns, buffs, footprints, ground wear alive
    loopToken++; // invalidates in-flight spirit loads
    clearBuffOrbit();
    clearFootprints();
    burnFx = null;
    drips.length = 0;
    streaksList.length = 0;
    for (const o of orbiters)
      for (const s of o.sprites) {
        scene.remove(s);
        s.material.dispose();
      }
    orbiters.length = 0;
  }
  hideOrb();
  releaseFlash.visible = impactFlash.visible = false;
  headCore.visible = headHalo.visible = false;
  runeMesh.visible = false;
  portalMesh.visible = false;
  runeDissolve = 1;
  portalDissolve = 1;
  projLight.intensity = 0;
  if (!soft) {
    shellGlow = 0;
    targetGlow = 0;
    casterGlowV = 0;
  }
  finisherFired = true;
  finisherTimer = 0;
  idleResumed = true;
}

const comboEntry = (cls, ix) => {
  const e = COMBOS[cls]?.[ix];
  return typeof e === 'string' ? { id: e } : e;
};
function startLoopForAbility(soft = false) {
  abilityToken++; // stale sim-timeouts from the previous ability die here
  resetTransients(soft);
  const beat = comboOn ? comboEntry(ctx.cls, comboIx) : null;
  const seqLen = comboOn ? COMBOS[ctx.cls].length : 0;
  // position caster: mid-combo the fighter HOLDS the ground the gap-closer won -
  // no teleporting back to range between beats
  let x = ctx.arch.melee ? MELEE_X : CASTER_POS.x;
  if (beat) {
    if (beat.at === 'melee' || ctx.arch.melee) x = MELEE_X;
    else if (comboIx > 0) x = rig.group.position.x;
  }
  rig.group.position.set(x, 0, 0);
  casterShadow.position.x = x;
  ctx.self = !!ctx.arch.self;
  ctx.novaCenter =
    beat?.at === 'target' && ctx.arch.centered
      ? new THREE.Vector3(TARGET_POS.x, 0, TARGET_POS.z)
      : null;
  if (comboOn) {
    // pacing curve: tighten through the chain, breathe into the finisher -
    // and every beat tops the last (power escalates into the kill).
    // scaled from pristine bases so a Replay never compounds the scaling
    ctx.windupBase = ctx.windupBase ?? ctx.windup;
    ctx.powerBase = ctx.powerBase ?? ctx.power;
    ctx.windup = Math.max(0.25, ctx.windupBase * ([1, 0.8, 0.65, 1.15][comboIx] ?? 1));
    ctx.power = Math.min(1.7, ctx.powerBase * (1 + comboIx * 0.15));
    if (comboIx === seqLen - 1) sfx.duck(0.4, 0.45); // held breath before the kill
  }
  sfx.setIntensity(comboOn ? 1 + comboIx * 0.07 : 1); // combos escalate sonically
  setState('idle');
  rig.play('Idle');
  const comboTag = comboOn ? ` · ${comboIx + 1}/${seqLen}` : '';
  infoEl.textContent = `${ctx.meta.name}, ${ctx.cls} · ${ctx.spec.archetype} · ${ctx.spec.palette ?? ctx.meta.school}${comboTag}`;
}

let setAbilitySeq = 0;
async function setAbility(cls, id, soft = false) {
  const seq = ++setAbilitySeq; // async guard: only the LATEST call may win
  const nextRig = await loadRig(cls);
  if (seq !== setAbilitySeq) return; // a newer setAbility overtook this one mid-load
  if (rig && rig !== nextRig) {
    rig.group.visible = false;
    for (const m of rig.mats) m.emissiveIntensity = 0; // rim glow dies with the old rig
  }
  rig = nextRig;
  rig.group.visible = true;
  if (!soft) {
    // fresh stage for a new ability, no leftover ground wear
    scorchAlpha = 0;
    scorchDark.material.opacity = 0;
    crackMat.uniforms.uHdr.value = 0;
    crackMesh.visible = false;
    loopCount = 0;
    if (!tourOn) isCrit = false; // the tour keeps its crit alternation across advances
    comboWear = 0;
    lastResiduePal = null;
  }
  ctx = resolveSpec(cls, id);
  startLoopForAbility(soft);
  syncSelectors();
}

function advanceAbility(delta) {
  const classes = Object.keys(CATALOG);
  let ci = classes.indexOf(ctx.cls);
  const list = CATALOG[ctx.cls];
  let ai = list.findIndex((a) => a.id === ctx.id) + delta;
  if (ai >= list.length) {
    ci = (ci + 1) % classes.length;
    ai = 0;
  }
  if (ai < 0) {
    ci = (ci - 1 + classes.length) % classes.length;
    ai = CATALOG[classes[ci]].length - 1;
  }
  setAbility(classes[ci], CATALOG[classes[ci]][ai].id);
}

function loopEnd() {
  loopCount++;
  if (comboOn && ctx) {
    const seq = COMBOS[ctx.cls];
    comboIx = (comboIx + 1) % seq.length;
    isCrit = comboIx === seq.length - 1; // the finisher pops
    setAbility(ctx.cls, comboEntry(ctx.cls, comboIx).id, comboIx !== 0); // hard reset only when the chain restarts
    return;
  }
  isCrit = loopCount % 2 === 1;
  if (tourOn) {
    advanceAbility(1);
    return;
  }
  startLoopForAbility();
}

// ---------------------------------------------------------------- UI
const selClass = document.getElementById('selClass');
const selAbility = document.getElementById('selAbility');
for (const cls of Object.keys(CATALOG)) {
  const o = document.createElement('option');
  o.value = cls;
  o.textContent = cls;
  selClass.appendChild(o);
}
function fillAbilities(cls) {
  selAbility.innerHTML = '';
  for (const a of CATALOG[cls]) {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.name;
    selAbility.appendChild(o);
  }
}
function syncSelectors() {
  if (selClass.value !== ctx.cls) {
    selClass.value = ctx.cls;
    fillAbilities(ctx.cls);
  }
  selAbility.value = ctx.id;
}
selClass.addEventListener('change', () => {
  fillAbilities(selClass.value);
  setAbility(selClass.value, CATALOG[selClass.value][0].id);
});
selAbility.addEventListener('change', () => setAbility(selClass.value, selAbility.value));
document.getElementById('btnPrev').addEventListener('click', () => advanceAbility(-1));
document.getElementById('btnNext').addEventListener('click', () => advanceAbility(1));
const btnTour = document.getElementById('btnTour');
btnTour.addEventListener('click', () => {
  tourOn = !tourOn;
  btnTour.classList.toggle('on', tourOn);
});
const btnCombo = document.getElementById('btnCombo');
btnCombo.addEventListener('click', () => {
  comboOn = !comboOn;
  btnCombo.classList.toggle('on', comboOn);
  if (comboOn && ctx) {
    tourOn = false;
    btnTour.classList.remove('on');
    comboIx = 0;
    isCrit = false;
    setAbility(ctx.cls, comboEntry(ctx.cls, 0).id);
  } else if (ctx) {
    startLoopForAbility();
  }
});
document.getElementById('btnReplay').addEventListener('click', () => startLoopForAbility());
const btnSlow = document.getElementById('btnSlow');
btnSlow.addEventListener('click', () => {
  slowMo = !slowMo;
  btnSlow.classList.toggle('on', slowMo);
  btnSlow.textContent = slowMo ? 'Slow-mo ON (0.25x)' : 'Slow-mo';
});
const btnFin = document.getElementById('btnFinisher');
btnFin.addEventListener('click', () => {
  finisherOn = !finisherOn;
  btnFin.classList.toggle('on', finisherOn);
});
const btnCine = document.getElementById('btnCine');
btnCine.addEventListener('click', () => {
  cineOn = !cineOn;
  btnCine.classList.toggle('on', cineOn);
  controls.enabled = !cineOn;
});
const speedSlider = document.getElementById('speedSlider');
speedSlider.addEventListener('input', () => {
  userTimeScale = parseFloat(speedSlider.value);
});
const volSlider = document.getElementById('volSlider');
volSlider.addEventListener('input', () => sfx.setVolume(parseFloat(volSlider.value)));
const btnRec = document.getElementById('btnRec');
let recorder = null;
btnRec.addEventListener('click', () => {
  if (recorder) return;
  try {
    startLoopForAbility(); // clean take from the top of the loop
    const stream = renderer.domElement.captureStream(30);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${ctx ? ctx.id : 'ability'}_vfx.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      recorder = null;
      btnRec.classList.remove('on');
      btnRec.textContent = 'Clip 6s';
    };
    recorder.start();
    btnRec.classList.add('on');
    btnRec.textContent = 'Recording…';
    setTimeout(
      () => {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      },
      comboOn ? 16000 : 6000,
    ); // combos record the whole chain
  } catch (e) {
    console.warn('[clip] recording unavailable:', e?.message ?? e);
    recorder = null;
  }
});
const btnAB = document.getElementById('btnAB');
function updateAbBtn() {
  // appears only once a generated pack is actually loaded
  btnAB.style.display = sfx.packLoaded ? '' : 'none';
  btnAB.classList.toggle('on', sfx.sampleMode);
  btnAB.textContent = sfx.sampleMode ? 'SFX: Generated' : 'SFX: Synth';
}
btnAB.addEventListener('click', () => {
  sfx.sampleMode = !sfx.sampleMode;
  updateAbBtn();
});
const btnSnd = document.getElementById('btnSound');
btnSnd.addEventListener('click', () => {
  sndOn = !sndOn;
  if (sndOn) {
    sfx.enable();
    sfx.ambienceStart();
  } else {
    sfx.chargeStop();
    sfx.sizzleStop();
    sfx.beamStop();
    sfx.ambienceStop();
  }
  btnSnd.classList.toggle('on', sndOn);
  btnSnd.textContent = sndOn ? 'Sound on' : 'Sound off';
});

// ---------------------------------------------------------------- main loop
let lastMs = performance.now();
let perfNow = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.05, (nowMs - lastMs) / 1000);
  lastMs = nowMs;
  perfNow += realDt;

  timeScale = (slowMo ? 0.25 : userTimeScale) * (cineOn && perfNow < cineAutoUntil ? 0.35 : 1);
  let dt = realDt * timeScale;
  if (hitstopLeft > 0) {
    hitstopLeft -= realDt;
    dt = realDt * 0.04;
  } else if (perfNow < critSlowUntil) {
    // speed-ramp: near-frozen at the hit, easing back to full speed
    const ramp = 0.15 + easeOutCubic(clamp01((perfNow - critSlowStart) / 0.7)) * 0.85;
    dt = realDt * ramp;
  }

  stateT += dt;
  if (rig) rig.mixer.update(dt);
  ribbons.begin();
  updateAurora(dt); // sky first, never clipped by bolt spam
  updateSimTimeouts(dt);

  if (ctx && rig) {
    if (state === 'idle') {
      // ambient sky flicker
      skyFlickerNext -= dt;
      if (skyFlickerNext <= 0) {
        skyFlickerNext = rr(0.5, 1.6);
        hemi.intensity = HEMI_BASE + rr(0.3, 0.9);
        if (sndOn && rnd() < 0.4) sfx.distantRumble();
      }
      totemGlow = Math.max(0.18, totemGlow - dt * 2);
      targetGlow = Math.max(0, targetGlow - dt * 3);
      shellGlow = Math.max(0, shellGlow - dt * 3);
      casterGlowV = Math.max(0, casterGlowV - dt * 2);
      scorchAlpha = Math.max(0, scorchAlpha - dt * 0.5);
      crackMat.uniforms.uHdr.value = Math.max(0, crackMat.uniforms.uHdr.value - dt * 2);
      // combos chain tight, except the last beat, which takes a held breath
      // (the audio is already ducked) so the finisher lands as THE moment
      const idleHold = comboOn ? (comboIx === COMBOS[ctx.cls].length - 1 ? 0.5 : 0.18) : 0.8;
      if (stateT >= idleHold) {
        setState('windup');
        ctx.arch.begin();
      }
    } else if (state === 'windup') {
      const p = clamp01(stateT / ctx.windup);
      ctx.arch.windup(p, dt);
      if (ctx.windup > 1) totemGlow = 0.18 + easeInCubic(p) * 2.1;
      if (stateT >= ctx.windup) {
        setState('release');
        ctx.arch.release();
        runMotifs(
          'release',
          ctx.self || ctx.arch.self ? casterChest(new THREE.Vector3()) : dummy.hitPos.clone(),
        );
        bodyLeanVel += 0.9; // release recoil snaps the body back
        setTimeoutSim(0.15, hideOrb); // no windup style leaves a stale glow
        if (ctx.shaft) {
          ctx.shaft.end();
          ctx.shaft = null;
        }
        const spr = ctx.spec.spirit;
        if (spr && (spr.at ?? 'caster') === 'caster') {
          const critScale = isCrit && ctx.arch.canCrit ? 1.25 : 1;
          spawnSpirit({
            ...spr,
            scale: (spr.scale ?? 1) * critScale,
            at: new THREE.Vector3(rig.group.position.x, 0, rig.group.position.z),
            dirX: 1,
            atKind: 'caster',
            follow: ctx.spec.archetype === 'dash', // dash spirits run WITH the caster
          });
        }
      }
    } else if (state === 'release') {
      if (stateT >= 0.1) {
        runeDissolve = Math.min(1, runeDissolve + dt * 6);
        runeMat.uniforms.uDissolve.value = runeDissolve;
        if (ctx.arch.channel) setState('channel');
        else if (ctx.arch.travel) setState('travel');
        else {
          setState('aftermath');
          idleResumed = false;
          doImpact();
        }
      }
    } else if (state === 'travel') {
      if (ctx.arch.travel.tick(dt)) {
        setState('aftermath');
        idleResumed = false;
        doImpact();
      }
    } else if (state === 'channel') {
      if (ctx.arch.channelTick(dt)) {
        setState('aftermath');
        idleResumed = false;
        doImpact();
      }
    } else if (state === 'aftermath') {
      let dur = Math.max(ctx.spec.linger ?? 0, ctx.arch.aftermathDur);
      if (comboOn) {
        // rhythm: quiet beats stay SHORT (the bleed survives via the long burn),
        // the finisher gets room to be admired
        dur = comboIx === COMBOS[ctx.cls].length - 1 ? dur * 1.1 : Math.min(dur, 1.4);
      }
      ctx.arch.aftermath(clamp01(stateT / dur), dt);
      if (stateT >= dur) loopEnd();
    }
  }

  // flash sprites fade on the sim clock in EVERY state, beam ticks and combo
  // transitions spawn them outside 'aftermath' and they must never freeze
  if (releaseFlash.visible) {
    releaseFlash.userData.age += dt;
    const rp = clamp01(releaseFlash.userData.age / 0.1);
    releaseFlash.scale.setScalar(
      (2.2 + easeOutCubic(rp) * 3.4) * (releaseFlash.userData.scale ?? 1),
    );
    releaseFlash.material.opacity = (1 - rp) ** 1.2;
    if (rp >= 1) releaseFlash.visible = false;
  }
  if (impactFlash.visible) {
    impactFlash.userData.age += dt;
    const ip = clamp01(impactFlash.userData.age / 0.12);
    impactFlash.scale.setScalar((1.9 + easeOutCubic(ip) * 2.6) * (impactFlash.userData.mul ?? 1));
    impactFlash.material.opacity = (1 - ip) ** 1.5 * 0.85;
    if (ip >= 1) impactFlash.visible = false;
  }

  // ALL ribbon writers must run between begin() and commit(), spirits, buff
  // orbits (wings/speedlines) and aurora included. Aurora writes FIRST so bolt
  // spam can never clip the sky out of the budget.
  updateBoltFx(dt);
  updateStreaks(dt);
  updateSpirits(dt);
  updateBuffOrbit(dt);
  ribbons.commit();
  sparkPool.update(dt);
  emberPool.update(dt);
  riserPool.update(dt);
  debrisPool.update(dt);
  smolderPool.update(dt);
  updateRings(dt);
  updateFlipbooks(dt);
  updateSmokes(dt);
  updateDrips(dt);
  updateOrbiters(dt);
  updateBurn(dt);
  updateFootprints(dt);
  updateShafts(dt);
  updateContactShadows(dt);
  updateDistortion(dt, realDt);
  updateBodyFeel(dt, realDt);
  lightPulses.update(dt);
  updateCameraFeel(dt, realDt);
  sfx.frame(timeScale); // slow-mo bends the pitch of live loops
  renderer.toneMappingExposure = 1.2 * (perfNow < expoDipUntil ? 0.86 : 1);

  for (const m of totemMats) m.emissiveIntensity = totemGlow;
  // body emissive carries the hit read, subtle enough that per-ability impact
  // sculpting stays visible; combo wear leaves the dummy progressively battered
  for (const m of dummy.mats)
    m.emissiveIntensity = Math.max(targetGlow * 0.28, comboOn ? comboWear * 0.35 : 0);
  dummy.shellMat.uniforms.uIntensity.value = shellGlow;
  dummy.shellMat.uniforms.uTime.value = perfNow % 3600;
  dummy.shell.visible = shellGlow > 0.02 && !!ctx?.spec.barrier; // shells are for BARRIERS only
  if (rig) {
    // caster read: body-conforming rim glow on the rig's own materials, the
    // capsule shell is reserved for true barrier specs
    const gi = Math.min(0.85, casterGlowV * 0.38); // rim accents the body, never repaints it
    for (const m of rig.mats) {
      m.emissive.copy(rigGlowColor);
      m.emissiveIntensity = gi;
    }
    casterShell.position.set(rig.group.position.x, 1.45, rig.group.position.z);
    casterShellMat.uniforms.uIntensity.value = casterGlowV;
    casterShellMat.uniforms.uTime.value = perfNow % 3600;
    casterShell.visible = casterGlowV > 0.02 && !!ctx?.spec.barrier;
  }
  orbShellMat.uniforms.uTime.value = perfNow % 3600;
  scorchDark.material.opacity = scorchAlpha;
  crackMesh.visible = crackMat.uniforms.uHdr.value > 0.02;
  groundCloudT.value = perfNow % 3600;
  // storm windups dim the whole sky, the weather answers the shaman
  const hemiTarget =
    HEMI_BASE *
    (state === 'windup' && ctx && ctx.palName === 'storm'
      ? 1 - 0.45 * clamp01(stateT / ctx.windup)
      : 1);
  hemi.intensity += (hemiTarget - hemi.intensity) * Math.min(1, realDt * 6);
  for (const sp of window._mist) {
    sp.position.x += sp.userData.vx * realDt;
    if (sp.position.x > 18) sp.position.x = -18;
  }

  flashVal = Math.max(0, flashVal - realDt * 3.2);
  flashEl.style.opacity = flashVal.toFixed(3);

  if (cineOn && ctx && rig) {
    // showcase camera: slow orbit around wherever the action is, and across a
    // combo it BUILDS: tighter, lower, faster with every beat toward the kill
    const comboT = comboOn && COMBOS[ctx.cls] ? comboIx : 0;
    cineAngle += realDt * (0.32 + comboT * 0.12);
    const focusTarget =
      state === 'travel' && !ctx.arch.melee && ctx.spec.archetype === 'bolt'
        ? projPos
        : state === 'aftermath' && !ctx.self
          ? dummy.hitPos
          : casterChest(tmpB);
    cineFocus.lerp(focusTarget, 1 - Math.exp(-realDt * 3));
    const targetR =
      (cineShotIn ? 4.6 - comboT * 0.45 : 8.6 - comboT * 1.05) + Math.sin(perfNow * 0.4) * 1.1;
    cineRadius += (targetR - cineRadius) * (1 - Math.exp(-realDt * 7)); // whip between shots
    camera.position.set(
      cineFocus.x + Math.cos(cineAngle) * cineRadius,
      (cineShotIn ? 2.1 : 3) - comboT * 0.28 + Math.sin(perfNow * 0.27) * 0.7,
      cineFocus.z + Math.sin(cineAngle) * cineRadius,
    );
    camera.lookAt(cineFocus);
  } else {
    controls.update();
  }
  composer.render();
}
requestAnimationFrame(frame);

// boot: the flagship Arc Bolt
fillAbilities('shaman');
selClass.value = 'shaman';
await setAbility('shaman', 'lightning_bolt');
// prewarm every flipbook sheet off the impact frame (kills first-hit hitches)
for (const s of new Set(Object.values(PAL_STYLE).map((p) => p.sheet)))
  renderer.initTexture(flipbookSheet(s));

// probe hook for E2E scripts
window.__ab = {
  get state() {
    return state;
  },
  get t() {
    return stateT;
  },
  get gl() {
    return glName;
  },
  get textures() {
    return renderer.info.memory.textures;
  },
  get spirits() {
    return spirits.length;
  },
  get spec() {
    return ctx ? ctx.spec : null;
  },
  get sfxSamples() {
    return sfx.samples.size;
  }, // generated-pack health for probes
  get sfxMode() {
    return sfx.sampleMode;
  },
  get buffs() {
    return buffOrbits.size;
  }, // live persistent-buff count (stacking proofs)
  testSpirit(model) {
    return spawnSpirit({ model, at: new THREE.Vector3(0, 0, 2), path: 'rise', scale: 1.3, dur: 6 });
  },
  composeShot() {
    // frame the current moment like a cinematographer, per archetype
    if (!ctx || !rig) return;
    const arch = ctx.spec.archetype;
    const hp = dummy.hitPos;
    const cx = rig.group.position.x;
    let pos, look;
    if (state === 'windup' || state === 'release') {
      // ALL windup FX live on the caster, frame them low and close against the
      // darkened sky (a windup shot aimed at the target is a black frame)
      pos = [cx + 4.6, 2.0, 5.2];
      look = [cx + 0.3, 1.5, 0];
    } else if (state === 'travel' && arch === 'bolt') {
      // ride with the projectile and LEAD it, the bolt is the subject
      pos = [projPos.x - 1.6, Math.max(1.6, projPos.y + 0.9), 6.8];
      look = [projPos.x + 1.6, Math.max(0.9, projPos.y - 0.1), 0];
    } else if (spirits.length > 0) {
      // a live apparition owns the frame: split it with whoever it stands
      // beside (a target-side stag during a self-buff pairs with the DUMMY)
      const sp = spirits[0].holder.position;
      const anchor = Math.abs(sp.x - hp.x) < Math.abs(sp.x - cx) ? hp.x : cx;
      const mx = (sp.x + anchor) / 2;
      pos = [mx - 3.2, 2.3, 7.4];
      look = [mx, 1.35, 0];
    } else if (ctx.arch.melee || arch === 'dash') {
      pos = [hp.x - 4.4, 2.5, 5];
      look = [hp.x - 0.7, 1.55, 0];
    } else if (arch === 'nova' || arch === 'shout') {
      const nx = ctx.novaCenter ? ctx.novaCenter.x : cx;
      pos = [nx + 3, 4.8, 8.2];
      look = [nx, 1.1, 0];
    } else if (ctx.self || arch === 'heal' || arch === 'buff' || arch === 'summon') {
      pos = [cx + 4.6, 2.2, 5.4];
      look = [cx + 0.3, 1.8, 0];
    } else if (state === 'channel') {
      // wide enough that BOTH actors and the full beam live in the frame
      const mx = (cx + hp.x) / 2;
      pos = [mx, 3.4, 14.5];
      look = [mx, 1.5, 0];
    } else {
      pos = [hp.x - 5.6, 2.7, 6.4];
      look = [hp.x - 1.2, 1.7, 0];
    }
    camera.position.set(pos[0], pos[1], pos[2]);
    camera.lookAt(look[0], look[1], look[2]);
  },
  prewarmSpirits() {
    return Promise.all(Object.values(SPIRIT_URLS).map((u) => loadGlb(u).catch(() => null)));
  },
  get current() {
    return ctx ? { cls: ctx.cls, id: ctx.id, archetype: ctx.spec.archetype } : null;
  },
  list() {
    return Object.fromEntries(Object.entries(CATALOG).map(([c, l]) => [c, l.map((a) => a.id)]));
  },
  setAbility(cls, id) {
    return setAbility(cls, id);
  },
  shot() {
    composer.render();
    return renderer.domElement.toDataURL('image/png');
  },
};
