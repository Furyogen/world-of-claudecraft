// Pure per-frame derivation for the Skills Manager HUD trackers (the WeakAuras-
// style squares and duration bars the spellbook's manager mode configures).
//
// The HOT half of the pure-core + thin-painter split: it maps the player's tracked
// ability list plus the live world state to one reused slot pool, and
// skill_tracker_painter.ts turns that into pooled DOM. The COLD config half (which
// abilities are tracked and how each draws) is skill_tracker_core.ts.
//
// WHAT A TRACKER FOLLOWS, in priority order, mirroring WeakAuras' "show the thing
// you can act on":
//   1. The ability's aura ON YOUR CURRENT TARGET that YOU applied (the druid
//      Wildbloom HoT you are keeping up, the Lunar Tempest DoT you are refreshing).
//      This is the case the owner asked for by name.
//   2. Failing that, the ability's aura on YOURSELF (a self buff or a proc).
//   3. Failing that, the ability's running cooldown.
//   4. Otherwise the tracker is not rendered at all: an idle ability draws nothing,
//      so the HUD stays clean between casts.
//
// Component contract: DOM-free, i18n-MECHANISM-free (no i18n runtime import; the
// localized ability name and the formatted countdown come from INJECTED deps each
// frame, so the keys keep firing and an in-game language switch lands next tick),
// and ALLOCATION-LIGHT: createSkillTrackerView(deps) preallocates a slot pool ONCE
// and tick() mutates it in place, returning the SAME { slots, count } container
// every call (the reused-reference allocation proxy, tests/util/alloc_probe.ts).
//
// Parity: every input field is a structural subset of what BOTH the offline Sim
// and the online ClientWorld mirror expose. `duration` and `sourceId` both ride the
// aura wire (server/game.ts WireAura `dur` / `src`), so a Sim-shaped aura and a
// ClientWorld-mirror aura derive an identical fraction and ownership. An old
// server omits `src` and the mirror decodes 0, which matches no player id; the
// ownership test below treats a zero/absent source as "unattributed, still mine to
// show" rather than dropping the tracker, so a stale server degrades to the
// pre-attribution behavior instead of a blank HUD.

import { isDebuffAura } from '../sim/aura_classify';
import type { AuraKind } from '../sim/types';
import type { SkillTrackerDisplay } from './skill_tracker_core';

/** Which of the three sources (see the header) a rendered tracker is following.
 *  Names WHAT the frame follows, which is what the hover tooltip states. */
export type SkillTrackerSource = 'target' | 'self' | 'cooldown';

/** How the frame READS, which is a different question from where the aura sits: a
 *  HoT you keep on a friendly target is helpful and a DoT on an enemy is not, yet
 *  both are source 'target'. Classified with the sim's ONE shared aura classifier
 *  (src/sim/aura_classify), so a tracker can never disagree with the aura strip
 *  about whether an effect is a debuff. Drives a data attribute the stylesheet
 *  tints from tokens; never a color here. */
export type SkillTrackerTone = 'buff' | 'debuff' | 'cooldown';

/** One configured tracker: the ability plus how it draws and how long its
 *  cooldown runs. The host resolves `cooldown` from the TALENT-RESOLVED ability
 *  (world.known), not the base table, so a talent that shortens a cooldown makes
 *  the sweep shorter too. */
export interface SkillTrackerEntryInput {
  abilityId: string;
  display: SkillTrackerDisplay;
  /** Talent-resolved cooldown length in seconds; 0 for a cooldown-less ability. */
  cooldown: number;
}

/** The aura fields the core reads. A structural subset of sim `Aura` both worlds
 *  mirror; `sourceId` and `stacks` are optional exactly as on the wire. */
export interface SkillTrackerAuraInput {
  id: string;
  remaining: number;
  duration: number;
  sourceId?: number;
  stacks?: number;
  /** The aura kind, for the buff/debuff tone. Both worlds carry it (the wire sends
   *  `kind` unconditionally); an aura without one falls back to the source-implied
   *  tone rather than dropping the tracker. */
  kind?: AuraKind;
  /** The aura magnitude, so a NEGATIVE-value stat buff (a stat sap riding a buff_*
   *  kind) tones as the debuff it is. Sent sparsely on the wire and decoded to 0,
   *  exactly as auras_view reads it. */
  value?: number;
}

/** The live world slice a tick reads. `targetAuras` is null with no target. */
export interface SkillTrackerWorldInput {
  playerId: number;
  selfAuras: readonly SkillTrackerAuraInput[];
  targetAuras: readonly SkillTrackerAuraInput[] | null;
  /** The player's running cooldowns (Entity.cooldowns), a Map in both worlds. */
  cooldowns: ReadonlyMap<string, number>;
}

/** One derived tracker. Every field is mutated IN PLACE each tick; the object
 *  reference is stable across ticks (no per-frame garbage). */
export interface SkillTrackerSlot {
  /** The painter's pool key: display + ability id, so switching an ability's type
   *  hands it a fresh node in the other group instead of recycling a mismatched
   *  one. */
  key: string;
  abilityId: string;
  display: SkillTrackerDisplay;
  source: SkillTrackerSource;
  tone: SkillTrackerTone;
  /** Seconds left on whatever is being followed. */
  remaining: number;
  /** The countdown label (injected formatter), e.g. "6.2". */
  remainingText: string;
  /** The localized ability name (injected resolver), for the bar's label. */
  name: string;
  /** 0..1 of the followed duration still to run; drives the bar fill and the
   *  square's sweep. 0 when the source has no known total length. */
  fraction: number;
  /** The stack count label, or '' when the aura does not stack past 1. */
  stacksText: string;
}

/** The whole tracker set: the reused pool plus how many leading slots are active
 *  this frame (slots.length is the high-water capacity, never truncated, so the
 *  pooled references stay stable). */
export interface SkillTrackerState {
  slots: SkillTrackerSlot[];
  count: number;
}

/** Injected host helpers, so the core produces localized text without importing
 *  the i18n runtime. Each fires every frame it is needed, exactly like auras_view. */
export interface SkillTrackerDeps {
  /** The localized ability display name (host: tEntity ability name). */
  abilityName(abilityId: string): string;
  /** The countdown label for a seconds value (host: formatNumber with one
   *  fraction digit under 10s, none above, matching the WoW cooldown read). */
  formatRemaining(seconds: number): string;
  /** The formatted stack count (host: formatNumber with no fraction digits). */
  formatStacks(stacks: number): string;
}

export interface SkillTrackerView {
  /** Derive this frame's trackers, mutating the reused pool in place. */
  tick(
    entries: readonly SkillTrackerEntryInput[],
    world: SkillTrackerWorldInput,
  ): SkillTrackerState;
}

/** Below this many seconds the countdown keeps a decimal (the WeakAuras read:
 *  "6.2" while it matters, "18" while it does not). */
const DECIMAL_BELOW_SECONDS = 10;

/** Format the countdown the way both displays want it. Exported so the host can
 *  build its `formatRemaining` dep on the same rule through its own formatNumber
 *  (the core never formats numbers itself: that is an i18n concern). */
export function skillTrackerFractionDigits(seconds: number): number {
  return seconds < DECIMAL_BELOW_SECONDS ? 1 : 0;
}

function makeSlot(): SkillTrackerSlot {
  return {
    key: '',
    abilityId: '',
    display: 'square',
    source: 'cooldown',
    tone: 'cooldown',
    remaining: 0,
    remainingText: '',
    name: '',
    fraction: 0,
    stacksText: '',
  };
}

/** Whether an aura on some entity is the LOCAL player's to show. A positive
 *  sourceId must match; a zero/absent source is an old server's un-attributed
 *  aura (see the header) and still counts, so the tracker degrades rather than
 *  going blank. */
function isOwnAura(aura: SkillTrackerAuraInput, playerId: number): boolean {
  if (aura.sourceId === undefined || aura.sourceId === 0) return true;
  return aura.sourceId === playerId;
}

function findOwnAura(
  auras: readonly SkillTrackerAuraInput[] | null,
  abilityId: string,
  playerId: number,
): SkillTrackerAuraInput | null {
  if (!auras) return null;
  for (const aura of auras) {
    if (aura.id === abilityId && isOwnAura(aura, playerId)) return aura;
  }
  return null;
}

function clampFraction(remaining: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(remaining)) return 0;
  return Math.min(1, Math.max(0, remaining / total));
}

/**
 * Build a tracker view. The slot pool grows only to the high-water tracker count
 * (amortized zero allocation in steady state); tick() mutates it in place and
 * returns the SAME { slots, count } container every call.
 */
export function createSkillTrackerView(deps: SkillTrackerDeps): SkillTrackerView {
  const slots: SkillTrackerSlot[] = [];
  const state: SkillTrackerState = { slots, count: 0 };

  return {
    tick(entries, world): SkillTrackerState {
      let count = 0;
      for (const entry of entries) {
        let source: SkillTrackerSource;
        let tone: SkillTrackerTone;
        let remaining: number;
        let total: number;
        let stacks = 0;
        const onTarget = findOwnAura(world.targetAuras, entry.abilityId, world.playerId);
        const onSelf = onTarget
          ? null
          : findOwnAura(world.selfAuras, entry.abilityId, world.playerId);
        const aura = onTarget ?? onSelf;
        if (aura) {
          source = onTarget ? 'target' : 'self';
          // A kind-less aura (no host mirrors one today, but the field is optional)
          // falls back to what its placement implies: something you put on your
          // target reads as a debuff, something on you reads as a buff.
          tone =
            aura.kind === undefined
              ? onTarget
                ? 'debuff'
                : 'buff'
              : isDebuffAura(aura.kind, aura.value ?? 0)
                ? 'debuff'
                : 'buff';
          remaining = aura.remaining;
          total = aura.duration;
          stacks = aura.stacks ?? 0;
        } else {
          const cooldown = world.cooldowns.get(entry.abilityId) ?? 0;
          if (!(cooldown > 0)) continue;
          source = 'cooldown';
          tone = 'cooldown';
          remaining = cooldown;
          // Floor the denominator at the live remaining so a cooldown shortened
          // mid-run (or an ability whose resolved cooldown the host could not
          // supply) can never draw a fraction above 1.
          total = Math.max(entry.cooldown, cooldown);
        }
        if (!(remaining > 0)) continue;
        if (count >= slots.length) slots.push(makeSlot());
        const slot = slots[count];
        slot.key = `${entry.display}:${entry.abilityId}`;
        slot.abilityId = entry.abilityId;
        slot.display = entry.display;
        slot.source = source;
        slot.tone = tone;
        slot.remaining = remaining;
        slot.remainingText = deps.formatRemaining(remaining);
        slot.name = deps.abilityName(entry.abilityId);
        slot.fraction = clampFraction(remaining, total);
        slot.stacksText = stacks > 1 ? deps.formatStacks(stacks) : '';
        count++;
      }
      state.count = count;
      return state;
    },
  };
}
