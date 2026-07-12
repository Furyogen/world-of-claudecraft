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
    cupInfo: null;
  };
  activeHotbarForm: string;
  hotbarActions: HotbarAction[];
  loadedSlotMapFromStorage: boolean;
  knownAbilityIdsAtLastSlotSync: Set<string> | null;
  dragAction: null;
  mobileActionPage: number;
  playerHotbarForm(): string;
  formKitAbilityIds(form: string): string[];
  saveSlotMap(): void;
  syncActiveHotbarForm(): void;
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
  vi.stubGlobal('document', { querySelectorAll: () => [] });
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
});
