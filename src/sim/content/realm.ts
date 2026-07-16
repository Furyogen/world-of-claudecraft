// The Veiled Hollow (levels 15-20). A sheltered valley realm sealed beneath
// the mountains north of Thornpeak long before the Gravecaller conspiracy;
// the seal has thinned, and a concealed cave in the Thornpeak cliffs now
// leads through. Permanent dusk, glowing flora, and the town of Eldergleam
// around the roots of a great tree. Reached only by portal: the southern
// border ridge is sealed (see sealedSouthBorder in world.ts).

import type {
  CampDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  PortalDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../types';
import { emptyZoneProps } from '../types';

export const REALM_ZONE: ZoneDef = {
  id: 'veiled_hollow',
  name: 'The Veiled Hollow',
  riftPortalEligible: true,
  riftTierWeights: { B: 0.55, A: 0.35, S: 0.1 },
  zMin: 900,
  zMax: 1440, // the northern 180yd is open ocean (see the coast in world.ts)
  levelRange: [15, 20],
  biome: 'dusk',
  sealedSouthBorder: true,
  hub: { x: -40, z: 1030, radius: 30, name: 'Eldergleam' },
  graveyard: { x: -60, z: 1004 },
  // Overlapping carves make organic shorelines: inlets and coves instead of
  // circular ponds. The tarn cuts into the western highlands; the falls pool
  // terrace above Starfall is shaped in world.ts (VEILED_HOLLOW_SHAPING).
  lakes: [
    { x: 110, z: 985, radius: 22 }, // Starfall Basin
    { x: 94, z: 1000, radius: 10 }, // ...its reedy northwest inlet
    { x: 126, z: 972, radius: 9 }, // ...and the quiet southeast cove
    { x: 75, z: 1165, radius: 18 }, // the Crystalline Shallows
    { x: 60, z: 1178, radius: 9 }, // ...shallow northern cove
    { x: 92, z: 1154, radius: 8 }, // ...crystal-flanked eastern cove
    { x: -120, z: 1105, radius: 12 }, // the Mirrormere, a highland tarn
    { x: -15, z: 1062, radius: 7 }, // the meadow pond by the garden road
    { x: 148, z: 1124, radius: 13 }, // the Mirrorshallow, beside the Westway meadow
    { x: 142, z: 1142, radius: 8 }, // ...its reeded southern finger
  ],
  pois: [
    { x: -40, z: 1030, label: 'Eldergleam', id: 'eldergleam' },
    { x: -140, z: 952, label: 'Duskfall Cave', id: 'duskfall_cave' },
    { x: -118, z: 988, label: 'Duskfall Overlook', id: 'duskfall_overlook' },
    { x: 30, z: 955, label: 'Elder Grove', id: 'elder_grove' },
    { x: 110, z: 985, label: 'Starfall Basin', id: 'starfall_basin' },
    { x: 125, z: 1085, label: 'The Sunken Court', id: 'the_sunken_court' },
    { x: 75, z: 1165, label: 'Crystalline Shallows', id: 'crystalline_shallows' },
    { x: -70, z: 1155, label: 'The Gleaming Deep', id: 'the_gleaming_deep' },
  ],
  welcome: 'The air hums with old magic. Seek Keeper Saelwyn beneath the great tree of Eldergleam.',
  welcomeQuestId: 'q_veil_thinned',
};

// Winding valley paths: the cave descent into Eldergleam, then spokes out to
// the grove, the basin, the ruins, and the mushroom forest.
export const REALM_ROADS: { x: number; z: number }[][] = [
  [
    { x: -140, z: 955 },
    { x: -125, z: 980 },
    { x: -95, z: 1005 },
    { x: -40, z: 1030 },
  ], // Duskfall Cave -> Eldergleam
  [
    { x: -45, z: 1052 },
    { x: -60, z: 1105 },
    { x: -70, z: 1150 },
  ], // Eldergleam -> the Gleaming Deep
  [
    { x: -18, z: 1030 },
    { x: 30, z: 1042 },
    { x: 80, z: 1062 },
    { x: 120, z: 1085 },
  ], // Eldergleam -> the Sunken Court
  [
    { x: -30, z: 1010 },
    { x: 15, z: 982 },
    { x: 70, z: 975 },
  ], // Eldergleam -> Starfall Basin shore
  [
    { x: -62, z: 1155 },
    { x: -10, z: 1172 },
    { x: 38, z: 1170 },
  ], // the Gleaming Deep -> Crystalline Shallows
];

// The hidden way in. Side a is the concealed cave in the northwest Thornpeak
// cliffs (no POI, no map marker: found by exploring); side b is the Duskfall
// Cave on the realm's southern wall. Landings sit ~5yd outside the opposite
// trigger so arrivals never bounce straight back.
export const REALM_PORTALS: PortalDef[] = [
  {
    id: 'duskfall_passage',
    a: { x: -140, z: 845, landing: { x: -140, z: 841, facing: Math.PI } },
    b: { x: -140, z: 950, landing: { x: -140, z: 955, facing: 0 } },
    radius: 2.0,
    enterText: 'A veil of dusk parts before you, and the Hollow opens ahead.',
    leaveText: 'The veil closes behind you, and the mountain air bites again.',
  },
];

// ---------------------------------------------------------------------------
// Creatures. Beautiful first, dangerous second: most of the Hollow is passive
// or neutral; the hostile pockets are the corrupted fringe. Every creature
// reuses an existing rigged family (stags use the real stag model via
// MOB_KEYS in render/characters/manifest.ts; the stone guardians borrow the
// golem rig with a stone tint).
// ---------------------------------------------------------------------------

export const REALM_MOBS: Record<string, MobTemplate> = {
  glimmerwisp: {
    id: 'glimmerwisp',
    name: 'Glimmerwisp',
    minLevel: 15,
    maxLevel: 16,
    family: 'elemental',
    hpBase: 44,
    hpPerLevel: 16,
    dmgBase: 8,
    dmgPerLevel: 2.0,
    attackSpeed: 2.0,
    armorPerLevel: 10,
    moveSpeed: 7.5,
    aggroRadius: 0, // drifting ambient light, harmless unless harmed
    loot: [{ itemId: 'wisp_mote', chance: 0.6, questId: 'q_wisp_lights' }],
    scale: 0.7,
    color: 0xffc4ec,
  },
  duskwisp: {
    id: 'duskwisp',
    name: 'Duskwisp',
    minLevel: 15,
    maxLevel: 16,
    family: 'elemental',
    hpBase: 52,
    hpPerLevel: 19,
    dmgBase: 11,
    dmgPerLevel: 2.5,
    attackSpeed: 1.9,
    armorPerLevel: 12,
    moveSpeed: 8,
    aggroRadius: 9,
    // Duskchill: a clinging cold that seeps in where the veil has torn
    venom: { chance: 0.25, perTick: 4, interval: 2, duration: 8, name: 'Duskchill' },
    loot: [
      { copper: 70, chance: 1 },
      { itemId: 'duskwisp_essence', chance: 0.6, questId: 'q_veil_thinned' },
      { itemId: 'starfall_shard', chance: 0.5, questId: 'q_shards_of_starfall' },
    ],
    scale: 0.8,
    color: 0x7a5f9e,
  },
  hollow_spirit: {
    id: 'hollow_spirit',
    name: 'Hollow Spirit',
    minLevel: 16,
    maxLevel: 17,
    family: 'elemental',
    hpBase: 58,
    hpPerLevel: 21,
    dmgBase: 12,
    dmgPerLevel: 2.6,
    attackSpeed: 2.0,
    armorPerLevel: 14,
    moveSpeed: 7.5,
    aggroRadius: 5, // defends itself and its kin, never hunts
    mendAlly: { healMin: 38, healMax: 52, radius: 14, every: 9, name: 'Spirit Mending' },
    loot: [{ copper: 80, chance: 1 }],
    scale: 0.9,
    color: 0x8fe8d8,
  },
  veiled_stag: {
    id: 'veiled_stag',
    name: 'Veiled Stag',
    minLevel: 15,
    maxLevel: 16,
    family: 'beast',
    hpBase: 60,
    hpPerLevel: 20,
    dmgBase: 9,
    dmgPerLevel: 2.2,
    attackSpeed: 2.1,
    armorPerLevel: 12,
    moveSpeed: 9,
    aggroRadius: 0, // grazes in peace
    loot: [{ itemId: 'gleaming_antler', chance: 0.55, questId: 'q_gleaming_antlers' }],
    scale: 1.0,
    color: 0xb9a3cf,
  },
  gleamstag: {
    id: 'gleamstag',
    name: 'The Gleamstag',
    minLevel: 17,
    maxLevel: 17,
    family: 'beast',
    rare: true,
    elite: true,
    respawnMult: 7,
    hpBase: 300,
    hpPerLevel: 50,
    dmgBase: 15,
    dmgPerLevel: 3.6,
    attackSpeed: 1.8,
    armorPerLevel: 22,
    moveSpeed: 9.5,
    aggroRadius: 0, // even the legend will not strike first
    loot: [
      { copper: 260, chance: 1 },
      { itemId: 'gleamstag_charm', chance: 1 },
    ],
    scale: 1.3,
    color: 0xf2dcff,
  },
  sporeling_gatherer: {
    id: 'sporeling_gatherer',
    name: 'Sporeling Gatherer',
    minLevel: 15,
    maxLevel: 15,
    family: 'kobold',
    hpBase: 48,
    hpPerLevel: 17,
    dmgBase: 8,
    dmgPerLevel: 2.0,
    attackSpeed: 2.2,
    armorPerLevel: 10,
    moveSpeed: 7,
    aggroRadius: 0, // the mushroom folk tend their rings in peace
    loot: [],
    scale: 0.8,
    color: 0xd8b98a,
  },
  corrupted_sporeling: {
    id: 'corrupted_sporeling',
    name: 'Corrupted Sporeling',
    minLevel: 16,
    maxLevel: 17,
    family: 'kobold',
    hpBase: 60,
    hpPerLevel: 21,
    dmgBase: 13,
    dmgPerLevel: 2.8,
    attackSpeed: 2.0,
    armorPerLevel: 15,
    moveSpeed: 7.5,
    aggroRadius: 10,
    packFrenzy: { radius: 12, hasteMult: 1.3, duration: 8 },
    loot: [
      { copper: 85, chance: 1 },
      { itemId: 'spore_heart', chance: 0.65, questId: 'q_spore_hearts' },
    ],
    scale: 0.85,
    color: 0x5e4a72,
  },
  treant_elder: {
    id: 'treant_elder',
    name: 'Treant Elder',
    minLevel: 18,
    maxLevel: 18,
    family: 'ogre',
    elite: true,
    hpBase: 150,
    hpPerLevel: 27,
    dmgBase: 14,
    dmgPerLevel: 3.0,
    attackSpeed: 2.4,
    armorPerLevel: 26,
    moveSpeed: 6,
    aggroRadius: 6, // rooted patience; do not test it
    wardAllies: { radius: 14, every: 10, amount: 70, duration: 8, name: 'Bark Ward' },
    loot: [
      { copper: 150, chance: 1 },
      { itemId: 'elder_bark', chance: 0.7, questId: 'q_treant_accord' },
    ],
    scale: 1.45,
    color: 0x4f7a38, // mossy bark green (drives the treant rig wash)
  },
  ancient_guardian: {
    id: 'ancient_guardian',
    name: 'Ancient Guardian',
    minLevel: 18,
    maxLevel: 19,
    family: 'elemental',
    elite: true,
    hpBase: 165,
    hpPerLevel: 28,
    dmgBase: 14,
    dmgPerLevel: 3.0,
    attackSpeed: 2.2,
    armorPerLevel: 30,
    moveSpeed: 6.5,
    aggroRadius: 10,
    stoneskin: { amount: 90, every: 12, duration: 8, name: 'Stone Bulwark' },
    loot: [
      { copper: 170, chance: 1 },
      { itemId: 'guardian_core', chance: 0.4 },
    ],
    scale: 1.2,
    color: 0x9a94a8,
  },
  // --- wandering bosses: rare elites with their own silhouettes (the crab
  // and bull rigs appear nowhere else in the game) ---
  old_marrowshell: {
    id: 'old_marrowshell',
    name: 'Old Marrowshell',
    minLevel: 17,
    maxLevel: 17,
    family: 'beast',
    rare: true,
    elite: true,
    ccImmune: true,
    canSwim: true,
    respawnMult: 6,
    hpBase: 340,
    hpPerLevel: 54,
    dmgBase: 16,
    dmgPerLevel: 3.8,
    attackSpeed: 2.0,
    armorPerLevel: 34,
    moveSpeed: 6.5,
    aggroRadius: 9,
    stoneskin: { amount: 110, every: 12, duration: 8, name: 'Ancient Carapace' },
    venom: { chance: 0.3, perTick: 5, interval: 2, duration: 10, name: 'Coldwater Rot' },
    loot: [
      { copper: 700, chance: 1 },
      { itemId: 'guardian_core', chance: 1 },
      { itemId: 'duskfang_dirk', chance: 0.35 },
    ],
    scale: 1.5,
    color: 0x8fb8d8,
  },
  aurelhorn: {
    id: 'aurelhorn',
    name: 'Aurelhorn, First of the Herd',
    minLevel: 18,
    maxLevel: 18,
    family: 'beast',
    rare: true,
    elite: true,
    ccImmune: true,
    respawnMult: 6,
    hpBase: 360,
    hpPerLevel: 56,
    dmgBase: 17,
    dmgPerLevel: 3.8,
    attackSpeed: 1.9,
    armorPerLevel: 26,
    moveSpeed: 9,
    aggroRadius: 0, // the herd's warden strikes only when the herd is struck
    aoePulse: {
      min: 22,
      max: 30,
      radius: 8,
      every: 9,
      name: 'Trampling Charge',
      school: 'physical',
    },
    enrage: { belowHpPct: 0.35, dmgMult: 1.4, hasteMult: 1.3 },
    loot: [
      { copper: 700, chance: 1 },
      { itemId: 'gleaming_antler', chance: 1 },
      { itemId: 'veilsteel_blade', chance: 0.35 },
    ],
    scale: 1.45,
    color: 0xd8c49a,
  },
  waking_warden: {
    id: 'waking_warden',
    name: 'The Waking Warden',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    elite: true,
    ccImmune: true,
    respawnMult: 4,
    hpBase: 420,
    hpPerLevel: 60,
    dmgBase: 18,
    dmgPerLevel: 4.0,
    attackSpeed: 2.1,
    armorPerLevel: 32,
    moveSpeed: 7,
    aggroRadius: 12,
    aoePulse: { min: 24, max: 32, radius: 9, every: 10, name: 'Sundering Toll' },
    enrage: { belowHpPct: 0.3, dmgMult: 1.35, hasteMult: 1.25 },
    loot: [
      { copper: 600, chance: 1 },
      { itemId: 'wardens_seal', chance: 1, questId: 'q_waking_warden' },
    ],
    scale: 1.5,
    color: 0xb08fd8,
  },
};

// ---------------------------------------------------------------------------
// The people of Eldergleam.
// ---------------------------------------------------------------------------

export const REALM_NPCS: Record<string, NpcDef> = {
  keeper_saelwyn: {
    id: 'keeper_saelwyn',
    name: 'Keeper Saelwyn',
    title: 'Keeper of the Hollow',
    pos: { x: -42, z: 1019 },
    facing: 0.3,
    color: 0xd8c4f0,
    questIds: [
      'q_veil_thinned',
      'q_calming_the_deep',
      'q_sunken_court',
      'q_waking_warden',
      'q_seal_restored',
    ],
    greeting: 'Few of your kind have stood beneath these boughs, $C. Walk gently, and be welcome.',
  },
  loremother_bryn: {
    id: 'loremother_bryn',
    name: 'Loremother Bryn',
    title: 'Voice of the Shrine',
    pos: { x: -20, z: 1015 },
    facing: -0.9,
    color: 0xc4b08a,
    questIds: ['q_spore_hearts', 'q_wisp_lights', 'q_treant_accord', 'q_spore_tide'],
    greeting: 'Every light in this valley remembers something, $N. Help me listen.',
  },
  provisioner_fenna: {
    id: 'provisioner_fenna',
    name: 'Provisioner Fenna',
    title: 'Eldergleam Provisioner',
    pos: { x: -52, z: 1037.5 },
    facing: 1.6,
    color: 0x8fbf8a,
    questIds: ['q_gleaming_antlers', 'q_grove_menace'],
    vendorItems: [
      'trail_hardtack',
      'meltwater_flask',
      'roast_mountain_goat',
      'glacier_melt',
      'healing_potion',
      'mana_potion',
    ],
    greeting: 'Bread still warm, water still sweet. The Hollow provides, and so do I.',
  },
  wardsmith_orun: {
    id: 'wardsmith_orun',
    name: 'Wardsmith Orun',
    title: 'Keeper of the Old Forges',
    pos: { x: -28, z: 1039.5 },
    facing: -0.5,
    color: 0x9a86b8,
    questIds: [],
    vendorItems: ['wardplate_cuirass', 'nightweave_tunic', 'veilcloth_robe'],
    greeting: 'These forges cooled centuries ago, $C, but their work still holds an edge.',
  },
  archivist_tullo: {
    id: 'archivist_tullo',
    name: 'Archivist Tullo',
    title: 'Reader of Stones',
    pos: { x: -34, z: 1021 },
    facing: 2.6,
    color: 0xb8a8d8,
    questIds: ['q_monument_tour', 'q_shards_of_starfall', 'q_wardens_echoes'],
    greeting:
      'The monuments out there have not spoken to anyone in an age. Perhaps they were waiting for fresh ears.',
  },
};

// ---------------------------------------------------------------------------
// Quests: one connected seal-restoration chain plus side work, levels 15-20.
// ---------------------------------------------------------------------------

export const REALM_QUESTS: Record<string, QuestDef> = {
  q_veil_thinned: {
    id: 'q_veil_thinned',
    name: 'The Thinned Veil',
    giverNpcId: 'keeper_saelwyn',
    turnInNpcId: 'keeper_saelwyn',
    text: 'So the cave opened for you. Then the seal is weaker than I feared, $N. Where the veil tears, the wisps turn dark and cold. Bring me eight essences from the duskwisps and I will read how deep the wound runs.',
    completionText:
      'Cold, every one of them. The Hollow has perhaps a season before the tear becomes a rift. We have work to do, you and I.',
    objectives: [
      { type: 'collect', itemId: 'duskwisp_essence', count: 8, label: 'Duskwisp Essence' },
    ],
    xpReward: 3600,
    copperReward: 1600,
    itemRewards: {},
    minLevel: 14,
  },
  q_calming_the_deep: {
    id: 'q_calming_the_deep',
    name: 'Calming the Deep',
    giverNpcId: 'keeper_saelwyn',
    turnInNpcId: 'keeper_saelwyn',
    text: 'The sporelings of the Gleaming Deep were gentle folk before the tear touched their rings. What the corruption takes, it does not give back. Grant the corrupted ones rest, $N: ten of them, in the north of the Deep.',
    completionText:
      'You did what I could not bear to. The gatherers still sing in the south rings; because of you, they will keep singing.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'corrupted_sporeling',
        count: 10,
        label: 'Corrupted Sporeling laid to rest',
      },
    ],
    xpReward: 4200,
    copperReward: 2000,
    itemRewards: {
      warrior: 'veilsteel_blade',
      rogue: 'duskfang_dirk',
      mage: 'gleamwood_stave',
    },
    requiresQuest: 'q_veil_thinned',
    minLevel: 15,
  },
  q_spore_hearts: {
    id: 'q_spore_hearts',
    name: 'Hearts of the Ring',
    giverNpcId: 'loremother_bryn',
    turnInNpcId: 'loremother_bryn',
    text: 'When a sporeling falls to the dark, its heart keeps beating with borrowed shadow. Four of those hearts, cleansed at the shrine, may teach us how the corruption spreads. It is grim work, $N, but it is mending work.',
    completionText:
      'There. Cleansed, and quiet. Each one shows the same mark: the shadow flows FROM the Sunken Court. Tell Saelwyn.',
    objectives: [{ type: 'collect', itemId: 'spore_heart', count: 4, label: 'Spore Heart' }],
    xpReward: 4400,
    copperReward: 2200,
    itemRewards: {},
    requiresQuest: 'q_calming_the_deep',
    minLevel: 16,
  },
  q_sunken_court: {
    id: 'q_sunken_court',
    name: 'The Sunken Court',
    giverNpcId: 'keeper_saelwyn',
    turnInNpcId: 'keeper_saelwyn',
    text: 'Bryn read the hearts true: the tear runs through the old court in the east, and its guardians have woken wrong. They were built to protect the seal; now they will crush anyone who nears it. Clear eight of them from the ruins.',
    completionText:
      'Eight guardians, stilled. I remember when they were raised, $N. Do not look so surprised; the Hollow keeps its keepers a long time.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'ancient_guardian',
        count: 8,
        label: 'Ancient Guardian stilled',
      },
    ],
    xpReward: 5200,
    copperReward: 2600,
    itemRewards: {},
    requiresQuest: 'q_spore_hearts',
    minLevel: 17,
  },
  q_waking_warden: {
    id: 'q_waking_warden',
    name: 'The Waking Warden',
    giverNpcId: 'keeper_saelwyn',
    turnInNpcId: 'keeper_saelwyn',
    text: 'The court is quiet, but its master is not. The Warden that holds the seal has woken twisted, and while it stands, the seal cannot be mended. It will not fall easily; bring a friend if you can find one, $N. Bring two if you can find two.',
    completionText:
      'The bell of its voice is silent. I felt it from here, like a weight lifted off the whole valley.',
    objectives: [
      { type: 'kill', targetMobId: 'waking_warden', count: 1, label: 'The Waking Warden defeated' },
    ],
    xpReward: 6000,
    copperReward: 3800,
    itemRewards: {},
    requiresQuest: 'q_sunken_court',
    minLevel: 18,
    suggestedPlayers: 2,
  },
  q_seal_restored: {
    id: 'q_seal_restored',
    name: 'The Seal Restored',
    giverNpcId: 'keeper_saelwyn',
    turnInNpcId: 'keeper_saelwyn',
    text: "Take the Warden's seal to the sealstone at the heart of the court and set it back where it was struck loose. Then the Hollow can begin to heal, and you, $N, will have done what no one of your kind has done before.",
    completionText:
      'I felt it close from here, gentle as dusk. The Hollow remembers its friends, $N. However far you travel, there will always be a light for you beneath the great tree.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'hollow_sealstone',
        count: 1,
        label: 'The seal set back in the sealstone',
      },
    ],
    xpReward: 7400,
    copperReward: 5500,
    itemRewards: {
      warrior: 'wardens_oathband',
      rogue: 'wardens_oathband',
      mage: 'wardens_oathband',
    },
    requiresQuest: 'q_waking_warden',
    minLevel: 18,
  },
  q_gleaming_antlers: {
    id: 'q_gleaming_antlers',
    name: 'Gleaming Antlers',
    giverNpcId: 'provisioner_fenna',
    turnInNpcId: 'provisioner_fenna',
    text: 'The veiled stags shed light where they graze, and their cast antlers hold it for years. Five of them, from the herds at Starfall Basin, and my lanterns burn through the winter without oil. The stags need not be harmed, but they do not part with them easily.',
    completionText:
      'Look how they hold the light! No flame, no smoke, just the glow. The Hollow provides.',
    objectives: [
      { type: 'collect', itemId: 'gleaming_antler', count: 5, label: 'Gleaming Antler' },
    ],
    xpReward: 3400,
    copperReward: 1500,
    itemRewards: {},
    minLevel: 14,
  },
  q_wisp_lights: {
    id: 'q_wisp_lights',
    name: 'Lights of the Shallows',
    giverNpcId: 'loremother_bryn',
    turnInNpcId: 'loremother_bryn',
    text: 'The glimmerwisps carry motes of the old starlight that fell here when the Hollow was sealed. Six motes, and the shrine lamps will burn for a year. Take only from those that fade; the Hollow gives enough without greed.',
    completionText:
      'Soft as the first stars. Set them here by the altar; the shrine will do the rest.',
    objectives: [{ type: 'collect', itemId: 'wisp_mote', count: 6, label: 'Wisp Mote' }],
    xpReward: 3400,
    copperReward: 1500,
    itemRewards: {},
    minLevel: 14,
  },
  q_treant_accord: {
    id: 'q_treant_accord',
    name: 'The Treant Accord',
    giverNpcId: 'loremother_bryn',
    turnInNpcId: 'loremother_bryn',
    text: 'The elders of the Grove shed their outer bark as the corruption gnaws at their roots. Four lengths of it, and I can brew a salve for the whole Grove. They will not thank you while you pry it loose, $N, but they will stand a century longer for it.',
    completionText:
      'Thick and sound, all four. The salve will take a week to brew and a hundred years to finish its work. Trees measure kindness differently.',
    objectives: [{ type: 'collect', itemId: 'elder_bark', count: 4, label: 'Elder Bark' }],
    xpReward: 4400,
    copperReward: 2400,
    itemRewards: {},
    minLevel: 17,
  },
  q_monument_tour: {
    id: 'q_monument_tour',
    name: 'What the Stones Remember',
    giverNpcId: 'archivist_tullo',
    turnInNpcId: 'archivist_tullo',
    text: 'Three monuments still stand from before the sealing: one at the Duskfall Overlook, one in the Sunken Court, and one lost in the far northeast where nobody walks. Read them for me, $N. My knees gave out two centuries of stairs ago.',
    completionText:
      'An overlook, a court, and a forgotten corner... and all three verses of the sealing song, together for the first time since it was sung. You have made an old reader very happy.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'monument_overlook',
        count: 1,
        label: 'The Overlook monument read',
      },
      {
        type: 'interact',
        targetObjectItemId: 'monument_court',
        count: 1,
        label: 'The Court monument read',
      },
      {
        type: 'interact',
        targetObjectItemId: 'monument_north',
        count: 1,
        label: 'The forgotten monument read',
      },
    ],
    xpReward: 4200,
    copperReward: 2000,
    itemRewards: {},
    minLevel: 15,
  },

  q_grove_menace: {
    id: 'q_grove_menace',
    name: 'Menace in the Glade',
    giverNpcId: 'provisioner_fenna',
    turnInNpcId: 'provisioner_fenna',
    text: 'Duskwisps have started drifting in among my stalls after dark, $N, and their chill spoils everything it touches. Thin them out for me: ten of them, wherever the veil has torn.',
    completionText:
      'The night market can open again. You have a customer for life, or at least a discount.',
    objectives: [{ type: 'kill', targetMobId: 'duskwisp', count: 10, label: 'Duskwisp dispersed' }],
    xpReward: 4000,
    copperReward: 1900,
    itemRewards: {},
    requiresQuest: 'q_veil_thinned',
    minLevel: 15,
  },
  q_shards_of_starfall: {
    id: 'q_shards_of_starfall',
    name: 'Shards of Starfall',
    giverNpcId: 'archivist_tullo',
    turnInNpcId: 'archivist_tullo',
    text: 'When the duskwisps pass over the crystal fields, slivers of old starlight cling to them like burrs. Six shards, $N, and I can date the sealing to the very season it was sung.',
    completionText:
      'Look at the striations! Autumn. The Hollow was sealed in autumn. Two hundred years of argument, settled by six little stones.',
    objectives: [{ type: 'collect', itemId: 'starfall_shard', count: 6, label: 'Starfall Shard' }],
    xpReward: 4000,
    copperReward: 1900,
    itemRewards: {},
    requiresQuest: 'q_monument_tour',
    minLevel: 16,
  },
  q_spore_tide: {
    id: 'q_spore_tide',
    name: 'Against the Spore Tide',
    giverNpcId: 'loremother_bryn',
    turnInNpcId: 'loremother_bryn',
    text: 'The salve holds the Grove, but the corruption presses harder at the Deep with every dusk. Twelve more of the corrupted must be laid to rest before the gatherers can reclaim their north rings, $N.',
    completionText: 'The rings in the north are singing again tonight. Quietly, but singing.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'corrupted_sporeling',
        count: 12,
        label: 'Corrupted Sporeling laid to rest',
      },
    ],
    xpReward: 4400,
    copperReward: 2400,
    itemRewards: {},
    requiresQuest: 'q_spore_hearts',
    minLevel: 17,
  },
  q_wardens_echoes: {
    id: 'q_wardens_echoes',
    name: 'Echoes of the Warden',
    giverNpcId: 'archivist_tullo',
    turnInNpcId: 'archivist_tullo',
    text: 'Even with their master silenced, the court guardians repeat its last command like an echo that will not fade. Until the seal is set back, they will keep waking, $N. Still ten more of them so the masons can reach the sealstone.',
    completionText:
      'The echo grows fainter each time. Soon the court will hold nothing but wind and ivy, the way a ruin should.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'ancient_guardian',
        count: 10,
        label: 'Ancient Guardian stilled',
      },
    ],
    xpReward: 5200,
    copperReward: 2800,
    itemRewards: {},
    requiresQuest: 'q_sunken_court',
    minLevel: 18,
  },
};

export const REALM_QUEST_ORDER: string[] = [
  'q_veil_thinned',
  'q_gleaming_antlers',
  'q_wisp_lights',
  'q_calming_the_deep',
  'q_spore_hearts',
  'q_monument_tour',
  'q_grove_menace',
  'q_shards_of_starfall',
  'q_treant_accord',
  'q_spore_tide',
  'q_sunken_court',
  'q_wardens_echoes',
  'q_waking_warden',
  'q_seal_restored',
];

// ---------------------------------------------------------------------------
// Spawns. Appended LAST in data.ts CAMPS to keep existing rng draws stable.
// ---------------------------------------------------------------------------

export const REALM_CAMPS: CampDef[] = [
  { mobId: 'glimmerwisp', center: { x: 76, z: 1014 }, radius: 12, count: 4 },
  { mobId: 'glimmerwisp', center: { x: 60, z: 1150 }, radius: 14, count: 4 },
  { mobId: 'duskwisp', center: { x: 126, z: 1120 }, radius: 12, count: 4 },
  { mobId: 'duskwisp', center: { x: -30, z: 1200 }, radius: 14, count: 4 },
  { mobId: 'hollow_spirit', center: { x: -75, z: 1170 }, radius: 18, count: 5 },
  { mobId: 'veiled_stag', center: { x: 92, z: 962 }, radius: 18, count: 6 },
  { mobId: 'sporeling_gatherer', center: { x: -95, z: 1180 }, radius: 14, count: 5 },
  { mobId: 'corrupted_sporeling', center: { x: -25, z: 1218 }, radius: 14, count: 6 },
  { mobId: 'corrupted_sporeling', center: { x: -60, z: 1226 }, radius: 12, count: 5 },
  { mobId: 'treant_elder', center: { x: 25, z: 948 }, radius: 14, count: 3 },
  { mobId: 'ancient_guardian', center: { x: 125, z: 1085 }, radius: 16, count: 5 },
  { mobId: 'ancient_guardian', center: { x: 138, z: 1070 }, radius: 10, count: 3 },
  { mobId: 'waking_warden', center: { x: 125, z: 1085 }, radius: 3, count: 1 },
  // the rare glowing stag, deep in the hidden western clearing (no POI)
  { mobId: 'gleamstag', center: { x: -145, z: 1100 }, radius: 4, count: 1 },
  // wandering bosses (rare elites, long respawns, appended last for rng order)
  { mobId: 'old_marrowshell', center: { x: 103, z: 1144 }, radius: 5, count: 1 },
  { mobId: 'aurelhorn', center: { x: 70, z: 995 }, radius: 6, count: 1 },
];

// ---------------------------------------------------------------------------
// Ground objects: the sealstone finale and the three monument stones.
// ---------------------------------------------------------------------------

export const REALM_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'hollow_sealstone',
    name: 'The Hollow Sealstone',
    positions: [{ x: 125, z: 1085 }],
  },
  {
    itemId: 'monument_overlook',
    name: 'Weathered Monument',
    positions: [{ x: -118, z: 990 }],
  },
  {
    itemId: 'monument_court',
    name: 'Sunken Monument',
    positions: [{ x: 112, z: 1096 }],
  },
  {
    itemId: 'monument_north',
    name: 'Forgotten Monument',
    positions: [{ x: 160, z: 1228 }],
  },
];

// ---------------------------------------------------------------------------
// Items: quest pieces, the Calming reward trio, the finale band, the rare
// stag charm, and Wardsmith Orun's armor stock.
// ---------------------------------------------------------------------------

export const REALM_ITEMS: Record<string, ItemDef> = {
  // --- quest items ---
  duskwisp_essence: {
    id: 'duskwisp_essence',
    name: 'Duskwisp Essence',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_veil_thinned',
  },
  spore_heart: {
    id: 'spore_heart',
    name: 'Spore Heart',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_spore_hearts',
  },
  gleaming_antler: {
    id: 'gleaming_antler',
    name: 'Gleaming Antler',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_gleaming_antlers',
  },
  wisp_mote: {
    id: 'wisp_mote',
    name: 'Wisp Mote',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_wisp_lights',
  },
  starfall_shard: {
    id: 'starfall_shard',
    name: 'Starfall Shard',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_shards_of_starfall',
  },
  elder_bark: {
    id: 'elder_bark',
    name: 'Elder Bark',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_treant_accord',
  },
  hollow_sealstone: {
    id: 'hollow_sealstone',
    name: 'The Hollow Sealstone',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_seal_restored',
    noVendorSell: true,
    noDiscard: true,
  },
  monument_overlook: {
    id: 'monument_overlook',
    name: 'Weathered Monument',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_monument_tour',
    noVendorSell: true,
  },
  monument_court: {
    id: 'monument_court',
    name: 'Sunken Monument',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_monument_tour',
    noVendorSell: true,
  },
  monument_north: {
    id: 'monument_north',
    name: 'Forgotten Monument',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_monument_tour',
    noVendorSell: true,
  },
  // --- drops ---
  guardian_core: {
    id: 'guardian_core',
    name: 'Guardian Core',
    kind: 'junk',
    sellValue: 180,
  },
  wardens_seal: {
    id: 'wardens_seal',
    name: "The Warden's Seal",
    kind: 'quest',
    sellValue: 0,
    noVendorSell: true,
  },
  gleamstag_charm: {
    id: 'gleamstag_charm',
    name: 'Gleamstag Charm',
    kind: 'junk',
    quality: 'rare',
    sellValue: 2500,
  },
  // --- Calming the Deep rewards (archetype trio) ---
  veilsteel_blade: {
    id: 'veilsteel_blade',
    name: 'Veilsteel Blade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 20, max: 32, speed: 2.4 },
    stats: { str: 6, sta: 3 },
    sellValue: 950,
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  duskfang_dirk: {
    id: 'duskfang_dirk',
    name: 'Duskfang Dirk',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 13, max: 21, speed: 1.7, dagger: true },
    stats: { agi: 6, sta: 2 },
    sellValue: 950,
    requiredClass: ['rogue', 'hunter'],
  },
  gleamwood_stave: {
    id: 'gleamwood_stave',
    name: 'Gleamwood Stave',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 22, max: 35, speed: 2.9 },
    stats: { int: 7, sta: 2 },
    sellValue: 950,
    requiredClass: ['mage', 'priest', 'warlock', 'druid'],
  },
  // --- finale reward ---
  wardens_oathband: {
    id: 'wardens_oathband',
    name: "Warden's Oathband",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 40, sta: 5, spi: 4 },
    sellValue: 1800,
  },
  // --- Wardsmith Orun's stock ---
  wardplate_cuirass: {
    id: 'wardplate_cuirass',
    name: 'Wardplate Cuirass',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 190, str: 5, sta: 4 },
    sellValue: 1100,
    buyValue: 5200,
  },
  nightweave_tunic: {
    id: 'nightweave_tunic',
    name: 'Nightweave Tunic',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 120, agi: 5, sta: 4 },
    sellValue: 1100,
    buyValue: 5200,
  },
  veilcloth_robe: {
    id: 'veilcloth_robe',
    name: 'Veilcloth Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 70, int: 5, sta: 4 },
    sellValue: 1100,
    buyValue: 5200,
  },
};

export const REALM_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  // The two cave mouths of the Duskfall passage: the concealed entrance in
  // the Thornpeak cliffs and its twin on the realm's southern wall. The mine
  // arch faces its rot direction; the portal trigger sits just outside each.
  mines: [
    { x: -140, z: 847, rot: Math.PI }, // Thornpeak side, opening south
    { x: -140, z: 948, rot: 0 }, // realm side, opening north
  ],
  // Eldergleam: the hub town under the great tree (the tree itself is placed
  // by render/realm_flora.ts; these are the built structures around it).
  // The great tree's trunk is solid (colliders.ts); everything else rings it
  // at a respectful distance so the square breathes.
  greatTrees: [{ x: -40, z: 1026, r: 2.6 }],
  buildings: [
    { kind: 'inn', x: -58, z: 1046, w: 6, d: 7, rot: 0.7 },
    { kind: 'house', x: -22, z: 1048, w: 7, d: 6, rot: -0.4 },
    { kind: 'house', x: -62, z: 1016, w: 6, d: 6, rot: 1.2 },
    { kind: 'chapel', x: -18, z: 1012, w: 5, d: 7, rot: -1.9 }, // the shrine
  ],
  wells: [{ x: -40, z: 1042, r: 1.5 }],
  stalls: [
    { x: -52, z: 1036, rot: Math.PI / 2, r: 1.7 }, // Provisioner Fenna
    { x: -28, z: 1038, rot: -0.5, r: 1.7 }, // Wardsmith Orun
  ],
  crates: [
    [-51, 1033],
    [-27, 1041],
  ],
  campfires: [
    [-40, 1008], // town square gathering fire, south of the tree
    [-70, 1005], // wayfarer camp on the Duskfall road
    [32, 958], // Grove Keeper camp
  ],
  tents: [
    { x: 27, z: 953, rot: 0.6, scale: 1 }, // Grove Keeper camp
    { x: 35, z: 952, rot: -0.9, scale: 0.9 },
    { x: 31, z: 962, rot: 2.4, scale: 1.05 },
  ],
  fences: [
    // the magical garden ring on the town's north edge
    { x1: -52, z1: 1052, x2: -42, z2: 1056 },
    { x1: -42, z1: 1056, x2: -30, z2: 1055 },
    { x1: -30, z1: 1055, x2: -22, z2: 1050 },
  ],
  ruinRings: [
    // the Sunken Court: an overgrown temple complex
    { x: 125, z: 1085, ringR: 9, columns: 7 },
    { x: 138, z: 1072, ringR: 6, columns: 5 },
    { x: 112, z: 1098, ringR: 5, columns: 4 },
    // the Duskfall Overlook: a broken vantage ring at the first viewpoint
    { x: -118, z: 988, ringR: 4, columns: 3 },
    // a lone forgotten monument in the far northeast (no POI: a secret)
    { x: 160, z: 1230, ringR: 4, columns: 3 },
  ],
  graveyards: [{ x: -60, z: 1004 }],
};
