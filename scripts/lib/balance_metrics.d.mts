export interface AbilityChannel {
  duration: number;
  ticks: number;
}

export interface AbilityDefLike {
  cooldown: number;
  channel?: AbilityChannel;
  scalesWith?: string;
}

export interface AbilityEffectLike {
  type: string;
  min?: number;
  max?: number;
  total?: number;
  duration?: number;
  interval?: number;
}

export interface KnownAbilityLike {
  def: AbilityDefLike;
  effects: AbilityEffectLike[];
  castTime: number;
  cost: number;
}

export interface ScalingFns {
  directHitBonus(power: number, def: AbilityDefLike, castTimeSec: number, aoe: boolean): number;
  channelTickBonus(power: number, def: AbilityDefLike): number;
  dotTickBonus(
    power: number,
    def: AbilityDefLike,
    durationSec: number,
    intervalSec: number,
  ): number;
}

export interface AnalyzeContext {
  spellPower: number;
  rangedPower: number;
  int: number;
  gcd: number;
  scaling: ScalingFns;
}

export interface AbilityMetrics {
  spamDPS: number;
  dpsPerMana: number;
  effCast: number;
  cost: number;
  damagePerCast: number;
}

export declare const SPELL_CRIT_MULT: number;
export declare const DAMAGE_EFFECTS: Set<string>;
export declare function spellCritFromInt(int: number): number;
export declare function critFactor(crit: number): number;
export declare function analyzeAbility(
  known: KnownAbilityLike,
  ctx: AnalyzeContext,
): AbilityMetrics;
export declare function medianOf(values: number[]): number;
export declare function deviation(value: number, reference: number): number;
