// Build the shared hunter bow-draw animation clip GLB.
//
// Every player class shares the KayKit `Rig_Medium` skeleton (23 joints,
// identical bone names), but the in-repo character GLBs were pruned to ~22
// clips and kept only one ranged clip (2H_Ranged_Shoot, the crossbow-style
// shoulder aim). A hunter with a Season 1 BOW skin needs a bow-flavored draw
// instead, so this script extracts the full pack's other ranged clips into a
// tiny, mesh-free clip-only GLB. The renderer attaches it to the hunter via
// `VisualDef.animUrls` (the clips bind to the rig's bones by name, exactly
// like the baked-in clips).
//
// Source (CC0 1.0, no attribution required, already credited in CREDITS.md):
//   KayKit Character Pack: Adventurers 1.0 - Kay Lousberg
//   https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
//   addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb (76 clips)
// Any Adventurers character works as the donor: the rig + clips are identical
// across them; only the (discarded) mesh differs.
//
//   node scripts/build_bow_anims.mjs <source-Adventurers-character.glb>
//
// Output: public/models/chars/players/bow_anims.glb

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// The ranged clips the shipped rigs dropped. Reload is the bow draw (the hand
// pulls back along the weapon line, reading as nocking + drawing the string);
// Aiming and Shooting ship too so the draw can be tuned without a rebuild.
const KEEP = new Set(['2H_Ranged_Aiming', '2H_Ranged_Reload', '2H_Ranged_Shooting']);

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error('usage: node scripts/build_bow_anims.mjs <source-Adventurers-character.glb>');
  process.exit(1);
}
const OUT = resolve(ROOT, 'public/models/chars/players/bow_anims.glb');

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(SOURCE);
const root = doc.getRoot();

const present = root.listAnimations().map((a) => a.getName());
const missing = [...KEEP].filter((n) => !present.includes(n));
if (missing.length) {
  console.error(`source is missing expected clips: ${missing.join(', ')}`);
  console.error(`source clips: ${present.join(', ')}`);
  process.exit(1);
}

// Drop every clip we are not keeping (channels + samplers explicitly: disposing
// only the animation orphans them, and prune() then keeps their accessors).
for (const anim of root.listAnimations()) {
  if (KEEP.has(anim.getName())) continue;
  for (const channel of anim.listChannels()) channel.dispose();
  for (const sampler of anim.listSamplers()) sampler.dispose();
  anim.dispose();
}
// Drop the skinned mesh + skins; the bone node hierarchy stays because the kept
// animation channels still target it (prune keeps animation-referenced nodes).
for (const mesh of root.listMeshes()) mesh.dispose();
for (const skin of root.listSkins()) skin.dispose();

await doc.transform(prune(), dedup());

await io.write(OUT, doc);

const kept = root.listAnimations().map((a) => a.getName());
const bones = root
  .listNodes()
  .map((n) => n.getName())
  .filter(Boolean);
console.log(`wrote ${OUT}`);
console.log(`clips (${kept.length}): ${kept.join(', ')}`);
console.log(`nodes kept: ${bones.length} (${bones.slice(0, 6).join(', ')}, ...)`);
