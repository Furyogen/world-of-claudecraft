// The one normalization rule for placed catalogue GLBs: what world height a
// model lands at before its per-placement scale. Split out of placed_assets.ts
// so the collision bake script (scripts/assets/bake_collision.mjs) normalizes
// with EXACTLY the same numbers the renderer seats models with - if these two
// ever disagreed, baked colliders would drift off their models.

// Height (yards) a placed model is normalized to before its per-placement
// scale, so arbitrary catalogue GLBs (which vary wildly in source units) land
// sanely.
export const TARGET_HEIGHT = 2.2;

// Catalogue foliage lands at believable WORLD sizes instead of the generic
// prop height: a tree normalized to 2.2yd is doll-sized next to the ~2yd
// player, which made every brushed tree/bush read far too small no matter
// what the scale sliders said. Per-placement scale still multiplies on top,
// and sim/map_doc.ts COLLIDE_FACTORS are tuned against these same heights so
// the blocking circle keeps tracking the visual silhouette.
export function targetHeightFor(path: string): number {
  // Palms live in the biome set but are trees: match them wherever they sit.
  if (/beach_palm/i.test(path)) return 4;
  if (/desert_cactus_tall/i.test(path)) return 4.5;
  const m = /\/foliage\/([a-z0-9_]+)\.glb$/i.exec(path);
  if (!m) return TARGET_HEIGHT;
  const name = m[1];
  if (/^(oak|pine|twisted|dead)/.test(name)) return 7.5;
  if (/^bush/.test(name)) return 3.2;
  if (/^(fern|mushroom)/.test(name)) return 1.6;
  if (/^rock/.test(name)) return 2.4;
  return TARGET_HEIGHT;
}
