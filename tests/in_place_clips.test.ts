// The three-side wiring of root-motion removal (src/render/characters/
// in_place_clips.ts): prepareInPlaceClips must find the root bone by name and
// rewrite its `<bone>.position` track on a CLONE, or the Sporemender Form
// keeps surging ahead of its pivot while every pure-core test stays green.
// Also pins that the shipped GLB exposes exactly the node and track names the
// runtime looks up (GLTFLoader sanitizes and uniquifies node names, and a
// renamed or duplicated Hip would make the lookup silently miss).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { prepareInPlaceClips } from '../src/render/characters/in_place_clips';
import { VISUALS } from '../src/render/characters/manifest';
import { cycleDrift } from '../src/render/characters/root_motion_core';

function drifting(name: string): THREE.AnimationClip {
  const times = [0, 0.5, 1];
  const values = [0, -0.1, 0.15, 0, -0.5, 0.16, 0, -0.9, 0.15];
  return new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack('Hip.position', times, values),
    new THREE.QuaternionKeyframeTrack('Hip.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
}

function sceneWithHip(): THREE.Object3D {
  const scene = new THREE.Group();
  const hip = new THREE.Bone();
  hip.name = 'Hip';
  hip.position.set(0, 0, 0.157);
  scene.add(hip);
  return scene;
}

describe('prepareInPlaceClips', () => {
  it('replaces each listed clip with an in-place clone and leaves the source intact', () => {
    const walk = drifting('Walk');
    const idle = drifting('Idle');
    const clips = new Map([
      ['Walk', walk],
      ['Idle', idle],
    ]);
    prepareInPlaceClips(clips, { bone: 'Hip', clips: ['Walk', 'Missing'] }, sceneWithHip());

    const fixed = clips.get('Walk');
    if (!fixed) throw new Error('Walk dropped');
    expect(fixed).not.toBe(walk);
    const track = fixed.tracks.find((t) => t.name === 'Hip.position');
    if (!track) throw new Error('no Hip track');
    for (const d of cycleDrift({ times: track.times, values: track.values })) {
      expect(Math.abs(d)).toBeLessThan(1e-6);
    }
    // The source clip (shared by the cached gltf) is untouched.
    expect(Array.from(walk.tracks[0].values)).toEqual(
      [0, -0.1, 0.15, 0, -0.5, 0.16, 0, -0.9, 0.15].map((v) => Math.fround(v)),
    );
    // Rotation tracks ride along unchanged; unlisted clips are not touched.
    expect(fixed.tracks[1].values).toEqual(walk.tracks[1].values);
    expect(clips.get('Idle')).toBe(idle);
  });

  it('is a no-op without a spec or when the bone is missing', () => {
    const walk = drifting('Walk');
    const clips = new Map([['Walk', walk]]);
    prepareInPlaceClips(clips, undefined, sceneWithHip());
    prepareInPlaceClips(clips, { bone: 'Pelvis', clips: ['Walk'] }, sceneWithHip());
    expect(clips.get('Walk')).toBe(walk);
  });
});

describe('Sporemender Form asset names', () => {
  it('exposes exactly one sanitized Hip node with a translation channel in every listed clip', async () => {
    const spec = VISUALS.form_sporemender.inPlaceClips;
    if (!spec) throw new Error('form_sporemender has no inPlaceClips');
    expect(THREE.PropertyBinding.sanitizeNodeName(spec.bone)).toBe(spec.bone);
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const root = (await io.read('public/models/creatures/sporemender_form.glb')).getRoot();
    const hips = root.listNodes().filter((node) => node.getName() === spec.bone);
    expect(hips).toHaveLength(1);
    for (const name of spec.clips) {
      const anim = root.listAnimations().find((a) => a.getName() === name);
      if (!anim) throw new Error(`no ${name} clip`);
      const channel = anim
        .listChannels()
        .find((c) => c.getTargetNode() === hips[0] && c.getTargetPath() === 'translation');
      expect(channel, `${name} Hip translation`).toBeDefined();
    }
  });
});
