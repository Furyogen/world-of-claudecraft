// Systematic spell-balance framework (analytical layer). For every caster class
// and damaging spell, at a reference level-20 character, it prints the metrics a
// designer needs to compare spells objectively:
//   - spamDPS: damage per second if you spam ONLY this spell (cast time + cooldown
//     + GCD + crit + Spell Power, with any rider DoT kept up). The single most
//     useful "is this spell pulling its weight" number.
//   - dpsPerMana: damage per mana spent (sustain / efficiency), priced at the RANK
//     the reference character knows.
//   - effCast: the effective time the spell occupies (max(castTime, GCD), or the
//     cooldown if longer than the cast for a CD-gated nuke).
// It then flags spells whose spamDPS deviates from their class median by > THRESH.
//
// The metric math itself lives in scripts/lib/balance_metrics.mjs so it is unit
// tested directly (tests/balance_metrics.test.ts); this file is the thin CLI that
// builds a reference character and formats the table.
//
// Run: npx tsx scripts/balance_report.mjs   (no server needed)

import { abilitiesKnownAt } from '../src/sim/content/classes.ts';
import { Sim } from '../src/sim/sim.ts';
import { channelTickBonus, directHitBonus, dotTickBonus } from '../src/sim/spell_scaling.ts';
import { GCD, MAX_LEVEL } from '../src/sim/types.ts';
import { analyzeAbility, DAMAGE_EFFECTS, deviation, medianOf } from './lib/balance_metrics.mjs';

const THRESH = 0.25; // flag spells > 25% off the class median spamDPS
const SCALING = { directHitBonus, channelTickBonus, dotTickBonus };

function refChar(cls) {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer(cls, 'Ref');
  sim.setPlayerLevel(MAX_LEVEL, pid);
  sim.tick();
  return sim.entities.get(pid);
}

const CASTERS = ['mage', 'warlock', 'priest', 'shaman', 'druid', 'paladin'];

for (const cls of CASTERS) {
  const p = refChar(cls);
  const ctx = {
    spellPower: p.spellPower,
    rangedPower: p.rangedPower,
    int: p.stats.int,
    gcd: GCD,
    scaling: SCALING,
  };

  const rows = [];
  for (const k of abilitiesKnownAt(cls, MAX_LEVEL)) {
    if (cls !== k.def.class) continue;
    if (!k.effects.some((e) => DAMAGE_EFFECTS.has(e.type))) continue;
    if (k.def.school === 'physical') continue; // caster spell focus
    rows.push({ id: k.def.id, ...analyzeAbility(k, ctx) });
  }
  if (!rows.length) continue;

  rows.sort((a, b) => b.spamDPS - a.spamDPS);
  const median = medianOf(rows.map((r) => r.spamDPS));
  console.log(
    `\n=== ${cls.toUpperCase()}  (SP ${p.spellPower}, int ${p.stats.int}, median spamDPS ${median.toFixed(1)}) ===`,
  );
  for (const r of rows) {
    const dev = deviation(r.spamDPS, median);
    const flag = Math.abs(dev) > THRESH ? (dev < 0 ? '  <-- WEAK' : '  <-- strong') : '';
    console.log(
      `  ${r.id.padEnd(18)} spamDPS ${r.spamDPS.toFixed(1).padStart(6)}  ` +
        `effCast ${r.effCast.toFixed(1)}s  dps/mana ${(r.dpsPerMana === Infinity ? 'inf' : r.dpsPerMana.toFixed(2)).padStart(6)}` +
        `  (${(dev * 100).toFixed(0)}%)${flag}`,
    );
  }
}
