// Eastbrook Vale's Realm Builder monument, as a static world service.
//
// A singleton recognised by templateId rather than through a def list, so it
// needs no content table of its own. Two properties are worth stating, because
// both are easy to break and neither shows up in a screenshot:
//
// SELF-GATING. The monument only spawns into a world whose props still carry
// its record. custom_world_props.ts strips the authored-town records from a
// custom world, and a click target standing where no statue was drawn is worse
// than no target at all.
//
// NO ALLOCATOR, NO RNG. The reserved high-range entity id consumes neither
// nextId nor a draw, so every later entity id and every deterministic roll is
// untouched by adding it. This is the same rule the noticeboard follows; a
// static service that took an id from the sequence would move every parity
// golden in the suite.

import { EASTBROOK_LAYOUT } from './eastbrook_layout';
import { createGroundObject } from './entity';
import type { Entity, Vec3, ZonePropsDef } from './types';

/** The slice of the sim this spawn needs: no more of it is in scope here. */
export interface RealmBuilderMonumentSpawnHost {
  readonly entities: ReadonlyMap<number, Entity>;
  groundPos(x: number, z: number): Vec3;
  addEntity(entity: Entity): void;
}

/**
 * Spawn the monument's inspect entity, if this world is one that drew it.
 *
 * Throws on a duplicate reserved id: that means two static services claimed the
 * same slot, which is a content bug rather than anything a player can cause.
 */
export function spawnRealmBuilderMonument(
  host: RealmBuilderMonumentSpawnHost,
  props: Pick<ZonePropsDef, 'wells'>,
): void {
  const def = EASTBROOK_LAYOUT.civic.monument;
  if (!props.wells.some((well) => well.id === def.id)) return;
  if (host.entities.has(def.entityId)) {
    throw new Error(`Duplicate static service entity id: ${def.entityId}`);
  }
  const monument = createGroundObject(
    def.entityId,
    '',
    def.name,
    host.groundPos(def.position.x, def.position.z),
  );
  monument.templateId = def.templateId;
  monument.objectItemId = null;
  monument.lootable = true;
  monument.facing = def.rotation;
  monument.prevFacing = def.rotation;
  host.addEntity(monument);
}
