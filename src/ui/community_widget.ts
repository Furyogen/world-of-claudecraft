// Thin DOM consumer for the in-game Community window. It renders account-linked
// Discord and X cards, and takes all side effects through injected callbacks.

import type { DiscordAccountStatus, DiscordPresenceState } from './discord_status';
import { discordStatusBadgeDataUrl, discordStatusDisplayName } from './discord_tier';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';
import type { XAccountStatus } from './x_status';

const X_LOGO =
  '<svg viewBox="0 0 300 300.251" aria-hidden="true"><path fill="currentColor" d="M178.57 127.15 290.27 0h-26.46l-97.03 110.38L89.34 0H0l117.13 166.93L0 300.25h26.46l102.4-116.59 81.8 116.59h89.34M36.01 19.54H76.66l187.13 262.13h-40.66"/></svg>';
const DISCORD_LOGO =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.66 13.66 0 0 0-.64 1.32 18.47 18.47 0 0 0-5.45 0 13.02 13.02 0 0 0-.65-1.32 19.73 19.73 0 0 0-4.96 1.58C.53 9.03-.32 13.56.1 18.02a19.9 19.9 0 0 0 6.08 3.08c.49-.67.93-1.38 1.3-2.13-.72-.27-1.41-.6-2.06-.98.17-.13.34-.26.5-.4a14.16 14.16 0 0 0 12.16 0c.16.14.33.27.5.4-.65.39-1.34.72-2.07.99.38.74.81 1.45 1.31 2.12a19.86 19.86 0 0 0 6.08-3.08c.5-5.17-.85-9.66-3.58-13.65ZM8.02 15.28c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41 0-1.33.95-2.42 2.15-2.42 1.2 0 2.17 1.1 2.15 2.42 0 1.33-.95 2.41-2.15 2.41Z"/></svg>';

export interface CommunityWidgetDeps {
  onDiscordLink: () => void;
  onDiscordUnlink: () => void;
  onDiscordOpen: (url: string) => void;
  onXLink: () => void;
  onXUnlink: () => void;
  onXOpen: (url: string) => void;
  onClose: () => void;
}

function discordCardHtml(input: {
  enabled: boolean;
  status: DiscordAccountStatus;
  presence: DiscordPresenceState;
  inviteUrl: string;
}): string {
  const stats =
    input.presence.memberTotal > 0
      ? t('hudChrome.discord.cta.stats', {
          online: formatNumber(input.presence.onlineCount),
          total: formatNumber(input.presence.memberTotal),
        })
      : t('hudChrome.discord.cta.statsLoading');
  if (!input.enabled) {
    return (
      `<div class="community-integration-row is-disabled">` +
      `<span class="community-integration-icon discord">${DISCORD_LOGO}</span>` +
      `<span class="community-integration-copy"><strong>${esc(t('hudChrome.discord.title'))}</strong><span>${esc(t('hudChrome.discord.disabled'))}</span></span>` +
      `</div>`
    );
  }
  const status = input.status;
  if (!status.linked) {
    return (
      `<div class="community-integration-row">` +
      `<span class="community-integration-icon discord">${DISCORD_LOGO}</span>` +
      `<span class="community-integration-copy"><strong>${esc(t('hudChrome.discord.prompt.title'))}</strong><span>${esc(t('hudChrome.discord.prompt.body'))}</span><em>${esc(stats)}</em></span>` +
      `<button type="button" class="community-integration-action" data-action="discord-link">${esc(t('hudChrome.discord.prompt.action'))}</button>` +
      `</div>`
    );
  }
  const tierName = discordStatusDisplayName(status.statusTier);
  const avatar = status.avatar
    ? `<img class="community-avatar" src="${esc(status.avatar)}" alt="" referrerpolicy="no-referrer" draggable="false">`
    : `<img class="community-avatar" src="${esc(discordStatusBadgeDataUrl(status.statusTier))}" alt="" draggable="false">`;
  const progress =
    status.statusTier > 0
      ? t('hudChrome.discord.rankLine', { rank: tierName })
      : t('hudChrome.discord.tiers.none');
  return (
    `<div class="community-integration-row">` +
    avatar.replace('community-avatar', 'community-integration-avatar') +
    `<span class="community-integration-copy"><strong>${esc(status.username ?? t('hudChrome.discord.title'))}</strong><span>${esc(progress)}</span><em>${esc(stats)}</em></span>` +
    `<span class="community-integration-actions"><button type="button" class="community-integration-icon-btn" data-action="discord-open" title="${esc(t('hudChrome.discord.visit'))}" aria-label="${esc(t('hudChrome.discord.visit'))}">${DISCORD_LOGO}</button><button type="button" class="community-integration-action ghost" data-action="discord-unlink">${esc(t('hudChrome.discord.unlink'))}</button></span>` +
    `</div>`
  );
}

function xName(status: XAccountStatus): string {
  return status.username ? `@${status.username}` : (status.displayName ?? '');
}

function xCardHtml(status: XAccountStatus): string {
  if (!status.enabled) {
    return (
      `<div class="community-integration-row is-disabled">` +
      `<span class="community-integration-icon x">${X_LOGO}</span>` +
      `<span class="community-integration-copy"><strong>${esc(t('hudChrome.x.title'))}</strong><span>${esc(t('hudChrome.x.disabled'))}</span></span>` +
      `</div>`
    );
  }
  if (!status.linked) {
    return (
      `<div class="community-integration-row">` +
      `<span class="community-integration-icon x">${X_LOGO}</span>` +
      `<span class="community-integration-copy"><strong>${esc(t('hudChrome.x.prompt.title'))}</strong><span>${esc(t('hudChrome.x.prompt.body'))}</span></span>` +
      `<button type="button" class="community-integration-action" data-action="x-link">${esc(t('hudChrome.x.account.link'))}</button>` +
      `</div>`
    );
  }
  const name = xName(status);
  const avatar = status.avatar
    ? `<img class="community-integration-avatar" src="${esc(status.avatar)}" alt="" referrerpolicy="no-referrer" draggable="false">`
    : `<span class="community-integration-icon x" aria-hidden="true">${X_LOGO}</span>`;
  const verified = status.verified
    ? `<span class="community-pill">${esc(t('hudChrome.x.verified'))}</span>`
    : '';
  return (
    `<div class="community-integration-row">` +
    avatar +
    `<span class="community-integration-copy"><strong>${esc(name)}</strong><span>${esc(status.displayName ?? t('hudChrome.x.link.linkedBenefit'))}</span></span>` +
    `${verified}` +
    `<span class="community-integration-actions">${status.profileUrl ? `<button type="button" class="community-integration-icon-btn" data-action="x-open" title="${esc(t('hudChrome.x.visit'))}" aria-label="${esc(t('hudChrome.x.visit'))}">${X_LOGO}</button>` : ''}<button type="button" class="community-integration-action ghost" data-action="x-unlink">${esc(t('hudChrome.x.account.unlink'))}</button></span>` +
    `</div>`
  );
}

export function renderCommunityWidget(
  el: HTMLElement,
  input: {
    discordEnabled: boolean;
    discordStatus: DiscordAccountStatus;
    discordPresence: DiscordPresenceState;
    discordInviteUrl: string;
    xStatus: XAccountStatus;
  },
  deps: CommunityWidgetDeps,
): void {
  const header =
    `<div class="panel-title"><span>${esc(t('hudChrome.community.title'))}</span>` +
    `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.community.close'))}">${svgIcon('close')}</button></div>`;
  el.innerHTML =
    header +
    `<div class="dc-body community-body">` +
    `<section class="community-integrations" aria-label="${esc(t('hudChrome.community.integrations'))}">` +
    discordCardHtml({
      enabled: input.discordEnabled,
      status: input.discordStatus,
      presence: input.discordPresence,
      inviteUrl: input.discordInviteUrl,
    }) +
    xCardHtml(input.xStatus) +
    `</section>` +
    `</div>`;

  el.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.querySelector<HTMLElement>('[data-action="discord-link"]')?.addEventListener('click', () =>
    deps.onDiscordLink(),
  );
  el.querySelector<HTMLElement>('[data-action="discord-unlink"]')?.addEventListener('click', () =>
    deps.onDiscordUnlink(),
  );
  el.querySelector<HTMLElement>('[data-action="discord-open"]')?.addEventListener('click', () =>
    deps.onDiscordOpen(input.discordInviteUrl),
  );
  el.querySelector<HTMLElement>('[data-action="x-link"]')?.addEventListener('click', () =>
    deps.onXLink(),
  );
  el.querySelector<HTMLElement>('[data-action="x-unlink"]')?.addEventListener('click', () =>
    deps.onXUnlink(),
  );
  el.querySelector<HTMLElement>('[data-action="x-open"]')?.addEventListener('click', () => {
    if (input.xStatus.profileUrl) deps.onXOpen(input.xStatus.profileUrl);
  });
}
