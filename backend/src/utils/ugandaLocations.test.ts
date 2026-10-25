import { describe, it, expect } from 'vitest';
import {
  REGIONS, REGION_ORDER, ALL_DISTRICTS, expandLocationTerms, parseRegion, buildLocationDirectory, termsForDistrict,
} from './ugandaLocations';

describe('district table', () => {
  it('lists each district exactly once, across the four regions', () => {
    expect(REGION_ORDER).toEqual(['Central', 'Eastern', 'Northern', 'Western']);
    expect(new Set(ALL_DISTRICTS).size).toBe(ALL_DISTRICTS.length);
    for (const r of REGION_ORDER) expect(REGIONS[r].length).toBeGreaterThan(20);
  });
});

describe('expandLocationTerms', () => {
  it('matches a district by name and by its towns and neighbourhoods', () => {
    expect(expandLocationTerms('Wakiso')).toContain('entebbe');
    expect(expandLocationTerms('kampala')).toEqual(expect.arrayContaining(['kampala', 'ntinda']));
  });
  it('expands a region to all its districts', () => {
    const north = expandLocationTerms('Northern Region')!;
    expect(north).toEqual(expect.arrayContaining(['gulu', 'lira', 'arua']));
    expect(north).not.toContain('kampala');
    expect(parseRegion('northern')).toBe('Northern');
  });
  it('returns null for free text so callers keep their plain contains match', () => {
    expect(expandLocationTerms('Plot 4 Some Road')).toBeNull();
    expect(termsForDistrict('Atlantis')).toEqual([]);
  });
});

describe('buildLocationDirectory', () => {
  const rows = [
    { location: 'Ntinda, Kampala', count: 5 },
    { location: 'Kampala', count: 3 },
    { location: 'Entebbe', count: 2 },
    { location: 'Gulu City', count: 4 },
    { location: 'Somewhere unlisted', count: 1 },
  ];
  const dir = buildLocationDirectory(rows);

  it('only returns regions and districts that have listings, busiest first', () => {
    expect(dir.regions.map((r) => r.region)).toEqual(['Central', 'Northern']);
    expect(dir.regions[0].districts).toEqual([
      { name: 'Kampala', count: 8 },
      { name: 'Wakiso', count: 2 },
    ]);
    expect(dir.regions[1].districts).toEqual([{ name: 'Gulu', count: 4 }]);
  });
  it('counts unmatched rows in the grand total only', () => {
    expect(dir.total).toBe(15);
    expect(dir.regions[0].total).toBe(10);
  });
  it('returns an empty directory when nothing is listed', () => {
    expect(buildLocationDirectory([])).toEqual({ total: 0, regions: [] });
  });
});
