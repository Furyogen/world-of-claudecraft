import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export function hasSureCritAura(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'sure_crit');
}

export function consumeSureCritCharge(ctx: SimContext, e: Entity): void {
  const idx = e.auras.findIndex((a) => a.kind === 'sure_crit');
  if (idx < 0) return;
  const aura = e.auras[idx];
  const left = (aura.charges ?? 1) - 1;
  if (left <= 0) {
    e.auras.splice(idx, 1);
    ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
    return;
  }
  aura.charges = left;
}
