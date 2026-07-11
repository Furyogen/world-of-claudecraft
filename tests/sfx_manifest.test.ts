// Manifest builder tests: verify that buildManifest probes multiple extensions
// so custom recordings committed in non-MP3 formats are not silently dropped
// when the manifest is regenerated. Uses real temp directories (existsSync is
// the tested behaviour; mocking fs defeats the purpose).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildManifest } from '../scripts/sfx/sfx_manifest_builder.mjs';
import { SFX } from '../scripts/sfx/sfx_prompts.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const realSfxDir = path.join(repoRoot, 'public/audio/sfx');

let sfxDir: string;
let manifestPath: string;

beforeEach(() => {
  sfxDir = mkdtempSync(path.join(tmpdir(), 'woc_sfx_test_'));
  manifestPath = path.join(sfxDir, 'manifest.generated.ts');
});

afterEach(() => {
  rmSync(sfxDir, { recursive: true, force: true });
});

describe('buildManifest', () => {
  it('includes a key whose only file is a .wav (non-mp3 survives rebuild)', () => {
    writeFileSync(path.join(sfxDir, 'cast_lightning_bolt.wav'), '');
    const { count } = buildManifest([{ key: 'cast_lightning_bolt' }], sfxDir, manifestPath);
    expect(count).toBe(1);
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('cast_lightning_bolt.wav');
  });

  it('includes a key whose only file is a .mp3', () => {
    writeFileSync(path.join(sfxDir, 'melee_swing.mp3'), '');
    const { count } = buildManifest([{ key: 'melee_swing' }], sfxDir, manifestPath);
    expect(count).toBe(1);
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('melee_swing.mp3');
  });

  it('prefers .mp3 over .wav when both exist for the same bare key', () => {
    writeFileSync(path.join(sfxDir, 'melee_swing.mp3'), '');
    writeFileSync(path.join(sfxDir, 'melee_swing.wav'), '');
    buildManifest([{ key: 'melee_swing' }], sfxDir, manifestPath);
    const manifest = readFileSync(manifestPath, 'utf8');
    // Only the mp3 entry should appear; wav should not since mp3 is probed first.
    const urls = JSON.parse(manifest.split('=\n')[1].replace(/ as const;/, ''));
    expect(urls['melee_swing'].urls).toEqual(['/audio/sfx/melee_swing.mp3']);
  });

  it('groups numbered variants under their base key', () => {
    writeFileSync(path.join(sfxDir, 'foot_grass_1.mp3'), '');
    writeFileSync(path.join(sfxDir, 'foot_grass_2.mp3'), '');
    const { count } = buildManifest([{ key: 'foot_grass' }], sfxDir, manifestPath);
    expect(count).toBe(1);
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('foot_grass_1.mp3');
    expect(manifest).toContain('foot_grass_2.mp3');
  });

  it('omits keys with no matching file on disk', () => {
    const { count } = buildManifest([{ key: 'ghost_key' }], sfxDir, manifestPath);
    expect(count).toBe(0);
  });

  it('honours the loop flag from the catalog entry', () => {
    writeFileSync(path.join(sfxDir, 'amb_wind.mp3'), '');
    buildManifest([{ key: 'amb_wind', loop: true }], sfxDir, manifestPath);
    const manifest = readFileSync(manifestPath, 'utf8');
    const data = JSON.parse(manifest.split('=\n')[1].replace(/ as const;/, ''));
    expect(data['amb_wind'].loop).toBe(true);
  });

  // Decisive regression pin: a key present on disk but missing from the SFX
  // catalog is silently dropped from every rebuild (the loop only visits
  // catalog entries). cast_lightning_bolt was lost this way; pin it, and any
  // future catalog omission, against the REAL catalog and REAL disk so this
  // class of bug fails loudly instead of shipping silent.
  it('rebuilds the real manifest from the real catalog without dropping any on-disk key', () => {
    const { count } = buildManifest(SFX, realSfxDir, manifestPath);
    expect(count).toBeGreaterThan(0);
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('cast_lightning_bolt');
  });
});
