# World of Claudecraft — Standalone Map Editor

**Private build shared by Troy Polaczuk.** These notes are the functionality
handoff for the collaborators on this repo: **@EnriqueGF**, **@MasterZensei**,
and **@maxpolaczuk**.

This is a private mirror of the map editor exactly as Troy runs it locally
(branch `feature/map-editor-standalone`). It's the full, runnable app — clone
it, install, and you get the same editor.

---

## 1. Quick start — run the editor

**Prerequisites:** Node.js (built/tested on **v24.x**) and npm.

```bash
git clone https://github.com/troypolaczuk/woc-map-editor.git
cd woc-map-editor
npm install
npm run dev
```

Then open the editor at:

> **http://localhost:5173/editor.html**

### ⚠️ The port is locked to 5173 — on purpose

The dev server is pinned to **port 5173** (`strictPort: true` in
`vite.config.ts`). Do **not** change it. The editor saves every map/draft to the
browser's `localStorage`, which is scoped **per origin including the port**. If
the port drifts, your saved maps silently disappear (they're still there, just
under the old origin). Same reason: use the **same browser** to keep your saves.

On a fresh page load the editor auto-opens your **most recently saved map**, so
you land back in your last work instead of the built-in world.

---

## 2. What the editor does

The editor is a full 3D world/map builder. Left-side **toolbar** picks the
active tool; the **inspector** (right) edits the selected thing; the **top bar**
handles New / Open / Save / Import / Export / Playtest / view modes.

### Terrain & ground
- **Raise / Flatten** — sculpt the heightfield (raise/lower, level to a target).
- **Paint** — biome/texture painting with a built-in **PBR texture library**
  (terrain sets under `public/textures/terrain/`), plus brush **hue/light tint**
  sliders and saved color swatches. WebP imports are compressed on import.
- **Region / Zone** — define named areas. Zone *kinds* include `hub`, `camp`,
  `graveyard`, `lake`, `poi`, `mob`, `npc`, `object`, `blocker`.

### Placing & transforming things
- **Place** — drop assets from the **asset browser** (models, foliage, props).
  Import your own models (`.glb`) — they persist in IndexedDB across reloads.
- **Move / Rotate / Scale** — 3-axis gizmo transforms. **Click-cycle** steps
  through overlapping placements under the cursor.
- **Foliage** — scatter vegetation.
- **Scene Collection** — group/organize placed objects.

### World features
- **Rock** — procedural **Rock Generator** (walkable bridge chains; ridge +
  height/depth/jag sliders).
- **Tunnel** — **Caves v2**: terrain-independent cave tubes with shader
  hole-cutouts in the terrain; move a whole cave via its anchored rig markers.
- **Fluid / Water** — fluid pools (per-kind), damage-tick volumes, water tint
  sliders and animated surfaces.
- **Collider** — collision authoring: modes `baked` / `basic` / `true-mesh` /
  `none`, editable hitboxes with a gizmo, per-asset presets. Baked collision
  uses per-asset voxel-box bakes.
- **Light** — lighting placement/overhaul.
- **Sound** — positional **looping SFX emitters** (point sounds) that ride the
  game's spatial audio engine.
- **Music** — zone music assignment.
- **Spawn** — set the player spawn point.

### View modes
- Toggle between edit and **Preview** view; wireframe; free-fly camera; show/hide
  player, boundary, birds, etc. (top bar toggles).

---

## 3. Saving, import/export, playtest

- **Save** persists to `localStorage` (one key per map: `woc_editor_map:<id>`,
  plus a small index). Autosave keeps a draft.
- **Export** writes a portable map **JSON** you can share/commit; **Import**
  reads it back. This is how you move a map between machines/browsers (since
  `localStorage` doesn't travel with the repo).
- **Playtest** launches the map in the live game to walk it. Quests/NPCs work
  for built-in-NPC maps.

> Note: because maps live in the browser, cloning this repo gives you the
> **editor + built-in content**, not Troy's personal in-browser drafts. To share
> a specific hand-built map, use **Export → JSON** and commit that file.

---

## 4. The Scorching Wastes desert map (included)

The desert zone content ships in this repo at:

> `src/sim/content/scorching_wastes.ts` (registered via `src/sim/data.ts`)

**Scorching Wastes** is an endgame desert zone (billed level **20–30**; mobs run
19–24 against the level-20 cap, so the back half plays as hard elite content).
Lore: south-east beyond Thornpeak's rim, the land the first sealing of Korzul
the Gravewyrm drank dry — **Zar'Keth, the Sunken Crown**, burned to glass by the
**First Ember**. The **Ashen Court** keeps a dead king's protocol in the ruins,
the **Emberveil** cult digs for the Ember, and a Highwatch caravan has raised the
**Last Well** to stop them.

Included content:
- **Mobs:** Duskmane Prowler, Glasscarab, Duneblade Marauder, Vigil Sentinel,
  Sunbaked Revenant, Ashen Courtier, and the boss **Karesh the Parched**.
- **Quest chain**, items, and ground pickups for the zone.
- **Desert biome art:** cacti, mesas, boulders, rock formations, desert tree
  (`public/models/biome/desert_*.glb`).

The module is data-only and base-world-safe (its NPCs are `dynamic: true`, so it
never pollutes the base world). A verification test lives at
`tests/scorching_wastes_map_verify.test.ts`.

The same notes + a copy of the desert-map source are also bundled under
`handoff/2026-07-14/` in this repo (the "Tues 14th" handoff).

---

## 5. Repo pointers

| Path | What |
|------|------|
| `src/editor/` | The editor app (tools, inspector, persistence, playtest) |
| `src/editor/app.ts` | Editor bootstrap + top-bar wiring |
| `src/editor/toolbar.ts` | Tool palette |
| `src/editor/persist.ts` | Map save/load (localStorage layout) |
| `src/sim/content/scorching_wastes.ts` | Scorching Wastes desert zone |
| `public/models/biome/desert_*.glb` | Desert biome assets |
| `vite.config.ts` | Dev server (locked port 5173) |
| `handoff/2026-07-14/` | This handoff bundle (notes + desert map copy) |

## 6. Useful scripts

```bash
npm run dev            # editor dev server on :5173
npm run test           # vitest (includes scorching_wastes_map_verify)
npm run check          # biome lint/format check
npm run build          # production build
```

---

*Questions → ping Troy. Provenance: forked from `levy-street/world-of-claudecraft`
(MIT) via `EnriqueGF/world-of-claudecraft`.*
