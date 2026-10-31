// Turn the duel matrix (duels.jsonl from run.ts) into the 1v1 ranking report.
//   npx tsx scripts/pvp_duel/report.ts <dir-with-duels.jsonl> <out.md>
// Also writes <out>.json beside it (the per-matchup table) for further analysis.
//
// Scoring: a defeat is a win for the other side; a duel that reaches the time
// cap is a DRAW (half a win each). Both seat orders are pooled, so each
// unordered pairing holds 2 x runs duels. A spec's overall score is the plain
// mean of its 26 non-mirror pairing scores (every opponent weighs the same).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILDS, type SpecBuild } from './builds';
import type { DuelResult } from './duel';

const [dir, outPath] = process.argv.slice(2);
if (!dir || !outPath) throw new Error('usage: report <dir> <out.md>');

type Row = DuelResult & { error?: string };
const rows: Row[] = readFileSync(join(dir, 'duels.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const errors = rows.filter((r) => r.error);
const duels = rows.filter((r) => !r.error);

const keys = BUILDS.map((b) => `${b.cls}/${b.spec}`);
const byKey = new Map<string, SpecBuild>(BUILDS.map((b) => [`${b.cls}/${b.spec}`, b]));
const label = (k: string) => byKey.get(k)?.label ?? k;
const short = (k: string) => {
  const b = byKey.get(k);
  if (!b) return k;
  const cls = {
    warrior: 'War',
    paladin: 'Pal',
    hunter: 'Hun',
    rogue: 'Rog',
    priest: 'Pri',
    shaman: 'Sha',
    mage: 'Mag',
    warlock: 'Lck',
    druid: 'Dru',
  }[b.cls];
  const spec = b.label
    .split(' ')[0]
    .replace('Beast', 'BM')
    .replace('Marksmanship', 'MM')
    .replace('Survival', 'Surv')
    .replace('Assassination', 'Assn')
    .replace('Subtlety', 'Sub')
    .replace('Discipline', 'Disc')
    .replace('Elemental', 'Ele')
    .replace('Enhancement', 'Enh')
    .replace('Restoration', 'Resto')
    .replace('Retribution', 'Ret')
    .replace('Protection', 'Prot')
    .replace('Affliction', 'Aff')
    .replace('Demonology', 'Demo')
    .replace('Destruction', 'Destro');
  return `${spec} ${cls}`;
};

interface Pair {
  games: number;
  score: number; // wins + half draws, from the row spec's side
  wins: number;
  losses: number;
  draws: number;
  seconds: number;
}
const pair = new Map<string, Pair>();
const pk = (x: string, y: string) => `${x}>${y}`;
function bump(x: string, y: string, result: 'w' | 'l' | 'd', seconds: number) {
  const k = pk(x, y);
  const p = pair.get(k) ?? { games: 0, score: 0, wins: 0, losses: 0, draws: 0, seconds: 0 };
  p.games++;
  p.seconds += seconds;
  if (result === 'w') {
    p.wins++;
    p.score += 1;
  } else if (result === 'l') p.losses++;
  else {
    p.draws++;
    p.score += 0.5;
  }
  pair.set(k, p);
}

interface SpecAgg {
  games: number;
  timeouts: number;
  seconds: number;
  dealt: number;
  taken: number;
  ccSuffered: number;
  ccInflicted: number;
  trinket: number;
  winSeconds: number;
  wins: number;
}
const agg = new Map<string, SpecAgg>(
  keys.map((k) => [
    k,
    {
      games: 0,
      timeouts: 0,
      seconds: 0,
      dealt: 0,
      taken: 0,
      ccSuffered: 0,
      ccInflicted: 0,
      trinket: 0,
      winSeconds: 0,
      wins: 0,
    },
  ]),
);

for (const r of duels) {
  const ra = r.winner === 'a' ? 'w' : r.winner === 'b' ? 'l' : 'd';
  const rb = r.winner === 'b' ? 'w' : r.winner === 'a' ? 'l' : 'd';
  bump(r.a, r.b, ra, r.seconds);
  bump(r.b, r.a, rb, r.seconds);
  if (r.a === r.b) continue;
  for (const [me, side] of [
    [r.a, 'a'],
    [r.b, 'b'],
  ] as const) {
    const s = agg.get(me);
    if (!s) continue;
    s.games++;
    s.seconds += r.seconds;
    if (r.winner === 'timeout') s.timeouts++;
    if (r.winner === side) {
      s.wins++;
      s.winSeconds += r.seconds;
    }
    s.dealt += side === 'a' ? r.dmgToB : r.dmgToA;
    s.taken += side === 'a' ? r.dmgToA : r.dmgToB;
    s.ccSuffered += side === 'a' ? r.stunnedSecA : r.stunnedSecB;
    s.ccInflicted += side === 'a' ? r.stunnedSecB : r.stunnedSecA;
    s.trinket += side === 'a' ? r.trinketA : r.trinketB;
  }
}

const rate = (x: string, y: string) => {
  const p = pair.get(pk(x, y));
  return p && p.games > 0 ? p.score / p.games : Number.NaN;
};
const overall = new Map<string, number>();
for (const k of keys) {
  const opp = keys
    .filter((o) => o !== k)
    .map((o) => rate(k, o))
    .filter((v) => !Number.isNaN(v));
  overall.set(k, opp.reduce((s, v) => s + v, 0) / Math.max(1, opp.length));
}
const archetypes = ['melee', 'ranged', 'caster', 'healer'] as const;
const vsArch = (k: string, arch: string) => {
  const opp = keys
    .filter((o) => o !== k && byKey.get(o)?.archetype === arch)
    .map((o) => rate(k, o));
  return opp.length ? opp.reduce((s, v) => s + v, 0) / opp.length : Number.NaN;
};
const tier = (v: number) =>
  v >= 0.65 ? 'S' : v >= 0.55 ? 'A' : v >= 0.45 ? 'B' : v >= 0.35 ? 'C' : 'D';
const pct = (v: number) => (Number.isNaN(v) ? 'n/a' : `${Math.round(v * 100)}%`);
const ranked = [...keys].sort((x, y) => (overall.get(y) ?? 0) - (overall.get(x) ?? 0));

// Spread of the overall score across seeds: the standard error of a mean of
// 26 pairing rates, each a binomial-ish rate over `games` duels.
const gamesPerPair = (() => {
  const any = pair.get(pk(keys[0], keys[1]));
  return any?.games ?? 0;
})();

const L: string[] = [];
const runsPerOrdered = gamesPerPair / 2;
L.push('# PvP 1v1 duel Monte Carlo: Warfare Season 2 best-in-slot');
L.push('');
L.push(
  'Generated by `scripts/pvp_duel/report.ts` from `scripts/pvp_duel/run.ts`. Every one of the 27 specs',
);
L.push(
  `duelled every spec (mirrors included) ${runsPerOrdered} times from each side of the flag: ${duels.length} duels,`,
);
L.push(`${gamesPerPair} per pairing. Errors: ${errors.length}.`);
L.push('');
L.push(
  'Scoring: a defeat is a win for the other side; a duel still running at the time cap is a draw (half',
);
L.push(
  'a win each). A spec score is the mean of its 26 non-mirror pairing scores, so every opponent',
);
L.push('weighs the same. Tiers: S 65% and up, A 55 to 65%, B 45 to 55%, C 35 to 45%, D under 35%.');
L.push('');
L.push('## Spec ranking');
L.push('');
L.push(
  '| # | Spec | Tier | Score | vs Melee | vs Ranged | vs Caster | vs Healer | Draws | Avg win time | Dmg/s dealt | CC suffered/duel |',
);
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
ranked.forEach((k, i) => {
  const s = agg.get(k) as SpecAgg;
  const v = overall.get(k) ?? 0;
  L.push(
    `| ${i + 1} | ${label(k)} | ${tier(v)} | ${pct(v)} | ${archetypes.map((a) => pct(vsArch(k, a))).join(' | ')} | ${pct(s.timeouts / Math.max(1, s.games))} | ${s.wins ? (s.winSeconds / s.wins).toFixed(0) : '-'}s | ${(s.dealt / Math.max(1, s.seconds)).toFixed(1)} | ${(s.ccSuffered / Math.max(1, s.games)).toFixed(1)}s |`,
  );
});
L.push('');
L.push('## Class ranking (mean of the class specs)');
L.push('');
L.push('| # | Class | Score | Best spec | Worst spec |');
L.push('|---|---|---|---|---|');
const classes = [...new Set(BUILDS.map((b) => b.cls))];
const classScore = classes
  .map((cls) => {
    const ks = keys.filter((k) => byKey.get(k)?.cls === cls);
    const vals = ks.map((k) => overall.get(k) ?? 0);
    const best = ks[vals.indexOf(Math.max(...vals))];
    const worst = ks[vals.indexOf(Math.min(...vals))];
    return { cls, v: vals.reduce((s, x) => s + x, 0) / vals.length, best, worst };
  })
  .sort((x, y) => y.v - x.v);
for (const [i, c] of classScore.entries()) {
  L.push(
    `| ${i + 1} | ${c.cls[0].toUpperCase()}${c.cls.slice(1)} | ${pct(c.v)} | ${label(c.best)} (${pct(overall.get(c.best) ?? 0)}) | ${label(c.worst)} (${pct(overall.get(c.worst) ?? 0)}) |`,
  );
}
L.push('');
L.push('## Who counters who');
L.push('');
L.push(
  'For each spec: its three hardest pairings (its own score in brackets) and its three easiest.',
);
L.push('');
L.push('| Spec | Countered by | Counters |');
L.push('|---|---|---|');
for (const k of ranked) {
  const opp = keys.filter((o) => o !== k).map((o) => ({ o, v: rate(k, o) }));
  const worst = [...opp].sort((x, y) => x.v - y.v).slice(0, 3);
  const best = [...opp].sort((x, y) => y.v - x.v).slice(0, 3);
  L.push(
    `| ${label(k)} | ${worst.map((w) => `${short(w.o)} (${pct(w.v)})`).join(', ')} | ${best.map((w) => `${short(w.o)} (${pct(w.v)})`).join(', ')} |`,
  );
}
L.push('');
L.push('### Hard counters (85% or more of a pairing)');
L.push('');
const hard: { x: string; y: string; v: number }[] = [];
for (const x of keys)
  for (const y of keys) if (x !== y && rate(x, y) >= 0.85) hard.push({ x, y, v: rate(x, y) });
hard.sort((p, q) => q.v - p.v);
const hardBy = new Map<string, string[]>();
for (const h of hard) hardBy.set(h.x, [...(hardBy.get(h.x) ?? []), `${short(h.y)} ${pct(h.v)}`]);
L.push('| Spec | Hard-counters |');
L.push('|---|---|');
for (const k of ranked)
  if (hardBy.has(k)) L.push(`| ${label(k)} | ${(hardBy.get(k) ?? []).join(', ')} |`);
L.push('');
L.push('## Full matchup matrix');
L.push('');
L.push(
  'Row spec score against the column spec (both seat orders pooled). Mirrors read 50% by construction.',
);
L.push('');
L.push(`| vs | ${ranked.map(short).join(' | ')} |`);
L.push(`|---|${ranked.map(() => '---').join('|')}|`);
for (const x of ranked)
  L.push(
    `| **${short(x)}** | ${ranked.map((y) => (x === y ? '-' : pct(rate(x, y)))).join(' | ')} |`,
  );
L.push('');
L.push('## Duel shape by spec');
L.push('');
L.push(
  '| Spec | Avg duel length | Draw rate | Damage taken/s | CC inflicted/duel | PvP trinket uses/duel |',
);
L.push('|---|---|---|---|---|---|');
for (const k of ranked) {
  const s = agg.get(k) as SpecAgg;
  const g = Math.max(1, s.games);
  L.push(
    `| ${label(k)} | ${(s.seconds / g).toFixed(0)}s | ${pct(s.timeouts / g)} | ${(s.taken / Math.max(1, s.seconds)).toFixed(1)} | ${(s.ccInflicted / g).toFixed(1)}s | ${(s.trinket / g).toFixed(2)} |`,
  );
}
L.push('');
if (errors.length) {
  L.push('## Errors');
  L.push('');
  for (const e of errors.slice(0, 20)) L.push(`- ${e.a} vs ${e.b} seed ${e.seed}: ${e.error}`);
  L.push('');
}
writeFileSync(outPath, `${L.join('\n')}\n`);
const json = {
  duels: duels.length,
  errors: errors.length,
  gamesPerPair,
  ranking: ranked.map((k) => ({
    spec: k,
    label: label(k),
    score: overall.get(k),
    tier: tier(overall.get(k) ?? 0),
    vs: Object.fromEntries(archetypes.map((a) => [a, vsArch(k, a)])),
    ...(agg.get(k) as SpecAgg),
  })),
  classes: classScore,
  matrix: Object.fromEntries(
    keys.map((x) => [x, Object.fromEntries(keys.map((y) => [y, pair.get(pk(x, y)) ?? null]))]),
  ),
};
writeFileSync(outPath.replace(/\.md$/, '.json'), `${JSON.stringify(json, null, 1)}\n`);
console.log(`report -> ${outPath}`);
