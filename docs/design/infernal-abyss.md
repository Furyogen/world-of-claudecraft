# Infernal Abyss

## Intent

Infernal Abyss is a level 20, five-player lore dungeon beneath Stormcrag. It is a
separate story and space from every existing infernal rift. The visual target is a
black-obsidian forge complex split by living lava, with readable red-orange lighting,
large silhouettes and side chambers that reward exploration.

The dungeon follows the narrative density of the Nythraxis chain: the player first
investigates a disturbance, then reconstructs a broken covenant from four interactable
records, and finally confronts the name revealed by those records.

## Authored route

The layout is a single deterministic room graph shared by rendering and collision.
Visible walls, doorway gaps, prop footprints and minimap rooms all derive from
`INFERNAL_ABYSS_LAYOUT`.

| Stage | Room | Purpose |
|---|---|---|
| 1 | Ashen Descent | Safe entrance, first view of the chained forge |
| 1 | Chainscar Descent | Compression corridor into the hostile complex |
| 2 | Lava Maze | First trash gauntlet, lava pools and a lore tablet |
| 2 | Lost Armory | Optional west branch with weapon racks and covenant evidence |
| 3 | Infernal Forge | Forgekeeper miniboss and the smith's ledger |
| 3 | Gladiator Pit | Optional east branch with elite gladiators and loot |
| 3 | Maw Approach | Narrow regroup threshold after both branches |
| 3 | Maw Bridge | Lava-fissure crossing and final trash pack |
| 3 | Heart Cairn Vestibule | Pyre Golem miniboss and the broken covenant |
| 3 | Heart Cairn | Azazel's altar and final encounter |

The primary route remains obvious while the two side rooms preserve the exploratory
shape of the concept map. Lava pools and fissures deal a deterministic eight percent
of maximum health each second, matching the exact visual footprints on every graphics
tier.

## Lore chain

Loremaster Caddis offers three linked quests:

1. `Echoes Beneath Stormcrag` sends the player to read the Charred Legion Tablet and
   the Brands of the First Flame.
2. `The Broken Covenant` follows the Forgekeeper's Ledger and Azazel's Broken
   Covenant, revealing that the first flame was a seal, not an object of worship.
3. `Lord of the Infernal Abyss` asks a full party to kill Azazel before the last clause
   of the covenant burns away.

Every lore object emits a short two-part vision. The prose is localized in the five
non-Latin M16 locales as well as English.

## Encounters

The Forgekeeper uses a telegraphed hard cast and summons cinderlings from the forge.
The Pyre Golem combines a close-range fire nova, a stunning quake and a low-health
enrage. These fights teach the movement and burst patterns used in the final room.

Azazel combines the existing deterministic encounter vocabulary into one fight:

- `Apocalypse Flame`, a three-second room cast with a visible cast bar.
- `Abyssal Firestorm`, a nine-second pressure pulse.
- `Hellbreaker Stomp`, a damaging stun that punishes stacking in melee.
- Cinderling waves at 70 and 40 percent health.
- `Gaze of the Abyss`, a periodic fear that disrupts positioning.
- A 20 percent enrage with a 60 percent damage increase and attack-speed increase.

The arena leaves a clean central fighting floor around the altar and places four
chained obelisks on its perimeter. The result is readable from the default camera and
leaves enough space for a five-player party to spread.

## Generated asset set

Seven Tripo v3 assets were generated specifically for this dungeon:

- Rigged Azazel and Pyre Golem models, each with Idle, Walk, Run, Attack, Hit, Death,
  Cast and Jump clips.
- Abyssal heart altar, infernal forge anvil, chained demon obelisk, lost armory weapon
  rack and lava brazier props.

All models use 512 px embedded WebP textures and remain within the repository triangle
and file-size budgets. The creature clips pass the in-place movement validation.
