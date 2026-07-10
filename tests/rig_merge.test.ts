// Skinned-rig part merging: the merge is only sound if a rebaked vertex skins to
// the exact same world position it did against its own bind data. These tests pin
// that equivalence, and pin that parts we cannot prove safe are left unmerged.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  mergeSkinnedParts,
  rebakeGeometry,
  rebakeMatrix,
  solveRebindTransform,
} from '../src/render/characters/rig_merge';

/** three's skinning, evaluated on the CPU: out = bindInv * SUM w_i (B_i * I_i) * bind * p */
function skinVertex(mesh: THREE.SkinnedMesh, index: number, bones: THREE.Bone[]): THREE.Vector3 {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const inverses = mesh.skeleton.boneInverses;

  const skinVertexPos = new THREE.Vector4(
    pos.getX(index),
    pos.getY(index),
    pos.getZ(index),
    1,
  ).applyMatrix4(mesh.bindMatrix);

  const acc = new THREE.Vector4(0, 0, 0, 0);
  const boneMatrix = new THREE.Matrix4();
  for (let c = 0; c < 4; c++) {
    const w = sw.getComponent(index, c);
    if (w === 0) continue;
    const b = si.getComponent(index, c);
    boneMatrix.multiplyMatrices(bones[b].matrixWorld, inverses[b]);
    const t = skinVertexPos.clone().applyMatrix4(boneMatrix).multiplyScalar(w);
    acc.add(t);
  }
  const out = acc.applyMatrix4(mesh.bindMatrixInverse);
  return new THREE.Vector3(out.x, out.y, out.z);
}

/** Two bones in a small hierarchy, posed away from rest so skinning is non-trivial. */
function makeBones(): THREE.Bone[] {
  const root = new THREE.Bone();
  const child = new THREE.Bone();
  root.add(child);
  child.position.set(0, 1, 0);
  root.position.set(0.3, 0.1, -0.2);
  root.rotation.set(0.2, 0.4, -0.1);
  child.rotation.set(-0.3, 0.15, 0.25);
  root.updateMatrixWorld(true);
  return [root, child];
}

function restInverses(bones: THREE.Bone[]): THREE.Matrix4[] {
  return bones.map((b) => new THREE.Matrix4().copy(b.matrixWorld).invert());
}

/** A one-triangle skinned part bound with `inverses`. */
function makePart(
  bones: THREE.Bone[],
  inverses: THREE.Matrix4[],
  positions: number[],
  material = new THREE.MeshBasicMaterial(),
): THREE.SkinnedMesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geo.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], 4),
  );
  geo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([0.7, 0.3, 0, 0, 0.4, 0.6, 0, 0, 0.5, 0.5, 0, 0], 4),
  );
  geo.setIndex([0, 1, 2]);
  const mesh = new THREE.SkinnedMesh(geo, material);
  const skeleton = new THREE.Skeleton(bones, inverses);
  mesh.bind(skeleton, new THREE.Matrix4());
  return mesh;
}

describe('solveRebindTransform', () => {
  it('recovers the single transform relating two bind-data sets', () => {
    const bones = makeBones();
    const canon = restInverses(bones);
    const t = new THREE.Matrix4().makeScale(0.46, 0.46, 0.46).setPosition(0.05, -0.2, 0.11);
    const part = canon.map((m) => new THREE.Matrix4().copy(m).multiply(t));

    const solved = solveRebindTransform(canon, part);
    expect(solved).not.toBeNull();
    for (let i = 0; i < 16; i++) expect(solved!.elements[i]).toBeCloseTo(t.elements[i], 6);
  });

  it('returns the identity when both parts share bind data', () => {
    const bones = makeBones();
    const canon = restInverses(bones);
    const solved = solveRebindTransform(canon, restInverses(bones));
    expect(solved).not.toBeNull();
    for (let i = 0; i < 16; i++)
      expect(solved!.elements[i]).toBeCloseTo(new THREE.Matrix4().elements[i], 6);
  });

  it('rejects bind data that no single transform explains', () => {
    const bones = makeBones();
    const canon = restInverses(bones);
    // bone 0 scaled, bone 1 translated: no single T satisfies both
    const part = [
      new THREE.Matrix4().copy(canon[0]).multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5)),
      new THREE.Matrix4().copy(canon[1]).multiply(new THREE.Matrix4().makeTranslation(1, 2, 3)),
    ];
    expect(solveRebindTransform(canon, part)).toBeNull();
  });

  it('rejects mismatched bone counts and empty bind data', () => {
    const bones = makeBones();
    const canon = restInverses(bones);
    expect(solveRebindTransform(canon, [canon[0]])).toBeNull();
    expect(solveRebindTransform([], [])).toBeNull();
  });
});

describe('rebakeGeometry', () => {
  it('makes a part skin identically against the canonical skeleton', () => {
    const bones = makeBones();
    const canonInverses = restInverses(bones);
    // the part carries its own quantization-baked bind data
    const t = new THREE.Matrix4().makeScale(0.46, 0.31, 0.6).setPosition(0.05, -0.2, 0.11);
    const partInverses = canonInverses.map((m) => new THREE.Matrix4().copy(m).multiply(t));

    const positions = [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7];
    const part = makePart(bones, partInverses, positions);
    const canon = makePart(bones, canonInverses, positions);

    const solved = solveRebindTransform(canonInverses, partInverses);
    expect(solved).not.toBeNull();
    const m = rebakeMatrix(canon.bindMatrix, part.bindMatrix, solved!);

    // rebaked geometry, bound to the CANONICAL skeleton
    const rebaked = new THREE.SkinnedMesh(
      rebakeGeometry(part.geometry, m),
      part.material as THREE.Material,
    );
    rebaked.bind(new THREE.Skeleton(bones, canonInverses), canon.bindMatrix);

    for (let i = 0; i < 3; i++) {
      const before = skinVertex(part, i, bones);
      const after = skinVertex(rebaked, i, bones);
      expect(after.x).toBeCloseTo(before.x, 5);
      expect(after.y).toBeCloseTo(before.y, 5);
      expect(after.z).toBeCloseTo(before.z, 5);
    }
  });

  it('dequantizes normalized integer sources and keeps bone indices integral', () => {
    const bones = makeBones();
    const inverses = restInverses(bones);
    const part = makePart(bones, inverses, [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7]);
    // a quantized uv, exactly as the GLB pipeline emits it
    part.geometry.setAttribute(
      'uv',
      new THREE.Uint16BufferAttribute(new Uint16Array([0, 0, 65535, 0, 0, 65535]), 2, true),
    );

    const out = rebakeGeometry(part.geometry, new THREE.Matrix4());
    const uv = out.attributes.uv;
    expect(uv.array).toBeInstanceOf(Float32Array);
    expect(uv.getX(1)).toBeCloseTo(1, 4);
    expect(out.attributes.skinIndex.array).toBeInstanceOf(Uint16Array);
    expect(out.attributes.skinIndex.getY(0)).toBe(1);
  });
});

describe('mergeSkinnedParts', () => {
  function rig(partInverseFactory: (canon: THREE.Matrix4[], i: number) => THREE.Matrix4[]) {
    const bones = makeBones();
    const canonInverses = restInverses(bones);
    const root = new THREE.Object3D();
    root.add(bones[0]);
    const material = new THREE.MeshBasicMaterial();
    const parts = [0, 1, 2].map((i) =>
      makePart(
        bones,
        partInverseFactory(canonInverses, i),
        [0.2, 0.6, -0.1 * i, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7],
        material,
      ),
    );
    for (const p of parts) root.add(p);
    return { root, bones, parts };
  }

  const countSkinned = (root: THREE.Object3D) => {
    let n = 0;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) n++;
    });
    return n;
  };

  it('collapses per-primitive bind data into one mesh, one skeleton', () => {
    const { root } = rig((canon, i) => {
      const t = new THREE.Matrix4().makeScale(0.4 + i * 0.1, 0.4 + i * 0.1, 0.4 + i * 0.1);
      return canon.map((m) => new THREE.Matrix4().copy(m).multiply(t));
    });
    expect(countSkinned(root)).toBe(3);

    mergeSkinnedParts(root);

    expect(countSkinned(root)).toBe(1);
    const skeletons = new Set<THREE.Skeleton>();
    let merged: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) {
        skeletons.add(sm.skeleton);
        merged = sm;
      }
    });
    expect(skeletons.size).toBe(1);
    expect(merged!.name).toMatch(/_bodymerged$/);
    // three triangles of three vertices folded into one buffer
    expect(merged!.geometry.attributes.position.count).toBe(9);
    expect(merged!.geometry.index!.count).toBe(9);
  });

  it('preserves the skinned pose of every merged vertex', () => {
    const { root, bones, parts } = rig((canon, i) => {
      const t = new THREE.Matrix4().makeScale(0.4 + i * 0.1, 0.5, 0.6).setPosition(i * 0.1, 0, 0);
      return canon.map((m) => new THREE.Matrix4().copy(m).multiply(t));
    });
    const before = parts.flatMap((p) => [0, 1, 2].map((i) => skinVertex(p, i, bones)));

    mergeSkinnedParts(root);

    let merged: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) merged = o as THREE.SkinnedMesh;
    });
    for (let i = 0; i < before.length; i++) {
      const after = skinVertex(merged!, i, bones);
      expect(after.x).toBeCloseTo(before[i].x, 4);
      expect(after.y).toBeCloseTo(before[i].y, 4);
      expect(after.z).toBeCloseTo(before[i].z, 4);
    }
  });

  it('leaves parts whose bind data no single transform explains unmerged', () => {
    const { root } = rig((canon, i) =>
      i === 2
        ? // bone 0 and bone 1 pulled apart independently: unmergeable
          [
            new THREE.Matrix4()
              .copy(canon[0])
              .multiply(new THREE.Matrix4().makeScale(0.5, 0.5, 0.5)),
            new THREE.Matrix4()
              .copy(canon[1])
              .multiply(new THREE.Matrix4().makeTranslation(1, 2, 3)),
          ]
        : canon.map((m) => m.clone()),
    );

    mergeSkinnedParts(root);

    // the two safe parts merge; the third survives on its own
    expect(countSkinned(root)).toBe(2);
  });

  it('never merges across different materials', () => {
    const bones = makeBones();
    const canonInverses = restInverses(bones);
    const root = new THREE.Object3D();
    root.add(bones[0]);
    const pos = [0.2, 0.6, -0.1, -0.4, 0.9, 0.3, 0.5, -0.2, 0.7];
    root.add(makePart(bones, canonInverses, pos, new THREE.MeshBasicMaterial()));
    root.add(makePart(bones, canonInverses, pos, new THREE.MeshBasicMaterial()));

    mergeSkinnedParts(root);

    expect(countSkinned(root)).toBe(2);
  });

  it('skips hidden parts, leaving them addressable', () => {
    const { root, parts } = rig((canon) => canon.map((m) => m.clone()));
    parts[2].visible = false;

    mergeSkinnedParts(root);

    expect(countSkinned(root)).toBe(2); // one merged body + the hidden part
    expect(parts[2].parent).toBe(root);
  });
});
