import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { Sim } from '../src/sim/sim';

// The local try-on preview (IWorld.previewCosmetic / clearCosmeticPreview),
// implemented in BOTH worlds. It writes only the render-only appearance fields on
// the local player entity, grants NO ownership, does NOT persist, and reverts on
// clear. These tests exercise the real world methods, not a mock of them.

function makeSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

// A minimal ClientWorld with only the fields previewCosmetic / applySnapshot touch.
function bareClient(pid: number): ClientWorld {
  const c: unknown = Object.create(ClientWorld.prototype);
  Object.assign(c as object, {
    cfg: { seed: 1, playerClass: 'warrior' },
    entities: new Map(),
    playerId: pid,
    ownPlayerId: pid,
    ownPlayerClass: 'warrior',
    spectating: null,
    accountCosmetics: { completedQuestIds: [], mechChromaIds: [] },
    missingSince: new Map(),
    lastSnapAt: 0,
    snapInterval: 50,
  });
  return c as ClientWorld;
}

describe('Sim try-on preview', () => {
  it('applies the preview to the render-only entity fields without granting or persisting', () => {
    const sim = makeSim();
    const p = sim.player;
    const orig = { skin: p.skin, skinCatalog: p.skinCatalog, mainhandItemId: p.mainhandItemId };
    const savedSkinBefore = sim.serializeCharacter(sim.playerId)?.skin;

    sim.previewCosmetic({ skin: 4, catalog: 'mech', mainhandItemId: 'wep_preview' });

    // The rendered appearance changed...
    expect(p.skin).toBe(4);
    expect(p.skinCatalog).toBe('mech');
    expect(p.mainhandItemId).toBe('wep_preview');
    // ...but ownership was NOT granted (no chroma unlocked, cosmetics untouched)...
    expect(sim.accountCosmetics.mechChromaIds).toHaveLength(0);
    // ...and it does NOT persist (serializeCharacter reads meta, never the preview).
    expect(sim.serializeCharacter(sim.playerId)?.skin).toBe(savedSkinBefore);

    sim.clearCosmeticPreview();
    expect(p.skin).toBe(orig.skin);
    expect(p.skinCatalog).toBe(orig.skinCatalog);
    expect(p.mainhandItemId).toBe(orig.mainhandItemId);
  });

  it('reverts to the ORIGINAL appearance even after previewing several SKUs', () => {
    const sim = makeSim();
    const p = sim.player;
    const orig = { skin: p.skin, skinCatalog: p.skinCatalog, mainhandItemId: p.mainhandItemId };

    sim.previewCosmetic({ skin: 2, catalog: 'mech', mainhandItemId: 'wep_a' });
    sim.previewCosmetic({ skin: 5, catalog: 'mech', mainhandItemId: 'wep_b' });
    expect(p.skin).toBe(5);

    sim.clearCosmeticPreview();
    expect(p.skin).toBe(orig.skin);
    expect(p.skinCatalog).toBe(orig.skinCatalog);
    expect(p.mainhandItemId).toBe(orig.mainhandItemId);
  });

  it('clearing with no active preview is a no-op', () => {
    const sim = makeSim();
    const p = sim.player;
    const orig = { skin: p.skin, skinCatalog: p.skinCatalog, mainhandItemId: p.mainhandItemId };
    sim.clearCosmeticPreview();
    expect(p.skin).toBe(orig.skin);
    expect(p.skinCatalog).toBe(orig.skinCatalog);
    expect(p.mainhandItemId).toBe(orig.mainhandItemId);
  });
});

describe('ClientWorld try-on preview', () => {
  // Build the self player entity through the REAL applySnapshot self path.
  function selfSnap(sk: number, cat: 'class' | 'mech', mh: string | null) {
    return {
      t: 'snap',
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'warrior',
        nm: 'Hero',
        lv: 20,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 100,
        mhp: 100,
        sk,
        cat,
        mh,
      },
    };
  }

  it('previews locally, stays sticky across a server snapshot, and reverts to the latest truth', () => {
    const client = bareClient(1);
    const api = client as unknown as { applySnapshot(s: unknown): void };
    api.applySnapshot(selfSnap(1, 'class', 'wep_owned'));
    const p = client.entities.get(1)!;
    expect(p.skin).toBe(1);

    client.previewCosmetic({ skin: 6, catalog: 'mech', mainhandItemId: 'wep_try' });
    expect(p.skin).toBe(6);
    expect(p.skinCatalog).toBe('mech');
    expect(p.mainhandItemId).toBe('wep_try');

    // A fresh authoritative self record arrives (the server does not know about the
    // preview): the try-on must stay applied, and the backup tracks the new truth.
    api.applySnapshot(selfSnap(2, 'class', 'wep_owned_v2'));
    expect(p.skin).toBe(6);
    expect(p.skinCatalog).toBe('mech');
    expect(p.mainhandItemId).toBe('wep_try');

    // Reverting restores the LATEST server truth, not the stale first snapshot.
    client.clearCosmeticPreview();
    expect(p.skin).toBe(2);
    expect(p.skinCatalog).toBe('class');
    expect(p.mainhandItemId).toBe('wep_owned_v2');
  });

  it('a normal snapshot does not touch appearance when no preview is active', () => {
    const client = bareClient(1);
    const api = client as unknown as { applySnapshot(s: unknown): void };
    api.applySnapshot(selfSnap(3, 'mech', 'wep_x'));
    const p = client.entities.get(1)!;
    expect(p.skin).toBe(3);
    expect(p.skinCatalog).toBe('mech');
    expect(p.mainhandItemId).toBe('wep_x');
    // No preview set: clearing is inert.
    client.clearCosmeticPreview();
    expect(p.skin).toBe(3);
  });
});
