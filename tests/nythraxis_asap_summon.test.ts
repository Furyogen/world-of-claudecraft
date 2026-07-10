import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const HEROIC_ADD_IDS = [
  'nythraxis_heroic_warrior_add',
  'nythraxis_heroic_priest_add',
  'nythraxis_heroic_rogue_add',
];

describe('heroic Nythraxis raises the court ASAP', () => {
  it('summons the heroic adds shortly after engage, without a wardstone stun', () => {
    const sim = new Sim({ seed: 4, playerClass: 'warrior', autoEquip: true, devCommands: true });
    sim.setPlayerLevel(20);
    const pid = sim.playerId;
    // Zone into a claimed HEROIC Nythraxis instance (spawns the boss).
    sim.chat('/dev raid heroic', pid);
    const boss = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'nythraxis_scourge_of_thornpeak',
    ) as Entity | undefined;
    expect(boss).toBeTruthy();
    // Engage the boss so its encounter ticks. No wardstone, no Deathless stun.
    boss!.inCombat = true;
    boss!.aggroTargetId = pid;
    boss!.threat.set(pid, 1000);
    const hasHeroicAdds = () =>
      [...sim.entities.values()].some(
        (e) => e.kind === 'mob' && HEROIC_ADD_IDS.includes(e.templateId),
      );
    expect(hasHeroicAdds()).toBe(false);
    // Tick past the 3s summon channel (well short of any 45s Deathless cycle).
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    expect(hasHeroicAdds()).toBe(true);
  });
});
