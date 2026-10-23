import { describe, it, expect } from 'vitest';
import { filterSuggestableCategories } from './suggestCategories';

const cats = [
  { name: 'Boda Boda & Delivery Bikes', slug: 'boda-boda-bikes', parent: { name: 'Motors', slug: 'motors' } },
  { name: 'Bicycles', slug: 'bicycles', parent: { name: 'Motors', slug: 'motors' } },
  { name: 'Casual & Daily Labour', slug: 'casual-labour', parent: { name: 'Jobs', slug: 'jobs' } },
  { name: 'CV Writing', slug: 'cv-writing', parent: { name: 'CV Services', slug: 'cv-services' } },
  { name: 'Motors', slug: 'motors', parent: null },
];

describe('filterSuggestableCategories', () => {
  it('drops categories with no live listings', () => {
    const out = filterSuggestableCategories(cats, { 'boda-boda-bikes': 3, motors: 3 });
    expect(out.map((c) => c.slug)).toEqual(['boda-boda-bikes', 'casual-labour', 'cv-writing', 'motors']);
  });
  it('keeps jobs and cv-services trees even at zero', () => {
    const out = filterSuggestableCategories(cats, {});
    expect(out.map((c) => c.slug)).toEqual(['casual-labour', 'cv-writing']);
  });
  it('fails open when counts are unavailable', () => {
    expect(filterSuggestableCategories(cats, null)).toHaveLength(4);
  });
  it('honours the limit', () => {
    expect(filterSuggestableCategories(cats, null, 2)).toHaveLength(2);
  });
});
