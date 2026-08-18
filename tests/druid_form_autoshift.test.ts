import { describe, expect, it } from 'vitest';
import { autoShiftFormAura, isHealingOrDamagingCast } from '../src/sim/combat/form_autoshift';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { AbilityDef, AuraKind, Entity, SimEvent } from '../src/sim/types';
import {
  type ActionBarSlotDescriptor,
  type ActionBarWorldInput,
  createActionBarView,
} from '../src/ui/hud/action_bar/action_bar_view';

// A level-20 druid with a hostile dummy parked three yards in front, faced and
// targeted, so the only gate under test is the form one.
function druidWorld() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('druid', 'Ursa');
  sim.tick();
  sim.setPlayerLevel(20, pid);
  sim.tick();
  const p = sim.entities.get(pid)!;
  const mob = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead)!;
  mob.pos = { x: p.pos.x + 3, y: p.pos.y, z: p.pos.z };
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  p.targetId = mob.id;
  return { sim, pid, p, mob };
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

function formKinds(p: Entity): AuraKind[] {
  return p.auras.map((a) => a.kind).filter((k) => k.startsWith('form_'));
}

/** Enter a form and run the global cooldown out, so the next press is unimpeded. */
function shiftInto(sim: Sim, pid: number, formId: string): void {
  sim.castAbility(formId, pid);
  sim.tick();
  for (let i = 0; i < 40; i++) sim.tick();
}

const ACTION_LOCKING_FORMS = [
  ['bear_form', 'form_bear'],
  ['cat_form', 'form_cat'],
  ['travel_form', 'form_travel'],
] as const;

describe('druid auto-shift: which casts qualify', () => {
  it('counts the caster kit healing and damage spells, and nothing else', () => {
    // Pinned against the SHIPPED druid kit rather than a hand-written list, so a new
    // druid spell has to be classified deliberately instead of drifting in.
    const classified: Record<string, boolean> = {};
    for (const [id, def] of Object.entries(ABILITIES)) {
      if (def.class !== 'druid') continue;
      if (def.requiresForm !== undefined || def.usableInForm === true) continue;
      classified[id] = isHealingOrDamagingCast(def.effects);
    }
    const qualifying = Object.keys(classified)
      .filter((id) => classified[id])
      .sort();
    expect(qualifying).toEqual([
      'healing_touch', // Wildmend
      'hurricane', // Galeheart
      'insect_swarm', // Stinging Swarm
      'moonfire', // Lunar Tempest
      'moonlash',
      'moonseed',
      'overbloom',
      'regrowth',
      'rejuvenation',
      'starfire', // Skyfall
      'sunlance',
      'swiftmend',
      'tranquility', // Gladesong
      'wrath', // Wildbolt
    ]);
    // The utility half stays refused: buffs, dispels, knockbacks, and hard control.
    for (const id of [
      'entangling_roots',
      'faerie_fire',
      'hibernate',
      'mark_of_the_wild',
      'skull_bash',
      'thorns',
      'typhoon',
    ]) {
      expect(classified[id], id).toBe(false);
    }
  });

  it('does not let a damage rider on a control spell qualify', () => {
    // Gripping Roots carries a bleed beside its root from rank 2 on.
    const roots = ABILITIES.entangling_roots;
    const rank2 = roots.ranks?.[0]?.effects ?? [];
    expect(rank2.some((e) => e.type === 'dot')).toBe(true);
    expect(rank2.some((e) => e.type === 'root')).toBe(true);
    expect(isHealingOrDamagingCast(rank2)).toBe(false);
  });

  it('returns the worn form aura only for a form that action-locks the caster kit', () => {
    const heal = ABILITIES.healing_touch;
    const aura = (kind: AuraKind) => [{ kind }];
    for (const kind of ['form_bear', 'form_cat', 'form_travel'] as const) {
      expect(autoShiftFormAura(aura(kind), heal, heal.effects)?.kind, kind).toBe(kind);
    }
    // Moonwing Form keeps its mana bar and can already cast; the mage's fireball form
    // action-locks for its own reasons and is not a druid shapeshift.
    for (const kind of ['form_moonkin', 'form_fireball', 'form_shadow'] as const) {
      expect(autoShiftFormAura(aura(kind), heal, heal.effects), kind).toBeNull();
    }
    expect(autoShiftFormAura([], heal, heal.effects)).toBeNull();
  });

  it('never fires for the form kit itself or an ability already cleared for use in form', () => {
    const inBear = [{ kind: 'form_bear' as AuraKind }];
    // A form toggle: re-pressing Bruin Form must stay the ordinary toggle-off.
    expect(autoShiftFormAura(inBear, ABILITIES.bear_form, ABILITIES.bear_form.effects)).toBeNull();
    // requiresForm (Maul) and usableInForm (Oakhide) both opt out.
    expect(autoShiftFormAura(inBear, ABILITIES.maul, ABILITIES.maul.effects)).toBeNull();
    expect(autoShiftFormAura(inBear, ABILITIES.barkskin, ABILITIES.barkskin.effects)).toBeNull();
  });
});

describe('druid auto-shift in the sim', () => {
  for (const [formId, formKind] of ACTION_LOCKING_FORMS) {
    it(`casts Wildmend out of ${formId} instead of refusing it`, () => {
      const { sim, pid, p } = druidWorld();
      shiftInto(sim, pid, formId);
      expect(formKinds(p)).toEqual([formKind]);

      sim.castAbility('healing_touch', pid);
      const events = sim.tick();

      expect(errorTexts(events)).toEqual([]);
      expect(formKinds(p)).toEqual([]);
      expect(p.resourceType).toBe('mana');
      expect(p.castingAbility).toBe('healing_touch');
      // The dropped form is announced so the renderer swaps the body back.
      expect(
        events.some((e) => e.type === 'aura' && e.targetId === pid && e.gained === false),
      ).toBe(true);
    });

    it(`casts Lunar Tempest out of ${formId}`, () => {
      const { sim, pid, p } = druidWorld();
      shiftInto(sim, pid, formId);

      sim.castAbility('moonfire', pid);
      const events = sim.tick();

      expect(errorTexts(events)).toEqual([]);
      expect(formKinds(p)).toEqual([]);
    });
  }

  it('shifts out for a CHANNELLED heal, which commits down a different branch', () => {
    // Galeheart is a channel, and channels commit through their own arm of
    // castAbility, separate from the cast-time and instant paths. The shift is
    // performed above all three, so this pins that the branch is covered too.
    const { sim, pid, p } = druidWorld();
    shiftInto(sim, pid, 'bear_form');

    sim.castAbility('hurricane', pid);
    const events = sim.tick();

    expect(errorTexts(events)).toEqual([]);
    expect(formKinds(p)).toEqual([]);
    expect(p.resourceType).toBe('mana');
    expect(p.channeling).toBe(true);
    expect(p.castingAbility).toBe('hurricane');
  });

  it('still refuses a utility cast with the shapeshift message', () => {
    const { sim, pid, p } = druidWorld();
    shiftInto(sim, pid, 'bear_form');
    p.resource = 100; // plenty of rage, so the form gate is the one that answers

    sim.castAbility('mark_of_the_wild', pid);
    const events = sim.tick();

    expect(errorTexts(events)).toEqual(["You can't do that while shapeshifted."]);
    expect(formKinds(p)).toEqual(['form_bear']);
  });

  it('leaves the in-form kit alone', () => {
    const { sim, pid, p } = druidWorld();
    shiftInto(sim, pid, 'bear_form');
    p.resource = 100;

    sim.castAbility('maul', pid);
    const events = sim.tick();

    expect(errorTexts(events)).toEqual([]);
    expect(formKinds(p)).toEqual(['form_bear']);
  });

  it('bills the parked mana pool, not the form bar', () => {
    const { sim, pid, p } = druidWorld();
    shiftInto(sim, pid, 'bear_form');
    // Bruin Form runs on rage and parks the real pool in savedMana.
    expect(p.resourceType).toBe('rage');
    expect(p.savedMana).toBeGreaterThan(0);
    const parked = p.savedMana;
    const cost = sim.known.find((k) => k.def.id === 'moonfire')!.cost;
    expect(cost).toBeGreaterThan(0);

    sim.castAbility('moonfire', pid);
    sim.tick();

    expect(p.resourceType).toBe('mana');
    expect(Math.round(p.resource)).toBe(Math.round(parked - cost));
  });

  it('refuses in mana terms, and keeps the form, when the parked pool is too small', () => {
    const { sim, pid, p } = druidWorld();
    shiftInto(sim, pid, 'bear_form');
    p.savedMana = 1;
    p.resource = 100; // a full rage bar must not pay for a mana spell

    sim.castAbility('healing_touch', pid);
    const events = sim.tick();

    expect(errorTexts(events)).toEqual(['Not enough mana!']);
    expect(formKinds(p)).toEqual(['form_bear']);
    expect(p.castingAbility).toBeNull();
  });

  it('keeps the form when a later gate refuses the cast', () => {
    // The whole point of shifting at the commit point: an out-of-range nuke costs
    // the druid nothing, where shifting on the decision would have eaten the form.
    const { sim, pid, p, mob } = druidWorld();
    shiftInto(sim, pid, 'bear_form');
    mob.pos = { x: p.pos.x + 500, y: p.pos.y, z: p.pos.z };

    sim.castAbility('moonfire', pid);
    const events = sim.tick();

    expect(errorTexts(events)).toEqual(['Out of range.']);
    expect(formKinds(p)).toEqual(['form_bear']);
  });
});

describe('druid auto-shift and the global cooldown', () => {
  it('adds no global cooldown of its own', () => {
    const casterForm = druidWorld();
    casterForm.sim.castAbility('moonfire', casterForm.pid);
    casterForm.sim.tick();
    const baseline = casterForm.p.gcdRemaining;
    expect(baseline).toBeGreaterThan(0);

    const shifted = druidWorld();
    shiftInto(shifted.sim, shifted.pid, 'bear_form');
    shifted.sim.castAbility('moonfire', shifted.pid);
    shifted.sim.tick();

    // Identical: the spell bills its own GCD, the shift bills nothing.
    expect(shifted.p.gcdRemaining).toBe(baseline);
  });

  it('still charges a global cooldown for shifting back into a form', () => {
    const { sim, pid, p } = druidWorld();
    sim.castAbility('bear_form', pid);
    sim.tick();
    expect(p.gcdRemaining).toBeGreaterThan(0);
  });
});

describe('the action bar agrees with the cast gate', () => {
  function barSlot(ability: AbilityDef, cost: number): ActionBarSlotDescriptor {
    return {
      slotIndex: 0,
      isAttack: () => false,
      hasAction: () => true,
      ability: () => ({ def: ability, cost, effects: ability.effects }),
      item: () => null,
      keybindLabel: () => '1',
    };
  }

  function barWorld(player: Partial<ActionBarWorldInput['player']>): ActionBarWorldInput {
    return {
      player: {
        id: 1,
        autoAttack: false,
        dead: false,
        resource: 0,
        cooldowns: new Map(),
        gcdRemaining: 0,
        potionCdRemaining: 0,
        queuedOnSwing: null,
        pos: { x: 0, y: 0, z: 0 },
        auras: [],
        ...player,
      },
      target: null,
      inventory: [],
      stealthed: false,
      entities: [],
    };
  }

  const view = () =>
    createActionBarView(
      { slots: [barSlot(ABILITIES.healing_touch, 110)] },
      {
        t: (key) => key,
        abilityName: (def) => def.id,
        itemName: (i) => i.id,
        slotLabel: (slotIndex) => `${slotIndex + 1}`,
        formatCount: (n) => String(n),
      },
    );

  it('paints an affordable auto-shift heal usable while the bar shows rage', () => {
    const state = view().tick(
      barWorld({
        // Bruin Form: an empty rage bar, but the real pool is parked and ample.
        resource: 0,
        resourceType: 'rage',
        savedMana: 900,
        auras: [{ kind: 'form_bear' }],
      }),
    );
    expect(state.slots[0].usable).toBe(true);
  });

  it('paints it unusable when the parked pool cannot pay', () => {
    const state = view().tick(
      barWorld({
        resource: 100, // a full rage bar must not make a mana spell look affordable
        resourceType: 'rage',
        savedMana: 10,
        auras: [{ kind: 'form_bear' }],
      }),
    );
    expect(state.slots[0].usable).toBe(false);
  });

  it('reads the live bar for an unshifted caster', () => {
    const usable = view().tick(barWorld({ resource: 900, resourceType: 'mana', savedMana: 0 }))
      .slots[0].usable;
    const broke = view().tick(barWorld({ resource: 10, resourceType: 'mana', savedMana: 900 }))
      .slots[0].usable;
    expect(usable).toBe(true);
    expect(broke).toBe(false);
  });
});
