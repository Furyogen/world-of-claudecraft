# Professions 2.0: progress

Update this file at the end of every implementation and QA session. Statuses:
`not started` / `in progress` / `complete` / `deferred (note why)`.

## Status table

| Phase | Title | Status | Started | Completed |
|---|---|---|---|---|
| 1 | Ring and identity foundations | complete | 2026-07-16 | 2026-07-17 |
| 1 QA | Verify ring and identity foundations | complete | 2026-07-17 | 2026-07-17 |
| 2 | Masterwork model | complete | 2026-07-17 | 2026-07-17 |
| 2 QA | Verify masterwork model | complete | 2026-07-17 | 2026-07-17 |
| 3 | Host-parity bug fixes | complete | 2026-07-17 | 2026-07-17 |
| 3 QA | Verify host-parity bug fixes | complete | 2026-07-17 | 2026-07-17 |
| 4 | Node materials and pristine veins | complete | 2026-07-18 | 2026-07-18 |
| 4 QA | Verify node materials and pristine veins | complete | 2026-07-18 | 2026-07-18 |
| 5 | The professions wheel window | complete | 2026-07-18 | 2026-07-18 |
| 5 QA | Verify the professions wheel window | not started | | |
| 6 | Crafting window upgrades and celebrations | not started | | |
| 6 QA | Verify crafting window upgrades | not started | | |
| 7 | The Guild letter and quest objectives | not started | | |
| 7 QA | Verify the Guild letter and quest objectives | not started | | |
| 8 | Stations and masters (sim and server) | not started | | |
| 8 QA | Verify stations and masters | not started | | |
| 9 | Station presence and recipe training | not started | | |
| 9 QA | Verify station presence and training | not started | | |
| 10 | Recipe ladders and materials content | not started | | |
| 10 QA | Verify recipe ladders and materials | not started | | |
| 11 | Fishing joins the framework | not started | | |
| 11 QA | Verify fishing framework | not started | | |
| 12 | Base tool tier gating | not started | | |
| 12 QA | Verify tool tier gating | not started | | |
| 13 | Enchanting reachable | not started | | |
| 13 QA | Verify enchanting reachable | not started | | |
| 14 | Attunement quests and nudges | not started | | |
| 14 QA | Verify attunement quests and nudges | not started | | |
| 15 | Deeds, tuning, and polish | not started | | |
| 15 QA | Final integration QA and packet teardown | not started | | |

## Per-phase deliverable checklists

Each phase file (`phase-NN-*.md`) carries the authoritative acceptance
criteria; mirror the checkboxes here as phases complete.

### Phase 1: Ring and identity foundations
- [x] `CRAFT_RING` adopts the blueprint ring order (design-doc order); geometry tests re-pinned
- [x] `ArchetypeState` carries per-archetype attunement history (JSONB additive, back-compat load)
- [x] Combo eligibility requires the matching attunement in the shared rule, both hosts
- [x] Pair-named archetype title keys land (Smith, Outfitter, Apothecary, Bombardier + the six future pairs)
- [x] PR 2039 should-fix items resolved; ring adoption landed on the PR 2039 head pre-merge

Phase 1 QA (2026-07-17): PASS, zero blocking findings across the packet's
three audit roles plus the full review dispatch matrix (architecture,
frontend seam, cross-platform sync, privacy/security, migration safety,
pin quality, qa-checklist). The save-compat stopping rule was evaluated
and NOT triggered (v0.26.0 shipped the acceptance quests retired, the
ClientWorld archetype methods as no-op stubs, and no UI caller, so no
player-held save carries old-ring pair ids; an executed round-trip fixture
confirmed drop-by-design plus stable canonical ids). QA landed: coverage
additions for the pair helpers, transition state machine, resolved-count
credit, and a same-seed determinism pin; the one loosened hobby re-pin
restored to exact literals; the nythraxis interact-credit site routed
through questObjectiveRequired; a minimal accuracy pass over the
guide.professions wiki prose (full rewrite stays Phase 15). Deferred, with
notes in state.md: the hobby-switch XP repeatable (maintainer balance
decision), the COMBO_RECIPES record field order (cosmetic), legacy
IWorldProfessions member retirement (Phase 15 candidate).

### Phase 2: Masterwork model
- [x] Craft outputs deterministic; five-way quality roll retired; `trivialAt` retired
- [x] Masterwork proc (skill, self-signed, specialization inputs) with pinned rng-draw contract
- [x] Masterwork stats baked via `item_budget` into `instance.rolled.stats`; deeds reader still coherent
- [x] Masterwork SimEvent with celebration payload; power-ceiling tuning targets in `state.md`

Phase 2 QA (2026-07-17): PASS, zero blocking findings across the packet's
three audit roles plus the matched dispatch-matrix rows (architecture,
cross-platform sync, privacy/security, migration safety, pin quality,
qa-checklist; frontend seam and database performance were NO-MATCH for
this diff). The phase-emphasis probes all bind: an inserted extra rng
draw reddens five tests across three suites, a 2-tier bump reddens the
raid-floor bound through its literal tripwire pins (the derived sweep
moves with the model by design; the literal rows are the teeth, never
delete them thinking the sweep suffices), and the legacy rolled.quality
path is proven end to end in both hosts. QA landed: proc-chance wiring
pins through the real craft path (self-signed at hunted seed 69, the
joint specialization-plus-tier 74/75/76 boundary at hunted seed 2,
spares recorded in-file), the ClientWorld craftResult mirror's
masterwork flag, the top-level enchant marker save/load round trip, an
observed-roll pin making the miss-arm's seed-1 premise load-bearing,
an inv-snapshot passthrough pin (masterwork and legacy instance
payloads reach the client byte-identical), and the quality-roll
retirement cleanup (dead clampMaterialRarity deleted with its orphan
test pin; the area CLAUDE.md re-taught the deterministic model). One
audit finding dissolved on verification: the reported vestments armor
anomaly is the displaced starter recruit_tunic (delta 30 minus 20),
not a bug. Deferred with reasons: the 0.15-cap integration hunted pin
(the clamp is pure-function pinned and every term wiring is craft-path
pinned; a fourth hunted seed adds maintenance without coverage), and
the online-inspect equippedInstances gap (pre-existing, recorded in
the state.md drift notes for the Phase 6 surfacing decision).
Mixed-fleet safety verified: the previous release's HUD event if-chain
ignores unknown SimEvent types, so a new server's masterwork event is
harmless to an old client.

Phase 3 QA (2026-07-17): PASS, zero blocking findings across the
packet's three audit roles plus the matched dispatch-matrix rows
(architecture, cross-platform sync, pin quality, qa-checklist;
privacy/security, migration safety, frontend seam, and database
performance were NO-MATCH for the QA diff). One real correctness
defect found and fixed test-first, in the pre-landed PR 2045 trade
code rather than the phase diff: tradeConfirm ran the a-to-b transfer
to completion before removing b's give, so same-itemId bidirectional
trades cross-contaminated (a swapped instance bounced straight back
to its owner; a plain-for-instance offer spared the instance and
mis-routed a plain copy). The swap is now two-phase (removeOffer both
sides, then grantOffer both sides), matching the model fitsAfterSwap
already validated; conservation held in all variants, so no dupe or
loss ever occurred. QA landed: the two sequencing repro pins (revert
experiment confirms both red on the old code and only they guard the
reorder), a partial-stack sparing pin (removePreferFungible must
choose), a no-escrow cancel contract pin, the live GameServer
broadcast suite for hcb (claim-after-first-sight arrives as a lite
dyn-only record, pinned by hcb-present plus no-nm; interest-scope
eviction and re-entry deliver claims AND clears made out of view, and
a delta-guarded mirror mutation reds the clear arm), and the
claimed-corpse arms of corpseLootAvailability (self-claimed viewer,
claimed-by-another, claimed-with-personal-loot stays openable). Docs:
the hcb as-landed deviation swept into the phase file and QA twin
(the amend-the-twin trap), the phantom bandwidth hcb pin claim
corrected (the snapshots sparse-absence assertion is the no-bloat
tooth), the bareClient drift note rescoped to the real 21-copy
repo-wide idiom (extraction filed as #2088, a standalone chore), and
the Phase 4 despawn-grace heads-up recorded. Deferred with reasons: a
bandwidth claimed-corpse scenario (docs now truthful instead; the
sparse-absence pin covers the regression that matters) and a
distinct-itemId slot-order byte-equivalence pin (the push-to-end plus
splice-compaction reasoning is airtight per the architecture review).
- [x] Trade carries `ItemInstancePayload` end to end (regression test)
- [x] `harvestClaimedBy` mirrored online; corpse picker stops offering claimed corpses
- [x] Crafting view consumes the shared combo-eligibility rule in both hosts

Completed 2026-07-17. The trade code fix had pre-landed on release via
PR 2045; this phase added the missing bidirectional full-payload pin
(signer, charges, rolled including the masterwork marker, enchant,
boundTo, both directions in one mixed trade). harvestClaimedBy rides
the per-entity wire as the sparse hcb key (server/game.ts dynamicFields
emit, unconditional ClientWorld reset in src/net/online.ts), pinned by
the round-trip suite in tests/snapshots.test.ts and the online-picker
parity suite in tests/corpse_harvest_sim.test.ts; hcb is deliberately
NOT in ALL_DELTA_KEYS / TERSE_TO_IWORLD (those pin selfWireJson maybe()
self keys; the per-entity round-trip pins are the teeth, with the
snapshots sparse-absence assertion as the no-bloat pin; bandwidth stays
green but has no hcb-specific scenario).
Combo-gating liveness pinned in
tests/crafting_view_combo_liveness.test.ts (Sim and ClientWorld arms
fed by a real cprof broadcast; decisiveness mutation-tested). Review
fan-out (cross-platform-sync, privacy-security, qa-checklist,
test-coverage-auditor): PASS, zero blocking. Deferred to Phase 4:
src/main.ts still passes harvestStateReliable = (online === null) at
the three interaction open-gate sites, so the truthful mirror is not
yet consumed at the online OPEN gate (harvest-only corpses still do
not open online, pre-existing); flip with an open-gate test when
Phase 4 makes gathering trust corpse claims (details in state.md).

### Phase 4: Node materials and pristine veins
- [x] Per-rarity node material tables replace placeholder junk (zone-1 stays low-tier)
- [x] Rare+ node yields signed like corpse yields
- [x] Per-node-type rare events: pristine vein / ancient heartwood / moonlit bloom (spawns, per-flavor soft broadcasts, deed-mark hooks)
- [x] `gatherResult` consumed: gather cue + rarity-colored loot line

Completed 2026-07-18 (phase-start HEAD 4d8b32d09, the release/v0.28.0 tip
with Phase 3 QA aboard). `NODE_MATERIAL_TABLE` in
`src/sim/professions/gathering.ts` grants zone-tiered materials (four new
low-tier defs; zones 2 and 3 reuse the existing recipe-consumed premium
reagents, closing the loop the TOOL_RECIPE_STUBS note forward-declared);
zone 1 grants only the sellValue-4 starters per the stockpiling
mitigation, pinned with a non-vacuous negative arm. resolveHarvest draws
twice (rarity, then the 1/90 rare-event roll in the new
`gather_events.ts` module); the one-draw pins were re-pinned deliberately.
Rare events are five-fold always-signed yields with a per-recipient
soft-zone broadcast (the Phase 6 reuse mechanism; instance space excluded
via DUNGEON_X_THRESHOLD) and dormant `gather_event:<flavor>` deed marks.
The Phase 3 deferral landed: main.ts's three open-gate sites now trust
the hcb mirror (`tests/gather_open_gate.test.ts` pins both arms plus the
pre-existing INTERACT_RANGE + 1 open boundary, which keeps despawn-grace
corpses out of reach). The HUD consumes gatherResult as a rarity-colored
"You gather:" line worded apart from the grant hub's "You receive:" loot
line with no second cue (review catch: the first draft double-logged and
double-played; five-reviewer fan-out, zero blocking after fixes). A new
parity scenario `professions_gather` (seed 3) pins the draw order across
hosts; no existing golden changed. gatherResult gained qty and rareEvent
fields; the cue reuses existing sampled SFX (new cues are
manifest-gated). Deferred: node tier gating (Phase 12), recipe
consumption of the new materials (Phase 10), rare-event deed authoring
(Phase 15), a live-server instance-exclusion broadcast arm (unit-level
covered).

Phase 4 QA (2026-07-18): PASS with fixes. Three packet audits plus the
four matched dispatch-matrix rows (architecture, cross-platform sync,
frontend seam, qa-checklist; privacy/security, migration safety, and
database performance were NO-MATCH), all seven reports complete first
try with the hard tool-call budgets baked in. REAL FIND, fixed
test-first: the signed harvest grant could overflow bag capacity by one
slot per rare-or-better roll (the fungible canAddItem pre-gate passes
on stack top-up room while a signed instance needs a fresh slot;
runtime-confirmed via the crossing case of a slot-full bag holding a
partial stack of the zone material). Every signed unit now requires a
genuinely free slot, with an unsigned stack top-up fallback when none
exists, so the truncation contract wins over signing in that edge; the
draw order and the professions_gather golden are byte-identical. The
corpse focus-harvest path carries the same pre-existing hole (it was
the cited precedent) and is filed as #2139, deliberately not fixed
here because it sits outside the phase diff. QA also landed: the
crossing-case pin, the finder-only achievement-cue pin plus
quality-color source pins (the unpinned halves of the D1 contract and
acceptance criterion 5), and comment corrections (the gatherLine
catalog comment described the exact loot-family wording the divergence
pin forbids; the gathering.ts header still claimed no world nodes
exist; gatherRareEvent's spare fields named as Phase 15 forward
payload; corpseLootAvailability's harvestStateReliable documented as a
deliberately retained seam whose false arm stays pinned POSITIONALLY
in tests/corpse_loot_availability.test.ts and tests/interactions.test.ts,
which a name-only grep misses, an audit claim that dissolved exactly
there). Verified dismissals: finderName cannot smuggle the [[i:
item-link token (validCharNameShape forbids brackets), and all four
phase-emphasis probes bind. Deferred with reasons: the rare-event
windfall's per-instance loot-line/cue burst (consistent with the D1
cue-ownership decision, Phase 15 polish candidate), the zone-1 signed
starter instances design confirm (maintainer, see state.md), the
gatherEvent.* top-level catalog namespace (functional, moving it now
is overlay churn without user value), and the pre-existing unused
instanceOrigin import in tests/parity/scenarios.ts.

### Phase 5: The professions wheel window
- [x] New window at deeds quality per DESIGN.md: view core (UI_PURE_CORES), painter, styles, i18n
- [x] Ring visualization, per-craft skill bars, tier pips, title/majors/hobby, live perks
- [x] Identity-view semantics preserved (role, ceiling, nudges, tutorial); next-unlock and switch-cost lines
- [x] Progressive disclosure: simplified unattuned / pre-first-tier state
- [x] Desktop + mobile responsive; screenshots captured for the PR
- [x] Launchers (minimap or window row + keybind) consistent with existing windows

Completed 2026-07-18 (phase-start HEAD c1b6c68f2, the release/v0.28.0 tip
with Phase 4 QA aboard). Pure UI on post-2039 reads: no wire data, no sim
behavior, no IWorld member. `src/ui/professions_view.ts` (UI_PURE_CORES)
COMPOSES `profession_identity_view` rather than absorbing it (recorded
decision: the crafting window and quest dialog keep consuming the card,
and Phase 6 owns the crafting window), so role, ceiling, both nudges, and
the tutorial state survive by construction; it adds the ring layout math
(wrap-safe pair arc, hobby chord), bars and pips with core-derived fill,
the perks readout from `PERK_THRESHOLDS`, the next-unlock union, the
switch-cost line via `requiredAmendsProgress`, progressive disclosure,
and the refresh signature. `src/ui/professions_window.ts` is a
deeds-pattern cold painter; the ring renders as DOM nodes over one inline
SVG styled entirely from `components.css` tokens (recorded decision over
canvas: theme and language switches restyle with no token caching).
Launchers: minimap micro-button, More-tray entry, and Shift+KeyP (bare
KeyP is the spellbook). Icons: fourteen procedural recipes plus
`professionIconUrl` over an empty committed WebP override set, the
`assets:professions` converter scaffold, and a bijection test green on
the empty set. i18n: the `hudChrome.professions` English block with five
non-Latin M16 fills per wordy row. Validation: `tsc` clean and the
13-file matrix green (architecture, the mobile guard trio, client_shell,
S3, completeness, css corpus and validity, the three new suites,
mobile_controls). frontend-seam-reviewer returned zero blocking; both
should-fixes landed in-phase (the perk line now interpolates the craft
name in one key instead of concatenating localized fragments, and the
bar fill moved into the view core with pins). Screenshots under
`docs/screenshots/professions-wheel-window/`. Notes: `CRAFT_MAX_SKILL`
(300) lives in the view core as a presentational cap because content
defines no craft-side maximum and sim craft skill is uncapped;
`data-icon="target"` is the accepted launcher glyph until designer crest
art arrives; the `gather_fishing` icon ships ahead of its Phase 11 read,
and the painter's gathering name map gains the fishing row plus its
catalog key in Phase 11. The minimap launcher is the rail's eighteenth
micro-button, which broke the 1366x768 side-rail height budget; the
short-viewport compaction gap tightened from 2px to 1px (652px of the
660px budget) with the `crafting_launcher` guard re-pinned deliberately;
the next button added must revisit the rail (DESIGN.md phase 3 replaces
it with the launcher hub).

### Phase 6: Crafting window upgrades and celebrations
- [ ] Recipe rows show profession + required skill + skill-gain difficulty tint (#2037)
- [ ] Combo rows name their requirement; station-bound rows show a badge and disable reason
- [ ] Masterwork toast + zone-visible broadcast (Phase 4 soft-zone mechanism); tier-up toasts; maker's mark and masterwork in item tooltips
- [ ] Online inspect carries instance payloads (identity wire extended, parity pinned)
- [ ] Craft button never lies: same eligibility rule as the sim in both hosts

### Phase 7: The Guild letter and quest objectives
- [ ] Craft/gather quest objective types (minimal set for the letter quest)
- [ ] The Guild letter arrives via the mail system on trend detection; starts the first-attunement quest hook
- [ ] S3 scanner gap closed: `src/sim/quests/quest_commands.ts` in scan scope, guard test updated

### Phase 8: Stations and masters (sim and server)
- [ ] Station registry generalizes `requiresHubStation` to typed stations (forge, kitchens, apothecary, tannery, loom, toolworks); `CRAFTING_HUB_MIN_LEVEL` retired
- [ ] Master NPC records for the six deep crafts, spread across the three zone hubs (four archetype anchors in zone 1; tannery in Fenbridge; apothecary in Highwatch; assignment pinned)
- [ ] Automated placement-safety test: no profession NPC or station within aggro-plus-buffer of hostile spawns
- [ ] Mobile crafting station perk activates (bypasses the station gate; specialization-gated)

### Phase 9: Station presence and recipe training
- [ ] Stations render as world props; masters render and are interactable; minimap markers
- [ ] Skill-tier-gated recipe training at masters on the `acquireRecipe` gate, with the visible locked-row ladder; every existing recipe grandfathered known
- [ ] Master shops stocked (base tools, reagents); training fees are gold sinks
- [ ] Hands-vs-stations split live: field recipes craft anywhere, uncommon+ at stations

### Phase 10: Recipe ladders and materials content
- [ ] Tier ladders for all six deep crafts (common through rare at minimum) with material families
- [ ] Cloth sourcing: humanoid components + plant fiber; corpse component quest-item collision ended
- [ ] Economy invariant test pinned: no recipe vendors for more than its inputs
- [ ] Cross-tier composition; combat-worthy consumables at every cooking/alchemy tier; materialTierBonus wired; the perfect specimen
- [ ] Wiki content regenerated; recipe data feeds the guide

### Phase 11: Fishing joins the framework
- [ ] Fishing proficiency (additive, framework-integrated) while the minigame stays as-is
- [ ] Catch rarity ladder feeds cooking tiers; rare catch integrates (deed intact)

### Phase 12: Base tool tier gating
- [ ] Nodes carry tiers; tool tier + skill gate node and corpse-material access
- [ ] The 15 existing tools change outcomes; stale no-op test pin replaced
- [ ] Tool effects remain parked (explicitly out of scope)

### Phase 13: Enchanting reachable
- [ ] Disenchant + enchant-apply + salvage on IWorld, wire commands, bags context UI, both hosts
- [ ] Enchanting skill visible in the wheel window

### Phase 14: Attunement quests and nudges
- [ ] Acceptance lore quests at the masters for all four wave-one archetypes
- [ ] Repeatable-quest support; make-amends wired; cheap-first-switch costs
- [ ] Trend nudges (chat first, Guild letter voice); attunement summary explains everything before commit
- [ ] Work-order quests per master (cadence-capped) and one-shot-per-tier master mail
- [ ] Title celebration on attunement

### Phase 15: Deeds, tuning, and polish
- [ ] Universal profession deeds incl. titles + marquee renown on first attunement and first masterwork, the Specialist deed, and the rare-find deeds (plus the rare fish, verified)
- [ ] Economy tuning targets applied (#1301 fee/throttle, training fees, teach tiers, work orders, masterwork bounds); faucet-vs-sink review recorded
- [ ] Guide/wiki professions page rewritten; asset manifest final
- [ ] Whole-feature qa-checklist.md matrix green; packet teardown offered

## Notes

(append per-phase notes, deferrals, and surprises here as sessions complete)

2026-07-17 design-review amendments: a maintainer design review (the
response to the external Codex review) amended the packet between Phases 2
and 3. state.md records the rulings under "2026-07-17 design-review
amendments"; the owning phase and QA files, the cross-cutting docs, and the
asset manifest carry the updated deliverables (see the amendment PR's diff
for the full file list). The any-signed masterwork condition ships as its
own code change ahead of Phase 3, verified by the Phase 3 pre-flight. The
checklists above were updated in the same pass; unchecked items describe
the AMENDED deliverables.

Phase 2 (2026-07-17): phase-start commit 9a5ce7a93 (the Phase 1 QA merge,
the release/v0.27.0 head); code-final commit 90ba58f17 (the
professions_craft parity golden); the docs commit follows it, so the QA
session diffs 9a5ce7a93..branch-head. Implemented on the worktree branch
feature/professions-2-phase-02-masterwork. Validation: whole-repo tsc
clean; the six phase suites (204 tests), the new and reader suites (122),
the net/wire row (377), and tests/parity (174 passed, one pre-existing
env-gated skip) all green; the full gate passed every stage except the
known environmental armory browser failure (PR CI is the arbiter), with
typecheck and the env/server/client builds finished manually per the
established playbook. Reviews: six read-only reviewers (architecture,
cross-platform-sync, privacy-security, migration-safety, qa-checklist,
test-coverage-auditor), zero blocking and zero unresolved should-fix
findings; the archetype-ceiling-gates-masterwork semantic and the
chore-first commit order are deliberate and explained in the commit
bodies. Deferred and surfaced items live in the Phase 2 drift notes in
state.md: the rollback enchantability caveat for the release notes, the
two battlefield trickle questions, the guide prose deferral to Phases 6
and 15, and the standing instance-payload wire invariant.
