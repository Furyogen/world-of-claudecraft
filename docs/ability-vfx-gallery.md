# Ability VFX Gallery (dev preview)

A standalone, spec-driven preview of AAA-style ability VFX for **every player
ability, every class** — a working prototype of the proposed in-game
`src/render/ability_vfx.ts`. It runs entirely off two generated data files and
never touches `src/`, so it works regardless of the game's current version.

**Not shipped.** This is a design/review tool. The in-game port is deferred.

## Run it

```bash
npm run dev            # vite on :5173
# open http://localhost:5173/arc_bolt_preview.html
```

Controls: class/ability pickers · ◀▶ · 🎬 Auto-tour · 🔗 Combo · ↺ Replay ·
🐌 Slow-mo · ⛈ Finisher · 🔇 Sound · 🎥 Cinematic cam · ⏺ Clip · 🎚 SFX A/B
(generated vs synth) · speed & volume sliders.

## Architecture

- `arc_bolt_preview.html` — the gallery page + HUD.
- `arc_bolt_preview.js` — the engine (~5k lines): one deterministic sequencer
  driving **12 archetype interpreters** (`bolt burst strike nova beam dot heal
  buff shout summon cc dash`) over five primitives (shockwave ring, ribbon
  trail, flipbook quad, ground decal, pooled light pulse), 12 named palettes,
  post stack (UnrealBloom → custom distortion → ACES), the real class GLB rigs
  (loaded via GLTFLoader + MeshoptDecoder), spirit apparitions, a multi-buff
  persistence system, and a procedural + sample-based audio engine.
- `ability_catalog.js` — **generated** list of every ability (id/name/school/
  effects/…), the ground truth the gallery iterates.
- `ability_specs.js` — **generated** per-ability `AbilityVfxSpec` (the look:
  archetype, palette, windup, motifs, spirit, buff DNA, impact overrides…).
- `sfx_pack.json` — AI-generated (ElevenLabs) sound pack, base64 mp3, inlined at
  build. The audio engine layers a "beef bus" (saturation + octave-down body)
  and per-buff living foley on top.

`window.__ab` exposes a probe API (state/spec/buffs/spirits/setAbility/shot/
composeShot) used by the headless verification scripts.

## The spec vocabulary (how a look is defined)

Each ability in `ability_specs.js` is one JSON object. Key fields:

- `archetype` (required), `palette`, `power`, `windup`, `windupStyle`
  (`ascend none orb runes stance vortex weapon`), `linger`, `self`, `decal`.
- `motifs`: composable set-pieces — `fissure vines chains swarm pillars orbitals
  cross fountain crescents bladestorm implosion barrier gavel claws`; `motifAt`.
- `impact` overrides: `flipbook ring vRing sparks debris smoke light trail
  (arc|overhead|low|riposte|x|sweep) blood liteAudio` — **the spec always wins
  over the archetype's defaults.**
- `spirit`: `{ model, path (circle|rise|pounce|lunge|swoop), at
  (caster|target|portal), scale, dur, tint, dim }`.
- `buff`: `{ style (raise|veil|morph), orbit, shellDur, o:{…DNA} }` + `rim`.
- Archetype blocks: `bolt{speed,jagged,coils,forkEvery,volley,tracer,leader}`,
  `strike{arc,swings,bleed,stars,groundSlam}`, `nova{radius}`,
  `beam{dur,ticks,drain}`, `dot{drip}`, `cc{style}`, `shout{radius,target}`,
  `burst{style}`. `barrier:true`, `shaft`, `screenFx`, `finisher` (1/class).

## Design rules (must hold for new abilities)

1. **Semantic honesty** — VFX/sound match what the ability *does*. A taming
   ritual doesn't punch its target; a self-buff doesn't attack the dummy; a
   drain flows to the caster (`beam.drain` / `impact.receiver:'caster'`).
2. **Spirit policy** — ghostly *animal* apparitions are **druid-only**;
   monsters/wraiths are fine for warlock; the pet/summon/polymorph spells may
   show their literal creature (that creature *is* the spell).
3. **Buff persistence + stacking** — a buff's visual lasts its full duration and
   every buff renders in its own **body band** (halo=head · sparks=shoulders ·
   plates=waist · runes=ankles · speedlines=legs · wings=back · weaponGlow=weapon
   · leaves=column · heartbeat=chest · none=rim). Two concurrent buffs must not
   share a band, and **no two buffs in the game may look alike** — vary the
   `buff.o` DNA (count/size/texture/rate/tempo/wings-ribs…).
4. **Palette discipline** — gold/holy is holy-school only; physical is
   steel-white; blood for bleeds; venom for poisons.
5. **Every ability visually unique** within its class; the fantasy must read at
   a glance.

## The generation pipeline (`scripts/vfx/`)

Specs are authored as layered overlays in `scripts/vfx/specs/` and merged:

```bash
node scripts/vfx/merge_specs.mjs        # specs/*.json  →  ability_specs.js
```

Overlay order (each merges over the last; later wins): `authored_specs` →
`diversity` → `unveil` → `accent` → `signature` → `round2` → `round3_new`
(may create) → `round3_spirit_policy` → `round4_semantics` → `round5_buff_slots`
→ `round5_buff_dna` → `round6_talent_sigs` (may create). `abilities.json` is the
catalog ground truth.

Verification (headless Chrome via puppeteer-core; needs `npm run dev` up):

```bash
node scripts/vfx/gallery_probe.mjs --all   # screenshot every ability, assert no errors
node scripts/vfx/spirit_probe.mjs          # spirit apparitions
node scripts/vfx/audio_probe.mjs           # audio, sound on
node scripts/vfx/combo_probe.mjs           # combo chains
node scripts/vfx/buff_probe.mjs            # buff persistence + stacking
```

Audio (optional; needs `ELEVENLABS_API_KEY` in env/.env — never commit it):

```bash
node scripts/vfx/gen_sfx.mjs               # generate the SFX shot-list
node scripts/vfx/build_sfx_pack.mjs        # bake takes → sfx_pack.json
```

Shareable single-file build (self-contained, CSP-safe, GLBs + SFX inlined):

```bash
node scripts/vfx/build_artifact.mjs        # → tmp/vfx/woc_vfx_gallery_artifact.html
```

## Coverage status

Built against an earlier `main`: **193 abilities** covered (base kits + talent
spec-signatures + the Feed/Abandon pet commands). The game has since grown to
**308 abilities** (v0.27/v0.28 warrior + mage reworks). The remaining ~53 player
spells — the mage Temporal/Frost/Fire buildout, the warrior stance/rework kit,
and Chaos Bolt — are **not yet in the gallery**; see the accompanying handoff
brief for how to add them.
