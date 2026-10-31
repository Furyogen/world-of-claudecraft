// Build the one-page results card (a self-contained HTML page) from the
// report's JSON.
//   npx tsx scripts/pvp_duel/card.ts docs/balance/pvp-1v1-season2-data.json docs/balance/pvp-1v1-season2-card.html
// The numbers all come from the JSON; the findings and method text below are
// the reading of one run (docs/balance/pvp-1v1-season2.md) and must be revised
// by hand after a re-run that changes them.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILDS } from './builds';

const [jsonPath, outPath] = process.argv.slice(2);
if (!jsonPath || !outPath) throw new Error('usage: card <report.json> <out.html>');

interface RankRow {
  spec: string;
  label: string;
  score: number;
  tier: string;
  vs: Record<string, number>;
  games: number;
  timeouts: number;
  seconds: number;
  dealt: number;
  taken: number;
  ccSuffered: number;
  ccInflicted: number;
  winSeconds: number;
  wins: number;
}
interface PairRow {
  games: number;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  seconds: number;
}
interface Report {
  duels: number;
  errors: number;
  gamesPerPair: number;
  ranking: RankRow[];
  classes: { cls: string; v: number; best: string; worst: string }[];
  matrix: Record<string, Record<string, PairRow | null>>;
}
const R: Report = JSON.parse(readFileSync(jsonPath, 'utf8'));
const build = new Map(BUILDS.map((b) => [`${b.cls}/${b.spec}`, b]));

const CLASS_SHORT: Record<string, string> = {
  warrior: 'War',
  paladin: 'Pal',
  hunter: 'Hun',
  rogue: 'Rog',
  priest: 'Pri',
  shaman: 'Sha',
  mage: 'Mag',
  warlock: 'Lck',
  druid: 'Dru',
};
const SPEC_SHORT: Record<string, string> = {
  beast_mastery: 'BM',
  marksmanship: 'MM',
  survival: 'Surv',
  assassination: 'Assn',
  subtlety: 'Sub',
  discipline: 'Disc',
  elemental: 'Ele',
  enhancement: 'Enh',
  restoration: 'Resto',
  retribution: 'Ret',
  protection: 'Prot',
  prot: 'Prot',
  affliction: 'Aff',
  demonology: 'Demo',
  destruction: 'Destro',
};
const short = (key: string) => {
  const [cls, spec] = key.split('/');
  const s = SPEC_SHORT[spec] ?? spec[0].toUpperCase() + spec.slice(1);
  return `${s} ${CLASS_SHORT[cls] ?? cls}`;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

const specs = R.ranking.map((r) => ({
  key: r.spec,
  label: r.label,
  short: short(r.spec),
  arch: build.get(r.spec)?.archetype ?? 'melee',
  score: r.score,
  tier: r.tier,
  vs: r.vs,
  draw: r.timeouts / Math.max(1, r.games),
  winTime: r.wins ? r.winSeconds / r.wins : 0,
  dps: r.dealt / Math.max(1, r.seconds),
  dtps: r.taken / Math.max(1, r.seconds),
  cc: r.ccSuffered / Math.max(1, r.games),
  ccOut: r.ccInflicted / Math.max(1, r.games),
  len: r.seconds / Math.max(1, r.games),
}));
const m: Record<string, Record<string, [number, number, number, number, number]>> = {};
for (const x of specs) {
  m[x.key] = {};
  for (const y of specs) {
    const p = R.matrix[x.key]?.[y.key];
    if (!p || x.key === y.key) continue;
    m[x.key][y.key] = [p.score / p.games, p.wins, p.losses, p.draws, p.seconds / p.games];
  }
}
const archCounts: Record<string, number> = { melee: 0, ranged: 0, caster: 0, healer: 0 };
for (const s of specs) archCounts[s.arch]++;
const classLabel = (c: string) => c[0].toUpperCase() + c.slice(1);
const classes = R.classes.map((c) => ({
  cls: c.cls,
  label: classLabel(c.cls),
  score: c.v,
  best: c.best,
  worst: c.worst,
}));
const top = specs[0];
const bottom = specs[specs.length - 1];
const hardCounters = specs.reduce(
  (n, x) => n + specs.filter((y) => y.key !== x.key && (m[x.key][y.key]?.[0] ?? 0) >= 0.85).length,
  0,
);

const meta = {
  lede:
    `Every spec duelled every spec in Warfare Season 2 best-in-slot, ${R.gamesPerPair} duels per pairing. ` +
    `Paladin dominates: all three of its specs score over 90%, ahead of Fury Warrior. Mage is the weakest class.`,
  facts: [
    `<b>${R.duels.toLocaleString('en-US')}</b> duels`,
    `<b>${specs.length}</b> specs, every pairing`,
    `<b>${R.gamesPerPair}</b> duels per pairing`,
    `<b>${R.errors}</b> errors`,
    'Code: <b>release/v0.45.0</b>',
    'Season 2 pushback immunity <b>modelled</b>',
    'Draw at <b>240 s</b>',
  ],
  tiles: [
    { k: 'Top spec', v: top.label, s: `${pct(top.score)} average win rate` },
    {
      k: 'Top class',
      v: classes[0].label,
      s: `${pct(classes[0].score)}, all three specs in S tier`,
    },
    {
      k: 'Bottom class',
      v: classes[classes.length - 1].label,
      s: `${pct(classes[classes.length - 1].score)}; bottom spec ${bottom.label} ${pct(bottom.score)}`,
    },
    { k: 'Lopsided pairings', v: `${hardCounters}`, s: 'one side wins 85% or more' },
  ],
};

const findings = [
  {
    sev: 'serious',
    tag: 'Balance',
    title: 'Paladin is in a class of its own',
    body: 'All three specs score 93% or more and take 95 to 100% of nearly every non-paladin pairing. Only Restoration Shaman holds them (Holy and Prot 50%), plus Arcane Mage against Prot (70%). Two of the top three are a tank and a healer.',
  },
  {
    sev: 'serious',
    tag: 'Balance',
    title: 'Hallowed Wall makes Prot Paladin nearly immune',
    body: '<code>holy_shield</code> absorbs 10% of max health every 8 s on an 8 s cooldown, off the GCD, plus 30% block: full uptime. In four duels against Fury Warrior it absorbed 10,899 damage while the paladin took a few hundred. Prot Paladin takes 10.9 damage per second, a third of the next spec.',
  },
  {
    sev: 'serious',
    tag: 'Balance',
    title: 'Vitality inflates max-health effects up to 1.8x',
    body: 'Season 2 Vitality adds up to 80% max health in PvP, and every shield or heal sized from max health (Hallowed Wall, Lay on Hands, the paladin absorbs) grows with it.',
  },
  {
    sev: 'serious',
    tag: 'Balance',
    title: 'Retribution burst',
    body: 'Zealwing (<code>avenging_wrath</code>) lets Tolling Hammer, an under-20% execute, hit at any health for 15 s. With Final Edict and Verdict of the Sun God, Ret deals 114 damage per second, the most of any spec, and wins in 37 s on average.',
  },
  {
    sev: 'serious',
    tag: 'Balance',
    title: 'Casters cannot escape warrior control',
    body: 'Crushing Charge (4 s root plus 15 s slow), Pummel school lockout, Thunderhurl stun, Hamstring and Heroic Leap: Arms and Fury win 100% against every mage, every warlock, Elemental, Holy Priest and Restoration Druid.',
  },
  {
    sev: 'serious',
    tag: 'Balance',
    title: 'Mage is the weakest class (20%)',
    body: 'Cloth and about 2,650 health against 30% Warfare Offense, no self-healing outside Chronomancy. Fire and Frost score 0% against every hunter and 1 to 7% against melee.',
  },
  {
    sev: 'warning',
    tag: 'Balance',
    title: 'Rogues beat only soft targets (36%)',
    body: 'The stealth opener lands, but with no healing and 45 to 50 damage per second rogues lose to Beast Mastery and Marksmanship (0%), every warrior and paladin, and every healer except Holy Priest.',
  },
  {
    sev: 'warning',
    tag: 'Balance',
    title: 'Warlocks are glass cannons',
    body: 'Destruction deals 91 damage per second, second only to Ret, but its peel is a 1.5 s Fear that melee interrupts or out-damages: 3 to 6% against melee.',
  },
  {
    sev: 'warning',
    tag: 'Balance',
    title: 'Two healers cannot win a duel',
    body: 'Holy Priest (16%) and Restoration Druid (22%) deal about 18 damage per second. Healer against healer stalls to the 240 s draw; Holy Paladin is the only healer that kills other healers.',
  },
  {
    sev: 'warning',
    tag: 'Balance',
    title: 'Pushback immunity mostly helps healers',
    body: 'A one-duel-per-pairing sample without it (indicative only) had Holy Paladin at 60% and Restoration Shaman at 42%. With it they reach 93% and 74%: the rule rewards cast-time heals under melee pressure.',
  },
  {
    sev: 'critical',
    tag: 'Security',
    title: 'Hostile spells land on a stealthed player',
    body: 'The server hides stealthed players from snapshots, but the <code>target</code> command passes any id to <code>Sim.targetEntity</code>, and a test Shadow Word: Pain landed on a stealthed rogue and broke stealth. A duel opponent id is known from the duel request, so a modified client could do this. Not fixed: follow-up for <code>src/sim/targeting.ts</code>.',
  },
  {
    sev: 'warning',
    tag: 'Engine',
    title: 'Charge can land at zero distance',
    body: 'At distance 0 no facing resolves, so facing-gated abilities refuse until one side moves. Players recover by moving; bots and the RL environment need to step back.',
  },
];

const method = [
  {
    h: 'Gear',
    html: '<p>The five class-and-spec Season 2 pieces, entry-tier Warfare waist, feet, neck and rings for the primary stat, Medallion of Defiance, and the Season 2 weapon (two for dual wielders). Shield, held off-hand and quiver from the top-parse loadout. Every kit hits the 30% Offense and Defense caps and +80% Vitality.</p>',
  },
  {
    h: 'Rules',
    html: '<p>Level 20, a real accepted duel (Warfare damage scaling, PvP diminishing returns, the 1 HP finish), 18 to 24 yards apart on flat ground, fully buffed. A full Season 2 kit is modelled as spell pushback immune (the v0.46 rule; <code>SEASON2_PUSHBACK_IMMUNITY</code>). Draw at 240 s, half a win each.</p>',
  },
  {
    h: 'The bot',
    html: '<p>One engine for every spec: movement, kiting, interrupts on every enemy cast, the PvP trinket on hard control, defensives on health thresholds. Damage priorities follow the repo balance probes. Talent rows are one PvP build per spec, listed in <code>scripts/pvp_duel/builds.ts</code>.</p>',
  },
  {
    h: 'Read with care',
    html: '<ul><li>Same skill level for everyone: no juking, line-of-sight pillaring or fake casts.</li><li>Pets and minions are never attacked, only peeled with area effects.</li><li>A different talent build can move a spec a tier.</li><li>Pairings at 85% or more are the solid signal; 40 to 60% is close to even.</li></ul>',
  },
  {
    h: 'Reproduce',
    html: '<p><code>npx tsx scripts/pvp_duel/run.ts --runs 10</code> (about 30 min on 4 cores), then <code>report.ts</code> and <code>card.ts</code>. One duel timeline: <code>trace.ts &lt;specA&gt; &lt;specB&gt; [seed]</code>.</p>',
  },
];

const data = { meta, specs, classes, m, archCounts, findings, method };
const template = readFileSync(
  fileURLToPath(new URL('./card_template.html', import.meta.url)),
  'utf8',
);
writeFileSync(outPath, template.replace('/*DATA*/null', JSON.stringify(data)));
console.log(`card -> ${outPath}`);
