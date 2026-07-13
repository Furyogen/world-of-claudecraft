// Observability counters for the mob-AI scan hot paths (aggro proximity scans and
// threat-table walks). Plain integer visit tallies the host reads after each tick to
// attribute mob.update cost; they feed no gameplay branch and draw no rng, so
// incrementing them cannot perturb determinism.

export interface MobScanCounters {
  aggroScanPlayerVisits: number;
  threatEntryVisits: number;
}

export function createMobScanCounters(): MobScanCounters {
  return { aggroScanPlayerVisits: 0, threatEntryVisits: 0 };
}

export function resetMobScanCounters(c: MobScanCounters): void {
  c.aggroScanPlayerVisits = 0;
  c.threatEntryVisits = 0;
}
