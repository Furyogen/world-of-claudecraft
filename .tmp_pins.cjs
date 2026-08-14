const fs = require('fs');
function edit(p, pairs) {
  let s = fs.readFileSync(p, 'utf8');
  for (const [from, to] of pairs) {
    if (!s.includes(from)) throw new Error(`anchor in ${p}: ${from.slice(0, 70)}`);
    s = s.replace(from, to);
  }
  fs.writeFileSync(p, s);
  console.log('ok', p);
}
edit('tests/mounts.test.ts', [
  ["it('has exactly ten mounts with the horse first and the developer tank last', () => {\n    expect(MOUNT_KEYS).toHaveLength(10);",
   "it('has exactly eleven mounts with the horse first and the developer tank last', () => {\n    expect(MOUNT_KEYS).toHaveLength(11);"],
  ["    expect(spec('terrorspark_groundshaker')).toEqual(['epic', 0.8]);",
   "    expect(spec('terrorspark_groundshaker')).toEqual(['epic', 0.8]);\n    // The socketed rock is a plain epic: the tier's 80%, no bespoke number.\n    expect(spec('shiny_pet_rock')).toEqual(['epic', 0.8]);"],
  ["    const NO_SOURCE_YET: readonly string[] = ['reins_drakemaw_raptor', 'reins_pet_rock'];",
   "    const NO_SOURCE_YET: readonly string[] = [\n      'reins_drakemaw_raptor',\n      'reins_pet_rock',\n      'reins_shiny_pet_rock',\n    ];"],
]);
edit('tests/character_clipmaps.test.ts', [
  ["  'mount_pet_rock',", "  'mount_pet_rock',\n  'mount_shiny_pet_rock',"],
]);
edit('tests/sfx_manifest.test.ts', [
  ["it('keeps the release catalog, all 10 mount cues, and all 63 UI cues in one 266-key inventory', () => {\n    const keys = new Set(SFX.map((entry) => entry.key));\n    expect(keys.size).toBe(266);",
   "it('keeps the release catalog, all 11 mount cues, and all 63 UI cues in one 267-key inventory', () => {\n    const keys = new Set(SFX.map((entry) => entry.key));\n    expect(keys.size).toBe(267);"],
  ['    expect(SFX_FIXED_CATALOG_KEYS).toHaveLength(266);', '    expect(SFX_FIXED_CATALOG_KEYS).toHaveLength(267);'],
]);
edit('tests/chat.test.ts', [
  ['// 10 since the Pet Rock joined the catalog. Spelled as a literal on', '// 11 since the Shiny Pet Rock joined the catalog. Spelled as a literal on'],
  ['Granted 10 mount reins', 'Granted 11 mount reins'],
]);
edit('tests/profile_page.test.ts', [['expect(catalogTotal).toBe(312);', 'expect(catalogTotal).toBe(313);']]);
edit('tests/reliquary_content.test.ts', [
  ['    expect(full).toEqual({ owned: 341, total: 341 });', '    expect(full).toEqual({ owned: 342, total: 342 });'],
  ['    expect(character).toEqual({ owned: 312, total: 312 });', '    expect(character).toEqual({ owned: 313, total: 313 });'],
  ['    ).toBe(376);', '    ).toBe(377);'],
  ["      horizons_mounts: ['drakemaw_raptor', 'pet_rock', 'terrorspark_groundshaker'],",
   "      horizons_mounts: [\n    'drakemaw_raptor',\n    'pet_rock',\n    'shiny_pet_rock',\n    'terrorspark_groundshaker',\n  ],"],
  ["    expect(SOURCE_PENDING_RULING.horizons_mounts).toEqual([\n      'drakemaw_raptor',\n      'pet_rock',\n      'terrorspark_groundshaker',\n    ]);",
   "    expect(SOURCE_PENDING_RULING.horizons_mounts).toEqual([\n      'drakemaw_raptor',\n      'pet_rock',\n      'shiny_pet_rock',\n      'terrorspark_groundshaker',\n    ]);"],
]);
