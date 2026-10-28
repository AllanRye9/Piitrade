import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  UGANDA_SUBCATEGORY_ADDITIONS,
  UGANDA_STANDALONE_CATEGORIES,
  allUgandaExpansionSlugs,
  withUgandaSubcategories,
} from './ugandaTaxonomy';

// Pure unit test, no database. Category.slug is globally unique and the SQL
// migrations use ON CONFLICT DO NOTHING, so a colliding slug would be skipped
// silently in production — this test is the guard that makes it loud.

const BASE_PARENTS = [
  'motors', 'property', 'jobs', 'cv-services', 'classifieds', 'electronics',
  'fashion', 'furniture', 'garden', 'services', 'agriculture', 'health-beauty',
];

function baseSlugsFromSeed(): string[] {
  const seed = fs.readFileSync(path.join(__dirname, '../../prisma/seed.ts'), 'utf8');
  return [...seed.matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]);
}

describe('uganda taxonomy expansion', () => {
  const slugs = allUgandaExpansionSlugs();

  it('has no duplicate slugs inside the expansion', () => {
    expect(slugs.filter((s, i) => slugs.indexOf(s) !== i)).toEqual([]);
  });

  it('does not collide with any slug already in prisma/seed.ts', () => {
    const base = new Set(baseSlugsFromSeed());
    expect(base.size).toBeGreaterThan(50); // guard: the regex actually found the seed slugs
    expect(slugs.filter((s) => base.has(s))).toEqual([]);
  });

  it('uses lowercase kebab-case slugs and non-empty names/icons', () => {
    const all = [
      ...Object.values(UGANDA_SUBCATEGORY_ADDITIONS).flat(),
      ...UGANDA_STANDALONE_CATEGORIES,
      ...UGANDA_STANDALONE_CATEGORIES.flatMap((c) => c.children),
    ];
    for (const c of all) {
      expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.name.trim().length).toBeGreaterThan(0);
      expect(c.icon.length).toBeGreaterThan(0);
    }
  });

  it('only adds subcategories to parents that exist', () => {
    for (const parent of Object.keys(UGANDA_SUBCATEGORY_ADDITIONS)) expect(BASE_PARENTS).toContain(parent);
  });

  it('keeps the slugs the existing jewellery and arts pages already link to', () => {
    const jewellery = UGANDA_STANDALONE_CATEGORIES.find((c) => c.slug === 'fine-jewellery')!;
    expect(jewellery.children.map((c) => c.slug)).toEqual(
      ['necklaces', 'rings', 'bracelets', 'earrings', 'pendants', 'brooches', 'sets', 'other-jewellery'],
    );
    const arts = UGANDA_STANDALONE_CATEGORIES.find((c) => c.slug === 'arts-collectibles')!;
    expect(arts.children.map((c) => c.slug)).toEqual(expect.arrayContaining(
      ['paintings', 'sculptures', 'photography', 'antiques', 'coins-stamps', 'vintage', 'tribal-art', 'other-art'],
    ));
  });

  it('withUgandaSubcategories is non-mutating and idempotent', () => {
    const base = { motors: [{ name: 'Used Cars', slug: 'used-cars', icon: '🚙' }] };
    const once = withUgandaSubcategories(base);
    expect(base.motors).toHaveLength(1);
    expect(withUgandaSubcategories(once).motors).toHaveLength(once.motors.length);
    expect(once['food-groceries']?.length).toBeGreaterThan(0);
  });
});
