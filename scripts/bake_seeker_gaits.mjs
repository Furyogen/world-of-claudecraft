// Author the two gait clips the Solana Seeker rig does not ship.
//
// The source model arrives with Idle, Walk and Jump, all hand-authored and worth
// keeping. MOUNT_RIGGED (src/render/characters/manifest.ts) additionally names
// `run` and `death`, and both are REQUIRED fields on ClipMap, so a mount cannot
// be registered without them. Rather than point them at Walk and Idle, which
// would read as a speeder that never accelerates and never fails, this derives
// both from the authored cycles:
//
//   Run   - the Walk cycle pitched nose-down into the airstream, with the
//           trail swept back harder. Same duration, because run/walk are
//           speed-matched by timeScale at runtime, not by clip length.
//   Death - power failure: the nose kicks up, the board stalls and drops, and
//           the trail and exhaust cloud collapse to nothing.
//
// This is the same division of labour as scripts/bake_mount_gaits.mjs, which
// authors gait cycles for the Tripo mounts whose retargets arrive near-static.
// The difference is that this rig's authored clips are good, so only the gaps
// are filled.
//
//   node scripts/bake_seeker_gaits.mjs --in <src.glb> --out <dst.glb>

import { createGlbIO, indexClip, poseValue, samplePose } from './anim/pose_blend.mjs';

const RATE = 30; // keys per second for the authored clips

// The board reads as one flexing plank from tail to nose; the trail is a chain
// of five bones behind it, and the cloud is the exhaust puff under the deck.
const BOARD = ['Board_Tail', 'Board_MidBack', 'Board_MidFront', 'Board_Nose'];
const TRAIL = ['Trail_1', 'Trail_2', 'Trail_3', 'Trail_4', 'Trail_5'];
const CLOUD = ['Cloud_Tail', 'Cloud_MidBack', 'Cloud_MidFront', 'Cloud_Nose'];

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};

/** Quaternion multiply, xyzw. */
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** Rotation of `angle` about a local axis, xyzw. */
const qAbout = (axis, angle) => {
  const h = angle / 2;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
};

// The craft points down +X (board bones run x -0.45 to +0.45, the trail
// trails off to -1.1), so PITCH is a rotation about Z: positive lifts the
// nose, negative drops it.
const Z = [0, 0, 1];

// The board, seat and trail all hang off `Hover` as SIBLINGS, not as a
// chain, so pitching the craft means rotating Hover once. Rotating each
// board bone instead tilts four separate planks about their own origins,
// which pulls the deck apart rather than banking it.
const CRAFT = 'Hover';

const io = createGlbIO();
const src = arg('--in', 'tmp/seeker_src.glb');
const dst = arg('--out', 'public/models/mounts/solana_seeker.glb');

const doc = await io.read(src);
const root = doc.getRoot();
const nodeByName = new Map(root.listNodes().map((n) => [n.getName(), n]));

const have = root.listAnimations().map((a) => a.getName());
for (const need of ['Idle', 'Walk']) {
  if (!have.includes(need)) throw new Error('source is missing the ' + need + ' clip');
}

const walkIdx = indexClip(root, 'Walk');
const idleIdx = indexClip(root, 'Idle');
const walkDur = Math.max(
  ...root
    .listAnimations()
    .find((a) => a.getName() === 'Walk')
    .listSamplers()
    .map((s) => s.getInput().getArray().at(-1)),
);

/** Every channel key the source clips drive, so a baked clip covers the rig. */
const allKeys = new Set([...walkIdx.keys(), ...idleIdx.keys()]);

/** Rest transform of a bone, used whenever a clip does not drive that channel. */
const restOf = (key) => {
  const [bone, path] = key.split('|');
  const node = nodeByName.get(bone);
  if (!node) return null;
  if (path === 'translation') return node.getTranslation();
  if (path === 'rotation') return node.getRotation();
  if (path === 'scale') return node.getScale();
  return null;
};
const REST = new Map([...allKeys].map((k) => [k, restOf(k)]));

/** Deck thickness, so drops and lifts are expressed in the rig's own scale
 *  rather than guessed. The board sits about 0.15 above the pivot and is a
 *  little over a unit long; a drop authored in whole units would bury it. */
const DECK_Y = 0.15;

/** Post-multiply a local rotation onto whatever the pose already holds. */
function addPitch(pose, bone, angle) {
  const key = bone + '|rotation';
  const cur = poseValue(pose, key, REST) ?? [0, 0, 0, 1];
  pose.set(key, qMul(cur, qAbout(Z, angle)));
}

function scaleBone(pose, bone, factor) {
  const key = bone + '|scale';
  const cur = poseValue(pose, key, REST) ?? [1, 1, 1];
  pose.set(key, [cur[0] * factor, cur[1] * factor, cur[2] * factor]);
}

function shiftY(pose, bone, dy) {
  const key = bone + '|translation';
  const cur = poseValue(pose, key, REST) ?? [0, 0, 0];
  pose.set(key, [cur[0], cur[1] + dy, cur[2]]);
}

// --- Run ---------------------------------------------------------------------
// Walk, leaned into the airstream: the whole craft noses down a few degrees
// and the trail lengthens. Duration is unchanged, because run and walk are
// speed-matched by timeScale at runtime, not by clip length.
function runPose(t) {
  const pose = new Map(samplePose(walkIdx, t * walkDur));
  addPitch(pose, CRAFT, -0.11);
  // A little extra flex on the nose alone, so the deck reads as loaded
  // rather than rigid. Small, because these are separate planks.
  addPitch(pose, 'Board_Nose', -0.05);
  addPitch(pose, 'Board_Tail', 0.04);
  TRAIL.forEach((bone, i) => scaleBone(pose, bone, 1.15 + 0.09 * i));
  for (const bone of CLOUD) scaleBone(pose, bone, 1.18);
  return pose;
}

// --- Death -------------------------------------------------------------------
// A stall, not a crash: thrust cuts, the nose kicks up as the tail loses lift,
// then the craft pitches forward and settles. The trail and exhaust collapse
// on the way down instead of snapping off.
const DEATH_SECONDS = 1.6;
function deathPose(t) {
  const pose = new Map(samplePose(idleIdx, t * DEATH_SECONDS));
  const kick = t < 0.28 ? t / 0.28 : 1;
  const fall = t < 0.28 ? 0 : (t - 0.28) / 0.72;
  addPitch(pose, CRAFT, 0.42 * kick - 0.72 * fall * fall);
  const collapse = Math.max(0.001, 1 - Math.min(1, t * 1.6) ** 1.5);
  for (const bone of TRAIL) scaleBone(pose, bone, collapse);
  for (const bone of CLOUD) scaleBone(pose, bone, collapse);
  // Sink by rather more than the deck thickness, so it reads as grounded,
  // and ease out so it settles rather than slamming.
  const drop = 1.35 * DECK_Y * (1 - (1 - Math.min(1, t / 0.95)) ** 3);
  shiftY(pose, 'Root', -drop);
  return pose;
}
// --- bake --------------------------------------------------------------------
// bakeClip is not used here: it writes a NEW document of clips, while this needs
// two extra animations added to the existing rig alongside its authored ones.
function bake(name, seconds, poseAt) {
  const frames = Math.max(2, Math.round(seconds * RATE));
  const times = [];
  for (let i = 0; i <= frames; i++) times.push((i / frames) * seconds);
  const input = doc
    .createAccessor(name + '_time')
    .setArray(new Float32Array(times))
    .setType('SCALAR');

  const anim = doc.createAnimation(name);
  const byBone = new Map();
  for (const key of allKeys) {
    const [bone, path] = key.split('|');
    if (!nodeByName.has(bone)) continue;
    if (!byBone.has(bone)) byBone.set(bone, new Set());
    byBone.get(bone).add(path);
  }
  const poses = times.map((t) => poseAt(t / seconds));
  for (const [bone, paths] of byBone) {
    for (const path of paths) {
      const key = bone + '|' + path;
      const size = path === 'rotation' ? 4 : 3;
      const out = new Float32Array(poses.length * size);
      for (let i = 0; i < poses.length; i++) {
        const v = poseValue(poses[i], key, REST);
        if (!v) throw new Error('no value for ' + key + ' at frame ' + i);
        for (let c = 0; c < size; c++) out[i * size + c] = v[c];
      }
      const output = doc
        .createAccessor(name + '_' + bone + '_' + path)
        .setArray(out)
        .setType(path === 'rotation' ? 'VEC4' : 'VEC3');
      const sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setOutput(output)
        .setInterpolation('LINEAR');
      anim.addSampler(sampler);
      anim.addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(nodeByName.get(bone))
          .setTargetPath(path)
          .setSampler(sampler),
      );
    }
  }
  console.log(
    name +
      ': ' +
      seconds.toFixed(2) +
      's, ' +
      (frames + 1) +
      ' keys, ' +
      anim.listChannels().length +
      ' channels',
  );
}

for (const existing of root.listAnimations()) {
  if (existing.getName() === 'Run' || existing.getName() === 'Death') existing.dispose();
}
bake('Run', walkDur, runPose);
bake('Death', DEATH_SECONDS, deathPose);

await io.write(dst, doc);
console.log('wrote ' + dst);
console.log(
  'clips: ' +
    root
      .listAnimations()
      .map((a) => a.getName())
      .join(', '),
);
