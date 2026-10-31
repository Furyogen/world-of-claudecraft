// Season 2 PvP 1v1 Monte Carlo: every spec against every spec, N seeded duels
// per ordered matchup, sharded across worker processes.
//   npx tsx scripts/pvp_duel/run.ts [--runs 10] [--workers 4] [--out tmp/pvp_duel]
// Then: npx tsx scripts/pvp_duel/report.ts tmp/pvp_duel docs/balance/pvp-1v1-season2.md

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const runs = Number(arg('runs', '10'));
const workers = Number(arg('workers', String(Math.max(1, cpus().length))));
const outDir = arg('out', 'tmp/pvp_duel');
mkdirSync(outDir, { recursive: true });
const worker = fileURLToPath(new URL('./worker.ts', import.meta.url));
const t0 = Date.now();

const jobs = Array.from({ length: workers }, (_, shard) => {
  const out = join(outDir, `shard_${shard}.jsonl`);
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [...process.execArgv, worker, String(shard), String(workers), String(runs), out],
      {
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
    child.on('exit', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`shard ${shard} exited ${code}`)),
    );
  });
});

const files = await Promise.all(jobs);
const lines = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean));
writeFileSync(join(outDir, 'duels.jsonl'), `${lines.join('\n')}\n`);
console.log(
  `${lines.length} duels in ${((Date.now() - t0) / 60000).toFixed(1)} min -> ${join(outDir, 'duels.jsonl')}`,
);
