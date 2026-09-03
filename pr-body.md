## Summary

Adds two surfaces for tracking the debuffs **you** have out, and a size slider for
one of them.

**Target dots** (`#target-dots`) is a movable HUD frame listing one bar row per
enemy-and-dot pair, across every enemy in interest range: icon, a school-tinted
fill that is the remaining fraction, `<aura> on <target>` riding the bar, and a
live countdown that gains a decimal under ten seconds. Rows on your current
target lead the list and carry a gold rule. It is hidden entirely while you have
no dots out.

**Nameplate dots** draws the same selection as a small icon row on an enemy's
overhead nameplate, between the name row and the health bar, each icon with a
cooldown swipe and a countdown. A **Nameplate Dot Size** slider (100% to 300%,
default 150%) sizes that row.

Both are chosen by **ownership plus harm** (the caster is you, and
`isDebuffAura` from `src/sim/aura_classify.ts` says it is harmful), never by an
ability or class list, so warlock dots, rogue poisons, druid Faerie Fire, hunter
stings and warrior Sunder all land on one code path and a debuff added to any
class later needs no change here. The party and raid's debuffs are deliberately
**not** shown on either surface: they remain on the target frame strip, which is
untouched and is still the complete list. Escaping that pile mid-fight is the
whole point of the frame.

Both switches live in **Interface > Combat** and default on. Neither surface is
graphics-tier gated: these are timers a player acts on, so no preset or FPS
governor may shed them (root `CLAUDE.md`, gameplay-neutral graphics).

### Shape

- Selection is two pure cores, `src/ui/hud/target_dots/target_dots_view.ts`
  (`UI_PURE_CORES`) and `src/render/nameplate_dots_core.ts` (`RENDER_PURE_CORES`),
  each with a thin painter. Both pool their records so a steady frame allocates
  nothing.
- Row order is **stable on purpose**: grouped by enemy (current target first,
  then entity id) and sorted by aura id inside the group, never by remaining
  time. A tracker that re-sorts as timers tick moves the row you are reaching
  for. Urgency is carried by the fill, the countdown and the expiring blink.
- Four monolith ceilings were at zero slack, so this pays for its wiring by
  extraction rather than growth: `nameplate_dot_row.ts` and
  `nameplate_image_cache.ts` come out of the plate compositor, and
  `ability_tooltip_lines.ts` (the pure `describeAbilitySummary` /
  `abilityRequirementLines` mappers, no Hud state) comes out of `src/ui/hud.ts`.
  All three ceilings are **lowered**, not raised.

## Related issues

N/A. No tracking issue.

## Type of change

- [x] Feature: new functionality
- [x] Bug fix
- [ ] Refactor or performance (no behavior change)
- [ ] Documentation
- [x] Tests
- [ ] Build, CI, or tooling
- [ ] Breaking change (please call it out in the summary)

The bug-fix box covers two defects found while building this: the tracker's row
nodes were pooled by array index, so a recycled node could keep the previous
occupant's cached artwork (the staleness trap `auras_painter.ts` documents), and
the row label declared `line-height` above a `font` shorthand that resets it, so
the label was not centred in its bar.

## How was this tested?

- Commands:
  - `node scripts/gate_select.mjs` (`GATE_SELECT_BASE=gatebase`, the Windows
    caret workaround). It cleared generated-artifact freshness, the SFX and media
    manifests, the malware scan and changed-file Biome, then stopped at the
    Vitest step on **four files that are pre-existing on this machine**:
    `bank_sockets`, `ci_shard_plan` and `ci_stall_rerun` fail **identically** at
    the untouched base `da6458493f` (8 tests there), and `battleground` passes in
    isolation on this branch (180/180), so it is a contention flake. Everything
    else in that step is green: **3181 passed, 162 files passed**.
  - The steps the gate aborts before, run by hand and all green:
    `npx turbo run check:types build:env build:server build:bot`,
    `npx turbo run build:bundle`, and `npm run test:browser` (three WebGL files
    flaked under contention and pass in isolation: `post_grade_fxaa`,
    `context_recycle`, `paladin_templars_verdict_clip`).
  - New suites: `npx vitest run tests/target_dots_view.test.ts`
    `tests/target_dots_refresh.test.ts` `tests/nameplate_dots_core.test.ts`
    (16 + 3 + 24 tests).
  - Guards re-run: `tests/architecture.test.ts`, `tests/monolith_budget.test.ts`,
    `tests/hud_perf_budget.test.ts`, `tests/css_corpus.test.ts`,
    `tests/i18n_completeness.test.ts`, `tests/options_window.test.ts`,
    `tests/interface_unlock.test.ts`, `tests/mobile_window_coverage.test.ts`,
    `tests/pr_shot_targets.test.ts`.
- Manual steps:
  - Played a warlock at the Thornpeak practice row, casting Blackrot and Hex of
    Anguish onto three dummies through the real action bar, and checked that the
    frame lists one row per pair, that the current target's rows lead with the
    gold rule, that the countdowns and fills track, and that a refreshed dot
    returns to full.
  - Verified another caster's debuff appears on the target frame strip and on
    **neither** new surface.
  - Toggled both settings in Interface > Combat, and swept the size slider from
    100% to 300% watching the plate row grow without pushing through the name
    row above it.
  - Desktop and a phone-sized landscape viewport (the web client is
    landscape-only in game); the frame clears the touch controls.

`tests/target_dots_refresh.test.ts` deliberately drives the **real Sim** rather
than a fixture, because a refresh is the thing this frame exists to time and only
a live cast can show it is followed.

## Screenshots / recordings

Same scene both times, with the same dots actually cast on the dummies. The
before frames are the two settings off, which is byte-identical to this base
(both code paths return before drawing anything).

**Desktop, before**

![Desktop before](https://github.com/Furyogen/world-of-claudecraft/blob/feature/nameplate-player-dots/docs/screenshots/target-dots/before-desktop.png?raw=true)

**Desktop, after**

![Desktop after](https://github.com/Furyogen/world-of-claudecraft/blob/feature/nameplate-player-dots/docs/screenshots/target-dots/after-desktop.png?raw=true)

**Mobile, before**

![Mobile before](https://github.com/Furyogen/world-of-claudecraft/blob/feature/nameplate-player-dots/docs/screenshots/target-dots/before-mobile.png?raw=true)

**Mobile, after**

![Mobile after](https://github.com/Furyogen/world-of-claudecraft/blob/feature/nameplate-player-dots/docs/screenshots/target-dots/after-mobile.png?raw=true)

Captured through `scripts/pr_screenshots.mjs`; this branch adds its `target-dots`
target entry, which stages the practice row and casts the dots through the same
action-bar click a player uses rather than injecting auras.

---

## Checklist

### Quality

- [x] **The gate passes.** `node scripts/gate_select.mjs` is green (or `npm run gate` for
      the full suite). I added or updated decisive
      tests for changed behavior and recorded any manual checks above.

  Qualified, and stated plainly rather than ticked blind: every gate step passes
  except a Vitest step whose only failures are the four files above, three of
  which fail identically on the untouched base and one of which is a contention
  flake. The steps the gate aborts before were run by hand and are green. 43 new
  tests.

### Cross-platform

- [x] **Tested on desktop and mobile.** Verified on a desktop and on a
      phone-sized viewport in both portrait and landscape. Touch targets stay at
      least 40x40px and inputs at least 16px font (see `src/ui/CLAUDE.md`).

  The in-game web client is landscape-only, so the mobile check is the landscape
  phone viewport. The frame adds no touch targets: it is `pointer-events: none`
  in play and only becomes draggable in the interface-unlock editor.

- [x] **Accessible.** Keyboard-operable, with visible focus, sensible ARIA, and
      respect for `prefers-reduced-motion` (only if this change adds or edits UI).

  The frame is a `role="group"` with a localized `aria-label`; it is a readout,
  not a control, so it takes no focus. The expiring blink has a
  `prefers-reduced-motion` fallback to a steady brightened state, matching the
  aura strips. Colour is never the only cue: the countdown number carries the
  same urgency the amber tint does, and forced-colors collapses the plate row's
  tints to `CanvasText`.

### Localization (i18n)

- [x] **New player-visible strings follow the contributor policy.** Every user-facing
      string is a `t()` key added to the matching English catalog. I did not edit locale
      overlays, except for the five required non-Latin fills when the M16 wordy-copy
      rule applies (see `src/ui/CLAUDE.md`).

  Six new keys in `src/ui/i18n.catalog/hud_chrome.ts`. Five are wordy, so the M16
  fills for zh_CN, zh_TW, ja_JP, ko_KR and ru_RU land in this same change; no
  Latin overlay was touched and no placeholder or TODO was left anywhere.

- [x] Numbers, money, dates, units, and percents go through the i18n formatters
      (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`).

  Both countdowns and the stack badge go through `formatNumber`; the cores emit
  numbers plus a decimal count and never build the text themselves.

- [x] Player-facing text emitted from `src/sim/` or `server/` is re-localized at
      the client boundary in this same change, and
      `npx vitest run tests/localization_fixes.test.ts` passes.

  No new sim or server text. Aura and enemy names resolve through the existing
  client-side `auraDisplayNameForHud` and `entityDisplayName`.

- [ ] N/A. This PR adds no player-visible strings.

### Hygiene

- [x] No secrets, credentials, or `.env` committed, and `ALLOW_DEV_COMMANDS` is
      not enabled in any production path.
- [x] I didn't hand-edit generated files such as
      `src/render/assets/manifest.generated.ts`. They're regenerated by the build.

  The i18n bundles in this diff are `npm run i18n:gen` output, committed in the
  same change as the catalog edits, and the gate's freshness diff passes.

---

Two notes for the reviewer:

- **Defaults are on.** Both surfaces default on and the size slider defaults to
  150%. The frame is invisible until you have dots out, so it costs a player who
  never uses it nothing, but the nameplate rows are visible to everyone on first
  login. Happy to flip either default if you would rather they were opt-in.
- **Ceilings moved down.** `src/ui/hud.ts` 18905 to 18874,
  `src/render/nameplate_canvas.ts` 864 to 848. `src/render/renderer.ts` is
  unchanged at 13249: the show toggle and the scale slider fold into one number
  where 0 means off, which is what keeps that file flat.
