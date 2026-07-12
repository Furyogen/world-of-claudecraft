// Package the Tripo-generated hover attachments (scripts/asset_pipeline prop
// lane) into game-ready back-attachment GLBs under public/models/cosmetics/.
//
// Wings are split into two nodes named `wing.l` / `wing.r` so the renderer can
// FLAP them procedurally (src/render/characters/visual.ts rotates each half
// about the central hinge): every triangle goes to the side its centroid lies
// on, sharing the original vertex data (only the index buffers split, so the
// mesh, materials, and textures ship byte-identical). The jetpack is a single
// rigid `core` node (its motion is VFX, not geometry).
//
//   node scripts/build_hover_attachments.mjs \
//     tmp/asset_pipeline/prop_hover_butterfly_wings_<id>/hover_butterfly_wings.glb \
//     tmp/asset_pipeline/prop_hover_angel_wings_<id>/hover_angel_wings.glb \
//     tmp/asset_pipeline/prop_hover_jetpack_<id>/hover_jetpack.glb
//
// Output: public/models/cosmetics/<basename>.glb

import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'public/models/cosmetics');

const WING_MODELS = new Set(['hover_butterfly_wings', 'hover_angel_wings']);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const sources = process.argv.slice(2);
if (sources.length === 0) {
  console.error('usage: node scripts/build_hover_attachments.mjs <prop.glb> [...]');
  process.exit(1);
}

for (const source of sources) {
  const key = basename(source).replace(/\.glb$/, '');
  const doc = await io.read(source);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  if (WING_MODELS.has(key)) {
    // Split every primitive's triangles by centroid x into wing.l / wing.r.
    const buffer = root.listBuffers()[0];
    const leftMesh = doc.createMesh('wing.l');
    const rightMesh = doc.createMesh('wing.r');
    for (const mesh of root.listMeshes()) {
      if (mesh === leftMesh || mesh === rightMesh) continue;
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const indices = prim.getIndices();
        if (!pos || !indices) continue;
        const p = pos.getArray();
        const idx = indices.getArray();
        const left = [];
        const right = [];
        for (let i = 0; i + 2 < idx.length; i += 3) {
          const cx = (p[idx[i] * 3] + p[idx[i + 1] * 3] + p[idx[i + 2] * 3]) / 3;
          (cx < 0 ? left : right).push(idx[i], idx[i + 1], idx[i + 2]);
        }
        // gltf wing.l = the character's left (screen +x when facing +z is
        // model-dependent); the renderer only needs two mirrored halves.
        for (const [half, target] of [
          [left, leftMesh],
          [right, rightMesh],
        ]) {
          if (half.length === 0) continue;
          const acc = doc
            .createAccessor()
            .setArray(new Uint32Array(half))
            .setType('SCALAR')
            .setBuffer(buffer);
          const clone = prim.clone().setIndices(acc);
          target.addPrimitive(clone);
        }
      }
    }
    // Replace the scene graph: one parent with the two wing nodes at origin
    // (the hinge), preserving nothing else (the prop lane already centered
    // and scaled the model).
    for (const node of scene.listChildren()) node.dispose();
    for (const mesh of root.listMeshes()) {
      if (mesh !== leftMesh && mesh !== rightMesh) mesh.dispose();
    }
    const l = doc.createNode('wing.l').setMesh(leftMesh);
    const r = doc.createNode('wing.r').setMesh(rightMesh);
    scene.addChild(l).addChild(r);
  } else {
    // Rigid attachment: collapse to one named node so the renderer can find it.
    const holder = doc.createNode('core');
    for (const node of scene.listChildren()) {
      scene.removeChild(node);
      holder.addChild(node);
    }
    scene.addChild(holder);
  }

  await doc.transform(prune(), dedup());
  const out = resolve(OUT_DIR, `${key}.glb`);
  await io.write(out, doc);
  const nodes = root
    .listNodes()
    .map((n) => n.getName())
    .filter(Boolean);
  console.log(`wrote ${out} (nodes: ${nodes.join(', ')})`);
}
