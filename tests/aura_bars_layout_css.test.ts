// The player's two aura rows (#buff-bar, #debuff-bar) must never paint on top of
// each other.
//
// They used to be two independently absolutely-positioned rows, each with its own
// fixed `top`. A fixed pin cannot know how tall the other row grew, so any buff
// count that wrapped past the debuff row's pin painted the two on the same pixels:
//   - hud.mobile.css: buffs at 140px, debuffs at 140+36px. Row pitch is 28px icon
//     + 4px gap = 32px, so the second buff row started at 172px and covered the
//     debuff row at 176px. Six buffs was enough.
//   - the small-phone breakpoint was worse: 8px and 8+32px is EXACTLY one row
//     pitch apart, so buff row two landed precisely on the debuff row.
//   - hud.css desktop: 14px and 172px, which the duration labels reached at five
//     buff rows.
// Hiding a debuff behind a buff is the same failure the low graphics tier's aura
// cap is forbidden from causing (it sheds buffs and never debuffs, because a
// debuff is the actionable half of the display), so it cannot come back through
// the stylesheet either.
//
// The fix is structural: ONE flow column (#aura-bars) owns the anchor and the
// debuff row follows whatever height the buff rows actually took, WoW-style
// (BuffFrame_UpdateAllBuffAnchors). These pins assert the properties that make the
// overlap impossible, not the specific pixel values, so a future reposition of the
// column stays free while the no-overlap guarantee stays nailed down.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';

// Stripped so a pin can never match commented-out CSS, and so the prose above
// each rule (which names the very pixel values being removed) cannot satisfy a
// "no fixed top" assertion.
const read = (file: string): string =>
  stripComments(
    readFileSync(new URL(`../src/styles/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
  );

const hudCss = read('hud.css');
const mobileCss = read('hud.mobile.css');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const playHtml = readFileSync(new URL('../play.html', import.meta.url), 'utf8');

interface CssRule {
  selectors: string[];
  body: string;
}

/** Every leaf rule in the sheet, as (selector list, declaration body). A brace
 *  walk rather than a substring search, so `#buff-bar` can never be satisfied by
 *  `#buff-bar.hud-frame-detached`, `#player-frame > #buff-bar`, or a descendant
 *  rule like `#buff-bar .tf-move-btn`: those are different selectors and are
 *  meant to keep their own positioning. At-rule preludes (@layer, @media) are
 *  skipped; every rule this file asserts on is a leaf. */
function parseRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      stack.push(css.slice(start, i).trim());
      start = i + 1;
    } else if (ch === '}') {
      const prelude = stack.pop() ?? '';
      if (prelude && !prelude.startsWith('@')) {
        out.push({
          selectors: prelude.split(',').map((sel) => sel.trim().replace(/\s+/g, ' ')),
          body: css.slice(start, i),
        });
      }
      start = i + 1;
    }
  }
  return out;
}

const hudRules = parseRules(hudCss);
const mobileRules = parseRules(mobileCss);

/** The declaration bodies of every rule whose selector list contains EXACTLY
 *  `selector`. A row addressed by several rules yields several bodies. */
function decls(rules: readonly CssRule[], selector: string): string[] {
  return rules.filter((r) => r.selectors.includes(selector)).map((r) => r.body);
}

describe('the player aura rows share one flow column', () => {
  it('both entry points wrap the two rows in #aura-bars, in buff-then-debuff order', () => {
    for (const [name, html] of [
      ['index.html', indexHtml],
      ['play.html', playHtml],
    ] as const) {
      const start = html.indexOf('<div id="aura-bars">');
      expect(start, `${name} must wrap the aura rows in #aura-bars`).toBeGreaterThan(-1);
      const scope = html.slice(start, html.indexOf('</div>', html.indexOf('id="debuff-bar"')));
      const buff = scope.indexOf('id="buff-bar"');
      const debuff = scope.indexOf('id="debuff-bar"');
      expect(buff, `${name}: #buff-bar inside #aura-bars`).toBeGreaterThan(-1);
      expect(debuff, `${name}: #debuff-bar inside #aura-bars`).toBeGreaterThan(-1);
      // Source order IS paint order in a flow column: buffs above debuffs.
      expect(debuff, `${name}: the debuff row follows the buff row`).toBeGreaterThan(buff);
    }
  });

  it('the column is the single positioned anchor and stacks its rows vertically', () => {
    const column = decls(hudRules, '#aura-bars').join('\n');
    expect(column).toContain('position: absolute');
    expect(column).toContain('flex-direction: column');
  });

  it('NEITHER row carries a position or a top of its own, which is what let them collide', () => {
    // The whole defect in one assertion: a row with its own `top` is a row that
    // cannot know how tall the other one grew.
    for (const [sheet, rules] of [
      ['hud.css', hudRules],
      ['hud.mobile.css', mobileRules],
    ] as const) {
      for (const row of ['#buff-bar', '#debuff-bar']) {
        for (const body of decls(rules, row)) {
          expect(body, `${sheet} ${row} must not pin its own top`).not.toMatch(/(^|;)\s*top\s*:/);
          expect(body, `${sheet} ${row} must not position itself`).not.toMatch(
            /(^|;)\s*position\s*:/,
          );
        }
      }
    }
  });

  it('the mobile breakpoints anchor the column, not the two rows separately', () => {
    // Both former collision sites now resolve to one anchor. If either row ever
    // regains a mobile rule of its own, the assertion above goes red too.
    const anchored = decls(mobileRules, 'body.mobile-touch #aura-bars');
    expect(anchored.length, 'both mobile breakpoints anchor #aura-bars').toBe(2);
    for (const body of anchored) expect(body).toMatch(/(^|;)\s*top\s*:/);
  });
});

describe('the aura rows leave room for their own duration labels', () => {
  it('the row gap clears the label overhang, so a label never lands on the next row', () => {
    // .buff .dur hangs BELOW the icon box, so wrapped rows need a lane for it.
    // With the old flat 4px gap the labels of every row overlapped the icons of
    // the row beneath by (overhang - gap) px.
    const dur = decls(hudRules, '.buff .dur')[0];
    const overhang = Number(/bottom:\s*-(\d+)px/.exec(dur)?.[1]);
    expect(overhang, '.buff .dur must hang below the icon by a known amount').toBeGreaterThan(0);

    const column = decls(hudRules, '#aura-bars').join('\n');
    const rowGap = Number(/--aura-row-gap:\s*(\d+)px/.exec(column)?.[1]);
    const gap = Number(/--aura-gap:\s*(\d+)px/.exec(column)?.[1]);
    expect(rowGap, '#aura-bars must define --aura-row-gap').toBeGreaterThan(0);
    expect(rowGap, 'the row lane must clear the duration label overhang').toBeGreaterThanOrEqual(
      overhang + gap,
    );

    // And the rows must actually USE it on their wrap axis, not just declare it.
    for (const row of ['#buff-bar', '#debuff-bar']) {
      const applied = decls(hudRules, row).join('\n');
      expect(applied, `${row} must wrap on the label-clearing lane`).toContain(
        'gap: var(--aura-row-gap) var(--aura-gap)',
      );
    }
  });
});

describe('the rows wrap on an icon count, not a pixel width', () => {
  it('each row derives its width cap from --aura-per-row', () => {
    // A pixel cap re-wraps whenever the surrounding scale moves (the mobile
    // chrome scale multiplied the old max-width directly), which silently changes
    // how many icons a row holds and therefore where every icon sits.
    for (const row of ['#aura-bars > #buff-bar', '#aura-bars > #debuff-bar']) {
      const body = decls(hudRules, row).join('\n');
      expect(body, `${row} caps its width by icon count`).toContain('var(--aura-per-row)');
    }
    expect(decls(hudRules, '#aura-bars').join('\n')).toMatch(/--aura-per-row:\s*\d+/);
    for (const body of decls(mobileRules, 'body.mobile-touch #aura-bars')) {
      expect(body, 'each mobile breakpoint sets its own per-row count').toMatch(
        /--aura-per-row:\s*\d+/,
      );
    }
  });

  it('the width cap is scoped to rows still IN the column, so a resized row is not clamped', () => {
    // Interface-unlock box-resize writes an inline width and detaches the row onto
    // #ui in the same pass (movable_frame applyPos). An unscoped max-width would
    // silently clamp the size the player just chose.
    expect(decls(hudRules, '#aura-bars > #buff-bar').length).toBe(1);
    expect(decls(hudRules, '#aura-bars > #debuff-bar').length).toBe(1);
    for (const row of ['#buff-bar', '#debuff-bar']) {
      for (const body of decls(hudRules, row)) {
        expect(body, `the bare ${row} rule must not cap width`).not.toMatch(
          /(^|;)\s*max-width\s*:/,
        );
      }
    }
  });
});

describe('the player debuff row reads larger than the buff row', () => {
  it('sizes debuffs up, scoped so the mini-strips keep their own sizing', () => {
    // WoW's DEBUFF_ACTUAL_SIZE: the harmful half is the actionable half.
    const sized = decls(hudRules, '#debuff-bar .buff.debuff').join('\n');
    expect(sized).toContain('--aura-debuff-size');

    const column = decls(hudRules, '#aura-bars').join('\n');
    const base = Number(/--aura-size:\s*(\d+)px/.exec(column)?.[1]);
    const debuff = Number(/--aura-debuff-size,\s*(\d+)px/.exec(sized)?.[1]);
    expect(base, '#aura-bars must define --aura-size').toBeGreaterThan(0);
    expect(debuff, 'a debuff icon renders larger than a buff icon').toBeGreaterThan(base);

    // The party/raid mini-strips (16px and 12px) must not inherit the bump: an
    // unscoped `.buff.debuff` rule would beat `.pfm-auras .buff` on source order.
    for (const body of decls(hudRules, '.buff.debuff')) {
      expect(body, 'the unscoped .buff.debuff rule must not size icons').not.toMatch(
        /(^|;)\s*(width|height)\s*:/,
      );
    }
  });
});

describe('the dispellable marker is drawn without hiding anything', () => {
  it('is an OUTLINE in its own token, so it never replaces the school border tint', () => {
    // The school tint is what the icon's MEANING depends on (poison/magic/curse reads).
    // Drawing the dispel marker as a border would overwrite it, so it has to be an
    // outline, which sits outside the border box and changes no layout size either.
    const marker = decls(hudRules, '.buff.dispellable').join('\n');
    expect(marker, 'the marker is an outline').toMatch(/(^|;)\s*outline\s*:/);
    expect(marker, 'the marker must not set a border').not.toMatch(/(^|;)\s*border/);
    expect(marker, 'the marker must not resize the icon').not.toMatch(/(^|;)\s*(width|height)\s*:/);
    expect(marker, 'the marker colour comes from its own token').toContain(
      'var(--color-dispellable)',
    );
  });

  it('uses a token distinct from every school tint, so the two reads never collide', () => {
    const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    const tokenValue = (name: string): string => {
      const m = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens);
      expect(m, `${name} must be defined`).not.toBeNull();
      return (m?.[1] ?? '').trim().toLowerCase();
    };
    const dispellable = tokenValue('--color-dispellable');
    expect(dispellable).toMatch(/^#[0-9a-f]{6}$/);
    for (const school of ['fire', 'frost', 'arcane', 'shadow', 'nature', 'holy']) {
      expect(tokenValue(`--color-debuff-${school}`), `${school} tint`).not.toBe(dispellable);
    }
    expect(tokenValue('--color-debuff')).not.toBe(dispellable);
    expect(tokenValue('--color-buff')).not.toBe(dispellable);
  });
});
