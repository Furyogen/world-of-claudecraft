// The v0.43 Wildfang pass, one suite per change:
//   1. every melee attack a feral druid makes reaches 1 yd further
//   2. Slinkstrike and Lunge each bank 1 Old Blood (cap 3)
//   3. Nature's Boon: a landed autoattack has a 10% chance to arm one free
//      Wildbloom OR Lunar Tempest for 10 sec, castable without leaving form
//   4. Savage Mending is a Bruin AND Cat button
import { describe, expect, it } from 'vitest';
import {
  druidEngineOnLandedStrike,
  OLD_BLOOD_ID,
  OLD_BLOOD_STAGES,
} from '../src/sim/combat/druid_engines';
import {
  NATURES_BOON_ABILITIES,
  NATURES_BOON_CHANCE,
  NATURES_BOON_DURATION,
  NATURES_BOON_ID,
  naturesBoonArmedFor,
  naturesBoonOnAutoAttack,
} from '../src/sim/combat/druid_natures_boon';
import { FERAL_MELEE_REACH_BONUS, feralMeleeReachBonus } from '../src/sim/combat/feral_reach';
import { willAutoUnshift } from '../src/sim/combat/form_auto_unshift';
import { formRequirementMet, requiredForms } from '../src/sim/combat/form_requirement';
import {
  effectivePlayerAttackRange,
  RAID_BOSS_PLAYER_MELEE_RANGE,
} from '../src/sim/combat/player_attack_reach';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { IGNIVAR_BOSS_ID, MELEE_RANGE } from '../src/sim/types';

type Spec = 'balance' | 'feral' | 'restoration';

function rig(spec: Spec) {
  const sim = new Sim({ seed: 43, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return { sim, player: sim.player };
}

function simCtx(sim: Sim): {
  rng: { setObserver(observer: ((value: number) => void) | null): void };
  players: Map<number, unknown>;
} {
  return (
    sim as unknown as {
      ctx: {
        rng: { setObserver(observer: ((value: number) => void) | null): void };
        players: Map<number, unknown>;
      };
    }
  ).ctx;
}

// biome-ignore lint/suspicious/noExplicitAny: the SimContext shape is internal to Sim.
function rawCtx(sim: Sim): any {
  return (sim as unknown as { ctx: unknown }).ctx;
}

function formAura(player: Entity, kind: Aura['kind']): Aura {
  return {
    id: kind,
    name: kind,
    kind,
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId: player.id,
    school: 'nature',
  };
}

function spawnMob(sim: Sim, distance: number, templateId = 'forest_wolf'): Entity {
  const player = sim.player;
  const mob = createMob(9930, MOBS[templateId] ?? MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + distance,
  });
  mob.templateId = templateId;
  mob.hostile = true;
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = 0;
  return mob;
}

/** Shift for real (the form button, not a pushed aura) so the resource pool,
 *  stats, and form aura all land the way they do in play, then wait out the
 *  global cooldown the shift costs. */
function shiftInto(sim: Sim, formAbilityId: 'bear_form' | 'cat_form'): void {
  sim.player.resource = sim.player.maxResource;
  sim.castAbility(formAbilityId);
  for (let tick = 0; tick < 40; tick++) sim.tick();
  sim.player.resource = sim.player.maxResource;
}

/** Arm the window through the REAL hook with the 10% roll forced, in exactly
 *  one call and without drawing rng. Looping the hook until it happens would
 *  work too, but every failed roll advances the shared stream and so changes
 *  what the spell cast afterwards rolls on the hit table. */
function armBoon(sim: Sim): void {
  // biome-ignore lint/suspicious/noExplicitAny: reaching the Rng behind SimContext.
  const rng = rawCtx(sim).rng as any;
  const realChance = rng.chance.bind(rng);
  rng.chance = () => true;
  try {
    naturesBoonOnAutoAttack(rawCtx(sim), sim.player);
  } finally {
    rng.chance = realChance;
  }
}

function stacks(player: Entity, id: string): number {
  return player.auras.find((aura) => aura.id === id)?.stacks ?? 0;
}

function aura(player: Entity, id: string): Aura | undefined {
  return player.auras.find((entry) => entry.id === id);
}

/** Counts every rng draw a callback costs, through the Rng test observer. */
function countDraws(sim: Sim, run: () => void): number {
  let draws = 0;
  simCtx(sim).rng.setObserver(() => {
    draws++;
  });
  try {
    run();
  } finally {
    simCtx(sim).rng.setObserver(null);
  }
  return draws;
}

const FERAL = { cls: 'druid', spec: 'feral' } as const;
const BALANCE = { cls: 'druid', spec: 'balance' } as const;
const WARRIOR = { cls: 'warrior', spec: 'arms' } as const;
const WOLF = { kind: 'mob', templateId: 'forest_wolf' };
const RAID_BOSS = { kind: 'mob', templateId: IGNIVAR_BOSS_ID };

describe('1. Wildfang reach: +1 yd on melee attacks', () => {
  it('adds exactly one yard, and only for a committed feral druid', () => {
    expect(FERAL_MELEE_REACH_BONUS).toBe(1);
    expect(feralMeleeReachBonus(FERAL, 0)).toBe(1);
    expect(feralMeleeReachBonus(FERAL, MELEE_RANGE)).toBe(1);
    // Every other attacker, including the druid's other two specs.
    expect(feralMeleeReachBonus(BALANCE, 0)).toBe(0);
    expect(feralMeleeReachBonus({ cls: 'druid', spec: 'restoration' }, 0)).toBe(0);
    expect(feralMeleeReachBonus(WARRIOR, 0)).toBe(0);
    expect(feralMeleeReachBonus(null, 0)).toBe(0);
    expect(feralMeleeReachBonus({ cls: null, spec: 'feral' }, 0)).toBe(0);
    expect(feralMeleeReachBonus({ cls: 'druid', spec: null }, 0)).toBe(0);
  });

  it('leaves every non-melee range alone, Lunge and Slinkstrike included', () => {
    expect(ABILITIES.lunge.range).toBe(12);
    expect(ABILITIES.pounce.range).toBe(8);
    expect(feralMeleeReachBonus(FERAL, ABILITIES.lunge.range)).toBe(0);
    expect(feralMeleeReachBonus(FERAL, ABILITIES.pounce.range)).toBe(0);
    expect(feralMeleeReachBonus(FERAL, MELEE_RANGE + 1)).toBe(0);
    expect(feralMeleeReachBonus(FERAL, 30)).toBe(0);
  });

  it('rides the shared reach seam without moving anyone else', () => {
    // Omitting the attacker keeps the pre-v0.43 answer exactly.
    expect(effectivePlayerAttackRange(WOLF, MELEE_RANGE)).toBe(MELEE_RANGE);
    expect(effectivePlayerAttackRange(WOLF, 0)).toBe(MELEE_RANGE);
    expect(effectivePlayerAttackRange(WOLF, MELEE_RANGE, BALANCE)).toBe(MELEE_RANGE);
    expect(effectivePlayerAttackRange(WOLF, MELEE_RANGE, FERAL)).toBe(MELEE_RANGE + 1);
    expect(effectivePlayerAttackRange(WOLF, 0, FERAL)).toBe(MELEE_RANGE + 1);
    // A ranged button keeps its authored range for everybody.
    expect(effectivePlayerAttackRange(WOLF, 30, FERAL)).toBe(30);
    // The raid-boss hitbox allowance stacks with it rather than replacing it.
    expect(effectivePlayerAttackRange(RAID_BOSS, MELEE_RANGE, BALANCE)).toBe(
      RAID_BOSS_PLAYER_MELEE_RANGE,
    );
    expect(effectivePlayerAttackRange(RAID_BOSS, MELEE_RANGE, FERAL)).toBe(
      RAID_BOSS_PLAYER_MELEE_RANGE + 1,
    );
  });

  it('lets a feral druid land Claw at a range that refuses a balance druid', () => {
    const reach = MELEE_RANGE + 0.5;

    const feral = rig('feral');
    feral.player.auras.push(formAura(feral.player, 'form_cat'));
    const feralMob = spawnMob(feral.sim, reach);
    const feralHpBefore = feralMob.hp;
    feral.sim.castAbility('claw');
    for (let tick = 0; tick < 4; tick++) feral.sim.tick();
    expect(feralMob.hp).toBeLessThan(feralHpBefore);

    // Same distance, same button, a spec without the reach: nothing lands.
    const balance = rig('balance');
    balance.player.auras.push(formAura(balance.player, 'form_cat'));
    const balanceMob = spawnMob(balance.sim, reach);
    const balanceHpBefore = balanceMob.hp;
    balance.sim.castAbility('claw');
    for (let tick = 0; tick < 4; tick++) balance.sim.tick();
    expect(balanceMob.hp).toBe(balanceHpBefore);
  });
});

describe('2. Slinkstrike and Lunge bank Old Blood', () => {
  it('banks one stage each, capped at three', () => {
    const { sim, player } = rig('feral');
    const ctx = rawCtx(sim);

    druidEngineOnLandedStrike(ctx, player, 'pounce');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(1);
    druidEngineOnLandedStrike(ctx, player, 'lunge');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(2);
    druidEngineOnLandedStrike(ctx, player, 'pounce');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(3);
    // The cap is the existing OLD_BLOOD_STAGES, not a second number.
    expect(OLD_BLOOD_STAGES).toBe(3);
    druidEngineOnLandedStrike(ctx, player, 'lunge');
    expect(stacks(player, OLD_BLOOD_ID)).toBe(OLD_BLOOD_STAGES);
  });

  it('stays feral-only: the other druid specs bank nothing', () => {
    for (const spec of ['balance', 'restoration'] as const) {
      const { sim, player } = rig(spec);
      druidEngineOnLandedStrike(rawCtx(sim), player, 'pounce');
      druidEngineOnLandedStrike(rawCtx(sim), player, 'lunge');
      expect(player.auras.some((entry) => entry.id === OLD_BLOOD_ID)).toBe(false);
    }
  });

  it('banks through the real Slinkstrike cast, on the tick its stun lands', () => {
    const { sim, player } = rig('feral');
    player.auras.push(formAura(player, 'form_cat'));
    player.auras.push(formAura(player, 'stealth'));
    const mob = spawnMob(sim, 3);

    sim.castAbility('pounce');
    for (let tick = 0; tick < 4; tick++) sim.tick();

    expect(mob.auras.some((entry) => entry.kind === 'stun')).toBe(true);
    expect(stacks(player, OLD_BLOOD_ID)).toBe(1);
    // The combo point the opener already paid is untouched by the new bank.
    expect(player.comboPoints).toBe(1);
  });
});

describe("3. Nature's Boon", () => {
  it('arms both spells at once for ten seconds', () => {
    expect(NATURES_BOON_CHANCE).toBe(0.1);
    expect(NATURES_BOON_DURATION).toBe(10);
    expect([...NATURES_BOON_ABILITIES].sort()).toEqual(['moonfire', 'rejuvenation']);
  });

  it('recognizes an armed window for either spell and nothing else', () => {
    const armed = [
      {
        id: NATURES_BOON_ID,
        kind: 'next_cast_free',
        empowerAbilities: ['rejuvenation', 'moonfire'],
      },
    ];
    expect(naturesBoonArmedFor(armed, 'rejuvenation')).toBe(true);
    expect(naturesBoonArmedFor(armed, 'moonfire')).toBe(true);
    expect(naturesBoonArmedFor(armed, 'wrath')).toBe(false);
    expect(naturesBoonArmedFor(armed, 'claw')).toBe(false);
    expect(naturesBoonArmedFor(armed, undefined)).toBe(false);
    expect(naturesBoonArmedFor([], 'rejuvenation')).toBe(false);
    // A free-cast aura that is NOT this passive never opens the form gate.
    expect(
      naturesBoonArmedFor(
        [{ id: 'clearcasting', kind: 'next_cast_free', empowerAbilities: ['rejuvenation'] }],
        'rejuvenation',
      ),
    ).toBe(false);
    // The right id in the wrong state (already spent down to another kind).
    expect(
      naturesBoonArmedFor(
        [{ id: NATURES_BOON_ID, kind: 'buff_speed', empowerAbilities: ['rejuvenation'] }],
        'rejuvenation',
      ),
    ).toBe(false);
  });

  it('rolls once per landed autoattack for a feral druid, and arms on a hit', () => {
    const { sim, player } = rig('feral');
    const ctx = rawCtx(sim);
    const draws = countDraws(sim, () => {
      naturesBoonOnAutoAttack(ctx, player);
    });
    expect(draws).toBe(1);
  });

  it('draws no rng at all for a player who is not a feral druid', () => {
    for (const spec of ['balance', 'restoration'] as const) {
      const { sim, player } = rig(spec);
      const ctx = rawCtx(sim);
      const draws = countDraws(sim, () => {
        naturesBoonOnAutoAttack(ctx, player);
      });
      expect(draws).toBe(0);
      expect(player.auras.some((entry) => entry.id === NATURES_BOON_ID)).toBe(false);
    }
    const warrior = new Sim({ seed: 43, playerClass: 'warrior', autoEquip: true });
    warrior.setPlayerLevel(20);
    expect(
      countDraws(warrior, () => {
        naturesBoonOnAutoAttack(rawCtx(warrior), warrior.player);
      }),
    ).toBe(0);
  });

  it('applies a ten second free-cast window scoped to the two spells', () => {
    const { sim, player } = rig('feral');
    armBoon(sim);
    const window = aura(player, NATURES_BOON_ID);
    expect(window).toBeDefined();
    expect(window?.kind).toBe('next_cast_free');
    expect(window?.duration).toBe(NATURES_BOON_DURATION);
    expect(window?.remaining).toBe(NATURES_BOON_DURATION);
    expect([...(window?.empowerAbilities ?? [])].sort()).toEqual(['moonfire', 'rejuvenation']);
  });

  it('keeps the druid in form: an armed window never auto-unshifts', () => {
    const bear = [{ kind: 'form_bear' } as Pick<Aura, 'kind'>];
    // Baseline, unchanged: both spells drop the form when nothing is armed.
    expect(willAutoUnshift(bear, ABILITIES.rejuvenation)).toBe(true);
    expect(willAutoUnshift(bear, ABILITIES.moonfire)).toBe(true);
    const armedBear = [
      { kind: 'form_bear' },
      {
        kind: 'next_cast_free',
        id: NATURES_BOON_ID,
        empowerAbilities: ['rejuvenation', 'moonfire'],
      },
    ] as Parameters<typeof willAutoUnshift>[0];
    expect(willAutoUnshift(armedBear, ABILITIES.rejuvenation)).toBe(false);
    expect(willAutoUnshift(armedBear, ABILITIES.moonfire)).toBe(false);
    // A spell the window does not name still unshifts.
    expect(willAutoUnshift(armedBear, ABILITIES.wrath)).toBe(true);
  });

  it('casts Wildbloom from Cat Form for free, keeping the form, and spends the window', () => {
    const { sim, player } = rig('feral');
    player.auras.push(formAura(player, 'form_cat'));
    armBoon(sim);
    expect(aura(player, NATURES_BOON_ID)).toBeDefined();
    const energyBefore = player.resource;

    sim.castAbility('rejuvenation');
    for (let tick = 0; tick < 3; tick++) sim.tick();

    expect(player.auras.some((entry) => entry.kind === 'hot' && entry.id === 'rejuvenation')).toBe(
      true,
    );
    // Free, and still a cat.
    expect(player.resource).toBe(energyBefore);
    expect(player.auras.some((entry) => entry.kind === 'form_cat')).toBe(true);
    // One window, one cast.
    expect(aura(player, NATURES_BOON_ID)).toBeUndefined();
  });

  it('casts Lunar Tempest from Cat Form on the same window', () => {
    const { sim, player } = rig('feral');
    player.auras.push(formAura(player, 'form_cat'));
    const mob = spawnMob(sim, 10);
    armBoon(sim);
    expect(aura(player, NATURES_BOON_ID)).toBeDefined();
    const hpBefore = mob.hp;

    sim.castAbility('moonfire');
    for (let tick = 0; tick < 40; tick++) sim.tick();

    expect(mob.hp).toBeLessThan(hpBefore);
    expect(player.auras.some((entry) => entry.kind === 'form_cat')).toBe(true);
    expect(aura(player, NATURES_BOON_ID)).toBeUndefined();
  });

  it('leaves the unarmed behavior exactly as it was: Wildbloom drops Cat Form', () => {
    const { sim, player } = rig('feral');
    player.auras.push(formAura(player, 'form_cat'));
    expect(aura(player, NATURES_BOON_ID)).toBeUndefined();

    sim.castAbility('rejuvenation');
    for (let tick = 0; tick < 3; tick++) sim.tick();

    expect(player.auras.some((entry) => entry.kind === 'form_cat')).toBe(false);
  });
});

describe('4. Savage Mending is a Bruin and Cat button', () => {
  it('declares both forms', () => {
    expect(requiredForms(ABILITIES.frenzied_regeneration)).toEqual(['bear', 'cat']);
    // The single-form buttons are untouched.
    expect(requiredForms(ABILITIES.maul)).toEqual(['bear']);
    expect(requiredForms(ABILITIES.claw)).toEqual(['cat']);
    expect(requiredForms(ABILITIES.wrath)).toEqual([]);
  });

  it('is satisfied by either form and by neither otherwise', () => {
    const mending = ABILITIES.frenzied_regeneration;
    expect(formRequirementMet([{ kind: 'form_bear' }], mending)).toBe(true);
    expect(formRequirementMet([{ kind: 'form_cat' }], mending)).toBe(true);
    expect(formRequirementMet([{ kind: 'form_travel' }], mending)).toBe(false);
    expect(formRequirementMet([], mending)).toBe(false);
    // Cat Form does not unlock a Bruin-only button.
    expect(formRequirementMet([{ kind: 'form_cat' }], ABILITIES.maul)).toBe(false);
    // An ability with no requirement is trivially satisfied.
    expect(formRequirementMet([], ABILITIES.wrath)).toBe(true);
  });

  it('keeps the authored cost and cooldown, so Cat pays 10 Energy', () => {
    expect(ABILITIES.frenzied_regeneration.cost).toBe(10);
    expect(ABILITIES.frenzied_regeneration.cooldown).toBe(60);

    const { sim, player } = rig('feral');
    shiftInto(sim, 'cat_form');
    // Cat Form runs on Energy, so the authored cost of 10 IS 10 Energy here.
    expect(player.resourceType).toBe('energy');
    const energyBefore = player.resource;

    sim.castAbility('frenzied_regeneration');
    sim.tick();

    expect(player.auras.some((entry) => entry.id === 'frenzied_regeneration')).toBe(true);
    expect(energyBefore - player.resource).toBe(10);
    expect(player.cooldowns.get('frenzied_regeneration')).toBeGreaterThan(50);
  });

  it('still works from Bruin Form', () => {
    const { sim, player } = rig('feral');
    shiftInto(sim, 'bear_form');
    expect(player.resourceType).toBe('rage');

    sim.castAbility('frenzied_regeneration');
    sim.tick();

    expect(player.auras.some((entry) => entry.id === 'frenzied_regeneration')).toBe(true);
  });

  it('is still refused out of form', () => {
    const { sim, player } = rig('feral');
    expect(player.auras.some((entry) => entry.kind.startsWith('form_'))).toBe(false);

    sim.castAbility('frenzied_regeneration');
    sim.tick();

    expect(player.auras.some((entry) => entry.id === 'frenzied_regeneration')).toBe(false);
    expect(player.cooldowns.has('frenzied_regeneration')).toBe(false);
  });
});
