// Flavor text when a player interacts with a ground quest sparkle object.
// Every itemId in GROUND_OBJECTS must have an entry here.

export interface GroundPickupLines {
  /** Quest not active (or not accepted). */
  deny: string;
  /** Quest active but collect objective already satisfied. */
  enough: string;
}

export const GROUND_PICKUP_LINES: Record<string, GroundPickupLines> = {
  supply_crate: {
    deny: 'The crate is nailed shut.',
    enough: 'You already have enough supply crates.',
  },
  gravecaller_sigil: {
    deny: 'The sigil repels your touch.',
    enough: "You already carry a Gravecaller's Sigil.",
  },
  weathered_ledger_page: {
    deny: 'The ledger pages are bound too tightly to take.',
    enough: 'You already have enough ledger pages.',
  },
  morthen_grimoire: {
    deny: "The grimoire's clasp is magically sealed.",
    enough: "You already have Morthen's Grimoire.",
  },
  fen_muster_order: {
    deny: 'The wax seal holds until the order is yours to claim.',
    enough: 'You already have the Fenbridge muster order.',
  },
  lost_caravan_goods: {
    deny: "You aren't authorized to salvage these goods yet.",
    enough: 'You already have enough caravan goods.',
  },
  rusted_censer: {
    deny: 'The censer is chained in place.',
    enough: 'You already have enough rusted censers.',
  },
  bastion_ward_stone: {
    deny: 'The ward stone will not budge.',
    enough: 'You already have the Bastion ward stone.',
  },
  unknown_alien_weaponry: {
    deny: 'The meteor debris is too hot to handle without Aldric expecting it.',
    enough: 'You already recovered enough alien wreckage.',
  },
  highwatch_summons: {
    deny: 'The summons are sealed with Highwatch wax.',
    enough: 'You already have the Highwatch summons.',
  },
  ogre_war_totem: {
    deny: 'The totem is planted too firmly to uproot.',
    enough: 'You already have enough ogre war totems.',
  },
  gravewyrm_sigil: {
    deny: 'Dark magic keeps the sigil rooted.',
    enough: 'You already have enough Gravewyrm sigils.',
  },
  sanctum_key_shard: {
    deny: 'The shard is dormant and locked in place.',
    enough: 'You already have enough sanctum key shards.',
  },
  moongate_rubbing: {
    deny: 'The warding is not yours to copy until the watcher asks for it.',
    enough: 'You already have the warding rubbing.',
  },
  grave_sir_aldren: {
    deny: 'The grave is sealed against the living until the dead call you to it.',
    enough: "You have already taken what Captain Aldren's grave will give.",
  },
  grave_high_priest_malric: {
    deny: 'The grave is sealed against the living until the dead call you to it.',
    enough: "You have already taken what High Priest Malric's grave will give.",
  },
  grave_captain_voss: {
    deny: 'The grave is sealed against the living until the dead call you to it.',
    enough: "You have already taken what Royal Assassin Voss's grave will give.",
  },
  crypt_ritual_circle: {
    deny: 'The ritual circle lies cold and dormant.',
    enough: 'The circle has nothing more to give you.',
  },
  // --- Scorching Wastes ---
  brimming_waterskin: {
    deny: 'The caravan draws water by ration. Saffa decides whose skins get filled.',
    enough: 'Your skins are full to bursting already.',
  },
  caravan_manifest: {
    deny: 'Picking through the wreck without cause would be grave-robbing, not salvage.',
    enough: 'You have searched every wagon worth searching.',
  },
  mural_rubbing: {
    deny: "Without Caddis's wax paper, the mural is just a wall.",
    enough: 'You already carry all three rubbings.',
  },
  vigil_obelisk_dawn: {
    deny: 'The obelisk is cold. The mural spoke of an order: dawn wakes first.',
    enough: 'The Obelisk of Dawn already burns.',
  },
  vigil_obelisk_noon: {
    deny: 'The obelisk is cold. Dawn must burn before noon may stand.',
    enough: 'The Obelisk of Noon already burns.',
  },
  vigil_obelisk_dusk: {
    deny: 'The obelisk is cold. Dusk is always the last to the vigil.',
    enough: 'The Obelisk of Dusk already burns — and the Vigil has noticed.',
  },
  crown_brazier: {
    deny: 'The brazier will not take flame for a stranger. The psalter names the rite.',
    enough: 'This brazier already carries the crown-flame.',
  },
  heartspring_offering: {
    deny: 'The spring keeps its blessing for those Haruk has named.',
    enough: 'The spring has already spoken to you.',
  },
  wastes_relic_cache: {
    deny: 'The cache is fused shut by two ages of sun and sand.',
    enough: 'You have already emptied this cache.',
  },
};

export function groundPickupDeny(itemId: string, itemName: string): string {
  return GROUND_PICKUP_LINES[itemId]?.deny ?? `You cannot take the ${itemName} yet.`;
}

export function groundPickupEnough(itemId: string): string {
  return GROUND_PICKUP_LINES[itemId]?.enough ?? 'You have enough of those.';
}
