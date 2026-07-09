import type { Entity, MoveInput, PlayerClass, WorldContent } from '../sim/types';

export interface IWorldEntityRoster {
  // `world` is the offline editor play-test world (carries render-only placements
  // for the renderer); optional and absent online.
  cfg: { seed: number; playerClass: PlayerClass; world?: WorldContent };
  entities: Map<number, Entity>;
  playerId: number;
  player: Entity;
  moveInput: MoveInput;
  // the realm (world/shard) this character lives on; '' in offline play
  realm: string;
  // The absolute sim clock (seconds). Offline this is the Sim's own tick clock;
  // online the ClientWorld mirrors the snapshot head's `time` and extrapolates
  // between snapshots with the wall clock. Consumers compare it against the
  // absolute sim-time deadlines/schedules the wire carries (e.g. the gauntlet
  // echo flash schedule); it is presentation timing, never a gameplay input.
  time: number;
}
