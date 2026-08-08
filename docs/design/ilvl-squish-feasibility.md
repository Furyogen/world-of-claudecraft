# Item level squish: feasibility measurement

Status: investigation only, no gameplay change proposed for merge yet. Every
number below was measured against the live content tables on `v0.28.0`, not
estimated. The prototype used to measure the test blast radius was reverted.

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

## Open decisions before implementing

1. **Where does WARFARE PvP gear land?** It sits at 28 today, level with heroic
   five-man variants. The target list does not mention PvP. The measurement
   assumed 26 (level with heroic dungeon entry); `src/sim/content/pvp_honor.ts`
   documents an explicit intent that PvP jewelry never out-stats the PvE badge
   jewelry, so this needs a deliberate call.
2. **Do normal and heroic Nythraxis legendaries share item level 30, or split
   30/31?** The measurement assumed 30 and 31.
3. **Is the normal-raid-below-heroic-dungeon ordering intended?** It is what the
   listed progression says, and it inverts today's ladder.
4. **Do sub-cap (item level under 21) items move at all?** The measurement left
   them alone.
5. **Does the band anchor scale with `MAX_LEVEL`?** If each future cap should own
   its own item-level window, the bands want to be expressed as offsets from the
   cap rather than as literals, or the same collision returns at cap 30.
