// Merge workflow-authored specs into ability_specs.js.
// Usage: node scripts/_tmp_merge_specs.mjs <merged-specs.json>
import { readFileSync, writeFileSync } from 'node:fs';

const SPECS_DIR = 'scripts/vfx/specs';
const src = process.argv[2] ?? `${SPECS_DIR}/authored_specs.json`;
const merged = JSON.parse(readFileSync(src, 'utf8'));
const catalog = JSON.parse(readFileSync(`${SPECS_DIR}/abilities.json`, 'utf8'));

// overlay passes in order: diversity → unveil → … → new-spell base additions.
// Nested objects merge, scalars replace. round3_new_specs entries may CREATE
// base specs (the origin/main content drop added 48 abilities the original
// authoring never saw).
for (const overlay of [
  'diversity_patches.json',
  'unveil_patches.json',
  'accent_patches.json',
  'signature_patches.json',
  'round2_patches.json',
  'round3_new_specs.json',
  'round3_spirit_policy.json',
  'round4_semantics.json',
  'round5_buff_slots.json',
  'round5_buff_dna.json',
  'round6_talent_sigs.json',
  'round7_v28.json',
  'round8_row_actives.json',
]) {
  const mayCreate =
    overlay === 'round3_new_specs.json' ||
    overlay === 'round6_talent_sigs.json' ||
    overlay === 'round7_v28.json' ||
    overlay === 'round8_row_actives.json';
  try {
    const patches = JSON.parse(readFileSync(`${SPECS_DIR}/${overlay}`, 'utf8'));
    let n = 0;
    for (const [id, rawPatch] of Object.entries(patches)) {
      if (!merged[id] && mayCreate) merged[id] = {};
      if (!merged[id]) continue;
      const { _cls, notes, ...patch } = rawPatch;
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v))
          merged[id][k] = { ...(merged[id][k] ?? {}), ...v };
        else merged[id][k] = v;
      }
      if (notes) merged[id]._notes = notes; // latest pass owns the comment
      n++;
    }
    console.log(`applied ${overlay} to ${n} abilities`);
  } catch {
    console.log(`no ${overlay}, skipped`);
  }
}

// showcase spirit pins (survive regeneration). DIRECTOR'S RULE: ghost-ANIMAL
// apparitions are druid-only. Exceptions kept deliberately: ghost_wolf (the
// spell IS the wolf), polymorph (the sheep IS the payoff), flagged to Tony.
const PINS = {
  ghost_wolf: {
    windupStyle: 'none',
    spirit: { model: 'wolf', path: 'circle', at: 'caster', scale: 0.9, dur: 2.2 },
  },
  bear_form: { spirit: { model: 'bear', path: 'rise', at: 'caster', scale: 1.1, dur: 1.8 } },
  cat_form: { spirit: { model: 'wolf', path: 'pounce', at: 'caster', scale: 0.85, dur: 1.4 } },
  polymorph: { spirit: { model: 'sheep', path: 'rise', at: 'target', scale: 0.8, dur: 2.4 } },
};
for (const [id, pin] of Object.entries(PINS)) {
  if (!merged[id]) continue;
  for (const [k, v] of Object.entries(pin)) {
    if (merged[id][k] === undefined) merged[id][k] = v; // agent choice wins if present
  }
}

const ARCH = new Set([
  'bolt',
  'burst',
  'strike',
  'nova',
  'beam',
  'dot',
  'heal',
  'buff',
  'shout',
  'summon',
  'cc',
  'dash',
]);
const PAL = new Set([
  'physical',
  'fire',
  'frost',
  'arcane',
  'shadow',
  'holy',
  'nature',
  'storm',
  'blood',
  'moon',
  'venom',
  'gold',
]);

// the approved reference look, never overridden
// no longer "locked", Tony unlocked it. This is the hand-authored FLAGSHIP
// spec: everything the engine can do, in service of the original identity.
const LOCKED = {
  lightning_bolt: {
    archetype: 'bolt',
    palette: 'storm',
    windup: 1.7,
    power: 1.25,
    windupStyle: 'runes',
    bolt: { speed: 30, jagged: true, coils: true, forkEvery: 0.09, leader: true },
    linger: 3.2, // the target stays electrified, residual arcs crawl through it
    finisher: true,
  },
};

const allIds = new Set(
  Object.values(catalog)
    .flat()
    .map((a) => a.id),
);
const problems = [];
const out = {};
for (const [id, raw] of Object.entries(merged)) {
  if (!allIds.has(id)) {
    problems.push(`unknown ability id: ${id}`);
    continue;
  }
  const { _cls, notes, ...spec } = raw;
  if (!ARCH.has(spec.archetype)) {
    problems.push(`${id}: bad archetype ${spec.archetype}`);
    continue;
  }
  if (spec.palette && !PAL.has(spec.palette)) {
    problems.push(`${id}: bad palette ${spec.palette}`);
    delete spec.palette;
  }
  if (spec.power !== undefined) spec.power = Math.min(1.6, Math.max(0.5, spec.power));
  if (spec.windup !== undefined) spec.windup = Math.min(2.5, Math.max(0.2, spec.windup));
  out[id] = spec;
  out[id]._notes = raw._notes ?? notes; // kept as comment fodder, stripped below
}
Object.assign(out, LOCKED);

// coverage check
const covered = new Set(Object.keys(out));
const missing = [...allIds].filter((id) => !covered.has(id));
if (missing.length) problems.push(`missing specs (will use fallback): ${missing.join(', ')}`);

// cap finishers at one per class
for (const [cls, list] of Object.entries(catalog)) {
  const fin = list.filter((a) => out[a.id]?.finisher).map((a) => a.id);
  if (fin.length > 1) {
    problems.push(`${cls}: ${fin.length} finishers (${fin.join(',')}), keeping first`);
    for (const id of fin.slice(1)) delete out[id].finisher;
  }
}

let body = '// Per-ability VFX specs: AUTHORED (9 spec-author agents + locked references).\n';
body += '// Consumed by arc_bolt_preview.js; shape = the proposed AbilityVfxSpec.\n';
body +=
  '// biome-ignore-all format: generated one-line-per-ability, comments carry authoring intent\n';
body += 'export const SPECS = {\n';
for (const [cls, list] of Object.entries(catalog)) {
  body += `  // ---- ${cls} ----\n`;
  for (const a of list) {
    const spec = out[a.id];
    if (!spec) continue;
    const { _notes, ...clean } = spec;
    // comments follow the repo copy rule: no em or en dashes in generated output
    const note = _notes
      ? ` // ${String(_notes)
          .replace(/\n/g, ' ')
          .replace(/\s*[---]\s*/g, ', ')
          .slice(0, 110)}`
      : '';
    body += `  ${a.id}: ${JSON.stringify(clean)},${note}\n`;
  }
}
body += '};\n';
writeFileSync('ability_specs.js', body);
console.log(`wrote ability_specs.js with ${Object.keys(out).length} specs`);
if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log(' -', p);
}
