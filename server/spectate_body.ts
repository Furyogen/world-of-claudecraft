// Moves a moderator's body for /spectate: parked in limbo on enter, home to
// its saved spot on exit. The body is displaced, so a live profession session
// is torn down first and both spatial grids re-bucket it. The sim is told
// where the body really stands (`PlayerMeta.spectateAnchor`) so presence
// systems keep counting the moderator where they were: a moderator holding
// the hill who opens /spectate still holds it. `anchor` is the saved spot on
// enter and null on exit.
import { cancelProfessionSessionOnDisplacement } from '../src/sim/professions/session_teardown';
import type { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

export function moveSpectatorBody(
  sim: Sim,
  entity: Entity,
  pos: { x: number; y: number; z: number },
  anchor: { x: number; z: number } | null,
): void {
  cancelProfessionSessionOnDisplacement(sim.ctx, entity);
  entity.pos = { ...pos };
  entity.prevPos = { ...pos };
  sim.grid.update(entity);
  sim.playerGrid.update(entity);
  const meta = sim.meta(entity.id);
  if (meta) meta.spectateAnchor = anchor ? { x: anchor.x, z: anchor.z } : null;
}
