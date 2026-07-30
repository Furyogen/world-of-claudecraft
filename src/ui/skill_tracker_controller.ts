// Thin composition root for the Skills Manager: it owns the per-class tracker
// selection, the two movable HUD groups, and the per-frame hand-off from the pure
// view core to the pooled painter. Hud constructs ONE of these and calls update()
// from its per-frame path; every other Skills Manager seam (the spellbook's manager
// controls, the lock button) reads and writes through this object.
//
// It exists so none of that lands as a method cluster on hud.ts (root CLAUDE.md
// Modularity): the logic that needs Hud's private mutable state is exactly none of
// it, so this is a sibling module and Hud stays a thin consumer.
//
// The three collaborators it composes:
//   skill_tracker_core.ts    the config model + localStorage round trip (pure)
//   skill_tracker_view.ts    the per-frame derivation (pure, allocation-light)
//   skill_tracker_painter.ts the keyed-pool DOM painter (elided writers only)
//
// ENTRY REBUILD CADENCE. The tracked-entry list changes only when the player edits
// the selection, switches class, or a talent re-resolves a cooldown; it is NOT
// per-frame data. So it is rebuilt behind an allocation-free positional freshness
// walk (see ensureEntries) and the per-frame path reuses the same array, keeping
// the frame allocation-free like the view it feeds.
//
// MASTER SWITCH. With the Skills Manager off, update() hides both groups and
// returns before deriving anything, so a player who never opts in pays one
// setDisplay per frame (elided after the first) and nothing else.

import { ABILITIES } from '../sim/data';
import type { PainterHostWriters } from './painter_host';
import {
  attachOverlayDrag,
  type OverlayAnchor,
  type OverlayDragOptions,
} from './proc_overlay_drag';
import {
  isSkillTrackerEnabled,
  isTrackableAbility,
  parseSkillTrackerConfig,
  type SkillTrackerConfig,
  type SkillTrackerDisplay,
  serializeSkillTrackerConfig,
  setSkillTrackerDisplay,
  setSkillTrackerEnabled,
  skillTrackerDisplayOf,
  skillTrackerStorageKey,
} from './skill_tracker_core';
import { SkillTrackerPainter, type SkillTrackerPainterDeps } from './skill_tracker_painter';
import type { SkillTrackerAuraInput } from './skill_tracker_view';
import {
  createSkillTrackerView,
  type SkillTrackerDeps,
  type SkillTrackerEntryInput,
  type SkillTrackerView,
  type SkillTrackerWorldInput,
} from './skill_tracker_view';
import { trackerEntriesFromKnown } from './spellbook_view';

/** The world slice the controller reads each frame. A structural subset both the
 *  offline Sim and the online ClientWorld mirror expose, so the controller never
 *  needs a concrete world (and unit-tests against a plain object). */
export interface SkillTrackerControllerWorld {
  playerId: number;
  player: {
    targetId: number | null;
    auras: readonly {
      id: string;
      remaining: number;
      duration: number;
      sourceId?: number;
      stacks?: number;
    }[];
    cooldowns: ReadonlyMap<string, number>;
  };
  entities: ReadonlyMap<
    number,
    {
      auras: readonly {
        id: string;
        remaining: number;
        duration: number;
        sourceId?: number;
        stacks?: number;
      }[];
    }
  >;
  known: readonly { def: { id: string }; cooldown: number }[];
  cfg: { playerClass: string };
}

/** Hud-supplied glue. Everything the controller cannot own itself: the DOM roots,
 *  the shared write-elision facet, the persisted master/lock settings, and the
 *  icon + i18n resolvers the pure halves take as injected deps. */
export interface SkillTrackerControllerDeps {
  /** The two group wrappers (#skill-tracker-squares / #skill-tracker-bars): the
   *  drag targets and the elements shown/hidden by the master switch. */
  squareGroup(): HTMLElement;
  barGroup(): HTMLElement;
  /** The `.st-items` child of each group; the painter owns only these, so the
   *  always-present drag handle is never caught by its child reconcile. */
  squareItems(): HTMLElement;
  barItems(): HTMLElement;
  /** The shared write-elision facet (Hud's caches; one skip-rate). */
  writers: PainterHostWriters;
  /** The Skills Manager master switch (the spellbook's "Skills manager" button). */
  enabled(): boolean;
  setEnabled(on: boolean): void;
  /** The tracker frames' lock state (the spellbook's "Lock" button). */
  locked(): boolean;
  setLocked(locked: boolean): void;
  /** Icon + i18n resolvers, forwarded to the pure halves. */
  painterDeps: SkillTrackerPainterDeps;
  viewDeps: SkillTrackerDeps;
  /** How a group becomes draggable. Defaults to the shared overlay-drag family
   *  (attachOverlayDrag), which reads `window` and `localStorage`; injectable so a
   *  Node test can drive the controller without DOM globals. The drag math itself
   *  is covered by tests/proc_overlay_drag.test.ts, not re-tested here. */
  attachDrag?(
    el: HTMLElement,
    storageKey: string,
    defaults: OverlayAnchor,
    opts: OverlayDragOptions,
  ): void;
  /** Injectable document, so a Node test can hand the painter a fake DOM. */
  doc?: Document;
}

/** Where each group sits before the player drags it, as viewport fractions of the
 *  element CENTRE (the attachOverlayDrag anchor contract). Icons sit above the
 *  centre line and bars just under them, clear of the action bars and the chat
 *  frame, mirroring where a WeakAuras user parks them by default. */
export const SKILL_TRACKER_DEFAULT_ANCHORS: {
  squares: OverlayAnchor;
  bars: OverlayAnchor;
} = {
  squares: { fx: 0.5, fy: 0.56 },
  bars: { fx: 0.5, fy: 0.66 },
};

/** localStorage keys the two group positions persist under. */
export const SKILL_TRACKER_SQUARE_ANCHOR_KEY = 'skillTrackerSquareAnchor';
export const SKILL_TRACKER_BAR_ANCHOR_KEY = 'skillTrackerBarAnchor';

/** Body/element class marking a group the player may drag right now, so the
 *  stylesheet can reveal the handle and outline the (possibly empty) group. */
const UNLOCKED_CLASS = 'st-unlocked';

export class SkillTrackerController {
  private config: SkillTrackerConfig;
  /** The class the loaded config belongs to, so a character switch reloads it. */
  private configClass: string;
  private readonly view: SkillTrackerView;
  private readonly painter: SkillTrackerPainter;
  /** The reused tracked-entry array (see the header's rebuild cadence note). */
  private entries: SkillTrackerEntryInput[] = [];
  /** False forces the next ensureEntries to rebuild unconditionally (a config edit
   *  or a class switch); true lets it take the allocation-free freshness walk. */
  private entriesFresh = false;
  /** The reused per-frame world slice handed to the view, so a frame allocates no
   *  input object either. */
  private readonly worldInput: {
    playerId: number;
    selfAuras: readonly {
      id: string;
      remaining: number;
      duration: number;
      sourceId?: number;
      stacks?: number;
    }[];
    targetAuras:
      | readonly {
          id: string;
          remaining: number;
          duration: number;
          sourceId?: number;
          stacks?: number;
        }[]
      | null;
    cooldowns: ReadonlyMap<string, number>;
  } = { playerId: 0, selfAuras: [], targetAuras: null, cooldowns: new Map() };

  constructor(private readonly deps: SkillTrackerControllerDeps) {
    this.configClass = '';
    this.config = {};
    this.view = createSkillTrackerView(deps.viewDeps);
    this.painter = new SkillTrackerPainter(
      deps.writers,
      deps.squareItems(),
      deps.barItems(),
      deps.painterDeps,
      deps.doc,
    );
    // Both groups drag and persist through the shared overlay-drag family (the
    // proc overlay's), gated on the lock so a locked frame ignores pointerdown
    // entirely and never steals a click from the world beneath it.
    const attach = deps.attachDrag ?? attachOverlayDrag;
    const lockGate: OverlayDragOptions = { isLocked: () => deps.locked() };
    attach(
      deps.squareGroup(),
      SKILL_TRACKER_SQUARE_ANCHOR_KEY,
      SKILL_TRACKER_DEFAULT_ANCHORS.squares,
      lockGate,
    );
    attach(
      deps.barGroup(),
      SKILL_TRACKER_BAR_ANCHOR_KEY,
      SKILL_TRACKER_DEFAULT_ANCHORS.bars,
      lockGate,
    );
  }

  // ---- The spellbook manager's read/write surface ----

  managerMode(): boolean {
    return this.deps.enabled();
  }

  setManagerMode(on: boolean): void {
    this.deps.setEnabled(on);
  }

  locked(): boolean {
    return this.deps.locked();
  }

  setLocked(locked: boolean): void {
    this.deps.setLocked(locked);
  }

  /** The stored selection for a class, loading (and caching) it on first ask or
   *  after a character switch. */
  tracking(classId: string): SkillTrackerConfig {
    this.ensureLoaded(classId);
    return this.config;
  }

  setTracked(classId: string, abilityId: string, tracked: boolean): void {
    this.ensureLoaded(classId);
    this.commit(setSkillTrackerEnabled(this.config, abilityId, tracked));
  }

  setTrackDisplay(classId: string, abilityId: string, display: SkillTrackerDisplay): void {
    this.ensureLoaded(classId);
    this.commit(setSkillTrackerDisplay(this.config, abilityId, display));
  }

  // ---- The per-frame path ----

  /** Repaint both groups from the live world. Called from Hud.update(). */
  update(world: SkillTrackerControllerWorld): void {
    const w = this.deps.writers;
    const squareGroup = this.deps.squareGroup();
    const barGroup = this.deps.barGroup();
    const enabled = this.deps.enabled();
    // Master switch OFF hides every frame and bar, the behavior the owner asked
    // for, and returns before any derivation runs.
    if (!enabled) {
      w.setDisplay(squareGroup, 'none');
      w.setDisplay(barGroup, 'none');
      w.toggleClass(squareGroup, UNLOCKED_CLASS, false);
      w.toggleClass(barGroup, UNLOCKED_CLASS, false);
      return;
    }
    const unlocked = !this.deps.locked();
    w.toggleClass(squareGroup, UNLOCKED_CLASS, unlocked);
    w.toggleClass(barGroup, UNLOCKED_CLASS, unlocked);
    this.ensureLoaded(world.cfg.playerClass);
    this.ensureEntries(world);
    // While unlocked the groups stay visible even with nothing to show, so an
    // empty group can still be grabbed and parked; locked, an empty group hides
    // so it never occludes the world.
    const squares = this.entries.some((e) => e.display === 'square');
    const bars = this.entries.some((e) => e.display === 'bar');
    w.setDisplay(squareGroup, unlocked || squares ? '' : 'none');
    w.setDisplay(barGroup, unlocked || bars ? '' : 'none');
    const target =
      world.player.targetId !== null ? world.entities.get(world.player.targetId) : undefined;
    const input = this.worldInput;
    input.playerId = world.playerId;
    input.selfAuras = world.player.auras;
    input.targetAuras = target ? target.auras : null;
    input.cooldowns = world.player.cooldowns;
    this.painter.paint(this.view.tick(this.entries, input));
  }

  // ---- internals ----

  private ensureLoaded(classId: string): void {
    if (this.configClass === classId) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(skillTrackerStorageKey(classId));
    } catch {
      /* storage unavailable */
    }
    this.config = parseSkillTrackerConfig(raw);
    this.configClass = classId;
    // A class switch invalidates the entry list even when the freshness walk
    // would pass, so force a rebuild.
    this.entriesFresh = false;
  }

  private commit(config: SkillTrackerConfig): void {
    this.config = config;
    this.entriesFresh = false;
    try {
      localStorage.setItem(
        skillTrackerStorageKey(this.configClass),
        serializeSkillTrackerConfig(config),
      );
    } catch {
      /* storage unavailable */
    }
  }

  // Rebuild the tracked-entry array only when its inputs actually changed. The
  // check is an ALLOCATION-FREE positional walk over the player's learned
  // abilities rather than a per-frame signature string, because the online mirror
  // reassigns `known` on every snapshot and reference identity would rebuild every
  // frame. It compares id, display, and TALENT-RESOLVED cooldown, so allocating a
  // talent that shortens a cooldown re-derives the sweep length, and nothing else
  // does.
  private ensureEntries(world: SkillTrackerControllerWorld): void {
    if (this.entriesFresh) {
      let index = 0;
      let stale = false;
      for (const resolved of world.known) {
        const abilityId = resolved.def.id;
        // Cheapest gate first: the enabled lookup is a property read, while
        // isTrackableAbility walks the ability's effect list, so only the handful
        // of switched-on abilities pay for it.
        if (!isSkillTrackerEnabled(this.config, abilityId)) continue;
        if (!isTrackableAbility(ABILITIES[abilityId])) continue;
        const current = this.entries[index];
        if (
          !current ||
          current.abilityId !== abilityId ||
          current.display !== skillTrackerDisplayOf(this.config, abilityId) ||
          current.cooldown !== resolved.cooldown
        ) {
          stale = true;
          break;
        }
        index++;
      }
      if (!stale && index === this.entries.length) return;
    }
    this.entries = trackerEntriesFromKnown(world.known, this.config);
    this.entriesFresh = true;
  }
}
