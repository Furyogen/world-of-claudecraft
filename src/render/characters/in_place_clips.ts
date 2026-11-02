import type * as THREE from 'three';
import { type InPlaceClipSpec, inPlaceTranslation } from './root_motion_core';

/**
 * Replaces each named clip with an in-place copy: the root bone's position
 * track loses its baked forward travel (root_motion_core.ts) so the sim alone
 * moves the body. Runs once per visual key from prepareVisual, on CLONES, so
 * the cached gltf clips any other key resolves stay as authored. A clip or
 * bone the asset lacks is skipped: the manifest test pins that every listed
 * name resolves for the shipped asset.
 */
export function prepareInPlaceClips(
  clips: Map<string, THREE.AnimationClip>,
  spec: InPlaceClipSpec | undefined,
  scene: THREE.Object3D,
): void {
  if (!spec) return;
  const bone = scene.getObjectByName(spec.bone);
  if (!bone) return;
  const rest: [number, number, number] = [bone.position.x, bone.position.y, bone.position.z];
  const trackName = `${spec.bone}.position`;
  for (const name of spec.clips) {
    const clip = clips.get(name);
    if (!clip) continue;
    const index = clip.tracks.findIndex((track) => track.name === trackName);
    if (index < 0) continue;
    const copy = clip.clone();
    const track = copy.tracks[index];
    track.values = inPlaceTranslation({ times: track.times, values: track.values }, rest);
    clips.set(name, copy);
  }
}
