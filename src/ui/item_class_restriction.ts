// Pure resolver: the item tooltip's explicit "Requires: <classes>" line. Classic
// MMO tooltips always name the eligible classes for a class-restricted item, but
// ONLY when that list is the restriction `canEquipItem` actually enforces:
// - Weapons: start from `requiredClass`, then filter it through the canonical
//   equipment boundary. This matters for hand-specific rules such as the blanket
//   Rogue two-handed prohibition.
// - Armor: `canEquipItem` short-circuits on armor weight (cloth/leather/mail) and
//   never reads `requiredClass` at all. On armor, `requiredClass` is loot-targeting
//   metadata unless it happens to name EXACTLY the classes that weight already
//   admits (see equipment_rules.ts classesThatCanEquipArmorType), e.g. a mail chest
//   naming only warrior/paladin/shaman. A narrower list (e.g. a leather item naming
//   only rogue/hunter, when every mail class can also wear leather) is not enforced,
//   and showing it would claim a restriction that does not exist.
//
// Bug #1893: a rogue/hunter-only dagger (Fang of Korzul) or a warrior/paladin/shaman
// mail chest (Deathlord Warplate) resolves to a known archetype/armor-weight group
// whose enforced set matches `requiredClass` exactly, and a prior version of the
// tooltip hid the class list whenever that happened, leaving a blocked player with
// no in-game explanation at all. Fixing that regression must not start claiming
// restrictions armor doesn't actually enforce (see classesThatCanEquipArmorType).
import {
  armorTypeForItem,
  canEquipItem,
  classesThatCanEquipArmorType,
} from '../sim/equipment_rules';
import type { ItemDef, PlayerClass } from '../sim/types';

// True when `classes` names exactly the members of `allowed` (order-independent).
function sameClassSet(classes: readonly PlayerClass[], allowed: readonly PlayerClass[]): boolean {
  return classes.length === allowed.length && classes.every((cls) => allowed.includes(cls));
}

// Returns the classes that can use the item, or null when the item carries no
// class restriction, or when that restriction is not one `canEquipItem` enforces
// (nothing accurate to show).
export function requiredClassesForTooltip(item: ItemDef): readonly PlayerClass[] | null {
  if (!item.requiredClass || item.requiredClass.length === 0) return null;
  const armorType = armorTypeForItem(item);
  if (armorType) {
    return sameClassSet(item.requiredClass, classesThatCanEquipArmorType(armorType))
      ? item.requiredClass
      : null;
  }
  // Apply hand/proficiency policy at the same boundary used by actual equips so
  // tooltip eligibility can never drift from enforcement for future items.
  const eligible = item.requiredClass.filter((cls) => canEquipItem(cls, item));
  return eligible.length > 0 ? eligible : null;
}
