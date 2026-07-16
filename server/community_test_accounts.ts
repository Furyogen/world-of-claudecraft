// Off-by-default account provisioning for community test realms. This module owns
// the immutable character templates and generated-name policy; db.ts owns the
// transaction that inserts them. The templates are built through public Sim APIs
// so level, derived stats, equipment rules, bags, and persistence stay canonical.

import { type CharacterState, Sim } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL, type PlayerClass } from '../src/sim/types';
import { validCharName } from './auth';

const TEMPLATE_SEED = 20061;
const NAME_TOKEN_LENGTH = 8;
export const GENERATED_NAME_ATTEMPTS = 32;
const MAX_BAGS = 4;
const MAX_BAG_ITEM_ID = 'mistcallers_duffel';

const FURYFORGED_ARMOR = [
  'furyforged_warhelm',
  'furyforged_warspaulders',
  'furyforged_warplate',
  'furyforged_girdle',
  'furyforged_legguards',
  'furyforged_gauntlets',
  'furyforged_sabatons',
] as const;
const STORMBOUND_ARMOR = [
  'stormbound_crown',
  'stormbound_spaulders',
  'stormbound_hauberk',
  'stormbound_waistguard',
  'stormbound_legmail',
  'stormbound_handguards',
  'stormbound_greaves',
] as const;
const ASHSTALKER_ARMOR = [
  'ashstalker_cowl',
  'ashstalker_shoulderguards',
  'ashstalker_harness',
  'ashstalker_waistband',
  'ashstalker_legguards',
  'ashstalker_grips',
  'ashstalker_treads',
] as const;
const CINDERWEAVE_ARMOR = [
  'cinderweave_cowl',
  'cinderweave_mantle',
  'cinderweave_raiment',
  'cinderweave_cord',
  'cinderweave_legwraps',
  'cinderweave_handwraps',
  'cinderweave_slippers',
] as const;

const STRENGTH_LOADOUT = [
  'final_argument_greatblade',
  ...FURYFORGED_ARMOR,
  'final_oath_medallion',
  'iron_vow_band',
  'unbroken_circle',
] as const;
const AGILITY_LOADOUT = [
  'first_blood_razor',
  ...ASHSTALKER_ARMOR,
  'razorwind_torque',
  'fleetblood_band',
  'last_step_signet',
] as const;
const CASTER_LOADOUT = [
  'emberglass_warstaff',
  ...CINDERWEAVE_ARMOR,
  'cinder_sigil_pendant',
  'ashen_focus_ring',
  'spellbreakers_seal',
] as const;
const SHAMAN_LOADOUT = [
  'emberglass_warstaff',
  ...STORMBOUND_ARMOR,
  'cinder_sigil_pendant',
  'ashen_focus_ring',
  'spellbreakers_seal',
] as const;

const WARFARE_LOADOUTS: Record<PlayerClass, readonly string[]> = {
  warrior: STRENGTH_LOADOUT,
  paladin: STRENGTH_LOADOUT,
  hunter: AGILITY_LOADOUT,
  rogue: AGILITY_LOADOUT,
  priest: CASTER_LOADOUT,
  shaman: SHAMAN_LOADOUT,
  mage: CASTER_LOADOUT,
  warlock: CASTER_LOADOUT,
  druid: AGILITY_LOADOUT,
};

export interface CommunityTestCharacter {
  readonly cls: PlayerClass;
  readonly name: string;
  readonly state: CharacterState;
}

let enabled = false;
let cachedTemplates: ReadonlyMap<PlayerClass, CharacterState> | null = null;

export function configureCommunityTestAccounts(next: boolean): void {
  enabled = next;
}

export function communityTestAccountsEnabled(): boolean {
  return enabled;
}

function cloneState(state: CharacterState): CharacterState {
  return JSON.parse(JSON.stringify(state)) as CharacterState;
}

function templateStates(): ReadonlyMap<PlayerClass, CharacterState> {
  if (cachedTemplates) return cachedTemplates;
  const sim = new Sim({ seed: TEMPLATE_SEED, playerClass: 'warrior', noPlayer: true });
  const templates = new Map<PlayerClass, CharacterState>();
  for (const cls of ALL_CLASSES) {
    const pid = sim.addPlayer(cls, `${cls}template`);
    sim.setPlayerLevel(MAX_LEVEL, pid);
    for (const itemId of WARFARE_LOADOUTS[cls]) {
      sim.addItem(itemId, 1, pid);
      sim.equipItem(itemId, pid);
    }
    for (let socket = 0; socket < MAX_BAGS; socket++) {
      sim.addItem(MAX_BAG_ITEM_ID, 1, pid);
      sim.equipBag(MAX_BAG_ITEM_ID, socket, pid);
    }
    // Equipment can raise maximum health and mana, so refill through the same
    // authoritative level path after the final stat recalculation.
    sim.setPlayerLevel(MAX_LEVEL, pid);
    const state = sim.serializeCharacter(pid);
    if (!state) throw new Error(`failed to build community test template for ${cls}`);
    templates.set(cls, state);
  }
  cachedTemplates = templates;
  return cachedTemplates;
}

/** Build and cache pristine templates before opening an account transaction. */
export function prepareCommunityTestCharacters(): void {
  templateStates();
}

function encodeNameToken(value: bigint): string {
  let cursor = value;
  const chars = Array<string>(NAME_TOKEN_LENGTH).fill('a');
  for (let index = NAME_TOKEN_LENGTH - 1; index >= 0; index--) {
    chars[index] = String.fromCharCode(97 + Number(cursor % 26n));
    cursor /= 26n;
  }
  return chars.join('');
}

export function generatedTestCharacterName(
  accountId: number,
  cls: PlayerClass,
  attempt = 0,
): string {
  const safeAccountId = Math.max(0, Math.floor(accountId));
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const encoded = BigInt(safeAccountId) * BigInt(GENERATED_NAME_ATTEMPTS) + BigInt(safeAttempt);
  const prefix = `${cls[0].toUpperCase()}${cls.slice(1)}`;
  return `${prefix}${encodeNameToken(encoded)}`;
}

function firstValidName(accountId: number, cls: PlayerClass): string {
  for (let attempt = 0; attempt < GENERATED_NAME_ATTEMPTS; attempt++) {
    const candidate = generatedTestCharacterName(accountId, cls, attempt);
    if (validCharName(candidate)) return candidate;
  }
  throw new Error(`failed to generate a valid community test name for ${cls}`);
}

export function buildCommunityTestCharacters(accountId: number): CommunityTestCharacter[] {
  const templates = templateStates();
  return ALL_CLASSES.map((cls) => {
    const state = templates.get(cls);
    if (!state) throw new Error(`missing community test template for ${cls}`);
    return { cls, name: firstValidName(accountId, cls), state: cloneState(state) };
  });
}
