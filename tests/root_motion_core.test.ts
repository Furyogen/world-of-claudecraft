// Root-motion removal (src/render/characters/root_motion_core.ts) and the
// Sporemender Form rig it was written for: the shipped Walk and Run clips bake
// forward travel into the Hip, which made the form surge ahead of its own
// position and snap back every loop. Pins the pure math on synthetic tracks,
// then the shipped asset: the in-place copies no longer travel, the manifest
// refs match the travel the clips actually encode, and the run cadence at the
// form's 80% pace is 80% of the full-speed cadence instead of clamping.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { locomotionTimeScale } from '../src/render/characters/anim_state';
import { VISUALS } from '../src/render/characters/manifest';
import {
  cycleDrift,
  cycleTravel,
  inPlaceTranslation,
} from '../src/render/characters/root_motion_core';
import { LOPING_STRIDE_SPEED } from '../src/sim/combat/druid_engines';
import { SPOREMENDER_MOVE_SPEED_MULT } from '../src/sim/combat/druid_sporemender';
import { RUN_SPEED } from '../src/sim/types';

function syntheticTrack(n: number, span: number, drift: [number, number, number]) {
  const times = new Float32Array(n);
  const values = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const t = (span * i) / (n - 1);
    times[i] = t;
    const phase = (2 * Math.PI * i) / (n - 1);
    values[3 * i] = 0.02 * Math.sin(phase) + (drift[0] * t) / span;
    values[3 * i + 1] = -0.2 + 0.05 * Math.sin(2 * phase) + (drift[1] * t) / span;
    values[3 * i + 2] = 0.15 + 0.01 * Math.cos(2 * phase) + (drift[2] * t) / span;
  }
  return { times, values };
}

describe('root_motion_core', () => {
  it('measures the per-cycle drift and the travel speed', () => {
    const track = syntheticTrack(41, 2, [0, -0.8, 0]);
    const drift = cycleDrift(track);
    expect(drift[0]).toBeCloseTo(0, 6);
    expect(drift[1]).toBeCloseTo(-0.8, 6);
    expect(drift[2]).toBeCloseTo(0, 6);
    expect(cycleTravel(track)).toBeCloseTo(0.4, 6);
  });

  it('removes the drift and recentres only the drifting component on rest', () => {
    const track = syntheticTrack(41, 2, [0, -0.8, 0]);
    const before = Float32Array.from(track.values);
    const out = inPlaceTranslation(track, [0, 0, 0.15]);
    // Input untouched.
    expect(Array.from(track.values)).toEqual(Array.from(before));
    // No travel left: the loop seam closes on every component.
    const n = track.times.length;
    expect(cycleDrift({ times: track.times, values: out }).map(Math.abs)).toEqual([
      expect.closeTo(0, 5),
      expect.closeTo(0, 5),
      expect.closeTo(0, 5),
    ]);
    // The drifting axis now oscillates around the rest value, keeping its
    // authored sway.
    let meanY = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      meanY += out[3 * i + 1] / n;
      minY = Math.min(minY, out[3 * i + 1]);
      maxY = Math.max(maxY, out[3 * i + 1]);
    }
    expect(meanY).toBeCloseTo(0, 5);
    expect(maxY - minY).toBeCloseTo(0.1, 2);
    // Non-drifting axes keep their authored values (the vertical bob included).
    for (let i = 0; i < n; i++) {
      expect(out[3 * i]).toBeCloseTo(before[3 * i], 5);
      expect(out[3 * i + 2]).toBeCloseTo(before[3 * i + 2], 5);
    }
  });

  it('copies a degenerate track unchanged', () => {
    const single = { times: [0], values: [1, 2, 3] };
    expect(Array.from(inPlaceTranslation(single, [0, 0, 0]))).toEqual([1, 2, 3]);
  });
});

interface HipClip {
  times: Float32Array;
  values: Float32Array;
}

async function readSporemender(): Promise<{
  clips: Map<string, HipClip>;
  rest: [number, number, number];
  height: number;
}> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read('public/models/creatures/sporemender_form.glb');
  const root = doc.getRoot();
  const hip = root.listNodes().find((node) => node.getName() === 'Hip');
  if (!hip) throw new Error('no Hip bone');
  const clips = new Map<string, HipClip>();
  for (const anim of root.listAnimations()) {
    for (const channel of anim.listChannels()) {
      if (channel.getTargetNode() !== hip || channel.getTargetPath() !== 'translation') continue;
      const sampler = channel.getSampler();
      if (!sampler) continue;
      expect(sampler.getInterpolation()).toBe('LINEAR');
      clips.set(anim.getName(), {
        times: Float32Array.from(sampler.getInput()?.getArray() ?? []),
        values: Float32Array.from(sampler.getOutput()?.getArray() ?? []),
      });
    }
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      minY = Math.min(minY, pos.getMin([])[1]);
      maxY = Math.max(maxY, pos.getMax([])[1]);
    }
  }
  const t = hip.getTranslation();
  return { clips, rest: [t[0], t[1], t[2]], height: maxY - minY };
}

describe('Sporemender Form locomotion clips', () => {
  const def = VISUALS.form_sporemender;

  it('plays Walk and Run in place off the Hip bone', async () => {
    expect(def.inPlaceClips).toEqual({ bone: 'Hip', clips: ['Walk', 'Run'] });
    const { clips, rest } = await readSporemender();
    for (const name of ['Walk', 'Run']) {
      const clip = clips.get(name);
      if (!clip) throw new Error(`no ${name} Hip track`);
      // The authored clip travels a visible distance per cycle...
      const authored = cycleDrift(clip).map(Math.abs);
      expect(Math.max(...authored)).toBeGreaterThan(0.4);
      // ...and the in-place copy travels none, centred on the rest pose.
      const fixed = inPlaceTranslation(clip, rest);
      for (const d of cycleDrift({ times: clip.times, values: fixed })) {
        expect(Math.abs(d)).toBeLessThan(1e-4);
      }
      for (let i = 0; i < clip.times.length; i++) {
        expect(Math.abs(fixed[3 * i + 1] - rest[1])).toBeLessThan(0.1);
      }
    }
  });

  it('times the cycles against the travel the clips encode', async () => {
    const { clips, height } = await readSporemender();
    const yardsPerUnit = def.height / height;
    const run = clips.get('Run');
    const walk = clips.get('Walk');
    if (!run || !walk) throw new Error('missing locomotion clips');
    expect(def.runRef).toBeCloseTo(cycleTravel(run) * yardsPerUnit, 1);
    expect(def.walkRef).toBeCloseTo(cycleTravel(walk) * yardsPerUnit, 1);
  });

  it('runs the cycle at 80% cadence at the 80% form pace', () => {
    const cadence = (speed: number) =>
      locomotionTimeScale(
        'run',
        { speed, backwards: false, reverseBackpedal: false },
        def.walkRef,
        def.runRef,
        def.prowlRef,
        def.walkBackRef,
        def.runTimeScaleMin,
        def.walkTimeScaleMax,
        def.runTimeScaleMax,
      ) ?? 0;
    const full = cadence(RUN_SPEED);
    const form = cadence(RUN_SPEED * SPOREMENDER_MOVE_SPEED_MULT);
    expect(form / full).toBeCloseTo(SPOREMENDER_MOVE_SPEED_MULT, 5);
    // Neither speed is clamped: the feet keep matching the ground.
    expect(form).toBeCloseTo((RUN_SPEED * SPOREMENDER_MOVE_SPEED_MULT) / (def.runRef ?? 1), 5);
    // A Loping Stride burst on top of the form pace still fits under the ceiling.
    expect(
      (RUN_SPEED * SPOREMENDER_MOVE_SPEED_MULT * LOPING_STRIDE_SPEED) / (def.runRef ?? 1),
    ).toBeLessThan(def.runTimeScaleMax ?? 0);
  });
});
