import { describe, expect, it } from 'vitest';
import { badgeLabel, rarityLabel, weaponTypeLabel } from '../src/ui/armory_labels';

describe('armory labels', () => {
  it('resolves catalog discriminators through localized keys', () => {
    expect(weaponTypeLabel('sword')).toBe('Sword');
    expect(rarityLabel('legendary')).toBe('Legendary');
    expect(badgeLabel('flagship')).toBe('Flagship');
  });
});
