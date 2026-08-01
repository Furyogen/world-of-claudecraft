# Game Master (class concept)

Status: mockup for review. Nothing in `src/sim/`, `server/`, or the client has been changed.

A tenth player class whose kit is the existing staff toolbox retold as spellcraft. Every ability is
derived from a real dev command in `src/ui/dev_command_view.ts` or a real admin permission in
`src/admin/permissions.ts`, then rebuilt as an ordinary, server-authoritative player spell.

The visual mockup (class panel, spellbook, choice rows, command coverage) is
`docs/design/game-master-class.html`. This file is the short written form.

## Identity

| Field | Proposal |
|---|---|
| Class id | `gamemaster` |
| Class color | `0x2fd6b0`, "Verdict Teal", clear of all nine shipped class colors |
| Resource | `mana`, labelled Authority (no new resource type in the sim) |
| Armor | cloth |
| Role | ranged support and control |
| Base stats | str 11, agi 12, sta 15, int 23, spi 21, armor 30 |
| Per level | sta 1, int 3, spi 2, armor 4 |
| Health / Authority | 40 base, 12 per level / 105 base, 25 per level |
| Ranged | wand, arcane school, 30 yd |

The source commands are overwhelmingly non-damaging (heal, revive, give, teleport, despawn,
silence), so the class is authored as support rather than damage. Building it as a damage spec would
mean inventing a kit the source material does not contain.

Every number above and in the mockup is a starting shape. Per `docs/design/class-design-rules.md`,
coefficients need an existing classic-era formula or a measured result before they are authored, so
they wait on a balance pass against `docs/design/spell-balance-framework.md`.

## Signature mechanic: Citations

The moderation escalation ladder (note, mute, suspend, ban) is the class resource loop.

- **Cite**: builder. Off the global cooldown, applies 1 Citation to the target for 30 sec, 3 max.
- **Verdict**: spender. One charge on a 24 sec recharge, consumes every Citation at once.
  - 1 stack: silence 3 sec.
  - 2 stacks: silence 3 sec and root 5 sec.
  - 3 stacks: banish 8 sec, broken by damage, fear diminishing returns.

The decision is whether to spend Verdict early as a cheap interrupt or hold the ladder for the
finisher and risk the stacks expiring. That answers three of the six questions in the
interestingness test (what you press, when you spend, which target you pick).

## Kit shape

25 abilities: 13 shared baseline, 4 per spec gated with `specs: [...]` the same way the warrior and
mage kits already gate theirs. Eight are in the combat rotation; the rest are passives, cooldowns,
or out of combat utility.

- **Oversight** (vision and pressure): Under Review, Audit Trail, Shared Address, Escalation.
- **Enforcement** (removal and area control): Warded Threshold, Purge Entity, Garbage Collection,
  Standing Order.
- **Provision** (restoration and supply): Refill the Well, Provision, Field Survey,
  Conjured Adventurer.

Choice rows follow the Talents 2.0 contract exactly: six rows at levels 5, 8, 11, 14, 17, and 20,
with the row jobs and throughput rules from `docs/design/class-design-rules.md`. Each level 20
option redirects the level 17 choice (area, party healing, or utility) rather than stacking a second
cooldown on top of it. The full option list is in the HTML mockup.

## Commands deliberately left unmapped

`/dev level`, `/dev gold`, `/dev quest`, and `/dev quests` get no ability. Each hands out
progression: experience, currency, or quest credit. Any spell shaped like them is an economy faucet.
If they are wanted later they belong in an economy review, not in this kit.

`accounts.password`, `staff.manage`, and `ops.perf` are operator surfaces with no combat reading, so
they are out of scope by nature.

## The rule this class must not break

The Game Master resembles the staff toolbox. It must never be the staff toolbox. Every ability
resolves server-side under the same authority as any other class: no dev command path, no admin
permission check, no client-decided outcome, and no behavior that differs when `ALLOW_DEV_COMMANDS`
is set. The spectate-flavored ability is named Under Review rather than Spectate specifically so it
is never confused in a code search with the moderation spectate view it was named after.

## What implementing it would touch

Simulation:

- `src/sim/types.ts`: add `'gamemaster'` to the `PlayerClass` union.
- `src/sim/content/classes.ts`: one `ClassDef` in `CLASSES`, plus the ability records in `ABILITIES`.
- `src/sim/content/choice_rows.ts`: the six rows, registered in `CHOICE_ROWS`.
- The Citation mechanic: its own module behind the `SimContext` seam, never a method cluster on
  `sim.ts`. Backing state lives on `Sim` as a live `ctx` view.
- New `AbilityEffect` kinds only where an existing effect does not already cover the behavior.

Presentation and hosts:

- Class color wherever class colors are read (party frames, player card, minimap, player tooltip).
- Character creation: the tenth option and its character model.
- i18n: English keys only, in the matching `src/ui/i18n.catalog/` module.
- Wiki: `npm run wiki:content` plus the new `guide.*` prose keys.
- Tests: sim coverage for the Citation ladder and the Verdict escalation arms, plus the class and
  choice-row content pins. No `IWorld` change is expected, so no parity pin update unless a new
  facet member turns out to be needed.

## Open questions

1. Is Authority worth a display rename over plain mana, given every resource label and bar color it
   would touch?
2. Is Conjured Adventurer acceptable at all? A summoned stand-in interacts with group content rules
   and the dungeon finder.
3. Ship at three specs, or open at two with Oversight held back until the Citation ladder has been
   measured in a real raid?
