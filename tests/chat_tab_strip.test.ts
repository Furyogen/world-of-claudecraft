import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source guards for the #1365 chat tab-strip fix. The behavior is otherwise only
// reachable in a live browser, so these pin the load-bearing declarations: a future
// edit that reintroduces the wrap, unpins the add button, or drops the mobile
// touch-pan (the exact regressions this PR fixes) fails here instead of silently.
const hud = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');

// First declaration block for an exact `selector {` (not a descendant/pseudo rule).
function block(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('chat tab strip layout (issue #1365)', () => {
  it('#chatlog-tabs stays a single nowrap row that scrolls horizontally on overflow', () => {
    const b = block(hud, '#chatlog-tabs');
    expect(b).toMatch(/flex-wrap:\s*nowrap/);
    expect(b).toMatch(/overflow-x:\s*auto/);
  });

  it('the add-channel button stays pinned inline (never drops to its own row)', () => {
    expect(block(hud, '.chat-tab-add')).toMatch(/position:\s*sticky/);
  });

  it('desktop suppresses the browser touch gesture on the move-handle strip', () => {
    expect(block(hud, '#chatlog-tabs')).toMatch(/touch-action:\s*none/);
  });

  it('mobile keeps the strip horizontally swipeable so overflowed tabs stay reachable', () => {
    expect(block(mobile, 'body.mobile-touch #chatlog-tabs')).toMatch(/touch-action:\s*pan-x/);
  });

  it('mobile drops the desktop down-scale so the tabs are not shrunk below the floor', () => {
    // The desktop scale(0.92) put the 22px tabs at ~20px, far under the 40px floor.
    expect(block(mobile, 'body.mobile-touch #chatlog-tabs')).toMatch(/transform:\s*none/);
  });

  it('mobile chat tabs meet the 40px touch floor with larger text', () => {
    const tab = block(mobile, 'body.mobile-touch .chat-tab');
    expect(tab).toMatch(/min-height:\s*40px/);
    expect(tab).toMatch(/font-size:\s*16px/);
  });

  it('the mobile add-channel button meets the 40x40 touch floor', () => {
    // width from the .chat-tab-add rule, height inherited from the .chat-tab rule above.
    expect(block(mobile, 'body.mobile-touch .chat-tab-add')).toMatch(/min-width:\s*40px/);
    expect(block(mobile, 'body.mobile-touch .chat-tab')).toMatch(/min-height:\s*40px/);
  });
});

describe('chat category filter strip layout (issue #1670)', () => {
  it('stays a single nowrap row that scrolls horizontally, same as #chatlog-tabs', () => {
    const b = block(hud, '.chat-category-strip');
    expect(b).toMatch(/flex-wrap:\s*nowrap/);
    expect(b).toMatch(/overflow-x:\s*auto/);
  });

  it('mobile category toggles meet the 40px touch floor', () => {
    expect(block(mobile, 'body.mobile-touch .chat-category-toggle')).toMatch(/min-height:\s*40px/);
  });

  // Regression: the strip shipped in index.html but not play.html, so
  // renderChatCategoryStrip's early return silently dropped the whole
  // feature on the canonical /play entry. Both entries hand-carry the same
  // chat DOM (see tests/entry_window_parity.test.ts for the equivalent
  // .window panel guard), so pin this id in both too.
  it('index.html and play.html both carry #chat-category-strip', () => {
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const play = readFileSync(new URL('../play.html', import.meta.url), 'utf8');
    expect(index).toContain('id="chat-category-strip"');
    expect(play).toContain('id="chat-category-strip"');
  });
});
