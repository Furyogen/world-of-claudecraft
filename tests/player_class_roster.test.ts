import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAYER_CLASSES } from '../server/avatar';
import { CLASS_META } from '../src/guide/class_meta';
import { GUIDE_CLASSES } from '../src/guide/content.generated';
import { CLASS_CHIPS } from '../src/guide/data';
import { SKINS, VISUALS } from '../src/render/characters/manifest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { CLASSES } from '../src/sim/content/classes';
import { SKIN_COUNTS } from '../src/sim/content/skins';
import { TALENTS } from '../src/sim/content/talents';
import { ALL_CLASSES, type PlayerClass } from '../src/sim/types';
import { CLASS_DETAILS, SIGNATURE_ABILITIES } from '../src/ui/class_details_data';
import { classDisplayName, tEntity } from '../src/ui/entity_i18n';
import { EXPECTED_PLAYER_CLASS_IDS, EXPECTED_PLAYER_CLASSES } from './helpers/player_classes';

const sorted = (values: readonly string[]): string[] => [...values].sort();
const expectedSorted = sorted(EXPECTED_PLAYER_CLASS_IDS);
const keys = (value: object): string[] => sorted(Object.keys(value));
const playerVisualKeys = (value: object): string[] =>
  Object.keys(value)
    .filter((key) => key.startsWith('player_') && key !== 'player_mech')
    .map((key) => key.slice('player_'.length))
    .sort();

describe('v0.24 playable class roster', () => {
  it('publishes exactly the nine winning classes in canonical display order', () => {
    expect(ALL_CLASSES).toEqual(EXPECTED_PLAYER_CLASSES);
  });

  it('keeps every simulation class registry on the exact playable set', () => {
    expect(keys(CLASSES), 'class definitions').toEqual(expectedSorted);
    expect(keys(TALENTS), 'talent trees').toEqual(expectedSorted);
    expect(keys(CHOICE_ROWS), 'choice rows').toEqual(expectedSorted);
    expect(keys(SKIN_COUNTS), 'skin counts').toEqual(expectedSorted);
  });

  it('keeps character selection and server avatars on the exact playable set', () => {
    expect(keys(CLASS_DETAILS), 'character-select details').toEqual(expectedSorted);
    expect(keys(SIGNATURE_ABILITIES), 'character-select signatures').toEqual(expectedSorted);
    expect(PLAYER_CLASSES).toEqual(EXPECTED_PLAYER_CLASSES);
  });

  it('keeps renderer player aliases on the exact playable set', () => {
    expect(playerVisualKeys(VISUALS), 'player visuals').toEqual(expectedSorted);
    expect(playerVisualKeys(SKINS), 'player skins').toEqual(expectedSorted);
  });

  it('keeps every Guide roster surface on the exact playable set', () => {
    expect(
      GUIDE_CLASSES.map((entry) => entry.id),
      'generated class pages',
    ).toEqual(EXPECTED_PLAYER_CLASSES);
    expect(
      CLASS_CHIPS.map((entry) => entry.id),
      'Guide class chips',
    ).toEqual(EXPECTED_PLAYER_CLASSES);
    expect(keys(CLASS_META), 'Guide chooser metadata').toEqual(expectedSorted);
  });
});

describe('stale class rows stay renderable', () => {
  // A PTR/PBE database can still hold character rows whose class was removed
  // from the roster (warrior_classic). The list endpoint passes the raw class
  // string through, so the charselect renderer must degrade to the raw id
  // instead of throwing and wiping the whole character list.
  const staleClass = 'warrior_classic' as PlayerClass;

  it('classDisplayName falls back to the raw id for a removed class', () => {
    expect(classDisplayName(staleClass)).toBe('warrior_classic');
  });

  it('class description falls back to the raw id for a removed class', () => {
    expect(tEntity({ kind: 'class', id: staleClass, field: 'description' })).toBe(
      'warrior_classic',
    );
  });
});

describe('character-create host parity', () => {
  const routeDefSource = readFileSync(new URL('../server/characters.ts', import.meta.url), 'utf8');
  const legacySource = readFileSync(new URL('../server/main.ts', import.meta.url), 'utf8');

  it('uses the shared player-class predicate in the RouteDef create path', () => {
    expect(routeDefSource).toMatch(/isPlayerClass\s*\(\s*body\.class\s*\)/);
  });

  it('uses the shared player-class predicate in the legacy create path', () => {
    expect(legacySource).toMatch(/isPlayerClass\s*\(\s*body\.class\s*\)/);
  });

  it('keeps the legacy per-account character cap at ten', () => {
    const createArm = legacySource.slice(
      legacySource.indexOf("if (url === '/api/characters')"),
      legacySource.indexOf('// Public, unauthenticated character sheet'),
    );
    expect(createArm).toMatch(/createCharacterCapped\([\s\S]*?\b10\b/);
  });
});
