// PvP 1v1 builds for the duel Monte Carlo: one talent build and one Warfare
// Season 2 best-in-slot kit per spec.
//
// Kit rule (docs/design/warfare-season-2.md, content/pvp_honor_season2.ts): the
// five class-and-spec-locked Season 2 pieces (helmet, shoulder, chest, legs,
// gloves), the entry-tier Warfare waist and feet of the same armor family, the
// entry-tier neck and two rings for the spec's primary stat, the Medallion of
// Defiance trinket, and the Season 2 weapon for the spec. Slots the honor
// vendors cannot fill (a shield, a dual-wield off hand, a hunter's bow) fall back
// to the spec's frozen top-parse loadout (src/sim/dev/parse_bis_loadouts.ts).
//
// Talent rows are a PvP judgement call (control, mobility, a defensive), not a
// parse snapshot: no parse source exists for duels. They are listed here so a
// re-run measures exactly the same builds.

import type { EquipSlot, PlayerClass } from '../../src/sim/types';

export type Primary = 'str' | 'agi' | 'int';
export type Archetype = 'melee' | 'ranged' | 'caster' | 'healer';

export interface SpecBuild {
  cls: PlayerClass;
  spec: string;
  label: string;
  primary: Primary;
  archetype: Archetype;
  rows: Record<number, string>;
  weapon: string;
  /** A second Season 2 weapon for a dual-wield spec; otherwise the off hand
   *  comes from the parse loadout (shield, held off-hand, quiver), or stays
   *  empty under a two-hander. */
  offhand?: string;
}

const S2W = {
  greatsword: 'vanguard_verdict_greatsword',
  oath: 'vanguard_oath_blade',
  fang: 'vanguard_fang_dagger',
  staff: 'vanguard_warstaff',
};

const WAR_ROWS = (r14: string, r20: string) => ({
  5: 'war_row_crushing_charge',
  8: 'war_row_die_by_the_sword',
  11: 'war_row_storm_bolt',
  14: r14,
  17: 'war_row_avatar',
  20: r20,
});
const PAL_ROWS = (r8: string) => ({
  5: 'pal_r5_steadfast_step',
  8: r8,
  11: 'pal_r11_fist_of_justice',
  14: 'pal_r14_zeal',
  17: 'pal_r17_sanctified_fervor',
  20: 'pal_r20_dawn_echo',
});
const HUN_ROWS = (r20: string) => ({
  5: 'hun_r5_tactical_retreat',
  8: 'hun_r8_beastguard',
  11: 'hun_r11_binding_payload',
  14: 'hun_r14_efficient_rhythm',
  17: 'hun_r17_apex_instinct',
  20: r20,
});
const ROG_ROWS = (r14: string, r20: string) => ({
  5: 'rog_r5_shadeslip',
  8: 'rog_r8_borrowed_breath',
  11: 'rog_r11_marked_prey',
  14: r14,
  17: 'rog_r17_ghostfoot_gambit',
  20: r20,
});
const MAG_ROWS = {
  5: 'mag_r5_double_blink',
  8: 'mag_r8_warded',
  11: 'mag_r11_twin_nova',
  14: 'mag_r14_presence_of_mind',
  17: 'mag_r17_cold_snap',
  20: 'mag_r20_overflowing_power',
};
const WLK_ROWS = {
  5: 'wlk_r5_bane',
  8: 'wlk_r8_curse_of_exhaustion',
  11: 'wlk_r11_fel_concentration',
  14: 'wlk_r14_amplify_curse',
  17: 'wlk_r17_demonic_resilience',
  20: 'wlk_r20_chaos_bolt',
};

export const BUILDS: readonly SpecBuild[] = [
  {
    cls: 'warrior',
    spec: 'arms',
    label: 'Arms Warrior',
    primary: 'str',
    archetype: 'melee',
    weapon: S2W.greatsword,
    rows: WAR_ROWS('war_row_blood_offering', 'war_row_colossal_might'),
  },
  {
    cls: 'warrior',
    spec: 'fury',
    label: 'Fury Warrior',
    primary: 'str',
    archetype: 'melee',
    weapon: S2W.greatsword,
    offhand: S2W.greatsword,
    rows: WAR_ROWS('war_row_blood_offering', 'war_row_colossal_might'),
  },
  {
    cls: 'warrior',
    spec: 'prot',
    label: 'Protection Warrior',
    primary: 'str',
    archetype: 'melee',
    weapon: S2W.oath,
    rows: WAR_ROWS('war_row_anger_management', 'war_row_colossal_might'),
  },
  {
    cls: 'paladin',
    spec: 'holy',
    label: 'Holy Paladin',
    primary: 'int',
    archetype: 'healer',
    weapon: S2W.staff,
    rows: PAL_ROWS('pal_r8_steady_hands'),
  },
  {
    cls: 'paladin',
    spec: 'protection',
    label: 'Protection Paladin',
    primary: 'str',
    archetype: 'melee',
    weapon: S2W.oath,
    rows: PAL_ROWS('pal_r8_enduring_protection'),
  },
  {
    cls: 'paladin',
    spec: 'retribution',
    label: 'Retribution Paladin',
    primary: 'str',
    archetype: 'melee',
    weapon: S2W.greatsword,
    rows: PAL_ROWS('pal_r8_enduring_protection'),
  },
  {
    cls: 'hunter',
    spec: 'beast_mastery',
    label: 'Beast Mastery Hunter',
    primary: 'agi',
    archetype: 'ranged',
    weapon: S2W.fang,
    rows: HUN_ROWS('hun_r20_fang_chorus'),
  },
  {
    cls: 'hunter',
    spec: 'marksmanship',
    label: 'Marksmanship Hunter',
    primary: 'agi',
    archetype: 'ranged',
    weapon: S2W.fang,
    rows: HUN_ROWS('hun_r20_overdraw'),
  },
  {
    cls: 'hunter',
    spec: 'survival',
    label: 'Survival Hunter',
    primary: 'agi',
    archetype: 'melee',
    weapon: S2W.fang,
    rows: HUN_ROWS('hun_r20_overdraw'),
  },
  {
    cls: 'rogue',
    spec: 'assassination',
    label: 'Assassination Rogue',
    primary: 'agi',
    archetype: 'melee',
    weapon: S2W.fang,
    offhand: S2W.fang,
    rows: ROG_ROWS('rog_r14_venom_dividend', 'rog_r20_deathmark'),
  },
  {
    cls: 'rogue',
    spec: 'combat',
    label: 'Combat Rogue',
    primary: 'agi',
    archetype: 'melee',
    weapon: S2W.fang,
    offhand: S2W.fang,
    rows: ROG_ROWS('rog_r14_ceaseless_cuts', 'rog_r20_second_shadow'),
  },
  {
    cls: 'rogue',
    spec: 'subtlety',
    label: 'Subtlety Rogue',
    primary: 'agi',
    archetype: 'melee',
    weapon: S2W.fang,
    offhand: S2W.fang,
    rows: ROG_ROWS('rog_r14_dusk_economy', 'rog_r20_deathmark'),
  },
  {
    cls: 'priest',
    spec: 'discipline',
    label: 'Discipline Priest',
    primary: 'int',
    archetype: 'healer',
    weapon: S2W.staff,
    rows: {
      5: 'pri_r5_improved_renew',
      8: 'pri_r8_improved_shield',
      11: 'pri_r8_silence',
      14: 'pri_r11_meditation',
      17: 'pri_r17_martyrs_aegis',
      20: 'pri_r20_incarnate_spirit',
    },
  },
  {
    cls: 'priest',
    spec: 'holy',
    label: 'Holy Priest',
    primary: 'int',
    archetype: 'healer',
    weapon: S2W.staff,
    rows: {
      5: 'pri_r5_searing_light',
      8: 'pri_r17_desperate_prayer',
      11: 'pri_r8_silence',
      14: 'pri_r11_meditation',
      17: 'pri_r17_martyrs_aegis',
      20: 'pri_r20_incarnate_spirit',
    },
  },
  {
    cls: 'priest',
    spec: 'shadow',
    label: 'Shadow Priest',
    primary: 'int',
    archetype: 'caster',
    weapon: S2W.staff,
    rows: {
      5: 'pri_r5_searing_light',
      8: 'pri_r17_desperate_prayer',
      11: 'pri_r8_silence',
      14: 'pri_r11_inner_focus',
      17: 'pri_r17_anointing',
      20: 'pri_r20_incarnate_spirit',
    },
  },
  {
    cls: 'shaman',
    spec: 'elemental',
    label: 'Elemental Shaman',
    primary: 'int',
    archetype: 'caster',
    weapon: S2W.staff,
    rows: {
      5: 'sha_r5_concussion',
      8: 'sha_r8_shock_efficiency',
      11: 'sha_r11_ancestral_guidance',
      14: 'sha_r14_improved_flame_shock',
      17: 'sha_r17_earthbind',
      20: 'sha_r20_elemental_fury',
    },
  },
  {
    cls: 'shaman',
    spec: 'enhancement',
    label: 'Enhancement Shaman',
    primary: 'str',
    archetype: 'melee',
    weapon: S2W.oath,
    offhand: S2W.oath,
    rows: {
      5: 'sha_r5_concussion',
      8: 'sha_r8_shock_efficiency',
      11: 'sha_r11_ancestral_guidance',
      14: 'sha_r14_improved_flame_shock',
      17: 'sha_r17_earthbind',
      20: 'sha_r20_elemental_fury',
    },
  },
  {
    cls: 'shaman',
    spec: 'restoration',
    label: 'Restoration Shaman',
    primary: 'int',
    archetype: 'healer',
    weapon: S2W.staff,
    rows: {
      5: 'sha_r5_concussion',
      8: 'sha_r8_shock_efficiency',
      11: 'sha_r11_ancestral_guidance',
      14: 'sha_r14_chain_lightning',
      17: 'sha_r17_elemental_warding',
      20: 'sha_r20_tidal_waves',
    },
  },
  {
    cls: 'mage',
    spec: 'arcane',
    label: 'Arcane Mage',
    primary: 'int',
    archetype: 'healer',
    weapon: S2W.staff,
    rows: MAG_ROWS,
  },
  {
    cls: 'mage',
    spec: 'fire',
    label: 'Fire Mage',
    primary: 'int',
    archetype: 'caster',
    weapon: S2W.staff,
    rows: MAG_ROWS,
  },
  {
    cls: 'mage',
    spec: 'frost',
    label: 'Frost Mage',
    primary: 'int',
    archetype: 'caster',
    weapon: S2W.staff,
    rows: MAG_ROWS,
  },
  {
    cls: 'warlock',
    spec: 'affliction',
    label: 'Affliction Warlock',
    primary: 'int',
    archetype: 'caster',
    weapon: S2W.staff,
    rows: WLK_ROWS,
  },
  {
    cls: 'warlock',
    spec: 'demonology',
    label: 'Demonology Warlock',
    primary: 'int',
    archetype: 'caster',
    weapon: S2W.staff,
    rows: WLK_ROWS,
  },
  {
    cls: 'warlock',
    spec: 'destruction',
    label: 'Destruction Warlock',
    primary: 'int',
    archetype: 'caster',
    weapon: S2W.staff,
    rows: WLK_ROWS,
  },
  {
    cls: 'druid',
    spec: 'balance',
    label: 'Balance Druid',
    primary: 'int',
    archetype: 'caster',
    weapon: S2W.staff,
    rows: {
      5: 'dru_r5_natures_bounty',
      8: 'dru_r8_improved_roots',
      11: 'dru_r11_innervate',
      14: 'dru_r14_moonfury',
      17: 'dru_r17_survival_of_the_fittest',
      20: 'dru_r20_berserk',
    },
  },
  {
    cls: 'druid',
    spec: 'feral',
    label: 'Feral Druid',
    primary: 'agi',
    archetype: 'melee',
    weapon: S2W.fang,
    rows: {
      5: 'dru_r5_improved_wrath',
      8: 'dru_r8_brutal_bash',
      11: 'dru_r11_improved_mark',
      14: 'dru_r14_savage_fury',
      17: 'dru_r17_improved_barkskin',
      20: 'dru_r20_berserk',
    },
  },
  {
    cls: 'druid',
    spec: 'restoration',
    label: 'Restoration Druid',
    primary: 'int',
    archetype: 'healer',
    weapon: S2W.staff,
    rows: {
      5: 'dru_r5_natures_bounty',
      8: 'dru_r8_improved_roots',
      11: 'dru_r11_innervate',
      14: 'dru_r14_empowered_touch',
      17: 'dru_r17_survival_of_the_fittest',
      20: 'dru_r20_berserk',
    },
  },
];

export const JEWELRY: Record<Primary, { neck: string; ring1: string; ring2: string }> = {
  str: { neck: 'final_oath_medallion', ring1: 'unbroken_circle', ring2: 'iron_vow_band' },
  agi: { neck: 'razorwind_torque', ring1: 'fleetblood_band', ring2: 'last_step_signet' },
  int: { neck: 'cinder_sigil_pendant', ring1: 'ashen_focus_ring', ring2: 'spellbreakers_seal' },
};

/** Entry-tier waist and feet by armor family and primary stat. */
export function entryWaistFeet(
  armorType: string,
  primary: Primary,
): { waist: string; feet: string } {
  if (armorType === 'mail') {
    return primary === 'int'
      ? { waist: 'stormbound_waistguard', feet: 'stormbound_greaves' }
      : { waist: 'furyforged_girdle', feet: 'furyforged_sabatons' };
  }
  if (armorType === 'leather') {
    return primary === 'int'
      ? { waist: 'thornhide_cinch', feet: 'thornhide_boots' }
      : { waist: 'ashstalker_waistband', feet: 'ashstalker_treads' };
  }
  return { waist: 'cinderweave_cord', feet: 'cinderweave_slippers' };
}

export const PVP_TRINKET = 'medallion_of_defiance';

/** Owner rule for v0.46: a full Season 2 kit makes its wearer immune to spell
 *  pushback. release/v0.45.0 does not ship it (docs/design/warfare-season-2.md
 *  still reads "no spell-pushback immunity on any honor set"), so the harness
 *  models it: see setup.ts applySeason2PushbackImmunity. Flip to false to
 *  measure the v0.45.0 rules instead. */
export const SEASON2_PUSHBACK_IMMUNITY = true;

export type Kit = Partial<Record<EquipSlot, string>>;
