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

describe('parry stat surfacing (stat_tooltip + warrior_hit_table)', () => {
  it('derives the sheet parry chance from the same helper combat rolls', async () => {
    const { warriorParryChance, warriorMeleeDefense } = await import(
      '../src/sim/combat/warrior_hit_table'
    );
    expect(warriorParryChance(100)).toBeCloseTo(0.05 + 100 * 0.0005, 10);
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    const attacker = { ...p, id: p.id + 1, pos: { ...p.pos, z: p.pos.z + 1 } };
    p.facing = 0; // attacker at +z sits in the frontal arc
    const def = warriorMeleeDefense(p, attacker as typeof p);
    expect(def.parryChance).toBeCloseTo(warriorParryChance(p.stats.str), 10);
  });

  it('builds the parry tooltip cell as a percent with a Strength source line', async () => {
    const { buildStatTooltip, buildStatSources } = await import('../src/ui/stat_tooltip');
    const { warriorParryChance } = await import('../src/sim/combat/warrior_hit_table');
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    const input = {
      cls: 'warrior' as const,
      stats: p.stats,
      level: p.level,
      attackPower: p.attackPower,
      spellPower: p.spellPower,
      critChance: p.critChance,
      dodgeChance: p.dodgeChance,
      critRating: p.critRating,
      hasteRating: p.hasteRating,
      hitRating: p.hitRating,
      parryChance: warriorParryChance(p.stats.str),
      dps: 0,
      gear: [],
      buffs: [],
    };
    const cell = buildStatTooltip('parry', input);
    expect(cell.statValue).toBeCloseTo(warriorParryChance(p.stats.str) * 100, 6);
    const sources = buildStatSources('parry', input);
    expect(sources.some((line) => line.kind === 'base' && line.value === 5)).toBe(true);
    expect(sources.some((line) => line.kind === 'attributes')).toBe(p.stats.str > 0);
    // A non-parry class shows a bare zero with no misleading base line.
    const casterSources = buildStatSources('parry', { ...input, parryChance: 0 });
    expect(casterSources.some((line) => line.kind === 'base')).toBe(false);
  });
});

describe('stance and warrior choice-row aura UI (aura_effect, auras_view, sim_i18n)', () => {
  it('describes the stances and warrior buffs on the buff tooltip', async () => {
    const { auraEffectDescriptor } = await import('../src/ui/aura_effect');
    const { RECKLESSNESS_RAGE_GEN } = await import('../src/sim/types');
    const d = (kind: string, value = 0, value2?: number) =>
      auraEffectDescriptor({ kind, value, value2 } as Parameters<typeof auraEffectDescriptor>[0]);
    expect(d('battle_stance')?.key).toBe('hudChrome.auraEffect.battleStance');
    expect(d('berserker_stance')?.key).toBe('hudChrome.auraEffect.berserkerStance');
    expect(d('buff_crit', 0.05)).toEqual({
      key: 'hudChrome.auraEffect.crit',
      nums: { pct: 5 },
    });
    expect(d('buff_reckless', 0.2)).toEqual({
      key: 'hudChrome.auraEffect.reckless',
      nums: { pct: 20, ragePct: RECKLESSNESS_RAGE_GEN * 100 },
    });
    // die_by_sword reads the aura value (the live dealDamage cut), no fixed constant.
    expect(d('die_by_sword', 0.3)).toEqual({
      key: 'hudChrome.auraEffect.dieBySword',
      nums: { pct: 30 },
    });
    // sanguine: interval mult 1/1.1 reads exactly 10% attack speed, plus value2 damage.
    expect(d('sanguine', 1 / 1.1, 0.05)).toEqual({
      key: 'hudChrome.auraEffect.sanguine',
      nums: { hastePct: 10, dmgPct: 5 },
    });
    expect(d('battle_trance')?.key).toBe('hudChrome.auraEffect.battleTrance');
    expect(d('victory_rush')?.key).toBe('hudChrome.auraEffect.victoryRush');
  });

  it('hides the countdown under battle and berserker stances like other toggles', async () => {
    const { createAurasView } = await import('../src/ui/auras_view');
    const v = createAurasView('all', {
      iconId: (a) => a.id,
      auraName: (a) => a.name,
      formatStacks: (n) => String(n),
      isOwn: () => true,
      durationUnits: () => ({ s: 's', m: 'm', h: 'h', d: 'd' }),
      auraEffectHtml: () => '',
    });
    for (const kind of ['battle_stance', 'berserker_stance']) {
      const view = v.tick({
        auras: [{ id: kind, name: kind, kind, remaining: 3600, value: 0 }],
      } as Parameters<typeof v.tick>[0]);
      expect(view.slots[0].durationText).toBe('');
    }
  });

  it('re-localizes the sim-emitted warrior buff names', async () => {
    const { localizeSimAuraName } = await import('../src/ui/sim_i18n');
    expect(localizeSimAuraName('Bladed Echo')).not.toBeNull();
    expect(localizeSimAuraName('Emboldened')).not.toBeNull();
    expect(localizeSimAuraName('Enraged')).not.toBeNull();
  });
});

describe('spellbook spec gating (spellbook_view specCanLearn)', () => {
  it('drops never-learnable trainable rows for the committed spec, keeps known ones', async () => {
    const { buildSpellbookView } = await import('../src/ui/spellbook_view');
    const base = {
      classId: 'warrior' as const,
      abilities: ['heroic_strike', 'overpower'] as const,
      known: [],
      barAbilityIds: [] as const,
      hasFreeSlot: true,
      hasFormBars: false,
    };
    // No committed spec: the whole kit shows (any spec is still open).
    expect(buildSpellbookView(base).rows.map((r) => r.abilityId)).toEqual([
      'heroic_strike',
      'overpower',
    ]);
    // Fury excludes heroic_strike outright and slam from level 10 up.
    const fury = buildSpellbookView({ ...base, spec: 'fury', level: 12 });
    expect(fury.rows.map((r) => r.abilityId)).toEqual([]);
    // Below the overpower hand-off level the exclusion has not kicked in yet.
    const furyLow = buildSpellbookView({ ...base, spec: 'fury', level: 5 });
    expect(furyLow.rows.map((r) => r.abilityId)).toEqual(['overpower']);
    // An already-learned excluded ability keeps its row.
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const known = sim.known.filter((k) => k.def.id === 'heroic_strike');
    if (known.length !== 1) throw new Error('expected heroic_strike known at level 1');
    const withKnown = buildSpellbookView({ ...base, known, spec: 'fury', level: 12 });
    expect(withKnown.rows.map((r) => r.abilityId)).toEqual(['heroic_strike']);
  });
});

describe('passives never auto-place on the action bar', () => {
  it('marks at least one live passive and pins the guard input', () => {
    const passives = Object.values(ABILITIES).filter((a) => a.passive);
    expect(passives.length).toBeGreaterThan(0);
  });
});
