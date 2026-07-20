// Generate the gallery's bespoke SFX via the ElevenLabs sound-generation API.
//   node scripts/_tmp_gen_sfx.mjs             — generate everything missing (resumable)
//   node scripts/_tmp_gen_sfx.mjs --only imp_storm,thunder
//   node scripts/_tmp_gen_sfx.mjs --takes 3
// Key: ELEVENLABS_API_KEY in env or a repo-root .env (never committed, never logged).
// Loops (windup beds / travel / beam hum / ambience) stay PROCEDURAL by design —
// they must crescendo with cast progress and pitch-bend in slow-mo. Samples own
// the one-shots, where recorded texture beats synthesis.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

try { process.loadEnvFile(); } catch {}
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('ELEVENLABS_API_KEY not set. Put it in the environment or a repo-root .env file.');
  process.exit(1);
}

const OUTDIR = 'tmp/vfx/sfx';
mkdirSync(OUTDIR, { recursive: true });

const only = (process.argv.find((a) => a.startsWith('--only')) ?? '').split('=')[1]?.split(',');
const TAKES = parseInt((process.argv.find((a) => a.startsWith('--takes')) ?? '').split('=')[1] ?? '2', 10);

// [id, duration_seconds, prompt] — prompts tuned for cinematic fantasy one-shots
const SHOTLIST = [
  // ---- the 12 palette impact identities (the heart of the upgrade) ----
  // v2 prompts: depth, crunch and body — every hit anchored by a deep bass slam
  ['imp_storm', 1.8, 'Colossal lightning strike impact: violent gritty electric crack with crunchy distorted texture, slamming into a massive deep bass thunder boom, punchy cinematic fantasy hit with heavy low end, no music'],
  ['imp_fire', 1.7, 'Massive fireball explosion impact: deep punchy bass detonation with crunchy fiery debris and gritty crackling embers, heavy cinematic movie explosion body, no music'],
  ['imp_frost', 1.6, 'Heavy ice impact: thick crunchy glass shatter with gritty crushing texture over a deep frozen bass thud, punchy cinematic fantasy hit with low-end weight, no music'],
  ['imp_arcane', 1.5, 'Powerful arcane blast impact: resonant crystalline zap with a deep punchy bass thump core and crunchy energy discharge, weighty cinematic fantasy hit, no music'],
  ['imp_shadow', 1.8, 'Devastating void magic impact: cavernous deep sub-bass boom with gritty distorted suction crunch and an ominous heavy rumble tail, dark cinematic hit with massive low end, no music'],
  ['imp_holy', 1.8, 'Mighty holy smite impact: huge bell strike with a deep punchy bass slam underneath, radiant shimmer over heavy resonant body, epic cinematic fantasy, no music'],
  ['imp_nature', 1.5, 'Heavy nature impact: thick wooden slam with deep bass thud body, crunchy snapping branches and gritty bark texture, punchy cinematic fantasy hit, no music'],
  ['imp_blood', 1.4, 'Brutal visceral impact: heavy wet crunch with a deep meaty bass slam, gritty bone-crack texture, punchy dark fantasy hit with weight, no music'],
  ['imp_moon', 1.7, 'Deep lunar magic impact: heavy glassy chime strike with a punchy low bass pulse core and cold shimmering tail, weighty mystical cinematic hit, no music'],
  ['imp_venom', 1.5, 'Heavy poison impact: thick acidic burst with deep bass splat body, gritty bubbling crunch and sizzling hiss, punchy fantasy hit, no music'],
  ['imp_gold', 1.5, 'Massive golden strike: heavy metallic anvil ring with deep punchy bass slam body and crunchy coin scatter, weighty cinematic fantasy hit, no music'],
  ['imp_physical', 1.3, 'Devastating sword strike on wood: sharp gritty steel crunch with splintering crack over a deep punchy bass thud body, heavy cinematic melee hit, no music'],
  // ---- cast releases per school family ----
  ['rel_fire', 0.9, 'Fire spell cast release: fiery whoosh burst with ember crackle, fantasy magic, no music'],
  ['rel_frost', 0.9, 'Ice spell cast release: icy crystalline whoosh with frosty sparkle, fantasy magic, no music'],
  ['rel_arcane', 0.9, 'Arcane spell cast release: quick magical zip whoosh with harmonic sparkle, fantasy magic, no music'],
  ['rel_shadow', 1.0, 'Dark magic cast release: ominous hollow whoosh with whispering void energy, fantasy magic, no music'],
  ['rel_holy', 1.1, 'Holy spell cast release: radiant harmonic swell whoosh with soft chime, fantasy magic, no music'],
  ['rel_nature', 0.9, 'Nature spell cast release: leafy swish whoosh with organic rustle, druidic magic, no music'],
  ['rel_storm', 0.9, 'Lightning spell cast release: electric zap whoosh with static crackle, fantasy magic, no music'],
  ['rel_physical', 0.7, 'Fast weapon swing whoosh cutting through air, sharp and aggressive, no music'],
  // ---- melee whooshes ----
  ['whoosh_blade', 0.6, 'Single fast sword swing whoosh, sharp blade cutting air, no music'],
  ['whoosh_heavy', 0.8, 'Heavy two-handed weapon swing whoosh, deep powerful air cut, no music'],
  // ---- set pieces ----
  ['thunder', 3.6, 'Apocalyptic close thunderclap: violent gritty crack with crunchy electric texture, then an enormous deep sub-bass thunder roll shaking the ground, echoing across distant hills, massive low end, no music'],
  ['shout_war', 1.6, 'Fierce battle war cry: powerful warrior roar shout, aggressive male voice, fantasy battle, no music'],
  ['heal_holy', 2.0, 'Gentle holy healing spell: warm angelic shimmer swell with soft bell chimes, uplifting fantasy magic, no music'],
  ['heal_nature', 2.0, 'Nature healing spell: soft blooming growth shimmer with gentle wind chimes, druidic restoration magic, no music'],
  ['buff_raise', 1.4, 'Magical empowerment buff: rising sparkle shimmer into a warm harmonic swell, fantasy enchantment, no music'],
  ['buff_veil', 1.2, 'Stealth vanish: soft smoke puff with an airy whispering fade, rogue disappearing into shadow, no music'],
  ['buff_morph', 1.3, 'Shapeshift transformation: fleshy magical morph with an implosion whoosh and energy pop, fantasy druid, no music'],
  ['portal', 2.2, 'Dark summoning portal opening: deep otherworldly hum with swirling void energy and a demonic undertone, no music'],
  ['poof', 0.8, 'Magical poof: soft puff burst with a whimsical sparkle chime, playful transformation spell, no music'],
  ['dash', 0.9, 'Fast dash wind rush: aggressive air whoosh with cloth flutter, character sprinting burst, no music'],
  // ---- spirit apparition creature calls ----
  ['spirit_wolf', 2.2, 'Ghostly wolf howl, ethereal and haunting with a distant echo, no music'],
  ['spirit_bear', 1.8, 'Deep bear roar, powerful guttural fantasy creature, slight ethereal echo, no music'],
  ['spirit_raptor', 1.4, 'Velociraptor guttural snarl with a low menacing growl and short hiss, restrained, no screeching, no music'],
  ['spirit_hawk', 1.6, 'Hawk cry echoing across an open sky, majestic and distant, soft attack, not piercing, no music'],
  ['spirit_bull', 1.6, 'Aggressive bull snort and bellow with a heavy hoof stomp, no music'],
  ['spirit_sheep', 1.2, 'Sheep bleat baa, clear and slightly comedic, no music'],
  ['spirit_stag', 1.8, 'Majestic stag bellow, deep resonant deer call with forest echo, no music'],
  ['spirit_fox', 1.0, 'Quick fox bark yip, light and wild, brief and subtle, not screaming, no music'],
  ['spirit_demon', 1.6, 'Small demon imp growling cackle, mischievous evil creature voice, no music'],
  ['spirit_voidwalker', 2.4, 'Deep otherworldly void creature moan, slow ominous ethereal groan, no music'],
  ['spirit_ghost', 2.2, 'Ghostly wail, ethereal mournful spirit moan with reverb, no music'],
  // ---- motif foley ----
  ['motif_fissure', 1.8, 'Earth cracking open: deep rocky rumble with stone splitting and falling debris, no music'],
  ['motif_gavel', 1.8, 'Colossal ceremonial hammer slamming stone: crushing deep bass impact with gritty rock crunch and a huge resonant metallic gong ring-out, massive cinematic weight, no music'],
  ['motif_chains', 1.4, 'Heavy metal chains rattling fast then snapping taut, no music'],
  ['motif_vines', 1.5, 'Thick vines rapidly growing and creaking, plant tendrils wrapping and tightening, no music'],
  ['motif_pillars', 1.6, 'Rapid sequence of stone pillars erupting from the ground, rocky bursts one after another, no music'],
  ['motif_slashes', 1.0, 'Two rapid crossing blade slashes cutting air, sharp sword swishes, no music'],
  ['motif_implosion', 1.2, 'Reverse suction implosion: air rushing inward then a compressed pop, no music'],
  ['motif_swarm', 1.5, 'Swarm of dark insects bursting out and scattering, fluttering chittering wings, no music'],
];

const list = SHOTLIST.filter(([id]) => !only || only.includes(id));
let made = 0, skipped = 0, failed = 0, creditsEst = 0;
for (const [id, dur, prompt] of list) {
  for (let t = 1; t <= TAKES; t++) {
    const file = `${OUTDIR}/${id}_${t}.mp3`;
    if (existsSync(file)) { skipped++; continue; }
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
          method: 'POST',
          headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: prompt, duration_seconds: dur, prompt_influence: 0.55 }),
        });
        if (res.status === 401) { console.error('API key rejected (401) — check ELEVENLABS_API_KEY.'); process.exit(1); }
        if (!res.ok) {
          const body = await res.text();
          console.log(`  retry ${id}_${t} (HTTP ${res.status}) ${body.slice(0, 120)}`);
          await new Promise((r) => setTimeout(r, 2500 * attempt));
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(file, buf);
        console.log(`ok ${id}_${t} (${(buf.length / 1024).toFixed(0)}KB)`);
        made++; creditsEst += Math.ceil(dur) * 40;
        ok = true;
      } catch (e) {
        console.log(`  retry ${id}_${t} (${e.message.slice(0, 80)})`);
        await new Promise((r) => setTimeout(r, 2500 * attempt));
      }
    }
    if (!ok) { failed++; console.log(`FAILED ${id}_${t}`); }
  }
}
console.log(`done — ${made} generated, ${skipped} already present, ${failed} failed; ~${creditsEst} credits used this run`);
process.exit(failed ? 1 : 0);
