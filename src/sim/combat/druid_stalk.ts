// Stalk from any form (v0.43 feral pass): pressing the stealth opener while in
// Bruin, Fleet, Moonwing or caster form now SHIFTS YOU INTO CAT FORM first and
// then hides you, instead of refusing with "You must be in Cat Form."
//
// The shift is the same Cat Form every other route produces, deliberately:
// it reads the authored `cat_form` selfBuff for its duration and value, and it
// stamps the aura with the `cat_form` ABILITY ID, not Stalk's. That id is what
// the Cat Form button's own toggle-off looks for (the selfBuff arm of
// effect_dispatch.ts finds the aura by `a.id === ability.id`), so a druid who
// entered Cat through Stalk can still press Cat Form once to stand up. Every
// other reader keys on the aura KIND (`form_cat`) and so cannot tell the two
// routes apart at all, which is the point.
//
// What this deliberately does NOT do:
//   - charge Cat Form's 30 mana. Stalk is free and out-of-combat only
//     (requiresOutOfCombat), so the free shift is a travel convenience, never
//     a combat one. Stalk still pays the global cooldown.
//   - grant Loping Stride. The shift sprint belongs to the form BUTTONS
//     (FORM_ABILITY_IDS in druid_engines.ts); a stealth opener that also
//     sprinted would break stealth's own pacing.
// Draws no rng.
import { ABILITIES } from '../data';
import { recalcPlayerStats } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Entity, isFormAuraKind } from '../types';

export const STALK_ID = 'prowl';
const CAT_FORM_ID = 'cat_form';
const CAT_FORM_KIND = 'form_cat';

/** The authored Cat Form self-buff, the ONE source of the form's duration and
 *  value. Reading it here rather than restating the numbers means a Cat Form
 *  retune carries to this route for free. */
function catFormSelfBuff() {
  const def = ABILITIES[CAT_FORM_ID];
  return def?.effects.find((effect) => effect.type === 'selfBuff' && effect.kind === CAT_FORM_KIND);
}

/** Is this the Stalk press that needs a shift first? True only for a druid
 *  pressing Stalk while not already wearing Cat Form. */
export function stalkNeedsCatShift(
  meta: Pick<PlayerMeta, 'cls'>,
  auras: readonly { kind: string }[],
  abilityId: string,
): boolean {
  if (abilityId !== STALK_ID || meta.cls !== 'druid') return false;
  return !auras.some((aura) => aura.kind === CAT_FORM_KIND);
}

/** Put the druid in Cat Form for a Stalk press. Returns false and touches
 *  nothing when this press needs no shift. */
export function applyStalkCatShift(ctx: SimContext, p: Entity, meta: PlayerMeta): boolean {
  if (!stalkNeedsCatShift(meta, p.auras, STALK_ID)) return false;
  const selfBuff = catFormSelfBuff();
  if (!selfBuff || selfBuff.type !== 'selfBuff') return false;
  // Forms are exclusive: drop whatever is worn, the way the selfBuff arm does
  // when one form shifts into another (splice plus a fade event each).
  for (let index = p.auras.length - 1; index >= 0; index--) {
    const aura = p.auras[index];
    if (!isFormAuraKind(aura.kind) || aura.kind === CAT_FORM_KIND) continue;
    p.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
  }
  ctx.applyAura(p, {
    id: CAT_FORM_ID,
    name: ABILITIES[CAT_FORM_ID].name,
    kind: CAT_FORM_KIND,
    remaining: selfBuff.duration,
    duration: selfBuff.duration,
    value: selfBuff.value,
    sourceId: p.id,
    school: ABILITIES[CAT_FORM_ID].school,
  });
  // The resource bar swaps to Energy and the mana pool parks here, exactly as
  // it does on the Cat Form button's own cast.
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  return true;
}
