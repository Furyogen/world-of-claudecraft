#!/usr/bin/env node
// Co-located-crowd mob.update repro harness (LOCAL DEV ONLY, NEVER PRODUCTION).
//
// WARNING: this harness spawns a local game server with ALLOW_DEV_COMMANDS=1 and
// drives bot clients that teleport and level themselves. It is a local diagnostic
// tool only. It HARD-REFUSES any non-loopback target and must NEVER be pointed at
// a production host. ALLOW_DEV_COMMANDS enables level/teleport cheats and is only
// ever acceptable on a throwaway local dev server.
//
// What it does: connects N bot clients to a LOCAL dev server, dev_teleports them
// into one tight co-located cluster, stages one of three scenarios, and records
// the server's perf heartbeat (the mob-scan visit counters and the per-sim-lap
// mob.update buckets) plus optional frozen perf-capture windows into a results
// file under tmp/. It exists to reproduce and measure how the per-tick mob AI
// scan cost scales with the size of a co-located crowd.
//
// The three scenarios (SCENARIO env):
//   idle-crowd  a crowd of trivial-con bots parked ON a low-level camp. Every idle
//               owner-less mob runs a radius-25 player-grid scan EVERY tick and the
//               scan counter increments for every visited player BEFORE the trivial
//               check, so the crowd pays the full aggro-scan cost while the mobs stay
//               idle. Signature: aggroVisits grows with N, threatVisits stays ~0.
//   mass-pull   every bot lands a hit on every camp mob so each engaged mob's threat
//               table holds all N bots, then bots stop dealing damage so the mobs
//               survive the measurement window. Signature: threatVisits grows with N
//               across several engaged mobs.
//   boss-pulse  every bot taps the world boss so its single threat table holds all N
//               bots; the boss cannot die from taps. Its per-player mechanics then
//               loop over all N. Signature: threatVisits grows with N (one mob, an
//               N-entry table) and the mob.update|elemental bucket grows.
//
// Prerequisites:
//   - npm run db:up  (dev Postgres on 127.0.0.1:5433)
//   - a local .env with DATABASE_URL (the harness reads it via process.loadEnvFile,
//     which needs Node 20.12+ or 21.7+; on older Node export DATABASE_URL yourself)
//   - node_modules installed
//   - restart the server after ANY code change: the server bundle is baked at start,
//     so a stale bundle runs old code. The default child-server mode below re-bundles
//     on every run, which sidesteps this; EXTERNAL_SERVER mode does not.
//
// Default mode (child server): the harness spawns `npm run server` itself with
// PERF_TICK_LOG=1, ALLOW_DEV_COMMANDS=1, and MAX_WS_PER_IP_HARD=<BOT_COUNT+5>, parses
// its heartbeat lines live, and stops it on exit. Manual invocation:
//   SCENARIO=idle-crowd BOT_COUNT=20 node scripts/mob_stall_repro.mjs
//
// EXTERNAL_SERVER mode: attach to a server you started yourself and read its
// heartbeats by tailing its stdout log (SERVER_LOG). Start the server with:
//   PERF_TICK_LOG=1 ALLOW_DEV_COMMANDS=1 MAX_WS_PER_IP_HARD=25 npm run server > tmp/server.log 2>&1
// then run:
//   EXTERNAL_SERVER=1 SERVER_LOG=tmp/server.log SCENARIO=idle-crowd BOT_COUNT=20 \
//     node scripts/mob_stall_repro.mjs
//
// Env knobs (all bounded):
//   SCENARIO             required: idle-crowd | mass-pull | boss-pulse
//   BOT_COUNT            bot clients (default 20, 1 to 100)
//   BOT_LEVEL            override the scenario default level (1 to 20)
//   MEASURE_MS           measurement window length (default 60000, 5000 to 600000)
//   SERVER_URL           default http://localhost:8787 (loopback-enforced, always)
//   DATABASE_URL         required (from .env); disposable accounts are created here;
//                        loopback-enforced like SERVER_URL
//   EXTERNAL_SERVER      0 (spawn a child server) or 1 (attach to a running one)
//   SERVER_LOG           required when EXTERNAL_SERVER=1: path to the server stdout log
//   CLEANUP              1 (default: delete seeded accounts at the end) or 0 (keep them)
//   RUN_ID               run tag (default 5 random letters)
//   REALM_NAME           realm the bot characters join (default Claudemoon)
//   CONNECT_CONCURRENCY  parallel connects (default 10, 1 to 50)
//
// Results file: JSONL under tmp/ (gitignored), one file per run:
//   tmp/mob_stall_<scenario>_<count>_<runid>.jsonl
// with distinct record kinds:
//   meta       run config, git head, start iso (first line)
//   heartbeat  one per [perf] line: online, ents, tickHz, tickMs, over, the tick-loop
//              timing buckets (key `timings`, not the reserved word), visits, serializes,
//              serializeMs, aggroVisits (latest single tick), threatVisits (latest tick)
//   simline    one per [perf.sim] line: the per-sim-lap buckets (mob.update and the
//              mob.update|<family> children). A bucket missing from a line means it was
//              not in the server's top-14 that tick, NOT that it was zero.
//   capture    one per finished perf-capture window: the full PerfCaptureResult
//              (aggroVisitsTotal, aggroVisitsMaxPerTick, threatVisitsTotal,
//              threatVisitsMaxPerTick, and the frozen profile).
// The server stdout is also mirrored verbatim to tmp/mob_stall_<...>.server.log.
//
// Loopback-only policy: BOTH the game-server target and the database host are resolved
// at startup and any non-loopback host is refused (exit non-zero) before touching the
// DB or spawning a server. Env overrides of SERVER_URL and DATABASE_URL are allowed but
// must resolve to localhost, 127.0.0.1, or ::1. The DB guard matters because the
// harness also provisions a THROWAWAY admin account (for the ops.perf perf-capture
// routes) that is created at startup and deleted in the same run's cleanup; that must
// only ever happen against the disposable local dev database.

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, createWriteStream, fstatSync, mkdirSync, openSync, readSync } from 'node:fs';
import { createInterface } from 'node:readline';
import pg from 'pg';
import WebSocket from 'ws';

try {
  process.loadEnvFile?.();
} catch {}

const { Pool } = pg;

const SERVER_URL = (process.env.SERVER_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const WS_URL = `${SERVER_URL.replace(/^http/, 'ws')}/ws`;
const DATABASE_URL = process.env.DATABASE_URL;
const REALM = process.env.REALM_NAME ?? 'Claudemoon';
const SCENARIO = process.env.SCENARIO ?? '';
const BOT_COUNT = boundedInt(process.env.BOT_COUNT, 20, 1, 100);
const MEASURE_MS = boundedInt(process.env.MEASURE_MS, 60_000, 5_000, 600_000);
const CONNECT_CONCURRENCY = boundedInt(process.env.CONNECT_CONCURRENCY, 10, 1, 50);
const EXTERNAL_SERVER = process.env.EXTERNAL_SERVER === '1';
const SERVER_LOG = process.env.SERVER_LOG ?? '';
const CLEANUP = process.env.CLEANUP !== '0';
const RUN_ID =
  (process.env.RUN_ID ?? randomLetters(5)).replace(/[^A-Za-z]/g, '').slice(0, 8) ||
  randomLetters(5);

// Scenario staging. idle-crowd parks trivial-con bots (a level gap of 10+ over the
// forest_wolf level 1 to 2 camp) so the mobs never engage. mass-pull uses the SAME
// forest_wolf camp on purpose: it is the lowest-damage camp in the zone, so the bots
// survive a long window standing in it (bot deaths are what collapse the threat tables),
// while the bots run LOW enough that each bot's single tap does not, in aggregate over
// N bots, wipe the 68 hp wolves. boss-pulse taps the world boss (which cannot die to N
// taps) to hang an N-entry table on it; the boss is DESIGNED to require a healed raid
// (moveSpeed 11.6 beats a player's 7, plus a 40yd snare, so unhealed bots cannot kite or
// survive), so its engagement is FRONT-LOADED: strongest in the first ~20-30s before the
// crowd wipes. The early perf capture is timed to land in that window.
// hold strategy during the measurement window:
//   'passive'  never attack (idle-crowd): the mobs are trivial and never engage.
//   'once'     tap each mob once then hold in place (mass-pull, boss-pulse): total damage
//              stays near N taps per mob, so a low-hp camp survives and a world boss is
//              never dented. Respawned bots re-tap to climb back onto the tables.
// The spot coordinates are content-coupled: (-15, 55) is the zone1 forest_wolf camp and
// (110, 760) is the zone3 world boss. If the content moves, the staging assertion fails
// loudly (STAGING FAILED) instead of silently measuring an empty field; update the spots
// from src/sim/content/zone1.ts and src/sim/world_boss.ts if that happens.
const SCENARIOS = {
  'idle-crowd': {
    level: 18,
    spot: { x: -15, z: 55 },
    campRadius: 22,
    tap: false,
    sig: 'aggro',
    hold: 'passive',
  },
  'mass-pull': {
    level: 3,
    spot: { x: -15, z: 55 },
    campRadius: 22,
    tap: true,
    sig: 'threat',
    hold: 'once',
  },
  'boss-pulse': {
    level: 20,
    spot: { x: 110, z: 760 },
    campRadius: 6,
    tap: true,
    sig: 'threat',
    hold: 'once',
  },
};

if (!SCENARIOS[SCENARIO]) {
  console.error(
    `[mob-stall] SCENARIO must be one of: ${Object.keys(SCENARIOS).join(', ')} (got "${SCENARIO}")`,
  );
  process.exit(2);
}

const CFG = SCENARIOS[SCENARIO];
const BOT_LEVEL = boundedInt(process.env.BOT_LEVEL, CFG.level, 1, 20);

// Loop pacing constants (ms). Not env knobs: they are tuned to the server's 5s
// heartbeat cadence so each observation window spans at least two heartbeats.
const STEP_MS = 200; // bot decision cadence
const STAGE_MS = 4_000; // teleport + level settle (dev commands throttle at ~1.5s)
const OBSERVE_MS = 14_000; // staging-check window: spans ~2 to 3 heartbeats
const CAPTURE_MS = 10_000; // perf-capture window length (clamped 3000 to 30000 server-side)
const TAP_MELEE = 4.5; // yd: close enough to land an auto-attack
const TAP_DWELL_MS = 2_200; // dwell on one mob long enough for an auto-attack swing to land
const READY_TIMEOUT_MS = 180_000; // the child re-bundles before it listens, so be patient

const CLASSES = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

const DELTA_SELF_KEYS = [
  'inv',
  'equip',
  'qlog',
  'qdone',
  'cds',
  'stats',
  'weapon',
  'party',
  'trade',
  'duel',
];
const ENTITY_IDENTITY_KEYS = ['k', 'tid', 'nm', 'lv', 'sc', 'c', 'dgn'];

// Runtime state shared by the server-line parser, the bots, and the summary.
let botMode = 'idle'; // 'stage' | 'tap' | 'hold'
let adminToken = null;
const heartbeats = [];
const simMobUpdate = [];
let lastAggro = 0;
let lastThreat = 0;
let captureCount = 0;

const TMP_DIR = 'tmp';
const RESULTS_PATH = `${TMP_DIR}/mob_stall_${SCENARIO}_${BOT_COUNT}_${RUN_ID}.jsonl`;
const SERVER_LOG_PATH = `${TMP_DIR}/mob_stall_${SCENARIO}_${BOT_COUNT}_${RUN_ID}.server.log`;
let resultsStream = null;
let logStream = null;

function boundedInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomLetters(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function charName(index) {
  let n = index;
  let suffix = '';
  do {
    suffix = String.fromCharCode(65 + (n % 26)) + suffix;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Stall${RUN_ID}${suffix}`.replace(/[^A-Za-z]/g, '').slice(0, 16);
}

function jitteredSpot(spot, index) {
  // A few yd of jitter so the crowd does not stack on one exact point, but stays a
  // tight cluster centered on the camp.
  const angle = (index * 2.399963229728653) % (Math.PI * 2);
  const radius = 3 + (index % 5);
  return {
    x: Math.round((spot.x + Math.cos(angle) * radius) * 10) / 10,
    z: Math.round((spot.z + Math.sin(angle) * radius) * 10) / 10,
  };
}

function mergeSelf(prev, next) {
  if (!next) return prev;
  if (!prev) return next;
  const merged = { ...next };
  for (const key of DELTA_SELF_KEYS) {
    if (merged[key] === undefined && prev[key] !== undefined) merged[key] = prev[key];
  }
  return merged;
}

function mergeEnts(prevEnts, snap) {
  const next = new Map();
  const keep = Array.isArray(snap.keep) ? new Set(snap.keep) : new Set();
  for (const entity of snap.ents ?? []) {
    const prev = prevEnts.get(entity.id);
    const merged = prev ? { ...prev, ...entity } : entity;
    if (prev) {
      for (const key of ENTITY_IDENTITY_KEYS) {
        if (merged[key] === undefined && prev[key] !== undefined) merged[key] = prev[key];
      }
    }
    next.set(merged.id, merged);
  }
  for (const id of keep) {
    if (!next.has(id) && prevEnts.has(id)) next.set(id, prevEnts.get(id));
  }
  return next;
}

function isAliveMob(entity) {
  return entity?.k === 'mob' && entity.dead !== true && (entity.h ?? 1) > 0;
}

// --- Loopback safety: refuse any non-local target before doing anything else. ---

function assertLoopback(urlStr, label = 'SERVER_URL') {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    // Never echo the raw value: DATABASE_URL carries credentials.
    throw new Error(`invalid ${label} (not a parseable URL)`);
  }
  const host = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  const ok = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!ok) {
    throw new Error(
      `refusing non-loopback ${label} host "${u.hostname}". This harness runs against a LOCAL ` +
        'dev server and dev database only and must never touch production. Allowed hosts: ' +
        'localhost, 127.0.0.1, ::1.',
    );
  }
  return u;
}

// --- Server-line parsing (heartbeat + per-sim-lap buckets). ---

function num(re, line) {
  const m = re.exec(line);
  return m ? Number(m[1]) : null;
}

function timingPair(name, line) {
  const m = new RegExp(`\\b${name}=([\\d.]+)/([\\d.]+)`).exec(line);
  return m ? { p95: Number(m[1]), max: Number(m[2]) } : null;
}

function parseHeartbeat(line) {
  const tickHzMatch = /\btickHz=(n\/a|[\d.]+)/.exec(line);
  const tickHz = tickHzMatch ? (tickHzMatch[1] === 'n/a' ? null : Number(tickHzMatch[1])) : null;
  const timings = {};
  for (const name of ['total', 'tick', 'broadcast', 'bcastSelf', 'bcastGrid', 'events', 'social']) {
    const p = timingPair(name, line);
    if (p) timings[name] = p;
  }
  return {
    online: num(/\bonline=(\d+)/, line),
    ents: num(/\bents=(\d+)/, line),
    tickHz,
    tickMs: num(/\btickMs=([\d.]+)/, line),
    over: / OVER\b/.test(line),
    timings,
    visits: num(/\bvisits=(\d+)/, line),
    serializes: num(/\bserializes=(\d+)/, line),
    serializeMs: num(/\bserializeMs=([\d.]+)/, line),
    aggroVisits: num(/\baggroVisits=(\d+)/, line),
    threatVisits: num(/\bthreatVisits=(\d+)/, line),
  };
}

function parseSimline(line) {
  const body = line.replace(/^\[perf\.sim\]\s+mean\/p95\/max\s+/, '');
  const buckets = {};
  const re = /([A-Za-z0-9.|_]+)=([\d.]+)\/([\d.]+)\/([\d.]+)/g;
  for (const m of body.matchAll(re)) {
    buckets[m[1]] = { mean: Number(m[2]), p95: Number(m[3]), max: Number(m[4]) };
  }
  return buckets;
}

function writeRecord(rec) {
  if (resultsStream) resultsStream.write(`${JSON.stringify(rec)}\n`);
}

function handleServerLine(line) {
  if (logStream) logStream.write(`${line}\n`);
  const ts = new Date().toISOString();
  if (line.startsWith('[perf.sim]')) {
    const buckets = parseSimline(line);
    if (Object.keys(buckets).length === 0) return;
    writeRecord({ kind: 'simline', scenario: SCENARIO, clients: BOT_COUNT, ts, buckets });
    if (buckets['mob.update']) simMobUpdate.push(buckets['mob.update']);
    return;
  }
  if (line.startsWith('[perf]')) {
    const hb = parseHeartbeat(line);
    writeRecord({ kind: 'heartbeat', scenario: SCENARIO, clients: BOT_COUNT, ts, ...hb });
    heartbeats.push(hb);
    if (hb.aggroVisits != null) lastAggro = hb.aggroVisits;
    if (hb.threatVisits != null) lastThreat = hb.threatVisits;
  }
}

// A tiny append-only file tailer for EXTERNAL_SERVER mode: it starts at the current
// end of the file and reads newly appended lines on an interval.
function tailFile(path, onLine, onError) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch (err) {
    onError(err);
    return () => {};
  }
  let offset = 0;
  try {
    offset = fstatSync(fd).size;
  } catch {}
  let buf = '';
  const timer = setInterval(() => {
    let size;
    try {
      size = fstatSync(fd).size;
    } catch {
      return;
    }
    if (size < offset) offset = 0; // file was truncated/rotated
    if (size <= offset) return;
    const len = size - offset;
    const bytes = Buffer.alloc(len);
    const read = readSync(fd, bytes, 0, len, offset);
    offset += read;
    buf += bytes.toString('utf8', 0, read);
    let idx = buf.indexOf('\n');
    while (idx >= 0) {
      onLine(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
      idx = buf.indexOf('\n');
    }
  }, 250);
  return () => {
    clearInterval(timer);
    try {
      closeSync(fd);
    } catch {}
  };
}

// --- Bot client. ---

class Bot {
  constructor(record, spot) {
    this.username = record.username;
    this.token = record.token;
    this.characterId = record.characterId;
    this.accountId = record.accountId;
    this.name = record.name;
    this.spot = spot;
    this.ws = null;
    this.pid = 0;
    this.self = null;
    this.ents = new Map();
    this.connected = false;
    this.ready = false;
    this.closed = false;
    this.closeCode = 0;
    this.deaths = 0;
    this.facing = 0;
    this.tapped = new Set(); // mob ids this bot has already landed a hit on
    this.currentTapId = null;
    this.tapStartAt = 0;
    this.lastStageAt = 0;
    this.lastKeepAliveAt = 0;
    this.lastRespawnAt = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      };
      const timeout = setTimeout(() => {
        fail(new Error(`${this.name} timed out waiting for hello`));
        ws.close();
      }, 10_000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'auth', token: this.token, character: this.characterId }));
      });
      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.t === 'hello') {
          if (settled) return;
          settled = true;
          this.pid = msg.id;
          this.connected = true;
          clearTimeout(timeout);
          resolve(this);
          return;
        }
        if (msg.t === 'error') {
          fail(new Error(`${this.name} auth failed: ${msg.error ?? 'unknown websocket error'}`));
          ws.close();
          return;
        }
        if (msg.t === 'snap') {
          this.self = mergeSelf(this.self, msg.self);
          this.ents = mergeEnts(this.ents, msg);
          if (this.self?.dead === true) this.deaths += 0; // death handled in step()
          this.ready = true;
        }
      });
      ws.on('error', (err) => {
        if (!this.connected) fail(err);
      });
      ws.on('close', (code) => {
        this.closeCode = code;
        this.closed = true;
        this.connected = false;
        if (!settled) {
          const hint =
            code === 1008
              ? ' Increase MAX_WS_PER_IP_HARD, restart the server, and close extra local sessions.'
              : '';
          fail(new Error(`${this.name} closed before hello: code=${code}.${hint}`));
        }
      });
    });
  }

  cmd(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'cmd', ...payload }));
    }
  }

  input(mi = {}, facing = this.facing) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.facing = facing;
    this.ws.send(JSON.stringify({ t: 'input', mi, facing }));
  }

  dist(pos) {
    if (!this.self) return Infinity;
    return Math.hypot((pos.x ?? 0) - this.self.x, (pos.z ?? 0) - this.self.z);
  }

  faceTo(pos) {
    if (!this.self) return this.facing;
    return Math.atan2((pos.x ?? 0) - this.self.x, (pos.z ?? 0) - this.self.z);
  }

  keepAlive() {
    const now = Date.now();
    if (now - this.lastKeepAliveAt < 2_000) return;
    this.lastKeepAliveAt = now;
    this.input({}, this.facing);
  }

  stage() {
    const now = Date.now();
    if (now - this.lastStageAt < 1_500) return;
    this.lastStageAt = now;
    this.cmd({ cmd: 'dev_level', level: BOT_LEVEL });
    this.cmd({ cmd: 'dev_teleport', x: this.spot.x, z: this.spot.z });
  }

  // Camp mobs near the bot. Range is generous so mobs that chase the cluster stay in
  // the set instead of falling out as they close in.
  campMobs() {
    const range = CFG.campRadius + 30;
    return [...this.ents.values()].filter((e) => isAliveMob(e) && this.dist(e) <= range);
  }

  respawnIfDead() {
    if (this.self?.dead !== true) return false;
    const now = Date.now();
    if (now - this.lastRespawnAt < 3_000) return true;
    this.lastRespawnAt = now;
    this.deaths += 1;
    this.cmd({ cmd: 'release' });
    this.cmd({ cmd: 'dev_level', level: BOT_LEVEL });
    this.cmd({ cmd: 'dev_teleport', x: this.spot.x, z: this.spot.z });
    // Re-tap after a respawn: a dead bot dropped off every threat table, so it has to
    // land a fresh hit on each mob to climb back on. Clearing tapped restarts that.
    if (CFG.tap) this.tapped.clear();
    this.currentTapId = null;
    return true;
  }

  // Land ONE hit on each camp mob, then stop. Each bot walks to the nearest not-yet
  // tapped mob, targets and auto-attacks it, dwells about one swing so a hit lands, and
  // marks it done. Once every reachable mob is tapped it holds in place, so each mob
  // takes only ~N taps total (one per bot) and survives the window.
  tapStep() {
    if (!this.ready || !this.self || this.closed) return;
    if (this.respawnIfDead()) return;
    const targets = this.campMobs().filter((m) => !this.tapped.has(m.id));
    if (targets.length === 0) {
      this.holdInPlace();
      return;
    }
    targets.sort((a, b) => this.dist(a) - this.dist(b));
    const target = targets[0];
    if (this.currentTapId !== target.id) {
      this.currentTapId = target.id;
      this.tapStartAt = Date.now();
    }
    const facing = this.faceTo(target);
    if (this.dist(target) > TAP_MELEE) {
      this.input({ f: 1 }, facing);
      return;
    }
    this.input({}, facing);
    if (this.self.target !== target.id) {
      this.cmd({ cmd: 'target', id: target.id });
      this.cmd({ cmd: 'attack' });
    }
    // Dwell one swing so an auto-attack resolves, then consider this mob tapped.
    if (Date.now() - this.tapStartAt > TAP_DWELL_MS) {
      this.tapped.add(target.id);
      this.currentTapId = null;
    }
  }

  // Passive: stop dealing damage so the mobs survive, but stay in place so they stay
  // engaged with this (living) bot on their threat table. This is why mass-pull uses a
  // low-damage camp: if the bot dies, it drops off every table and the crowd shrinks.
  holdInPlace() {
    if (this.self?.target != null) this.cmd({ cmd: 'stopattack' });
    this.keepAlive();
  }

  // The active behavior for the tap window and the measurement window, per scenario.
  engageStep() {
    if (CFG.hold === 'once') return this.tapStep();
    // passive: idle-crowd, parked and never attacking.
    if (!this.ready || !this.self || this.closed) return;
    if (this.respawnIfDead()) return;
    this.holdInPlace();
  }

  step() {
    if (botMode === 'stage') return this.stage();
    return this.engageStep();
  }

  close() {
    this.ws?.close();
  }
}

// --- DB seeding + admin token provisioning. ---

async function provisionAdmin(pool) {
  const username = `stall_admin_${RUN_ID.toLowerCase()}`;
  const token = randomBytes(32).toString('hex');
  const account = await pool.query(
    `INSERT INTO accounts (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [username, 'loadtest:token-only'],
  );
  const accountId = account.rows[0].id;
  // The admin dashboard resolves a Bearer auth_token to an account and reads its
  // admin_roles; the `admin` role carries the ops.perf permission the perf routes
  // require. This is a throwaway local dev account, deleted at cleanup.
  await pool.query(
    `UPDATE accounts SET is_admin = TRUE, admin_roles = ARRAY['admin']::text[] WHERE id = $1`,
    [accountId],
  );
  await pool.query(
    `INSERT INTO auth_tokens (token, account_id, expires_at)
     VALUES ($1, $2, now() + interval '12 hours')`,
    [token, accountId],
  );
  return { accountId, token, username };
}

async function seedBots(pool) {
  const records = [];
  for (let i = 0; i < BOT_COUNT; i += 1) {
    const username = `stall_${RUN_ID.toLowerCase()}_${String(i).padStart(3, '0')}`;
    const name = charName(i);
    const cls = CLASSES[i % CLASSES.length];
    const token = randomBytes(32).toString('hex');
    const account = await pool.query(
      `INSERT INTO accounts (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [username, 'loadtest:token-only'],
    );
    const accountId = account.rows[0].id;
    await pool.query(
      `INSERT INTO auth_tokens (token, account_id, expires_at)
       VALUES ($1, $2, now() + interval '12 hours')`,
      [token, accountId],
    );
    const character = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, state)
       VALUES ($1, $2, $3, $4, NULL)
       RETURNING id`,
      [accountId, name, cls, REALM],
    );
    records.push({ username, token, characterId: character.rows[0].id, name, accountId });
  }
  return records;
}

async function cleanupAccounts(pool, accountIds) {
  if (accountIds.length === 0) return;
  await pool.query('DELETE FROM accounts WHERE id = ANY($1::int[])', [accountIds]);
}

async function connectAll(records) {
  const bots = records.map((record, index) => new Bot(record, jitteredSpot(CFG.spot, index)));
  let next = 0;
  async function worker() {
    while (next < bots.length) {
      const bot = bots[next];
      next += 1;
      try {
        await bot.connect();
        await sleep(80);
      } catch (err) {
        const connected = bots.filter((b) => b.connected).length;
        throw new Error(
          `failed connecting ${bot.name} after ${connected}/${bots.length} clients: ${err.message}`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONNECT_CONCURRENCY, bots.length) }, worker));
  return bots;
}

// --- Admin perf-capture wiring. ---

async function adminFetch(method, path, body) {
  if (!adminToken) return null;
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    console.log(`[mob-stall] admin ${method} ${path} -> HTTP ${res.status}`);
    return null;
  }
  // The admin API wraps payloads in an envelope: { success, data, error }. Unwrap it
  // to the data (and treat success:false as a failure).
  const json = await res.json();
  if (json && typeof json === 'object' && 'success' in json) {
    return json.success ? json.data : null;
  }
  return json;
}

async function runCapture(durationMs) {
  try {
    const started = await adminFetch('POST', '/admin/api/perf/tick/capture', { durationMs });
    const startId = started?.captureId;
    if (!startId) return null;
    const deadline = Date.now() + durationMs + 8_000;
    while (Date.now() < deadline) {
      await sleep(1_000);
      const status = await adminFetch('GET', '/admin/api/perf/tick');
      if (status?.capturing === false && status.last?.captureId === startId) {
        writeRecord({
          kind: 'capture',
          scenario: SCENARIO,
          clients: BOT_COUNT,
          ts: new Date().toISOString(),
          result: status.last,
        });
        captureCount += 1;
        console.log(
          `[mob-stall] capture done: aggroVisitsTotal=${status.last.aggroVisitsTotal} ` +
            `threatVisitsTotal=${status.last.threatVisitsTotal} simTicks=${status.last.simTicks}`,
        );
        return status.last;
      }
    }
    console.log('[mob-stall] capture did not finalize before its deadline');
    return null;
  } catch (err) {
    console.log(`[mob-stall] capture failed: ${err.message}`);
    return null;
  }
}

// --- Server management. ---

function spawnServer() {
  console.log('[mob-stall] spawning: npm run server (re-bundles current code, then listens)');
  // detached:true makes the child its own process-group leader so teardown can signal
  // the WHOLE tree (npm -> sh -> node dist-server/server.cjs). Signalling only the npm
  // parent leaks the node grandchild, which keeps holding the port across runs.
  const child = spawn('npm', ['run', 'server'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PERF_TICK_LOG: '1',
      ALLOW_DEV_COMMANDS: '1',
      MAX_WS_PER_IP_HARD: String(BOT_COUNT + 5),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const rl = createInterface({ input: child.stdout });
  rl.on('line', handleServerLine);
  child.stderr.on('data', (chunk) => {
    if (logStream) logStream.write(chunk);
  });
  child.on('exit', (code, signal) => {
    console.log(`[mob-stall] server child exited code=${code} signal=${signal}`);
  });
  const signalGroup = (sig) => {
    if (child.pid == null) return;
    try {
      process.kill(-child.pid, sig); // negative pid: signal the whole process group
    } catch {
      try {
        child.kill(sig);
      } catch {}
    }
  };
  const stop = async () => {
    signalGroup('SIGINT');
    await sleep(1_500);
    signalGroup('SIGKILL');
  };
  return stop;
}

async function waitForServerReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let logged = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER_URL}/readyz`, { method: 'GET' });
      if (res.ok) return true;
    } catch {
      if (!logged) {
        console.log('[mob-stall] waiting for the server to bundle and listen...');
        logged = true;
      }
    }
    await sleep(500);
  }
  return false;
}

// --- Staging evaluation. ---

function evaluateStaging(fresh) {
  const maxAggro = fresh.reduce((m, h) => Math.max(m, h.aggroVisits ?? 0), 0);
  const maxThreat = fresh.reduce((m, h) => Math.max(m, h.threatVisits ?? 0), 0);
  if (CFG.sig === 'aggro') {
    const need = BOT_COUNT; // at least one idle mob scanning the whole crowd
    return {
      ok: maxAggro >= need,
      detail: `aggroVisits max=${maxAggro} (need >= ${need}); threatVisits max=${maxThreat} (expect ~0)`,
    };
  }
  // Both tap scenarios prove the signature with threatVisits clearly scaling past a
  // half-crowd table. mass-pull spreads across several camp mobs that leash and respawn,
  // so its tables never all fill at once; boss-pulse holds one big table but churns as
  // the boss AoE kills and the crowd re-taps. A half-N floor confirms the mechanism
  // without flaking on that churn (the heartbeats and captures carry the magnitude).
  const need = Math.max(2, Math.floor(BOT_COUNT / 2));
  return {
    ok: maxThreat >= need,
    detail: `threatVisits max=${maxThreat} (need >= ${need}); aggroVisits max=${maxAggro}`,
  };
}

async function measurementWindow(ms) {
  console.log(`[mob-stall] measurement window: ${ms} ms (bots holding, collecting heartbeats)`);
  const start = Date.now();
  const captures = [];
  const canCapture = adminToken && ms >= CAPTURE_MS + 6_000;
  if (canCapture) {
    // Fire the first capture EARLY: boss-pulse engagement is front-loaded (the crowd
    // wipes within ~20 to 30s), so a late capture would miss it. mass-pull is engaged
    // throughout, so an early capture works for it too.
    await sleep(Math.max(3_000, Math.floor(ms * 0.08)));
    captures.push(runCapture(CAPTURE_MS));
    // A second capture mid-window when there is room, to catch mass-pull once its tables
    // have fully filled (it keeps building past the first capture).
    if (ms >= 2 * CAPTURE_MS + 12_000) {
      const until = start + Math.floor(ms * 0.5);
      await sleep(Math.max(0, until - Date.now()));
      captures.push(runCapture(CAPTURE_MS));
    }
  } else if (adminToken) {
    console.log(`[mob-stall] window under ${CAPTURE_MS + 6_000} ms: heartbeat-only, no capture`);
  } else {
    console.log('[mob-stall] no admin ops.perf token: heartbeat-only, no frozen capture windows');
  }
  const remaining = ms - (Date.now() - start);
  if (remaining > 0) await sleep(remaining);
  await Promise.allSettled(captures);
}

function printSummary(staging) {
  const means = simMobUpdate.map((x) => x.mean).sort((a, b) => a - b);
  const meanAvg = means.length ? means.reduce((a, b) => a + b, 0) / means.length : 0;
  const p95 = means.length ? (means[Math.floor(means.length * 0.95)] ?? means.at(-1)) : 0;
  console.log('[mob-stall] ---- summary ----');
  console.log(`[mob-stall] scenario=${SCENARIO} clients=${BOT_COUNT} level=${BOT_LEVEL}`);
  console.log(`[mob-stall] staging: ${staging.ok ? 'OK' : 'FAILED'} (${staging.detail})`);
  console.log(
    `[mob-stall] samples: heartbeat=${heartbeats.length} simline=${simMobUpdate.length} ` +
      `capture=${captureCount}`,
  );
  console.log(
    `[mob-stall] mob.update mean (avg over sim laps)=${meanAvg.toFixed(3)} ms, ` +
      `p95 of lap means=${Number(p95).toFixed(3)} ms`,
  );
  console.log(`[mob-stall] last aggroVisits=${lastAggro} threatVisits=${lastThreat}`);
  console.log(`[mob-stall] results: ${RESULTS_PATH}`);
  console.log(`[mob-stall] server log: ${SERVER_LOG_PATH}`);
}

// --- Orchestration. ---

async function main() {
  // Safety FIRST: refuse a non-loopback target before touching the DB or a server.
  const url = assertLoopback(SERVER_URL);
  console.log(`[mob-stall] target ${url.href} is loopback: ok`);

  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required so the harness can create disposable accounts.');
  }
  // The DB gets disposable bot accounts AND a throwaway admin row, so it is
  // loopback-enforced exactly like the game-server target.
  const dbUrl = assertLoopback(DATABASE_URL, 'DATABASE_URL');
  console.log(`[mob-stall] database host ${dbUrl.hostname} is loopback: ok`);
  if (EXTERNAL_SERVER && !SERVER_LOG) {
    throw new Error(
      'EXTERNAL_SERVER=1 requires SERVER_LOG=<path> so the harness can read the heartbeat counters. ' +
        'Start the server with PERF_TICK_LOG=1 ALLOW_DEV_COMMANDS=1 MAX_WS_PER_IP_HARD=' +
        `${BOT_COUNT + 5} npm run server > <that log> 2>&1`,
    );
  }

  mkdirSync(TMP_DIR, { recursive: true });
  resultsStream = createWriteStream(RESULTS_PATH, { flags: 'a' });
  logStream = createWriteStream(SERVER_LOG_PATH, { flags: 'a' });

  let gitHead = 'unknown';
  try {
    gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() }).toString().trim();
  } catch {}

  writeRecord({
    kind: 'meta',
    scenario: SCENARIO,
    clients: BOT_COUNT,
    botLevel: BOT_LEVEL,
    measureMs: MEASURE_MS,
    serverUrl: SERVER_URL,
    realm: REALM,
    runId: RUN_ID,
    mode: EXTERNAL_SERVER ? 'external' : 'child',
    spot: CFG.spot,
    campRadius: CFG.campRadius,
    gitHead,
    startIso: new Date().toISOString(),
  });

  const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  const accountIds = [];
  let stopServer = () => {};
  let stopTail = () => {};
  let botTimer = null;
  let bots = [];
  let tornDown = false;

  async function teardown() {
    if (tornDown) return;
    tornDown = true;
    if (botTimer) clearInterval(botTimer);
    for (const bot of bots) bot.close();
    await sleep(400);
    if (CLEANUP && accountIds.length > 0) {
      console.log(`[mob-stall] cleanup: deleting ${accountIds.length} seeded account(s)`);
      await cleanupAccounts(pool, accountIds).catch((err) =>
        console.log(`[mob-stall] cleanup failed: ${err.message}`),
      );
    }
    await pool.end().catch(() => {});
    stopTail();
    await stopServer();
    if (resultsStream) resultsStream.end();
    if (logStream) logStream.end();
  }

  process.once('SIGINT', () => {
    console.log('[mob-stall] SIGINT: tearing down');
    teardown()
      .then(() => process.exit(130))
      .catch(() => process.exit(1));
  });

  try {
    if (EXTERNAL_SERVER) {
      console.log(`[mob-stall] EXTERNAL_SERVER: attaching to ${SERVER_URL}, tailing ${SERVER_LOG}`);
      if (BOT_COUNT > 20) {
        console.log(
          `[mob-stall] start the external server with MAX_WS_PER_IP_HARD=${BOT_COUNT + 5} or higher`,
        );
      }
      stopTail = tailFile(SERVER_LOG, handleServerLine, (err) =>
        console.log(`[mob-stall] tail error on ${SERVER_LOG}: ${err.message}`),
      );
    } else {
      // Refuse to run if something already answers on the port: otherwise we would
      // spawn a server that cannot bind and silently drive a stale leftover instead.
      let occupied = false;
      try {
        await fetch(`${SERVER_URL}/readyz`);
        occupied = true;
      } catch {}
      if (occupied) {
        throw new Error(
          `something is already listening on ${SERVER_URL}. Stop it first, or use ` +
            'EXTERNAL_SERVER=1 with SERVER_LOG to attach to it on purpose.',
        );
      }
      stopServer = spawnServer();
    }

    const ready = await waitForServerReady(READY_TIMEOUT_MS);
    if (!ready) throw new Error('server did not become ready before the timeout');
    console.log('[mob-stall] server ready');

    const admin = await provisionAdmin(pool);
    accountIds.push(admin.accountId);
    // Confirm the token actually carries ops.perf before relying on captures. The
    // token must be live for adminFetch to make the request, so set it first and
    // clear it again if the probe does not come back with the capture status.
    adminToken = admin.token;
    const probe = await adminFetch('GET', '/admin/api/perf/tick');
    if (probe && typeof probe.capturing === 'boolean') {
      console.log('[mob-stall] admin ops.perf token provisioned: perf captures enabled');
    } else {
      adminToken = null;
      console.log(
        '[mob-stall] admin perf route not reachable with the provisioned token: ' +
          'falling back to heartbeat-only capture',
      );
    }

    const records = await seedBots(pool);
    for (const r of records) accountIds.push(r.accountId);
    console.log(`[mob-stall] seeded ${records.length} bot(s); connecting...`);
    bots = await connectAll(records);
    console.log(`[mob-stall] connected ${bots.filter((b) => b.connected).length}/${bots.length}`);

    botTimer = setInterval(() => {
      for (const bot of bots) bot.step();
    }, STEP_MS);

    botMode = 'stage';
    console.log(`[mob-stall] staging: level=${BOT_LEVEL} spot=(${CFG.spot.x}, ${CFG.spot.z})`);
    await sleep(STAGE_MS);

    const before = heartbeats.length;
    if (CFG.tap) {
      console.log('[mob-stall] tap window: every bot lands a hit on each co-located mob');
      botMode = 'tap';
    } else {
      console.log('[mob-stall] hold window: crowd parked, mobs run their idle proximity scan');
      botMode = 'hold';
    }
    await sleep(OBSERVE_MS);
    const staging = evaluateStaging(heartbeats.slice(before));
    console.log(`[mob-stall] STAGING ${staging.ok ? 'OK' : 'FAILED'}: ${staging.detail}`);

    if (!staging.ok) {
      printSummary(staging);
      await teardown();
      process.exit(1);
    }

    botMode = 'hold'; // stop dealing damage so the mobs survive the window
    await measurementWindow(MEASURE_MS);
    printSummary(staging);
    await teardown();
    process.exit(0);
  } catch (err) {
    console.error(`[mob-stall] failed: ${err.message}`);
    await teardown();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[mob-stall] fatal:', err);
  process.exit(1);
});
