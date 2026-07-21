// Build the shareable single-file Ability VFX Gallery:
//  - packs the 14 GLBs (7 player rigs + 7 weapons) into one zlib blob (base64)
//  - esbuild-bundles the gallery engine (+three, +decoder, +fflate) as ESM
//  - composes a self-contained HTML with everything inline (Artifact CSP-safe)
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = 'tmp/vfx';

const ASSETS = [
  'models/chars/players/knight.glb',
  'models/chars/players/paladin.glb',
  'models/chars/players/ranger.glb',
  'models/chars/players/rogue.glb',
  'models/chars/players/mage.glb',
  'models/chars/players/barbarian.glb',
  'models/chars/players/druid.glb',
  'models/weapons/sword_1handed.glb',
  'models/weapons/axe_1handed.glb',
  'models/weapons/crossbow_1handed.glb',
  'models/weapons/dagger.glb',
  'models/weapons/staff.glb',
  'models/weapons/wand.glb',
  'models/weapons/spellbook_open.glb',
  // spirit apparition creatures
  'models/creatures/wolf_basic.glb',
  'models/creatures/yetialt.glb',
  'models/creatures/velociraptor.glb',
  'models/creatures/stag.glb',
  'models/creatures/fox.glb',
  'models/creatures/bull.glb',
  'models/creatures/alpaca.glb',
  'models/creatures/dragonevolved.glb',
  'models/creatures/demon.glb',
  'models/creatures/demonalt.glb',
  'models/creatures/ghost.glb',
  'models/creatures/spider.glb',
  'models/creatures/wild_boar.glb',
];

// Rewrite a GLB so embedded images become data: URIs — the artifact CSP blocks
// the blob:/fetch path GLTFLoader uses for bufferView images. The old image
// bytes in the BIN chunk are zero-filled (offsets stay valid, zeros deflate away).
function inlineGlbImages(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  const jsonStart = 20;
  const json = JSON.parse(buf.subarray(jsonStart, jsonStart + jsonLen).toString('utf8'));
  const binHeader = jsonStart + jsonLen;
  const binLen = dv.getUint32(binHeader, true);
  const binStart = binHeader + 8;
  const bin = Buffer.from(buf.subarray(binStart, binStart + binLen)); // copy — we zero-fill
  let rewrote = 0;
  for (const img of json.images ?? []) {
    if (img.bufferView === undefined) continue;
    const bv = json.bufferViews[img.bufferView];
    const off = bv.byteOffset ?? 0;
    const bytes = bin.subarray(off, off + bv.byteLength);
    img.uri = `data:${img.mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
    delete img.bufferView;
    delete img.mimeType;
    bytes.fill(0);
    rewrote++;
  }
  if (!rewrote) return buf;
  let jsonOut = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonOut.length % 4)) % 4;
  if (jsonPad) jsonOut = Buffer.concat([jsonOut, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binOut = binPad ? Buffer.concat([bin, Buffer.alloc(binPad, 0)]) : bin;
  const total = 12 + 8 + jsonOut.length + 8 + binOut.length;
  const head = Buffer.alloc(12 + 8);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  head.writeUInt32LE(jsonOut.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binOut.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4); // 'BIN'
  return Buffer.concat([head, jsonOut, binHead, binOut]);
}

// 1. pack assets
const chunks = [];
const index = {};
let offset = 0;
for (const rel of ASSETS) {
  const buf = inlineGlbImages(readFileSync(`public/${rel}`));
  index[`/${rel}`] = [offset, buf.length];
  chunks.push(buf);
  offset += buf.length;
}
const blob = Buffer.concat(chunks);
const packed = deflateSync(blob, { level: 9 });
console.log(`pack: ${(blob.length / 1048576).toFixed(2)}MB -> deflate ${(packed.length / 1048576).toFixed(2)}MB`);

// 2. bundle engine
const entry = `
// artifact entry: register the in-memory asset pack, then boot the gallery
// (createImageBitmap disabled so GLTFLoader picks the Image-element texture
//  path — ImageBitmapLoader fetches, which the artifact CSP blocks)
try { globalThis.createImageBitmap = undefined; } catch {}
import { unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
const b64 = document.getElementById('assetpack').textContent.trim();
const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const blob = unzlibSync(bin);
const index = JSON.parse(document.getElementById('assetindex').textContent);
window.__ASSET_PACK__ = { blob, index };
const sfxEl = document.getElementById('sfxpack');
if (sfxEl) window.__SFX_PACK__ = JSON.parse(sfxEl.textContent);
await import('../arc_bolt_preview.js');
`;
writeFileSync('scripts/_tmp_artifact_entry.js', entry);
const r = await build({
  entryPoints: ['scripts/_tmp_artifact_entry.js'],
  bundle: true, format: 'esm', minify: true, write: false,
  absWorkingDir: process.cwd(),
  define: { 'import.meta.env': '{}' },
});
const js = r.outputFiles[0].text;
console.log(`bundle: ${(js.length / 1048576).toFixed(2)}MB`);

// 3. compose html (no doctype/html/head/body — the Artifact wrapper adds them)
const hud = readFileSync('arc_bolt_preview.html', 'utf8');
const style = hud.match(/<style>([\s\S]*?)<\/style>/)[1];
const bodyBits = hud.match(/<body>([\s\S]*?)<script/)[1]
  .replace('every class · every ability — dev page, not shipped',
    'World of ClaudeCraft — ability VFX review build · all 9 classes, 114 abilities');

// optional generated-SFX pack (base64 mp3 JSON — CSP-safe, no external fetch)
let sfxTag = '';
try {
  const sp = readFileSync('sfx_pack.json', 'utf8');
  sfxTag = `<script type="application/json" id="sfxpack">${sp}</script>\n`;
  console.log(`sfx pack: ${(sp.length / 1048576).toFixed(2)}MB inlined`);
} catch { console.log('no sfx_pack.json — artifact ships synth-only audio'); }

const html = `<title>WoC Ability VFX Gallery</title>
<style>${style}
  #hud .sub { opacity: .7; }
</style>
${bodyBits}
<script type="application/json" id="assetindex">${JSON.stringify(index)}</script>
<script type="text/plain" id="assetpack">${packed.toString('base64')}</script>
${sfxTag}<script type="module">${js.replace(/<\/script>/gi, '<\\/script>')}</script>
`;
writeFileSync(`${OUT}/woc_vfx_gallery_artifact.html`, html);
console.log(`artifact html: ${(html.length / 1048576).toFixed(2)}MB -> ${OUT}/woc_vfx_gallery_artifact.html`);
