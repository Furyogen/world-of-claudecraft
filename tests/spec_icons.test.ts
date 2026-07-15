import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const specRoot = resolve(repoRoot, 'public', 'ui', 'specs');
const classDirectories = readdirSync(specRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe('painted specialization icon assets', () => {
  it('ships painted specialization directories only for the winning Warrior', () => {
    expect(classDirectories).toEqual(['warrior']);
  });

  it('ships exactly one WebP for each winning Warrior specialization', () => {
    const files = classDirectories
      .flatMap((classId) =>
        readdirSync(resolve(specRoot, classId)).map((file) => `${classId}/${file}`),
      )
      .sort();
    expect(files).toEqual(['warrior/arms.webp', 'warrior/fury.webp', 'warrior/prot.webp']);
  });
});
