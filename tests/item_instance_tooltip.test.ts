// Pins the per-copy instance tooltip lines (Professions 2.0 Phase 6): every
// ItemInstancePayload variant renders its exact line set, so a regression in
// any arm (seal, enchanted marker, bonus stats, maker's mark, the legacy
// shapes) fails a decisive assertion. The module is the pure string-builder
// side of hud.itemTooltip's instance composition.
import { describe, expect, it } from 'vitest';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import {
  instanceBadgeLines,
  instanceBonusStatLines,
  instanceMakersMarkLine,
  isGatheredProvenanceKind,
  itemNumber,
  itemStatName,
} from '../src/ui/item_instance_tooltip';

describe('item_instance_tooltip', () => {
  it('masterwork copy gets the gold seal and no enchanted marker', () => {
    const html = instanceBadgeLines({
      signer: 'Anna',
      rolled: { masterwork: true, stats: { str: 2 } },
    });
    expect(html).toContain('Masterwork');
    expect(html).toContain('#ffd100');
    expect(html).not.toContain('Enchanted');
  });

  it('enchant-marker copy gets the enchanted marker and no seal', () => {
    const html = instanceBadgeLines({ enchant: 'ench_firepower' });
    expect(html).toContain('Enchanted');
    expect(html).not.toContain('Masterwork');
  });

  it('legacy enchanted copy (bare rolled.stats, no masterwork flag) reads as enchanted', () => {
    const html = instanceBadgeLines({ rolled: { stats: { int: 3 } } });
    expect(html).toContain('Enchanted');
    expect(html).not.toContain('Masterwork');
  });

  it('masterwork plus enchant renders both badges, seal first', () => {
    const html = instanceBadgeLines({
      enchant: 'ench_firepower',
      rolled: { masterwork: true, stats: { str: 1 } },
    });
    const seal = html.indexOf('Masterwork');
    const ench = html.indexOf('Enchanted');
    expect(seal).toBeGreaterThanOrEqual(0);
    expect(ench).toBeGreaterThan(seal);
  });

  it('legacy signed copy (signer only) renders the mark alone, no badges, no throw', () => {
    expect(instanceBadgeLines({ signer: 'Bob' })).toBe('');
    expect(instanceBonusStatLines({ signer: 'Bob' })).toBe('');
    expect(instanceMakersMarkLine({ signer: 'Bob' })).toContain('Crafted by Bob');
  });

  it('baked bonus stats each render one tt-instance-bonus line', () => {
    const html = instanceBonusStatLines({
      rolled: { masterwork: true, stats: { str: 2, sta: 1 } },
    });
    expect((html.match(/tt-instance-bonus/g) ?? []).length).toBe(2);
    expect(html).toContain(itemStatName('str'));
    expect(html).toContain(itemStatName('sta'));
  });

  it('zero-valued baked stats are skipped', () => {
    expect(instanceBonusStatLines({ rolled: { stats: { str: 0 } } })).toBe('');
  });

  it("maker's mark escapes the signer name", () => {
    const html = instanceMakersMarkLine({ signer: '<b>x</b>' });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('undefined instance renders nothing in any line set', () => {
    expect(instanceBadgeLines(undefined)).toBe('');
    expect(instanceBonusStatLines(undefined)).toBe('');
    expect(instanceMakersMarkLine(undefined)).toBe('');
  });

  it('a gathered-kind signed copy reads Gathered by, a crafted-kind keeps Crafted by (Phase 12d)', () => {
    // Both arms of the kind split, against real defs from each family.
    expect(ITEMS.copper_ore.kind).toBe('junk');
    const gathered = instanceMakersMarkLine({ signer: 'Anna' }, ITEMS.copper_ore.kind);
    expect(gathered).toContain('Gathered by Anna');
    expect(gathered).not.toContain('Crafted by');
    expect(ITEMS.ironedge_longsword.kind).toBe('weapon');
    const crafted = instanceMakersMarkLine({ signer: 'Anna' }, ITEMS.ironedge_longsword.kind);
    expect(crafted).toContain('Crafted by Anna');
    expect(crafted).not.toContain('Gathered by');
    // No kind at all (a caller without the def) stays the crafted wording.
    expect(instanceMakersMarkLine({ signer: 'Anna' })).toContain('Crafted by Anna');
  });

  it('itemNumber pins fraction digits and itemStatName capitalizes unknown keys', () => {
    expect(itemNumber(3)).toBe('3');
    expect(itemNumber(2.5, 1)).toBe('2.5');
    expect(itemStatName('weird')).toBe('Weird');
  });
});

// The Phase 12d provenance partition: the signed universe splits cleanly on
// item KIND. Every signable gathered item (corpse components, Pristine
// specimens, the zone node materials) is kind 'junk'; every crafted recipe
// output lands on a non-junk kind. If either side ever drifts (a junk-kind
// recipe output, a gathered material moved off 'junk'), the wording of its
// signed copies silently flips, so both sides are pinned against the live
// content tables. Fish are out of scope by construction: they share kind
// 'food' with crafted meals but fishing never signs a catch.
describe('isGatheredProvenanceKind partition over the live content (Phase 12d)', () => {
  it('every signable gathered item id resolves to a gathered-kind def', () => {
    const gatheredIds = [
      ...Object.values(HARVEST_COMPONENT_ITEMS),
      ...Object.values(HARVEST_COMPONENT_SPECIMENS),
      ...Object.values(NODE_MATERIAL_TABLE).flatMap((byZone) =>
        Object.values(byZone).map((row) => row.itemId),
      ),
    ];
    expect(gatheredIds.length).toBeGreaterThan(0);
    for (const id of gatheredIds) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.kind, `${id} kind`).toBe('junk');
      expect(isGatheredProvenanceKind(def.kind), id).toBe(true);
    }
  });

  it('every crafted recipe output resolves to a crafted-kind def', () => {
    expect(ALL_RECIPES.length).toBeGreaterThan(0);
    for (const recipe of ALL_RECIPES) {
      const def = ITEMS[recipe.resultItemId];
      expect(def, recipe.resultItemId).toBeDefined();
      expect(isGatheredProvenanceKind(def.kind), `${recipe.resultItemId} (${def.kind})`).toBe(
        false,
      );
    }
  });
});

// Composition ORDER inside hud.itemTooltip (the builders are pinned above,
// the composed placement is hud.ts glue): badges under the soulbound line,
// baked bonus stats after the def's own stat lines, the maker's mark near the
// bottom (after the set block, before the sell price).
import { readFileSync } from 'node:fs';

describe('hud.itemTooltip composition order (source pins)', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const badges = hud.indexOf('instanceBadgeLines(instance)');
  const bonus = hud.indexOf('instanceBonusStatLines(instance)');
  // The mark line takes the def's kind too (Phase 12d): the gathered-vs-crafted
  // wording split resolves from item.kind at the one composition site.
  const mark = hud.indexOf('instanceMakersMarkLine(instance, item.kind)');
  const soulbound = hud.indexOf("t('hudChrome.itemSoulbound')");
  const setBlock = hud.indexOf('this.itemSetBlock(item)');

  it('composes all three instance line sets exactly once each', () => {
    expect(badges).toBeGreaterThan(-1);
    expect(bonus).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(-1);
    expect(hud.indexOf('instanceBadgeLines(instance)', badges + 1)).toBe(-1);
    expect(hud.indexOf('instanceBonusStatLines(instance)', bonus + 1)).toBe(-1);
    expect(hud.indexOf('instanceMakersMarkLine(', mark + 1)).toBe(-1);
  });

  it('orders them badge lines, then bonus stats, then the makers mark', () => {
    expect(soulbound).toBeGreaterThan(-1);
    expect(badges).toBeGreaterThan(soulbound);
    expect(bonus).toBeGreaterThan(badges);
    expect(mark).toBeGreaterThan(bonus);
    expect(mark).toBeGreaterThan(setBlock);
  });
});
