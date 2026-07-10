import type { SimContext } from '../sim_context';
import type { AbilityDef, AbilityEffect, Entity } from '../types';

export const AOE_ECHO_RADIUS = 8;

export function abilityQualifiesForAreaEcho(effects: readonly AbilityEffect[]): boolean {
  const hasSingleTargetDamage = effects.some(
    (e) => e.type === 'weaponStrike' || e.type === 'directDamage',
  );
  if (!hasSingleTargetDamage) return false;
  return !effects.some(
    (e) => e.type === 'aoeDamage' || e.type === 'aoeRoot' || e.type === 'groundAoE',
  );
}

export function hasAreaEchoAura(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'aoe_echo');
}

export function echoAreaDamage(
  ctx: SimContext,
  p: Entity,
  primary: Entity,
  amount: number,
  school: AbilityDef['school'],
  abilityName: string,
  threatOpts: { flat?: number; mult?: number },
): void {
  for (const m of ctx.hostilesInRadius(p, primary.pos, AOE_ECHO_RADIUS)) {
    if (m.id === primary.id) continue;
    if (!ctx.hasLineOfSight(p, m)) continue;
    ctx.dealDamage(p, m, amount, false, school, abilityName, 'hit', false, threatOpts);
  }
}

export function consumeAreaEchoCharge(ctx: SimContext, e: Entity): void {
  const idx = e.auras.findIndex((a) => a.kind === 'aoe_echo');
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
