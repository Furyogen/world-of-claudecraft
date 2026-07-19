// @vitest-environment jsdom
//
// DOM behavioral guard: keyboard focus, scroll position, and write elision
// across professions-window rebuilds (the deeds_window_focus.test.ts family).
// The painter rebuilds via full innerHTML on every data change, so focus must
// land on the role-equivalent fresh control (Close, the window's single
// interactive control, a premise pinned below), the scroll container must
// keep its offset, and an UNCHANGED refresh signature must produce zero DOM
// writes. Drives the real ProfessionsWindow over jsdom with stub deps.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfessionsWindow, type ProfessionsWindowDeps } from '../src/ui/professions_window';

// jsdom ships no 2D canvas, so the procedural icon compositor cannot run here;
// the painter only ever uses the returned string as an <img src>.
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:,',
  professionIconUrl: () => 'data:,',
}));

interface WorldState {
  identity: {
    version: 1;
    synced: boolean;
    craftSkills: Record<string, number>;
    activeArchetype: string | null;
    pairedMajor: string | null;
    hobbyCraft: string | null;
    attunedPairs: string[];
    switchCount: number;
    amendsProgress: number;
    amendsRequired: number;
  };
  gathering: { professionId: string; skill: number; maxSkill: number }[];
}

// An attuned, tiered identity so the window opens in full mode (ring, ten
// bars, perks), the surface with the most interactive controls.
function baseState(): WorldState {
  return {
    identity: {
      version: 1,
      synced: true,
      craftSkills: {
        engineering: 0,
        alchemy: 0,
        cooking: 30,
        leatherworking: 0,
        tailoring: 0,
        inscription: 0,
        enchanting: 0,
        jewelcrafting: 60,
        weaponcrafting: 25,
        armorcrafting: 49,
      },
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: ['weaponcrafting+armorcrafting'],
      switchCount: 2,
      amendsProgress: 1,
      amendsRequired: 11,
    },
    gathering: [{ professionId: 'mining', skill: 30, maxSkill: 300 }],
  };
}

function makeWindow(state: WorldState): { w: ProfessionsWindow; el: HTMLElement } {
  const el = document.createElement('div');
  el.id = 'professions-window';
  document.body.appendChild(el);
  const deps: ProfessionsWindowDeps = {
    root: () => el,
    world: () =>
      ({
        craftingIdentity: state.identity,
        professionsState: { skills: state.gathering },
        gatheringProficiency: Object.fromEntries(
          state.gathering.map((row) => [row.professionId, row.skill]),
        ),
      }) as never,
    closeOthers: () => {},
    hideTooltip: () => {},
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: () => {},
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
  };
  const w = new ProfessionsWindow(deps);
  w.open();
  return { w, el };
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('ProfessionsWindow: focus and scroll survive rebuilds', () => {
  it('focuses the Close button on cold open so a keyboard user enters the dialog', () => {
    const { el } = makeWindow(baseState());
    expect(document.activeElement).toBe(el.querySelector('[data-close]'));
  });

  it('rebuilds on a data change and restores focus to the fresh Close button', () => {
    const state = baseState();
    const { w, el } = makeWindow(state);
    w.refreshIfChanged(); // settle the post-open catch-up repaint
    const before = el.querySelector<HTMLElement>('[data-close]');
    if (!before) throw new Error('missing [data-close]');
    before.focus();
    state.identity.craftSkills.cooking = 40;
    w.refreshIfChanged();
    const fresh = el.querySelector<HTMLElement>('[data-close]');
    expect(fresh).not.toBe(before);
    expect(document.activeElement).toBe(fresh);
  });

  it('keeps Close the only focusable control, the whole refocus story', () => {
    // The painter's documented premise: a read-only window whose single
    // interactive control is the Close button, so the stable-identity refocus
    // family collapses to the Close arm. If a future change adds an inner
    // control, this pin fails and forces a real refocus-selector story (the
    // deeds data-attribute family) plus a test for it.
    const { el } = makeWindow(baseState());
    const focusables = [
      ...el.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ];
    expect(focusables).toHaveLength(1);
    expect(focusables[0].hasAttribute('data-close')).toBe(true);
  });

  it('preserves the scroll offset across a data-driven rebuild', () => {
    const state = baseState();
    const { w, el } = makeWindow(state);
    w.refreshIfChanged(); // settle the post-open catch-up repaint
    const scroll = el.querySelector<HTMLElement>('.prof-scroll');
    if (!scroll) throw new Error('contract: .prof-scroll is the window scroll container');
    scroll.scrollTop = 120;
    state.identity.craftSkills.cooking = 55;
    w.refreshIfChanged();
    const fresh = el.querySelector<HTMLElement>('.prof-scroll');
    expect(fresh).not.toBe(scroll);
    expect(fresh?.scrollTop).toBe(120);
  });

  it('performs no DOM writes when the refresh signature is unchanged', () => {
    const { w, el } = makeWindow(baseState());
    // open() leaves lastSig empty (the deeds open contract), so the first
    // refresh is a one-time catch-up repaint; settle it before asserting.
    w.refreshIfChanged();
    // Node identity is the decisive check: a rebuild would replace every
    // child even if the markup came back byte-identical.
    const closeBtn = el.querySelector('[data-close]');
    const firstChild = el.firstElementChild;
    const html = el.innerHTML;
    w.refreshIfChanged();
    w.refreshIfChanged();
    expect(el.querySelector('[data-close]')).toBe(closeBtn);
    expect(el.firstElementChild).toBe(firstChild);
    expect(el.innerHTML).toBe(html);
  });
});
