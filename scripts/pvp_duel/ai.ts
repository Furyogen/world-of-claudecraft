// The duel bot: one shared engine (movement, kiting, interrupts, the PvP
// trinket, cast bookkeeping) driving a per-spec priority list.
//
// Every press goes through the real `Sim.castAbility` path, so cooldowns, GCD,
// costs, range, line of sight, facing, diminishing returns and the spell queue
// are the engine's own. A press only counts when the caster's state actually
// changed (the balance probes' fingerprint rule, scripts/owned_class_balance_probe.ts),
// so a refused press falls through to the next rule in the same tick.
//
// The bot is deliberately one skill level for everyone: it reacts on the tick
// (no human reaction delay), interrupts every enemy cast it can, uses defensives
// on fixed health thresholds, and kites only with the tools its spec has. It
// does not juke casts, line-of-sight pillar, or fake-cast. Read the results as
// "kits played competently by the same player", not as a ladder of human skill.

import { isStunned } from '../../src/sim/combat/cc';
import { ruinAmount } from '../../src/sim/combat/destruction';
import { soulFragmentCount as soulFragments } from '../../src/sim/combat/necromancy';
import type { Sim } from '../../src/sim/sim';
import { canDetectStealthedTarget } from '../../src/sim/threat';
import {
  type Entity,
  emptyMoveInput,
  MELEE_RANGE,
  normAngle,
  steadyAngleTo,
} from '../../src/sim/types';
import type { SpecBuild } from './builds';
import { PVP_TRINKET } from './builds';

export interface DuelCtx {
  sim: Sim;
  me: Entity;
  foe: Entity;
  build: SpecBuild;
  foeBuild: SpecBuild;
  dist: number;
  t: number; // seconds since the duel went active
  st: BotState;
}

export interface BotState {
  kiting: boolean;
  kiteUntil: number;
  casts: Record<string, number>;
  lastPoly: number;
  trinketUses: number;
  lastPress: Record<string, number>;
}

export function freshBotState(): BotState {
  return { kiting: false, kiteUntil: 0, casts: {}, lastPoly: -999, trinketUses: 0, lastPress: {} };
}

type Cond = (c: DuelCtx) => boolean;
type On = 'foe' | 'self' | 'groundFoe' | 'groundSelf';

export interface Rule {
  id: string;
  if?: Cond;
  on?: On;
  /** Usable while running from a melee attacker (an instant escape or peel). */
  kite?: boolean;
  /** Minimum seconds between accepted presses (a cast-time CC the bot would
   *  otherwise re-start into pushback every GCD). */
  every?: number;
}

export interface SpecAi {
  /** Cast out of combat before the countdown ends, in order. */
  prep: string[];
  rules: Rule[];
  /** Preferred fighting distance in yards; 0 means melee. */
  range: number;
  /** Ranged kits step away from a controlled or slowed melee attacker. */
  kite: boolean;
  /** Hunter: a beast companion through the ordinary pet restore path. */
  hunterPet?: boolean;
}

// ---- predicates -------------------------------------------------------------

const H = (c: DuelCtx) => c.me.hp / c.me.maxHp;
const FH = (c: DuelCtx) => c.foe.hp / c.foe.maxHp;
const hpBelow =
  (f: number): Cond =>
  (c) =>
    H(c) < f;
const foeHpBelow =
  (f: number): Cond =>
  (c) =>
    FH(c) < f;
const kindOn = (e: Entity, kind: string) => e.auras.some((a) => a.kind === kind);
const idOn = (e: Entity, id: string) => e.auras.some((a) => a.id === id);
const mineOn = (c: DuelCtx, e: Entity, id: string) =>
  e.auras.some((a) => a.id.startsWith(id) && a.sourceId === c.me.id);
const foeCasting: Cond = (c) => c.foe.castingAbility !== null;
const foeMelee: Cond = (c) => c.foeBuild.archetype === 'melee';
const within =
  (yd: number): Cond =>
  (c) =>
    c.dist <= yd;
const beyond =
  (yd: number): Cond =>
  (c) =>
    c.dist > yd;
const foeSlowed: Cond = (c) => kindOn(c.foe, 'slow') || kindOn(c.foe, 'root') || isStunned(c.foe);
const foeHardCc: Cond = (c) => isStunned(c.foe);
const foeNotCc: Cond = (c) => !isStunned(c.foe);
const stealthed: Cond = (c) => c.me.stealthed;
const cp =
  (n: number): Cond =>
  (c) =>
    c.me.comboPoints >= n;
const resPct = (c: DuelCtx) => c.me.resource / Math.max(1, c.me.maxResource);
const manaBelow =
  (f: number): Cond =>
  (c) =>
    resPct(c) < f;
const noAbsorb: Cond = (c) => !kindOn(c.me, 'absorb');
const all =
  (...cs: Cond[]): Cond =>
  (c) =>
    cs.every((f) => f(c));
const any =
  (...cs: Cond[]): Cond =>
  (c) =>
    cs.some((f) => f(c));
const not =
  (f: Cond): Cond =>
  (c) =>
    !f(c);
/** A pet or minion of the foe (hunter beast, demon, undead) on top of me. */
const petClose: Cond = (c) => {
  for (const e of c.sim.entities.values()) {
    if (e.ownerId !== c.foe.id || e.dead) continue;
    if (Math.hypot(e.pos.x - c.me.pos.x, e.pos.z - c.me.pos.z) <= 6) return true;
  }
  return false;
};
/** Melee pressure: the foe itself in melee, or its pets/minions. */
const meleeClose = any(all(foeMelee, within(8)), petClose);
const noDot =
  (id: string): Cond =>
  (c) =>
    !mineOn(c, c.foe, id);
const stacks = (e: Entity, id: string) => e.auras.find((a) => a.id === id)?.stacks ?? 0;
const auraUp =
  (id: string): Cond =>
  (c) =>
    idOn(c.me, id);
const ownRemaining = (c: DuelCtx, id: string) =>
  c.foe.auras.find((a) => a.id === id && a.sourceId === c.me.id)?.remaining ?? 0;
const after =
  (s: number): Cond =>
  (c) =>
    c.t >= s;

// ---- per-spec priority lists ------------------------------------------------

const WARRIOR_COMMON_TOP: Rule[] = [
  { id: 'avatar', if: (c) => isStunned(c.me) || (c.t > 2 && FH(c) < 0.85) },
  { id: 'die_by_sword', if: hpBelow(0.4) },
  { id: 'charge', if: beyond(8) },
  {
    id: 'heroic_leap',
    on: 'groundFoe',
    if: all(beyond(10), (c) => (c.me.cooldowns.get('charge') ?? 0) > 0),
  },
  { id: 'pummel', if: foeCasting },
  { id: 'storm_bolt', if: all(foeNotCc, any(foeCasting, beyond(6), hpBelow(0.6))) },
  { id: 'bloodrage', if: (c) => c.me.resource < 30 },
  { id: 'berserker_rage', if: (c) => c.me.resource < 30 },
  { id: 'intimidating_shout', if: all(hpBelow(0.3), within(8), foeNotCc) },
  { id: 'rallying_cry', if: hpBelow(0.3) },
  { id: 'hamstring', if: all(not(foeSlowed), within(5)) },
];

const WARRIOR_ARMS: SpecAi = {
  prep: ['battle_stance', 'battle_shout'],
  range: 0,
  kite: false,
  rules: [
    ...WARRIOR_COMMON_TOP,
    { id: 'sweeping_strikes' },
    { id: 'execute', if: foeHpBelow(0.2) },
    { id: 'mortal_strike' },
    { id: 'overpower' },
    { id: 'breachmaker' },
    { id: 'slam' },
  ],
};
const WARRIOR_FURY: SpecAi = {
  prep: ['berserker_stance', 'battle_shout'],
  range: 0,
  kite: false,
  rules: [
    ...WARRIOR_COMMON_TOP,
    { id: 'furious_mending', if: hpBelow(0.5) },
    { id: 'emboldening_roar', if: after(2) },
    { id: 'execute', if: foeHpBelow(0.2) },
    { id: 'bloodthirst' },
    { id: 'raging_gale' },
    { id: 'red_harvest' },
    { id: 'whirlwind' },
  ],
};
const WARRIOR_PROT: SpecAi = {
  prep: ['defensive_stance', 'battle_shout'],
  range: 0,
  kite: false,
  rules: [
    ...WARRIOR_COMMON_TOP,
    { id: 'raised_guard', if: hpBelow(0.75) },
    { id: 'iron_resolve', if: hpBelow(0.6) },
    { id: 'faultline', if: within(8) },
    { id: 'demoralizing_shout', if: all(foeMelee, within(8)) },
    { id: 'execute', if: foeHpBelow(0.2) },
    { id: 'shield_slam' },
    { id: 'revenge' },
    { id: 'thunder_clap', if: within(8) },
    { id: 'sunder_armor' },
  ],
};

const PALADIN_DEFENSIVE: Rule[] = [
  { id: 'lay_on_hands', on: 'self', if: hpBelow(0.2) },
  { id: 'divine_protection', if: hpBelow(0.5) },
  { id: 'avenging_wrath', if: any(hpBelow(0.6), foeHpBelow(0.6)) },
  { id: 'divine_ascension' },
  {
    id: 'hammer_of_justice',
    kite: true,
    if: all(foeNotCc, any(foeCasting, hpBelow(0.55), foeHpBelow(0.4))),
  },
  { id: 'hushbrand', if: foeCasting },
];

const PALADIN_HOLY: SpecAi = {
  prep: ['devotion_ward', 'radiant_devotion', 'sacred_form'],
  range: 20,
  kite: true,
  rules: [
    ...PALADIN_DEFENSIVE,
    { id: 'life_covenant', on: 'self', if: hpBelow(0.6) },
    { id: 'aegis_first_dawn', if: hpBelow(0.35) },
    { id: 'solar_invocation', on: 'self', if: hpBelow(0.75) },
    { id: 'holy_light', on: 'self', if: hpBelow(0.65) },
    { id: 'radiant_chorus', if: hpBelow(0.7) },
    { id: 'dawns_embrace', on: 'self', if: all(hpBelow(0.5), not(meleeClose)) },
    { id: 'hammer_of_grace' },
    { id: 'solar_invocation', if: (c) => H(c) >= 0.75 },
    { id: 'mercy_lance' },
  ],
};
const PALADIN_PROT: SpecAi = {
  prep: ['devotion_ward', 'dawn_devotion'],
  range: 0,
  kite: false,
  rules: [
    ...PALADIN_DEFENSIVE,
    { id: 'oath_chain', if: beyond(8) },
    { id: 'holy_shield' },
    { id: 'bastion_rite', if: hpBelow(0.7) },
    { id: 'veilbound_march', if: beyond(10) },
    { id: 'holy_light', on: 'self', if: hpBelow(0.3) },
    { id: 'vowkeeper_strike' },
    { id: 'sunward_disc' },
    { id: 'hammer_of_grace' },
    { id: 'bastion_sweep', if: within(8) },
    { id: 'consecration', if: within(6) },
  ],
};
const PALADIN_RET: SpecAi = {
  prep: ['devotion_ward', 'dawn_devotion'],
  range: 0,
  kite: false,
  rules: [
    ...PALADIN_DEFENSIVE,
    { id: 'faithforged_guard', if: hpBelow(0.6) },
    { id: 'guardian_covenant', on: 'self', if: hpBelow(0.5) },
    { id: 'solar_step', if: all(beyond(8), (c) => kindOn(c.me, 'slow')) },
    { id: 'holy_light', on: 'self', if: hpBelow(0.3) },
    { id: 'sun_gods_verdict' },
    { id: 'valkyrs_calling' },
    { id: 'hammer_of_wrath' },
    { id: 'final_edict' },
    { id: 'hammer_of_grace' },
    { id: 'dawnfall', if: within(8) },
    { id: 'consecration', if: within(6) },
  ],
};

const HUNTER_COMMON: Rule[] = [
  { id: 'shellskin', if: hpBelow(0.3) },
  { id: 'wildheart', if: hpBelow(0.5) },
  {
    id: 'trailbreak',
    kite: true,
    if: all(meleeClose, (c) => kindOn(c.me, 'root') || kindOn(c.me, 'slow')),
  },
  { id: 'counter_shot', if: foeCasting },
  { id: 'frostjaw_trap', kite: true, on: 'groundSelf', if: all(foeMelee, within(6)) },
  { id: 'wing_clip', kite: true, if: all(within(5), not(foeSlowed)) },
  { id: 'concussive_shot', kite: true, if: all(foeMelee, not(foeSlowed), beyond(5)) },
];
const HUNTER_BM: SpecAi = {
  prep: ['aspect_of_the_hawk'],
  range: 30,
  kite: true,
  hunterPet: true,
  // Damage core from the Packlord balance probe (scripts/owned_class_balance_probe.ts).
  rules: [
    ...HUNTER_COMMON,
    { id: 'stampede', if: (c) => stacks(c.me, 'hunter_ferocity') >= 3 },
    {
      id: 'pack_command',
      if: (c) => c.sim.resolvedAbility('pack_command', c.me.id)?.def.id === 'unleash_beast',
    },
    { id: 'bestial_wrath' },
    { id: 'arcane_shot', if: (c) => c.me.resource >= 75 },
    { id: 'pack_command' },
    { id: 'serpent_sting', if: noDot('serpent_sting') },
    { id: 'arcane_shot' },
  ],
};
const HUNTER_MM: SpecAi = {
  prep: ['aspect_of_the_hawk'],
  range: 30,
  kite: true,
  hunterPet: true,
  // Damage core from the Coldsight balance probe.
  rules: [
    ...HUNTER_COMMON,
    { id: 'cold_focus' },
    { id: 'rapid_fire' },
    { id: 'aimed_shot' },
    { id: 'serpent_sting', if: noDot('serpent_sting') },
    { id: 'arcane_shot' },
    { id: 'measured_shot' },
  ],
};
const HUNTER_SV: SpecAi = {
  prep: ['aspect_of_the_hawk'],
  range: 0,
  kite: false,
  hunterPet: true,
  // Damage core from the Fieldcraft balance probe: open the Bloodhook wound,
  // Shrapnel on it, Mongoose at three Momentum or a fading wound, Raptor filler.
  rules: [
    { id: 'shellskin', if: hpBelow(0.3) },
    { id: 'wildheart', if: hpBelow(0.5) },
    { id: 'counter_shot', if: foeCasting },
    { id: 'trailbreak', if: all(beyond(5), (c) => kindOn(c.me, 'root') || kindOn(c.me, 'slow')) },
    { id: 'bloodtrail_assault' },
    { id: 'bloodhook', if: (c) => ownRemaining(c, 'bloodhook_bleed') <= 0 && c.dist >= 6 },
    { id: 'wing_clip', if: all(within(5), not(foeSlowed)) },
    { id: 'concussive_shot', if: all(not(foeSlowed), beyond(6)) },
    { id: 'shrapnel_charge', if: (c) => ownRemaining(c, 'bloodhook_bleed') > 0 },
    {
      id: 'mongoose_bite',
      if: (c) =>
        ownRemaining(c, 'bloodhook_bleed') > 0 &&
        (stacks(c.me, 'hunting_momentum') >= 3 || ownRemaining(c, 'bloodhook_bleed') <= 3),
    },
    { id: 'raptor_strike' },
    { id: 'mongoose_bite' },
    { id: 'serpent_sting', if: all(noDot('serpent_sting'), beyond(6)) },
    { id: 'arcane_shot', if: beyond(6) },
  ],
};

const ROGUE_OPEN: Rule[] = [
  { id: 'cheap_shot', if: stealthed },
  { id: 'shadowstep', if: all(beyond(8), not(stealthed)) },
  { id: 'sprint', if: beyond(15) },
  { id: 'kick', if: foeCasting },
  { id: 'gouge', if: all(foeCasting, foeNotCc) },
  { id: 'vanish', if: hpBelow(0.25) },
  { id: 'evasion', if: all(hpBelow(0.55), foeMelee) },
  { id: 'blind', if: all(hpBelow(0.35), foeNotCc) },
  { id: 'kidney_shot', if: all(cp(4), foeNotCc) },
  { id: 'crippling_poison', if: all(not(foeSlowed), not(foeMelee)) },
];
const ROGUE_ASSN: SpecAi = {
  prep: ['deadly_poison', 'stealth'],
  range: 0,
  kite: false,
  // Damage core from the rogue DPS probe (scripts/rogue_dps_probe.ts).
  rules: [
    ...ROGUE_OPEN,
    { id: 'adrenaline_rush' },
    { id: 'cold_blood' },
    { id: 'venom_dart', if: (c) => c.me.comboPoints < 5 && idOn(c.me, 'venom_ritual') },
    { id: 'slice_and_dice', if: all(cp(2), (c) => !idOn(c.me, 'slice_and_dice')) },
    { id: 'rupture', if: all(cp(5), noDot('rupture'), (c) => FH(c) > 0.35) },
    { id: 'eviscerate', if: any(cp(5), all(cp(3), foeHpBelow(0.15))) },
    { id: 'venom_dart', if: beyond(6) },
    { id: 'backstab' },
    { id: 'sinister_strike' },
  ],
};
const ROGUE_COMBAT: SpecAi = {
  prep: ['deadly_poison', 'stealth'],
  range: 0,
  kite: false,
  rules: [
    ...ROGUE_OPEN,
    { id: 'blade_flurry' },
    { id: 'adrenaline_rush' },
    {
      id: 'eviscerate',
      if: (c) => {
        const red = c.me.auras.find((a) => a.id === 'redline');
        if (!red) return false;
        const closing = red.remaining < 1.6;
        return (
          (c.me.comboPoints >= 5 && ((red.stacks ?? 1) >= 4 || closing)) ||
          (c.me.comboPoints >= 4 && closing)
        );
      },
    },
    { id: 'slice_and_dice', if: all(cp(2), (c) => !idOn(c.me, 'slice_and_dice')) },
    { id: 'eviscerate', if: any(cp(5), all(cp(3), foeHpBelow(0.15))) },
    { id: 'venom_dart', if: beyond(6) },
    { id: 'sinister_strike' },
  ],
};
const ROGUE_SUB: SpecAi = {
  prep: ['deadly_poison', 'stealth'],
  range: 0,
  kite: false,
  rules: [
    ...ROGUE_OPEN,
    { id: 'adrenaline_rush' },
    { id: 'ambush', if: (c) => stacks(c.me, 'gloam') >= 3 && !idOn(c.me, 'veilstrike') },
    {
      id: 'cheap_shot',
      if: (c) => idOn(c.me, 'veilstrike') && c.me.resource >= 60 && c.me.comboPoints <= 3,
    },
    { id: 'slice_and_dice', if: all(cp(2), (c) => !idOn(c.me, 'slice_and_dice')) },
    { id: 'rupture', if: all(cp(5), noDot('rupture'), (c) => FH(c) > 0.35) },
    { id: 'eviscerate', if: any(cp(5), all(cp(3), foeHpBelow(0.15))) },
    { id: 'venom_dart', if: beyond(6) },
    { id: 'hemorrhage' },
  ],
};

const PRIEST_HEAL: Rule[] = [
  {
    id: 'veilstep',
    on: 'self',
    kite: true,
    if: (c) => c.st.kiting && c.dist < 8 && !isStunned(c.foe),
  },
  { id: 'psychic_scream', kite: true, if: all(meleeClose, foeNotCc) },
  { id: 'silence', if: foeCasting },
  { id: 'desperate_prayer', if: hpBelow(0.4) },
  { id: 'martyrs_aegis', on: 'self', if: hpBelow(0.4) },
  { id: 'power_word_shield', on: 'self', if: noAbsorb },
];
const PRIEST_DISC: SpecAi = {
  prep: ['power_word_fortitude'],
  range: 25,
  kite: true,
  rules: [
    ...PRIEST_HEAL,
    { id: 'flash_heal', on: 'self', if: hpBelow(0.5) },
    { id: 'renew', on: 'self', if: all(hpBelow(0.9), (c) => !mineOn(c, c.me, 'renew')) },
    { id: 'heal', on: 'self', if: all(hpBelow(0.6), not(meleeClose)) },
    { id: 'scouring_mercy' },
    { id: 'shadow_word_pain', if: noDot('shadow_word_pain') },
    { id: 'mind_blast' },
    { id: 'smite' },
  ],
};
const PRIEST_HOLY: SpecAi = {
  prep: ['power_word_fortitude'],
  range: 25,
  kite: true,
  rules: [
    ...PRIEST_HEAL,
    { id: 'seraphic_vigil', on: 'self', if: hpBelow(0.8) },
    { id: 'flash_heal', on: 'self', if: hpBelow(0.5) },
    { id: 'renew', on: 'self', if: all(hpBelow(0.9), (c) => !mineOn(c, c.me, 'renew')) },
    { id: 'heal', on: 'self', if: all(hpBelow(0.6), not(meleeClose)) },
    { id: 'holy_nova', if: all(within(9), hpBelow(0.9)) },
    { id: 'shadow_word_pain', if: noDot('shadow_word_pain') },
    { id: 'mind_blast' },
    { id: 'smite' },
  ],
};
const PRIEST_SHADOW: SpecAi = {
  prep: ['power_word_fortitude', 'shadowform'],
  range: 20,
  kite: true,
  // Damage core from the Vespers balance probe.
  rules: [
    ...PRIEST_HEAL,
    { id: 'power_infusion', on: 'self' },
    { id: 'summon_tithefiend', if: (c) => stacks(c.me, 'gloomtithe') >= 5 },
    { id: 'flash_heal', on: 'self', if: hpBelow(0.3) },
    { id: 'shadow_word_pain', if: (c) => ownRemaining(c, 'shadow_word_pain') <= 3 },
    { id: 'inner_focus', if: (c) => (c.me.cooldowns.get('mind_blast') ?? 0) <= 0 },
    { id: 'mind_blast' },
    { id: 'mind_flay' },
    { id: 'smite' },
  ],
};

const SHAMAN_ELE: SpecAi = {
  prep: ['lightning_shield', 'flametongue_weapon'],
  range: 19,
  kite: true,
  // Damage core from the Thundercall balance probe: bank Thunder, vent it with
  // Earth Shock at five, keep Flame Shock up while filling, Lava Burst on it.
  rules: [
    { id: 'earth_shock', if: foeCasting },
    { id: 'thunderstorm', kite: true, if: any(meleeClose, manaBelow(0.5)) },
    {
      id: 'frost_shock',
      kite: true,
      if: all(foeMelee, not(foeSlowed), (c) => stacks(c.me, 'shaman_thunder_charges') < 5),
    },
    { id: 'primal_exaltation' },
    { id: 'elemental_mastery' },
    { id: 'healing_wave', on: 'self', if: all(hpBelow(0.4), not(meleeClose)) },
    { id: 'lightning_shield', if: (c) => !idOn(c.me, 'lightning_shield') },
    { id: 'lava_burst', if: auraUp('shaman_magma_surge') },
    { id: 'earth_shock', if: (c) => stacks(c.me, 'shaman_thunder_charges') >= 5 },
    {
      id: 'flame_shock',
      if: (c) => ownRemaining(c, 'flame_shock') <= 2 && stacks(c.me, 'shaman_thunder_charges') < 5,
    },
    { id: 'lava_burst', if: (c) => ownRemaining(c, 'flame_shock') > 0 },
    { id: 'unleash_weapon' },
    { id: 'lightning_bolt' },
  ],
};
const SHAMAN_ENH: SpecAi = {
  prep: ['lightning_shield', 'galeheart_weapon'],
  range: 0,
  kite: false,
  // Damage core from the Warspirit balance probe (Unleash first, Stormcast bolt).
  rules: [
    { id: 'earth_shock', if: foeCasting },
    { id: 'elemental_trance', if: hpBelow(0.5) },
    { id: 'primal_exaltation' },
    { id: 'frost_shock', if: all(not(foeSlowed), beyond(4)) },
    { id: 'healing_wave', on: 'self', if: all(hpBelow(0.3), foeHardCc) },
    { id: 'lightning_shield', if: (c) => !idOn(c.me, 'lightning_shield') },
    { id: 'unleash_weapon' },
    { id: 'lightning_bolt', if: auraUp('shaman_stormcast') },
    { id: 'stormstrike' },
    { id: 'flame_shock', if: noDot('flame_shock') },
    { id: 'earth_shock' },
  ],
};
const SHAMAN_RESTO: SpecAi = {
  prep: ['lightning_shield', 'lifespring_weapon'],
  range: 19,
  kite: true,
  rules: [
    { id: 'earth_shock', if: foeCasting },
    { id: 'frost_shock', kite: true, if: all(foeMelee, not(foeSlowed)) },
    { id: 'tidecall', on: 'self', if: hpBelow(0.85) },
    { id: 'healing_wave', on: 'self', if: hpBelow(0.65) },
    { id: 'chain_heal', on: 'self', if: hpBelow(0.75) },
    { id: 'lightning_shield', if: (c) => !idOn(c.me, 'lightning_shield') },
    { id: 'flame_shock', if: noDot('flame_shock') },
    { id: 'unleash_weapon' },
    { id: 'lightning_bolt' },
  ],
};

const MAGE_TOP: Rule[] = [
  { id: 'ice_block', if: all(hpBelow(0.2), (c) => !kindOn(c.me, 'stasis')) },
  { id: 'counterspell', if: foeCasting },
  {
    id: 'blink',
    on: 'self',
    kite: true,
    if: (c) => c.st.kiting && c.dist < 8 && !isStunned(c.foe),
  },
  { id: 'frost_nova', kite: true, if: all(meleeClose, any(foeNotCc, petClose)) },
  {
    id: 'polymorph',
    if: (c) =>
      foeMelee(c) && H(c) < 0.6 && !isStunned(c.foe) && c.t - c.st.lastPoly > 15 && c.dist > 6,
  },
  { id: 'cold_snap', if: (c) => H(c) < 0.35 && (c.me.cooldowns.get('ice_block') ?? 0) > 0 },
  { id: 'presence_of_mind', if: any(foeHardCc, foeHpBelow(0.35)) },
];
const MAGE_ARCANE: SpecAi = {
  prep: ['arcane_intellect', 'temporal_barrier'],
  range: 25,
  kite: true,
  rules: [
    ...MAGE_TOP,
    { id: 'temporal_rewind', if: hpBelow(0.35) },
    { id: 'temporal_barrier', on: 'self', if: noAbsorb },
    { id: 'temporal_hourglass', kite: true, on: 'groundFoe', if: meleeClose },
    { id: 'perfect_moment' },
    { id: 'temporal_mend', on: 'self', if: all(hpBelow(0.55), not(meleeClose)) },
    { id: 'temporal_echo', on: 'self', if: hpBelow(0.75) },
    { id: 'arcane_surge' },
    { id: 'arcane_missiles' },
    { id: 'frostbolt' },
  ],
};
const MAGE_FIRE: SpecAi = {
  prep: ['arcane_intellect', 'blazing_barrier'],
  range: 25,
  kite: true,
  rules: [
    ...MAGE_TOP,
    { id: 'blazing_barrier', if: noAbsorb },
    { id: 'dragons_breath', kite: true, if: all(within(8), foeNotCc) },
    { id: 'combustion' },
    { id: 'fire_blast' },
    { id: 'meteor', on: 'groundFoe', if: foeSlowed },
    { id: 'pyroblast', if: any(foeHardCc, (c) => kindOn(c.me, 'next_cast_instant')) },
    { id: 'fireball' },
    { id: 'scorch' },
  ],
};
const MAGE_FROST: SpecAi = {
  prep: ['arcane_intellect', 'frost_armor', 'summon_water_elemental', 'ice_barrier'],
  range: 25,
  kite: true,
  rules: [
    ...MAGE_TOP,
    { id: 'ice_barrier', if: noAbsorb },
    { id: 'glacial_front', kite: true, if: all(within(8), foeNotCc) },
    { id: 'icy_veins' },
    { id: 'frozen_orb', if: within(20) },
    { id: 'ice_lance', if: any(foeSlowed, foeHardCc) },
    { id: 'flurry' },
    { id: 'glacial_spike' },
    { id: 'frostbolt' },
    { id: 'ice_lance' },
  ],
};

const WARLOCK_TOP: Rule[] = [
  { id: 'spell_lock', if: foeCasting },
  {
    id: 'fear',
    kite: true,
    every: 8,
    if: (c) => foeMelee(c) && c.dist < 10 && !isStunned(c.foe),
  },
  { id: 'dark_pact', if: hpBelow(0.5) },
];
const WARLOCK_AFF: SpecAi = {
  prep: ['demon_skin', 'cursed_accomplice'],
  range: 25,
  kite: true,
  // Damage core from the warlock balance probe (scripts/warlock_balance_probe.ts):
  // keep the Eye on the target, Judgment and Possession on cooldown, Needle of
  // Fate builds Doom, Sentence spends it before it would overflow 100.
  rules: [
    ...WARLOCK_TOP,
    { id: 'evil_eye', if: (c) => !kindOn(c.foe, 'affliction_eye') },
    { id: 'cursed_accomplice', on: 'self', if: (c) => !kindOn(c.me, 'affliction_accomplice') },
    { id: 'hour_of_judgment', if: (c) => !kindOn(c.me, 'affliction_possession') },
    { id: 'possess_evil_eye', if: (c) => !kindOn(c.me, 'affliction_possession') },
    { id: 'cruel_pact' },
    { id: 'hex_of_violence' },
    { id: 'drain_life', if: all(hpBelow(0.45), within(20)) },
    {
      id: 'sentence',
      if: (c) => {
        const doom = c.me.auras.find((a) => a.kind === 'affliction_doom')?.stacks ?? 0;
        return (
          doom + (kindOn(c.me, 'affliction_possession') ? 9 : 7) > 100 ||
          (doom >= 40 && FH(c) < 0.25)
        );
      },
    },
    { id: 'needle_of_fate' },
  ],
};
const WARLOCK_DEMO: SpecAi = {
  prep: [
    'demon_skin',
    'raise_skeletal_warrior',
    'raise_bone_mage',
    'raise_gravewing',
    'bone_armor',
  ],
  range: 25,
  kite: true,
  // Damage core from the warlock balance probe (Necromancy).
  rules: [
    ...WARLOCK_TOP,
    { id: 'bone_armor', if: hpBelow(0.8) },
    { id: 'ossuary_mark', if: (c) => ownRemaining(c, 'ossuary_mark') <= 0 },
    { id: 'army_of_the_dead' },
    { id: 'metamorphosis' },
    { id: 'unholy_command' },
    { id: 'reaping_command', if: (c) => resPct(c) > 0.35 && soulFragments(c.me) >= 5 },
    { id: 'soul_lance', if: (c) => resPct(c) > 0.35 && ownRemaining(c, 'ossuary_mark') > 0 },
    { id: 'life_tap', if: all(manaBelow(0.3), (c) => H(c) > 0.5) },
    { id: 'soul_harvest' },
  ],
};
const WARLOCK_DESTRO: SpecAi = {
  prep: ['demon_skin', 'summon_imp'],
  range: 25,
  kite: true,
  // Damage core from the warlock balance probe (Ruination).
  rules: [
    ...WARLOCK_TOP,
    { id: 'cinderhide', if: hpBelow(0.5) },
    { id: 'summon_infernal', on: 'groundFoe' },
    { id: 'immolate', if: (c) => ownRemaining(c, 'immolate') < 3.5 },
    { id: 'conflagrate' },
    { id: 'ruinous_brand', if: (c) => ownRemaining(c, 'immolate') >= 6 },
    { id: 'shadowburn', if: foeHpBelow(0.25) },
    { id: 'chaos_bolt', if: (c) => ruinAmount(c.me) >= 3 },
    { id: 'drain_life', if: all(hpBelow(0.4), within(20)) },
    { id: 'life_tap', if: all(manaBelow(0.3), (c) => H(c) > 0.5) },
    { id: 'shadow_bolt' },
  ],
};

const DRUID_BALANCE: SpecAi = {
  prep: ['mark_of_the_wild', 'thorns', 'moonkin_form'],
  range: 25,
  kite: true,
  // Damage core from the Moongrove balance probe (Moontide spend at three).
  rules: [
    { id: 'skull_bash', if: all(foeCasting, within(8)) },
    { id: 'barkskin', if: hpBelow(0.6) },
    { id: 'typhoon', kite: true, if: all(meleeClose, foeNotCc) },
    { id: 'entangling_roots', kite: true, if: all(foeMelee, within(12), not(foeSlowed)) },
    { id: 'innervate', if: manaBelow(0.3) },
    {
      id: 'rejuvenation',
      on: 'self',
      if: all(hpBelow(0.7), (c) => !mineOn(c, c.me, 'rejuvenation')),
    },
    { id: 'regrowth', on: 'self', if: hpBelow(0.4) },
    { id: 'moonfire', if: (c) => ownRemaining(c, 'moonfire') <= 3 },
    { id: 'starfire', if: (c) => stacks(c.me, 'moontide') >= 3 && manaBelow(0.4)(c) },
    { id: 'moonseed', if: (c) => stacks(c.me, 'moontide') >= 3 },
    { id: 'moonseed' },
    { id: 'insect_swarm', if: noDot('insect_swarm') },
    { id: 'wrath' },
  ],
};
const DRUID_FERAL: SpecAi = {
  prep: ['mark_of_the_wild', 'thorns', 'cat_form', 'prowl'],
  range: 0,
  kite: false,
  // Damage core from the Wildfang balance probe (Old Blood detonation).
  rules: [
    { id: 'pounce', if: stealthed },
    { id: 'feral_charge', if: all(beyond(8), not(stealthed)) },
    { id: 'dash', if: beyond(12) },
    { id: 'skull_bash', if: foeCasting },
    { id: 'barkskin', if: hpBelow(0.5) },
    { id: 'frenzied_regeneration', if: hpBelow(0.5) },
    { id: 'primal_reflexes', if: all(hpBelow(0.6), foeMelee) },
    { id: 'berserk' },
    { id: 'tigers_fury' },
    { id: 'hamstring_bite', if: all(cp(4), foeNotCc) },
    { id: 'ferocious_bite', if: (c) => stacks(c.me, 'old_blood') >= 3 && c.me.comboPoints >= 1 },
    { id: 'rip', if: all(cp(5), noDot('rip')) },
    { id: 'rake', if: noDot('rake') },
    { id: 'ferocious_bite', if: cp(5) },
    { id: 'claw' },
  ],
};
const DRUID_RESTO: SpecAi = {
  prep: ['mark_of_the_wild', 'thorns'],
  range: 25,
  kite: true,
  rules: [
    { id: 'skull_bash', if: all(foeCasting, within(8)) },
    { id: 'barkskin', if: hpBelow(0.6) },
    { id: 'typhoon', kite: true, if: all(meleeClose, foeNotCc) },
    { id: 'entangling_roots', kite: true, if: all(foeMelee, within(12), not(foeSlowed)) },
    { id: 'innervate', if: manaBelow(0.3) },
    { id: 'swiftmend', on: 'self', if: hpBelow(0.65) },
    {
      id: 'rejuvenation',
      on: 'self',
      if: all(hpBelow(0.95), (c) => !mineOn(c, c.me, 'rejuvenation')),
    },
    { id: 'regrowth', on: 'self', if: hpBelow(0.6) },
    { id: 'healing_touch', on: 'self', if: all(hpBelow(0.45), not(meleeClose)) },
    { id: 'moonfire', if: noDot('moonfire') },
    { id: 'insect_swarm', if: noDot('insect_swarm') },
    { id: 'wrath' },
  ],
};

export const SPEC_AI: Record<string, SpecAi> = {
  'warrior/arms': WARRIOR_ARMS,
  'warrior/fury': WARRIOR_FURY,
  'warrior/prot': WARRIOR_PROT,
  'paladin/holy': PALADIN_HOLY,
  'paladin/protection': PALADIN_PROT,
  'paladin/retribution': PALADIN_RET,
  'hunter/beast_mastery': HUNTER_BM,
  'hunter/marksmanship': HUNTER_MM,
  'hunter/survival': HUNTER_SV,
  'rogue/assassination': ROGUE_ASSN,
  'rogue/combat': ROGUE_COMBAT,
  'rogue/subtlety': ROGUE_SUB,
  'priest/discipline': PRIEST_DISC,
  'priest/holy': PRIEST_HOLY,
  'priest/shadow': PRIEST_SHADOW,
  'shaman/elemental': SHAMAN_ELE,
  'shaman/enhancement': SHAMAN_ENH,
  'shaman/restoration': SHAMAN_RESTO,
  'mage/arcane': MAGE_ARCANE,
  'mage/fire': MAGE_FIRE,
  'mage/frost': MAGE_FROST,
  'warlock/affliction': WARLOCK_AFF,
  'warlock/demonology': WARLOCK_DEMO,
  'warlock/destruction': WARLOCK_DESTRO,
  'druid/balance': DRUID_BALANCE,
  'druid/feral': DRUID_FERAL,
  'druid/restoration': DRUID_RESTO,
};

export function specAi(build: SpecBuild): SpecAi {
  const ai = SPEC_AI[`${build.cls}/${build.spec}`];
  if (!ai) throw new Error(`no duel AI for ${build.cls}/${build.spec}`);
  return ai;
}

// ---- engine -----------------------------------------------------------------

function fingerprint(e: Entity, cdKey: string): string {
  return JSON.stringify([
    e.resource,
    e.gcdRemaining,
    e.castingAbility,
    e.queuedCastAbility,
    e.chargeTargetId,
    e.comboPoints,
    e.cooldowns.get(cdKey) ?? null,
    e.auras.length,
    e.auras.map((a) => a.id),
  ]);
}

/** Press one ability for `me`; true when the engine accepted it. */
export function press(c: DuelCtx, id: string, on: On = 'foe'): boolean {
  const { sim, me, foe } = c;
  const r = sim.resolvedAbility(id, me.id);
  if (!r) return false;
  const cdKey = r.cooldownId ?? r.def.id;
  if ((me.cooldowns.get(cdKey) ?? 0) > 0.001 && !r.def.maxCharges) return false;
  if (me.resource < r.cost && me.resourceType !== 'rage') return false;
  const hostile = r.def.requiresTarget && r.def.targetType !== 'friendly' && on === 'foe';
  if (hostile) {
    const reach = r.def.range > 0 ? r.def.range : MELEE_RANGE;
    if (c.dist > reach + 0.5) return false;
  }
  const before = fingerprint(me, cdKey);
  let aim: { x: number; z: number } | undefined;
  if (on === 'groundFoe') aim = { x: foe.pos.x, z: foe.pos.z };
  else if (on === 'groundSelf') aim = { x: me.pos.x, z: me.pos.z };
  const selfTarget = on === 'self' && r.def.targetType === 'any';
  if (selfTarget) sim.targetEntity(me.id, me.id);
  sim.castAbility(id, me.id, aim);
  if (selfTarget) sim.targetEntity(foe.id, me.id);
  const ok = fingerprint(me, cdKey) !== before;
  if (ok) {
    c.st.casts[r.def.id] = (c.st.casts[r.def.id] ?? 0) + 1;
    if (id === 'polymorph') c.st.lastPoly = c.t;
  }
  return ok;
}

/** Out-of-combat preparation before the duel: each buff, form, poison, pet or
 *  stealth in order, letting a cast-time summon finish before the next. The
 *  caller ticks the Sim between steps through `step`. */
export function prepare(c: DuelCtx, ai: SpecAi, step: () => void): void {
  for (const id of ai.prep) {
    for (let guard = 0; guard < 160 && (c.me.gcdRemaining > 0 || c.me.castingAbility); guard++)
      step();
    press(c, id, 'self');
    for (let guard = 0; guard < 160 && c.me.castingAbility; guard++) step();
  }
}

function face(me: Entity, angle: number): void {
  me.facing = angle;
  me.prevFacing = angle;
}

/** One tick of decisions for one duelist. */
export function drive(c: DuelCtx, ai: SpecAi): void {
  const { sim, me, foe } = c;
  const meta = sim.players.get(me.id);
  if (!meta || me.dead || foe.dead) return;
  meta.moveInput = emptyMoveInput();

  // The PvP trinket breaks a hard control effect with time left on it.
  if (isStunned(me)) {
    const longest = me.auras
      .filter((a) => ['stun', 'incapacitate', 'polymorph'].includes(a.kind))
      .reduce((m, a) => Math.max(m, a.remaining), 0);
    if (longest >= 1.5 && (H(c) < 0.85 || c.foeBuild.archetype !== 'healer')) {
      const cdBefore = meta.equipment.trinket ? JSON.stringify(me.auras.map((a) => a.id)) : '';
      sim.useItem(PVP_TRINKET, me.id);
      if (JSON.stringify(me.auras.map((a) => a.id)) !== cdBefore) c.st.trinketUses++;
    }
  }

  const toFoe = steadyAngleTo(me.pos, foe.pos, me.facing);
  const busy = me.castingAbility !== null || me.channeling;

  // Movement. Ranged kits run from a melee attacker they have just slowed or
  // locked down, then turn and cast once the gap is safe (wider against a
  // merely slowed chaser than a rooted or stunned one).
  let moving = false;
  if (!busy && !isStunned(me)) {
    if (ai.kite && c.foeBuild.archetype === 'melee') {
      const foeLocked = isStunned(foe) || kindOn(foe, 'root');
      const foeSlow = kindOn(foe, 'slow');
      if (!c.st.kiting && c.dist < 9 && (foeLocked || foeSlow)) {
        c.st.kiting = true;
        c.st.kiteUntil = c.t + 4;
      }
      const safe = foeLocked ? 12 : 18;
      if (c.st.kiting && (c.dist >= safe || c.t > c.st.kiteUntil)) c.st.kiting = false;
    } else {
      c.st.kiting = false;
    }
    if (c.st.kiting) {
      face(me, normAngle(toFoe + Math.PI));
      meta.moveInput.forward = true;
      moving = true;
    } else {
      face(me, toFoe);
      const want = ai.range > 0 ? ai.range : MELEE_RANGE * 0.7;
      const los = sim.ctx.hasLineOfSight(me, foe);
      if (c.dist < 1) {
        // Stacked on the foe (a charge lands on top): no facing resolves at
        // zero range, so back off a step the way a player would.
        meta.moveInput.back = true;
        moving = true;
      } else if (c.dist > want || !los) {
        meta.moveInput.forward = true;
        moving = true;
      }
    }
  }
  // An enemy player never perceives a stealthed foe (src/sim/threat.ts
  // petCanSeeStealthedTarget states the player rule); the engine does not
  // refuse a press at one, so the bot holds itself to what a player can see.
  // Two stealthers would stand off forever: a stealthed bot creeps toward the
  // flag and spots the other at the classic close-range detection radius.
  const spotted = me.stealthed && canDetectStealthedTarget(me, foe, 20);
  if (foe.stealthed && !spotted) {
    if (me.targetId !== null) sim.targetEntity(null, me.id);
    meta.moveInput = emptyMoveInput();
    if (me.stealthed && !isStunned(me)) {
      face(me, toFoe);
      meta.moveInput.forward = true;
    }
    for (const rule of ai.rules) {
      if (rule.on !== 'self') continue;
      const r = sim.resolvedAbility(rule.id, me.id);
      if (!r || r.castTime > 0 || busy || me.gcdRemaining > 0) continue;
      if (rule.if && !rule.if(c)) continue;
      if (press(c, rule.id, 'self')) break;
    }
    return;
  }
  if (me.targetId !== foe.id) sim.targetEntity(foe.id, me.id);
  if (!me.autoAttack && !me.stealthed && c.dist < 40) sim.startAutoAttack(me.id);

  for (const rule of ai.rules) {
    const r = sim.resolvedAbility(rule.id, me.id);
    if (!r) continue;
    const offGcd = !!r.def.offGcd;
    // Classic rhythm: an on-GCD press only when the GCD is clear and nothing
    // is being cast, so the bot never thrashes the one-slot spell queue.
    if (!offGcd && (busy || me.gcdRemaining > 0)) continue;
    if (busy && !r.def.usableWhileCasting) continue;
    if (c.st.kiting && !rule.kite && rule.on !== 'self' && rule.on !== 'groundSelf') continue;
    if (moving && r.castTime > 0 && !r.def.castWhileMoving) continue;
    // Sneak in: from stealth only the openers, since any other press breaks it.
    if (me.stealthed && !r.def.requiresStealth) continue;
    if (rule.if && !rule.if(c)) continue;
    if (rule.every && c.t - (c.st.lastPress[rule.id] ?? -999) < rule.every) continue;
    if (press(c, rule.id, rule.on ?? 'foe')) {
      c.st.lastPress[rule.id] = c.t;
      if (!offGcd) break;
    }
  }
}
