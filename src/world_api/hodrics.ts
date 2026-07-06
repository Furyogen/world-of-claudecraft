// Hodric's Castle Gauntlet facet: the obstacle-race queue, the live race view
// the HUD polls each frame, and the offline practice hook. Implemented by the
// offline Sim (source of truth) and mirrored by the online ClientWorld from
// the `hc` self-snapshot key.

import type { HcKnockKind, PlayerClass } from '../sim/types';

export type { HcKnockKind };

export interface HcStandingView {
  races: number;
  wins: number;
  best: number | null; // fastest personal finish, seconds
}

// One racer's line on the live progress board. Enemies in a race are just
// rivals: everyone's progress is public, that is the fun of it.
export interface HcRacerView {
  name: string;
  cls: PlayerClass;
  bot: boolean;
  you: boolean;
  progress: number; // 0..1 along the course
  finished: boolean;
  place: number | null; // 1..N once assigned
  left: boolean;
}

export interface HcMatchInfo {
  state: 'countdown' | 'active' | 'over';
  countdown: number; // whole seconds left on the plates ('countdown' only)
  clock: number; // elapsed race seconds
  timeLeft: number; // seconds until the course cap scores stragglers
  section: string; // course section id under the local racer (HUD label key)
  checkpoint: number; // last banked checkpoint index
  finished: boolean;
  place: number | null;
  falls: number;
  racers: HcRacerView[]; // placement-then-progress order
}

export interface HcInfo {
  queued: { position: number } | null;
  standing: HcStandingView | null; // null until the first race is on the books
  match: HcMatchInfo | null;
}

export interface IWorldHodrics {
  hcInfo: HcInfo | null;
  hcQueueJoin(): void;
  hcQueueLeave(): void;
  // Offline practice race against Lord Hodric's court (no-op online).
  hcPracticeStart(): boolean;
}
