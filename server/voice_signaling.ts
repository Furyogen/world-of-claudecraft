// Pure peer-selection for proximity voice chat. Audio itself is a P2P WebRTC
// mesh between clients (see src/net/voice_chat.ts); the server's only role is
// (a) authoritatively deciding WHO each opted-in player's mesh should include
// (so both sides agree, instead of each client independently guessing), and
// (b) relaying WebRTC signaling frames (offer/answer/ice) between the two
// endpoints of an agreed pair. Neither belongs in the deterministic Sim: voice
// is not gameplay state, carries no rng, and must never affect a replay.
//
// Kept host-agnostic (no WebSocket/session types) so it is Vitest-testable
// without spinning up the server.

export const VOICE_PEER_CAP = 8;

export interface VoiceCandidate {
  pid: number;
  name: string;
  x: number;
  z: number;
}

interface RankedPair {
  a: VoiceCandidate;
  b: VoiceCandidate;
  distSq: number;
}

function distanceSq(a: VoiceCandidate, b: VoiceCandidate): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return dx * dx + dz * dz;
}

/** The `cap` nearest other voice-opted-in players to `self`, closest first.
 *  Ties broken by lower pid for a stable, deterministic order across ticks. */
export function nearestVoicePeers(
  self: VoiceCandidate,
  others: readonly VoiceCandidate[],
  cap: number = VOICE_PEER_CAP,
): { pid: number; name: string }[] {
  const ranked = others
    .filter((o) => o.pid !== self.pid)
    .map((o) => {
      return { o, distSq: distanceSq(self, o) };
    })
    .sort((a, b) => a.distSq - b.distSq || a.o.pid - b.o.pid);
  return ranked.slice(0, cap).map(({ o }) => ({ pid: o.pid, name: o.name }));
}

/** Symmetric, capped voice mesh selection for all opted-in players.
 *  Signaling is only relayed when both endpoints agree on the pair, so the
 *  server must emit mutual peer lists. Greedily adding shortest remaining edges
 *  keeps nearby players preferred while preserving the per-player cap. */
export function voicePeerLists(
  candidates: readonly VoiceCandidate[],
  cap: number = VOICE_PEER_CAP,
): Map<number, { pid: number; name: string }[]> {
  const lists = new Map<number, { pid: number; name: string }[]>();
  for (const candidate of candidates) lists.set(candidate.pid, []);

  const pairs: RankedPair[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (!a) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (!b) continue;
      pairs.push({ a, b, distSq: distanceSq(a, b) });
    }
  }
  pairs.sort(
    (x, y) =>
      x.distSq - y.distSq ||
      Math.min(x.a.pid, x.b.pid) - Math.min(y.a.pid, y.b.pid) ||
      Math.max(x.a.pid, x.b.pid) - Math.max(y.a.pid, y.b.pid),
  );

  for (const { a, b } of pairs) {
    const aPeers = lists.get(a.pid);
    const bPeers = lists.get(b.pid);
    if (!aPeers || !bPeers) continue;
    if (aPeers.length >= cap || bPeers.length >= cap) continue;
    aPeers.push({ pid: b.pid, name: b.name });
    bPeers.push({ pid: a.pid, name: a.name });
  }

  return lists;
}
