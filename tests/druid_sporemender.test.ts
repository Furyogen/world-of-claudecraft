// Groveheart's Sporemender Form (combat/druid_sporemender.ts): the healer twin
// of Moonwing Form. Pins the spec gate, the toggle, the +50% armor, the +20%
// healing done on BOTH direct heals and owned HoT ticks (read live from the
// form aura), and the Loping Stride grant on the shift.
import { describe, expect, it } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import {
  SPOREMENDER_ARMOR_MULT,
  SPOREMENDER_HEALING_DONE_PCT,
  sporemenderHealingDoneMult,
} from '../src/sim/combat/druid_sporemender';
import { applyHeal } from '../src/sim/combat/heal';
import { ABILITIES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { isFormAuraKind, MAX_LEVEL } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function druid(spec: 'balance' | 'feral' | 'restoration', seed = 4410) {
  const sim = new Sim({ seed, playerClass: 'druid', world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(MAX_LEVEL);
  expect(sim.setSpec(spec)).toBe(true);
  return sim;
}

function knownIds(sim: Sim): string[] {
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('missing player meta');
  return meta.known.map((ability) => ability.def.id);
}

function wearsForm(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.kind === 'form_sporemender');
}

function hot(sourceId: number, value: number): Aura {
  return {
    id: 'rejuvenation',
    name: 'Wildbloom',
    kind: 'hot',
    remaining: 12,
    duration: 12,
    value,
    sourceId,
    tickInterval: 3,
    tickTimer: 0.01,
  } as Aura;
}

describe('Sporemender Form: definition and spec gate', () => {
  it('is a Restoration-only druid caster form that toggles a form aura', () => {
    const def = ABILITIES.sporemender_form;
    expect(def).toMatchObject({
      name: 'Sporemender Form',
      class: 'druid',
      specs: ['restoration'],
      castTime: 0,
      cooldown: 0,
      requiresTarget: false,
    });
    expect(def.effects).toEqual([
      { type: 'selfBuff', kind: 'form_sporemender', value: 0, duration: 3600 },
    ]);
    expect(isFormAuraKind('form_sporemender')).toBe(true);
  });

  it('only a Groveheart druid knows it', () => {
    expect(knownIds(druid('restoration'))).toContain('sporemender_form');
    expect(knownIds(druid('balance'))).not.toContain('sporemender_form');
    expect(knownIds(druid('feral'))).not.toContain('sporemender_form');
  });

  it('respeccing away from Groveheart strips the worn form', () => {
    const sim = druid('restoration');
    sim.castAbility('sporemender_form', sim.playerId);
    expect(wearsForm(sim.player)).toBe(true);
    expect(sim.setSpec('balance')).toBe(true);
    expect(wearsForm(sim.player)).toBe(false);
  });
});

describe('Sporemender Form: shifting', () => {
  it('raises armor by 50%, keeps the mana bar, and shifts back out on recast', () => {
    const sim = druid('restoration');
    const p = sim.player;
    const casterArmor = p.stats.armor;
    expect(p.resourceType).toBe('mana');

    sim.castAbility('sporemender_form', sim.playerId);
    expect(wearsForm(p)).toBe(true);
    expect(p.stats.armor).toBe(Math.round(casterArmor * SPOREMENDER_ARMOR_MULT));
    expect(p.resourceType).toBe('mana');

    // Past the GCD, the same button returns to caster form.
    for (let tick = 0; tick < 40; tick++) sim.tick();
    sim.castAbility('sporemender_form', sim.playerId);
    expect(wearsForm(p)).toBe(false);
    expect(p.stats.armor).toBe(casterArmor);
  });

  it('grants Loping Stride on the shift, like every druid form button', () => {
    const sim = druid('restoration');
    sim.castAbility('sporemender_form', sim.playerId);
    expect(sim.player.auras.some((aura) => aura.id === 'loping_stride')).toBe(true);
  });

  it('keeps the healing spellbook castable while worn', () => {
    const sim = druid('restoration');
    sim.castAbility('sporemender_form', sim.playerId);
    for (let tick = 0; tick < 40; tick++) sim.tick();
    sim.castAbility('rejuvenation', sim.playerId);
    expect(wearsForm(sim.player)).toBe(true);
    expect(sim.player.auras.some((aura) => aura.kind === 'hot' && aura.id === 'rejuvenation')).toBe(
      true,
    );
  });
});

describe('Sporemender Form: +20% healing done', () => {
  it('contributes exactly 1.2 while worn and exactly 1 otherwise', () => {
    const sim = druid('restoration');
    expect(sporemenderHealingDoneMult(sim.player)).toBe(1);
    expect(sporemenderHealingDoneMult(null)).toBe(1);
    sim.castAbility('sporemender_form', sim.playerId);
    expect(sporemenderHealingDoneMult(sim.player)).toBe(1 + SPOREMENDER_HEALING_DONE_PCT);
    expect(SPOREMENDER_HEALING_DONE_PCT).toBe(0.2);
  });

  it('scales a direct heal by 20%', () => {
    const sim = druid('restoration');
    const healer = sim.player;
    const allyId = sim.addPlayer('warrior', 'Tank');
    sim.setPlayerLevel(MAX_LEVEL, allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');
    ally.hp = 1;
    const before = applyHeal(sim.ctx, healer, ally, 100, 'Heal', 'healing_touch', false, false);
    expect(before).toBe(100);

    sim.castAbility('sporemender_form', sim.playerId);
    ally.hp = 1;
    const inForm = applyHeal(sim.ctx, healer, ally, 100, 'Heal', 'healing_touch', false, false);
    expect(inForm).toBe(120);
  });

  it('scales the wearer HoT ticks live, and never another healer HoT', () => {
    const sim = druid('restoration');
    const healer = sim.player;
    const otherId = sim.addPlayer('priest', 'Other');
    const allyId = sim.addPlayer('warrior', 'Tank');
    sim.setPlayerLevel(MAX_LEVEL, allyId);
    const ally = sim.entities.get(allyId);
    if (!ally) throw new Error('missing ally');

    const tickFor = (sourceId: number): number => {
      ally.hp = 1;
      ally.auras = ally.auras.filter((aura) => aura.kind !== 'hot');
      ally.auras.push(hot(sourceId, 50));
      const start = ally.hp;
      updateAuras(sim.ctx, ally);
      return ally.hp - start;
    };

    expect(tickFor(healer.id)).toBe(50);
    sim.castAbility('sporemender_form', sim.playerId);
    expect(tickFor(healer.id)).toBe(60);
    expect(tickFor(otherId)).toBe(50);
  });
});
