import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { catSlotVisualKey } from '../src/render/characters/form_visual_selection_core';
import { VISUALS } from '../src/render/characters/manifest';
import { ABILITIES } from '../src/sim/content/classes';

const publicPath = (url: string): string =>
  fileURLToPath(new URL(`../public/${url.replace(/^\//, '')}`, import.meta.url));

// The druid feral form used to BE the shaman's wolf: one VisualDef served both.
// Splitting them is the whole point of the kiwi, so these guards pin the split
// rather than just the existence of a new def.
describe('Druid Kiwi Form body', () => {
  it('gives the feral form its own kiwi rig, not the wolf', () => {
    expect(VISUALS.form_kiwi?.url).toBe('models/creatures/kiwi_form.glb');
    expect(VISUALS.form_kiwi?.url).not.toBe(VISUALS.form_cat?.url);
    // No tint: the kiwi ships its own plumage. The wolf's tawny lerp existed only
    // to separate the druid from grey pack wolves, and would muddy this texture.
    expect(VISUALS.form_kiwi?.tint).toBeUndefined();
  });

  it('keeps the wolf rig for the shaman Shadewolf', () => {
    expect(VISUALS.form_cat?.url).toBe('models/creatures/wolf_basic.glb');
    expect(VISUALS.form_cat?.tint).toBe(0xd08b45);
  });

  it('yaws the Tripo biped from +X onto the game facing-0 convention', () => {
    // Off by a quarter turn and the form runs sideways; 0 or undefined is the bug.
    expect(VISUALS.form_kiwi?.yaw).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('ships the GLB and registers it in the media manifest', () => {
    expect(existsSync(publicPath('models/creatures/kiwi_form.glb'))).toBe(true);
    expect(MEDIA_ASSETS['models/creatures/kiwi_form.glb']).toMatch(
      /^\/media\/models\/creatures\/kiwi_form[.][0-9a-f]+[.]glb$/,
    );
  });

  it('preloads at boot like the other shapeshift bodies', () => {
    // A lazyPreload form pops in a frame late on the first shift of a session.
    expect(VISUALS.form_kiwi?.lazyPreload).toBeUndefined();
  });
});

describe('cat slot body selection', () => {
  it('gives the druid feral form the kiwi and the Shadewolf the wolf', () => {
    expect(catSlotVisualKey(false)).toBe('form_kiwi');
    expect(catSlotVisualKey(true)).toBe('form_cat');
  });
});

describe('Kiwi Form ability copy', () => {
  const FERAL_IDS = ['cat_form', 'prowl', 'rake', 'claw', 'ferocious_bite', 'rip', 'tigers_fury'];

  it('names the form toggle after the body it grants', () => {
    expect(ABILITIES.cat_form.name).toBe('Kiwi Form');
    expect(ABILITIES.cat_form.description).toContain('Shapeshift into a kiwi');
  });

  it('leaves no druid ability still telling the player it is a wolf', () => {
    const stale: string[] = [];
    for (const ability of Object.values(ABILITIES)) {
      if (ability.class !== 'druid') continue;
      const text = `${ability.name} ${ability.description ?? ''}`;
      if (/wolf/i.test(text)) stale.push(ability.id);
    }
    expect(stale, `druid abilities still naming a wolf: ${stale.join(', ')}`).toEqual([]);
  });

  it('keeps the form gate on every ability that names Kiwi Form', () => {
    // The copy and the mechanic have to agree: a description that says "Kiwi Form
    // only" while requiresForm is unset would lie to the player.
    for (const id of FERAL_IDS) {
      const ability = ABILITIES[id];
      expect(ability, `missing feral ability ${id}`).toBeTruthy();
      if (id === 'cat_form') continue;
      expect(ability.requiresForm, `${id} form gate`).toBe('cat');
      expect(ability.description, `${id} copy`).toContain('Kiwi Form');
    }
  });

  it('does not rename the shaman Shadewolf along with it', () => {
    expect(ABILITIES.ghost_wolf.name).toBe('Shadewolf');
    expect(ABILITIES.ghost_wolf.class).toBe('shaman');
  });
});
