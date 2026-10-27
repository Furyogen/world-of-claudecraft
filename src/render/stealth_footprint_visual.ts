// Stealth Rework footprints: the ground prints an enemy stealther leaves, read
// from IWorld.stealthFootprints (already filtered to what this player may see:
// enemies only, at least 2 sec old, within the read radius). One instanced
// oval per fade bucket, every material built at construction and the whole
// root attached through the compile gate, so nothing links in a live frame.
// Identical on every graphics tier: the prints are actionable information.
// Placement math lives in stealth_footprint_core.ts.

import * as THREE from 'three';
import { FOOTPRINT_VIEW_CAP } from '../sim/stealth_footprints';
import type { VisibleFootprint } from '../world_api';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';
import {
  FOOTPRINT_FADE_BUCKETS,
  FOOTPRINT_FADE_OPACITY,
  FOOTPRINT_HALF_LENGTH,
  FOOTPRINT_HALF_WIDTH,
  footprintPlacementInto,
  newFootprintPlacement,
} from './stealth_footprint_core';

/** A dark, cool umber that reads on grass, sand and stone alike. */
const FOOTPRINT_COLOR = 0x241a26;
/** Lift above the surface so the oval never z-fights it. */
const FOOTPRINT_LIFT = 0.05;
/** The prints are information a player acts on, so they sit near the top of
 *  the player band: over the world's own marks and every class ground effect,
 *  under the click/AoE feedback rung and every encounter telegraph
 *  (docs/design/vfx-floor-layering.md). */
export const FOOTPRINT_RENDER_ORDER = floorVfxRenderOrder('player', 8);
const NO_PRINTS: readonly VisibleFootprint[] = Object.freeze([]);

export class StealthFootprintVisual {
  readonly group = new THREE.Group();
  readonly readyForEntry: Promise<void>;
  private readonly geometry = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly counts = new Array<number>(FOOTPRINT_FADE_BUCKETS).fill(0);
  private readonly place = newFootprintPlacement();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(FOOTPRINT_HALF_WIDTH, 1, FOOTPRINT_HALF_LENGTH);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private last: readonly VisibleFootprint[] | null = null;
  private disposed = false;

  constructor(
    scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.group.name = 'stealth-footprints';
    for (let bucket = 0; bucket < FOOTPRINT_FADE_BUCKETS; bucket++) {
      const material = new THREE.MeshBasicMaterial({
        color: FOOTPRINT_COLOR,
        transparent: true,
        opacity: FOOTPRINT_FADE_OPACITY[bucket],
        depthWrite: false,
      });
      // Named so a live-program or shader-warm audit entry maps back here; the
      // four differ only in opacity (a uniform), so they share one program.
      material.name = `stealth-footprints:fade-${bucket}`;
      const mesh = new THREE.InstancedMesh(this.geometry, material, FOOTPRINT_VIEW_CAP);
      mesh.name = `stealth-footprints-${bucket}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = FOOTPRINT_RENDER_ORDER;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.readyForEntry = attachSceneGroupGated(
      scene,
      this.group,
      compileGate,
      () => this.disposed,
    ).catch(() => {});
  }

  update(prints: readonly VisibleFootprint[] = NO_PRINTS): void {
    // Each snapshot (or offline frame with a trail) hands over a new list; an
    // unchanged list is the common, free case. A world that never received a
    // snapshot (a bare test world) reads as none.
    if (this.disposed || prints === this.last) return;
    this.last = prints;
    this.counts.fill(0);
    for (const print of prints) {
      const place = footprintPlacementInto(this.place, print);
      const mesh = this.meshes[place.bucket];
      const index = this.counts[place.bucket]++;
      if (index >= FOOTPRINT_VIEW_CAP) continue;
      // The print's own height (a bridge, a deck), or the ground under the
      // offset foot if that is higher (a slope).
      const y = Math.max(print.y, this.groundAt(place.x, place.z)) + FOOTPRINT_LIFT;
      this.position.set(place.x, y, place.z);
      this.rotation.setFromAxisAngle(this.up, place.yaw);
      mesh.setMatrixAt(index, this.matrix.compose(this.position, this.rotation, this.scale));
    }
    for (let bucket = 0; bucket < FOOTPRINT_FADE_BUCKETS; bucket++) {
      const mesh = this.meshes[bucket];
      const count = Math.min(this.counts[bucket], FOOTPRINT_VIEW_CAP);
      if (count === 0 && mesh.count === 0) continue;
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      // three computes an instanced mesh's sphere once and keeps it; the
      // transparent sort reads it, so it must follow the prints.
      if (count > 0) mesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.geometry.dispose();
    for (const mesh of this.meshes) {
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
