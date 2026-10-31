# PvP 1v1 ranking: Warfare Season 2 best-in-slot (v0.46 rules)

A Monte Carlo of every spec against every spec in duels, all wearing Warfare Season 2
best-in-slot gear. The full generated tables (every pairing, the 27 by 27 matrix, duel shape per
spec) are in [`pvp-1v1-season2-data.md`](pvp-1v1-season2-data.md), with the raw per-pairing
numbers in [`pvp-1v1-season2-data.json`](pvp-1v1-season2-data.json). This page is the reading
of those numbers.

## How it was run

- **Code base:** `release/v0.45.0`, the newest release branch (no v0.46 branch exists yet), plus
  one v0.46 owner rule modelled in the harness: **a full Season 2 kit is immune to spell
  pushback.** The shipped code does not have it yet (`docs/design/warfare-season-2.md` still
  says "no spell-pushback immunity on any honor set"), so the harness grants it through the
  engine's own talent-seam pushback channel. It is one flag:
  `SEASON2_PUSHBACK_IMMUNITY` in `scripts/pvp_duel/builds.ts`.
- **Volume:** 27 specs, every ordered pairing, 10 seeded duels per ordered pairing, so 20 duels
  per pairing with both seat orders pooled: 7,290 duels, 0 errors.
- **Gear (every spec):** the five class-and-spec Season 2 pieces, entry-tier Warfare waist and
  feet, entry-tier neck and two rings for the spec's primary stat, the Medallion of Defiance
  (the PvP control-break trinket), and the Season 2 weapon (a second copy for dual wielders).
  Slots the honor vendors cannot fill (a tank shield, a held off-hand, a quiver) come from the
  spec's top-parse loadout. Every kit reaches the 30 percent Warfare Offense and Defense caps
  and the +80 percent Vitality cap.
- **The fight:** level 20, a real accepted duel (so the Warfare damage multiplier, PvP
  diminishing returns and the 1 HP duel finish all run live), 18 to 24 yards apart at the flag,
  fully buffed and prepared before the countdown (stances, forms, poisons, imbues, pets,
  summons, stealth). A duel still going at 240 seconds is a **draw** (half a win each).
- **The bot:** one shared engine for every spec (movement, kiting, interrupts, the PvP
  trinket), driving a per-spec priority list. The damage cores follow the repo's own balance
  probes (`scripts/owned_class_balance_probe.ts`, `scripts/warlock_balance_probe.ts`,
  `scripts/rogue_dps_probe.ts`); the PvP layer on top uses interrupts on every enemy cast,
  stuns and fears, defensives on health thresholds, and kiting with the spec's own slows,
  roots and blinks. Every press goes through the real `castAbility` path.
- **Talent rows:** a PvP judgement per spec (control, mobility and a defensive where the row
  offers one), listed in `scripts/pvp_duel/builds.ts`. There are no parse sources for duels.

## The ranking

| Rank | Spec | Tier | Score |
|---|---|---|---|
| 1 | Retribution Paladin | S | 96% |
| 2 | Protection Paladin | S | 94% |
| 3 | Holy Paladin | S | 93% |
| 4 | Fury Warrior | S | 86% |
| 5 | Feral Druid | S | 77% |
| 6 | Restoration Shaman | S | 74% |
| 7 | Marksmanship Hunter | A | 65% |
| 8 | Balance Druid | A | 60% |
| 9 | Discipline Priest | A | 60% |
| 10 | Arms Warrior | A | 57% |
| 11 | Beast Mastery Hunter | B | 54% |
| 12 | Shadow Priest | B | 54% |
| 13 | Survival Hunter | B | 53% |
| 14 | Protection Warrior | B | 52% |
| 15 | Assassination Rogue | C | 43% |
| 16 | Destruction Warlock | C | 38% |
| 17 | Demonology Warlock | C | 38% |
| 18 | Enhancement Shaman | C | 38% |
| 19 | Combat Rogue | D | 33% |
| 20 | Subtlety Rogue | D | 33% |
| 21 | Elemental Shaman | D | 32% |
| 22 | Arcane Mage (Chronomancy) | D | 25% |
| 23 | Affliction Warlock | D | 24% |
| 24 | Restoration Druid | D | 22% |
| 25 | Frost Mage | D | 17% |
| 26 | Fire Mage | D | 17% |
| 27 | Holy Priest | D | 16% |

Score is the mean win rate over the 26 other specs (each opponent weighs the same). Tiers: S is
65 percent and up, A 55 to 65, B 45 to 55, C 35 to 45, D under 35.

**By class:** Paladin 94%, Warrior 65%, Hunter 57%, Druid 53%, Shaman 48%, Priest 43%,
Rogue 36%, Warlock 33%, Mage 20%.

## Who counters who

The headline relationships (the row spec's win rate in brackets; every pairing is in the data
file):

- **Paladins beat everyone.** Every paladin spec takes 95 to 100 percent of every non-paladin
  pairing with three exceptions: Holy and Prot Paladin against Restoration Shaman (50 each)
  and Prot Paladin against Arcane Mage (70). Inside the class it is rock, paper, scissors: **Prot Paladin
  counters Ret (Ret 28)**, Ret beats Holy (78), and Prot against Holy is a coin flip (50).
- **Fury Warrior is the best non-paladin.** It scores 0 against all three paladins and 100
  against every other spec except Balance Druid (60), Restoration Shaman (70) and Feral Druid
  (95).
- **Warriors hard-counter casters.** Arms and Fury win 100 percent against all three mages, all
  three warlocks, Elemental Shaman, Holy Priest and Restoration Druid. The exceptions are the
  casters with real sustain: Arms loses to Balance Druid and Discipline Priest (0), and every
  warrior loses to Holy Paladin (0).
- **Hunters hard-counter rogues and mages.** All three rogues score 0 against Beast Mastery and
  Marksmanship; Fire and Frost Mage score 0 against all three hunters, Arcane 0 against Beast
  Mastery and Marksmanship. Survival is the rogues' one
  winnable hunter (Assassination 95, Combat 75, Subtlety 65).
- **Marksmanship beats the other hunters** (100 against Beast Mastery), and Survival beats
  Beast Mastery (100) but loses to Marksmanship (10).
- **Rogues farm the soft targets and nothing else.** Assassination wins 100 against Holy Priest,
  Elemental Shaman, Frost Mage and Affliction; every rogue scores 0 to 30 against every
  warrior, paladin, hunter (except Survival), Discipline Priest and Restoration Shaman, and 5
  to 35 against Restoration Druid.
- **Warlocks eat casters, melee eats warlocks.** Destruction and Demonology win 100 against Holy
  Priest, Arcane Mage, Frost Mage, Balance and Restoration Druid, and score 3 to 6 percent
  against melee.
- **Healer pairings stall.** Holy Priest, Discipline Priest and Restoration Druid draw all 20
  duels against each other and against Restoration Shaman; nobody can kill anybody inside
  240 seconds. Holy Paladin is the exception and kills every healer except Restoration Shaman.

## Weaknesses found

### Balance

1. **Paladin is in a class of its own.** All three specs score 93 percent or more, and two of
   the top three are a tank and a healer. Three mechanisms stand out in the duel logs:
   - **Hallowed Wall (`holy_shield`, Protection)** absorbs 10 percent of maximum health every
     8 seconds (8 second cooldown, so 100 percent uptime, off the GCD) plus 30 percent block. In
     four Prot Paladin against Fury Warrior duels the paladin took a few hundred damage in total
     while the shield absorbed 10,899. Prot Paladin takes 10.9 damage per second on average,
     the lowest of any spec by a factor of three.
   - **Percent-of-maximum-health effects inflate with Warfare Vitality.** Vitality adds up to
     80 percent maximum health in PvP, and every effect sized from maximum health (Hallowed
     Wall, Lay on Hands, the paladin absorbs) grows with it. Season 2 gear therefore makes
     those defensives worth up to 1.8 times their PvE value.
   - **Retribution burst:** Zealwing (`avenging_wrath`) unlocks Tolling Hammer
     (`hammer_of_wrath`, 150 to 180 holy, 6 second cooldown, 30 yard range) against any target
     for 15 seconds; with Final Edict and Verdict of the Sun God, Ret deals 114 damage per
     second, the highest of any spec, and wins in 37 seconds on average.
   - **Holy Paladin** hard-casts Mercy Lance and Holy Light freely under pushback immunity
     while wearing mail and Vitality health: it takes 64 damage per second (the most of any
     spec) and still wins 93 percent.
2. **Warrior control is not escapable for casters.** Crushing Charge (a 4 second root plus a
   15 second 50 percent slow), Pummel's school lockout, Thunderhurl's stun, Hamstring and
   Heroic Leap together leave a caster no window: Arms and Fury go 100 percent against nine
   caster and healer specs. Frost Nova, Blink and Typhoon buy one cast at most before Charge or
   Leap is back.
3. **Mages are the weakest class (20 percent).** Cloth armor and about 2,650 health against 30
   percent Warfare Offense; no self-healing outside Chronomancy. Fire and Frost score 0 against
   every hunter and 1 to 7 percent against melee. Fire's Hot Streak burst is real (it kills Elemental Shaman
   quickly) but Fire still loses 95 percent to Destruction.
4. **Rogues have no answer to anything with sustain or range (36 percent).** The stealth opener
   lands, but after Kidney Shot and the PvP trinket the rogue has no healing and modest damage
   (45 to 50 per second), and loses to Beast Mastery and Marksmanship, to every warrior and
   paladin, and to every healer except Holy Priest (and Subtlety loses that one too, 40).
5. **Warlocks are glass cannons.** Destruction deals 91 damage per second (second only to Ret)
   but its peel is a 1.5 second Fear that a melee interrupts or out-damages; 3 to 6 percent
   against melee.
6. **Two healers cannot win duels at all.** Holy Priest (16 percent) and Restoration Druid
   (22 percent) deal about 18 damage per second: they survive long and then lose or draw.
   Restoration Shaman, by contrast, is S tier (74 percent) with the highest draw rate (35
   percent).
7. **Elemental Shaman is the weakest caster DPS (32 percent):** 0 percent against ranged and 9
   percent against melee even with pushback immunity, because every Shock it relies on has a 20
   yard range and its 2 second Lightning Bolt is what Pummel, Counter Shot and Counterspell all
   target.

### Pushback immunity changes the picture for healers

A one-duel-per-pairing sample run without pushback immunity, taken while building the harness
(indicative only), had Holy Paladin at 60 percent and Restoration Shaman at 42 percent; with
immunity they reach 93 and 74. The rule mostly rewards specs that heal or nuke with cast-time
spells while a melee is on them. If the immunity ships, expect the healer side of the paladin
and shaman problem above to grow, not shrink.

### Engine findings (outside balance)

- **A hostile spell lands on a stealthed player whose id is known.** The server hides stealthed
  players from snapshots, but the `target` command (`server/game.ts`, `case 'target'`) passes
  any id to `Sim.targetEntity`, and the sim lets a cast land on the stealthed player: a test
  Shadow Word: Pain hit a stealthed rogue and broke his stealth. A duel opponent's id is known
  from the duel request, so a modified client could target and reveal a stealthed duelist.
  Worth a follow-up in `src/sim/targeting.ts` (refuse an enemy player target while stealthed and
  undetected) and a pin test.
- **Charge can land exactly on its target (distance 0).** At zero range no facing resolves, so
  facing-gated abilities refuse ("You must be facing your target.") until one side moves. A
  player recovers by moving; worth knowing for bots and for the RL environment.

## What the bot does not do (read the numbers with this in mind)

- It is one skill level for every spec: it reacts on the tick, interrupts every enemy cast it
  can, and uses defensives on fixed thresholds. It does not juke casts, pillar for line of
  sight, fake-cast, or play around enemy cooldowns.
- It never attacks pets or minions; it uses its area peels on them (Frost Nova, Psychic Scream,
  Thunderstorm, Typhoon) when they pin it.
- Talent rows are one fixed PvP build per spec; a different build can move a spec a tier.
- Duels start 18 to 24 yards apart on flat open ground with no obstacles.

So the ranking measures "these kits, played competently by the same player, on open ground".
Strongly lopsided pairings (85 percent and up, listed in the data file) are the reliable signal;
pairings in the 40 to 60 percent band are close to even under this model.

## Reproduce

```
npx tsx scripts/pvp_duel/run.ts --runs 10 --workers 4 --out tmp/pvp_duel
npx tsx scripts/pvp_duel/report.ts tmp/pvp_duel docs/balance/pvp-1v1-season2-data.md
npx tsx scripts/pvp_duel/trace.ts paladin/protection warrior/fury 1 20   # one duel, timeline
```

`tests/pvp_duel_harness.test.ts` pins the builds, the kits, the bot's ability ids, the
pushback-immunity modelling and seed replay.
