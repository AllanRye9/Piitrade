import { describe, it, expect } from 'vitest';
import { CATEGORY_SYNONYMS, findSynonymSlugs } from '@/lib/categorySynonyms';
import { categoryHref, subcategoryHref, categoryListingsHref } from '@/lib/categoryLinks';
import { effectiveRank, isAdminHidden, sortByAdminRank, buildCategoryOptions, DEFAULT_PARENT_RANK } from '@/lib/categoryVisibility';
import { buildHomeTiles } from '@/lib/homeTiles';
import { HOME_CATEGORIES } from '@/lib/homeCategories';
import { buildIndexCards } from '@/components/categories/categoryIndexModel';
import { flattenOptions, searchOptions, resolveRecents, addRecent } from '@/components/ui/categoryPickerModel';
import { initialOrder, defaultOrder, moveItem, moveToTop, sameLayout } from '@/components/admin/categoryLayoutModel';

describe('categorySynonyms', () => {
  it('moved intact (informal-sector terms present, keys lowercase)', () => {
    expect(CATEGORY_SYNONYMS['boda boda']).toBe('boda-boda-bikes');
    expect(CATEGORY_SYNONYMS['classified']).toBe('classifieds');
    expect(Object.keys(CATEGORY_SYNONYMS).length).toBeGreaterThan(150);
    for (const k of Object.keys(CATEGORY_SYNONYMS)) expect(k).toBe(k.toLowerCase());
  });
  it('findSynonymSlugs: exact, prefix, contained; short queries ignored', () => {
    expect(findSynonymSlugs('mivumba')).toEqual(['mitumba']);
    expect(findSynonymSlugs('bod')).toContain('boda-boda-bikes');
    expect(findSynonymSlugs('second hand clothes please')).toContain('mitumba');
    expect(findSynonymSlugs('b')).toEqual([]);
    expect(new Set(findSynonymSlugs('boda')).size).toBe(findSynonymSlugs('boda').length);
  });
});

describe('categoryLinks', () => {
  it('dedicated pages vs the generic category page; filter view helper', () => {
    expect(categoryHref('motors')).toBe('/motors');
    expect(categoryHref('fine-jewellery')).toBe('/fine-jewellery');
    expect(categoryHref('pets-animals')).toBe('/category/pets-animals');
    expect(subcategoryHref('used-cars')).toBe('/category/used-cars');
    expect(categoryListingsHref('motors')).toBe('/listings?category=motors');
  });
});

describe('admin rank helpers', () => {
  it('effectiveRank: admin first, then defaults not mentioned', () => {
    const r = effectiveRank(['services', 'garden']);
    expect(r.slice(0, 2)).toEqual(['services', 'garden']);
    expect(r).toContain('motors');
    expect(new Set(r).size).toBe(r.length);
    expect(effectiveRank(null)).toEqual([...DEFAULT_PARENT_RANK]);
  });
  it('isAdminHidden', () => {
    expect(isAdminHidden('garden', ['garden'])).toBe(true);
    expect(isAdminHidden('garden', [])).toBe(false);
    expect(isAdminHidden('garden', null)).toBe(false);
  });
  it('sortByAdminRank is stable, unranked follow, empty rank = unchanged', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(sortByAdminRank(items, (x) => x, [])).toBe(items);
    expect(sortByAdminRank(items, (x) => x, ['c', 'a'])).toEqual(['c', 'a', 'b', 'd']);
  });
  it('buildCategoryOptions honours rank and hidden, keeps the selected one', () => {
    const fb = [{ value: '', label: 'All Categories' }];
    const tree = [{ slug: 'motors', name: 'Motors' }, { slug: 'services', name: 'Services' }, { slug: 'garden', name: 'Garden' }];
    const counts = { motors: 3, services: 2, garden: 1 };
    const out = buildCategoryOptions(fb, tree, counts, undefined, { rank: ['services'], hidden: ['garden'] });
    expect(out.map((o) => o.value)).toEqual(['', 'services', 'motors']);
    expect(buildCategoryOptions(fb, tree, counts, 'garden', { hidden: ['garden'] }).map((o) => o.value)).toContain('garden');
  });
});

describe('buildHomeTiles', () => {
  const live: Record<string, number> = Object.fromEntries(HOME_CATEGORIES.filter((c) => c.countKey).map((c) => [c.countKey!, 4]));
  const tree = [
    { slug: 'food-groceries', name: 'Food, Drinks & Groceries', icon: '🛒' },
    { slug: 'pets-animals', name: 'Pets', icon: '🐕' },
    { slug: 'motors', name: 'Motors', icon: '🚗' },
  ];
  it('default: ranked, live extras added, empty extras excluded', () => {
    const tiles = buildHomeTiles({ base: HOME_CATEGORIES, tree, counts: { ...live, 'food-groceries': 2 } });
    const labels = tiles.map((t) => t.label);
    expect(labels).toContain('Food, Drinks & Groceries');
    expect(labels).not.toContain('Pets');
    expect(labels.slice(0, 3)).toEqual(['Motors', 'Property', 'Electronics']);
    expect(tiles.find((t) => t.label === 'Food, Drinks & Groceries')!.href).toBe('/category/food-groceries');
  });
  it('admin rank + hidden', () => {
    const tiles = buildHomeTiles({ base: HOME_CATEGORIES, tree, counts: { ...live, 'food-groceries': 2 }, configRank: ['food-groceries', 'services'], hidden: ['motors'] });
    const labels = tiles.map((t) => t.label);
    expect(labels.slice(0, 2)).toEqual(['Food, Drinks & Groceries', 'Services']);
    expect(labels).not.toContain('Motors');
  });
  it('unknown counts: hand-made tiles shown, no extras', () => {
    const tiles = buildHomeTiles({ base: HOME_CATEGORIES, tree, counts: null });
    expect(tiles).toHaveLength(HOME_CATEGORIES.length);
  });
  it('zero-listing hand-made tiles are dropped, jobs/cv kept', () => {
    const tiles = buildHomeTiles({ base: HOME_CATEGORIES, tree: [], counts: { motors: 1 } });
    const labels = tiles.map((t) => t.label);
    expect(labels).toContain('Motors');
    expect(labels).toContain('Jobs');
    expect(labels).toContain('CV Services');
    expect(labels).not.toContain('Garden');
  });
});

describe('buildIndexCards', () => {
  const tree = [
    { name: 'Services', slug: 'services', icon: '🔧', children: [
      { name: 'Salons, Barbers & Hairdressing', slug: 'beauty-salon' },
      { name: 'Welding & Metal Fabrication', slug: 'welding-metalwork' },
      { name: 'Funeral & Memorial Services', slug: 'funeral-services' },
    ] },
    { name: 'Pets & Pet Supplies', slug: 'pets-animals', icon: '🐕', children: [{ name: 'Dogs & Puppies', slug: 'dogs' }] },
    { name: 'Jobs', slug: 'jobs', icon: '💼', children: [{ name: 'Casual & Daily Labour', slug: 'casual-labour' }] },
  ];
  const counts = { services: 10, 'beauty-salon': 6, 'welding-metalwork': 4 };
  it('shows live parents only (jobs exempt) with live chips by count; no chips for jobs', () => {
    const cards = buildIndexCards({ tree, counts });
    expect(cards.map((c) => c.slug)).toEqual(['jobs', 'services']); // default rank: jobs before services
    const services = cards.find((c) => c.slug === 'services')!;
    expect(services.chips.map((c) => c.slug)).toEqual(['beauty-salon', 'welding-metalwork']);
    expect(cards.find((c) => c.slug === 'jobs')!.chips).toEqual([]);
    expect(services.href).toBe('/services');
  });
  it('respects maxChips and reports the remainder', () => {
    const services = buildIndexCards({ tree, counts, maxChips: 1 }).find((c) => c.slug === 'services')!;
    expect(services.chips).toHaveLength(1);
    expect(services.hiddenChips).toBe(1);
  });
  it('admin hidden, rank', () => {
    expect(buildIndexCards({ tree, counts, hidden: ['services'] }).map((c) => c.slug)).toEqual(['jobs']);
    expect(buildIndexCards({ tree, counts, configRank: ['services'] }).map((c) => c.slug)).toEqual(['services', 'jobs']);
  });
  it('search by name and by synonym', () => {
    expect(buildIndexCards({ tree, counts, query: 'weld' }).map((c) => c.slug)).toEqual(['services']);
    const bySyn = buildIndexCards({ tree, counts, query: 'barber' });
    expect(bySyn[0].chips.map((c) => c.slug)).toEqual(['beauty-salon']);
    expect(buildIndexCards({ tree, counts, query: 'zzzz' })).toEqual([]);
  });
  it('unknown counts: all parents, no counts', () => {
    expect(buildIndexCards({ tree, counts: null })).toHaveLength(3);
  });
});

describe('categoryPickerModel', () => {
  const cats: any[] = [
    { id: 'p1', name: 'Motors', slug: 'motors', icon: '🚗', children: [
      { id: 'c1', name: 'Boda Boda & Delivery Bikes', slug: 'boda-boda-bikes' },
      { id: 'c2', name: 'Used Cars', slug: 'used-cars' } ] },
    { id: 'p2', name: 'Fashion', slug: 'fashion', icon: '👗', children: [
      { id: 'c3', name: 'Second-Hand Clothes (Mivumba)', slug: 'mitumba' } ] },
    { id: 'p3', name: 'Pets', slug: 'pets-animals', icon: '🐕', children: [] },
  ];
  it('flattens parents and children', () => expect(flattenOptions(cats)).toHaveLength(6));
  it('search ranks name matches and finds by synonym', () => {
    expect(searchOptions(cats, 'boda')[0].id).toBe('c1');
    expect(searchOptions(cats, 'mivumba')[0].id).toBe('c3');
    expect(searchOptions(cats, 'taxi').length).toBe(0);
    expect(searchOptions(cats, 'motors')[0].id).toBe('p1');
    expect(searchOptions(cats, '')).toEqual([]);
  });
  it('recents: resolve existing only, most recent first, capped, de-duped', () => {
    expect(resolveRecents(cats, ['c2', 'gone', 'p3']).map((o) => o.id)).toEqual(['c2', 'p3']);
    expect(addRecent(['a', 'b'], 'b')).toEqual(['b', 'a']);
    expect(addRecent(['1', '2', '3', '4', '5'], '6')).toEqual(['6', '1', '2', '3', '4']);
  });
});

describe('synonym-only matches (name does not contain the term)', () => {
  const cats: any[] = [{ id: 'p', name: 'Motors', slug: 'motors', icon: '🚗', children: [{ id: 'v', name: 'Taxis & Shuttles', slug: 'vans-minibuses' }] }];
  it('picker finds a category purely through the shared synonym list', () => {
    expect(searchOptions(cats, 'matatu').map((o) => o.id)).toEqual(['v']);
  });
  it('index search finds a card purely through the synonym list', () => {
    const tree = [{ name: 'Services', slug: 'services', children: [{ name: 'Hair Studio', slug: 'beauty-salon' }, { name: 'Other', slug: 'other-x' }] }];
    const cards = buildIndexCards({ tree, counts: { services: 3, 'beauty-salon': 2, 'other-x': 1 }, query: 'barber' });
    expect(cards[0].chips.map((c) => c.slug)).toEqual(['beauty-salon']);
  });
});

describe('categoryLayoutModel', () => {
  const slugs = ['garden', 'motors', 'pets-animals', 'services'];
  it('initialOrder: saved first, then defaults, then unknown-to-defaults; only existing', () => {
    expect(initialOrder(slugs, ['services', 'ghost'])).toEqual(['services', 'motors', 'pets-animals', 'garden']);
    expect(defaultOrder(slugs)).toEqual(['motors', 'services', 'pets-animals', 'garden']);
  });
  it('move up/down/top, bounds ignored', () => {
    expect(moveItem(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveToTop(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });
  it('sameLayout ignores hidden order', () => {
    expect(sameLayout({ order: ['a'], hidden: ['x', 'y'] }, { order: ['a'], hidden: ['y', 'x'] })).toBe(true);
    expect(sameLayout({ order: ['a', 'b'], hidden: [] }, { order: ['b', 'a'], hidden: [] })).toBe(false);
  });
});
