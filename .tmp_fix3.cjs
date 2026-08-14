const fs = require('fs');
function edit(p, pairs) {
  let s = fs.readFileSync(p, 'utf8');
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`anchor in ${p}: ${from.slice(0, 70)}`);
    s = s.replace(from, to);
  }
  fs.writeFileSync(p, s);
  console.log('ok', p);
}

// The rock mount's GLB is a shipped static prop with no animation track, the same
// prop lane the snail and hover cycle already use. The gate re-proves the exemption
// is honest, so listing it here is a claim it verifies, not a bypass.
edit('tests/character_clipmaps.test.ts', [
  [
    "const CLIPLESS_RIGS = new Set([\n  'mount_stalkglider_snail',",
    "const CLIPLESS_RIGS = new Set([\n  'mount_stalkglider_snail',\n  'mount_pet_boulder',",
  ],
]);

// /dev mounts derives its grant from MOUNT_KEYS, so the tenth mount rides along;
// only the deliberately literal count moves.
edit('tests/chat.test.ts', [
  [
    '    // 9 since the Drakemaw Raptor joined the catalog. Spelled as a literal on',
    '    // 10 since the Pet Boulder joined the catalog. Spelled as a literal on',
  ],
  [
    "      events.some((e: any) => e.type === 'log' && /^\[dev\] Granted 9 mount reins/.test(e.text)),",
    "      events.some((e: any) => e.type === 'log' && /^\[dev\] Granted 10 mount reins/.test(e.text)),",
  ],
]);
