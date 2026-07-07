// Tiny deterministic PRNG shared across the render layer. The render
// convention forbids Math.random for placement/seeding (see sealife.ts), so
// every decorative field (birds, motes, critters, fish, mist, spirits, the
// asteroid sky, weather particles) seeds a local generator off a fixed
// constant or the world seed. This is the single mulberry32 those all share -
// same algorithm as before, just no longer copy-pasted eight times.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
