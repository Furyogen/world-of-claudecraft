import { describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { talentsFor } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL, type SimEvent } from '../src/sim/types';

// "/talents" emits a self-only `error` event (the same self-reply channel /who
// uses) and returns null, so we collect the text from the next tick's events.
function readout(sim: Sim, cmd: string): string | undefined {
  sim.tick(); // drain any setup events first
  expect(sim.chat(cmd)).toBeNull(); // readouts are never logged as chat
  const errs = sim
    .tick()
    .filter((e: SimEvent): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
  return errs.at(-1)?.text;
}

describe('/talents readout', () => {
  it('reports not-yet-unlocked below the talent level', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' }); // fresh = level 1
    const text = readout(sim, '/talents');
    expect(text).toBe('You have not unlocked talents yet — they begin at level 10.');
  });

  it('shows spec and rows picked out of rows unlocked', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL); // all 6 rows unlocked at level 20
    const r5 = CHOICE_ROWS.warrior.rows[0].options[0].id;
    expect(sim.applyTalents({ spec: 'arms', rows: { 5: r5 } })).toBe(true);

    const armsName = talentsFor('warrior')!.specs.find((s) => s.id === 'arms')!.name;
    const text = readout(sim, '/talents');
    expect(text).toBe(`Talents: ${armsName}, 1/6 choice rows picked. 5 unspent.`);
  });

  it('reports no specialization when none is chosen', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    const r5 = CHOICE_ROWS.warrior.rows[0].options[1].id;
    expect(sim.applyTalents({ spec: null, rows: { 5: r5 } })).toBe(true);

    const text = readout(sim, '/talents');
    expect(text).toBe('Talents: no specialization, 1/6 choice rows picked. 5 unspent.');
  });

  it('omits the unspent suffix when every row is picked and aliases resolve', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    const rows: Record<number, string> = {};
    for (const row of CHOICE_ROWS.warrior.rows) rows[row.level] = row.options[0].id;
    expect(sim.applyTalents({ spec: null, rows })).toBe(true);

    const text = readout(sim, '/talent'); // alias
    expect(text).toBe('Talents: no specialization, 6/6 choice rows picked.');
    expect(readout(sim, '/spec')).toBe(text); // alias parity
  });
});
