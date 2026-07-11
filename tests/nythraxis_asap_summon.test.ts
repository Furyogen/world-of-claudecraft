import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const HEROIC_ADD_IDS = [
  'nythraxis_heroic_warrior_add',
  'nythraxis_heroic_priest_add',
  'nythraxis_heroic_rogue_add',
];

describe('heroic Nythraxis raises his court on the phase-2 pillar cast', () => {
  it('summons the heroic adds right after an uninterrupted Deathless Rage, not on engage', () => {
    const sim = new Sim({ seed: 4, playerClass: 'warrior', autoEquip: true, devCommands: true });
    sim.setPlayerLevel(20);
    const pid = sim.playerId;
    sim.chat('/dev raid heroic', pid);
    sim.chat('/dev god', pid); // survive the Deathless Rage nuke so the encounter runs on
    const boss = [...sim.entities.values()].find(
      (e) => e.kind === 'mob' && e.templateId === 'nythraxis_scourge_of_thornpeak',
    ) as Entity | undefined;
    expect(boss).toBeTruthy();
    boss!.inCombat = true;
    boss!.aggroTargetId = pid;
    boss!.threat.set(pid, 1000);
    // One tick to spin up the encounter state.
    sim.tick();
    const st = boss!.nythraxis!;
    expect(st).toBeTruthy();

    const hasHeroicAdds = () =>
      [...sim.entities.values()].some(
        (e) => e.kind === 'mob' && HEROIC_ADD_IDS.includes(e.templateId),
      );
    // No court on engage (phase 1).
    expect(hasHeroicAdds()).toBe(false);

    // Force phase 2 with an imminent, uncontested Deathless Rage (the pillar cast).
    st.phase = 2;
    st.deathlessTimer = 0;
    st.soulRendTimer = 100;
    st.soulRendMarks = [];
    st.soulRendLockout = 0;
    st.heroicSummonStarted = false;
    // The 10s cast completes uninterrupted (no wardstones solo), then the 3s summon
    // channel raises the court.
    for (let i = 0; i < 20 * 16; i++) sim.tick();
    expect(hasHeroicAdds()).toBe(true);
  });
});
