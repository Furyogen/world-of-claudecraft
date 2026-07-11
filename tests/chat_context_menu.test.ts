import { afterEach, describe, expect, it } from 'vitest';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import {
  type ChatPlayerContextState,
  chatPlayerContextActions,
} from '../src/ui/player_context_menu';

const BASE: ChatPlayerContextState = {
  playerName: 'Badmage',
  selfName: 'Adventurer',
  online: true,
  isFriend: false,
  muted: false,
  blocked: false,
  canGuildInvite: false,
  alreadyGuilded: false,
  canReport: true,
};

const state = (over: Partial<ChatPlayerContextState> = {}): ChatPlayerContextState => ({
  ...BASE,
  ...over,
});

describe('chat player context menu', () => {
  afterEach(() => setLanguage('en'));

  it('offers social and report actions from chat names without live-only actions', () => {
    const actions = chatPlayerContextActions(state({ canGuildInvite: true }));

    expect(actions.map((a) => a.id)).toEqual([
      'info',
      'whisper',
      'invite',
      'friend',
      'ginvite',
      'mute',
      'block',
      'report',
      'close',
    ]);
    // trade and duel need a live entity in range, so they stay on the world menu
    expect(actions.map((a) => a.id)).not.toContain('trade');
    expect(actions.map((a) => a.id)).not.toContain('duel');
  });

  it('does not allow reporting yourself from chat, but still offers Player Info', () => {
    const actions = chatPlayerContextActions(state({ playerName: 'Adventurer' }));

    expect(actions.map((a) => a.id)).not.toContain('report');
    expect(actions.map((a) => a.id)).not.toContain('mute');
    expect(actions.map((a) => a.id)).not.toContain('block');
    expect(actions.map((a) => a.id)).toEqual(['info', 'close']);
  });

  // Mute and block are two DIFFERENT tiers, and the menu must never conflate them:
  // mute is chat-only, block also kills invites/whispers/mail/who. Each toggles its
  // own label independently of the other.
  it('toggles the mute label without touching the block label', () => {
    const muted = chatPlayerContextActions(state({ muted: true }));
    expect(muted.find((a) => a.id === 'mute')?.label).toBe('Unmute');
    expect(muted.find((a) => a.id === 'block')?.label).toBe('Block');

    const unmuted = chatPlayerContextActions(state({ muted: false }));
    expect(unmuted.find((a) => a.id === 'mute')?.label).toBe('Mute');
  });

  it('toggles the block label without touching the mute label', () => {
    const blocked = chatPlayerContextActions(state({ blocked: true }));
    expect(blocked.find((a) => a.id === 'block')?.label).toBe('Unblock');
    expect(blocked.find((a) => a.id === 'mute')?.label).toBe('Mute');

    const unblocked = chatPlayerContextActions(state({ blocked: false }));
    expect(unblocked.find((a) => a.id === 'block')?.label).toBe('Block');
  });

  it('offers a mute but no block offline: blocking needs an account and a server', () => {
    const actions = chatPlayerContextActions(state({ online: false }));

    expect(actions.map((a) => a.id)).toContain('mute');
    expect(actions.map((a) => a.id)).not.toContain('block');
    // friending is server-side too
    expect(actions.map((a) => a.id)).not.toContain('friend');
  });

  it('offers Player Info even when the player is nowhere near you', () => {
    // The menu carries no proximity input at all any more: out of interest scope the
    // Hud falls back to the public character sheet, so the row is always present.
    expect(chatPlayerContextActions(state()).map((a) => a.id)).toContain('info');
    expect(chatPlayerContextActions(state({ online: false })).map((a) => a.id)).toContain('info');
  });

  it('localizes chat context action labels', async () => {
    // Lazy locale flip: await the locale chunk so the synchronous t() label reads resolve
    // German rather than the English fallback (the bootstrap awaits the same way before paint).
    await ensureLocaleLoaded('de_DE');
    setLanguage('de_DE');
    const actions = chatPlayerContextActions(state());

    expect(actions.find((a) => a.id === 'whisper')?.label).toBe('Flüstern');
    expect(actions.find((a) => a.id === 'report')?.label).toBe('Spieler melden');
  });
});
