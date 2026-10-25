import { describe, it, expect } from 'vitest';
import { isBuyerVisible, isConfirmedLive, compareByRankThenCount, buildCategoryOptions } from '@/lib/categoryVisibility';
import { computeFit, splitTabs } from '@/lib/priorityFit';
import { buildMegaColumns } from '@/lib/megaMenu';

describe('categoryVisibility', () => {
  const counts = { motors: 5, 'boda-boda-bikes': 2, jobs: 3 };
  it('fails open when counts unknown', () => expect(isBuyerVisible('anything', null)).toBe(true));
  it('hides zero-count listing categories', () => {
    expect(isBuyerVisible('pets-animals', counts)).toBe(false);
    expect(isBuyerVisible('motors', counts)).toBe(true);
  });
  it('never gates jobs / cv-services trees', () => {
    expect(isBuyerVisible('jobs', {})).toBe(true);
    expect(isBuyerVisible('casual-labour', {}, 'jobs')).toBe(true);
    expect(isBuyerVisible('cv-writing', {}, 'cv-services')).toBe(true);
  });
  it('strict variant hides when unknown', () => {
    expect(isConfirmedLive('motors', null)).toBe(false);
    expect(isConfirmedLive('motors', counts)).toBe(true);
    expect(isConfirmedLive('pets-animals', counts)).toBe(false);
  });
  it('ranks known slugs first then by count', () => {
    const l = [{slug:'zzz',name:'Z'},{slug:'property',name:'P'},{slug:'motors',name:'M'},{slug:'aaa',name:'A'}];
    const c = { zzz: 9, aaa: 1 };
    expect(l.sort((a,b)=>compareByRankThenCount(a,b,c)).map(x=>x.slug)).toEqual(['motors','property','zzz','aaa']);
  });
  it('buildCategoryOptions falls back until tree and counts load, then gates', () => {
    const fb = [{value:'',label:'All Categories'},{value:'motors',label:'Motors'}];
    const tree = [{slug:'motors',name:'Motors'},{slug:'pets-animals',name:'Pets'},{slug:'food-groceries',name:'Food'}];
    expect(buildCategoryOptions(fb, null, {motors:1})).toBe(fb);
    expect(buildCategoryOptions(fb, tree, null)).toBe(fb);
    expect(buildCategoryOptions(fb, tree, {motors:4,'food-groceries':2}).map(o=>o.value)).toEqual(['','motors','food-groceries']);
    expect(buildCategoryOptions(fb, tree, {motors:4}, 'pets-animals').map(o=>o.value)).toContain('pets-animals');
  });
});

describe('priorityFit', () => {
  it('returns all when everything fits', () => expect(computeFit([100,100,100], 400, 80, 50)).toBe(3));
  it('reserves room for More and fixed items when overflowing', () => {
    // available 400, fixed 50, more 80 => 270 left => 2 tabs of 100
    expect(computeFit([100,100,100,100], 400, 80, 50)).toBe(2);
  });
  it('can return 0 on a tiny row', () => expect(computeFit([300], 200, 80, 50)).toBe(0));
  it('exactly fitting counts as fitting', () => expect(computeFit([100,100], 250, 80, 50)).toBe(2));
  it('splitTabs keeps order when active is visible', () => {
    expect(splitTabs(6, 3, 1)).toEqual({ visible: [0,1,2], overflow: [3,4,5] });
  });
  it('splitTabs swaps the active hidden tab into the last visible slot', () => {
    expect(splitTabs(6, 3, 5)).toEqual({ visible: [0,1,5], overflow: [2,3,4] });
  });
  it('splitTabs everything visible / no active', () => {
    expect(splitTabs(3, 9, -1)).toEqual({ visible: [0,1,2], overflow: [] });
    expect(splitTabs(4, 2, -1)).toEqual({ visible: [0,1], overflow: [2,3] });
  });
  it('splitTabs with zero fit overflows everything', () => {
    expect(splitTabs(3, 0, 1)).toEqual({ visible: [], overflow: [0,1,2] });
  });
});

describe('buildMegaColumns', () => {
  const curated = [{ heading: 'Home', links: [
    { label: 'Cleaning', href: '/services/cleaning' }, { label: 'Plumbing', href: '/services/plumbing-electrical' } ] }];
  const slugOf = (h: string) => h.replace('/services/','');
  const kids = [
    {name:'Cleaning',slug:'cleaning'},{name:'Welding',slug:'welding-metalwork'},{name:'Salons',slug:'beauty-salons-barbers'},{name:'Empty',slug:'funeral-services'},
  ];
  const opts = { parentSlug:'services', linkSlugOf: slugOf, extraHeading:'More in Services' };
  it('adds only live, non-curated children, most populated first', () => {
    const cols = buildMegaColumns(curated, kids, { cleaning: 4, 'welding-metalwork': 3, 'beauty-salons-barbers': 9 }, opts);
    expect(cols).toHaveLength(2);
    expect(cols[1].links.map(l=>l.countSlug)).toEqual(['beauty-salons-barbers','welding-metalwork']);
    expect(cols[1].links[0].href).toBe('/listings?category=beauty-salons-barbers');
  });
  it('adds nothing while counts unknown or everything empty', () => {
    expect(buildMegaColumns(curated, kids, null, opts)).toHaveLength(1);
    expect(buildMegaColumns(curated, kids, {}, opts)).toHaveLength(1);
  });
  it('caps links per column and extras', () => {
    const many = Array.from({length: 20}, (_,i)=>({name:'N'+i,slug:'s'+i}));
    const cnt = Object.fromEntries(many.map(m=>[m.slug,1]));
    const wide = [{heading:'H', links: Array.from({length:12},(_,i)=>({label:'L'+i,href:'/services/x'+i}))}];
    const cols = buildMegaColumns(wide, many, cnt, opts);
    expect(cols[0].links).toHaveLength(8);
    expect(cols[1].links).toHaveLength(8);
  });
  it('never adds extras for jobs/cv trees', () => {
    expect(buildMegaColumns(curated, kids, {'welding-metalwork':3}, {...opts, parentSlug:'jobs'})).toHaveLength(1);
  });
});
