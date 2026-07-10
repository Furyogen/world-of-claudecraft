// ---------------------------------------------------------------------------
// Warrior talent content — the vertical-slice class. A shared Class tree plus
// three Spec trees (Arms / Fury dps, Protection tank). Pure data; the engine in
// talents.ts validates, precomputes, and serializes it. Node/spec display names
// here are content (rendered directly, like ability/quest names); only UI chrome
// strings route through i18n.
//
// Ability ids referenced by `grant`/`ability` mods that aren't in the warrior's
// base kit (mortal_strike, bloodthirst, shield_slam, whirlwind, berserker_rage)
// are added to ABILITIES in classes.ts; abilitiesKnownAt resolves them at runtime.
// ---------------------------------------------------------------------------

import type { ClassTalents, SpecDef } from './talents';

const SPECS: SpecDef[] = [
  {
    id: 'arms', class: 'warrior', name: 'Battlecraft', role: 'dps', icon: '⚔',
    description: 'A master of two-handed weapons who strikes with deadly, deliberate blows.',
    signature: 'mortal_strike',
    mastery: { name: 'Sharpened Blades', description: 'Increases your melee ability damage by 15% and the damage of your critical strikes by 25%.', effect: { global: { meleeDmgPct: 0.15, critDmgPct: 0.25 } } },
  },
  {
    id: 'fury', class: 'warrior', name: 'Bloodrush', role: 'dps', icon: '🪓',
    description: 'A whirlwind of blows fuelled by unrelenting rage.',
    signature: 'bloodthirst',
    mastery: { name: 'Bloodletter', description: 'Increases your critical strike chance by 10% and your melee ability damage by 10%.', effect: { stats: { crit: 0.10 }, global: { meleeDmgPct: 0.10 } } },
  },
  {
    id: 'prot', class: 'warrior', name: 'Ironguard', role: 'tank', icon: '🛡',
    description: 'An immovable wall who holds the enemy’s attention and shields allies.',
    signature: 'shield_slam',
    mastery: { name: 'Recompense', description: 'Increases all threat you generate by 50% and your armor by 20%.', effect: { global: { threatPct: 0.50 }, stats: { armorPct: 0.20 } } },
  },
];

export const WARRIOR_TALENTS: ClassTalents = {
  class: 'warrior',
  specs: SPECS,
};
