import { MOBS } from '../data';
import { findDelveObject } from '../delves/runs';
import { createMob } from '../entity';
import { combatProfileForMob } from '../mob_combat';
import type { SimContext } from '../sim_context';
import { addThreat, threatEntries } from '../threat';
import { DT, dist2d, type Entity, LEASH_DISTANCE } from '../types';
import { emitMobYell } from './yells';

// Boss / support-mob threshold mechanics (summonAdds, enrage, desperateHeal,
// mendAlly, wardAllies, rally, warcry) plus the add-spawner, behind the SimContext
// seam (facet M3-N1, see src/sim/CLAUDE.md). This is the generic template-driven
// layer, NOT the Nythraxis encounter (that lives in encounters/nythraxis.ts). Sim
// keeps thin updateBossMechanics/spawnBossAdds delegates (tests + the ctx bindings).

// Boss threshold mechanics: add waves (summonAdds) and enrage. Checked
// every tick while the boss is in combat; thresholds fire once per pull
// and reset on evade/respawn.
export function updateBossMechanics(ctx: SimContext, mob: Entity): void {
  const tmpl = MOBS[mob.templateId];
  if (
    !tmpl ||
    (!tmpl.summonAdds &&
      !tmpl.enrage &&
      !tmpl.desperateHeal &&
      !tmpl.mendAlly &&
      !tmpl.wardAllies &&
      !tmpl.rally &&
      !tmpl.warcry)
  )
    return;
  const hpFrac = mob.hp / Math.max(1, mob.maxHp);
  if (tmpl.summonAdds) {
    const thresholds = tmpl.summonAdds.atHpPct;
    while (mob.firedSummons < thresholds.length && hpFrac <= thresholds[mob.firedSummons]) {
      mob.firedSummons++;
      if (tmpl.yells?.summon) emitMobYell(ctx, mob, tmpl.yells.summon, tmpl.battleYells?.range);
      const run = ctx.delveRunForMob(mob.id);
      if (
        run &&
        findDelveObject(ctx, run, 'cracked_grave') &&
        ctx.startDelveRaiseDeadChannel(run, mob, tmpl.summonAdds.mobId, tmpl.summonAdds.count)
      )
        continue;
      spawnBossAdds(ctx, mob, tmpl.summonAdds.mobId, tmpl.summonAdds.count);
    }
  }
  // Delve bosses enrage on Heroic only (PRD delves.md §7.4: "Heroic: optional
  // enrage below 20% HP"). World bosses have no delve run, so they enrage as
  // before. Only resolved for enrage-capable templates, so the lookup is rare.
  const enrageRun = tmpl.enrage ? ctx.delveRunForMob(mob.id) : null;
  const enrageAllowed = !enrageRun || enrageRun.tierId === 'heroic';
  if (tmpl.enrage && enrageAllowed && !mob.enraged && hpFrac <= tmpl.enrage.belowHpPct) {
    mob.enraged = true;
    if (tmpl.yells?.enrage) emitMobYell(ctx, mob, tmpl.yells.enrage, tmpl.battleYells?.range);
    ctx.emit({ type: 'aura', targetId: mob.id, name: 'Enrage', gained: true });
    ctx.emit({
      type: 'log',
      text: `${mob.name} becomes enraged!`,
      color: '#ff6666',
      entityId: mob.id,
    });
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: mob.id,
      school: 'fire',
      fx: 'nova',
    });
  }
  if (tmpl.desperateHeal && !mob.healedThisPull && hpFrac <= tmpl.desperateHeal.belowHpPct) {
    mob.healedThisPull = true;
    const heal = Math.min(mob.maxHp - mob.hp, Math.round(mob.maxHp * tmpl.desperateHeal.healPct));
    if (heal > 0) {
      mob.hp += heal;
      ctx.emit({ type: 'heal', targetId: mob.id, amount: heal });
      ctx.emit({
        type: 'log',
        text: `${mob.name} draws on a desperate second wind!`,
        color: '#66ff99',
        entityId: mob.id,
      });
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: 'nature',
        fx: 'nova',
      });
    }
  }
  // Support "Mend": periodically heal every wounded friendly mob in range
  // (including the caster). Telegraphed via createMob seeding mendTimer to a
  // full interval, so the first cast never lands the instant combat opens.
  if (tmpl.mendAlly) {
    mob.mendTimer -= DT;
    if (mob.mendTimer <= 0) {
      mob.mendTimer = tmpl.mendAlly.every;
      const wounded: Entity[] = [];
      for (const ally of ctx.entities.values()) {
        if (ally.kind !== 'mob' || ally.dead || ally.ownerId !== null) continue; // skip players, pets, corpses
        if (ally.hostile !== mob.hostile || ally.hp >= ally.maxHp) continue; // only wounded same-faction mobs
        if (dist2d(ally.pos, mob.pos) > tmpl.mendAlly.radius) continue;
        wounded.push(ally);
      }
      if (wounded.length > 0) {
        const school = tmpl.mendAlly.school ?? 'nature';
        ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
        ctx.emit({
          type: 'log',
          text: `${mob.name} channels ${tmpl.mendAlly.name}.`,
          color: '#66ff99',
          entityId: mob.id,
        });
        for (const ally of wounded) {
          const amount = Math.round(ctx.rng.range(tmpl.mendAlly.healMin, tmpl.mendAlly.healMax));
          ctx.applyHeal(mob, ally, amount, tmpl.mendAlly.name);
        }
      }
    }
  }
  // Support "Ward": the defensive twin of Mend. Periodically wrap every living
  // friendly mob in range (including the caster) in an absorb shield. Unlike
  // Mend it targets healthy allies too, a barrier pre-empts the next blows.
  // Refreshes each interval, replacing any partially-soaked ward (same aura id).
  if (tmpl.wardAllies) {
    mob.wardTimer -= DT;
    if (mob.wardTimer <= 0) {
      mob.wardTimer = tmpl.wardAllies.every;
      const allies: Entity[] = [];
      for (const ally of ctx.entities.values()) {
        if (ally.kind !== 'mob' || ally.dead || ally.ownerId !== null) continue; // skip players, pets, corpses
        if (ally.hostile !== mob.hostile) continue; // same-faction mobs only
        if (dist2d(ally.pos, mob.pos) > tmpl.wardAllies.radius) continue;
        allies.push(ally);
      }
      if (allies.length > 0) {
        const school = tmpl.wardAllies.school ?? 'holy';
        ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
        ctx.emit({
          type: 'log',
          text: `${mob.name} channels ${tmpl.wardAllies.name}.`,
          color: '#aad4ff',
          entityId: mob.id,
        });
        for (const ally of allies) {
          ctx.applyAura(ally, {
            id: `ward_${mob.templateId}`,
            name: tmpl.wardAllies.name,
            kind: 'absorb',
            remaining: tmpl.wardAllies.duration,
            duration: tmpl.wardAllies.duration,
            value: tmpl.wardAllies.amount,
            sourceId: mob.id,
            school,
          });
        }
      }
    }
  }

  // Commander "Rally": periodically empower every friendly mob in range
  // (including the caster) with a refreshing attack-power buff. The offensive
  // twin of mendAlly (same telegraphed timer, same same-faction ally scan)
  // but it grants buff_ap (folded by effectiveAttackPower) instead of healing.
  if (tmpl.rally) {
    mob.rallyTimer -= DT;
    if (mob.rallyTimer <= 0) {
      mob.rallyTimer = tmpl.rally.every;
      const allies: Entity[] = [];
      for (const ally of ctx.entities.values()) {
        if (ally.kind !== 'mob' || ally.dead || ally.ownerId !== null) continue; // skip players, pets, corpses
        if (ally.hostile !== mob.hostile) continue; // only same-faction mobs
        if (dist2d(ally.pos, mob.pos) > tmpl.rally.radius) continue;
        allies.push(ally);
      }
      if (allies.length > 0) {
        const school = tmpl.rally.school ?? 'physical';
        ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
        ctx.emit({
          type: 'log',
          text: `${mob.name} unleashes ${tmpl.rally.name}!`,
          color: '#ffcc33',
          entityId: mob.id,
        });
        for (const ally of allies) {
          ctx.applyAura(ally, {
            id: `rally_${mob.templateId}`,
            name: tmpl.rally.name,
            kind: 'buff_ap',
            remaining: tmpl.rally.duration,
            duration: tmpl.rally.duration,
            value: tmpl.rally.ap,
            sourceId: mob.id,
            school,
          });
        }
      }
    }
  }
  // Support "War Cadence": periodically quicken every nearby friendly mob's
  // swings (including the caster) by re-applying a refreshing buff_haste aura.
  // Same telegraph as Mend; rides swingIntervalMult's existing buff_haste fold.
  if (tmpl.warcry) {
    mob.warcryTimer -= DT;
    if (mob.warcryTimer <= 0) {
      mob.warcryTimer = tmpl.warcry.every;
      const allies: Entity[] = [];
      for (const ally of ctx.entities.values()) {
        if (ally.kind !== 'mob' || ally.dead || ally.ownerId !== null) continue; // skip players, pets, corpses
        if (ally.hostile !== mob.hostile) continue; // same-faction only
        if (dist2d(ally.pos, mob.pos) > tmpl.warcry.radius) continue;
        allies.push(ally);
      }
      if (allies.length > 0) {
        const school = tmpl.warcry.school ?? 'physical';
        const auraId = `warcry_${mob.templateId}`;
        ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
        ctx.emit({
          type: 'log',
          text: `${mob.name} channels ${tmpl.warcry.name}.`,
          color: '#ffd27f',
          entityId: mob.id,
        });
        for (const ally of allies) {
          const existing = ally.auras.find((a) => a.id === auraId);
          if (existing) {
            existing.remaining = tmpl.warcry.duration; // refresh on each pulse; never stack
            continue;
          }
          ally.auras.push({
            id: auraId,
            name: tmpl.warcry.name,
            kind: 'buff_haste',
            remaining: tmpl.warcry.duration,
            duration: tmpl.warcry.duration,
            value: tmpl.warcry.hasteMult,
            sourceId: mob.id,
            school,
          });
          ctx.emit({ type: 'aura', targetId: ally.id, name: tmpl.warcry.name, gained: true });
        }
      }
    }
  }
}

export function spawnBossAdds(ctx: SimContext, boss: Entity, mobId: string, count: number): void {
  const template = MOBS[mobId];
  if (!template) return;
  ctx.emit({
    type: 'log',
    text: `${boss.name} calls for aid!`,
    color: '#ff6666',
    entityId: boss.id,
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: boss.id,
    targetId: boss.id,
    school: 'shadow',
    fx: 'nova',
  });
  // adds spawned inside a claimed instance despawn with it
  const delveRun = ctx.delveRunForMob(boss.id);
  const inst = ctx.instances.find((i) => {
    if (i.partyKey === null) return false;
    const o = ctx.instanceOriginOf(i);
    return Math.abs(boss.pos.x - o.x) < 120 && Math.abs(boss.pos.z - o.z) < 250;
  });
  const [topThreatId] = threatEntries(boss, 1)[0] ?? [];
  const victimId = boss.aggroTargetId ?? topThreatId ?? null;
  let victim = victimId !== null ? (ctx.entities.get(victimId) ?? null) : null;
  if (!victim || victim.dead || victim.kind !== 'player') {
    // Fallback so freshly-summoned adds always have a nearby enemy to charge even if
    // the boss's own target just died or dropped: pick the closest live player.
    let best: Entity | null = null;
    let bestD = Infinity;
    ctx.playerGrid.forEachInRadius(boss.pos.x, boss.pos.z, LEASH_DISTANCE, (pl, d2) => {
      if (pl.kind === 'player' && !pl.dead && d2 < bestD) {
        bestD = d2;
        best = pl;
      }
    });
    victim = best;
  }
  // World bosses erupt their adds from directly underneath them (centered, a tight
  // 1yd cluster spread only enough to not stack on one point); ordinary summoners keep
  // the wider 3.5yd ring beside the boss.
  const spawnRadius = MOBS[boss.templateId]?.worldBoss ? 1 : 3.5;
  for (let k = 0; k < count; k++) {
    const ang = (k / count) * Math.PI * 2 + 0.7;
    const pos = ctx.groundPos(
      boss.pos.x + Math.sin(ang) * spawnRadius,
      boss.pos.z + Math.cos(ang) * spawnRadius,
    );
    const level = ctx.rng.int(template.minLevel, template.maxLevel);
    const add = createMob(ctx.nextId++, template, level, pos);
    // Leash to the boss's ORIGINAL spawn (not his current, possibly-kited position):
    // pulled too far from it, the add's chase-case leash check evades it home.
    add.spawnPos = { ...boss.spawnPos };
    add.tappedById = boss.tappedById;
    ctx.addEntity(add);
    boss.summonedIds.push(add.id);
    inst?.mobIds.push(add.id);
    delveRun?.mobIds.push(add.id);
    if (victim && !victim.dead && victim.kind === 'player') {
      add.aggroTargetId = victim.id;
      add.inCombat = true;
      add.aiState =
        dist2d(add.pos, victim.pos) > combatProfileForMob(add.templateId, add.scale).meleeRange
          ? 'chase'
          : 'attack';
      addThreat(add, victim.id, 1);
    }
  }
}
