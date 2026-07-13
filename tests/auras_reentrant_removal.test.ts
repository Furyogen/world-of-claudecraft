// Repro for a tick-loop crash the Monte Carlo balance simulator surfaced:
// updateAuras iterates e.auras by index while a DoT tick's dealDamage can end
// the duel via the 1 hp guard, and endDuel's clearAurasFromSource bulk-removes
// the opponent's auras from the SAME array mid-iteration. The next index read
// then lands past the shrunken array and the tick crashes on undefined
// (auras.ts updateAuras). Found by scripts/balance_sim.ts, arms_warrior vs
// retribution_paladin, seed 1355896814.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Aura } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

function opponentDot(sourceId: number, id: string): Aura {
  return {
    id,
    name: id,
    kind: 'dot',
    remaining: 10,
    duration: 10,
    value: 40,
    tickInterval: 1,
    // Fires on the very next tick so the test does not depend on timing.
    tickTimer: 0.05,
    sourceId,
    school: 'shadow',
  } as Aura;
}

describe('updateAuras under reentrant aura removal', () => {
  it('survives the duel 1 hp guard ending the duel from a DoT tick', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Aleph', { autoEquip: true });
    const b = sim.addPlayer('mage', 'Bet', { autoEquip: true });
    teleport(sim, a, 0, -40);
    teleport(sim, b, 4, -40);
    sim.duelRequest(b, a);
    sim.duelAccept(b);
    for (let i = 0; i < 20 * 4; i++) {
      sim.tick();
      if ((sim as any).duels.get(a)?.state === 'active') break;
    }
    expect((sim as any).duels.get(a)?.state).toBe('active');

    const eb = sim.entities.get(b)!;
    // Two opponent DoTs so the bulk clearAurasFromSource strips MORE entries
    // than the index the loop sits at; hp low enough that the first tick fires
    // the 1 hp duel guard and ends the duel mid-iteration.
    (sim as any).applyAura(eb, opponentDot(a, 'test_dot_one'));
    (sim as any).applyAura(eb, opponentDot(a, 'test_dot_two'));
    eb.hp = 5;

    // Before the fix this tick threw: Cannot read properties of undefined
    // (reading 'remaining').
    const events: unknown[] = [];
    expect(() => {
      for (let i = 0; i < 20 * 2; i++) events.push(...sim.tick());
    }).not.toThrow();

    expect((sim as any).duels.has(a)).toBe(false);
    expect(eb.dead).toBe(false);
    expect(eb.hp).toBeGreaterThanOrEqual(1);
    expect(eb.auras.some((x: Aura) => x.sourceId === a)).toBe(false);
    expect(events.some((e) => (e as { type: string }).type === 'duelEnd')).toBe(true);
  });
});
