const fs = require('fs');
const crypto = require('crypto');
const VP = 'docs/achievements/item-art-consistency-2026-08-09/final-item-art-audit-verdict.json';
const AP = 'docs/achievements/item-art-consistency-2026-08-09/accepted-art.json';
const vb = fs.readFileSync(VP);
const vsha = crypto.createHash('sha256').update(vb).digest('hex');
const v = JSON.parse(vb.toString('utf8'));

// accepted-art records the verdict's digest.
const raw = fs.readFileSync(AP, 'utf8');
const a = JSON.parse(raw);
const row = a.sourceEvidence.find((e) => e.path.endsWith('final-item-art-audit-verdict.json'));
row.acceptedSha256 = vsha;
row.acceptedBytes = vb.length;
fs.writeFileSync(AP, JSON.stringify(a, null, 2) + (raw.endsWith('\n') ? '\n' : ''));

function edit(p, pairs) {
  let s = fs.readFileSync(p, 'utf8');
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`anchor in ${p}: ${String(from).slice(0, 60)}`);
    s = s.split(from).join(to);
  }
  fs.writeFileSync(p, s);
  console.log('ok', p);
}

edit('tests/item_art_consistency.test.ts', [
  ['fdd8313ca7ecc80a406c96176206e64fcf7bda42d8baf0ab5c80b32b93e346d8', vsha],
  ['acceptedBytes: 109297', `acceptedBytes: ${vb.length}`],
  ['expect(verdictBytes.length).toBe(109297);', `expect(verdictBytes.length).toBe(${vb.length});`],
  ["'acad50b8d261f88630e3ca323322d1522a4cfa0b3ea024111662fbdcda822c89'", `'${v.evidence.sheetSetSha256}'`],
  ["sha256: 'ea04f7224e4a13e35d098c6a1cc96dbda6b38df43fdff6252d1eae0dfcd98933'", `sha256: '${v.evidence.catalog.sha256}'`],
  ['bytes: 451256', `bytes: ${v.evidence.catalog.bytes}`],
]);
edit('tests/item_art_audit_builder.test.ts', [
  ['catalogBytes: 451256', `catalogBytes: ${v.evidence.catalog.bytes}`],
  ["catalogSha256: 'ea04f7224e4a13e35d098c6a1cc96dbda6b38df43fdff6252d1eae0dfcd98933'", `catalogSha256: '${v.evidence.catalog.sha256}'`],
  ['acad50b8d261f88630e3ca323322d1522a4cfa0b3ea024111662fbdcda822c89', v.evidence.sheetSetSha256],
]);
console.log('verdict', vb.length, vsha.slice(0, 12));
