// @vitest-environment happy-dom
//
// The Realm Builder honour roll card. Two rules carry most of its weight:
// honouree names splice VERBATIM (they are world data, like player names and
// the signpost's guild names), and the month is formatted through Intl so it
// reads in the player's own language rather than being stored as English.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RealmBuilderHonour } from '../src/sim/content/realm_builders';
import { REALM_BUILDER_PLACEHOLDER_NAME } from '../src/sim/content/realm_builders';
import { setLanguage, t } from '../src/ui/i18n';
import { RealmBuilderPopup } from '../src/ui/realm_builder_popup';

const CURRENT: RealmBuilderHonour = {
  year: 2026,
  month: 8,
  name: REALM_BUILDER_PLACEHOLDER_NAME,
};
const PAST: readonly RealmBuilderHonour[] = [
  { year: 2026, month: 7, name: 'Wren Ashdown' },
  { year: 2026, month: 6, name: '<script>Marek</script>' },
];

describe('RealmBuilderPopup', () => {
  let popup: RealmBuilderPopup;

  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"></div>';
    setLanguage('en');
    popup = new RealmBuilderPopup();
  });

  afterEach(() => {
    popup.hide();
    document.body.innerHTML = '';
    setLanguage('en');
  });

  it('leads with the current honouree and their month', () => {
    popup.show(CURRENT, []);

    expect(document.querySelector('.rb-name')?.textContent).toBe(REALM_BUILDER_PLACEHOLDER_NAME);
    expect(document.querySelector('.rb-month')?.textContent).toBe('August 2026');
    expect(document.querySelector('.tut-title')?.textContent).toBe(
      t('hudChrome.realmBuilder.title'),
    );
    expect(document.querySelector('.rb-label')?.textContent).toBe(
      t('hudChrome.realmBuilder.currentLabel'),
    );
  });

  it('says the plate is unclaimed only while it carries the placeholder', () => {
    popup.show(CURRENT, []);
    expect(document.querySelector('.rb-hint')?.textContent).toBe(
      t('hudChrome.realmBuilder.placeholderHint'),
    );

    popup.show({ year: 2026, month: 8, name: 'Wren Ashdown' }, []);
    expect(document.querySelector('.rb-hint')).toBeNull();
  });

  it('shows an empty-roll line rather than a bare gap before the first honouree', () => {
    popup.show(CURRENT, []);
    expect(document.querySelectorAll('.rb-item')).toHaveLength(0);
    expect(document.querySelector('.rb-empty')?.textContent).toBe(
      t('hudChrome.realmBuilder.pastEmpty'),
    );
  });

  it('lists past honourees newest first, splicing names verbatim', () => {
    popup.show(CURRENT, PAST);

    const items = [...document.querySelectorAll('.rb-item')];
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.rb-item-month')?.textContent).toBe('July 2026');
    expect(items[0].querySelector('.rb-item-name')?.textContent).toBe('Wren Ashdown');
    expect(items[1].querySelector('.rb-item-month')?.textContent).toBe('June 2026');
    // Verbatim means textContent, never innerHTML: a name is untrusted text
    // the moment it comes from a live roster rather than this repo.
    expect(items[1].querySelector('.rb-item-name')?.textContent).toBe('<script>Marek</script>');
    expect(document.querySelector('.rb-list')?.querySelector('script')).toBeNull();
    expect(document.querySelector('.rb-empty')).toBeNull();
  });

  it('formats the month in the reader language and keeps the name untouched', () => {
    setLanguage('fr_FR');
    popup.relocalize();
    popup.show(CURRENT, PAST);

    // The month localizes...
    expect(document.querySelector('.rb-month')?.textContent).not.toBe('August 2026');
    expect(document.querySelector('.rb-month')?.textContent).toMatch(/2026/);
    // ...the honouree name never does.
    expect(document.querySelector('.rb-name')?.textContent).toBe(REALM_BUILDER_PLACEHOLDER_NAME);
    expect([...document.querySelectorAll('.rb-item-name')].map((node) => node.textContent)).toEqual(
      ['Wren Ashdown', '<script>Marek</script>'],
    );
  });

  it('is transient feedback, not a managed window: status role, one close, no leak', () => {
    popup.show(CURRENT, PAST);
    const root = document.querySelector('.rb-popup');
    expect(root?.getAttribute('role')).toBe('status');
    // A dialog would promise focus capture and an Escape route; this card
    // provides neither on purpose (the noticeboard popup's reasoning).
    expect(root?.getAttribute('aria-modal')).toBeNull();

    const close = document.querySelector('.rb-popup .tut-skip') as HTMLButtonElement;
    expect(close.textContent).toBe(t('hudChrome.realmBuilder.close'));
    close.click();
    expect(document.querySelector('.rb-popup')).toBeNull();

    // Re-showing replaces rather than stacking, so repeated inspects cannot
    // pile cards on top of each other.
    popup.show(CURRENT, PAST);
    popup.show(CURRENT, PAST);
    expect(document.querySelectorAll('.rb-popup')).toHaveLength(1);
  });

  it('relocalizes an open card and stays silent when none is open', () => {
    expect(() => popup.relocalize()).not.toThrow();
    expect(document.querySelector('.rb-popup')).toBeNull();

    popup.show(CURRENT, PAST);
    setLanguage('fr_FR');
    popup.relocalize();
    expect(document.querySelectorAll('.rb-popup')).toHaveLength(1);
    expect(document.querySelectorAll('.rb-item')).toHaveLength(2);
  });
});
