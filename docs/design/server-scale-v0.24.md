# Server scale pass (v0.24): 100 CCU to 1000+ CCU per realm

Goal: raise the authoritative server's concurrent-player capacity by an order
of magnitude per realm process, use every core the host has for the parts of
the tick that parallelize, and change NOTHING a player can notice: same wire
format, same sim behavior (bit-identical, rng-draw-order identical), same
authority model. Horizontal scale past one realm's ceiling stays the existing
realm model (one process per realm, shared DB).

## Where the time went (baseline, release/v0.24.0)

Method: bot fleets from scripts/server_load_jitter.mjs (unique X-Forwarded-For
per bot; ALLOW_DEV_COMMANDS=1) against a local server, tick-phase percentiles
from GET /api/perf, and V8 --cpu-prof captures. Reference machine: M4 Pro
(10 performance cores); production reference remains a 2-vCPU t4g.small,
roughly 3-5x slower per core, which is why "100 CCU felt like the ceiling"
there while the same baseline build showed 12.5 ms tick p95 at 100 clustered
bots locally.

At 250 clustered fighting bots (the everyone-in-one-camp worst case) the
baseline was 3.6x OVER the 50 ms budget:

| phase | p95 (ms) |
|---|---|
| total | 182.7 |
| broadcast (interest scan + self JSON + assembly) | 136.7 |
| sim tick | 58.3 |

CPU profile attribution of busy time at 150 bots: broadcast complex ~38%,
terrain height sampling (procedural fbm noise per movement sub-step) ~13%,
socket writev ~8%, GC ~4%. Per-player-per-tick costs dominated everything:
~26 JSON.stringify delta diffs in selfWireJson, O(sessions x events) event
routing, a 20-field antibot snapshot per player per tick (against the no-op
stub detector), one Date.now() per player, and O(all camps/lakes/hubs) sqrt
gates per terrain sample under every mover.

## What changed

Safety nets FIRST, so every step proves itself:

- tests/parity (pre-existing): sim state + event stream + rng draw-order
  golden. Guards all src/sim/ changes.
- tests/server/broadcast_golden.test.ts (new): SHA-256 of every outbound
  snap/event frame for a scripted 4-class combat scenario through the real
  GameServer pipeline; raw and order-canonicalized digests.
- tests/server/snapshot_fanout_equivalence.test.ts (new): real worker_threads
  vs the in-thread path over the same scenario; canonical frame equality,
  byte-equal event streams, plus a non-vacuity check.

Single-thread pass (wire bytes unchanged except one deliberate cadence tier):

1. selfWireJson diet: stats/weapon identity gates (the sim REPLACES those
   objects, never mutates), empty-map fast paths for cds/lockouts, one
   Date.now() per broadcast, party/marks payloads built + stringified once
   per PARTY per tick instead of once per member (removes the raid
   quadratic), and the secondary panels (mail/bank/market/professions/delve
   meta/lockouts) re-diffed on a pid-staggered 4-tick cadence: at most 200 ms
   added change-detection latency on panel UI, nothing combat-actionable
   (the graphics-fairness bar), and a selfHeavyDirty session re-diffs at
   once so a player's own action still lands next snapshot.
2. routeEvents: index the batch by pid once, merge per-session candidates in
   batch order (server/event_routing.ts); O(events + candidates) instead of
   O(sessions x events); world-event anchors resolved once per batch.
3. runAntibotTick: the detector declares whether it reads runtime snapshots
   (BotDetector.wantsTickSnapshots); the no-op stub declines, the real
   private detector (flag absent) keeps receiving them.
4. Inbound: hand parser for the canonical 20 Hz movement frame
   (server/input_frame_fast.ts), JSON.parse fallback for any other byte
   shape, equivalence-fuzzed.
5. Terrain (bit-identical): per-64yd-cell shortlists of the hubs/lakes/camps
   whose gate radius can reach the cell (conservative superset, original
   arithmetic re-checked in original order), camp-flatten target height
   memoized per (camp, seed), rim crest noise (5 fbm octaves) skipped only
   where its contribution is exactly +-0.
6. Colliders (bit-identical): packed numeric grid keys (no string per
   movement sub-step), per-cell fence shortlists with an exact linear
   fallback, combatProfileForMob memoized.

Multi-core pass (server/snapshot_fanout/, see its CLAUDE.md):

- The per-session interest scan + ents/keep assembly (the measured ~43% of
  busy CPU) moved to worker_threads. Numeric per-entity facts ride a
  SharedArrayBuffer mirror rewritten each tick; wire-fragment strings ship
  as per-worker deltas computed against each worker's own ledger at
  dispatch; the interest ladder is ONE pure module both paths share
  (interest_rules.ts). Self JSON, stealth visibility (live social state),
  and every socket write stay on the main thread; frames pair the reply
  with the self JSON captured at dispatch of the same tick.
- Degradation: busy shard skips the tick (clients coast on interpolation),
  dead shard builds in-thread, repeated failures disable the pool. Sizing:
  SNAPSHOT_WORKERS=auto|0|N, auto = min(6, cores - 2), so small boxes
  auto-disable.

## Results (same machine, same scenarios)

250 clustered fighting bots, tick p95:

| build | total | broadcast | sim |
|---|---|---|---|
| baseline v0.24 | 182.7 ms | 136.7 ms | 58.3 ms |
| single-thread pass, workers OFF | 27.4 ms | 24.1 ms | 2.1 ms |
| workers ON (6) | 8.8 ms | 6.0 ms | 1.9 ms |

1000 bots across 5 camps (200 each), workers ON: total p95 29.0 ms,
broadcast 22.1 ms, sim 4.0 ms, achieved 20 Hz, and a clean independent
observer: snapshot-gap p50 50.0 ms / p95 67.7 ms / zero gaps over 100 ms.
The same 1000-bot topology before the busy-skip + cadence fixes stalled at
204 ms p95; before the whole pass it was unreachable.

Summary: ~20x at the 250-bot worst case, ~6.7x with workers off (the 2-vCPU
production profile), and one realm process now holds 1000+ CCU with 40%+
tick headroom on an 8-performance-core box. With the existing realm
sharding, ten such realms are the nominal 100x of the old 100-CCU comfort
point; a single realm's next ceiling is the main-thread self encode + socket
writes (see below).

## What we deliberately did NOT change

- Wire format and client behavior: the client decodes the same JSON; record
  order inside a snapshot was never meaningful (per-id map application).
- Sim behavior: every optimization is bit-identical and rng-draw-order
  neutral, pinned by tests/parity; iteration-order-sensitive ideas (mob AI
  LOD, zone-parallel sim) were explicitly rejected for this pass.
- Authority: all combat/loot/economy still resolves on the one sim thread;
  workers only ENCODE state for transport.

## Next levers, in measured order

1. Self encode on main (~10-20 us per player per tick): a hand serializer
   is blocked by res/mres/rtype overwriting dynamic-field positions in the
   self record; either accept a wire-format v2 for self or mirror the meta
   into the fanout. Biggest single remaining main-thread term at 1000+.
2. Socket writes (~9.4 us per send on main): gateway processes (cluster-style
   handle passing) would move WS I/O off the sim process entirely; that is
   the 5k+ CCU shape.
3. healingThreat full-entity scan per heal event: needs a live
   mobs-with-threat reverse index (a grid query is NOT equivalent: distant
   chasing mobs are in the threat set). Matters for raid-scale heal spam.
4. Fragment shipping as SharedArrayBuffer bytes instead of postMessage
   string copies (one encode, W decodes) if fanout dispatch cost shows up.
5. Bandwidth: snapshots remain uncompressed JSON (~150 KB/s per player in a
   50-crowd). Egress at 1000+ CCU is an infra cost question; a binary or
   compressed transport is a separate, client-visible project.

## How to re-measure

```
npm run build:server
ALLOW_DEV_COMMANDS=1 SNAPSHOT_WORKERS=auto node dist-server/server.cjs
BOTS=250 DURATION_MS=30000 node scripts/server_load_jitter.mjs
# multi-hub: run several with OBSERVER=0 CLUSTER_X/CLUSTER_Z offsets, plus
# one BOTS=2 instance as a clean observer; server phases via GET /api/perf.
```
