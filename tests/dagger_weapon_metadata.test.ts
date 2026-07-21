import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function trainingDummy(sim: Sim): Entity {
  const target = [...sim.entities.values()].find(
    (entity) => entity.kind === 'mob' && entity.templateId === 'training_dummy' && !entity.dead,
  );
  if (!target) throw new Error('training dummy not spawned');
  return target;
}

function placeForCravenThrust(sim: Sim, player: Entity, target: Entity): void {
  player.pos.x = target.pos.x - 1;
  player.pos.z = target.pos.z;
  player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
  player.facing = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
  target.facing = Math.PI / 2;
}

function equipMainhandForValidation(sim: Sim, itemId: string): void {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('player metadata missing');
  meta.equipment.mainhand = itemId;
  delete meta.equipment.offhand;
  recalcPlayerStats(sim.player, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
}

function cravenThrustEventsWith(itemId: string) {
  const sim = new Sim({ seed: 42, playerClass: 'rogue', autoEquip: true });
  sim.setPlayerLevel(20);
  const target = trainingDummy(sim);
  placeForCravenThrust(sim, sim.player, target);
  sim.targetEntity(target.id);
  sim.player.resource = sim.player.maxResource;
  equipMainhandForValidation(sim, itemId);

  const startHp = target.hp;
  sim.castAbility('backstab');
  const events = sim.tick();

  return { events, target, startHp };
}

describe('dagger-class fang weapons', () => {
  it('lets Craven Thrust use Mistcaller Fang as a dagger-class fang weapon', () => {
    expect(ITEMS.mistcallers_fang.weapon?.dagger).toBe(true);

    const { events, target, startHp } = cravenThrustEventsWith('mistcallers_fang');

    expect(
      events.some((event) => event.type === 'error' && event.text === 'You must wield a dagger.'),
    ).toBe(false);
    expect(target.hp).toBeLessThan(startHp);
  });

  it('keeps non-dagger fang greatblades rejected by dagger validation', () => {
    expect(ITEMS.direfang_greatblade.weapon?.dagger).toBeUndefined();

    const { events, target, startHp } = cravenThrustEventsWith('direfang_greatblade');

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', text: 'You must wield a dagger.' }),
    );
    expect(target.hp).toBe(startHp);
  });
});
