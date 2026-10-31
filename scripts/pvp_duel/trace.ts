// Replay one duel with a readable timeline: every hit between the two
// duelists, every refusal the engine voiced, and a state line at an interval.
//   npx tsx scripts/pvp_duel/trace.ts <specA> <specB> [seed] [everyTicks]
//   e.g. npx tsx scripts/pvp_duel/trace.ts shaman/elemental mage/fire 42 20
// The seed reproduces a matrix duel exactly (worker.ts duelSeed).

import { BUILDS } from './builds';
import { runDuel, specKey } from './duel';
import { createDuelSim } from './setup';

const [a, b, seedS, everyS] = process.argv.slice(2);
const find = (k: string) => {
  const build = BUILDS.find((x) => specKey(x) === k);
  if (!build) throw new Error(`unknown spec ${k}; one of: ${BUILDS.map(specKey).join(', ')}`);
  return build;
};
const every = Number(everyS ?? 20);
const sim = createDuelSim(1);
type Ev = { type: string; [k: string]: unknown };
const state = (e: {
  hp: number;
  maxHp: number;
  resource: number;
  castingAbility: string | null;
  auras: { id: string; remaining: number }[];
}) =>
  `hp ${e.hp}/${e.maxHp} res ${Math.round(e.resource)} cast ${e.castingAbility ?? '-'} auras ${e.auras.map((x) => `${x.id}(${x.remaining.toFixed(1)})`).join(' ')}`;
const result = runDuel(sim, find(a), find(b), Number(seedS ?? 1), (t, ea, eb, events) => {
  for (const ev of events as unknown as Ev[]) {
    if (ev.type === 'damage' && (ev.targetId === ea.id || ev.targetId === eb.id)) {
      const who = ev.targetId === ea.id ? 'A' : 'B';
      console.log(
        `${t.toFixed(2)} hit ${who} ${ev.ability ?? 'melee'} ${ev.amount} ${ev.kind}${ev.absorbed ? ` absorbed ${ev.absorbed}` : ''}`,
      );
    } else if (ev.type === 'error' && (ev.pid === ea.id || ev.pid === eb.id)) {
      console.log(`${t.toFixed(2)} refused ${ev.pid === ea.id ? 'A' : 'B'} ${ev.text}`);
    }
  }
  if (Math.round(t * 20) % every === 0) {
    const d = Math.hypot(ea.pos.x - eb.pos.x, ea.pos.z - eb.pos.z);
    console.log(`${t.toFixed(1)} dist ${d.toFixed(1)}\n  A ${state(ea)}\n  B ${state(eb)}`);
  }
});
console.log(JSON.stringify(result, null, 1));
