<!-- Living operator + maintainer doc for the Class Power Tuner. The generated
     companions beside it (class-power-tuner.pdf / .html) carry the SAME prose
     plus the complete per-class, per-spec ability tables, the weapon table, and
     the dashboard screenshots; regenerate them with the command below rather
     than hand-editing either file. -->

# Class Power Tuner

An operator-facing balance lever: every aspect of every ability of every class as
a multiplier slider, plus the auto-attack ("white") swing damage and swing timer
of every weapon. Saved per realm, applied to the world at the next server restart.

It exists because two of the nine classes have been reworked and now outperform
the other seven. Closing that gap used to mean editing content source and
shipping a build; with the tuner it is a slider and a restart.

**Full reference (screenshots, every class/spec ability table, every weapon):**
`docs/balance/class-power-tuner.pdf`.

## Who can use it

A dedicated staff role, `tuner`, carrying exactly two permissions:

| Permission | What it allows |
|---|---|
| `tuning.read` | See the sliders and the change history |
| `tuning.write` | Save a tuning document |

The role carries nothing else. An account holding only `tuner` cannot see player
accounts, act on players, or read the anti-bot internals, and every other admin
endpoint answers it 403. `tuning.read` is deliberately kept out of the read-only
`viewer` bundle, so the balance surface reaches named people rather than every
read-only seat.

```
node scripts/grant_admin.mjs <username> --roles tuner
```

## How a change reaches the world

1. A tuner moves sliders in **Balance > Class Power** and saves with a note.
2. The document is sanitized, stored as one row per realm (`class_tuning_config`)
   and appended to an audit trail (`class_tuning_changes`) recording the before
   and after documents, the operator and the note. An unchanged save records
   nothing.
3. The page reports the change as **pending a restart**. The running world is
   untouched.
4. At the next boot `installRealmClassTuning` (`server/class_tuning.ts`) installs
   the document onto the ability and item tables ONCE, before the first
   `GameServer` (and therefore the first `Sim`) exists.

Tuning is boot-scoped on purpose (`src/sim/tuning/install.ts` carries the
reasoning): swapping values under a running world would change numbers underneath
in-flight casts and cooldowns, and would leave server and clients disagreeing for
as long as the change took to propagate. The realm hands its installed document
to each client in the `hello` frame, so client tooltips, cooldown pips and cost
predictions describe the numbers the server actually resolves.

## Where the code lives

| Path | Role |
|---|---|
| `src/sim/tuning/channels.ts` | The closed channel vocabulary and the value math (`scaleTuningValue`) |
| `src/sim/tuning/ability_fields.ts` | THE classification table: which effect field belongs to which channel, and how it responds |
| `src/sim/tuning/ability_knobs.ts` | The ONE ability traversal that both lists the sliders and applies them |
| `src/sim/tuning/weapon_knobs.ts` | The same traversal for a weapon's swing damage and swing timer |
| `src/sim/tuning/document.ts` | The sparse per-realm document plus its sanitizer |
| `src/sim/tuning/catalog.ts` | The derived catalog the dashboard renders |
| `src/sim/tuning/install.ts` | The boot install onto `ABILITIES`, `ITEMS[].weapon` and `CLASSES[].ranged` |
| `server/class_tuning.ts` / `_db.ts` | Boot install, save/history operations / the SQL boundary |
| `src/admin/pages/ClassTuning.svelte` | The dashboard page (class windows plus the Weapons window) |
| `src/admin/class_tuning.ts` | Its pure view model (slider state, filters, previews) |

## Adding a tunable number (what a class rework has to do)

Usually nothing. The catalog is derived from the live content tables and one
traversal drives both the sliders and the apply, so a new ability built from
existing effect types arrives with the right sliders automatically.

When a rework adds a NEW effect field, `tests/class_tuning_coverage.test.ts` fails
naming it. The fix is one row in `EFFECT_TUNED_FIELDS`
(`src/sim/tuning/ability_fields.ts`) choosing its channel and its value kind:

- `linear` for a magnitude (damage, seconds, yards, costs)
- `deviation` for a multiplier whose neutral point is 1 (a snare's 0.5, a 2x
  threat multiplier, a 1.4 haste aura): the slider moves its distance from 1
- `fraction` for a normalized 0..1 share, clamped to at most the whole
- `multiplier` for a plain rate whose neutral is 1 and which must not snap to a
  whole number (a weapon-damage multiplier, the spell power coefficient)

A field that is genuinely not a power lever (tick cadence, an identity flag) goes
in `UNTUNED_EFFECT_FIELDS` or `UNTUNED_DEF_FIELDS` with the reasoning at the row.
A new aura KIND whose `value` is a multiplier around 1 must join
`MULTIPLIER_AURA_KINDS`, and a marker aura must join `MARKER_AURA_KINDS`; a guard
case fails on a live aura value that looks like an undeclared multiplier.

A new channel is a wider change: add it to `TUNING_CHANNELS`, add its
`tuning.channel.<id>` English label in `src/admin/i18n.en.ts`, and regenerate
(`npm run i18n:admin`). `tests/admin/class_tuning.test.ts` pins one label per
channel.

## Guards

| Test | What it holds |
|---|---|
| `tests/class_tuning.test.ts` | Channel math, the ability and weapon walkers, the document, install/restore |
| `tests/class_tuning_coverage.test.ts` | Every numeric ability field is classified; every class, spec, ability and weapon is present |
| `tests/class_tuning_db.test.ts` | Additive idempotent DDL, the atomic save-plus-audit, unchanged-is-a-no-op |
| `tests/class_tuning_runtime.test.ts` | The shipped-baseline snapshot, the boot install, the pending-restart state |
| `tests/admin/class_tuning.test.ts` | The view model, and the local value math pinned equal to the sim's |
| `tests/server/admin.test.ts` | The three endpoints |
| `tests/admin_routes.test.ts` | The route-to-permission map stays complete |

## Regenerating the reference

The screenshots come from the REAL dashboard against a REAL server, and the
tables from the same catalog the dashboard renders, so neither can drift from the
tool.

```
# 1. Postgres + a server, with an account holding the tuner role
npm run db:up
npm run server
node scripts/grant_admin.mjs <username> --roles tuner

# 2. A dev client pointed at that server
WOC_DEV_API_TARGET=http://127.0.0.1:8787 npx vite --port 5195

# 3. Capture, then build the document
GAME_URL=http://127.0.0.1:5195 SERVER_URL=http://127.0.0.1:8787 \
  ADMIN_USER=<username> ADMIN_PASS='...' \
  SHOTS_DIR=docs/screenshots/class-power-tuner \
  node scripts/class_tuner_shots.mjs

OUT_DIR=docs/balance SHOTS_DIR=docs/screenshots/class-power-tuner \
  node scripts/class_tuner_reference.mjs --pdf
```
