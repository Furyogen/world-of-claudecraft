import { afterEach, describe, expect, it, vi } from 'vitest';
import { GauntletBoard } from '../src/ui/gauntlet_board';
import type { GauntletRunView } from '../src/world_api/gauntlet';

// The standings board caps its RENDERED rows to what the viewport actually
// fits, folding the tail into one "+ N more" row, so the stylesheet's height
// cap never clips a contestant row mid-glyph. These tests drive update() with
// a hand-rolled fake root (no jsdom; tests/CLAUDE.md) and a stubbed
// window.innerHeight, mirroring the ROW_PX/CHROME_PX constants in the module.

function fakeRoot() {
  return {
    style: { display: 'none' },
    innerHTML: '',
    replaceChildren() {
      (this as { innerHTML: string }).innerHTML = '';
    },
  } as unknown as HTMLElement;
}

const contestant = (name: string, over: Partial<GauntletRunView['board'][number]> = {}) => ({
  name,
  vitality: 100,
  out: false,
  you: false,
  ...over,
});

function runView(board: GauntletRunView['board']): GauntletRunView {
  return {
    phase: 'trial',
    trialIndex: 0,
    trialCount: 6,
    endsAt: 400,
    survivors: board.length,
    total: board.length,
    prizePool: 10000,
    vitality: 100,
    vitalityMax: 100,
    spectating: false,
    practice: false,
    finished: false,
    originX: 9000,
    originZ: -1250,
    board,
    sentinel: null,
    sigils: null,
    pull: null,
    echo: null,
    span: null,
    podium: null,
  };
}

const rowCount = (html: string) => html.split('<li class="gb-row').length - 1;

afterEach(() => vi.unstubAllGlobals());

describe('gauntlet standings board row cap', () => {
  it('renders the whole field when there is no viewport to fit (Node env)', () => {
    const root = fakeRoot();
    const board = new GauntletBoard({ root: () => root });
    const field = Array.from({ length: 30 }, (_, i) => contestant(`Bot ${i}`));
    field[0] = contestant('Me', { you: true });
    board.update(runView(field));
    expect(rowCount(root.innerHTML)).toBe(30);
    expect(root.innerHTML).not.toContain('gb-more');
  });

  it('caps the rows on a short viewport and folds the tail into "+ N more"', () => {
    // innerHeight 500 fits floor((500 - 252) / 17) = 14 list rows: 13
    // contestants plus the tail summarizing the 17 hidden.
    vi.stubGlobal('window', { innerHeight: 500 });
    const root = fakeRoot();
    const board = new GauntletBoard({ root: () => root });
    const field = Array.from({ length: 30 }, (_, i) => contestant(`Bot ${i}`));
    field[0] = contestant('Me', { you: true });
    board.update(runView(field));
    expect(rowCount(root.innerHTML)).toBe(14);
    expect(root.innerHTML).toContain('gb-more');
    expect(root.innerHTML).toContain('+ 17 more');
    // The header count still reads the FULL field, not the visible slice.
    expect(root.innerHTML).toContain('30 / 30');
  });

  it("always keeps the viewer's own row visible, hoisted past the cap", () => {
    vi.stubGlobal('window', { innerHeight: 500 });
    const root = fakeRoot();
    const board = new GauntletBoard({ root: () => root });
    const field = Array.from({ length: 30 }, (_, i) => contestant(`Bot ${i}`));
    field[25] = contestant('Me Deep In The Tail', { you: true });
    board.update(runView(field));
    expect(root.innerHTML).toContain('gb-row me');
    expect(root.innerHTML).toContain('Me Deep In The Tail');
    // Still 15 rows total: the hoist swaps into the last visible slot.
    expect(rowCount(root.innerHTML)).toBe(14);
    expect(root.innerHTML).toContain('+ 17 more');
  });

  it('repaints with more rows when the viewport grows (cap is in the signature)', () => {
    vi.stubGlobal('window', { innerHeight: 500 });
    const root = fakeRoot();
    const board = new GauntletBoard({ root: () => root });
    const field = Array.from({ length: 30 }, (_, i) => contestant(`Bot ${i}`));
    const view = runView(field);
    board.update(view);
    expect(rowCount(root.innerHTML)).toBe(14);
    vi.stubGlobal('window', { innerHeight: 1200 });
    board.update(view); // same field, taller viewport: the cap change repaints
    expect(rowCount(root.innerHTML)).toBe(30);
    expect(root.innerHTML).not.toContain('gb-more');
  });
});
