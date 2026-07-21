// Regenerate the gallery catalog (scripts/vfx/specs/abilities.json +
// ability_catalog.js) from a sim checkout's content sources.
//   node scripts/vfx/gen_catalog.mjs [--src <path-to-repo-root>] [--label <ref-name>]
// Scope (matches the original 193-ability catalog's rule): each class's learn
// list (CLASSES[cls].abilities, the base kit incl. spec-gated kit spells) plus
// the three spec SIGNATURE grants per class (TALENTS), plus the two
// pet-command pseudo abilities (feed_pet / abandon_pet, hunter), plus EXTRAS
// (chaos_bolt: the one v2 row-grant active the gallery tracks, per the v0.28
// handoff brief), plus a CARRYOVER of ids already in the committed catalog
// that still resolve in ABILITIES (keeps legacy showcase entries such as
// berserker_rage / arcane_power alive across kit reworks). SPORT_ABILITIES
// (Vale Cup minigame) and non-signature talent row grants stay excluded.
// Ability defs all resolve through ABILITIES (classes.ts), which already folds
// in talents_classic / talents_warrior signature defs and TALENT_ABILITIES_V2.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const argv = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const SRC = path.resolve(argOf('--src', '.'));
const LABEL = argOf('--label', 'the current sim');

const entry = `
import { ABILITIES, CLASSES } from ${JSON.stringify(path.join(SRC, 'src/sim/content/classes.ts'))};
import { SPORT_ABILITIES } from ${JSON.stringify(path.join(SRC, 'src/sim/content/vale_cup.ts'))};
import { TALENTS } from ${JSON.stringify(path.join(SRC, 'src/sim/content/talents.ts'))};
const classOrder = Object.keys(CLASSES);
const learnLists = {};
for (const cls of classOrder) learnLists[cls] = CLASSES[cls].abilities ?? [];
const signatures = {};
for (const [cls, tree] of Object.entries(TALENTS)) signatures[cls] = (tree.specs ?? []).map((s) => s.signature);
console.log(JSON.stringify({
  abilities: ABILITIES,
  sportIds: Object.keys(SPORT_ABILITIES),
  classOrder,
  learnLists,
  signatures,
}));
`;

const tmp = mkdtempSync(path.join(tmpdir(), 'vfx-catalog-'));
const bundle = path.join(tmp, 'dump.mjs');
await esbuild.build({
  stdin: { contents: entry, resolveDir: SRC, loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'silent',
});
const raw = execFileSync(process.execPath, [bundle], { maxBuffer: 64 * 1024 * 1024 }).toString();
rmSync(tmp, { recursive: true, force: true });
const { abilities, sportIds, classOrder, learnLists, signatures } = JSON.parse(raw);

const sport = new Set(sportIds);
// v2 row-grant actives the gallery tracks beyond the signature rule
const EXTRAS = ['chaos_bolt'];
// carryover: ids already in the committed catalog that still resolve
let carryover = [];
try {
  const prev = JSON.parse(readFileSync('scripts/vfx/specs/abilities.json', 'utf8'));
  carryover = Object.values(prev)
    .flat()
    .map((a) => a.id)
    .filter((id) => abilities[id] && !sport.has(id));
} catch {
  /* first generation: no previous catalog */
}
const allowed = new Set([
  ...Object.values(learnLists).flat(),
  ...Object.values(signatures).flat(),
  ...EXTRAS,
  ...carryover,
]);
// repo copy rule: no em or en dashes in generated output (a couple of sim
// descriptions still carry them upstream)
const noDash = (s) =>
  String(s)
    .replace(/ [\u2013\u2014\u2015] /g, ', ')
    .replace(/[\u2013\u2014\u2015]/g, '-');
const toEntry = (d) => {
  const e = {
    id: d.id,
    name: d.name,
    learnLevel: d.learnLevel ?? 1,
    school: d.school,
    castTime: d.castTime ?? 0,
    cooldown: d.cooldown ?? 0,
    range: d.range ?? 0,
    targetType: d.targetType ?? (d.requiresTarget ? 'enemy' : 'self'),
    requiresTarget: !!d.requiresTarget,
    channel: !!d.channel,
    effects: (d.effects ?? []).map((f) => {
      const out = { type: f.type };
      if (f.duration !== undefined) out.duration = f.duration;
      if (f.radius !== undefined) out.radius = f.radius;
      return out;
    }),
    description: noDash(d.description ?? ''),
  };
  if (d.passive) e.passive = true;
  return e;
};

const catalog = {};
const problems = [];
for (const cls of classOrder) catalog[cls] = [];
const placed = new Set();
// base kit first, in learn order
for (const cls of classOrder) {
  for (const id of learnLists[cls]) {
    const d = abilities[id];
    if (!d) {
      problems.push(`${cls} learn list references unknown ability ${id}`);
      continue;
    }
    catalog[cls].push(toEntry(d));
    placed.add(id);
  }
}
// then the remaining allowed defs (signatures / extras / carryover), source order
for (const [id, d] of Object.entries(abilities)) {
  if (placed.has(id) || sport.has(id) || !allowed.has(id)) continue;
  if (!catalog[d.class]) {
    problems.push(`${id} has non-class owner '${d.class}' - skipped`);
    continue;
  }
  catalog[d.class].push(toEntry(d));
  placed.add(id);
}
for (const id of allowed) {
  if (!placed.has(id) && !abilities[id] && id !== 'feed_pet' && id !== 'abandon_pet') {
    problems.push(`allowed id ${id} not found in ABILITIES`);
  }
}
// the pet-command pseudo abilities (src/sim/pet/pet_commands.ts surface)
catalog.hunter.push(
  {
    id: 'feed_pet',
    name: 'Feed Pet',
    learnLevel: 10,
    school: 'physical',
    castTime: 0,
    cooldown: 0,
    range: 5,
    targetType: 'friendly',
    requiresTarget: false,
    channel: false,
    effects: [{ type: 'petBuff', duration: 20 }],
    description: 'Feed your pet food to make it happy, restoring health over 20 sec.',
  },
  {
    id: 'abandon_pet',
    name: 'Abandon Pet',
    learnLevel: 10,
    school: 'physical',
    castTime: 0,
    cooldown: 0,
    range: 5,
    targetType: 'friendly',
    requiresTarget: false,
    channel: false,
    effects: [{ type: 'releasePet' }],
    description: 'Release your pet back into the wild.',
  },
);

const total = Object.values(catalog).reduce((n, l) => n + l.length, 0);
const json = JSON.stringify(catalog, null, 2);
writeFileSync('scripts/vfx/specs/abilities.json', `${json}\n`);
writeFileSync(
  'ability_catalog.js',
  `// GENERATED from ${LABEL} src/sim/content (ABILITIES + talent signatures + pet commands), dev preview only\nexport const CATALOG = ${json};\n`,
);
// normalize to the repo's biome style so a regen never leaves format drift
try {
  execFileSync(
    'npx',
    [
      '@biomejs/biome',
      'format',
      '--write',
      'scripts/vfx/specs/abilities.json',
      'ability_catalog.js',
    ],
    { stdio: 'ignore' },
  );
} catch {
  /* biome unavailable: output is still valid, just unformatted */
}
console.log(`catalog: ${total} abilities across ${classOrder.length} classes`);
for (const cls of classOrder) console.log(` ${cls}: ${catalog[cls].length}`);
if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log(' -', p);
}
