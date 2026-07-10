import { ABILITIES } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Aura, AuraKind, Entity } from '../types';

export const BATTLE_STANCE = 'battle_stance';
export const BERSERKER_STANCE = 'berserker_stance';
export const DEFENSIVE_STANCE = 'defensive_stance';

export const WARRIOR_STANCE_IDS: readonly string[] = [
  BATTLE_STANCE,
  DEFENSIVE_STANCE,
  BERSERKER_STANCE,
];

export const WARRIOR_STANCE_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>(['defensive_stance']);

export function isWarriorStanceKind(kind: AuraKind): boolean {
  return WARRIOR_STANCE_KINDS.has(kind);
}

export function availableWarriorStanceKinds(spec: string | null): AuraKind[] {
  if (spec === 'prot') return ['defensive_stance'];
  return ['defensive_stance'];
}

export function defaultWarriorStanceId(_spec: string | null): string {
  return DEFENSIVE_STANCE;
}

export function buildStanceAura(stanceId: string, ownerId: number): Aura | null {
  const def = ABILITIES[stanceId];
  const eff = def?.effects.find((e) => e.type === 'selfBuff');
  if (!def || !eff || eff.type !== 'selfBuff') return null;
  return {
    id: stanceId,
    name: def.name,
    kind: eff.kind,
    remaining: eff.duration,
    duration: eff.duration,
    value: eff.value,
    sourceId: ownerId,
    school: def.school,
  };
}

export interface StanceReconcile {
  removeKinds: AuraKind[];
  applyId: string | null;
}

export function warriorStanceReconcile(
  spec: string | null,
  currentStanceKinds: readonly AuraKind[],
): StanceReconcile {
  const available = availableWarriorStanceKinds(spec);
  if (currentStanceKinds.some((k) => available.includes(k))) {
    return { removeKinds: [], applyId: null };
  }
  return { removeKinds: [...currentStanceKinds], applyId: defaultWarriorStanceId(spec) };
}

export function ensureWarriorStance(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (meta.cls !== 'warrior') return;
  const worn = p.auras.filter((a) => isWarriorStanceKind(a.kind)).map((a) => a.kind);
  const spec = ctx.playerMods(meta).spec;
  const plan = warriorStanceReconcile(spec, worn);
  if (plan.applyId === null) return;
  for (let i = p.auras.length - 1; i >= 0; i--) {
    if (plan.removeKinds.includes(p.auras[i].kind)) {
      const aura = p.auras[i];
      p.auras.splice(i, 1);
      ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
    }
  }
  const aura = buildStanceAura(plan.applyId, p.id);
  if (aura) ctx.applyAura(p, aura);
}
