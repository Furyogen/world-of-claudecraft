import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMusicThemes,
  dungeonMusicZoneForDungeon,
  MusicDirector,
  musicZoneForLocation,
  riftMusicZoneForTheme,
  shouldResetMusicForDungeonEntry,
  THEME_TRIM,
} from '../src/game/music';
import { RIFT_THEMES } from '../src/sim/content/rift/themes';
import type { BiomeId } from '../src/sim/types';

class FakeParam {
  value = 0;
  setTargetAtTime = vi.fn((value: number) => {
    this.value = value;
  });
}

class FakeNode {
  connect = vi.fn(() => this);
  disconnect = vi.fn();
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeBufferSource extends FakeNode {
  static instances: FakeBufferSource[] = [];
  buffer: unknown = null;
  loop = false;
  start = vi.fn();
  stop = vi.fn();

  constructor() {
    super();
    FakeBufferSource.instances.push(this);
  }
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  decodeAudioData = vi.fn(async () => ({ decoded: true }));
  createGain = vi.fn(() => new FakeGain());
  createDynamicsCompressor = vi.fn(() => ({
    ...new FakeNode(),
    threshold: new FakeParam(),
    knee: new FakeParam(),
    ratio: new FakeParam(),
    attack: new FakeParam(),
    release: new FakeParam(),
  }));
  createConvolver = vi.fn(() => ({ ...new FakeNode(), buffer: null }));
  createBuffer = vi.fn((_channels: number, length: number) => ({
    getChannelData: () => new Float32Array(length),
  }));
  createBufferSource = vi.fn(() => new FakeBufferSource());
  resume = vi.fn(async () => undefined);
}

describe('MusicDirector — combat / background mix', () => {
  let director: MusicDirector;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1) });
    director = new MusicDirector();
    director.init();
  });

  afterEach(() => {
    clearInterval((director as unknown as { timer: number }).timer);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeBufferSource.instances = [];
  });

  const layers = () =>
    (
      director as unknown as {
        layers: Record<string, { target: number }>;
      }
    ).layers;

  it('plays the zone theme and no combat layer when out of combat', () => {
    director.update('vale', false);
    expect(layers().vale.target).toBe(1);
    expect(layers().combat.target).toBe(0);
  });

  it('silences the zone theme so ONLY combat music plays in combat (no layering)', () => {
    director.update('vale', false);
    director.update('vale', true);
    expect(layers().vale.target).toBe(0);
    expect(layers().combat.target).toBe(1);
  });

  it('restores the background theme and drops combat when combat ends', () => {
    director.update('vale', true);
    director.update('vale', false);
    expect(layers().vale.target).toBe(1);
    expect(layers().combat.target).toBe(0);
  });

  it('never runs the zone and combat layers at non-zero gain simultaneously', () => {
    for (const inCombat of [false, true, false, true]) {
      director.update('vale', inCombat);
      const zone = layers().vale.target;
      const combat = layers().combat.target;
      expect(Math.min(zone, combat)).toBe(0);
    }
  });
});

describe('MusicDirector boss combat loop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeBufferSource.instances = [];
  });

  it('loads and loops the boss track through the unlocked music AudioContext', async () => {
    const fetchMock = vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1) });

    const director = new MusicDirector();
    director.init();
    director.setBossCombat(true);
    for (let i = 0; i < 10 && FakeBufferSource.instances.length === 0; i++) {
      await Promise.resolve();
    }

    expect(fetchMock).toHaveBeenCalledWith('/audio/dungeon-boss-fight.mp3');
    const source = FakeBufferSource.instances[0];
    expect(source.loop).toBe(true);
    expect(source.start).toHaveBeenCalledTimes(1);

    director.setBossCombat(false);
    expect(source.stop).toHaveBeenCalledTimes(1);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('dungeon music entry reset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeBufferSource.instances = [];
  });

  it('resets only when entering a dungeon or changing dungeon instances', () => {
    expect(shouldResetMusicForDungeonEntry(null, 'nythraxis_boss_arena')).toBe(true);
    expect(shouldResetMusicForDungeonEntry('nythraxis_boss_arena', 'nythraxis_boss_arena')).toBe(
      false,
    );
    expect(shouldResetMusicForDungeonEntry('nythraxis_boss_arena', 'hollow_crypt')).toBe(true);
    expect(shouldResetMusicForDungeonEntry('nythraxis_boss_arena', null)).toBe(false);
  });

  it('rewinds the active dungeon layer and boss loop on dungeon entry', () => {
    const director = new MusicDirector();
    const layer = { target: 1, anchor: 100, nextIdx: 7, loopCount: 3 };
    const bossElement = { currentTime: 19 };
    (director as unknown as { ctx: { currentTime: number } }).ctx = { currentTime: 42 };
    (director as unknown as { layers: Record<string, typeof layer> }).layers = {
      dungeon_hollow_crypt: layer,
    };
    (director as unknown as { bossElement: typeof bossElement }).bossElement = bossElement;

    director.resetForDungeonEntry('nythraxis_boss_arena');

    expect(dungeonMusicZoneForDungeon('nythraxis_boss_arena')).toBe('dungeon_hollow_crypt');
    expect(layer.nextIdx).toBe(-1);
    expect(layer.loopCount).toBe(0);
    expect(layer.anchor).toBe(42);
    expect(bossElement.currentTime).toBe(0);
  });
});

describe('preserved Eastbrook Vale themes', () => {
  // The Eastbrook town, vale, and legacy vale compositions are frozen: their
  // note data must never drift while the rest of the soundtrack evolves.
  // If a change here is truly intended, recompute the checksum deliberately.
  it('keeps the original note data byte-identical', async () => {
    const { createHash } = await import('node:crypto');
    const themes = buildMusicThemes();
    const expected: Record<string, string> = {
      town_eastbrook: '0d3e5a4e6a209e42',
      vale: 'b9e65956ebe4b853',
      vale_legacy: '9caf3642610580dc',
    };
    for (const [name, hash] of Object.entries(expected)) {
      const actual = createHash('sha256')
        .update(JSON.stringify(themes[name]))
        .digest('hex')
        .slice(0, 16);
      expect(actual, `theme '${name}' note data changed`).toBe(hash);
    }
  });
});

describe('per-theme loudness trims', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('has an explicit measured trim for every registered theme', () => {
    for (const name of Object.keys(buildMusicThemes())) {
      expect(THEME_TRIM[name], `missing THEME_TRIM entry for '${name}'`).toBeGreaterThan(0);
      expect(THEME_TRIM[name], `implausible trim for '${name}'`).toBeLessThanOrEqual(4);
    }
  });

  it('drives layer gains through the measured trim, not bare 0/1', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1) });
    const director = new MusicDirector();
    director.init();
    const layers = (
      director as unknown as {
        layers: Record<string, { gain: { gain: { value: number } }; trim: number }>;
      }
    ).layers;
    director.update('vale', false);
    expect(layers.vale.gain.gain.value).toBeCloseTo(THEME_TRIM.vale);
    director.update('vale', true);
    expect(layers.combat.gain.gain.value).toBeCloseTo(THEME_TRIM.combat);
    expect(layers.vale.gain.gain.value).toBe(0);
    clearInterval((director as unknown as { timer: number }).timer);
  });
});

describe('world music zone selection', () => {
  it('plays the dedicated peaks anthem in the Thornpeak Heights overworld', () => {
    expect(musicZoneForLocation('thornpeak_heights', 'peaks', false, false)).toBe('peaks');
  });

  it('keeps the Thornpeak hub on the Highwatch town theme', () => {
    expect(musicZoneForLocation('thornpeak_heights', 'peaks', true, false)).toBe('town_highwatch');
  });

  it('gives every new-world biome its own bespoke theme', () => {
    // Each shipped zone biome resolves to its own registered cue, hub or not
    // (none of the new zones are TOWN_MUSIC hubs, so both paths agree).
    const zoneByBiome: [string, BiomeId][] = [
      ['veiled_hollow', 'dusk'],
      ['drakelands', 'ember'],
      ['frostveil', 'frost'],
      ['amberfall', 'amber'],
      ['willowfen', 'fen'],
      ['nightbloom', 'night'],
      ['wraithwood', 'haunt'],
      ['palmreach', 'jungle'],
      ['evergarden', 'garden'],
      ['galecrest', 'gale'],
    ];
    const themes = buildMusicThemes();
    for (const [zoneId, biome] of zoneByBiome) {
      expect(musicZoneForLocation(zoneId, biome, false, false), zoneId).toBe(biome);
      expect(themes[biome], `no composed theme for biome '${biome}'`).toBeDefined();
    }
  });

  it('gives Farshore Isle its own vigil theme instead of the vale loop', () => {
    expect(musicZoneForLocation('farshore_isle', 'vale', false, false)).toBe('farshore');
    expect(buildMusicThemes().farshore).toBeDefined();
  });

  it('keeps Gullhaven (the Farshore hub, no town theme) on the vigil too', () => {
    expect(musicZoneForLocation('farshore_isle', 'vale', true, false)).toBe('farshore');
  });

  it('borrows the nearest-mood cue for paint-only biomes', () => {
    expect(musicZoneForLocation('custom', 'beach', false, false)).toBe('jungle');
    expect(musicZoneForLocation('custom', 'desert', false, false)).toBe('ember');
    expect(musicZoneForLocation('custom', 'volcano', false, false)).toBe('ember');
    expect(musicZoneForLocation('custom', 'cave', false, false)).toBe('dusk');
  });

  it('still routes dungeons ahead of any biome theme', () => {
    expect(musicZoneForLocation('frostveil', 'frost', false, true, 'hollow_crypt')).toBe(
      'dungeon_hollow_crypt',
    );
  });
});

describe('rift crawl selection', () => {
  it('maps every rift archetype to its own registered crawl theme', () => {
    const themes = buildMusicThemes();
    const seen = new Set<string>();
    for (const theme of RIFT_THEMES) {
      const zone = riftMusicZoneForTheme(theme.name);
      expect(zone.startsWith('rift_'), `theme '${theme.name}' fell back to '${zone}'`).toBe(true);
      expect(themes[zone], `no composed theme for rift zone '${zone}'`).toBeDefined();
      expect(seen.has(zone), `rift zone '${zone}' reused across archetypes`).toBe(false);
      seen.add(zone);
    }
    expect(seen.size).toBe(RIFT_THEMES.length);
  });

  it('pins the archetype names so a rename cannot silently fall back', () => {
    expect(riftMusicZoneForTheme('Frostbound')).toBe('rift_frost');
    expect(riftMusicZoneForTheme('Emberforge')).toBe('rift_ember');
    expect(riftMusicZoneForTheme('Venomweald')).toBe('rift_venom');
    expect(riftMusicZoneForTheme('Boneyard')).toBe('rift_bone');
    expect(riftMusicZoneForTheme('Warcamp')).toBe('rift_brute');
    expect(riftMusicZoneForTheme('Voidscar')).toBe('rift_void');
    expect(riftMusicZoneForTheme('Stormspire')).toBe('rift_storm');
    expect(riftMusicZoneForTheme('Sunken')).toBe('rift_tide');
  });

  it('falls back to the Voidscar crawl for an unknown archetype name', () => {
    expect(riftMusicZoneForTheme('Some Future Theme')).toBe('rift_void');
  });

  it('resets an explicit rift layer on floor entry (no DUNGEON_MUSIC row)', () => {
    const director = new MusicDirector();
    const layer = { target: 1, anchor: 100, nextIdx: 7, loopCount: 3 };
    (director as unknown as { ctx: { currentTime: number } }).ctx = { currentTime: 9 };
    (director as unknown as { layers: Record<string, typeof layer> }).layers = {
      rift_ember: layer,
    };
    director.resetForDungeonEntry('rift:12:3', 'rift_ember');
    expect(layer.nextIdx).toBe(-1);
    expect(layer.loopCount).toBe(0);
    expect(layer.anchor).toBe(9);
  });
});

describe('composed theme integrity', () => {
  const UNPITCHED = new Set(['frameDrum', 'warDrum', 'woodBlock', 'shaker', 'timpani', 'cymSwell']);

  // The three hash-frozen Eastbrook themes predate this guard and let phrase
  // tails cross the loop seam by a beat or two; they are pinned byte-identical
  // by the checksum test above, so the structural guard covers the rest.
  const FROZEN = new Set(['town_eastbrook', 'vale', 'vale_legacy']);

  it('keeps every note of every theme inside its loop and sane ranges', () => {
    for (const [name, theme] of Object.entries(buildMusicThemes())) {
      const loopBeats = theme.bars * 4;
      expect(theme.bpm, name).toBeGreaterThan(0);
      expect(theme.events.length, name).toBeGreaterThan(0);
      for (const e of theme.events) {
        expect(e.beat, `${name}: beat out of loop`).toBeGreaterThanOrEqual(0);
        if (!FROZEN.has(name)) {
          expect(e.beat, `${name}: beat out of loop`).toBeLessThan(loopBeats);
        }
        expect(e.dur, `${name}: non-positive duration`).toBeGreaterThan(0);
        expect(e.vel, `${name}: velocity out of range`).toBeGreaterThan(0);
        expect(e.vel, `${name}: velocity out of range`).toBeLessThanOrEqual(0.7);
        if (!UNPITCHED.has(e.inst)) {
          expect(e.midi, `${name}: midi out of range`).toBeGreaterThanOrEqual(24);
          expect(e.midi, `${name}: midi out of range`).toBeLessThanOrEqual(96);
        }
      }
    }
  });

  it('sorts every theme by beat so the lookahead scheduler never skips notes', () => {
    for (const [name, theme] of Object.entries(buildMusicThemes())) {
      for (let i = 1; i < theme.events.length; i++) {
        expect(
          theme.events[i].beat,
          `${name}: events not sorted at index ${i}`,
        ).toBeGreaterThanOrEqual(theme.events[i - 1].beat);
      }
    }
  });
});
