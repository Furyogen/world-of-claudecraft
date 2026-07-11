import { t } from './i18n';

export type PlayerContextActionId =
  | 'info'
  | 'whisper'
  | 'invite'
  | 'friend'
  | 'unfriend'
  | 'ginvite'
  | 'mute'
  | 'block'
  | 'report'
  | 'close';

export interface PlayerContextAction {
  id: PlayerContextActionId;
  label: string;
}

export interface ChatPlayerContextState {
  playerName: string;
  selfName: string;
  online: boolean;
  isFriend: boolean;
  /** chat-only: hides their public chat from you. Toggles the Mute/Unmute label. */
  muted: boolean;
  /** the heavy tool: also kills invites, whispers, mail and /who. Online only. */
  blocked: boolean;
  canGuildInvite: boolean;
  alreadyGuilded: boolean;
  canReport: boolean;
}

export function chatPlayerContextActions(state: ChatPlayerContextState): PlayerContextAction[] {
  const samePlayer = state.playerName.toLowerCase() === state.selfName.toLowerCase();
  const actions: PlayerContextAction[] = [];

  // Player Info leads, and is offered even for a player who is nowhere near you:
  // online it falls back to the public character sheet, so a name you only ever
  // saw in /world or /lfg still resolves. It is the one row that makes sense on
  // yourself, so it sits outside the samePlayer guard.
  actions.push({ id: 'info', label: t('hudChrome.playerMenu.info') });

  if (!samePlayer) {
    actions.push({ id: 'whisper', label: t('hud.chat.context.whisper') });
    actions.push({ id: 'invite', label: t('hud.chat.context.invite') });
    if (state.online) {
      actions.push({
        id: state.isFriend ? 'unfriend' : 'friend',
        label: state.isFriend
          ? t('hud.chat.context.removeFriend')
          : t('hud.chat.context.addFriend'),
      });
    }
    if (state.canGuildInvite && !state.alreadyGuilded) {
      actions.push({ id: 'ginvite', label: t('hud.chat.context.inviteGuild') });
    }
    actions.push({
      id: 'mute',
      label: state.muted ? t('hudChrome.playerMenu.unmute') : t('hudChrome.playerMenu.mute'),
    });
    // Blocking is a server-side social action, so it only exists online.
    if (state.online) {
      actions.push({
        id: 'block',
        label: state.blocked ? t('hudChrome.playerMenu.unblock') : t('hudChrome.playerMenu.block'),
      });
    }
    if (state.canReport) actions.push({ id: 'report', label: t('hud.chat.context.report') });
  }

  actions.push({ id: 'close', label: t('hud.chat.context.cancel') });
  return actions;
}
