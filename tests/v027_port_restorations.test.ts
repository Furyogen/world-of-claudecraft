// Pins for the overhaul payload pieces the PR #1757 revert deleted and the
// v027 port initially missed (AUDIT-v027-port-drops-2026-07-17). Each block
// pins one restored behavior so a future merge or revert cannot silently drop
// it again.
import { describe, expect, it } from 'vitest';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { recalcPlayerStats } from '../src/sim/entity';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { directHealBonus } from '../src/sim/spell_scaling';
import { stunDrCategory } from '../src/sim/stun_dr';
import type { Aura } from '../src/sim/types';
import { AVATAR_SCALE, SPELL_AOE_COEFF_MULT } from '../src/sim/types';

describe('rogue starting dual wield (classes.ts startOffhand)', () => {
  it('starts rogues with a rusty dagger in BOTH hands', () => {
    expect(CLASSES.rogue.startWeapon).toBe('rusty_dagger');
    expect(CLASSES.rogue.startOffhand).toBe('rusty_dagger');
  });

  it('equips the starting offhand on a fresh rogue character', () => {
    const sim = new Sim({ seed: 1234, playerClass: 'rogue' });
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing player metadata');
    expect(meta.equipment.offhand).toBe('rusty_dagger');
  });
});

describe('Vanguard armor from Strength (entity.ts armorFromStrPct fold)', () => {
  it('adds round(str * pct) armor, amplified by armorPct', () => {
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing player metadata');

    const base = emptyModifiers();
    recalcPlayerStats(p, 'warrior', meta.equipment, base, meta.equipmentInstance);
    const armorWithout = p.stats.armor;
    const str = p.stats.str;

    const mods = emptyModifiers();
    mods.stats.armorFromStrPct = 0.7;
    recalcPlayerStats(p, 'warrior', meta.equipment, mods, meta.equipmentInstance);
    expect(p.stats.armor).toBe(armorWithout + Math.round(str * 0.7));

    // The fold lands BEFORE the armorPct multiplier so armorPct amplifies it.
    const both = emptyModifiers();
    both.stats.armorFromStrPct = 0.7;
    both.stats.armorPct = 0.1;
    recalcPlayerStats(p, 'warrior', meta.equipment, both, meta.equipmentInstance);
    expect(p.stats.armor).toBe(Math.round((armorWithout + Math.round(str * 0.7)) * 1.1));
  });
});

describe('AoE heal coefficient penalty (spell_scaling directHealBonus aoe)', () => {
  it('applies SPELL_AOE_COEFF_MULT to the per-target bonus when aoe', () => {
    const single = directHealBonus(300, 2);
    const aoe = directHealBonus(300, 2, true);
    expect(single).toBeGreaterThan(0);
    expect(aoe).toBe(Math.round(single * SPELL_AOE_COEFF_MULT));
    // The default stays the single-target coefficient.
    expect(directHealBonus(300, 2, false)).toBe(single);
  });
});

describe('Faultline stun diminishing returns (stun_dr CONTROLLED_STUNS)', () => {
  it('classifies faultline as a controlled stun, not a random stun', () => {
    expect(stunDrCategory('faultline')).toBe('controlledStun');
  });
});

describe('Avatar colossus body scale (entity.ts buff_avatar)', () => {
  it('grows the player model by AVATAR_SCALE while the aura is worn', () => {
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing player metadata');
    const avatar: Aura = {
      id: 'avatar',
      name: 'Avatar',
      kind: 'buff_avatar',
      remaining: 20,
      duration: 20,
      value: 0.2,
      sourceId: p.id,
      school: 'physical',
    };
    p.auras.push(avatar);
    recalcPlayerStats(p, 'warrior', meta.equipment, emptyModifiers(), meta.equipmentInstance);
    expect(AVATAR_SCALE).toBeGreaterThan(1);
    expect(p.scale).toBe(AVATAR_SCALE);
    p.auras.length = 0;
    recalcPlayerStats(p, 'warrior', meta.equipment, emptyModifiers(), meta.equipmentInstance);
    expect(p.scale).toBe(1);
  });
});

describe('selfHotPctMax effect (effect_dispatch)', () => {
  it('applies a self hot aura totaling pct of max health across its ticks', () => {
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing player metadata');
    const def = {
      ...ABILITIES.slam,
      id: 'test_self_hot',
      name: 'Test Self Hot',
      effects: [{ type: 'selfHotPctMax', pct: 0.3, duration: 8, interval: 2 }],
    } as (typeof ABILITIES)[string];
    const resolved: ResolvedAbility = {
      def,
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: 0,
      effects: def.effects,
      threatFlat: 0,
      threatMult: 1,
    };
    sim.ctx.runEffects(p, meta, null, resolved);
    const hot = p.auras.find((a) => a.id === 'test_self_hot');
    if (!hot) throw new Error('selfHotPctMax applied no aura');
    expect(hot.kind).toBe('hot');
    expect(hot.tickInterval).toBe(2);
    // 4 ticks over 8s at 2s interval, each healing maxHp * 0.3 / 4.
    expect(hot.value).toBe(Math.max(1, Math.round((p.maxHp * 0.3) / 4)));
  });
});

describe('offhand surfacing (paperdoll, player card, chat readout)', () => {
  it('shows the offhand cell on the character sheet paperdoll', async () => {
    const { PAPERDOLL_RIGHT_SLOTS } = await import('../src/ui/char_view');
    expect(PAPERDOLL_RIGHT_SLOTS).toContain('offhand');
  });

  it('lists the offhand in the chat gear readout', async () => {
    const { gearReadout } = await import('../src/sim/social/chat_readouts');
    const sim = new Sim({ seed: 1234, playerClass: 'rogue' });
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing player metadata');
    expect(gearReadout(meta)).toContain('Off Hand: Rusty Dagger');
  });

  it('recognizes battle and berserker stances in the form readout', async () => {
    const { formReadout } = await import('../src/sim/social/chat_readouts');
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    for (const kind of ['battle_stance', 'berserker_stance'] as const) {
      p.auras.length = 0;
      p.auras.push({
        id: kind,
        name: kind === 'battle_stance' ? 'Battle Stance' : 'Berserker Stance',
        kind,
        remaining: 3600,
        duration: 3600,
        value: 0,
        sourceId: p.id,
        school: 'physical',
      });
      expect(formReadout(p)).toContain(
        kind === 'battle_stance' ? 'Battle Stance' : 'Berserker Stance',
      );
    }
    p.auras.length = 0;
    expect(formReadout(p)).toBe('You are not in any form or stance.');
  });
});
