import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMusicThemes,
  dungeonMusicZoneForDungeon,
  MusicDirector,
  musicZoneForLocation,
  shouldResetMusicForDungeonEntry,
  THEME_TRIM,
} from '../src/game/music';
import { COMBAT_STREAM_URLS, ZONE_STREAM_URLS } from '../src/game/music_tracks';

class FakeParam {
  value = 0;
  setTargetAtTime = vi.fn((value: number, _startTime?: number, _timeConstant?: number) => {
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

class FakeAudio {
  static instances: FakeAudio[] = [];
  loop = false;
  preload = '';
  paused = true;
  currentTime = 0;
  volume = 1;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });

  constructor(public src: string) {
    FakeAudio.instances.push(this);
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
  createMediaElementSource = vi.fn(() => new FakeNode());
  createBufferSource = vi.fn(() => new FakeBufferSource());
  resume = vi.fn(async () => undefined);
}

interface FakeStream {
  el: FakeAudio | null;
  gain: FakeGain;
  target: number;
  silentAt: number;
}

interface DirectorInternals {
  ctx: FakeAudioContext;
  timer: number;
  zoneStreams: Partial<Record<string, FakeStream>>;
  combatStreams: FakeStream[];
  streamKeeper(): void;
}

const internals = (director: MusicDirector): DirectorInternals =>
  director as unknown as DirectorInternals;

function makeDirector(): MusicDirector {
  const director = new MusicDirector();
  director.init();
  return director;
}

describe('MusicDirector streamed combat / background mix', () => {
  let director: MusicDirector;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1) });
    director = makeDirector();
  });

  afterEach(() => {
    clearInterval(internals(director).timer);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeBufferSource.instances = [];
    FakeAudio.instances = [];
  });

  it('streams the zone remaster and no combat stream when out of combat', () => {
    director.update('vale', false);
    const vale = internals(director).zoneStreams.vale;
    expect(vale?.target).toBe(1);
    expect(vale?.el?.src).toBe(ZONE_STREAM_URLS.vale);
    expect(vale?.el?.loop).toBe(true);
    expect(vale?.el?.preload).toBe('auto');
    expect(vale?.el?.play).toHaveBeenCalled();
    for (const combat of internals(director).combatStreams) expect(combat.target).toBe(0);
  });

  it('silences the zone stream so ONLY combat music plays in combat (no layering)', () => {
    director.update('vale', false);
    director.update('vale', true);
    expect(internals(director).zoneStreams.vale?.target).toBe(0);
    const combatTargets = internals(director).combatStreams.map((stream) => stream.target);
    expect(combatTargets.filter((target) => target === 1)).toHaveLength(1);
  });

  it('restores the background stream and drops combat when combat ends', () => {
    director.update('vale', true);
    director.update('vale', false);
    expect(internals(director).zoneStreams.vale?.target).toBe(1);
    for (const combat of internals(director).combatStreams) expect(combat.target).toBe(0);
  });

  it('never runs a zone and a combat stream at non-zero target simultaneously', () => {
    for (const inCombat of [false, true, false, true]) {
      director.update('vale', inCombat);
      const zone = internals(director).zoneStreams.vale?.target ?? 0;
      const combat = Math.max(...internals(director).combatStreams.map((s) => s.target));
      expect(Math.min(zone, combat)).toBe(0);
    }
  });

  it('creates zone streams lazily: only the active zone spins up a download', () => {
    // init warms exactly the two battle themes, nothing else
    expect(FakeAudio.instances.map((el) => el.src)).toEqual(COMBAT_STREAM_URLS);
    director.update('marsh', false);
    expect(FakeAudio.instances.map((el) => el.src)).toEqual([
      ...COMBAT_STREAM_URLS,
      ZONE_STREAM_URLS.marsh,
    ]);
    expect(internals(director).zoneStreams.peaks).toBeUndefined();
  });

  it('crossfades zones: the old theme fades out faster than the new one fades in', () => {
    director.update('vale', false);
    director.update('marsh', false);
    const streams = internals(director).zoneStreams;
    expect(streams.vale?.target).toBe(0);
    expect(streams.marsh?.target).toBe(1);
    const outCall = streams.vale?.gain.gain.setTargetAtTime.mock.calls.at(-1);
    const inCall = streams.marsh?.gain.gain.setTargetAtTime.mock.calls.at(-1);
    expect(outCall?.[2]).toBeLessThan(inCall?.[2] as number);
  });

  it('resumes an overworld zone mid-track on re-entry instead of restarting it', () => {
    director.update('vale', false);
    const el = internals(director).zoneStreams.vale?.el;
    if (!el) throw new Error('vale stream element missing');
    el.currentTime = 55;
    director.update('marsh', false);
    director.update('vale', false);
    expect(el.currentTime).toBe(55);
    expect(el.play).toHaveBeenCalledTimes(2);
  });

  it('plays the vale_cup zone as silence on the zone bus (the Sowfield mp3s own it)', () => {
    director.update('vale', false);
    director.update('vale_cup', false);
    expect(internals(director).zoneStreams.vale?.target).toBe(0);
    expect(internals(director).zoneStreams.vale_cup).toBeUndefined();
    expect(FakeAudio.instances.map((el) => el.src)).not.toContain('/audio/music/vale_cup.mp3');
  });
});

describe('MusicDirector random combat theme pick', () => {
  let director: MusicDirector;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1) });
    director = makeDirector();
  });

  afterEach(() => {
    clearInterval(internals(director).timer);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeAudio.instances = [];
  });

  it('opens each fight on a randomly chosen battle theme, restarted from the top', () => {
    const combat = internals(director).combatStreams;
    expect(combat).toHaveLength(COMBAT_STREAM_URLS.length);

    vi.spyOn(Math, 'random').mockReturnValue(0);
    director.update('vale', true);
    expect(combat[0].target).toBe(1);
    expect(combat[1].target).toBe(0);
    expect(combat[0].el?.play).toHaveBeenCalled();

    director.update('vale', false);
    if (combat[1].el) combat[1].el.currentTime = 12;
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    director.update('vale', true);
    expect(combat[0].target).toBe(0);
    expect(combat[1].target).toBe(1);
    expect(combat[1].el?.currentTime).toBe(0);
  });

  it('keeps the picked theme through a zone border mid-fight', () => {
    const combat = internals(director).combatStreams;
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    director.update('vale', true);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    director.update('marsh', true);
    expect(combat[1].target).toBe(1);
    expect(combat[0].target).toBe(0);
  });
});

describe('MusicDirector stream keeper', () => {
  let director: MusicDirector;

  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1) });
    director = makeDirector();
  });

  afterEach(() => {
    clearInterval(internals(director).timer);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeAudio.instances = [];
  });

  it('pauses a stream once its fade-out has finished, and not before', () => {
    director.update('vale', false);
    const inner = internals(director);
    const el = inner.zoneStreams.vale?.el;
    if (!el) throw new Error('vale stream element missing');
    director.update('vale', true); // vale fades out
    inner.streamKeeper();
    expect(el.pause).not.toHaveBeenCalled();
    inner.ctx.currentTime += 4;
    inner.streamKeeper();
    expect(el.pause).toHaveBeenCalledTimes(1);
  });

  it('revives an active stream that autoplay or a tab restore left paused', () => {
    director.update('vale', false);
    const el = internals(director).zoneStreams.vale?.el;
    if (!el) throw new Error('vale stream element missing');
    el.paused = true;
    el.play.mockClear();
    internals(director).streamKeeper();
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  it('pauses every stream while music is disabled and revives on re-enable', () => {
    director.update('vale', false);
    const inner = internals(director);
    const el = inner.zoneStreams.vale?.el;
    if (!el) throw new Error('vale stream element missing');
    director.setEnabled(false);
    inner.streamKeeper();
    inner.ctx.currentTime += 4;
    inner.streamKeeper();
    expect(el.paused).toBe(true);
    el.play.mockClear();
    director.setEnabled(true); // revives synchronously, no keeper tick needed
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  it('pauses streams while the game menu is open and revives on close', () => {
    director.update('vale', false);
    const inner = internals(director);
    const el = inner.zoneStreams.vale?.el;
    if (!el) throw new Error('vale stream element missing');
    director.pauseForMenu();
    inner.streamKeeper();
    inner.ctx.currentTime += 4;
    inner.streamKeeper();
    expect(el.paused).toBe(true);
    el.play.mockClear();
    director.resumeFromMenu();
    expect(el.play).toHaveBeenCalledTimes(1);
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
    FakeAudio.instances = [];
  });

  it('resets only when entering a dungeon or changing dungeon instances', () => {
    expect(shouldResetMusicForDungeonEntry(null, 'nythraxis_boss_arena')).toBe(true);
    expect(shouldResetMusicForDungeonEntry('nythraxis_boss_arena', 'nythraxis_boss_arena')).toBe(
      false,
    );
    expect(shouldResetMusicForDungeonEntry('nythraxis_boss_arena', 'hollow_crypt')).toBe(true);
    expect(shouldResetMusicForDungeonEntry('nythraxis_boss_arena', null)).toBe(false);
  });

  it('rewinds the active dungeon stream and boss loop on dungeon entry', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', { setInterval: vi.fn(() => 1) });
    const director = makeDirector();
    director.update('dungeon_hollow_crypt', false);
    const el = internals(director).zoneStreams.dungeon_hollow_crypt?.el;
    if (!el) throw new Error('dungeon stream element missing');
    el.currentTime = 19;
    const bossElement = { currentTime: 19 };
    (director as unknown as { bossElement: typeof bossElement }).bossElement = bossElement;

    director.resetForDungeonEntry('nythraxis_boss_arena');

    expect(dungeonMusicZoneForDungeon('nythraxis_boss_arena')).toBe('dungeon_hollow_crypt');
    expect(el.currentTime).toBe(0);
    expect(bossElement.currentTime).toBe(0);
    clearInterval(internals(director).timer);
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

describe('per-theme loudness trims (offline render + editor tooling)', () => {
  it('has an explicit measured trim for every registered theme', () => {
    for (const name of Object.keys(buildMusicThemes())) {
      expect(THEME_TRIM[name], `missing THEME_TRIM entry for '${name}'`).toBeGreaterThan(0);
      expect(THEME_TRIM[name], `implausible trim for '${name}'`).toBeLessThanOrEqual(4);
    }
  });
});

describe('world music zone selection', () => {
  it('plays the dedicated peaks anthem in the Thornpeak Heights overworld', () => {
    expect(musicZoneForLocation('thornpeak_heights', 'peaks', false, false)).toBe('peaks');
  });

  it('keeps the Thornpeak hub on the Highwatch town theme', () => {
    expect(musicZoneForLocation('thornpeak_heights', 'peaks', true, false)).toBe('town_highwatch');
  });
});
