// Source guard for the Gauntlet's outcome cues in hud.ts (the
// vale_cup_ui_guard.ts pattern: the HUD's DOM methods need a document, so this
// Node suite pins the CALL SITES rather than the paint).
//
// The bug this exists for: a trial outcome fired TWO cues at once. Passing a
// trial ran showBanner AND fiestaWordPop with the same string, so the word
// "PASSED" was drawn twice, in two different styles, overlapping; being knocked
// out ran the full-screen knockout overlay AND a word pop of the same word over
// the top of it. Each outcome announces itself exactly ONCE.
//
// Which cue each keeps is deliberate: the banner channel (showBanner) is also
// the sentinel's red/green LIGHT channel, which is actionable information a
// player reacts to, so a celebration never takes it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

// The body of a `case '<name>': { ... break; }` arm, comments stripped (a
// comment mentioning a cue must never satisfy or break these counts).
function caseBody(name: string): string {
  const start = hud.indexOf(`case '${name}': {`);
  expect(start, `case '${name}' not found in hud.ts`).toBeGreaterThan(-1);
  const end = hud.indexOf('break;', start);
  expect(end, `case '${name}' has no break`).toBeGreaterThan(start);
  return hud
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Every visual "here is your outcome" channel the HUD can announce through.
const CUES = ['this.showBanner(', 'this.fiestaWordPop(', 'this.gauntletOverlay.show'];

function cueCount(body: string): number {
  return CUES.reduce((n, cue) => n + body.split(cue).length - 1, 0);
}

describe('gauntlet outcome cues announce exactly once', () => {
  it('passing a trial pops the word, and does NOT also banner it', () => {
    const body = caseBody('gauntletFinished');
    expect(cueCount(body)).toBe(1);
    expect(body).toContain('this.fiestaWordPop(');
    // The banner is the light channel (actionable); the celebration stays off it.
    expect(body).not.toContain('this.showBanner(');
  });

  it('a knockout shows the overlay splash, and does NOT also pop the word', () => {
    const body = caseBody('gauntletEliminated');
    expect(cueCount(body)).toBe(1);
    expect(body).toContain('this.gauntletOverlay.showEliminated(');
    expect(body).not.toContain('this.fiestaWordPop(');
    expect(body).not.toContain('this.showBanner(');
  });

  it('the podium ceremony announces through the overlay alone', () => {
    const body = caseBody('gauntletPodium');
    expect(cueCount(body)).toBe(1);
    expect(body).toContain('this.gauntletOverlay.showPodium(');
  });
});
