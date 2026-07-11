// The Gauntlet, a time-limited survival event (see docs in types.ts
// GauntletDef). Data-as-code only: every numeric knob the gauntlet modules use
// lives HERE, never inline in module logic, so balancing is a one-file edit.
// Trials land one per release phase; `trials` below is the currently shipped
// sequence and grows as later trials are implemented.

import type { GauntletDef, GauntletTrialKind, NpcDef, PlayerClass } from '../types';

export const GAUNTLET_RECRUITER_NPC_ID = 'gauntlet_recruiter';
export const GAUNTLET_WATCHER_NPC_ID = 'gauntlet_watcher';
export const GAUNTLET_CONTESTANT_NPC_ID = 'gauntlet_contestant';

// Maro's RESERVED entity id. He now stands permanently in the Proving Grounds
// hub (see data.ts MINIGAME_HUB), not a dynamic event-time spawn, so he is
// spawned at world init OUTSIDE the nextId sequence with zero rng, exactly like
// HC_HERALD_ID, and the parity goldens never see him. Spawned by
// gauntlet/runs.ts spawnGauntletRecruiter; the event window still gates the
// join, only his presence no longer signals it.
export const GAUNTLET_RECRUITER_ID = 1_000_000_200;

// The contestant field wears real adventurer kits (the Hodric's Castle bot
// idiom): each NPC contestant rolls one of the nine classes and a skin, so
// the roster reads as a crowd of varied challengers rather than identical
// villagers. One dynamic NPC def per class (appended to GAUNTLET_NPCS below);
// the renderer maps each id to the matching class model.
export const GAUNTLET_CONTESTANT_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'mage',
  'warlock',
  'shaman',
  'druid',
];

export function gauntletContestantNpcId(cls: PlayerClass): string {
  return `${GAUNTLET_CONTESTANT_NPC_ID}_${cls}`;
}

// All three are `dynamic`: registered in NPCS (so the online client can resolve
// their defs) but never surface-placed by the world-init NPC loop. The recruiter
// is spawned at a reserved id in the Proving Grounds hub (spawnGauntletRecruiter),
// and the watcher/contestants per run inside the instance slot; the `pos` on the
// recruiter def below is vestigial (the hub anchor in data.ts is authoritative).
export const GAUNTLET_NPCS: Record<string, NpcDef> = {
  [GAUNTLET_RECRUITER_NPC_ID]: {
    id: GAUNTLET_RECRUITER_NPC_ID,
    name: 'Maro Half-Mask',
    // The nameplate subtitle is the game name (the Proving Grounds heralds show
    // the event they recruit for), not a personal role title.
    title: 'The Gauntlet',
    // Vestigial: the recruiter now stands at MINIGAME_HUB + MINIGAME_HUB_MARO.
    pos: { x: 14, z: 4 },
    facing: -Math.PI / 2,
    color: 0x9b59b6,
    questIds: [],
    dynamic: true,
    greeting:
      'Step onto the sand with the rest of them, $C. Outlast every trial and the podium is yours.',
  },
  [GAUNTLET_WATCHER_NPC_ID]: {
    id: GAUNTLET_WATCHER_NPC_ID,
    name: 'The Stone Warden',
    title: 'Keeper of the Crossing',
    // per-run spawn position is instance-local (see GAUNTLET_LAYOUT); this
    // surface pos is never used but the record shape requires one.
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0x8d99ae,
    questIds: [],
    dynamic: true,
    greeting: 'The Warden does not blink.',
  },
  [GAUNTLET_CONTESTANT_NPC_ID]: {
    id: GAUNTLET_CONTESTANT_NPC_ID,
    // per-entity display names are rolled from the name tables below; this
    // fallback only shows if a contestant spawns without one.
    name: 'Gauntlet Contestant',
    title: 'Contestant',
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0xc0796a,
    questIds: [],
    dynamic: true,
    greeting: 'Eyes forward. The Warden is watching.',
  },
};

// One class-kitted contestant def per class, sharing the base def's text (the
// nameplate shows each contestant's rolled proper-noun name, never this).
for (const cls of GAUNTLET_CONTESTANT_CLASSES) {
  GAUNTLET_NPCS[gauntletContestantNpcId(cls)] = {
    ...GAUNTLET_NPCS[GAUNTLET_CONTESTANT_NPC_ID],
    id: gauntletContestantNpcId(cls),
  };
}

// Contestant display names are `first + ' ' + last`, rolled from the per-run
// stream. Proper nouns: like player character names they are not translated.
export const GAUNTLET_CONTESTANT_FIRST_NAMES = [
  'Bram',
  'Odessa',
  'Finn',
  'Petra',
  'Cole',
  'Isolde',
  'Garrick',
  'Mabel',
  'Tobin',
  'Sable',
  'Edric',
  'Wren',
  'Halvar',
  'Nessa',
  'Orin',
  'Tilda',
  'Rufus',
  'Greta',
  'Silas',
  'Yara',
  'Dorn',
  'Elba',
  'Kestrel',
  'Pip',
] as const;

export const GAUNTLET_CONTESTANT_LAST_NAMES = [
  'Thistledown',
  'Marshlight',
  'Coppervein',
  'Bramblewood',
  'Ashgrove',
  'Fenwick',
  'Stonebrook',
  'Larkspur',
  'Duskwater',
  'Hollowell',
  'Pinch',
  'Gallowglass',
  'Reedmore',
  'Cinderfall',
  'Quickstep',
  'Mossbank',
  'Tatterhem',
  'Windrow',
  'Saltmarsh',
  'Underbough',
] as const;

// Instance-local layout anchors (yards, origin = gauntletOrigin(slot)). The
// sentinel field runs from the start line at z=0 to the finish line at
// z=sentinel.fieldLength; contestants gather south of the start line.
export const GAUNTLET_LAYOUT = {
  stagingZ: -10, // contestants line up here before a trial opens
  stagingHalfWidth: 14, // lateral spread of the staging line-up
  spectatorX: 26, // knocked-out players park here, beside the field
  spectatorZ: 40,
  watcherMargin: 6, // the watcher stands this far past the finish line
  // The podium ceremony (gauntlet/podium.ts): the three-step winners' stand
  // behind the staging plaza. `z` is the slab centre (instance-local), `baseH`
  // the base slab height, and each step's `x` its lateral offset with `h` its
  // box height, so the stand-on height above the venue floor is baseH + step.h.
  // The renderer builds the steps and venue_physics blocks the block from these
  // same numbers, so a champion stands exactly on the step you see.
  podium: {
    z: -20,
    baseH: 0.5,
    steps: [
      { x: 0, h: 1.5 }, // 1st: the gold centre step
      { x: -3.6, h: 1.0 }, // 2nd: silver
      { x: 3.6, h: 0.7 }, // 3rd: bronze
    ],
  },
} as const;

// The six trial arenas of the venue complex, one anchor per trials[] entry
// (instance-local yards). Trial 1 plays on the sentinel field itself; the
// other five are DRESSED but sealed until their trials ship (one per release
// phase), and each future trial's gameplay lands AT its anchor so the map
// and the mechanics never drift apart. The renderer builds the whole complex
// from these (src/render/gauntlet_venue.ts); keep every position here, never
// inline in render code.
export const GAUNTLET_VENUE = {
  // Trial 2, Sugarglass Sigils: a circular etching pavilion. The slab block is
  // one lectern (the trial's input surface): sized/tilted here so the venue
  // mesh, the world-aim interaction rect, and the trace input mapping share one
  // source of truth. The face tilts radially outward, toward the etcher who
  // mans it; the etching is a centered square of half-extent etchHalf on the
  // face, and the outline is inset by padFrac within it (gauntlet_trace_core
  // maps input through the same inset).
  sigils: {
    x: -62,
    z: 6,
    // The dais has to carry the whole ring plus the etchers who stand a
    // standoff outside it, clear of the pillars at radius + 1.6.
    radius: 13,
    // The lectern ring: EVERY contestant mans one of these stations during the
    // trial (see sigilStation below), players first and the NPC field behind
    // them. The viewer's own lectern is the live, etched one; the rest are
    // cosmetic. Venue geometry and sim placement share these numbers plus
    // sigilRingAngle below. The lectern on the dais centre is dressing.
    //
    // `count` MUST cover the whole field that can reach this trial (the
    // survivors of the crossing, targetSurvivorsPerTrial[0]), or the overflow
    // ranks up BEHIND a station and two contestants share one lectern. Pinned
    // in tests/gauntlet_sigils.test.ts. `radius` then follows from `count`: the
    // slabs are faceAcross wide, so packing more stations onto the old 6.5
    // circle made them touch. Grow them together, never one alone.
    ring: { count: 16, radius: 9 },
    slab: {
      faceAcross: 2.2, // face width, the etching's x axis (yards)
      faceSlope: 1.6, // face run up the tilt, the etching's y axis
      thick: 0.12,
      tiltRad: Math.PI / 6, // 30 deg toward the approach side (+x)
      centerY: 1.15, // slab center height (instance-local)
      etchHalf: 0.7, // interaction square half-extent on the face
      padFrac: 0.1, // outline inset within the square (was the 2D canvas frame pad)
    },
  },
  // Trial 3, The Great Pull: a flat rope lane with a central mud pit. Both
  // teams grip the rope single file (players take the grips nearest the pit,
  // NPC teammates fill in behind), and the WHOLE line slides with the rope as
  // the marker moves: sim placement and venue geometry share these numbers so
  // hands stay on the rope.
  pull: {
    x: -62,
    z: 52,
    length: 24, // rope length (the lane runs along x)
    width: 9, // lane dressing extent across the rope
    ropeY: 1.05, // hand height
    pitHalfX: 3, // the central pit the losing line is dragged toward
    pitHalfZ: 2.2,
    gripStart: 4.5, // first grip's distance from the rope center
    gripSpacing: 1.7, // spacing between grips along the rope
    knotTravel: 10, // rope translation at the win threshold (yards)
  },
  // Trial 4, the Keeper's Echo: a walled courtyard of rune-stone desks, one per
  // contestant (see echoStation). The footprint holds the whole 4x3 desk grid.
  echo: { x: -62, z: 104, size: 18 },
  // Trial 5, The Brittle Span: the twin-track glass crossing over a dark pit.
  // `length` tracks steps * panelLength (GAUNTLET.span): the crossing itself.
  span: { x: -105, z: 30, length: 56 },
  // Trial 6, The Final Court: the champions' ring, a circular melee arena. The
  // radius here is the DRESSED floor; the fighters are clamped a hair inside it
  // (GAUNTLET.court.arenaRadius), so the wall reads as a real boundary.
  court: { x: -105, z: 95, radius: 13 },
  // Grandstands flank the sentinel field on both sides.
  standX: 27, // inner edge of each grandstand (mirrored at -standX)
  standZMin: 14,
  standZMax: 76,
  // The colosseum shell: a low-poly elliptical stadium wall enclosing the
  // whole complex (yards, instance-local center + radii). The renderer builds
  // the tiered ring from these numbers and venue_physics derives one wall
  // collider per segment, so the shell is solid where it is visible. Radii
  // sized to clear every arena and stay inside the ground apron.
  colosseum: { x: -35, z: 45, rx: 118, rz: 108, segments: 30, wallDepth: 2.8 },
  // The venue ground apron: the flat dressed footprint around everything,
  // wide enough that every arena sits clear of its neighbors (playtest: the
  // packed first layout read as one overlapping jumble) and that the
  // colosseum shell ring fits inside it. Bounded by the gauntlet band
  // (x 13000..13800) and the 400yd slot pitch.
  groundHalfWidth: 160,
  groundZMin: -70,
  groundZMax: 165,
  // Camera focus poses for the desk-style trials, instance-local (the hud glue
  // adds the run origin and hands the pose to renderer.setCameraFocus).
  // Authored clear of geometry: over the open pavilion, above head height, so
  // holding the pose without camera collision is safe. Movement trials
  // (sentinel, span, court) keep the chase cam and have no pose here; the
  // pull also keeps the chase cam (locked third person on the rope, with the
  // screen-space circle overlay as its input).
  focus: {
    sigils: {
      // Close over the slab so the etched shape fills the view for tracing; the
      // character is hidden while this pose is held (see the renderer self-hide),
      // so nothing blocks it. Authored for a lectern at the dais centre; every
      // etcher's real pose is this one carried onto their own ring station by
      // sigilFocusPose, so only the standoff and the two heights matter.
      pos: { x: -59.6, y: 4.2, z: 6 },
      lookAt: { x: -62, y: 1.25, z: 6 },
    },
    // Over the echo table from behind the viewer's west mat: all four rune
    // stones in frame.
    echo: {
      pos: { x: -69.5, y: 4.6, z: 104 },
      lookAt: { x: -62, y: 1, z: 104 },
    },
  },
} as const;

// Where a knocked-out contestant parks to watch the rest of the run: beside
// the arena the named trial plays at. The sentinel keeps the original
// grandstand terrace; every later arena parks its fallen a few yards off its
// own anchor, because the terrace sits 130+ yards from the west arenas, past
// the ~90yd player interest radius, so a fallen player parked there would
// watch an empty field for the rest of the run. Instance-local yards; spots
// are authored clear of each arena's play surface and dressing.
export function gauntletSpectatorSpot(kind: GauntletTrialKind | undefined): {
  x: number;
  z: number;
} {
  const V = GAUNTLET_VENUE;
  switch (kind) {
    case 'sigils':
      return { x: V.sigils.x + V.sigils.radius + 4, z: V.sigils.z };
    case 'pull':
      return { x: V.pull.x, z: V.pull.z - V.pull.width / 2 - 5.5 };
    case 'echo':
      // the courtyard's open east side, outside the walls
      return { x: V.echo.x + V.echo.size / 2 + 3, z: V.echo.z };
    case 'span':
      return { x: V.span.x + 12, z: V.span.z };
    case 'court':
      // outside the torch ring and the flanking idols
      return { x: V.court.x + V.court.radius + 5, z: V.court.z };
    default:
      return { x: GAUNTLET_LAYOUT.spectatorX, z: GAUNTLET_LAYOUT.spectatorZ };
  }
}

// The i-th ring lectern's angle (the venue's sin/cos convention: position =
// anchor + (sin a, cos a) * radius). The ring spreads evenly around the dais
// but skips a wedge at a = PI/2 (+x), keeping the player's approach corridor
// to the interactive lectern clear. Pure and shared: the venue builds the
// lecterns and the sim seats the NPC etchers from the same angles.
export function sigilRingAngle(i: number, count: number): number {
  const gap = 0.9; // the approach wedge (radians)
  return Math.PI / 2 + gap / 2 + ((2 * Math.PI - gap) * (i + 0.5)) / count;
}

// How far outside their lectern an etcher stands, and how far the overflow
// ranks up behind the ring when the field outnumbers the stations.
export const SIGIL_ETCHER_STANDOFF = 1.6;
export const SIGIL_RANK_PITCH = 1.6;

/** Which lectern a run's first contestant claims. Rotating the whole ring by a
 * run-stable amount means a player is not handed the same station every game,
 * while staying a pure function of the seed (no rng draw, so a re-seat during
 * the interlude and at the trial's start agree). */
export function sigilRingOffset(seed: number): number {
  const n = GAUNTLET_VENUE.sigils.ring.count;
  return ((Math.trunc(seed) % n) + n) % n;
}

/**
 * The `seq`-th etching station of the pavilion ring (instance-local yards): a
 * lectern on the ring plus the spot its etcher stands on, one standoff further
 * out and facing the dais. Stations are handed out in sequence and rotated by
 * `offset`, so contestant `seq` never shares a lectern with contestant `seq+1`.
 *
 * The sim seats live players at stations 0..P-1 and the NPC field from P on
 * (trial_sigils.ts), and the venue anchors the viewer's live etching rig to the
 * lectern they are standing at (render/gauntlet_venue.ts), so a contestant and
 * their slab always share a spot. Only the NPC field ever overflows the ring
 * and ranks up behind it: maxRealPlayers (8) is under ring.count (12), so every
 * live player owns a lectern outright.
 */
export function sigilStation(
  seq: number,
  offset = 0,
): {
  slot: number; // ring station index
  angle: number; // its sigilRingAngle
  lecternX: number;
  lecternZ: number;
  lecternYaw: number; // slab yaw: the face tilts radially out, toward the etcher
  x: number; // where the etcher stands
  z: number;
  facing: number; // holding the dais in view
} {
  const { x, z, ring } = GAUNTLET_VENUE.sigils;
  const slot = (((offset + seq) % ring.count) + ring.count) % ring.count;
  const rank = Math.floor(seq / ring.count);
  const angle = sigilRingAngle(slot, ring.count);
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const standR = ring.radius + SIGIL_ETCHER_STANDOFF + rank * SIGIL_RANK_PITCH;
  const px = x + sin * standR;
  const pz = z + cos * standR;
  return {
    slot,
    angle,
    lecternX: x + sin * ring.radius,
    lecternZ: z + cos * ring.radius,
    lecternYaw: angle - Math.PI / 2,
    x: px,
    z: pz,
    facing: Math.atan2(x - px, z - pz),
  };
}

/** The ring station a contestant standing at (dx, dz) FROM the pavilion anchor
 * is manning: the lectern whose angle theirs is nearest. Both hosts derive the
 * viewer's station this way (the renderer for the live rig, the HUD for the
 * camera pose) rather than wiring the index. */
export function nearestSigilRingSlot(dx: number, dz: number): number {
  const { ring } = GAUNTLET_VENUE.sigils;
  const a = Math.atan2(dx, dz);
  let best = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.count; i++) {
    const d = sigilRingAngle(i, ring.count) - a;
    // atan2(sin, cos) folds the difference into (-PI, PI], so the gap is the
    // real angular distance and never wraps the long way round.
    const gap = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

/** The sigils trial's camera pose, carried onto the given ring station. The
 * authored `focus.sigils` pose is the one a lectern at the dais centre gets
 * (looking in from the +x approach); this rotates it around the ring so every
 * etcher sees their OWN slab filling the view. */
export function sigilFocusPose(slot: number): {
  pos: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
} {
  const { x, z, ring } = GAUNTLET_VENUE.sigils;
  const f = GAUNTLET_VENUE.focus.sigils;
  const dist = Math.hypot(f.pos.x - x, f.pos.z - z); // the authored standoff
  const a = sigilRingAngle(slot, ring.count);
  const lx = x + Math.sin(a) * ring.radius;
  const lz = z + Math.cos(a) * ring.radius;
  return {
    pos: { x: lx + Math.sin(a) * dist, y: f.pos.y, z: lz + Math.cos(a) * dist },
    lookAt: { x: lx, y: f.lookAt.y, z: lz },
  };
}

// The Keeper's Echo seats every contestant at their OWN rune-stone desk: a
// grid of ECHO_STATION_COLS x ECHO_STATION_ROWS stations centred on the echo
// courtyard anchor. echoStation is the single source both hosts read, so a
// contestant and their desk always share a spot: the sim seats contestant i at
// station i's mat (contestants.ts seatAllContestantsAt), and the venue builds a
// desk at every station + anchors the live rig to the viewer's own. The desks
// face +x; each contestant stands one ECHO_MAT_GAP west and looks east across
// the stones. Grid indexing is FIXED (never derived from the live count) so the
// centring never shifts as contestants fall.
export const ECHO_STATION_COLS = 4;
export const ECHO_STATION_ROWS = 3;
export const ECHO_STATIONS = ECHO_STATION_COLS * ECHO_STATION_ROWS;
export const ECHO_MAT_GAP = 3.2;
const ECHO_ROW_PITCH = 5; // desk-to-desk spacing along x (depth)
const ECHO_COL_PITCH = 3.8; // desk-to-desk spacing along z (lateral)

// Station i's desk root and the mat a contestant stands on, both instance-local
// (add run.origin). Columns run along z, rows recede along x; index wraps past
// the grid so an over-full field never throws (real runs reach the echo with at
// most maxRealPlayers + a culled NPC remnant, well inside the grid).
export function echoStation(i: number): {
  deskX: number;
  deskZ: number;
  matX: number;
  matZ: number;
  facing: number;
} {
  const { x, z } = GAUNTLET_VENUE.echo;
  const c = i % ECHO_STATION_COLS;
  const r = Math.floor(i / ECHO_STATION_COLS);
  const deskX = x + (r - (ECHO_STATION_ROWS - 1) / 2) * ECHO_ROW_PITCH;
  const deskZ = z + (c - (ECHO_STATION_COLS - 1) / 2) * ECHO_COL_PITCH;
  return { deskX, deskZ, matX: deskX - ECHO_MAT_GAP, matZ: deskZ, facing: Math.PI / 2 };
}

export const GAUNTLET: GauntletDef = {
  fieldSize: 30,
  vitalityMax: 100,
  lobbyFillS: 60,
  // A queue-formed lobby uses a short countdown so games roll back to back
  // ("when one ends the next starts"); the field backfills with NPCs at start.
  queueCountdownS: 12,
  maxRealPlayers: 8,
  joinRadius: 12,
  emptyTimeoutS: 30,
  stagingS: 8,
  interludeS: 10,
  // Nominal ceremony pacing for presentation only (the HUD countdown window
  // denominator). The podium phase itself has NO deadline: it holds until each
  // player leaves or rejoins, and an emptied run sweeps after emptyTimeoutS.
  podiumS: 20,
  // Prize pool is pure theater in v1 (no payout): the advertised baseline plus
  // growth per knockout, in copper, shown on the HUD counter.
  prizeBase: 10000,
  prizePerElimination: 2500,
  // NPC attrition schedule, one entry per trials[i]: after that trial the NPC
  // field is culled toward this many survivors (players are never culled by
  // targets; they live and die by their own vitality). The tail keeps ~4 into
  // the Final Court so the finale is a real melee, not a forced 1v1; the court
  // itself crowns exactly one (last fighter standing).
  targetSurvivorsPerTrial: [14, 8, 6, 5, 4, 1],
  npcSkillMin: 0.25,
  npcSkillMax: 0.95,
  trials: ['sentinel', 'sigils', 'pull', 'echo', 'span', 'court'],
  sentinel: {
    // Playtest verdict (three times): the clock must BITE. 35s on a 90yd field
    // leaves roughly 21s of green on an average draw against the ~13s of pure
    // running the crossing costs, so a clean run needs motion on every single
    // green and the shrinking windows really matter. Two catches (6yd back +
    // a 1.5s pin each) is about all the slack there is. Shortening this again
    // means re-checking the green machine below: the clock and greenMinS /
    // accelPerCycle together decide whether the crossing is winnable at all.
    durationS: 35,
    fieldLength: 90,
    fieldHalfWidth: 18,
    // The green side carries the CROSSING, and the shortened clock made its
    // cruellest draw unwinnable: at greenMinS 3.0 / accel 0.88, a run that drew
    // the minimum green and the maximum red every cycle banked only ~94yd of
    // running against a 90yd field, so a single catch's 6yd setback put the
    // finish line out of reach no matter how well you played after it. The
    // floor a flawless runner must always clear is "field + one catch", pinned
    // in tests/gauntlet.test.ts. Red stays exactly as brutal; the tolerance
    // belongs on the side you are allowed to move.
    greenMinS: 3.4,
    greenMaxS: 6.5,
    redMinS: 2.0,
    redMaxS: 4.0,
    // Late-game frenzy: from halfway down the clock the red draw range eases
    // toward [1.0, 3.0], so the final stretch flips fast (a red can be a bare
    // second) and reads far more random (the span doubles relative to the
    // mean). The quick cycles also advance flipCount faster, dragging the
    // green shrink below along in real time, so the endgame is short greens
    // against snap reds. Winnability is untouched: the cruellest draw is still
    // max-red-every-cycle, and CAPPING late reds at 3.0 hands that worst case
    // MORE banked green than the flat 4.0 machine did. The adversarial sweep
    // in tests/gauntlet.test.ts walks every min/max red policy through the
    // ramp and holds the field-plus-one-catch floor.
    frenzyStartFrac: 0.5,
    redMinLateS: 1.0,
    redMaxLateS: 3.0,
    // Green still shrinks every cycle (the trial accelerates), just gently
    // enough that the late windows stay worth sprinting through.
    accelPerCycle: 0.91,
    // The frenzy's quick late cycles can reach this inside the 35s clock (the
    // flat machine never did): it is the fairness guarantee that every green,
    // however deep the frenzy, stays long enough to sprint through.
    greenFloorS: 1.4,
    telegraphS: 0.8,
    // The grace pays for the braked slide the player cannot cancel (0.1s from
    // full run speed) BEFORE it pays for any reaction, so only what is left
    // over is a real window: 0.3s here, a trained player's ~0.25s visual
    // reaction plus a little network headroom. Read that number from
    // sentinelReactionBudgetS, never from this constant: raising graceS while
    // softening redMomentumDecay buys the player nothing.
    // Note this is the SAME 0.35 the trial first shipped with. It was inert
    // then: at the green coast's decay the slide alone outran it, so the window
    // was negative and even a perfect stop convicted. The brake is what turned
    // this number into forgiveness rather than decoration.
    // Anticipation still wins races (gauntletLight ships the exact `until` of
    // the window, so the flip is never a surprise), and red stays red: the
    // grace is under a fifth of the shortest red window. Both floors, plus the
    // "a perfect stop is never convicted" invariant, are pinned in
    // tests/gauntlet.test.ts.
    graceS: 0.35,
    redMoveEps: 0.06,
    hardFailDamage: 14,
    stunS: 1.5,
    pushbackYards: 6,
    momentumDecay: 0.82,
    // Once the light is red the contestant digs in, so the residual slide dies
    // four times faster: 2 ticks from full run speed instead of 9. The brake is
    // what buys the reaction window (the slide is charged to the grace first),
    // so soften it and the window shrinks tick for tick. It is not a mercy: the
    // free coast on green is what makes anticipating each flip worth anything.
    redMomentumDecay: 0.4,
    momentumStopEps: 0.02,
    // End-of-trial toll at score 0 = the full vitality pool, so failing to
    // cross (an idle player scores 0) is fatal from full health; any real
    // progress scales the toll down (crossing clears >= 1 and takes nothing).
    damageMax: 100,
    // The scripted survivors' invisible attrition tithe. Its own small knob,
    // NOT derived from damageMax: making player failure lethal must never shift
    // the NPC field's standings.
    npcTithe: 6,
    finishBonusMax: 0.25,
    npcSpeedMin: 5.2,
    npcSpeedMax: 7.2,
    npcSpeedJitter: 0.18,
    npcReactMinS: 0.15,
    npcReactMaxS: 0.75,
    npcStopLagMaxS: 0.3,
    npcHesitateChance: 0.3,
    npcHesitateMinS: 0.3,
    npcHesitateMaxS: 0.9,
    // Human feel: a gentle running weave, an overshoot past the line, and an
    // end-zone mill so the field reads as a crowd of people rather than a
    // conveyor belt that halts on the mark.
    npcWeaveAmp: 1.1,
    npcWeaveFreq: 2.4,
    npcOvershootMin: 2.5,
    npcOvershootMax: 7.0,
    npcMillAmp: 0.9,
  },
  sigils: {
    // Difficulty pass 4 (still read too soft): the trace is now a CONTINUOUS
    // trace, not order-free freedraw. Coverage only extends contiguously from the
    // stroke's live frontier (start anywhere, either direction), so you must walk
    // the whole loop in one connected pass; dabbing disconnected pieces carves
    // nothing. The accept band is tightened to 0.02 (hug the line), the off-band
    // crack rate is raised (straying fails fast), and the finish threshold is
    // near-total. The five shapes are flat SVGs (triangle, circle, star,
    // rectangle, hexagon); the roll picks any of them (trial_sigils startSigils).
    durationS: 80,
    outlinePoints: 96,
    tolerance: 0.02, // shape-local units (the outline lives in a unit square)
    // ~0.02 of the loop (about 2 of the 96 vertices) per on-band point: the carve
    // window that a single on-band point lights around its own arc position.
    carveArcFrac: 0.02,
    // The largest arc gap (fraction of the loop) a point may sit from the covered
    // frontier and still count as CONTINUING the trace (gap is filled in). A hit
    // further out than this is a jump across the shape and carves nothing, so
    // scattered dabs never stitch the loop together.
    contiguityArcFrac: 0.05,
    // Anti-teleport rate cap only: contiguity is the real gate now, so this sits
    // well above an honest continuous drag (~45 vertices/s) and just stops a
    // single fat batch from carving the whole (index-ordered) outline at once.
    coverageCapPerS: 45,
    crackMax: 100,
    crackOffPath: 30,
    thinSectionMult: 1.7,
    shatterDamage: 20,
    // Full-pool toll at zero coverage: never tracing the etching is fatal from
    // full health; the score curve scales it down with how much you carved.
    damageMax: 100,
    // The victory beat. Long enough to cover the HUD's ~4Hz repaint band plus
    // the 0.8s camera glide back off the slab, with a wide shot held on top.
    clearHoldS: 2.5,
  },
  pull: {
    // NO durationS: the pull has no clock (see GauntletPullTuning in types.ts).
    // It ends when the marker crosses the fraying threshold, and nothing else.
    leadInS: 2,
    // A good player's cycle is spawn gap + the shrink down to the target
    // (~0.6 of shrinkS); pullForceMax is sized so clean timing out-pulls the NPC
    // drift by a wide margin, and the ramp below is what shortens the cycle.
    circleSpawnMinS: 0.4,
    circleSpawnMaxS: 1.4,
    circleShrinkMinS: 1.3,
    circleShrinkMaxS: 2.8,
    // Playtest verdict: the old deadline-relative linear ramp barely bit (still
    // 0.85x twenty seconds in, and it only reached its 0.45 floor on a 75s clock
    // that no longer exists). The pace now HALVES every 12s from the opening
    // whistle and bottoms out at 0.32 (a 3.1x cadence) after ~20s, so the pull
    // is visibly tightening within the first few circles and is frantic long
    // before the fray starts. A clean puller crosses the threshold in ~9-15s.
    rampHalfLifeS: 12,
    circleRampMin: 0.32,
    circleStartSize: 200,
    circleTargetSize: 75,
    pullForceMax: 2.2,
    gradePower: 1.5,
    npcHeavePeriodS: 1.1,
    npcForceMin: 0.7,
    npcForceMax: 1.05,
    winThreshold: 12,
    // The fray. 26s of grace covers every honest win on a full rope (so a
    // full-contribution puller is never taxed by it), then the marks close over
    // 49s. Together they bound the trial at 75s, the same ceiling the old clock
    // had, except the ROPE decides it, no countdown is ever shown, and both
    // teams are brought equally close to winning instead of a clock awarding it.
    frayGraceS: 26,
    frayS: 49,
    // The end-of-pull toll at ZERO contribution = the full vitality pool. The
    // toll scales down with how hard a player pulled (their accumulated force
    // vs winThreshold, always the BASE threshold, never the frayed one), so an
    // idle contestant is knocked out even if their side won on the NPC drift,
    // while a hard puller who lost is only wounded.
    lossDamage: 100,
  },
  echo: {
    durationS: 100,
    stones: 4,
    rounds: 5,
    baseLen: 3, // sequences run 3..7 flashes across the five rounds
    stepS: 0.7,
    inputS: 10,
    missDamage: 10,
    // Full-pool toll at zero rounds cleared: never answering the stones is
    // fatal from full health (on top of the per-timeout missDamage); clearing
    // rounds scales it down.
    damageMax: 100,
    clearHoldS: 2.5, // the victory beat, matching the sigils
  },
  span: {
    durationS: 100,
    steps: 14,
    // Playtest: the 2.6yd panes read as stepping stones, not platforms. A
    // 4yd pane is a real floor tile you stand on and survey from; the venue
    // length (GAUNTLET_VENUE.span.length) tracks steps * panelLength.
    panelLength: 4,
    panelWidth: 4,
    panelGap: 1.4,
    fallDamage: 17,
    npcAheadCount: 3,
    // Playtest verdict: the crossers read as a conveyor belt. They bounded the
    // whole span at a flat 0.7s a panel, never paused, and (because every
    // unscripted guess was silently the right one) they looked like they had the
    // answer sheet. The hop is slower now, and the real fix is the ponder below:
    // a body that stops at the lip of an unproven pair, looks from one pane to
    // the other, and only then commits.
    npcHopS: 1,
    npcJumpHeight: 0.9,
    npcPlungeS: 0.7,
    npcPlungeDrop: 3.5,
    // Full-pool toll at zero progress: never stepping onto the span is fatal
    // from full health; each proven panel scales the toll down.
    damageMax: 100,
    // An unproven pair is a coin flip and it takes them a moment to make it; a
    // pair another body has already stood on is just a stride. The bounds are
    // lerped by the crosser's rolled nerve, so a brave one steps out in under a
    // second where a timid one agonizes for three.
    npcPonderMinS: 0.8,
    npcPonderMaxS: 2.6,
    npcStepPauseMinS: 0.12,
    npcStepPauseMaxS: 0.45,
    npcPeekAmp: 0.6, // ~34 degrees of head swing between the two panes
    npcPeekFreq: 1.3,
    // Two honest wrong guesses is all a scout has in it: after that it stops
    // gambling and walks the proven side. Expendable crossers need no cap (their
    // first wrong guess is fatal), so this only bounds how long the trial's
    // unkillable remnant can spend falling and climbing back.
    npcStumbleMax: 2,
  },
  court: {
    // A standard-combat brawl on a normalized hp pool: every fighter shares the
    // same maxHp, entering at the vitality fraction carried from the earlier
    // trials, and trades plain auto-attack swings (real `damage` events on real
    // hp, no class/gear/level in play). The pool is vitalityMax (100), so the hp
    // fraction the standings board + health frame show, and the damage floaties,
    // land on one 0..100 scale (matching every other trial). ~12 swings to drop
    // a full-health foe 1v1, faster under focus-fire; the 90s clock is a
    // comfortable ceiling.
    durationS: 90,
    arenaRadius: 11,
    maxHp: 100, // = vitalityMax: the shared hp pool every fighter is normalized to
    npcMoveSpeed: 7, // = RUN_SPEED: NPCs move exactly as fast as a player
    strikeDamage: 8, // authored auto-attack hit (bypasses armor, so it is equal for all)
    strikeIntervalS: 1.6, // seconds between swings
    strikeRange: 4, // melee reach (a touch under MELEE_RANGE)
    // NPC melee AI, all rolled from the per-run stream (skill-scaled 0..1):
    npcReactMinS: 0.15, // target-decision latency at skill 1
    npcReactMaxS: 0.75, // decision latency at skill 0
    npcRetargetS: 3, // how often an NPC re-picks its foe
  },
};
