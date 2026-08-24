# Warlock (Hexcraft) under melee pressure: PvP design proposal

Status: proposal. Not implemented. Written against `release/v0.37.0` (package version 0.36.0).

Scope: the Hexcraft (Affliction) Warlock's ability to survive and threaten a Warrior in
1v1 PvP. Necromancy and Ruination are out of scope by the reporter's own framing and are
touched only where a change is shared across all three specializations.

Everything below cites the shipped content records so a reader can check it:
`src/sim/content/classes.ts`, `src/sim/content/choice_rows_classic.ts`,
`src/sim/content/talent_abilities_v2_b.ts`, `src/sim/content/warrior_rows.ts`, and
`src/sim/combat/affliction.ts`.

## Summary

The Hexcraft Warlock does not lack a defensive button. It has four (Vicarious Suffering,
Sanguine Covenant, Dread Chorus, Umbral Anchor) plus a capstone control tool (Abyssal
Rift). The problem is that **every one of them is paid for in the two currencies a Warrior
is already taking: the Warlock's health and the Warlock's ability to stand still.** The
specialization's resource floor then sits further away in time than a Warrior's kill window,
so the sequence that survives and the sequence that threatens cannot both be run.

The proposal is four data changes and one small resolver change. None of them needs a new
engine effect type: every primitive is already shipped and playtested on another class.
No Warrior ability is touched.

## Evidence

Production census and recorded arena outcomes, `prod` realm Claudemoon, snapshot
2026-08-24:

| Class | 1v1 arena (census) | Duels (census) | Recorded arena fights | Damage per hour |
|---|---:|---:|---:|---:|
| Warlock | 84 W / 100 L (45.7%) | 36 W / 93 L (27.9%) | 4 W / 21 L (16.0%) | 7,799 |
| Warrior | 377 W / 167 L (69.3%) | 153 W / 104 L (59.5%) | 100 W / 53 L (65.4%) | 33,432 |

Warlock damage per hour is 23% of the Warrior's and the second lowest of the nine classes.
Across the recorded arena set the Warlock has the worst record of any class with a
double-digit sample.

Read these the way `docs/design/spell-balance-framework.md` requires: parses identify a
suspicious profile, they do not justify a coefficient. They are lifetime aggregates across
all gear and skill levels, not a controlled Warlock-versus-Warrior measurement. They tell
us the direction is real. The fixture in the validation plan below is what sets the numbers.

## Diagnosis

### Finding 1: every Hexcraft answer is billed in health

| Tool | Cost | Source |
|---|---|---|
| Cruel Pact | 12% of maximum health for 20 Condemnation | `classes.ts` `cruel_pact` |
| Sanguine Covenant | 10% of current health for a 30% maximum-health absorb, 8 sec | `talent_abilities_v2_b.ts` `dark_pact` |
| Sacrilegious March (the row 5 mobility option) | 2% of maximum health per second while moving | `talent_abilities_v2_b.ts` `sacrilegious_march` |
| Hard Bargain | health into mana | `classes.ts` `life_tap` |

The specialization's resource button, its shield, its mana button, and its only sustained
movement option are all denominated in the exact currency the opponent is draining. Against
a Warrior these are not tradeoffs, they are the Warrior's damage with extra steps. Opening
with Sanguine Covenant plus Cruel Pact spends 22% of the Warlock's health before a single
point of damage is dealt, which is the reporter's central complaint and it is arithmetically
correct.

### Finding 2: the Condemnation floor is further away than the kill window

Sentence requires 20 Condemnation to fire at all (`requiresAuraStacks: 20`) and escalates at
20, 50, 80, and 100. Needle of Fate generates 7 on a 1.5 sec cast (1.0 sec under Possess the
Evil Eye).

| Condemnation target | Needles required | Stationary cast time | With Possession |
|---:|---:|---:|---:|
| 20 (Sentence floor) | 3 | 4.5 sec | 3.0 sec |
| 50 (first real escalation) | 8 | 12.0 sec | 8.0 sec |
| 80 | 12 | 18.0 sec | 12.0 sec |

Cruel Pact buys 20 Condemnation instantly for 12% health on a 20 sec cooldown. That is the
only instant entry to the spender, and it is the health-billed one. In a window of a few
seconds a single Needle lands 7 Condemnation, 35% of the minimum Sentence. The spender is
not weak; it is out of reach.

### Finding 3: row 8 makes the Warlock choose between seeing the Warrior and holding him

Row 8 (theme `control`) is Abyssal Gag (interrupt plus 4 sec silence), Dread Chorus (3 sec
area fear, 8 yd, 40 sec cooldown), and Leaden Hex (a 5% stacking spell snare that roots for
1.5 sec at 3 stacks, once per 15 sec). All three are answers to melee pressure, and the
Warlock gets exactly one. Taking the fear, as the reporter does, leaves the specialization
with no snare at all.

Compare the Warrior, whose row set `docs/design/choice-row-quality-pass.md` names as the
quality bar:

| | Warlock (Hexcraft) | Warrior |
|---|---|---|
| Gap closer / escape, base kit | none | Onrush (15 sec, 8 to 25 yd, 1 sec stun), Heroic Leap (30 sec, 30 yd) |
| Snare, base kit | none | Hobbling Cut (50% for 15 sec, **no cooldown**, 10 rage) |
| Interrupt, base kit | Abyssal Gag only if row 8 is spent on it | Jawcrack (10 sec, 4 sec lockout, refunds 10 rage) |
| Row 5 | anchor cooldown, anchor sprint, or health-billed sprint | all three options are gap closers |
| Row 11 | survival | Piercing Howl (50% area slow) **or** Storm Bolt (a stun) |

The Warrior's snare, interrupt, and two gap closers are baseline and cost him no talent.
The Warlock's snare, interrupt, and fear are three options in one row.

### Finding 4: the only peel is a 90 second capstone that pulls the wrong way

Abyssal Rift (row 20, 90 sec cooldown, 100 mana) pulls enemies **to** a point and stuns for
2 sec. It is an area setup tool for grouped enemies. Used as a 1v1 peel it costs a capstone
slot, a 90 sec cooldown, and it drags the Warrior toward the chosen point rather than away
from the Warlock. The specialization has no way to create distance on demand.

## What is already correct, so we do not fix it twice

- **Cast pushback is already solved.** The caster 2-piece set bonus grants
  `castPushbackReduction: 1`, full immunity to damage-driven pushback
  (`src/sim/content/item_sets.ts`), and the WARFARE caster families carry the caster
  bonuses. The reporter is right that this is a floor, not a fix.
- **The row tree already follows the row-job table.** Rows are 5 mobility, 8 control,
  11 survival, 14 resource behavior, 17 major offense, 20 capstone utility. (Note for a
  later pass: `docs/design/class-design-rules.md` documents 8 as survival and 11 as
  control, and the Warrior tree matches the doc while the Warlock tree swaps them. That is
  a consistency question, not the cause of this problem.)
- **Possess the Evil Eye already grants mobile casting**, but only for Consume, only for
  15 sec, and only on a 45 sec cooldown. The mechanism exists; its availability is the gap.

## Proposal

Five changes. Each names the existing primitive it reuses, so none of them is an invented
coefficient. Every talent option id is preserved so saved loadouts migrate unchanged.

### P1. Blood Credit halves Cruel Pact's health cost

Row 14 is the resource-behavior row. Blood Credit currently reads "Hard Bargain and Cruel
Pact restore 50% more mana for the same health." In a fight measured in seconds, mana is not
the Hexcraft Warlock's constraint and Condemnation is, which makes Blood Credit a dead pick
under the repo's own no-strict-dominance rule.

> **Blood Credit:** Hard Bargain and Cruel Pact restore 50% more mana for the same health,
> **and Cruel Pact costs 6% of your maximum health instead of 12%.**

Row-legal: row 14's rule is "changes cadence or reliability, never resource plus damage."
Halving a health cost is reliability. It adds no damage.

Implementation: `applyCruelPact` in `src/sim/combat/affliction.ts` already takes `healthPct`
as a parameter from the effect record, so this is the talent's existing `ability` modifier
plus one resolver read. This is the one change that is not purely declarative.

### P2. Row 5 gains a real mobile-casting option

Row 5 is themed `mobility`, but all three options orbit Umbral Anchor or bill health.
Grave Rhythm ("Umbral Anchor recovers 15 sec faster") is the weakest kind of option under
the repo's stated bar that options should change behavior rather than be invisible passives.

> **Grave Rhythm** (option id `wlk_r5_bane` unchanged): *Grants Grave Rhythm: your next two
> spells with a cast time can be cast while moving. Lasts 15 sec, 25 sec cooldown, off the
> global cooldown.*

Reuses the shipped `ice_floes` aura kind verbatim, including its cadence (value 2,
duration 15, cooldown 25). That aura kind is already generic, not mage-gated: the Shaman
talent module applies it too (`src/sim/combat/shaman_talents.ts`). Zero engine change.

This is the reporter's single most-requested behavior, and it is the one every other caster
already has a row 5 option for (Mage: Ice Floes; Druid row 5: cast while moving).

### P3. The Evil Eye slows its bearer

The specialization's identity is that one enemy is marked. Make the mark do something the
marked enemy feels.

> **Evil Eye:** *... The bearer of your primary Evil Eye is slowed by 20%.*

Deliberately below every dedicated snare in the game (Hobbling Cut is 50% with no cooldown,
Piercing Howl is 50%, Leaden Hex reaches 15%). It does not kite a Warrior. It makes Dread
Chorus and Umbral Anchor land, which is the point, and it means a Hexcraft Warlock is never
completely without a snare regardless of what row 8 spent.

Single target only, because there is only ever one primary Eye.

Hook point: the `ctx.applyAura` call in `moveEvilEye` (`src/sim/combat/affliction.ts`),
which is where the `affliction_eye` aura is placed on the target.

### P4. Sanguine Covenant buys distance as well as an absorb

> **Sanguine Covenant:** Sacrifices 10% of your current health to absorb damage equal to 30%
> of your maximum health for 8 sec, **and knocks back enemies within 8 yd, slowing them by
> 50% for 4 sec.**

Numbers lifted verbatim from the Druid's Typhoon (`aoeKnockback`, radius 8, distance 6,
`dazeMult` 0.5, `dazeDuration` 4), an already shipped and playtested effect type and
coefficient set. Cooldown stays 45 sec, which is more than twice Typhoon's.

This is the change that most directly answers "I sacrificed 22% of my health and did
nothing." The health the Warlock pays now buys both the shield and the gap, in one press,
in the survival row where it belongs. Row 11 becomes a genuine three-way decision: passive
mitigation (Pact Deepened), the anti-melee panic button (Sanguine Covenant), or group
utility (Deep Hunger).

### P5. No change to Abyssal Rift

It stays a capstone area setup tool. P4 gives the specialization its peel, so the capstone
does not have to be one.

## Expected effect

The measurable claim, which the fixture below is written to check.

**Self-inflicted health to open a threatening sequence:** 22% today (Sanguine Covenant 10%
plus Cruel Pact 12%) drops to 16% (10% plus 6%), against an absorb worth 30% of maximum
health. The opener stops being net negative. The sustained-movement option no longer bills
2% per second.

**Presses to a 50 Condemnation Sentence, under pressure:**

| | Today | Proposed |
|---|---|---|
| Opening sequence | Abyssal Rift, Vicarious Suffering, Sanguine Covenant, Cruel Pact, Needle, Dread Chorus, Cruel Pact (on cooldown), Needle, Needle, ... | Evil Eye, Sanguine Covenant (shield and shove), Grave Rhythm, Needle, Needle (moving), Cruel Pact, Needle |
| Presses | 11 to 15, by the reporter's count | 7 |
| Stationary time required | 12 sec for 50 Condemnation | 2 of the 4 Needles are mobile |
| Health spent | 22% and climbing | 16%, offset by the absorb |

The Warlock still loses the snare war to a Warrior, still has no blink, and still cannot
out-sustain Fury burst. The claim is not that Hexcraft beats a Warrior. The claim is that
the sequence which survives and the sequence which threatens stop being mutually exclusive.

## What this deliberately does not do

- **No flat Sentence damage buff.** The problem is reaching the spender, not the spender's
  size. Hexcraft ramps correctly in PvE, and a damage increase would push against the
  10 to 15 percent cross-specialization band in `docs/design/class-design-rules.md`.
- **No PvP-only rule.** WARFARE (`src/sim/pvp/power.ts`) is the sanctioned PvP knob and it
  is a flat multiplier by design. A specialization-scoped PvP-only clause would be a new
  category of mechanic and would break the "one sim, three hosts" reading of the kit.
- **No Warrior nerf.** The Warrior row set is the playtested reference bar. Nerfing the
  reference class to fix a caster is the wrong direction and would move eight other matchups.
- **No new engine effect types.** `ice_floes`, `aoeKnockback`, `slow`, and `absorb` all ship
  today. P1 and P3 need small reads inside `src/sim/combat/affliction.ts`, a module that is
  already behind the `SimContext` seam. Nothing lands in `sim.ts`.

## Validation plan

Following the change protocol in `docs/design/spell-balance-framework.md`.

1. **Add the fixture first and show it failing.** New
   `tests/warlock_pvp_pressure.test.ts`: a level 20 Hexcraft Warlock in the WARFARE
   Cinderweave kit against a level 20 Fury Warrior in the Furyforged kit, fixed seed, fixed
   talent rows on both sides. Record ticks to first Sentence, Condemnation at 3, 5 and 10
   sec, self-inflicted health as a fraction of maximum over the window, and time to death.
   Pin the pre-change numbers.
2. **Change one source of power at a time**, in the order P3, P2, P4, P1, re-running the
   fixture between each so the attribution is per-change rather than per-pass.
3. **Re-run the three required profiles** (sustained 180 sec single target, burst 60 sec
   single target, area 60 sec five targets) for all three Warlock specializations and show
   PvE movement inside the parity band.
4. **Parity and determinism.** `tests/architecture.test.ts` for sim purity and rng
   discipline; regenerate scenario goldens only where the changed abilities are exercised.
   No `Math.random`, no clock reads: every number above is plain tick math.
5. **Saved loadouts.** Every option id is preserved (`wlk_r5_bane`, `wlk_r11_fel_concentration`,
   `wlk_r14_ruin`), so `talent_save_migration` needs no new arm. Add the assertion anyway.
6. **i18n.** Changed English strings land in `src/ui/i18n.catalog/abilities.ts` and the
   descriptions in the content records, English only, per the contributor rule. Any new aura
   display name lands in `sim_i18n` and `AURA_NAME_KEY` in the same change.
7. **Content regeneration.** `npm run wiki:content` for the guide; no deed changes.
8. **Gate.** `node scripts/gate_select.mjs` before the change is called done.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| P3's Eye snare is a free permanent slow against every class, not only Warriors | Single target only (one primary Eye), 20% is below every dedicated snare, and the Eye already expires in 20 sec and costs a global cooldown to re-place |
| P4's knockback disrupts a tank's threat cone in PvE by scattering mobs | Precedent: Typhoon ships with exactly this property. The 45 sec cooldown is more than twice Typhoon's, and the ability is self-targeted so it fires only when the Warlock is already in melee |
| P2 raises Hexcraft PvE uptime on movement-heavy encounters | Bounded to 2 casts per 25 sec and paid for laterally: taking it gives up Blacktide and Sacrilegious March. Profile 1 in the validation plan measures it |
| P1 makes Cruel Pact spammable enough to trivialize Condemnation generation | The 20 sec cooldown and the at-or-below-20%-health lockout are unchanged; only the price moves |
| Four changes at once make attribution impossible | Step 2 of the validation plan lands them one at a time against the same fixture |

## Appendix: the reporter's five asks, mapped

| Ask | Answered by | Fully or partly |
|---|---|---|
| Cast while moving | P2 (Grave Rhythm) | Partly: 2 casts per 25 sec, not unconditional |
| Mobility, a blink or similar | Not proposed | Umbral Anchor stays the Warlock's answer. A blink would duplicate the Mage's identity; P4 provides the distance instead |
| Slow enemies | P3 (Evil Eye), and row 8's Leaden Hex is unchanged | Fully, at a deliberately low value |
| Resources without sacrificing health | P1 (Blood Credit) | Partly: halved, not removed. The pact costing health is the specialization's identity |
| Knock the Warrior back several meters | P4 (Sanguine Covenant) | Fully: 6 yd plus a 50% slow for 4 sec |
