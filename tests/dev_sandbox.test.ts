// /dev sandbox: a dev-command practice scenario (ALLOW_DEV_COMMANDS). Verifies the
// command is dev-gated and sets up a non-offensive training dummy plus a raid of
// friendly level-20 bots at reduced health with out-of-combat regen frozen, so a
// tester can practice abilities threat-free.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function devPlayer(devCommands: boolean) {
  const sim = new Sim({ seed: 41, playerClass: 'priest', autoEquip: true, devCommands });
  sim.setPlayerLevel(20);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

describe('/dev sandbox', () => {
  it('is a no-op without dev commands', () => {
    const { sim, p } = devPlayer(false);
    const before = sim.entities.size;
    sim.chat('/dev sandbox', p.id);
    expect(sim.entities.size).toBe(before);
  });

  it('spawns a non-offensive dummy plus a raid of frozen, reduced-health bots', () => {
    const { sim, p } = devPlayer(true);
    sim.chat('/dev sandbox', p.id);

    // A hostile training dummy (aggroRadius 0 / moveSpeed 0 => it never chases).
    const dummy = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'training_dummy',
    );
    expect(dummy).toBeTruthy();
    expect(dummy?.hostile).toBe(true);

    // The caller now leads a raid of friendly practice bots.
    const party = sim.partyInfo!;
    expect(party.raid).toBe(true);
    expect(party.members.length).toBeGreaterThanOrEqual(5); // caller + bots

    for (const m of party.members) {
      if (m.pid === p.id) continue;
      const e = sim.entities.get(m.pid)!;
      expect(e.level).toBe(20); // a full pool, not a level-1 sliver
      // A roomy 10k pool started low, so you can heal for a good while and watch the
      // bar climb.
      expect(e.maxHp).toBe(10_000);
      expect(e.hp).toBeLessThan(e.maxHp / 2); // clearly hurt, lots of room to heal
      expect(e.eating?.hpPer2s).toBe(0); // regen frozen: only your abilities heal it
    }
  });

  it('re-running resets the scenario instead of piling on more bots', () => {
    const { sim, p } = devPlayer(true);
    sim.chat('/dev sandbox', p.id);
    const afterFirst = sim.entities.size;
    sim.chat('/dev sandbox', p.id); // reset
    // Same total: the previous dummy + bots were cleared before the fresh spawn (no
    // accumulation), and the raid still holds the fresh bots.
    expect(sim.entities.size).toBe(afterFirst);
    expect(sim.partyInfo!.members.length).toBeGreaterThanOrEqual(5);
  });

  it('the bots do not self-heal while idle (regen stays frozen)', () => {
    const { sim, p } = devPlayer(true);
    sim.chat('/dev sandbox', p.id);
    const botId = sim.partyInfo!.members.find((m) => m.pid !== p.id)!.pid;
    const bot = sim.entities.get(botId)!;
    const hp0 = bot.hp;
    for (let i = 0; i < 200; i++) sim.tick() as SimEvent[]; // 10s idle
    expect(bot.hp).toBe(hp0); // no out-of-combat regen crept in
  });
});
