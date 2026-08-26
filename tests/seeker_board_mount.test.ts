import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import { BASE_ITEMS } from '../src/sim/content/items';
import { MOUNTS } from '../src/sim/content/mounts';

// The Solana Seeker: the promotional mount for Solana Mobile Seeker Genesis
// Token holders (issue #3628). These pin the parts that fail SILENTLY rather
// than loudly: a ClipMap naming a clip the GLB does not carry freezes the mount
// on its bind pose, and a missing engine take leaves it mute instead of erroring.
const ROOT = join(__dirname, '..');
const GLB = 'public/models/mounts/seeker_board.glb';

function glbJson(rel: string): { animations?: { name?: string }[]; nodes?: { name?: string }[] } {
  const b = readFileSync(join(ROOT, rel));
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}

describe('Solana Seeker mount asset', () => {
  it('ships the model', () => {
    expect(existsSync(join(ROOT, GLB)), GLB).toBe(true);
    expect(statSync(join(ROOT, GLB)).size).toBeGreaterThan(1000);
  });

  it('carries every clip MOUNT_SEEKER names', () => {
    const names = (glbJson(GLB).animations ?? []).map((a) => a.name);
    // Idle, Walk and Jump are authored on the source model; Run and Death are
    // baked by scripts/bake_seeker_gaits.mjs, because ClipMap requires both and
    // the source ships neither.
    for (const clip of ['Idle', 'Walk', 'Run', 'Death', 'Jump']) {
      expect(names, clip).toContain(clip);
    }
  });

  it('keeps the rider anchor the visual spec is measured against', () => {
    // mount_visuals seats the rider at hover + Seat * normScale. If the rig ever
    // loses this bone the seat number silently becomes a guess.
    const src = readFileSync(join(ROOT, 'scripts/bake_seeker_gaits.mjs'), 'utf8');
    expect(src).toContain('Hover');
    const nodes = (glbJson(GLB).nodes ?? []).map((n) => n.name);
    expect(nodes).toContain('Seat');
    expect(nodes).toContain('Hover');
  });
});

describe('Solana Seeker mount wiring', () => {
  it('registers in the sim catalog at the collectible tier', () => {
    const def = MOUNTS.seeker_board;
    expect(def).toBeDefined();
    expect(def.key).toBe('seeker_board');
    // Speed is the only stat a mount grants, so a promotional mount must not
    // out-run the ladder: it sits at the epic tier with the other collectibles.
    expect(def.rarity).toBe('epic');
    expect(def.moveSpeedPct).toBe(0.8);
  });

  it('binds the reins so the reward cannot reach a secondary market', () => {
    // Issue #3628: one mount per Genesis Token, permanently bound to the
    // claiming account, never sold, traded or transferred.
    const item = BASE_ITEMS.reins_seeker_board;
    expect(item).toBeDefined();
    expect(item.kind).toBe('mount');
    if (item.kind !== 'mount') throw new Error('not a mount item');
    expect(item.mount).toBe('seeker_board');
    expect(item.soulbound).toBe(true);
    expect(item.noDiscard).toBe(true);
    expect(item.sellValue).toBe(0);
  });

  it('points the visual at the board and sizes it as a height, not a length', () => {
    const src = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');
    const start = src.indexOf('  mount_seeker_board: {');
    expect(start, 'mount_seeker_board VisualDef').toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('  },', start));
    expect(block).toContain('seeker_board.glb');
    expect(block).toContain('clips: MOUNT_SEEKER');
    // The rig points down +X while visuals face +Z, so the quarter turn is
    // load-bearing: without it the board travels sideways under the rider.
    expect(block).toContain('yaw: -Math.PI / 2');
    // normScale is def.height / the model's Y extent, and this deck is 0.19
    // tall. A height in the 2-3 range like the other mounts would scale it past
    // 20 yards long, so an unexplained bump here is a real defect.
    const height = Number(/height:\s*([\d.]+)/.exec(block)?.[1]);
    expect(height).toBeGreaterThan(0.2);
    expect(height).toBeLessThan(0.8);
    // A hover board resting in the dirt is not hovering.
    expect(block).toMatch(/hover:\s*0?\.\d+/);
  });

  it('spreads the shared mount ClipMap rather than editing it', () => {
    // Adding `jump` to MOUNT_RIGGED itself would hand a jump clip to every other
    // mount, none of which ships one.
    const src = readFileSync(join(ROOT, 'src/render/characters/manifest.ts'), 'utf8');
    expect(src).toContain("const MOUNT_SEEKER: ClipMap = { ...MOUNT_RIGGED, jump: 'Jump' };");
    const rigged = src.slice(src.indexOf('const MOUNT_RIGGED: ClipMap = {'));
    expect(rigged.slice(0, rigged.indexOf('};'))).not.toContain('jump:');
  });
});

describe('Seeker board rider pose', () => {
  it('channels for the whole ride, not just at rest', () => {
    // `cast` outranks both the seated loop and locomotion in
    // desiredBaseState, so a channel pose holds at speed as well as standing
    // still. That ordering is what makes a permanent channel possible at all.
    const src = readFileSync(join(ROOT, 'src/render/characters/anim_state.ts'), 'utf8');
    const order = src.slice(src.indexOf('export function desiredBaseState('));
    const cast = order.indexOf("return 'cast'");
    const sit = order.indexOf("return 'sit'");
    expect(cast).toBeGreaterThan(-1);
    expect(sit).toBeGreaterThan(-1);
    expect(cast, 'cast must outrank sit').toBeLessThan(sit);
  });

  it('puts only this mount in the channel pose', () => {
    const src = readFileSync(join(ROOT, 'src/render/mount_visuals.ts'), 'utf8');
    expect(src).toContain("'channel'");
    // Every other mount keeps the seated saddle pose; pinned in
    // tests/mount_visuals.test.ts against the whole catalog.
    const line = src.split(String.fromCharCode(10)).find((l) => l.includes('seeker_board: spec('));
    expect(line, 'seeker_board spec').toBeTruthy();
    expect(line).toContain("'channel'");
  });
});

describe('Solana Seeker engine audio', () => {
  // mountEngine derives mount_run_<key>{_start,,_stop} and treats a mount as an
  // engine mount only when all three resolve, so a missing take degrades to
  // silence rather than to an error.
  it('ships the full windup, sustain and winddown set', () => {
    for (const suffix of ['_start', '', '_stop']) {
      const key = `mount_run_seeker_board${suffix}`;
      expect(SFX_CLIPS[key as keyof typeof SFX_CLIPS], key).toBeDefined();
    }
  });

  it('marks only the sustain take as looping, and all three as positional', () => {
    const start = SFX_CLIPS.mount_run_seeker_board_start;
    const loop = SFX_CLIPS.mount_run_seeker_board;
    const stop = SFX_CLIPS.mount_run_seeker_board_stop;
    expect(loop.loop).toBe(true);
    expect(start.loop).toBeFalsy();
    expect(stop.loop).toBeFalsy();
    for (const entry of [start, loop, stop]) expect(entry.spatial).toBe(true);
  });

  it('ships a non-empty asset for each take', () => {
    for (const suffix of ['_start', '', '_stop']) {
      const file = join(ROOT, `public/audio/sfx/mount_run_seeker_board${suffix}.mp3`);
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(2000);
    }
  });
});
