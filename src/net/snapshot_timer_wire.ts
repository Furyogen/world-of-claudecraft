export const STABLE_TIMER_WIRE_VERSION = 2 as const;

export type StableTimerWireVersion = typeof STABLE_TIMER_WIRE_VERSION;

/**
 * A cooldown's absolute wall schedule in server simulation seconds.
 *
 * A plain number is the expiry time for a cooldown recovering at 1x. The
 * tuple carries an expiry time plus a temporary recovery-rate segment. The
 * segment ends at `acceleratedUntil`; after that, recovery continues at 1x
 * until `expiresAt`.
 */
export type StableCooldownWire =
  | number
  | readonly [expiresAt: number, recoveryRate: number, acceleratedUntil: number];

export type SnapshotTimerWireMode = 'legacy' | 'stable' | 'unsupported';

export function snapshotTimerWireMode(value: unknown): SnapshotTimerWireMode {
  if (value === undefined) return 'legacy';
  if (value === STABLE_TIMER_WIRE_VERSION) return 'stable';
  return 'unsupported';
}

export function isStableTimerWireVersion(value: unknown): value is StableTimerWireVersion {
  return value === STABLE_TIMER_WIRE_VERSION;
}

export function stableDeadlineRemaining(value: unknown, now: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(now)) return null;
  return Math.max(0, value - now);
}

export function stableCooldownRemaining(value: unknown, now: number): number | null {
  if (!Number.isFinite(now)) return null;
  if (typeof value === 'number') return stableDeadlineRemaining(value, now);
  if (!Array.isArray(value) || value.length !== 3) return null;

  const [expiresAt, recoveryRate, acceleratedUntilRaw] = value;
  if (
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    typeof recoveryRate !== 'number' ||
    !Number.isFinite(recoveryRate) ||
    recoveryRate <= 0 ||
    typeof acceleratedUntilRaw !== 'number' ||
    !Number.isFinite(acceleratedUntilRaw)
  )
    return null;

  const acceleratedUntil = Math.min(expiresAt, acceleratedUntilRaw);
  if (now >= acceleratedUntil) return Math.max(0, expiresAt - now);
  return Math.max(
    0,
    (acceleratedUntil - now) * recoveryRate + Math.max(0, expiresAt - acceleratedUntil),
  );
}
