import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HotbarAction } from '../src/ui/hotbar';
import { Hud } from '../src/ui/hud';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

const BAR_SLOTS = 22;

type HotbarHarness = {
  sim: {
    cfg: { playerClass: string };
    player: { name: string; auras: { kind: string }[] };
    known: { def: { id: string } }[];
    cupInfo: { match: { team: number | null } } | null;
  };
  activeHotbarForm: string;
  hotbarActions: HotbarAction[];
  loadedSlotMapFromStorage: boolean;
  knownAbilityIdsAtLastSlotSync: Set<string> | null;
  dragAction: null;
  mobileActionPage: number;
  mobileHotbarDrag: {
    pointerId: number;
    sourceIndex: number;
    startX: number;
    startY: number;
    active: boolean;
    timer: number;
    targetIndex: number | null;
  } | null;
  playerHotbarForm(): string;
  formKitAbilityIds(form: string): string[];
  saveSlotMap(): void;
  syncActiveHotbarForm(): void;
  syncSlotMap(): void;
};

function bar(...abilityIds: string[]): HotbarAction[] {
  return Array.from({ length: BAR_SLOTS }, (_, index) => {
    const id = abilityIds[index];
    return id ? { type: 'ability' as const, id } : null;
  });
}

function makeHarness(
  playerClass: string,
  knownAbilityIds: string[],
  initialBar: HotbarAction[],
): HotbarHarness {
  const hud = Object.create(Hud.prototype) as HotbarHarness;
  hud.sim = {
    cfg: { playerClass },
    player: { name: 'ActionbarTester', auras: [] },
    known: knownAbilityIds.map((id) => ({ def: { id } })),
    cupInfo: null,
  };
  hud.activeHotbarForm = 'normal';
  hud.hotbarActions = initialBar;
  hud.loadedSlotMapFromStorage = false;
  hud.knownAbilityIdsAtLastSlotSync = null;
  hud.dragAction = null;
  hud.mobileActionPage = 0;
  hud.mobileHotbarDrag = null;
  return hud;
}

function storageStub(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', storageStub());
  vi.stubGlobal('document', {
    body: { classList: { remove: vi.fn() } },
    querySelectorAll: () => [],
  });
  vi.stubGlobal('window', { clearTimeout: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stealth action-bar persistence', () => {
  it('keeps the Rogue normal and stealth pages independently editable', () => {
    const normal = bar('sinister_strike', 'stealth');
    const stealth = bar('ambush', 'garrote', 'stealth');
    const hud = makeHarness('rogue', ['sinister_strike', 'stealth', 'ambush', 'garrote'], normal);

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('stealth');
    expect(hud.hotbarActions).toEqual(normal);

    hud.hotbarActions = stealth;
    hud.saveSlotMap();
    hud.sim.player.auras = [];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('normal');
    expect(hud.hotbarActions).toEqual(normal);

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    expect(hud.hotbarActions).toEqual(stealth);
  });

  it('preserves an intentionally empty Rogue stealth page', () => {
    const normal = bar('sinister_strike', 'stealth');
    const hud = makeHarness('rogue', ['sinister_strike', 'stealth', 'ambush'], normal);

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    hud.hotbarActions = bar();
    hud.saveSlotMap();

    hud.sim.player.auras = [];
    hud.syncActiveHotbarForm();
    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();

    expect(hud.hotbarActions).toEqual(bar());
    hud.syncSlotMap();
    expect(hud.hotbarActions).toEqual(bar());
  });

  it('keeps the Druid caster, Wolf, and stealthed Wolf pages independently editable', () => {
    const caster = bar('wrath', 'moonfire', 'cat_form');
    const wolf = bar('claw', 'rip', 'prowl', 'cat_form');
    const stealthedWolf = bar('pounce', 'rake', 'prowl', 'cat_form');
    const hud = makeHarness(
      'druid',
      ['wrath', 'moonfire', 'cat_form', 'claw', 'rip', 'prowl', 'rake', 'pounce'],
      caster,
    );

    hud.sim.player.auras = [{ kind: 'form_cat' }];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('cat');
    hud.hotbarActions = wolf;
    hud.saveSlotMap();

    hud.sim.player.auras = [{ kind: 'form_cat' }, { kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('cat_stealth');
    expect(hud.hotbarActions).toEqual(wolf);
    hud.hotbarActions = stealthedWolf;
    hud.saveSlotMap();

    hud.sim.player.auras = [{ kind: 'form_cat' }];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('cat');
    expect(hud.hotbarActions).toEqual(wolf);

    hud.sim.player.auras = [];
    hud.syncActiveHotbarForm();
    expect(hud.activeHotbarForm).toBe('normal');
    expect(hud.hotbarActions).toEqual(caster);

    hud.sim.player.auras = [{ kind: 'form_cat' }];
    hud.syncActiveHotbarForm();
    expect(hud.hotbarActions).toEqual(wolf);
    hud.sim.player.auras = [{ kind: 'form_cat' }, { kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    expect(hud.hotbarActions).toEqual(stealthedWolf);
  });

  it('preserves an intentionally empty stealthed Wolf page except for its form toggle', () => {
    const caster = bar('wrath', 'cat_form');
    const wolf = bar('claw', 'prowl', 'cat_form');
    const hud = makeHarness('druid', ['wrath', 'cat_form', 'claw', 'prowl', 'pounce'], caster);

    hud.sim.player.auras = [{ kind: 'form_cat' }];
    hud.syncActiveHotbarForm();
    hud.hotbarActions = wolf;
    hud.saveSlotMap();
    hud.sim.player.auras = [{ kind: 'form_cat' }, { kind: 'stealth' }];
    hud.syncActiveHotbarForm();
    hud.hotbarActions = bar();
    hud.saveSlotMap();

    hud.sim.player.auras = [{ kind: 'form_cat' }];
    hud.syncActiveHotbarForm();
    hud.sim.player.auras = [{ kind: 'stealth' }, { kind: 'form_cat' }];
    hud.syncActiveHotbarForm();

    expect(hud.hotbarActions).toEqual(bar());
    hud.syncSlotMap();
    expect(hud.hotbarActions).toEqual(bar('cat_form'));
  });

  it('uses the Wolf kit when seeding its stealth page', () => {
    const hud = makeHarness(
      'druid',
      ['wrath', 'cat_form', 'claw', 'prowl', 'rake', 'pounce'],
      bar('wrath'),
    );

    const kit = hud.formKitAbilityIds('cat_stealth');

    expect(kit).toEqual(['cat_form', 'claw', 'prowl', 'rake', 'pounce']);
    expect(kit).not.toContain('wrath');
  });

  it('auto-places newly learned Wolf abilities, but not caster spells, on the stealth page', () => {
    const hud = makeHarness('druid', ['wrath', 'cat_form', 'prowl'], bar('prowl'));
    hud.activeHotbarForm = 'cat_stealth';
    hud.loadedSlotMapFromStorage = true;
    hud.knownAbilityIdsAtLastSlotSync = new Set(['wrath', 'cat_form', 'prowl']);
    hud.sim.known = ['wrath', 'cat_form', 'prowl', 'moonfire', 'pounce'].map((id) => ({
      def: { id },
    }));

    hud.syncSlotMap();

    expect(hud.hotbarActions).toEqual(bar('prowl', 'cat_form', 'pounce'));
    expect(hud.hotbarActions.some((action) => action?.id === 'wrath')).toBe(false);
    expect(hud.hotbarActions.some((action) => action?.id === 'moonfire')).toBe(false);
  });

  it('keeps the Vale Cup sport page ahead of every class stealth page', () => {
    const rogue = makeHarness('rogue', ['stealth'], bar('stealth'));
    rogue.sim.cupInfo = { match: { team: 0 } };
    rogue.sim.player.auras = [{ kind: 'stealth' }];

    const druid = makeHarness('druid', ['cat_form', 'prowl'], bar('cat_form'));
    druid.sim.cupInfo = { match: { team: 1 } };
    druid.sim.player.auras = [{ kind: 'stealth' }, { kind: 'form_cat' }];

    expect(rogue.playerHotbarForm()).toBe('sport');
    expect(druid.playerHotbarForm()).toBe('sport');
  });

  it('cancels a mobile drag before loading a different stealth page', () => {
    const hud = makeHarness('rogue', ['sinister_strike', 'stealth'], bar('stealth'));
    hud.mobileHotbarDrag = {
      pointerId: 7,
      sourceIndex: 2,
      startX: 10,
      startY: 20,
      active: true,
      timer: 99,
      targetIndex: 4,
    };

    hud.sim.player.auras = [{ kind: 'stealth' }];
    hud.syncActiveHotbarForm();

    expect(hud.mobileHotbarDrag).toBeNull();
    expect(window.clearTimeout).toHaveBeenCalledWith(99);
  });
});
