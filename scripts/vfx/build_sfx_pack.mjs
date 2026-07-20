// Bundle generated SFX takes into sfx_pack.json at the repo root:
//   { "<id>": ["<base64 mp3>", ...takes] }
// The gallery fetches /sfx_pack.json in dev; the artifact build inlines it.
// ALL takes ship — the Sfx engine round-robins them per play so repeated hits
// never machine-gun the same recording.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const SFXDIR = 'tmp/vfx/sfx';
const pack = {};
let files = 0, bytes = 0;
for (const f of readdirSync(SFXDIR).sort()) {
  const m = f.match(/^(.+)_(\d+)\.mp3$/);
  if (!m) continue;
  const buf = readFileSync(`${SFXDIR}/${f}`);
  if (buf.length < 2000) { console.log(`skip ${f} — suspiciously small (${buf.length}B)`); continue; }
  (pack[m[1]] ??= []).push(buf.toString('base64'));
  files++; bytes += buf.length;
}
if (!files) { console.error('no takes found in', SFXDIR, '— run _tmp_gen_sfx.mjs first'); process.exit(1); }
const json = JSON.stringify(pack);
writeFileSync('sfx_pack.json', json);
console.log(`sfx_pack.json: ${Object.keys(pack).length} sounds, ${files} takes, ${(bytes / 1048576).toFixed(2)}MB raw -> ${(json.length / 1048576).toFixed(2)}MB json`);
