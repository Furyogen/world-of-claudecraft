import { describe, expect, it } from 'vitest';
import { buildClientAbilityPresentation } from '../src/net/ability_presentation';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { MOUNT_SPELL_ID } from '../src/sim/content/mount_spell';
import type { MountKey } from '../src/sim/content/mounts';
import { emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { mountSpellMountKey } from '../src/sim/mount_spell';
import { grantRidingSkill, MOUNT_SUMMON_SECONDS, updateMountTransition } from '../src/sim/mounts';
import { Sim } from '../src/sim/sim';
import {
  clearFiestaAugments,
  fiestaRestoreChar,
  fiestaStandardize,
} from '../src/sim/social/fiesta';
import { DT, FISHING_CAST_ID, type SimEvent } from '../src/sim/types';
import { loadoutKnownAbilityIds } from '../src/ui/hud/action_bar/hotbar';
import { VENDOR_TEST_WORLD } from './sim_shared';

// Summon Mount: the riding skill's spell. Known only once Riding is learned,
// and a press is exactly a reins click on the fastest owned mount.

function makeWorld(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world: VENDOR_TEST_WORLD });
}

function join(sim: Sim, trained = true): number {
  const pid = sim.addPlayer('warrior', 'Rider');
  sim.tick();
  sim.setPlayerLevel(20, pid);
  const meta = sim.players.get(pid);
  if (meta && trained) grantRidingSkill(sim.ctx, meta, false);
  return pid;
}

function knowsSpell(sim: Sim, pid: number): boolean {
  return sim.players.get(pid)?.known.some((k) => k.def.id === MOUNT_SPELL_ID) ?? false;
}

function finishSummon(sim: Sim, pid: number): void {
  const e = sim.entities.get(pid)!;
  const steps = Math.ceil(MOUNT_SUMMON_SECONDS / DT) + 2;
  for (let i = 0; i < steps && (e.mountCastRemaining ?? 0) > 0; i++) {
    updateMountTransition(sim.ctx, e, false);
  }
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

const reins = (...keys: string[]) => keys.map((key) => ({ itemId: `reins_${key}` }));
const none = () => [] as MountKey[];

describe('mountSpellMountKey', () => {
  it('defaults to the Valorsteed whenever it is owned, even beside faster mounts', () => {
    expect(mountSpellMountKey(reins('grag_bear', 'valorsteed', 'aether_hover_cycle'), none)).toBe(
      'valorsteed',
    );
  });

  it('defaults to a BANKED Valorsteed over faster mounts in the bags', () => {
    const owned = (): MountKey[] => ['valorsteed', 'grag_bear'];
    expect(mountSpellMountKey(reins('grag_bear'), owned)).toBe('valorsteed');
  });

  it('without a Valorsteed, picks the fastest mount whose reins are in the bags', () => {
    const owned = (): MountKey[] => ['stormfeather_griffin', 'grag_bear', 'aether_hover_cycle'];
    expect(mountSpellMountKey(reins('stormfeather_griffin', 'grag_bear'), owned)).toBe('grag_bear');
  });

  it('keeps the earlier catalog mount on a speed tie, whatever the bag order', () => {
    // Both run at 0.7: the catalog order decides, not the slot order.
    expect(mountSpellMountKey(reins('shadowjump_toad', 'stormfeather_griffin'), none)).toBe(
      'stormfeather_griffin',
    );
  });

  it('falls back to the fastest banked mount only when the bags hold none', () => {
    const owned = (): MountKey[] => ['stormfeather_griffin', 'grag_bear'];
    expect(mountSpellMountKey([{ itemId: 'rough_stone' }], owned)).toBe('grag_bear');
  });

  it('is null when nothing is owned, and ignores non-mount bag items', () => {
    expect(mountSpellMountKey([{ itemId: 'rough_stone' }], none)).toBeNull();
  });
});

describe('Summon Mount is taught by the riding skill', () => {
  it('is a class-neutral ability record', () => {
    const def = ABILITIES[MOUNT_SPELL_ID];
    expect(def.class).toBe('general');
    expect(def.offGcd).toBe(true);
    expect(def.effects).toEqual([]);
  });

  it('joins the known list only when riding is trained, after the class kit', () => {
    const without = abilitiesKnownAt('warrior', 20).map((k) => k.def.id);
    const withRiding = abilitiesKnownAt('warrior', 20, undefined, undefined, true).map(
      (k) => k.def.id,
    );
    expect(without).not.toContain(MOUNT_SPELL_ID);
    // Appended LAST so the class kit's RL action slots never shift.
    expect(withRiding).toEqual([...without, MOUNT_SPELL_ID]);
  });

  it('is unknown to an untrained rider and learned (and announced) with Riding', () => {
    const sim = makeWorld();
    const pid = join(sim, false);
    expect(knowsSpell(sim, pid)).toBe(false);
    grantRidingSkill(sim.ctx, sim.players.get(pid)!, true);
    expect(knowsSpell(sim, pid)).toBe(true);
    const events = sim.tick();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'learnAbility', abilityId: MOUNT_SPELL_ID, pid }),
    );
  });

  it('is taught by the /dev mounts riding grant, the real writer, with the announce', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: VENDOR_TEST_WORLD,
      devCommands: true,
    });
    const pid = sim.addPlayer('warrior', 'Rider');
    sim.tick();
    sim.chat('/dev mounts', pid);
    expect(knowsSpell(sim, pid)).toBe(true);
    expect(sim.tick()).toContainEqual(
      expect.objectContaining({ type: 'learnAbility', abilityId: MOUNT_SPELL_ID, pid }),
    );
  });

  it('survives a Fiesta bout: standardize, clear and restore all keep it', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    const e = sim.entities.get(pid)!;
    fiestaStandardize(sim.ctx, meta, e);
    expect(knowsSpell(sim, pid)).toBe(true);
    clearFiestaAugments(meta, e);
    fiestaRestoreChar(meta, e);
    expect(knowsSpell(sim, pid)).toBe(true);
  });

  it('survives a character save and reload', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const saved = sim.serializeCharacter(pid)!;
    const alt = sim.addPlayer('warrior', 'Reloaded', { state: saved });
    expect(knowsSpell(sim, alt)).toBe(true);
  });

  it('teaches the client mirror the same list (ClientWorld presentation)', () => {
    const current = {
      talents: emptyAllocation(),
      loadouts: [],
      activeLoadout: 0,
      equipment: {},
      questsDone: new Set<string>(),
      ridingTrained: () => true,
    };
    const trained = buildClientAbilityPresentation('mage', 20, current, null, []);
    expect(trained.known.at(-1)?.def.id).toBe(MOUNT_SPELL_ID);
    const untrained = buildClientAbilityPresentation(
      'mage',
      20,
      { ...current, ridingTrained: () => false },
      null,
      [],
    );
    expect(untrained.known.some((k) => k.def.id === MOUNT_SPELL_ID)).toBe(false);
  });

  it('stays on the bar across a talent loadout switch for a trained rider only', () => {
    const alloc = { ...emptyAllocation(), spec: 'arms' };
    expect(loadoutKnownAbilityIds('warrior', alloc, 20, true).has(MOUNT_SPELL_ID)).toBe(true);
    expect(loadoutKnownAbilityIds('warrior', alloc, 20).has(MOUNT_SPELL_ID)).toBe(false);
  });
});

describe('casting Summon Mount', () => {
  it('summons the Valorsteed by default through the reins channel, with no GCD', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('reins_valorsteed', 1, pid);
    sim.addItem('reins_grag_bear', 1, pid);
    const e = sim.entities.get(pid)!;
    sim.castAbility(MOUNT_SPELL_ID, pid);
    expect(e.mountCastKey).toBe('valorsteed');
    expect(e.mountCastRemaining).toBeCloseTo(MOUNT_SUMMON_SECONDS);
    expect(e.gcdRemaining).toBe(0);
    finishSummon(sim, pid);
    expect(e.mountKey).toBe('valorsteed');
  });

  it('summons a banked Valorsteed too (banked reins still own the mount)', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('reins_grag_bear', 1, pid);
    sim.players.get(pid)!.bank.inventory.push({ itemId: 'reins_valorsteed', count: 1 });
    sim.castAbility(MOUNT_SPELL_ID, pid);
    expect(sim.entities.get(pid)!.mountCastKey).toBe('valorsteed');
  });

  it('without a Valorsteed, summons the fastest mount in the bags', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('reins_stormfeather_griffin', 1, pid);
    sim.addItem('reins_grag_bear', 1, pid);
    sim.castAbility(MOUNT_SPELL_ID, pid);
    expect(sim.entities.get(pid)!.mountCastKey).toBe('grag_bear');
  });

  it('falls back to banked reins when the bags hold none', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.players.get(pid)!.bank.inventory.push({ itemId: 'reins_grag_bear', count: 1 });
    sim.castAbility(MOUNT_SPELL_ID, pid);
    expect(sim.entities.get(pid)!.mountCastKey).toBe('grag_bear');
  });

  it('keeps the worn mount skin: the look is cosmetic over the summoned mount', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('reins_valorsteed', 1, pid);
    sim.setMountSkin(pid, 'rickshaw_mount');
    sim.castAbility(MOUNT_SPELL_ID, pid);
    finishSummon(sim, pid);
    const e = sim.entities.get(pid)!;
    expect(e.mountKey).toBe('valorsteed');
    expect(e.mountSkinId).toBe('rickshaw_mount');
  });

  it('dismounts when pressed while riding', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('reins_valorsteed', 1, pid);
    sim.castAbility(MOUNT_SPELL_ID, pid);
    finishSummon(sim, pid);
    const e = sim.entities.get(pid)!;
    expect(e.mountKey).toBe('valorsteed');
    sim.castAbility(MOUNT_SPELL_ID, pid);
    expect(e.mountKey).toBe('');
    expect(e.mountCastKey).toBe('');
  });

  it('says so when no mount is owned', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.castAbility(MOUNT_SPELL_ID, pid);
    expect(errorTexts(sim.tick())).toContain("You don't have a mount yet.");
    expect(sim.entities.get(pid)!.mountCastKey).toBe('');
  });

  it('refuses in combat with the reins wording', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('reins_valorsteed', 1, pid);
    sim.entities.get(pid)!.inCombat = true;
    sim.castAbility(MOUNT_SPELL_ID, pid);
    expect(errorTexts(sim.tick())).toContain("You can't do that while in combat.");
    expect(sim.entities.get(pid)!.mountCastKey).toBe('');
  });

  it('is refused mid fishing cast, like the reins (useItem busy gate)', () => {
    const sim = makeWorld();
    const pid = join(sim);
    sim.addItem('reins_valorsteed', 1, pid);
    sim.entities.get(pid)!.castingAbility = FISHING_CAST_ID;
    sim.castAbility(MOUNT_SPELL_ID, pid);
    expect(errorTexts(sim.tick())).toContain('You are busy.');
    expect(sim.entities.get(pid)!.mountCastKey).toBe('');
  });

  it('counts as deliberate activity (resets the AFK clock) like any cast attempt', () => {
    const sim = makeWorld();
    const pid = join(sim);
    const meta = sim.players.get(pid)!;
    meta.lastActiveTick = -1;
    sim.castAbility(MOUNT_SPELL_ID, pid);
    expect(meta.lastActiveTick).toBe(sim.tickCount);
  });

  it('is refused to a rider who has not learned Riding', () => {
    const sim = makeWorld();
    const pid = join(sim, false);
    sim.addItem('reins_valorsteed', 1, pid);
    sim.castAbility(MOUNT_SPELL_ID, pid);
    expect(errorTexts(sim.tick())).toContain('You do not know that ability.');
    expect(sim.entities.get(pid)!.mountCastKey).toBe('');
  });
});
