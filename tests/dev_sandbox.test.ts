// /dev sandbox: a dev-command practice scenario (ALLOW_DEV_COMMANDS). Verifies the
// command is dev-gated and sets up a non-offensive training dummy plus a raid of
// friendly level-20 bots at reduced health with out-of-combat regen frozen, so a
// tester can practice abilities threat-free. The freeze and the roomy pool both go
// through mechanisms the sim respects (a devFreezeRegen flag, not a fake `eating`
// payload; a Stamina aura, not a raw maxHp write), so damage and recalc do not
// silently undo them; those two robustness properties are pinned below.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function devPlayer(devCommands: boolean) {
  const sim = new Sim({ seed: 41, playerClass: 'priest', autoEquip: true, devCommands });
  sim.setPlayerLevel(20);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

// The world already owns a stationary training dummy (zone3), so the sandbox dummy
// is identified as the training_dummy that did NOT exist before /dev sandbox ran.
function dummyIds(sim: Sim): Set<number> {
  return new Set(
    [...sim.entities.values()]
      .filter((e) => e.kind === 'mob' && e.templateId === 'training_dummy')
      .map((e) => e.id),
  );
}

function newDummy(sim: Sim, before: Set<number>): Entity | undefined {
  return [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'training_dummy' && !before.has(e.id),
  );
}

function sandboxBots(sim: Sim, casterPid: number): Entity[] {
  const party = sim.partyInfo;
  if (!party) return [];
  return party.members
    .filter((m) => m.pid !== casterPid)
    .map((m) => sim.entities.get(m.pid))
    .filter((e): e is Entity => !!e);
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
    const before = dummyIds(sim);
    sim.chat('/dev sandbox', p.id);

    // A hostile training dummy that never chases: moveSpeed 0 (so it cannot move)
    // and, standing right next to it, it never aggros onto or reaches the tester.
    const dummy = newDummy(sim, before);
    expect(dummy).toBeTruthy();
    expect(dummy?.hostile).toBe(true);
    expect(dummy?.moveSpeed).toBe(0);
    const dummyPos = { ...dummy!.pos };
    for (let i = 0; i < 40; i++) sim.tick(); // 2s adjacent to the tester
    expect(dummy!.aggroTargetId ?? null).toBeNull();
    expect(dummy!.pos).toEqual(dummyPos); // it stayed put (never chased)

    // The caller now leads a raid of friendly practice bots.
    const party = sim.partyInfo!;
    expect(party.raid).toBe(true);
    expect(party.members.length).toBeGreaterThanOrEqual(5); // caller + bots

    const bots = sandboxBots(sim, p.id);
    expect(bots.length).toBeGreaterThanOrEqual(4);
    for (const e of bots) {
      expect(e.level).toBe(20); // a full pool, not a level-1 sliver
      // A roomy ~10k pool (aura-driven, not a raw write) started low, so you can
      // heal for a good while and watch the bar climb.
      expect(e.maxHp).toBeGreaterThanOrEqual(10_000);
      expect(e.maxHp).toBeLessThanOrEqual(10_020);
      expect(e.hp).toBeLessThan(e.maxHp / 2); // clearly hurt, lots of room to heal
      expect(e.devFreezeRegen).toBe(true); // regen frozen: only your abilities heal it
      // Names are suffixed with the caster pid so two testers never collide.
      expect(e.name.endsWith(`-${p.id}`)).toBe(true);
    }
  });

  it('the frozen pool survives a stat recalc (aura, not a raw maxHp write)', () => {
    const { sim, p } = devPlayer(true);
    sim.chat('/dev sandbox', p.id);
    const bot = sandboxBots(sim, p.id)[0];
    expect(bot.maxHp).toBeGreaterThanOrEqual(10_000);
    // Force a full stat recalc. A raw `maxHp = 10000` write would collapse back to
    // the level-based base here; the Stamina aura is rebuilt by recalc, so it holds.
    sim.setPlayerLevel(21, bot.id);
    expect(bot.maxHp).toBeGreaterThan(9_500);
  });

  it('regen stays frozen even after damage (flag is not cleared like `eating`)', () => {
    const { sim, p } = devPlayer(true);
    const before = dummyIds(sim);
    sim.chat('/dev sandbox', p.id);
    const dummy = newDummy(sim, before)!;
    const bot = sandboxBots(sim, p.id)[0];
    // Pin the old failure mode: damage DOES clear a consumable payload. Give the bot
    // one and confirm the hit wipes it, while devFreezeRegen (the real freeze) does not.
    bot.eating = { itemId: 'x', kind: 'food', hpPer2s: 5, manaPer2s: 0, remaining: 1000 };
    const hurt = bot.hp;
    (
      sim as unknown as {
        dealDamage: (
          s: Entity,
          t: Entity,
          a: number,
          c: boolean,
          sc: string,
          ab: string | null,
          k: string,
        ) => void;
      }
    ).dealDamage(dummy, bot, 100, false, 'physical', null, 'hit');
    expect(bot.eating).toBeNull(); // the hit cleared the consumable (old freeze would lift)
    expect(bot.devFreezeRegen).toBe(true); // the real freeze survives the hit
    expect(bot.hp).toBeLessThan(hurt); // it actually took the damage
    // Drop out of combat and idle: with the flag intact, regen never creeps in.
    bot.inCombat = false;
    const hp0 = bot.hp;
    for (let i = 0; i < 200; i++) sim.tick(); // 10s idle
    expect(bot.hp).toBe(hp0);
  });

  it('the bots do not self-heal while idle (regen stays frozen)', () => {
    const { sim, p } = devPlayer(true);
    sim.chat('/dev sandbox', p.id);
    const bot = sandboxBots(sim, p.id)[0];
    const hp0 = bot.hp;
    for (let i = 0; i < 200; i++) sim.tick(); // 10s idle
    expect(bot.hp).toBe(hp0); // no out-of-combat regen crept in
  });

  it('re-running resets the scenario (fresh bots, hurt again) instead of piling on', () => {
    const { sim, p } = devPlayer(true);
    sim.chat('/dev sandbox', p.id);
    const afterFirst = sim.entities.size;
    const firstBots = sandboxBots(sim, p.id).map((e) => e.id);
    // Heal a bot to full, so a real reset must knock it back down.
    const healed = sim.entities.get(firstBots[0])!;
    healed.hp = healed.maxHp;

    sim.chat('/dev sandbox', p.id); // reset

    // Same total (previous dummy + bots cleared before the fresh spawn, no accumulation).
    expect(sim.entities.size).toBe(afterFirst);
    // The old bots are gone, replaced by fresh ones.
    for (const id of firstBots) expect(sim.entities.has(id)).toBe(false);
    const freshBots = sandboxBots(sim, p.id);
    expect(freshBots.length).toBeGreaterThanOrEqual(4);
    // The fresh allies start hurt again (the healed one did not carry over).
    for (const e of freshBots) expect(e.hp).toBeLessThan(e.maxHp / 2);
  });

  it("despawns a leaving tester's sandbox (no orphaned bots or dummy)", () => {
    const { sim, p } = devPlayer(true);
    const before = dummyIds(sim);
    sim.chat('/dev sandbox', p.id);
    const spawned = [newDummy(sim, before)!.id, ...sandboxBots(sim, p.id).map((e) => e.id)];
    expect(spawned.length).toBeGreaterThanOrEqual(5);
    sim.removePlayer(p.id);
    for (const id of spawned) expect(sim.entities.has(id)).toBe(false);
  });

  it('bails instead of hijacking a real group the tester is already in', () => {
    const { sim, p } = devPlayer(true);
    // Form a real party first (a dev bot buddy the tester grouped with).
    const buddy = sim.spawnDevBot('Buddy');
    sim.partyInvite(buddy, p.id);
    sim.partyAccept(buddy);
    expect(sim.partyInfo!.members.length).toBe(2);

    const before = dummyIds(sim);
    sim.chat('/dev sandbox', p.id);

    // No sandbox spawned, and the real party is untouched (not converted to a raid,
    // no bots injected).
    expect(newDummy(sim, before)).toBeUndefined();
    expect(sim.partyInfo!.raid).toBe(false);
    expect(sim.partyInfo!.members.length).toBe(2);
  });
});
