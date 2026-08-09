# The item level ladder

How a piece of gear gets its item level, where its stat budget comes from, and how
both extend to the next level cap without a rewrite.

This is the living reference for the system. The measurement that chose the design,
including the numbers for the option that was NOT taken, is the historical record in
`docs/design/ilvl-squish-feasibility.md`.

Owning modules:

| Module | Owns |
|---|---|
| `src/sim/item_tier.ts` | the endgame tier bands, `endgameItemLevel`, `tierBand`, the window endpoints |
| `src/sim/item_budget.ts` | the stat and weapon-dps curves, quality and slot weightings, `statPointCurve` |
| `src/sim/item_level.ts` | the source index, `itemLevel`, `expectedStatBudget`, `itemScore` |
| `src/sim/item_level_req.ts` | the equip-level gate, which reads the SOURCE level, never the item level |

All four are pure leaves: no rng, no clock, no Sim state, no DOM. The HUD imports
them directly, and `tests/architecture.test.ts` keeps them host-agnostic.

## 1. Two regimes, and why

An item level answers "how strong is this drop". The honest way to answer it depends
on which side of the level cap the drop comes from.

**Below the cap it is derived.** The level of the mob that drops it (or the boss a
quest reward is gated behind), plus a quality bump: uncommon +1, rare +3, epic +6,
legendary +10, plus +3 if the source is a 10-player raid. This is right while a
character is levelling, because the source level IS the progression axis. A level-7
rare reads item level 10 and that number means something.

**At the cap it stops working.** Every endgame source sits at the same character
level, so the source level carries no information and the derivation degenerates into
a pile of additive bonuses. Two consequences, both of which had bitten:

- **The bonuses outgrew the window.** The quality bump alone spans +1 to +10, wider
  than the entire endgame ladder is supposed to be. Stacking a heroic source level on
  a raid bonus on an epic bump produced item level 37 against a level cap of 20.
- **Tier order was emergent, not stated.** Whether heroic dungeon loot outranked
  normal raid loot fell out of arithmetic nobody was looking at. It did not, and the
  progression order said it should.

So cap-level content is **anchored** instead: each tier owns an explicit band, and
quality picks a rung inside its own tier rather than adding to it.

```ts
// item_level.ts
if (src.tier) return endgameItemLevel(src.tier, item.quality);   // anchored
const derived = src.level + qualityBump + raidBonus;             // levelling
return Math.min(derived, tierBand('dungeon').max);               // clamped
```

## 2. The bands

Five contiguous, non-overlapping bands inside a window of 21 to 31.

| Tier | uncommon | rare | epic | legendary |
|---|---|---|---|---|
| `dungeon` (normal five-mans, the level-20 world, level-20 recipes) | 21 | 22 | 23 | 30 |
| `raid` (normal Nythraxis) | 24 | 24 | 25 | 30 |
| `heroic_dungeon` (heroic five-mans, marks jewelry, WARFARE honor gear) | 26 | 26 | 27 | 31 |
| `heroic_raid` (Heroic Nythraxis) | 28 | 28 | 29 | 31 |

Legendaries sit in their own band above every tier. They are flagship artifacts, not
"one rung better than the epic in the same instance", and they are the pieces meant
to carry an upgrade path later, so they need reserved space above the ladder.

Which tier a source belongs to is decided once, at registration, in
`buildSourceIndex`. A cap-level mob resolves through `endgameTierForLevel` (raid flag
or not); heroic sources name their tier explicitly at the call site, because "heroic"
is a property of the instance, not of any level the content is tuned to.

### The clamp

A sub-cap source can never read above `tierBand('dungeon').max`. Without it, a
high-quality drop from a near-cap source derives INTO a band it did not earn: a
level-19 epic used to land on the raid rung at 25. The clamp only binds for sources
within a quality bump of the cap; the rest of the levelling ladder is untouched.

## 3. The budget curves

Item level is not decoration. `primaryStatBudget` and `weaponDpsBudget` turn it into
the stat points and weapon damage a piece is expected to carry, and
`tests/item_level.test.ts` holds authored content to those numbers exactly.

Both curves are **piecewise, anchored at item level 21**:

```
statPointCurve(L)   = L <= 21 ? L * 0.70          : 14.70 + (L - 21) * 1.10
weaponDpsBudget(L)  = L <= 21 ? 6.7 + 0.30 * L    : 13.00 + (L - 21) * 0.48

primaryStatBudget(L, quality, slot) = round(statPointCurve(L) * qualityMult * slotMult)
```

Two properties do the work:

**Continuity at the anchor.** The segments meet exactly at 21 (`14.70` and `13.00`),
so shortening the endgame ladder moved nothing below it. Every sub-cap item's budget
is byte-identical to what it was before the squish, and a test sweeps every level up
to the anchor to keep it that way.

**A steeper endgame slope.** Endgame tiers are one or two item levels apart. On the
levelling slope of 0.7, a whole tier step would be worth 0.7 stat points before slot
weighting, so adjacent tiers would round to the same number on half the slots and the
ladder would read flat. The endgame slope of 1.1 is what makes a tier step legible,
and it is also what let the endgame shrink from a 17-wide span to an 11-wide one at
the same absolute power. It was fitted, not invented: it reproduces the pre-squish
budgets of every tier that kept its place in the ladder.

The proof that the fit holds: the top legendary carried a 49-point mainhand budget at
item level 37 and carries a 49-point mainhand budget at item level 31.

## 4. Why this helps down the line

This is the reason the change was worth making. The squish itself is cosmetic
housekeeping; what it buys is that the next three things anyone wants to build stop
being fights with a formula.

### 4.1 The next level cap becomes a table edit

Under the old derivation, raising `MAX_LEVEL` to 30 would have produced a mess with
no clean fix. Level-30 content would derive item levels around 33 to 43, straight
through the numbers the level-20 tier had already spent. An entry-level drop from the
new expansion would read *below* the previous expansion's best-in-slot, and no amount
of tuning source levels would separate them, because the same additive formula
generated both.

Now the ladder is a declaration. The next cap takes the next window, and nothing about
the previous one moves. **The recipe:**

1. Add the new tiers to `EndgameTier` and `BANDS` in `item_tier.ts`, starting at
   `ENDGAME_MAX_ILVL + 1`. Raise `ENDGAME_MAX_ILVL` to the new top.
2. Extend the curve in `item_budget.ts` with a third segment anchored at the old
   `ENDGAME_MAX_ILVL`, continuous with the segment below it. The previous
   expansion's budgets do not move, by the same continuity argument that protected
   sub-cap gear here.
3. Point the new content's sources at the new tiers in `buildSourceIndex`.
4. Decide what the old cap's tiers become. They can keep their bands (catch-up gear
   that honestly reads below the new content) or be retired.

Steps 1 to 3 are additive. Nothing in step 1 to 3 can silently re-budget shipped
gear, which is the property the old model could not offer.

The one thing still to settle: the bands are literals today, not offsets from
`MAX_LEVEL`. That was deliberate (an offset scheme would have moved this tier's
numbers when the cap moves, which is exactly what we were trying to stop), but it
means step 1 is a conscious edit rather than automatic. It is one table.

### 4.2 A new tier at the current cap is one row

Mythic+ is specced (`docs/prd/mythic-plus-and-forged.md`) and sits above heroic. Under
the old model, adding it meant inventing a source level and hoping the additive sum
landed above heroic and below the legendaries, with nothing checking that it had.

Now: add `mythic_dungeon` to `BANDS`, give it rungs, register the drops. The ordering
test fails immediately if the new band overlaps a neighbour, and the budget follows
from the curve without anyone hand-tuning stat lines.

### 4.3 Upgrade tracks have somewhere to go

Legendaries at 30 and 31 sit in a band of their own above every tier, which is the
space an upgrade system needs. The Forged plan's "+2 item levels" needs resizing
against two-wide bands (it is a full tier jump today, flagged below), but the fact
that the resize is a *number* and not a redesign is the point: item level increments
now mean a defined amount of budget, on a curve, rather than an unpredictable jump
through whatever bonuses happened to stack.

### 4.4 Content authoring gets cheaper and safer

A new endgame piece needs a tier, not a hand-picked source level and a hand-tuned
stat line. The budget is derived, the tests hold it exact, and the guard tests below
mean a contributor who gets it wrong finds out in CI rather than in a player's bags.

### 4.5 The ladder cannot run away again

`ENDGAME_MAX_ILVL` pins the top and a test asserts no live item exceeds it. Under the
old model nothing stopped a new source level from pushing the ceiling higher, which is
precisely how it reached 37.

## 5. Invariants, and what pins them

| Invariant | Pinned by |
|---|---|
| Tier bands are ordered, contiguous and non-overlapping | `tests/item_level.test.ts`, "orders the tiers and keeps them inside the endgame window" |
| No live item exceeds `ENDGAME_MAX_ILVL` | same suite, "keeps every live item level inside the window" |
| Both curves are continuous at the anchor; nothing sub-cap moved | same suite, "anchors the budget curves so nothing below the endgame window moves" |
| Higher item level means higher budget, with one named exception | same suite, "reads higher item level as higher stat budget" |
| Every cap-level item carries exactly its budget | same suite, "all level-20 gear carries exactly its item-level stat budget" |
| Heroic variants land on their tier band and never downgrade their base | `tests/heroic_loot_flair.test.ts` |
| The combat-rating ladder attaches by source, not by an item-level literal | `tests/combat_rating.test.ts` |
| A full WARFARE set reaches exactly 16.8% offence and defence | `tests/pvp_honor_gear.test.ts` |
| Masterworked crafts stay strictly below the raid band | `tests/professions_masterwork.test.ts` |
| No sim behaviour drift | `tests/parity/` golden traces |

## 6. Decisions taken, and their reasons

**WARFARE ratings are decoupled from the PvE budget.** They were authored as "rating
equals the slot's stat budget", so the steeper endgame curve pushed a full honor set
from its designed 16.8% to 17.9% against a 20% cap: a PvP buff falling out of a PvE
change. The allowance is now an explicit per-slot table (`WARFARE_SLOT_RATING` in
`content/pvp_honor.ts`). The load-bearing number is the full-set total, not the
per-piece derivation, so it is now stated where it can be tuned.

**Honor gear shares the heroic five-man band.** It keeps the parity with heroic
dungeon epics it had before, and stays stat-light inside it at 60% of the slot budget,
so the guard that PvP jewelry never out-stats the marks jewelry in PvE still holds.

**Normal raid sits below heroic dungeons.** This inverts the old ladder and is the one
deliberate relative-power change. It is what the stated progression order asks for:
normal dungeons, normal raid, heroic dungeons, heroic raid, legendaries.

**Legendaries split 30 and 31** rather than sharing a rung, so the heroic version of a
legendary is still an upgrade over the normal one.

## 7. Known problem: quality is counted twice

Inside a band the rung already encodes quality, but `primaryStatBudget` still
multiplies by `QUALITY_STAT_MULT`. A sub-epic piece therefore reads a higher item
level than the tier below it while budgeting below it. Measured on a chest, the live
ladder falls the whole way except at one rung:

| item level | chest budget | what |
|---|---|---|
| 21 | 8 | dungeon uncommon |
| 22 | 13 | dungeon rare |
| 23 | 17 | dungeon epic |
| 25 | 19 | raid epic |
| **26** | **16** | **heroic dungeon rare variants (48 items)** |
| 27 | 21 | heroic dungeon epic |
| 29 | 24 | heroic raid epic |
| 30 | 47 | raid legendary |
| 31 | 49 | heroic raid legendary |

The 48 heroic five-man rare variants read 26 while budgeting below both the
item-level-25 raid epics and the item-level-23 dungeon epics. They are still a real
upgrade over their own base (a dungeon rare at 13), which is what the heroic swap
promises, but the number over-sells them against a different item class.

This cannot be fixed inside two-wide bands: at a 0.8 rare multiplier a rare sits about
five item levels below its tier's epic on the curve, so it can never share a two-wide
band with it and stay power-ordered. The options:

1. **Leave it.** The tooltip prints an item score directly beneath the item level, so
   the honest signal is already on screen. Item level over-ranks one item class.
2. **Compress the quality multiplier for cap-level gear only** (rare near 0.95).
   Restores a monotone ladder, but re-budgets roughly 80 shipped items upward, and the
   margin against the raid epics is a tenth of a point, so rounding could flip it per
   slot. Would need a per-slot sweep test rather than a single assertion.
3. **Widen the bands** so each tier spans the full rare-to-epic distance, giving up
   the 21 to 31 window.

Currently option 1, and pinned: the monotonicity test asserts this one named
exception, so a second inversion turns CI red.

## 8. What the squish moved

Measured against the pre-squish tables, not estimated.

| | |
|---|---|
| Items carrying an item level | 366 of 652 |
| Items whose item level changed | 227 |
| Items below the anchor that moved | 0 |
| Authored stat and weapon literals regenerated | 105 |
| Top of the ladder | 37 to 31 |
| Total primary-stat budget across all gear | 4270 to 4418 (+3.5%) |
| Best-in-slot legendary mainhand budget | 49 to 49 |

The tiers that gained are the ones the requested progression deliberately promoted
(heroic five-man rare variants +15%, marks jewelry +18%). The tiers that kept their
place kept their power.

Per-tier movement:

| Before | After | Items | What |
|---|---|---|---|
| 37 | 31 | 2 | Heroic Nythraxis legendaries |
| 33 | 30 | 2 | Nythraxis legendaries |
| 33 | 29 | 15 | Heroic Nythraxis epics |
| 31 | 27 | 24 | Heroic dungeon boss drops |
| 29 | 25 | 12 | Nythraxis raid epics |
| 28 | 27 | 63 | Heroic dungeon variants and WARFARE honor gear |
| 26 | 27 | 10 | Marks jewelry (promoted) |
| 26 | 23 | 21 | Normal dungeon epics |
| 25 | 26 | 48 | Heroic dungeon rare variants (promoted) |
| 23 | 22 | 29 | Normal dungeon rares |
| 21 to 22 | unchanged | 21 | World gear |

## 9. Follow-up work this does not cover

- **Legendary upgrading.** "30+, upgradeable" needs an upgrade system. There is none
  anywhere in the codebase (no `upgradeLevel`, no `itemUpgrade`). Net-new feature work.
- **The Forged plan.** `docs/prd/mythic-plus-and-forged.md` specifies Valeforged as
  "+2 item levels", which against two-wide bands is a full tier jump.
- **`docs/prd/combat-ratings-and-jewelry.md`** still names each tier by its old
  item-level literal. The rating allowances are unchanged and still attach to the same
  pieces; only the numbers naming each tier moved.
