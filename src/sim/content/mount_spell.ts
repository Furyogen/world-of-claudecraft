import type { AbilityDef } from '../types';

// Summon Mount: the one class-neutral ability, known by every character that
// has learned Riding (abilitiesKnownAt's ridingTrained grant in classes.ts).
// It carries no effects of its own: castAbility hands it to the mount system
// (src/sim/mounts.ts castMountSpell) before any cast-path rule runs, so a press
// is exactly a reins click on the mount mountSpellMountKey picks, with the
// same gates, the same summon channel, and no global cooldown.
export const MOUNT_SPELL_ID = 'summon_mount';

export const MOUNT_SPELL_ABILITIES: Record<string, AbilityDef> = {
  [MOUNT_SPELL_ID]: {
    id: MOUNT_SPELL_ID,
    name: 'Summon Mount',
    class: 'general',
    learnLevel: 20,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [],
    description:
      'Summon the fastest mount whose reins are in your bags after 1.5 sec, wearing your chosen mount look. Use again while riding to dismount. Cannot be used in combat or in a battleground.',
  },
};
