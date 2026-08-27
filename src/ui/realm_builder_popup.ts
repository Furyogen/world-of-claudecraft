// The Realm Builder honour roll: a small centered card listing who the
// Eastbrook Vale monument is honouring this month and everyone it has honoured
// before, opened by the HUD's 'realmBuilder' event arm and closed by its one
// button.
//
// Chrome and a11y follow src/ui/noticeboard_popup.ts exactly, and for the same
// reasons: it reuses the tutorial card family (.tut-card plus the .rb-*
// extensions) rather than the .window machinery because it is transient
// feedback, not a managed HUD window, so it owns no focus trap, no ESC
// arbitration and no z-order entanglement with the window stack. That decides
// role="status" over role="dialog" too: a dialog promises focus capture and a
// managed close, none of which a transient card provides. If the roll ever
// becomes interactive (paging, profile links), adopt the full markDialogRoot
// recipe instead of widening this.
//
// Honouree names are world data and splice verbatim, like player names and the
// signpost's guild names: only the chrome and the month localize.

import { isPlaceholderRealmBuilder, type RealmBuilderHonour } from '../sim/content/realm_builders';
import { formatDateTime, t } from './i18n';

/** "August 2026" in the reader's own language, from the honour's number pair. */
function honourMonthLabel(honour: RealmBuilderHonour): string {
  return formatDateTime(new Date(Date.UTC(honour.year, honour.month - 1, 1)), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export class RealmBuilderPopup {
  private root: HTMLElement | null = null;
  private current: RealmBuilderHonour | null = null;
  private past: readonly RealmBuilderHonour[] = [];

  show(current: RealmBuilderHonour, past: readonly RealmBuilderHonour[]): void {
    this.current = current;
    this.past = past;
    this.hide();
    const ui = document.getElementById('ui');
    if (!ui) return;

    const root = document.createElement('div');
    root.className = 'tut-card rb-popup';
    root.setAttribute('role', 'status');

    const title = document.createElement('div');
    title.className = 'tut-title';
    title.textContent = t('hudChrome.realmBuilder.title');
    root.appendChild(title);

    const currentBlock = document.createElement('div');
    currentBlock.className = 'rb-current';
    const currentLabel = document.createElement('div');
    currentLabel.className = 'rb-label';
    currentLabel.textContent = t('hudChrome.realmBuilder.currentLabel');
    const currentName = document.createElement('div');
    currentName.className = 'rb-name';
    currentName.textContent = current.name;
    const currentMonth = document.createElement('div');
    currentMonth.className = 'rb-month';
    currentMonth.textContent = honourMonthLabel(current);
    currentBlock.append(currentLabel, currentName, currentMonth);
    if (isPlaceholderRealmBuilder(current)) {
      const hint = document.createElement('div');
      hint.className = 'rb-hint';
      hint.textContent = t('hudChrome.realmBuilder.placeholderHint');
      currentBlock.appendChild(hint);
    }
    root.appendChild(currentBlock);

    const pastTitle = document.createElement('div');
    pastTitle.className = 'rb-past-title';
    pastTitle.textContent = t('hudChrome.realmBuilder.pastTitle');
    root.appendChild(pastTitle);

    const list = document.createElement('div');
    list.className = 'rb-list';
    if (past.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rb-empty';
      empty.textContent = t('hudChrome.realmBuilder.pastEmpty');
      list.appendChild(empty);
    } else {
      for (const honour of past) {
        const item = document.createElement('div');
        item.className = 'rb-item';
        const month = document.createElement('div');
        month.className = 'rb-item-month';
        month.textContent = honourMonthLabel(honour);
        const name = document.createElement('div');
        name.className = 'rb-item-name';
        name.textContent = honour.name;
        item.append(month, name);
        list.appendChild(item);
      }
    }
    root.appendChild(list);

    const close = document.createElement('button');
    close.className = 'tut-skip';
    close.type = 'button';
    close.textContent = t('hudChrome.realmBuilder.close');
    close.addEventListener('click', () => this.hide());
    root.appendChild(close);

    ui.appendChild(root);
    this.root = root;
  }

  hide(): void {
    this.root?.remove();
    this.root = null;
  }

  /** Re-localize after an in-game language switch (the Hud's
   *  woc:languagechange fan-out): repaint the open card's chrome strings. */
  relocalize(): void {
    if (this.root && this.current) this.show(this.current, this.past);
  }
}
