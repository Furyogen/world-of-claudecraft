const fs = require('fs');
// Only the two rock mounts move; other visuals share the 1.7 literal, so anchor
// each edit on its own VisualDef block rather than replacing the number globally.
let m = fs.readFileSync('src/render/characters/manifest.ts', 'utf8');
for (const key of ['mount_pet_rock', 'mount_shiny_pet_rock']) {
  const re = new RegExp(`(  ${key}: \{[\s\S]*?)    height: 1\.7,`);
  if (!re.test(m)) throw new Error(`height anchor for ${key}`);
  m = m.replace(re, '$1    height: 1.19,');
}
m = m.replace(
  '  // mount_visuals.ts carries the motion. Deliberately squat (1.5 tall against the\n  // 2.6 humanoid) so it reads as a boulder you perch on, not a mountain.',
  '  // mount_visuals.ts carries the motion. Deliberately squat (1.19 tall against\n  // the 2.6 humanoid) so it reads as a rock you perch on, not a mountain.',
);
fs.writeFileSync('src/render/characters/manifest.ts', m);

let v = fs.readFileSync('src/render/mount_visuals.ts', 'utf8');
const before = v;
v = v.replace("spec('mount_pet_rock', 1.62,", "spec('mount_pet_rock', 1.13,");
v = v.replace("spec('mount_shiny_pet_rock', 1.62,", "spec('mount_shiny_pet_rock', 1.13,");
if (v === before) throw new Error('seat anchors');
fs.writeFileSync('src/render/mount_visuals.ts', v);
console.log('resized');
