import { describe, it, expect } from 'vitest';
import { DEFAULT_CATEGORIES, SUBCATEGORY_MAP, fieldsFor, checkFieldValues } from './categoryTaxonomy';

describe('category tree', () => {
  it('has unique slugs across parents and subcategories', () => {
    const all = [...DEFAULT_CATEGORIES.map((c) => c.slug), ...Object.values(SUBCATEGORY_MAP).flat().map((c) => c.slug)];
    expect(new Set(all).size).toBe(all.length);
  });
  it('gives every parent subcategories, and no orphan sub-map keys', () => {
    for (const c of DEFAULT_CATEGORIES) expect((SUBCATEGORY_MAP[c.slug] ?? []).length, c.slug).toBeGreaterThan(0);
    for (const k of Object.keys(SUBCATEGORY_MAP)) expect(DEFAULT_CATEGORIES.some((c) => c.slug === k), k).toBe(true);
  });
  it('keeps every slug the previous version shipped', () => {
    for (const slug of ['used-cars', 'apartments-rent', 'laptops', 'smartphones', 'women-clothing', 'crops-grains', 'furniture-classifieds', 'cv-writing']) {
      expect(Object.values(SUBCATEGORY_MAP).flat().some((c) => c.slug === slug), slug).toBe(true);
    }
  });
});

describe('fieldsFor', () => {
  it('uses a different form for each kind of ad', () => {
    const names = (slug: string, parent: string) => fieldsFor(slug, parent).map((f) => f.name);
    expect(names('smartphones', 'electronics')).toEqual(expect.arrayContaining(['brand', 'model', 'storage', 'ram']));
    expect(names('women-shoes', 'fashion')).toContain('size');
    expect(names('dogs', 'pets-animals')).toEqual(expect.arrayContaining(['breed', 'vaccinated']));
    expect(names('cleaning', 'services')).toContain('serviceArea');
    expect(names('solar-power', 'electronics')).toContain('capacity');
  });
  it('leaves motors, property and jobs to their dedicated forms', () => {
    expect(fieldsFor('used-cars', 'motors')).toEqual([]);
    expect(fieldsFor('apartments-rent', 'property')).toEqual([]);
  });
  it('falls back to the parent set, and an admin schema always wins', () => {
    expect(fieldsFor('some-new-sub', 'electronics').map((f) => f.name)).toContain('brand');
    const admin = [{ name: 'x', label: 'X', type: 'text' }];
    expect(fieldsFor('smartphones', 'electronics', admin)).toBe(admin);
    expect(fieldsFor('smartphones', 'electronics', [])).not.toBe(admin);
  });
  it('covers every subcategory with some form, except the dedicated and form-less ones', () => {
    const none = ['motors', 'property', 'jobs', 'cv-services', 'agriculture', 'garden', 'classifieds'];
    const gaps: string[] = [];
    for (const [parent, subs] of Object.entries(SUBCATEGORY_MAP)) {
      if (none.includes(parent)) continue;
      for (const sub of subs) if (fieldsFor(sub.slug, parent).length === 0) gaps.push(sub.slug);
    }
    expect(gaps).toEqual([]);
  });
});

describe('checkFieldValues', () => {
  const fields = fieldsFor('smartphones', 'electronics');
  it('requires the required fields', () => {
    expect(checkFieldValues(fields, {}).missing).toEqual(['Brand', 'Model']);
  });
  it('rejects values outside a select, bad numbers and bad dates; drops unknown keys', () => {
    const r = checkFieldValues(fields, { brand: 'Nokia 3310 clone', model: 'X', storage: '64GB', junk: 'zzz' });
    expect(r.invalid).toEqual(['Brand']);
    expect(r.clean).toEqual({ model: 'X', storage: '64GB' });
    expect(checkFieldValues([{ name: 'n', label: 'N', type: 'number' }], { n: 'abc' }).invalid).toEqual(['N']);
    expect(checkFieldValues([{ name: 'd', label: 'D', type: 'date' }], { d: '25/10/2026' }).invalid).toEqual(['D']);
    expect(checkFieldValues([{ name: 'd', label: 'D', type: 'date' }], { d: '2026-10-25' }).clean).toEqual({ d: '2026-10-25' });
  });
});
