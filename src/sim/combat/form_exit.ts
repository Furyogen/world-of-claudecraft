// Leaving a shapeshift form, as a step something OTHER than the form's own toggle
// can take.
//
// Kept apart from ./form_autoshift.ts on purpose: that module is the pure DECISION
// (worn auras plus a cast's effects in, a form aura or null out) and the action
// bar's usable-state core imports it, so it has to stay a leaf the presentation
// tree can reach. This module is the EXECUTOR, and it needs the SimContext seam, so
// only sim-side callers touch it.
//
// The steps are the form half of the toggle in ./effect_dispatch.ts (the selfBuff
// case): drop the aura, tell the client the buff is gone so the renderer swaps the
// body back, then re-derive stats. That last call is what hands the parked mana
// back (recalcPlayerStats in ../entity.ts restores e.resource from e.savedMana when
// no resource-shifting form is left), and it is why nothing here touches the
// resource bar by hand.

import { recalcPlayerStats } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

/** Drop one worn form aura and re-derive the wearer's stats. Bills no cost, no
 *  cooldown, and no global cooldown: the caller owns whatever the shift was part of. */
export function leaveFormAura(ctx: SimContext, p: Entity, meta: PlayerMeta, aura: Aura): void {
  const at = p.auras.indexOf(aura);
  if (at < 0) return;
  p.auras.splice(at, 1);
  ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
  recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
}
