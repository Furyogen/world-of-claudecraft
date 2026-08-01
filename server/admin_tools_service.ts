// The in-game game-master toolkit: /invisible, /visible, /freeze, /unfreeze,
// /tpto, /tptome, /tp. The policy half of the feature, deliberately split from
// its host the same way ModerationService is: every rule about who may run
// what, which target is legal, and which notice comes back lives here, behind a
// narrow host interface, so a Vitest drives the whole surface with a fake host
// and no sim, no sockets, and no database.
//
// The host (server/game.ts) owns the world effects: moving an entity, stowing a
// pet, flipping the sim-side flags, persisting a freeze. This module never
// touches the sim.
//
// Player-facing text is ENGLISH at the source, like the rest of server/; the
// client re-localizes it in src/ui/server_i18n.ts (the `gm.*` keys in
// server_i18n_moderation.ts). A new emit here needs its matcher rule in the
// same change.

import {
  type AdminChatCommand,
  type AdminTeleportPos,
  parseAdminChatCommand,
} from './admin_commands';
import { GM_TOOLS_PERMISSION } from './admin_permissions';

export interface AdminToolsSession {
  pid: number;
  isAdmin: boolean;
  // Expanded admin permission set, snapshotted at WS join (like isAdmin). Every
  // command in this family requires GM_TOOLS_PERMISSION.
  adminPermissions: ReadonlySet<string>;
  name: string;
}

export interface AdminToolsHost<TSession extends AdminToolsSession> {
  sessionByName(name: string): TSession | null;
  notice(session: TSession, text: string): void;
  systemNotice(session: TSession, text: string): void;
  isCloaked(session: TSession): boolean;
  setCloak(session: TSession, enabled: boolean): void;
  isFrozen(session: TSession): boolean;
  freeze(actor: TSession, target: TSession): void;
  unfreeze(actor: TSession, target: TSession): void;
  /** Move the actor to the target's current position. False when the target has
   *  no live body to stand next to (mid-teardown, or parked in spectate limbo). */
  teleportToPlayer(actor: TSession, target: TSession): boolean;
  /** Pull the target to the actor's current position. False for the same reason. */
  summonPlayer(actor: TSession, target: TSession): boolean;
  /** Move the actor to a world position, returning the zone they landed in, or
   *  null when the coordinates are outside the world. */
  teleportToPosition(actor: TSession, pos: AdminTeleportPos): string | null;
}

const NO_PERMISSION_MESSAGE = "You don't have permission to do that.";

// Dispatch-site gate: whether this session may even attempt a GM command. A
// session without the permission falls through to ordinary chat, exactly like a
// non-staff player, so its "/freeze Bob" broadcasts as plain text rather than
// advertising that the command exists.
export function canAttemptAdminToolCommands(session: AdminToolsSession): boolean {
  return session.adminPermissions.has(GM_TOOLS_PERMISSION);
}

export class AdminToolsService<TSession extends AdminToolsSession> {
  constructor(private readonly host: AdminToolsHost<TSession>) {}

  // True means the text belonged to this command family, including rejected
  // commands. The caller must not continue through ordinary chat routing.
  handleChatCommand(actor: TSession, text: string): boolean {
    const command = parseAdminChatCommand(text);
    if (!command) return false;
    // Defense in depth: the live caller already gates on the permission, but
    // this surface moves bodies around the world, so re-check here too and
    // swallow (return true) rather than let a rejected command leak into chat.
    if (!actor.isAdmin) return true;
    if (!canAttemptAdminToolCommands(actor)) {
      this.host.notice(actor, NO_PERMISSION_MESSAGE);
      return true;
    }
    this.run(actor, command);
    return true;
  }

  private run(actor: TSession, command: AdminChatCommand): void {
    switch (command.kind) {
      case 'invisible':
        this.setCloak(actor, true);
        return;
      case 'visible':
        this.setCloak(actor, false);
        return;
      case 'freeze':
        this.freeze(actor, command.name);
        return;
      case 'unfreeze':
        this.unfreeze(actor, command.name);
        return;
      case 'tpto':
        this.teleportTo(actor, command.name);
        return;
      case 'tptome':
        this.summon(actor, command.name);
        return;
      case 'tp':
        this.teleport(actor, command.pos);
        return;
    }
  }

  private setCloak(actor: TSession, enabled: boolean): void {
    if (this.host.isCloaked(actor) === enabled) {
      this.host.notice(actor, enabled ? 'You are already invisible.' : 'You are already visible.');
      return;
    }
    this.host.setCloak(actor, enabled);
    this.host.systemNotice(
      actor,
      enabled
        ? 'You are now invisible. Nobody can see, target, or harm you.'
        : 'You are now visible again.',
    );
  }

  private freeze(actor: TSession, name: string | null): void {
    const target = this.resolveTarget(actor, name, 'Usage: /freeze "<name>"');
    if (!target) return;
    if (this.host.isFrozen(target)) {
      this.host.notice(actor, `${target.name} is already frozen.`);
      return;
    }
    this.host.freeze(actor, target);
    this.host.systemNotice(actor, `Froze ${target.name}.`);
  }

  private unfreeze(actor: TSession, name: string | null): void {
    const target = this.resolveTarget(actor, name, 'Usage: /unfreeze "<name>"');
    if (!target) return;
    if (!this.host.isFrozen(target)) {
      this.host.notice(actor, `${target.name} is not frozen.`);
      return;
    }
    this.host.unfreeze(actor, target);
    this.host.systemNotice(actor, `Unfroze ${target.name}.`);
  }

  private teleportTo(actor: TSession, name: string | null): void {
    const target = this.resolveTarget(actor, name, 'Usage: /tpto "<name>"');
    if (!target) return;
    if (!this.host.teleportToPlayer(actor, target)) {
      this.host.notice(actor, `${target.name} has no reachable location right now.`);
      return;
    }
    this.host.systemNotice(actor, `Teleported to ${target.name}.`);
  }

  private summon(actor: TSession, name: string | null): void {
    const target = this.resolveTarget(actor, name, 'Usage: /tptome "<name>"');
    if (!target) return;
    if (!this.host.summonPlayer(actor, target)) {
      this.host.notice(actor, `${target.name} cannot be summoned right now.`);
      return;
    }
    this.host.systemNotice(actor, `Summoned ${target.name}.`);
  }

  private teleport(actor: TSession, pos: AdminTeleportPos | null): void {
    if (!pos) {
      this.host.notice(actor, 'Usage: /tp <x>, [y], <z>');
      return;
    }
    const zone = this.host.teleportToPosition(actor, pos);
    if (zone === null) {
      this.host.notice(actor, 'Those coordinates are outside the world.');
      return;
    }
    // Echoes the landing spot in the same shape /where reports it, so the zone
    // name is never confusable with the player-name form of /tpto's confirmation.
    this.host.systemNotice(
      actor,
      `Teleported to ${zone} at (${Math.round(pos.x)}, ${Math.round(pos.z)}).`,
    );
  }

  // Unlike moderation, a GM tool MAY target another admin: freezing or moving a
  // colleague is a legitimate part of running an event. Targeting yourself is
  // still refused, because every one of these verbs is meaningless on self (a
  // self-freeze would need a second admin to undo).
  private resolveTarget(actor: TSession, name: string | null, usage: string): TSession | null {
    if (name === null) {
      this.host.notice(actor, usage);
      return null;
    }
    const target = this.host.sessionByName(name);
    if (!target) {
      this.host.notice(actor, `No online player named '${name}'.`);
      return null;
    }
    if (target.pid === actor.pid) {
      this.host.notice(actor, "You can't use that on yourself.");
      return null;
    }
    return target;
  }
}
