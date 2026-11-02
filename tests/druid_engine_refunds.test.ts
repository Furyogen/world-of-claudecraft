// The druid engine's mana refunds (combat/druid_engines.ts), driven through
// real casts: Quickening (row 20) pays 2% of maximum mana for every Verdance
// stage gained, on every planting path, and nothing at the cap; Highmoon
// Tithe (row 14) restores 10% of maximum mana on Moonsurge, Sunwake, and
// Overbloom (the Fleetmend button at 5 Verdance), never on a plain Fleetmend,
// and nothing without the talent.
import { describe, expect, it } from 'vitest';
import {
  druidEngineOnCast,
  HIGHMOON_TITHE_PCT,
  QUICKENING_MANA_PCT,
  VERDANCE_STAGES,
} from '../src/sim/combat/druid_engines';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

type Row = 14 | 20;

function druid(spec: 'balance' | 'restoration', talents: Partial<Record<Row, string>> = {}) {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('druid', 'Grove');
  sim.tick();
  placePlayerInOpenField(sim, pid);
  sim.setPlayerLevel(20, pid);
  expect(sim.setSpec(spec, pid)).toBe(true);
  for (const [row, id] of Object.entries(talents)) {
    expect(sim.selectTalentRow(Number(row) as never, id as string, pid)).toBe(true);
  }
  sim.setDevMobsFrozen(true);
  const me = sim.entities.get(pid) as Entity;
  sim.targetEntity(pid, pid);
  return { sim, pid, me };
}

// biome-ignore lint/suspicious/noExplicitAny: the resolved-ability seam is internal to Sim.
const costOf = (sim: Sim, pid: number, id: string): number =>
  (sim as any).ctx.resolvedAbility(id, pid)?.cost ?? 0;
const verdance = (me: Entity) => me.auras.find((a) => a.id === 'verdance')?.stacks ?? 0;

function castNow(sim: Sim, pid: number, me: Entity, id: string): number {
  me.gcdRemaining = 0;
  me.cooldowns.clear();
  const before = me.resource;
  sim.castAbility(id, pid);
  return me.resource - before;
}

describe('Quickening', () => {
  const QUICKENING = { 20: 'dru_r20_tranquility' } as const;

  it('pays 2% of maximum mana for each Verdance gained, even from full mana', () => {
    const { sim, pid, me } = druid('restoration', QUICKENING);
    const reward = Math.round(me.maxResource * QUICKENING_MANA_PCT);
    const cost = costOf(sim, pid, 'rejuvenation');
    me.resource = me.maxResource;
    expect(castNow(sim, pid, me, 'rejuvenation')).toBe(reward - cost);
    expect(verdance(me)).toBe(1);
    // In Sporemender Form too: the form keeps mana as the live bar.
    castNow(sim, pid, me, 'sporemender_form');
    me.auras = me.auras.filter((a) => a.id !== 'rejuvenation');
    me.resource = Math.round(me.maxResource / 2);
    expect(castNow(sim, pid, me, 'rejuvenation')).toBe(reward - cost);
    expect(verdance(me)).toBe(2);
  });

  it('pays nothing without the talent, and nothing once Verdance is full', () => {
    const plain = druid('restoration');
    plain.me.resource = Math.round(plain.me.maxResource / 2);
    expect(castNow(plain.sim, plain.pid, plain.me, 'rejuvenation')).toBe(
      -costOf(plain.sim, plain.pid, 'rejuvenation'),
    );
    expect(verdance(plain.me)).toBe(1);

    const { sim, pid, me } = druid('restoration', QUICKENING);
    me.auras.push({
      id: 'verdance',
      name: 'Verdance',
      kind: 'verdance',
      remaining: 3600,
      duration: 3600,
      value: 0,
      sourceId: me.id,
      school: 'nature',
      stacks: VERDANCE_STAGES,
    } as Aura);
    me.resource = Math.round(me.maxResource / 2);
    expect(castNow(sim, pid, me, 'rejuvenation')).toBe(-costOf(sim, pid, 'rejuvenation'));
    expect(verdance(me)).toBe(VERDANCE_STAGES);
  });

  it('pays on the Sporemending a Spore Burst plants', () => {
    const { sim, pid, me } = druid('restoration', QUICKENING);
    const reward = Math.round(me.maxResource * QUICKENING_MANA_PCT);
    me.resource = Math.round(me.maxResource / 2);
    me.gcdRemaining = 0;
    sim.castAbility('spore_burst', pid, { x: me.pos.x, z: me.pos.z });
    let paid = false;
    for (let i = 0; i < 140 && !paid; i++) {
      const before = me.resource;
      const stacks = verdance(me);
      sim.tick();
      if (verdance(me) > stacks) {
        // The tick's own regen rides along; the stage pays at least the reward.
        expect(me.resource - before).toBeGreaterThanOrEqual(reward);
        paid = true;
      }
    }
    expect(paid).toBe(true);
  });
});

describe('Highmoon Tithe', () => {
  const TITHE = { 14: 'dru_r14_moonfury' } as const;

  function bloom(me: Entity): void {
    me.auras.push({
      id: 'rejuvenation',
      name: 'Sporemending',
      kind: 'hot',
      remaining: 12,
      duration: 12,
      value: 10,
      tickInterval: 3,
      tickTimer: 3,
      sourceId: me.id,
      school: 'nature',
    } as Aura);
  }

  function fullVerdance(me: Entity): void {
    me.auras.push({
      id: 'verdance',
      name: 'Verdance',
      kind: 'verdance',
      remaining: 3600,
      duration: 3600,
      value: 0,
      sourceId: me.id,
      school: 'nature',
      stacks: VERDANCE_STAGES,
    } as Aura);
  }

  it('restores 10% of maximum mana on Overbloom, pressed from the Fleetmend button', () => {
    expect(HIGHMOON_TITHE_PCT).toBe(0.1);
    const { sim, pid, me } = druid('restoration', TITHE);
    bloom(me);
    fullVerdance(me);
    me.resource = Math.round(me.maxResource / 2);
    const refund = Math.round(me.maxResource * HIGHMOON_TITHE_PCT);
    expect(castNow(sim, pid, me, 'swiftmend')).toBe(refund - costOf(sim, pid, 'swiftmend'));
    // It really was Overbloom: the payoff spent the Verdance bank.
    expect(verdance(me)).toBeLessThan(VERDANCE_STAGES);
  });

  it('pays nothing on a plain Fleetmend, or on Overbloom without the talent', () => {
    const fleet = druid('restoration', TITHE);
    bloom(fleet.me);
    fleet.me.resource = Math.round(fleet.me.maxResource / 2);
    expect(castNow(fleet.sim, fleet.pid, fleet.me, 'swiftmend')).toBe(
      -costOf(fleet.sim, fleet.pid, 'swiftmend'),
    );
    // The Fleetmend landed: it consumed the bloom.
    expect(fleet.me.auras.some((a) => a.id === 'rejuvenation')).toBe(false);

    const { sim, pid, me } = druid('restoration');
    bloom(me);
    fullVerdance(me);
    me.resource = Math.round(me.maxResource / 2);
    expect(castNow(sim, pid, me, 'swiftmend')).toBe(-costOf(sim, pid, 'swiftmend'));
    expect(verdance(me)).toBeLessThan(VERDANCE_STAGES);
  });

  it('restores 10% on the Moonsurge and Sunwake payoffs', () => {
    for (const payoff of ['moonlash', 'sunlance']) {
      const { sim, me } = druid('balance', TITHE);
      me.auras.push({
        id: 'moonkin_form',
        name: 'Moonwing Form',
        kind: 'form_moonkin',
        remaining: 3600,
        duration: 3600,
        value: 0,
        sourceId: me.id,
        school: 'nature',
      } as Aura);
      me.resource = Math.round(me.maxResource / 2);
      const before = me.resource;
      druidEngineOnCast(sim.ctx, me, payoff, null);
      expect(me.resource - before, payoff).toBe(Math.round(me.maxResource * HIGHMOON_TITHE_PCT));
    }
  });
});
