# Item level squish: the feasibility measurement

Status: **historical record.** This is the measurement that chose the design, kept
for the reasoning and for the numbers on the options that were NOT taken. The living
reference for the shipped system is `docs/design/item-level-ladder.md`.

Every number below was measured against the live content tables on `v0.28.0`, not
estimated. "Before" describes the pre-squish ladder.

## The question

Gear currently reaches item level 37 while the level cap (`MAX_LEVEL`,
`src/sim/types.ts`) is 20. The concern is forward-compatibility: when the cap
moves to 30, 40 or 80, the derived item-level ladder walks up with it and future
tiers collide with numbers this tier already spent.

The proposed squish anchors each endgame tier to a tight band:

| Tier | target item level |
|---|---|
| Normal dungeons (Sanctum and the other level-20 five-mans) | 21 to 23 |
| Normal Nythraxis (10-player raid) | 24 to 25 |
| Heroic dungeons | 26 to 27 |
| Heroic Nythraxis | 28 to 29 |
| Legendaries (upgradeable) | 30+ |

## How this was measured

Item level is not authored per item. It is derived, memoized, and pure over the
static content tables in `itemLevel` (`src/sim/item_level.ts`):

```
itemLevel = sourceLevel + QUALITY_ILVL_BONUS[quality] + (raid ? RAID_ILVL_BONUS : 0)
```

Three throwaway probes were run under Vitest against the real `ITEMS` table:

1. A census of every item-level-bearing item, grouped by derived level, quality,
   source level, and heroic/raid flags.
2. A cost model applying the target bands and recomputing `primaryStatBudget`
   and `weaponDpsBudget` per item.
3. A prototype squish wired into `itemLevel` itself, followed by a full
   `npx vitest run`, to count the real test blast radius.

## Finding 1: item level never persists and never crosses the wire

`grep` over `server/`, `headless/`, and `python/` returns zero references to item
level. It is recomputed from static tables on every host, so a squish carries:

- no database migration,
- no JSONB save/load compatibility work,
- no wire protocol or snapshot change,
- no character-data risk of any kind.

This is the single biggest de-risking fact. A squish is a content and balance
exercise, not a persistence one.

## Finding 2: the current ladder

366 items carry a derived item level (out of 652 total). The endgame:

| Item level | What | Count |
|---|---|---|
| 21 | level-18/20 world rares, level-20 uncommons | 18 |
| 22 | stray level-19 rares plus one epic | 3 |
| 23 | normal level-20 dungeon rares | 29 |
| 25 | heroic five-man rare variants (`heroicOf`), one epic | 49 |
| 26 | normal level-20 dungeon epics, Heroic Quartermaster jewelry | 31 |
| 28 | WARFARE PvP epics (40), heroic five-man epic variants (23) | 63 |
| 29 | normal Nythraxis raid epics | 12 |
| 31 | heroic-only five-man boss drops (`HEROIC_BOSS_LOOT`) | 24 |
| 33 | Heroic Nythraxis epics (15), normal Nythraxis legendaries (2) | 17 |
| 37 | Heroic Nythraxis legendary variants | 2 |

## Finding 3: the target bands are not expressible in the current model

Two structural blockers, both in the derivation formula:

- **The quality bump alone is wider than the whole target window.**
  `QUALITY_ILVL_BONUS` (`src/sim/item_budget.ts`) spans 1 (uncommon) to 10
  (legendary). One instance dropping both a rare and a legendary therefore
  produces a 9-wide item-level spread. The entire target endgame window from
  normal dungeons to legendaries is 10 wide.
- **The rare-to-epic gap has to differ per tier.** The target needs a gap of 2
  inside the normal-dungeon band (rare 21, epic 23) but a gap of 1 inside the
  raid and heroic bands (24/25, 26/27, 28/29). A single global quality table
  cannot produce both.

So the squish is a model change, not a constant tweak: cap-level content has to
be anchored to an explicit tier band, and the derived `source + quality + raid`
sum has to stop being the source of truth there. Sub-cap leveling gear can keep
the derived model unchanged, which is what the measurements below assume.

## Finding 4: the target reorders tiers, it does not only compress them

Today normal Nythraxis raid epics (29) outrank heroic five-man epic variants
(28), and heroic-only five-man boss drops (31) outrank all raid gear except the
legendaries. The requested progression puts every heroic dungeon reward above
every normal raid reward. That is a deliberate relative-power change, not a
renumber, and it is the reason no budget curve can preserve every tier's power
through the squish (see Finding 6). Concretely, under the target bands:

- heroic five-man rare variants move up one tier (25 to 26),
- normal Nythraxis raid epics move down relative to heroic five-mans (29 to 25),
- heroic-only five-man boss drops move down four levels (31 to 27).

## Finding 5: the cost of a naive squish (bands only, curve untouched)

`primaryStatBudget` is proportional to item level (`STAT_PER_ILVL`, currently
0.7) and `weaponDpsBudget` is linear in it. Squishing the bands without touching
the curve therefore squishes player power:

- 227 of 366 item-level-bearing items change level.
- Total primary-stat budget across all gear falls 6.5% (4270 points to 3993).
- The top of the ladder is hit hardest: heroic raid legendaries -16.3%,
  heroic-only five-man epics -13.3%, Heroic Nythraxis epics -13.2%, normal raid
  epics -12.4%, normal dungeon epics -12.8%.

Per slot, for the pieces a player actually feels:

| Tier | item level | epic chest budget | 1H weapon dps curve |
|---|---|---|---|
| normal dungeon epic | 26 to 23 | 18 to 16 | 14.5 to 13.6 |
| normal raid epic | 29 to 25 | 20 to 18 | 15.4 to 14.2 |
| heroic five-man epic variant | 28 to 27 | 20 to 19 | 15.1 to 14.8 |
| heroic-only five-man epic | 31 to 27 | 22 to 19 | 16.0 to 14.8 |
| heroic raid epic | 33 to 29 | 23 to 20 | 16.6 to 15.4 |
| heroic raid legendary | 37 to 31 | 49 to 41 | 17.8 to 16.0 |

A power drop of that size at the top invalidates the tuning of the content that
drops it: `HEROIC_DUNGEON_TUNING` (`src/sim/content/dungeon_difficulty.ts`) and
the Nythraxis encounter were sized against today's gear.

### Rewrite surface

- 142 hand-authored stat lines (`src/sim/content/items.ts`, `zone3.ts`,
  `heroic_loot.ts`, `heroic_vendor.ts`, `pvp_honor.ts`) have to be re-budgeted,
  because `tests/item_level.test.ts` pins every level-20 item to
  `expectedStatBudget` exactly.
- 85 heroic variants rescale themselves at data-eval time
  (`buildHeroicVariants`, `src/sim/content/heroic_variants.ts`) and cost nothing.
- 46 weapons fall off the dps curve and need their `min`/`max` rewritten.

## Finding 6: the budget curve is the real decision, and an affine curve fixes it

Two consequences of `primaryStatBudget` being proportional to item level:

1. A squish shrinks absolute power (Finding 5).
2. Worse, it shrinks the step BETWEEN tiers. At `STAT_PER_ILVL` 0.7 a one-level
   tier gap is worth 0.7 stat points before slot weighting, so most of the
   squished ladder would move by a single point per slot per tier. That is the
   complaint `docs/prd/combat-ratings-and-jewelry.md` already raises about the
   current ladder ("ilvl 31 does not feel different from ilvl 26/28"), and the
   squish makes it strictly worse.

Both are fixable by changing the curve from proportional-to-item-level to
affine, anchored at the bottom of the endgame:

```
budget = round((BASE + PER_ILVL * (ilvl - ANCHOR)) * qualityMult * slotMult)
```

Fitting `ANCHOR = 23`, `BASE = 18`, `PER_ILVL = 5/6` against the target bands was
measured across the whole table. Result: every tier that keeps its relative
position keeps its exact budget (normal dungeon rares, normal dungeon epics,
normal raid epics, Heroic Nythraxis epics all land at 0.0% drift), and the total
budget moves +3.8% instead of -6.5%. The residual drift is exactly the
intentional reorder from Finding 4: heroic five-man rare variants +15.1% and
heroic five-man epic variants +6.1%, because those tiers were deliberately moved
up.

Two caveats on the affine curve as fitted:

- 37 of 118 sub-cap items shift by one point from rounding, and two very low
  items (item level 3 and 5 uncommons) round to a budget of 0, which would strip
  their stats entirely. Both are avoided by keeping the existing proportional
  form below the endgame anchor and making the curve piecewise, at the cost of a
  one-point seam at item level 21.
- `weaponDpsBudget` needs the same treatment or weapons re-drift.

## Finding 7: measured test blast radius

The prototype squish (bands only, no content re-budgeting) was run against the
full suite: **8 test files, 18 tests**. Three further failures in that run
(`i18n_status_registry`, `localization_fixes`, `ai_review`) were environmental,
from running Vitest without the `pretest` i18n generation step, and are unrelated.

| Test file | What breaks |
|---|---|
| `tests/item_level.test.ts` | tier pins (26/29/31/33/37), the raid-bonus delta, budget exactness |
| `tests/heroic_loot_flair.test.ts` | variant tier pins and the weapon dps curve sweep |
| `tests/combat_rating.test.ts` | the rating ladder is selected by live item level |
| `tests/heroic_vendor.test.ts` | ilvl-26 jewelry pins and the ring/neck budgets |
| `tests/nythraxis_raid.test.ts` | raid tier pins |
| `tests/pvp_honor_gear.test.ts` | WARFARE ilvl-28 pins |
| `tests/twohand_itemization_v026.test.ts` | two-hander tier and premium pins |
| `tests/twohand_rebudget.test.ts` | two-hander budget and dps curve |

All eight are pin updates, not logic breakage. Nothing in `src/sim/` outside the
item-level leaves needed a code change to make the prototype run.

## Finding 8: coupled systems

- **Combat ratings are keyed to item-level bands.** The allowance ladder in
  `src/sim/content/heroic_loot.ts` and `heroic_variants.ts` (and its sweep in
  `tests/combat_rating.test.ts`) selects pieces by live `itemLevel`. Under the
  prototype the ilvl-31 selector matched zero items. The whole rating ladder in
  `docs/prd/combat-ratings-and-jewelry.md` has to be re-anchored in the same
  change. That doc alone carries 46 item-level references.
- **Equip gating is unaffected.** `requiredLevelFor` (`src/sim/item_level_req.ts`)
  reads `itemSourceLevel`, not `itemLevel`, so the level gate does not move.
- **Crafting is unaffected.** `itemLevelBudget` on recipes is a separate gold-sink
  number, not the derived item level.
- **The Forged plan needs resizing.** `docs/prd/mythic-plus-and-forged.md`
  specifies Valeforged as "+2 item levels". Against 2-wide bands that is a full
  tier jump.
- **Legendary upgrading does not exist yet.** There is no upgrade system anywhere
  in the codebase (no `upgradeLevel`, no `itemUpgrade`). "Legendaries at 30+ and
  upgradeable" is net-new feature work, not part of the squish.
- **UI cost is one line.** The tooltip readout in `src/ui/hud.ts` is already
  parameterized (`hudChrome.options.itemLevelLine`), and the guide prose in
  `src/ui/i18n.catalog/guide.ts` quotes no numbers, so there is no i18n work and
  no wiki regeneration.

## Options and effort

**Option A: display-only squish.** Keep the derived level as the internal budget
driver, add a separate display band. Roughly a day: one pure leaf plus pin
updates. Zero balance change, zero content re-authoring. Cost: item level stops
predicting stat budget, which contradicts the model the repo documents and the
budget-exactness gates would have to switch to the internal level.

**Option B: true squish, accept the power loss.** Bands plus 142 re-budgeted stat
lines and 46 weapon damage rewrites, then a retune pass on
`HEROIC_DUNGEON_TUNING` and the Nythraxis encounter to match roughly 13% less
gear power at the top. Several days, and the retune is the risky part.

**Option C (recommended): true squish plus an affine budget curve.** Bands plus
the curve change from Finding 6. The measured result preserves absolute power on
every tier that keeps its position, so no encounter retune is needed, and it
widens the per-tier step instead of narrowing it. Content still gets re-budgeted
mechanically (the budget is derived, so the work is regenerating stat lines to the
new curve, not designing them), and the combat-rating ladder is re-anchored in the
same change. Estimate: comparable to Option B in mechanical churn, materially
lower in balance risk.

## What shipped

Option C, with the decisions below taken as stated. The shipped ladder:

| Tier | uncommon / rare | epic | legendary |
|---|---|---|---|
| normal five-man dungeons (and the level-20 world, and level-20 recipes) | 21 / 22 | 23 | 30 |
| normal Nythraxis raid | 24 | 25 | 30 |
| heroic five-man dungeons (drops, marks jewelry, WARFARE honor gear) | 26 | 27 | 31 |
| heroic Nythraxis raid | 28 | 29 | 31 |

`src/sim/item_tier.ts` owns the bands; `itemLevel` anchors any cap-level source to
its tier and leaves sub-cap sources on the derived ladder. `item_budget.ts` carries
the piecewise curve: the levelling slope (`STAT_PER_ILVL` 0.7, dps 0.3/ilvl) up to
the anchor at item level 21, then `ENDGAME_STAT_PER_ILVL` 1.1 and
`ENDGAME_DPS_PER_ILVL` 0.48 above it. The two segments meet at the anchor, so every
sub-cap item's budget is byte-identical to before.

Measured against the pre-squish tables: 227 items changed item level, the top of the
ladder fell from 37 to 31, total primary-stat budget across all gear moved +3.5%,
and 105 authored stat and weapon literals were regenerated onto the new curve. The
tiers that kept their place in the ladder stayed within a couple of points of their
old budgets (top-tier legendaries landed exactly on their old 49-point mainhand
budget); the ones that gained are the tiers the requested progression deliberately
promoted.

Two things the measurement did not anticipate:

- **A sub-cap source could derive into a tier band it had not earned.** A level-19
  epic derived to item level 25, landing on the raid rung. `itemLevel` now clamps
  any derived (sub-cap) level to the top of the first endgame band, so the window
  above it belongs exclusively to anchored content. One item moved (25 to 23).
- **WARFARE ratings could not stay tied to the PvE budget.** They were authored as
  "rating equals the slot's stat budget", so the steeper endgame curve pushed a full
  honor set from the designed 16.8% to 17.9% against a 20% cap. The allowance is now
  an explicit per-slot table (`WARFARE_SLOT_RATING`), decoupled from the PvE curve,
  and the full-set total is unchanged at 16.8%.

## The one thing the bands do not fix: quality is counted twice

Inside a band, the rung already encodes quality (rare takes the low rung, epic the
high one), but `primaryStatBudget` still multiplies by `QUALITY_STAT_MULT`. A
sub-epic piece therefore reads a higher item level than the tier below while
budgeting below it. Measured on a chest, across the live ladder:

| item level | budget | what |
|---|---|---|
| 21 | 8.1 | dungeon uncommon (6 items) |
| 22 | 12.6 | dungeon rare (32 items) |
| 23 | 16.9 | dungeon epic (21 items) |
| 25 | 19.1 | raid epic (13 items) |
| **26** | **16.2** | **heroic dungeon rare variants (48 items)** |
| 27 | 21.3 | heroic dungeon epic (97 items) |
| 29 | 23.5 | heroic raid epic (15 items) |
| 30 / 31 | 46.7 / 48.8 | raid / heroic raid legendaries |

Exactly one rung inverts: the heroic five-man rare variants read 26 while budgeting
below both the item-level-25 raid epics and the item-level-23 dungeon epics. They
are still a clear upgrade over their own base (a dungeon rare at 12.6), which is
what the heroic swap promises, but the tooltip number over-sells them against a
different item class.

This cannot be fixed inside the requested band widths. With a rare multiplier of
0.8, a rare sits about five item levels below its tier's epic on the budget curve,
so it can never share a two-wide band with it and stay power-ordered. The options:

1. **Leave it.** The tooltip prints an item score directly under the item level, so
   the correct signal is on screen; item level over-ranks one item class.
2. **Compress the quality multiplier for cap-level gear only** (rare around 0.95).
   Restores a monotone ladder, but re-budgets roughly 80 shipped items upward and
   the margin against the raid epics is one tenth of a point, so rounding could flip
   it per slot.
3. **Widen the bands** so each tier spans the full rare-to-epic distance, which
   means giving up the 21-to-31 window this change was asked to produce.

Left as option 1 pending a call, and pinned: `tests/item_level.test.ts` asserts the
ladder is monotone with this one named exception, so a second inversion reddens.

### Decisions taken

1. **WARFARE PvP gear shares the heroic five-man band** (item level 27), keeping the
   parity with heroic dungeon epics it had before, and stays stat-light inside it
   (60% of the slot budget), so the badge-jewelry guard still holds.
2. **Legendaries split 30 (normal) / 31 (heroic)** and sit in their own band above
   every tier, since they are the pieces meant to carry an upgrade path later.
3. **Normal raid sits below heroic dungeons**, as the requested progression states.
   This inverts the old ladder and is the one deliberate relative-power change.
4. **Sub-cap items do not move**, guaranteed by the continuity of the curve at the
   anchor and pinned by a test that sweeps every level up to it.
5. **The bands are still literals, not offsets from `MAX_LEVEL`.** Open. They now
   live in one table, so a future cap can either take the next window or re-anchor
   these, but nothing yet forces that choice.

## Follow-up work this does not cover

- **Legendary upgrading.** "30+, upgradeable" needs an upgrade system, which does
  not exist anywhere in the codebase yet.
- **The Forged plan.** `docs/prd/mythic-plus-and-forged.md` specifies Valeforged as
  "+2 item levels", which against these bands is a full tier jump and needs
  resizing.
- **`docs/prd/combat-ratings-and-jewelry.md`** still describes the ladder by its old
  item-level literals. The rating allowances themselves are unchanged and still
  attach to the same pieces; only the numbers naming each tier moved.
