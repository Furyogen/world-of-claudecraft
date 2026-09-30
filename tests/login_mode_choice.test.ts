// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { buildWebSocketAuthMessage, sendWorldAuth } from '../src/net/world_auth_message';
import { createLoginModeChoice, LOGIN_MODE_STORAGE_KEY } from '../src/ui/login_mode_choice';
import { incognitoRequested, loginModeView, parseLoginMode } from '../src/ui/login_mode_view';

function memStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('login_mode_view (pure core)', () => {
  it('is hidden for an ordinary account and shown for staff', () => {
    expect(loginModeView(false, 'normal').visible).toBe(false);
    expect(loginModeView(true, 'normal').visible).toBe(true);
  });

  it('marks exactly the chosen option on and picks the matching hint', () => {
    const v = loginModeView(true, 'incognito');
    expect(v.options.map((o) => [o.mode, o.on])).toEqual([
      ['normal', false],
      ['incognito', true],
    ]);
    expect(v.hintKey).toBe('character.loginMode.incognitoHint');
    expect(loginModeView(true, 'normal').hintKey).toBe('character.loginMode.normalHint');
  });

  it('asks for incognito from the pick alone (the server is the staff gate)', () => {
    expect(incognitoRequested('incognito')).toBe(true);
    expect(incognitoRequested('normal')).toBe(false);
  });

  it('parses anything but the exact literal as normal', () => {
    expect(parseLoginMode('incognito')).toBe('incognito');
    for (const raw of [null, undefined, '', 'Incognito', 'true', 1]) {
      expect(parseLoginMode(raw)).toBe('normal');
    }
  });
});

describe('createLoginModeChoice (painter)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="charselect-login-mode" hidden></div>';
    root = document.getElementById('charselect-login-mode')!;
  });

  it('forwards a remembered incognito pick BEFORE whoami resolves (the entry race)', () => {
    // A fast Enter World or a boot resume can outrun the async whoami. The pick
    // must still ride the handshake, or a staff member who chose incognito is
    // silently entered with their flair showing. The control stays hidden until
    // staff is known; the server ignores the flag for a non-staff account.
    const choice = createLoginModeChoice(
      root,
      memStorage({ [LOGIN_MODE_STORAGE_KEY]: 'incognito' }),
    );
    expect(root.hidden).toBe(true);
    expect(root.children.length).toBe(0);
    expect(choice.incognito()).toBe(true);
  });

  it('defaults to normal with nothing remembered', () => {
    const choice = createLoginModeChoice(root, memStorage());
    choice.setAdmin(true);
    expect(choice.incognito()).toBe(false);
    expect((root.querySelector('[aria-pressed="true"]') as HTMLElement).dataset.mode).toBe(
      'normal',
    );
  });

  it('restores the remembered mode for staff and persists a new pick', () => {
    const storage = memStorage({ [LOGIN_MODE_STORAGE_KEY]: 'incognito' });
    const choice = createLoginModeChoice(root, storage);
    choice.setAdmin(true);
    expect(root.hidden).toBe(false);
    expect(choice.incognito()).toBe(true);
    const on = root.querySelector('[aria-pressed="true"]') as HTMLElement;
    expect(root.querySelectorAll('[aria-pressed="true"]').length).toBe(1);
    expect(on.dataset.mode).toBe('incognito');

    (root.querySelector('[data-mode="normal"]') as HTMLButtonElement).click();
    expect(choice.incognito()).toBe(false);
    expect(storage.data.get(LOGIN_MODE_STORAGE_KEY)).toBe('normal');
    expect((root.querySelector('[aria-pressed="true"]') as HTMLElement).dataset.mode).toBe(
      'normal',
    );
  });

  it('hides the control again when a non-staff account signs in', () => {
    const choice = createLoginModeChoice(
      root,
      memStorage({ [LOGIN_MODE_STORAGE_KEY]: 'incognito' }),
    );
    choice.setAdmin(true);
    choice.setAdmin(false);
    expect(root.hidden).toBe(true);
    expect(root.children.length).toBe(0);
  });

  it('survives a throwing storage by falling back to normal', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const choice = createLoginModeChoice(root, broken);
    choice.setAdmin(true);
    expect(choice.incognito()).toBe(false);
    (root.querySelector('[data-mode="incognito"]') as HTMLButtonElement).click();
    expect(choice.incognito()).toBe(true);
  });
});

describe('world auth frame', () => {
  it('carries incognito only when requested, so a normal frame is byte-identical', () => {
    expect('incognito' in buildWebSocketAuthMessage('t', 1, 's')).toBe(false);
    expect('incognito' in buildWebSocketAuthMessage('t', 1, 's', false)).toBe(false);
    expect(buildWebSocketAuthMessage('t', 1, 's', true).incognito).toBe(true);
  });

  it('sendWorldAuth puts exactly the built frame on the socket', () => {
    const sent: string[] = [];
    sendWorldAuth({ send: (d) => sent.push(d) }, 't', 1, 's', true);
    sendWorldAuth({ send: (d) => sent.push(d) }, 't', 1, 's', false);
    expect(sent.map((d) => JSON.parse(d))).toEqual([
      buildWebSocketAuthMessage('t', 1, 's', true),
      buildWebSocketAuthMessage('t', 1, 's'),
    ]);
  });
});
