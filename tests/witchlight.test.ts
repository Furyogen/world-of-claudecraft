// src/sim/combat/witchlight.ts: Witchlight is the ranged-and-spell mirror of
// Sunder Armor. Ranged weapon attacks read the target's armor 10% lower, spells
// take the matching damage increase, melee is untouched, and it stacks with
// Sunder. The combat arms run through the real Sim (Auto Shot via rangedSwing,
// melee via meleeSwing, spells via dealDamage); the tooltip arm proves the
// displayed percent is the one combat uses.
import { describe, expect, it } from 'vitest';
import {
  hasWitchlight,
  isRangedPhysicalAbility,
  physicalHitArmor,
  rangedArmorOf,
  witchlightSpellDamageMult,
} from '../src/sim/combat/witchlight';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import {
  type Aura,
  angleTo,
  armorReduction,
  type Entity,
  FAERIE_FIRE_ARMOR_PCT,
  MAX_LEVEL,
  type PlayerClass,
} from '../src/sim/types';
import { abilityEffectText } from '../src/ui/ability_description';

const MOB_ARMOR = 800;

function witchlightAura(): Aura {
  return {
    id: 'faerie_fire',
    name: 'Witchlight',
    kind: 'faerie_fire',
    remaining: 40,
    duration: 40,
    value: 0,
    sourceId: 0,
    school: 'nature',
  };
}

function sunderAura(stacks: number): Aura {
  return {
    id: 'sunder_armor',
    name: 'Armor Shear',
    kind: 'sunder',
    remaining: 30,
    duration: 30,
    value: 0,
    stacks,
    sourceId: 0,
    school: 'physical',
  };
}

// The multiplier a fractional armor cut makes in a physical hit's mitigation.
function cutMult(armor: number, level: number): number {
  return (
    (1 - armorReduction(armor * (1 - FAERIE_FIRE_ARMOR_PCT), level)) /
    (1 - armorReduction(armor, level))
  );
}

function rig(cls: PlayerClass, seed: number, distance: number) {
  const sim = new Sim({ seed, playerClass: cls, noPlayer: true });
  const pid = sim.addPlayer(cls, 'Archer', { autoEquip: true });
  sim.tick();
  sim.setPlayerLevel(MAX_LEVEL, pid);
  const p = sim.entities.get(pid)!;
  const mob = createMob(990_001, MOBS.training_dummy, MAX_LEVEL, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + distance,
  });
  mob.hostile = true;
  mob.hp = mob.maxHp = 1_000_000_000;
  mob.stats.armor = MOB_ARMOR;
  mob.weapon = { min: 0, max: 0, speed: 99 };
  mob.moveSpeed = 0;
  sim.entities.set(mob.id, mob);
  return { sim, pid, p, mob };
}

// Auto-attacks for `seconds` and returns the attacker's total white damage on the
// target. Debuffs are held directly on the target (no cast, no rng draw), so two
// runs on the same seed draw the same stream and differ only by the debuff.
function autoAttackDamage(
  cls: PlayerClass,
  distance: number,
  debuffs: Aura[],
  seconds = 20,
): { total: number; hits: number } {
  const { sim, pid, p, mob } = rig(cls, 4471, distance);
  let total = 0;
  let hits = 0;
  sim.startAutoAttack(pid);
  for (let t = 0; t < seconds * 20; t++) {
    p.hp = p.maxHp;
    p.facing = angleTo(p.pos, mob.pos);
    p.targetId = mob.id;
    p.autoAttack = true;
    mob.auras = mob.auras.filter((a) => !debuffs.some((d) => d.id === a.id));
    mob.auras.push(...debuffs.map((d) => ({ ...d })));
    for (const ev of sim.tick()) {
      if (ev.type === 'damage' && ev.sourceId === pid && ev.targetId === mob.id) {
        total += ev.amount;
        if (ev.amount > 0) hits++;
      }
    }
    mob.hp = mob.maxHp;
  }
  return { total, hits };
}

describe('witchlight armor views', () => {
  const mob = (auras: Aura[]) =>
    ({ kind: 'mob', stats: { armor: 1000 }, auras }) as unknown as Entity;

  it('cuts ranged armor by the Witchlight percent and leaves it alone otherwise', () => {
    expect(hasWitchlight(mob([]))).toBe(false);
    expect(rangedArmorOf(mob([]))).toBe(1000);
    expect(rangedArmorOf(mob([witchlightAura()]))).toBeCloseTo(1000 * (1 - FAERIE_FIRE_ARMOR_PCT));
  });

  it('stacks on top of Sunder Armor for ranged hits instead of max-combining', () => {
    const both = mob([sunderAura(5), witchlightAura()]);
    expect(rangedArmorOf(both)).toBeCloseTo(1000 * 0.9 * (1 - FAERIE_FIRE_ARMOR_PCT), 9);
  });

  it('classifies only physical Ranged Attack Power shots fired from range as ranged', () => {
    expect(isRangedPhysicalAbility(ABILITIES.aimed_shot)).toBe(true);
    expect(isRangedPhysicalAbility(ABILITIES.multi_shot)).toBe(true);
    expect(isRangedPhysicalAbility(ABILITIES.volley)).toBe(true);
    // Arcane Shot is a spell school: it takes the spell arm instead.
    expect(isRangedPhysicalAbility(ABILITIES.arcane_shot)).toBe(false);
    // Point-blank Hunter tool and a melee special stay melee.
    expect(isRangedPhysicalAbility(ABILITIES.shrapnel_charge)).toBe(false);
    expect(isRangedPhysicalAbility(ABILITIES.sinister_strike)).toBe(false);
    expect(isRangedPhysicalAbility(undefined)).toBe(false);
  });

  it('gives a ranged Hunter shot the ranged view and a melee special the shared armor', () => {
    const { sim, mob: target } = rig('hunter', 7, 15);
    target.auras.push(witchlightAura());
    expect(physicalHitArmor(sim.ctx, target, ABILITIES.aimed_shot)).toBeCloseTo(
      MOB_ARMOR * (1 - FAERIE_FIRE_ARMOR_PCT),
    );
    expect(physicalHitArmor(sim.ctx, target, ABILITIES.sinister_strike)).toBe(MOB_ARMOR);
  });

  it('gives spells the ratio a 10% base-armor cut makes, and nothing without the debuff', () => {
    const target = mob([witchlightAura()]);
    expect(witchlightSpellDamageMult(20, target)).toBeCloseTo(cutMult(1000, 20), 12);
    expect(witchlightSpellDamageMult(20, target)).toBeGreaterThan(1);
    expect(witchlightSpellDamageMult(20, mob([]))).toBe(1);
    const unarmored = { kind: 'mob', stats: { armor: 0 }, auras: [witchlightAura()] };
    expect(witchlightSpellDamageMult(20, unarmored as unknown as Entity)).toBe(1);
  });
});

// Each arm ticks the whole world for 20 sim seconds twice, so these run long.
const LONG = 90_000;

describe('witchlight through the real combat paths', () => {
  it(
    'raises Auto Shot damage by the ranged armor cut',
    () => {
      const plain = autoAttackDamage('hunter', 15, []);
      const lit = autoAttackDamage('hunter', 15, [witchlightAura()]);
      expect(plain.hits).toBeGreaterThan(4);
      expect(lit.hits).toBe(plain.hits);
      // Per-hit rounding moves the total by at most half a point per hit.
      expect(lit.total).toBeGreaterThan(plain.total);
      expect(Math.abs(lit.total - plain.total * cutMult(MOB_ARMOR, MAX_LEVEL))).toBeLessThanOrEqual(
        plain.hits,
      );
    },
    LONG,
  );

  it(
    'stacks with Sunder Armor on Auto Shot',
    () => {
      const sundered = autoAttackDamage('hunter', 15, [sunderAura(5)]);
      const both = autoAttackDamage('hunter', 15, [sunderAura(5), witchlightAura()]);
      const sunderedArmor = MOB_ARMOR * 0.9;
      expect(both.total).toBeGreaterThan(sundered.total);
      expect(
        Math.abs(both.total - sundered.total * cutMult(sunderedArmor, MAX_LEVEL)),
      ).toBeLessThanOrEqual(sundered.hits);
    },
    LONG,
  );

  it(
    'leaves melee swings exactly unchanged',
    () => {
      const plain = autoAttackDamage('warrior', 2, []);
      const lit = autoAttackDamage('warrior', 2, [witchlightAura()]);
      expect(plain.hits).toBeGreaterThan(4);
      expect(lit).toEqual(plain);
    },
    LONG,
  );

  it('raises spell damage taken through dealDamage and leaves physical damage alone', () => {
    const { sim, p, mob } = rig('mage', 11, 15);
    const other = createMob(990_002, MOBS.training_dummy, MAX_LEVEL, { ...mob.pos });
    other.hostile = true;
    other.hp = other.maxHp = 1_000_000_000;
    other.stats.armor = MOB_ARMOR;
    sim.entities.set(other.id, other);
    other.auras.push(witchlightAura());

    const loss = (target: Entity, school: string) => {
      const before = target.hp;
      (sim as any).dealDamage(p, target, 1000, false, school, 'Test Bolt', 'hit');
      return before - target.hp;
    };
    const plainFire = loss(mob, 'fire');
    expect(loss(other, 'fire')).toBe(Math.round(plainFire * cutMult(MOB_ARMOR, MAX_LEVEL)));
    expect(loss(other, 'physical')).toBe(loss(mob, 'physical'));
  });
});

describe('witchlight tooltip', () => {
  it('shows the same percent combat uses', () => {
    const res = abilitiesKnownAt('druid', MAX_LEVEL).find((k) => k.def.id === 'faerie_fire');
    if (!res) throw new Error('druid does not know Witchlight at the level cap');
    expect(abilityEffectText(res)).toBe(String(FAERIE_FIRE_ARMOR_PCT * 100));
    expect(res.def.description).toContain('$d% lower');
    expect(res.def.description).toContain('stacks with Sunder Armor');
  });
});
