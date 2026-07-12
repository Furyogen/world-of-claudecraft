// Ambient VFX for the hover cosmetics (back wings / jetpack): authored
// WeaponVfxSpec records rendered through the SAME createWeaponVfx rig the
// Season 1 weapon skins use (the rig only reads the spec's fx/light/emissive;
// it does not care that the anchor payload is a pair of wings instead of a
// sword). Anchors use {yF} fractions of the payload bounds, so they track the
// generated models without hand-measured offsets.
//
// Per-attachment offsets for the back mount live here too: the Tripo prop
// models are centered on origin facing +Z, so each def places itself against
// the chest bone (slightly behind the torso, facing out the back).

import type { HoverVfxKind } from '../sim/content/hover_cosmetics';
import type { WeaponVfxSpec } from './weapon_vfx';

// Butterfly: pastel iridescents. Angel: warm dawn golds. Jet: fire.
const C = {
  teal: 0x7de8ff,
  violet: 0xb18cff,
  pink: 0xffb3e6,
  gold: 0xffd27a,
  white: 0xfff6e0,
  flame: 0xff9c3a,
  ember: 0xff5a2a,
  smoke: 0x8a8a92,
};

/** How each attachment sits against the chest bone (model faces +Z; the back
 *  mount turns it to face out the back and tucks it behind the torso). */
export interface HoverAttach {
  pos: [number, number, number];
  rotY: number;
  scale: number;
}

export const HOVER_ATTACH: Record<string, HoverAttach> = {
  hover_butterfly_wings: { pos: [0, 0.0, -0.17], rotY: Math.PI, scale: 1.22 },
  hover_angel_wings: { pos: [0, 0.02, -0.17], rotY: Math.PI, scale: 1.18 },
  hover_jetpack: { pos: [0, 0.12, -0.2], rotY: Math.PI, scale: 1 },
};

/** Flap motion per attachment (wing.l / wing.r hinge rotation about the
 *  central mount); a rigid attachment (jetpack) has none. */
export const HOVER_FLAP: Record<string, { speed: number; amp: number } | undefined> = {
  hover_butterfly_wings: { speed: 9, amp: 0.5 },
  hover_angel_wings: { speed: 3.4, amp: 0.28 },
  hover_jetpack: undefined,
};

export const HOVER_VFX: Record<HoverVfxKind, WeaponVfxSpec> = {
  sparkle: {
    tier: 'rare',
    name: 'Butterfly Drift',
    type: 'wand',
    lore: 'Iridescent dust drifts from the wingbeats.',
    light: { at: { yF: 0.5 }, intensity: 3.5 },
    fx: [
      {
        kind: 'drift',
        line: [{ yF: 0.2 }, { yF: 0.85 }],
        count: 22,
        vel: [0, -0.12, 0],
        spread: [0.28, 0.1, 0.1],
        life: [1.0, 2.0],
        size: [0.014, 0.034],
        grow: 0.25,
        swirl: 0.08,
        colorA: C.teal,
        colorB: C.violet,
        opacity: 0.85,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.1, count: 26 },
        size: [0.02, 0.045],
        rate: [0.5, 1.3],
        color: C.pink,
        star: true,
      },
    ],
  },
  feather: {
    tier: 'rare',
    name: 'Dawnfeather Wings',
    type: 'wand',
    lore: 'A soft dawn glow clings to the feathers.',
    light: { at: { yF: 0.55 }, intensity: 3 },
    fx: [
      {
        kind: 'drift',
        line: [{ yF: 0.15 }, { yF: 0.8 }],
        count: 14,
        vel: [0, -0.16, 0],
        spread: [0.3, 0.08, 0.08],
        life: [1.4, 2.6],
        size: [0.018, 0.04],
        grow: 0.2,
        swirl: 0.05,
        colorA: C.white,
        colorB: C.gold,
        opacity: 0.8,
      },
      {
        kind: 'twinkles',
        surface: { yMinF: 0.1, count: 18 },
        size: [0.02, 0.04],
        rate: [0.4, 1.0],
        color: C.gold,
        star: true,
      },
    ],
  },
  flame: {
    tier: 'rare',
    name: "Tinker's Jetpack",
    type: 'wand',
    lore: 'Twin thrusters idle on a low blue-orange burn.',
    light: { at: { yF: 0.12 }, intensity: 5 },
    fx: [
      // Thruster wash: fast, short-lived fire pushed DOWN out of the nozzles.
      {
        kind: 'drift',
        line: [{ yF: 0.02 }, { yF: 0.1 }],
        count: 30,
        vel: [0, -1.1, 0],
        spread: [0.14, 0.05, 0.06],
        life: [0.25, 0.5],
        size: [0.02, 0.05],
        grow: 0.5,
        swirl: 0.02,
        colorA: C.flame,
        colorB: C.ember,
        opacity: 0.95,
      },
      // Lazy smoke puffs trailing above the wash.
      {
        kind: 'drift',
        line: [{ yF: 0.0 }, { yF: 0.06 }],
        count: 10,
        vel: [0, -0.45, 0],
        spread: [0.12, 0.05, 0.08],
        life: [0.8, 1.5],
        size: [0.03, 0.07],
        grow: 0.9,
        swirl: 0.05,
        colorA: C.smoke,
        colorB: C.smoke,
        opacity: 0.4,
      },
    ],
  },
};
