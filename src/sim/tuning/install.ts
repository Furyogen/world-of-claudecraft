// Installing a class tuning document onto the shared ability table.
//
// The authoritative host loads its realm's document at boot and installs it
// ONCE, before the first `Sim` is constructed; the online client installs the
// same document when the server hands it over in the `hello` frame, so its
// tooltips, cooldown pips and cost predictions read the same numbers the server
// resolves. That is the whole reason tuning lands "on server restart" rather
// than live: a mid-flight table swap would change ability values underneath
// in-flight casts and cooldowns, and the two hosts would disagree for as long
// as the change took to reach the client.
//
// Determinism is unaffected: the transform is pure and runs to completion
// before any tick, so every host that installed the same document runs the same
// world, and a host that installed nothing runs the shipped table byte for byte.

import { ABILITIES } from '../content/classes';
import type { AbilityDef } from '../types';
import { applyAbilityTuning } from './ability_knobs';
import {
  type AbilityTuning,
  type ClassTuningDocument,
  emptyClassTuningDocument,
  sanitizeClassTuningDocument,
} from './document';

/**
 * Pure form: a NEW ability table with the document applied. Abilities the
 * document does not name (and abilities whose factors all resolve to no change)
 * keep their shipped def by reference.
 */
export function applyClassTuning(
  abilities: Readonly<Record<string, AbilityDef>>,
  doc: ClassTuningDocument,
): Record<string, AbilityDef> {
  const out: Record<string, AbilityDef> = { ...abilities };
  for (const [abilityId, factors] of Object.entries(doc.abilities)) {
    const base = abilities[abilityId];
    if (!base) continue;
    out[abilityId] = applyAbilityTuning(base, factors as AbilityTuning);
  }
  return out;
}

// The shipped defs displaced by the current install, so a re-install starts
// from the authored table rather than compounding on top of itself.
const shippedDefs = new Map<string, AbilityDef>();
let active: ClassTuningDocument = emptyClassTuningDocument();

/**
 * Apply `input` to the process-wide `ABILITIES` table, replacing whatever was
 * installed before. Returns the sanitized document that actually took effect.
 *
 * Call before constructing the `Sim`. Idempotent and reversible: installing an
 * empty document restores the shipped table exactly.
 */
export function installClassTuning(input: unknown): ClassTuningDocument {
  const doc = sanitizeClassTuningDocument(input);

  for (const [abilityId, shipped] of shippedDefs) ABILITIES[abilityId] = shipped;
  shippedDefs.clear();

  for (const [abilityId, factors] of Object.entries(doc.abilities)) {
    const shipped = ABILITIES[abilityId];
    if (!shipped) continue;
    const tuned = applyAbilityTuning(shipped, factors);
    if (tuned === shipped) continue;
    shippedDefs.set(abilityId, shipped);
    ABILITIES[abilityId] = tuned;
  }

  active = doc;
  return doc;
}

/** The document currently installed on this process (empty when untuned). */
export function activeClassTuning(): ClassTuningDocument {
  return active;
}

/** The ability ids whose defs the current install has replaced. */
export function installedTunedAbilityIds(): string[] {
  return [...shippedDefs.keys()].sort();
}
