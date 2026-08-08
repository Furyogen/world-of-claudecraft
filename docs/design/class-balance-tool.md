# Balance Bench: the class tuning tool

Status: proposed. Mockup, not yet implemented.

This defines a dev-only tool for finding and fixing class balance outliers. It is the
authoring surface for the measurement contract in `docs/design/spell-balance-framework.md`;
that doc stays the authority on what balance MEANS, this one on how a designer changes it.
Complexity and talent rules remain in `docs/design/class-design-rules.md`.

## Why the current tooling is not enough

`scripts/balance_report.mjs` already computes the right per-spell metrics. Three gaps stop
it from being a tuning surface.

| Gap | What it looks like today |
|---|---|
| No role classification | Every damaging ability is compared against ONE per-class median, so a root, a DoT, and an AoE get measured against nukes. A live run flags `entangling_roots`, `rain_of_fire`, `frost_nova`, `hurricane`, and `curse_of_agony` as WEAK. None of them are nukes, so none of those flags are findings. |
| No cross-class view in the analytical layer | Framework rule 4 (the 10 to 15 percent parity band) is a CROSS-class rule stated in DPS, and the analytical layer does not report it. The same run shows the best caster filler at 43.2 spamDPS (druid `wrath`) against 36.3 (shaman `lightning_bolt`), a 19 percent spread that nothing names as a rule 4 violation. The Monte Carlo simulator does rank specs against each other, but on duel winrate z-scores, which is a different question from the DPS band (see Relationship to the simulator). |
| No write path | A designer reads a number, then hand-edits `src/sim/content/classes.ts`, re-runs the script, and repeats. Nothing shows the effect of a change before making it, and nothing says which pinned tests the change will turn red. |

The false-positive rate is the important one. A tool that cries WEAK at five abilities that
are working as designed trains its reader to ignore it, which is worse than having no tool.

## Relationship to the combat balance simulator

`feature/combat-balance-simulator` adds `scripts/balance_sim/`, a Monte Carlo harness that
runs thousands of real duels and PvE benchmarks on the real `Sim` and reports a brokenness
ranking with Wilson intervals plus per-talent knockout attribution. Its own doc places it
as the ADVERSARIAL layer, above the analytical and target-dummy layers. Balance Bench is
not a replacement for it and must not re-implement it.

The split, stated so neither grows into the other:

| Layer | Question it answers | Owner |
|---|---|---|
| Analytical | Is this ABILITY priced correctly against its peers | Balance Bench |
| Target dummy | What does a rotation actually do over time | `scripts/dummy_sim.mjs` |
| Adversarial | Which SPEC wins fights, and which talent buys the winrate | `scripts/balance_sim/` |

Balance Bench owns the per-ability peer view and the tuning-plus-patch write path, which
the simulator does not provide. Where both can answer a question, the simulator's empirical
result wins: a winrate measured over thousands of real fights outranks a spam-DPS proxy.
The Bench should read the simulator's `balance_report.json` where it exists rather than
computing a second, disagreeing verdict.

## What the tool is

A dev-only single-page tool at `balance.html`, following `music_editor.html`: a root-level
entry served by `npm run dev`, deliberately ABSENT from the `vite.config.ts` build inputs so
it never ships. It composes the real `Sim` and the real content tables, so every number it
shows comes from the shipping simulation rather than a parallel model.

It has three screens and one write path.

### Screen 1: Class parity

The rule-4 view. One row per damage specialization, sustained single-target DPS at the level
cap, sorted, with the 10 to 15 percent band drawn across the chart. A spec outside the band
is the headline finding. Burst and area are reported as separate columns and never averaged
into the sustained number (rules 5 and 6).

Healers get the same treatment against healing throughput per mana, tanks against effective
health and threat. A spec with no comparable peer (a paladin with no caster nuke kit) is
marked "no peer group" rather than being ranked against one it does not belong to.

### Screen 2: Peer table

The fix for the false positives. Every ability is classified into a ROLE bucket, and compared
only inside its bucket, ACROSS classes:

`filler` · `burst_nuke` · `dot` · `aoe` · `execute` · `cc` · `heal` · `hot` · `shield` ·
`utility`

Classification is derived, not hand-maintained: it reads `AbilityDef` (`castTime`, `cooldown`,
`channel`, `range`, `school`) and the effect union in `src/sim/types.ts` (`directDamage`,
`dot`, `aoeDamage`, `aoeRoot`, `heal`, `hot`, `absorb`, and the control effects). A `dot` is
compared against every other class's DoTs on damage per second per mana and uptime cost. A
`cc` is not compared on damage at all: it is measured on duration, cooldown, cost, and school,
because a root that dealt competitive DPS would be the bug.

An ability is flagged only when it is an outlier within its own bucket. On the current tree
that turns five loud non-findings into silence and leaves the real ones visible.

### Screen 3: Workbench

The tuning surface. Pick an ability, get its tunable fields as knobs: `cost`, `castTime`,
`cooldown`, `range`, per-effect `min`/`max`/`total`/`duration`/`interval`, and per-rank
overrides from `AbilityRank[]`. Every knob edit recomputes, live:

- the ability's own metrics and its rank in its peer bucket,
- its owning spec's sustained/burst/area profile,
- the cross-class parity band from screen 1.

So the designer sees "this +12 percent to `lightning_bolt` moves elemental shaman from 19
percent below the leader to 6 percent below, inside the band" before committing to anything.

Two panels sit beside the knobs.

**Blast radius.** Everything else the edited number feeds. Ability mods in
`src/sim/content/spec_baselines.ts` and the talent trees are multiplicative on top of the base
value, so a base change moves every spec that modifies it. The panel lists them with their
resulting values, which is how you avoid fixing arcane at the cost of frost.

**Gate preview.** Which checked-in pins the change breaks, resolved before you write anything:
the proportionality and healer-efficiency assertions in `tests/spell_balance.test.ts`, the
`holy_light` rank-cost pin, and `tests/parity/`, which goes red on ANY sim behavior change by
design. A red parity trace is expected and is regenerated deliberately in its own commit; the
panel says so rather than letting the designer discover it later.

## The write path

The tool never writes a runtime override, and there is no live-tuning knob on a server. A
runtime override layer would fork the three hosts, break `Rng` reproducibility, and put
balance outside git. Instead:

1. The designer tunes until the screens are green.
2. The tool emits a **patch against the content source**: field edits to `ABILITIES` in
   `src/sim/content/classes.ts`, ability mods in `src/sim/content/spec_baselines.ts`, or the
   talent tables. Data-as-code stays the single source of truth.
3. The patch is shown as a unified diff, with a generated Conventional Commit body naming the
   measured before and after.
4. The designer applies it, runs `node scripts/gate_select.mjs`, and reviews the parity diff.

This keeps every existing invariant intact: one sim across three hosts, determinism, balance
history in git, and the gate as the merge bar.

## Reuse, not reinvention

The tool is a thin surface over modules that already exist or should be extracted from the
scripts, so the CLI and the SPA cannot drift:

| Piece | Where it lives |
|---|---|
| Analytical per-spell metrics | `scripts/lib/balance_metrics.mjs` (pure, scaling injected, pinned by `tests/balance_metrics.test.ts`), already imported by `scripts/balance_report.mjs` and ready for the tool |
| Role classification | new pure module, derived from `AbilityDef` + the effect union |
| Empirical profiles | `scripts/dummy_sim.mjs` promoted to the three framework profiles (sustained 180s, burst 60s, area 60s/5 targets) |
| Reference character | the existing `refChar`/`setup` pattern: a real `Sim`, `setPlayerLevel(MAX_LEVEL)`, fixed seed |
| Regression pins | `tests/spell_balance.test.ts`, extended per bucket |

Per the module-first rule, the metric and classification cores are host-agnostic modules with
their own Vitest suites, and the SPA is a thin consumer. That is what lets the peer table be
unit-tested without a browser.

## Known limitation to close first

`analyzeAbility` applies the Spell Power rider through the cast-time coefficient
(`directHitBonus`), which ignores a per-effect `spellPowerCoeff`. On the shipping tree that
field appears only on ABSORB effects (the mage barriers, consumed in
`combat/effect_dispatch.ts`), so nothing damage-facing reads it and the metrics are correct.
The in-flight class rework puts `spellPowerCoeff` on `directDamage` effects, and at that
point both the existing report and the extracted module would mis-price every ability
carrying one. Teaching the analytical layer to honor a per-effect coefficient is a
prerequisite for trusting the Bench against a reworked tree, not a follow-up.

## Non-goals

- Not a live server tuning console. See The write path.
- Not an auto-balancer. It proposes nothing on its own; a human picks the change, and rule 3
  (one owner per output) still means naming which slot pays for the power.
- Not a replacement for the framework. It measures and edits; `spell-balance-framework.md`
  still decides what a legal result is, and gameplay coefficients still need a classic-era
  formula or a measured result behind them.
