// One shard of the duel matrix: every ordered (A, B) matchup whose index falls
// in this shard, `runs` seeded duels each, one JSON line per duel.
//   tsx scripts/pvp_duel/worker.ts <shard> <shards> <runs> <out.jsonl>

import { appendFileSync, writeFileSync } from 'node:fs';
import { BUILDS } from './builds';
import { duelSeed, runDuel, specKey } from './duel';
import { createDuelSim } from './setup';

const [shardS, shardsS, runsS, out] = process.argv.slice(2);
const shard = Number(shardS);
const shards = Number(shardsS);
const runs = Number(runsS);
if (!out || !(shards > 0) || !(runs > 0))
  throw new Error('usage: worker <shard> <shards> <runs> <out>');

writeFileSync(out, '');
const RECREATE_EVERY = 150; // a fresh world now and then keeps clocks and ids small
let sim = createDuelSim(1);
let n = 0;
let index = 0;
for (const a of BUILDS) {
  for (const b of BUILDS) {
    if (index++ % shards !== shard) continue;
    for (let run = 0; run < runs; run++) {
      if (n > 0 && n % RECREATE_EVERY === 0) sim = createDuelSim(1);
      const seed = duelSeed(specKey(a), specKey(b), run);
      try {
        const r = runDuel(sim, a, b, seed);
        appendFileSync(out, `${JSON.stringify(r)}\n`);
      } catch (err) {
        appendFileSync(
          out,
          `${JSON.stringify({ a: specKey(a), b: specKey(b), seed, error: String(err) })}\n`,
        );
        sim = createDuelSim(1);
      }
      n++;
    }
  }
}
process.stdout.write(`shard ${shard}: ${n} duels\n`);
