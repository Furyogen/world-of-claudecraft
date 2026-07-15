import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeCharacterContentRevision } from '../src/sim/character_content_revision';
import type { CharacterState } from '../src/sim/sim';
import { CURRENT_CHARACTER_CONTENT_REVISION, Sim } from '../src/sim/sim';

interface WarriorSaveFixture {
  provenance: {
    version: string;
    tag: string;
    commit: string;
    simSeed: number;
    playerClass: 'warrior';
    characterName: string;
    generator: string;
  };
  stateSha256: string;
  state: CharacterState;
}

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/v0_23_warrior_save.json', import.meta.url), 'utf8'),
) as WarriorSaveFixture;
const PINNED_V023_STATE_SHA256 = '2c9194443f3235f6248adac172e8f174f95c2e10f5af3708deb07fa4f7e79159';

const NEUTRAL_KEYS = [
  'level',
  'xp',
  'lifetimeXp',
  'prestigeRank',
  'unlockedMilestones',
  'restedXp',
  'professions',
  'gatheringProficiency',
  'copper',
  'pos',
  'facing',
  'dead',
  'ghost',
  'corpsePos',
  'resSickness',
  'equipment',
  'inventory',
  'bags',
  'bank',
  'vendorBuyback',
  'questLog',
  'questsDone',
  'arenaRating',
  'arenaWins',
  'arenaLosses',
  'arena1v1Rating',
  'arena1v1Wins',
  'arena1v1Losses',
  'arena2v2Rating',
  'arena2v2Wins',
  'arena2v2Losses',
  'vcupWins',
  'vcupLosses',
  'vcupDraws',
  'vcupGuildWins',
  'vcupGuildLosses',
  'vcupBetWins',
  'vcupBetLosses',
  'vcupBetNet',
  'raidLockouts',
  'pet',
  'skin',
  'skinCatalog',
  'pendingSkinRank',
  'pendingSkinCatalog',
  'pendingSkinItemId',
  'craftSkills',
  'knownRecipes',
  'archetype',
  'delveMarks',
  'delveClears',
  'companionUpgrades',
  'delveLoreUnlocked',
  'delveDaily',
  'heroicDaily',
  'mailWelcomed',
  'townFocus',
] as const;

function loadFixture() {
  const source = structuredClone(fixture.state);
  const sim = new Sim({ seed: 240024, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', fixture.provenance.characterName, { state: source });
  const saved = sim.serializeCharacter(pid);
  if (!saved) throw new Error('fixture character did not serialize');
  return { pid, saved, sim, source };
}

describe('v0.23 stable Warrior save compatibility', () => {
  it('pins a fixture emitted by the official v0.23.0 serializer', () => {
    expect(fixture.provenance).toEqual({
      version: '0.23.0',
      tag: 'v0.23.0',
      commit: '8a3deb7886f189caa2217d4c5087552069c3c5b8',
      simSeed: 230024,
      playerClass: 'warrior',
      characterName: 'Vanguard',
      generator: 'real Sim.serializeCharacter at the pinned commit',
    });
    expect(createHash('sha256').update(JSON.stringify(fixture.state)).digest('hex')).toBe(
      PINNED_V023_STATE_SHA256,
    );
    expect(fixture.stateSha256).toBe(PINNED_V023_STATE_SHA256);
  });

  it('preserves every representative class-neutral field without mutating the old blob', () => {
    const { saved, sim, source } = loadFixture();
    const sourceRecord = source as unknown as Record<string, unknown>;
    const savedRecord = saved as unknown as Record<string, unknown>;

    expect(source).toEqual(fixture.state);
    for (const key of NEUTRAL_KEYS) expect(savedRecord[key]).toEqual(sourceRecord[key]);

    expect(saved.hp).toBe(Math.min(fixture.state.hp, sim.player.maxHp));
    expect(saved.resource).toBe(0);
  });

  it('canonicalizes obsolete talent, row, cooldown, and loadout data exactly once', () => {
    const { saved } = loadFixture();
    const migrated = saved as CharacterState & { contentRevision?: number };

    expect(migrated.contentRevision).toBe(CURRENT_CHARACTER_CONTENT_REVISION);
    expect(saved.talents).toEqual({ spec: 'arms', rows: {} });
    expect(saved.rowPicks).toEqual([null, null, null, null, null, null]);
    expect(saved.cooldowns).toEqual({ abilities: { bloodrage: 23.5 }, potion: 41 });

    expect(saved.loadouts).toHaveLength(2);
    expect(saved.loadouts?.[0].alloc).toEqual({ spec: 'arms', rows: {} });
    expect(saved.loadouts?.[0].bar[1]).toBe('battle_shout');
    expect(saved.loadouts?.[0].bar[4]).toBe('charge');
    expect(saved.loadouts?.[0].bar[5]).toBe('mortal_strike');
    expect(saved.loadouts?.[0].bar[6]).toBe('hamstring');
    expect(saved.loadouts?.[0].bar).not.toContain('heroic_strike');
    expect(saved.loadouts?.[0].bar).not.toContain('commanding_shout');
    expect(saved.loadouts?.[0].bar).toContain('pummel');
    expect(saved.activeLoadout).toBe(0);

    const sim2 = new Sim({ seed: 240024, playerClass: 'warrior', noPlayer: true });
    const pid2 = sim2.addPlayer('warrior', fixture.provenance.characterName, { state: saved });
    expect(sim2.serializeCharacter(pid2)).toEqual(saved);
  });

  it('caps legacy loadouts and repairs an out-of-range active index without mutating input', () => {
    const source = structuredClone(fixture.state);
    const seed = source.loadouts?.[0];
    if (!seed) throw new Error('fixture must contain a saved loadout');
    source.loadouts = Array.from({ length: 12 }, (_, index) => ({
      name: `Legacy ${index}`,
      alloc: structuredClone(seed.alloc),
      bar: [...seed.bar, 'obsolete_v023_spell'],
    }));
    source.activeLoadout = 99;
    const original = structuredClone(source);

    const migrated = normalizeCharacterContentRevision('warrior', source);

    expect(migrated.loadouts).toHaveLength(10);
    expect(migrated.loadouts?.every((loadout) => loadout.bar.length === 22)).toBe(true);
    expect(
      migrated.loadouts?.every((loadout) => !loadout.bar.includes('obsolete_v023_spell')),
    ).toBe(true);
    expect(migrated.activeLoadout).toBe(-1);
    expect(source).toEqual(original);
  });

  it('stamps only the revision on a pre-revision non-warrior save (no kit surgery)', () => {
    // The v0.24 normalization is warrior-scoped: any other class's pre-revision
    // save must come through byte-identical apart from the revision stamp, or
    // a mage could silently inherit warrior loadout surgery.
    const source = structuredClone(fixture.state);
    delete source.contentRevision;
    const original = structuredClone(source);

    const migrated = normalizeCharacterContentRevision('mage', source);

    expect(migrated.contentRevision).toBe(CURRENT_CHARACTER_CONTENT_REVISION);
    const { contentRevision: _stamp, ...rest } = migrated;
    expect(rest).toEqual(original);
    expect(source).toEqual(original);
  });

  it('loads the stable class as the redesigned Warrior with its current ability kit', () => {
    const { pid, sim } = loadFixture();
    const known = sim.meta(pid)?.known.map((ability) => ability.def.id) ?? [];

    expect(sim.meta(pid)?.cls).toBe('warrior');
    expect(known).toContain('pummel');
    expect(known).toContain('mortal_strike');
    expect(known).toContain('battle_stance');
    expect(known).not.toContain('commanding_shout');
    expect(known).not.toContain('rend');
  });
});
