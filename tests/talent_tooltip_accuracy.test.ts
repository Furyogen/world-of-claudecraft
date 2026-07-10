import { beforeAll, describe, expect, it } from 'vitest';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';
import { ABILITIES } from '../src/sim/content/classes';
import { TALENTS } from '../src/sim/content/talents';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { grantAbilityValues, tTalent } from '../src/ui/talent_i18n';

// Talent descriptions are generated from effect data outside English. English remains
// authored source text, so this suite keeps it numerically honest against the effect
// records that power specs, masteries, and the new choice rows.

const PCT_FIELDS = new Set([
  'leechPct',
  'hpFrac',
  'belowFrac',
  'dmgPctVsDotted',
  'crit',
  'dodge',
  'apPct',
  'staPct',
  'armorPct',
  'maxHpPct',
  'strPct',
  'agiPct',
  'intPct',
  'spiPct',
  'meleeDmgPct',
  'meleeHastePct',
  'spellDmgPct',
  'healPct',
  'threatPct',
  'critDmgPct',
  'dotDmgPct',
  'hotHealPct',
  'absorbPct',
  'critVsRooted',
  'spellHastePct',
  'petDmgPct',
  'petDmgSharePct',
  'secondWindPctPerSec',
  'secondWindHpBelow',
  'fearBreakPct',
  'onKillSpeedPct',
  'autoRagePct',
  'abilityRagePct',
  'battleRhythmRagePct',
  'battleRhythmDmgPct',
  'bloodbathPct',
  'bloodbathMaxPct',
  'dmgPct',
  'costPct',
  'cooldownPct',
  'castPct',
  'buffPct',
]);

function expectedTokens(effect: unknown): string[] {
  const toks: string[] = [];
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number') {
        if (value === 0) continue;
        if (key === 'battleRhythm') continue;
        if (key === 'critDmgPct' && value === 0.5) {
          toks.push('double');
          continue;
        }
        // A slow `mult` is stated as the percentage slowed (mult 0.5 = 50% slower).
        if (key === 'mult' && value > 0 && value < 1) {
          toks.push(`${+((1 - value) * 100).toFixed(1)}%`);
          continue;
        }
        // castPct -1 means the cast becomes instant; tooltips say "instant".
        if (key === 'castPct' && value === -1) {
          toks.push('instant');
          continue;
        }
        // A proc firing on EVERY matching cast (n: 1) reads as "every cast";
        // no numeral is required in the copy.
        if (key === 'n' && value === 1) continue;
        if (key === 'bonusCharges') {
          toks.push(`${value + 1}`);
          continue;
        }
        toks.push(
          PCT_FIELDS.has(key)
            ? `${+(Math.abs(value) * 100).toFixed(1)}%`
            : `${+Math.abs(value).toFixed(1)}`,
        );
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object') walk(value);
    }
  };
  walk(effect);
  return toks;
}

function legitNumbers(effect: unknown): Set<number> {
  const out = new Set<number>();
  const add = (value: number, isPct: boolean) => {
    out.add(isPct ? Math.round(Math.abs(value) * 100) : Math.abs(value));
  };
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'number') {
        if (key === 'battleRhythm') continue;
        add(value, PCT_FIELDS.has(key));
        // Cheat death leaves the player at 1 health: the floor is intrinsic to
        // the mechanic, so copy may state the 1.
        if (key === 'cheatDeathIcd') out.add(1);
        if (key === 'bonusCharges') out.add(value + 1);
        // A slow mult also legitimizes the stated slow percentage (mult 0.5 = 50%).
        if (key === 'mult' && value > 0 && value < 1) out.add(Math.round((1 - value) * 100));
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object') walk(value);
    }
  };
  walk(effect);
  // A grant option's tooltip appends the granted ability's own description with
  // its base (rank-1) values resolved, so every number the granted ability
  // produces (damage min/max, buff, duration, absorb amount, dot total) is
  // legitimate, not a contradiction. Walk the granted ability's effects too.
  const grantId = (effect as { grant?: { ability?: string } })?.grant?.ability;
  if (grantId && ABILITIES[grantId]) {
    // Render the granted ability description exactly as the tooltip does (base
    // values), so every number it actually shows counts as legitimate.
    const { pcts, bare } = descriptionNumbers(
      tEntity({
        kind: 'ability',
        id: grantId,
        field: 'description',
        values: grantAbilityValues(grantId),
      }),
    );
    for (const n of pcts) out.add(n);
    for (const n of bare) out.add(n);
  }
  return out;
}

function hasNumericEffect(effect: unknown): boolean {
  return legitNumbers(effect).size > 0;
}

function descriptionNumbers(text: string): { pcts: number[]; bare: number[] } {
  const pcts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Math.round(parseFloat(m[1])));
  const bare: number[] = [];
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)) {
    const n = parseFloat(m[1]);
    const end = (m.index ?? 0) + m[0].length;
    const after = text.slice(end, end + 8).toLowerCase();
    if (/^\s*%/.test(after)) continue;
    if (/^\s*(sec|second|yard|yd|min|meter|m\b)/.test(after)) continue;
    bare.push(n);
  }
  return { pcts, bare };
}

interface EffectEntry {
  cls: string;
  id: string;
  name: string;
  source: string;
  effect: unknown;
  render: () => string;
}

interface SpecEntry {
  cls: string;
  id: string;
  abilityName: string;
  render: () => string;
}

function effectEntries(): EffectEntry[] {
  const entries: EffectEntry[] = [];
  for (const [cls, ct] of Object.entries(TALENTS)) {
    if (!ct) continue;
    for (const spec of ct.specs) {
      entries.push({
        cls,
        id: `${spec.id}.mastery`,
        name: spec.mastery.name,
        source: spec.mastery.description,
        effect: spec.mastery.effect,
        render: () => tTalent({ kind: 'talentMastery', spec, field: 'description' }),
      });
    }
    for (const row of CHOICE_ROWS[cls].rows) {
      for (const choice of row.options) {
        entries.push({
          cls,
          id: `${row.level}.${choice.id}`,
          name: choice.name,
          source: choice.description,
          effect: choice.effect,
          render: () => tTalent({ kind: 'talentChoice', choice, field: 'description' }),
        });
      }
    }
  }
  return entries;
}

function specEntries(): SpecEntry[] {
  const entries: SpecEntry[] = [];
  for (const [cls, ct] of Object.entries(TALENTS)) {
    if (!ct) continue;
    for (const spec of ct.specs) {
      entries.push({
        cls,
        id: spec.id,
        abilityName: ABILITIES[spec.signature]?.name ?? spec.signature,
        render: () => tTalent({ kind: 'talentSpec', spec, field: 'description' }),
      });
    }
  }
  return entries;
}

const NO_EFFECT = 'Provides a specialization benefit.';

describe('talent tooltip accuracy for specs, masteries, and choice rows', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  const effects = effectEntries();
  const specs = specEntries();

  it('covers every class, every spec, and every choice row option', () => {
    expect(new Set(effects.map((e) => e.cls)).size).toBe(9);
    expect(specs).toHaveLength(27);
    expect(effects.length).toBe(27 + 9 * 6 * 3);
  });

  it('every spec tooltip names its signature ability', () => {
    const missing = specs
      .filter((entry) => !entry.render().includes(entry.abilityName))
      .map((entry) => `${entry.cls}:${entry.id} missing ${entry.abilityName}`);
    expect(missing).toEqual([]);
  });

  it('every mastery and row option describes a real effect', () => {
    const blank = effects.filter(
      (entry) => entry.render().trim() === NO_EFFECT || entry.render().trim() === '',
    );
    expect(blank.map((entry) => `${entry.cls}:${entry.id}`)).toEqual([]);
  });

  it('the rendered English tooltip states numbers when the effect has any', () => {
    const vague = effects
      .filter(
        (entry) =>
          hasNumericEffect(entry.effect) &&
          !/\d/.test(entry.render()) &&
          !expectedTokens(entry.effect).every((token) => entry.render().includes(token)),
      )
      .map((entry) => `${entry.cls}:${entry.id} -> "${entry.render()}"`);
    expect(vague).toEqual([]);
  });

  it('the tooltip is complete for every number the effect produces', () => {
    const incomplete: string[] = [];
    for (const entry of effects) {
      const text = entry.render();
      const missing = expectedTokens(entry.effect).filter((token) => !text.includes(token));
      if (missing.length) {
        incomplete.push(`${entry.cls}:${entry.id} missing ${missing.join(', ')} in "${text}"`);
      }
    }
    expect(incomplete, incomplete.join('\n')).toEqual([]);
  });

  it('no number in the rendered tooltip contradicts the effect data', () => {
    const bad: string[] = [];
    for (const entry of effects) {
      const legit = legitNumbers(entry.effect);
      const { pcts, bare } = descriptionNumbers(entry.render());
      for (const pct of pcts) {
        if (!legit.has(pct)) bad.push(`${entry.cls}:${entry.id} rendered "${pct}%" not in effect`);
      }
      for (const n of bare) {
        if (!legit.has(n)) bad.push(`${entry.cls}:${entry.id} rendered "${n}" not in effect`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the hand-written source description never states a number the effect does not produce', () => {
    const bad: string[] = [];
    for (const entry of effects) {
      const legit = legitNumbers(entry.effect);
      const { pcts, bare } = descriptionNumbers(entry.source);
      for (const pct of pcts) {
        if (!legit.has(pct)) bad.push(`${entry.cls}:${entry.id} source "${pct}%" not in effect`);
      }
      for (const n of bare) {
        if (!legit.has(n)) bad.push(`${entry.cls}:${entry.id} source "${n}" not in effect`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('regression locks: row and mastery tooltips state their real numbers', () => {
    setLanguage('en');
    const render = (cls: string, id: string) => {
      const entry = effects.find((candidate) => candidate.cls === cls && candidate.id.endsWith(id));
      if (!entry) throw new Error(`no talent entry matched for ${cls}:${id}`);
      return entry.render();
    };

    expect(render('warrior', 'war_r5_crushing_onrush')).toContain('50%');
    expect(render('warrior', 'war_r17_red_harvest')).toContain('25%');
    const survival = render('hunter', 'survival.mastery');
    expect(survival).toContain('Agility');
    expect(survival).toContain('15%');
    expect(survival).toContain('physical ability damage');
  });

  it('localized thorns procs identify the ward and reflected melee strike trigger', async () => {
    await ensureLocaleLoaded('es');
    setLanguage('es');
    const entry = effects.find(
      (candidate) =>
        candidate.cls === 'shaman' && candidate.id.endsWith('sha_r5_improved_lightning_shield'),
    );
    if (!entry) throw new Error('missing Improved Thunder Ward talent entry');

    const rendered = entry.render();
    expect(rendered).toContain(tEntity({ kind: 'ability', id: 'lightning_shield', field: 'name' }));
    expect(rendered).toContain(
      'Protege a un aliado para que los atacantes cuerpo a cuerpo se hieran al golpearlo.',
    );
    setLanguage('en');
  });
});
