/**
 * ugandaLocations.ts — Uganda's four regions, their districts, and the town/neighbourhood names
 * sellers actually type, so the location picker and the listing filter agree exactly.
 *
 * Listing.location is free text ("Ntinda, Kampala", "Gulu City"), so a listing belongs to a district
 * when its text contains the district name or one of that district's aliases (case-insensitive).
 * The SAME predicate drives both the per-district counts and the `location=` filter, so the number
 * shown next to a district is the number of listings the filter returns.
 *
 * The district count is changing (the government keeps creating districts), so this is one plain
 * table: add a district here and it appears in the picker as soon as a listing mentions it.
 */

export type UgandaRegion = 'Central' | 'Eastern' | 'Northern' | 'Western';

export const REGION_ORDER: UgandaRegion[] = ['Central', 'Eastern', 'Northern', 'Western'];

export const REGION_SUFFIX = ' Region';

export const REGIONS: Record<UgandaRegion, string[]> = {
  Central: [
    'Buikwe', 'Bukomansimbi', 'Butambala', 'Buvuma', 'Gomba', 'Kalangala', 'Kalungu', 'Kampala',
    'Kassanda', 'Kayunga', 'Kiboga', 'Kyankwanzi', 'Kyotera', 'Luweero', 'Lwengo', 'Lyantonde',
    'Masaka', 'Mityana', 'Mpigi', 'Mubende', 'Mukono', 'Nakaseke', 'Nakasongola', 'Rakai',
    'Sembabule', 'Wakiso',
  ],
  Eastern: [
    'Amuria', 'Budaka', 'Bududa', 'Bugiri', 'Bugweri', 'Bukedea', 'Bukwa', 'Bukwo', 'Bulambuli',
    'Busia', 'Butaleja', 'Butebo', 'Buyende', 'Iganga', 'Jinja', 'Kaberamaido', 'Kalaki', 'Kaliro',
    'Kamuli', 'Kapchorwa', 'Kapelebyong', 'Katakwi', 'Kibuku', 'Kumi', 'Kween', 'Luuka', 'Manafwa',
    'Mayuge', 'Mbale', 'Namayingo', 'Namisindwa', 'Namutumba', 'Ngora', 'Pallisa', 'Serere',
    'Sironko', 'Soroti', 'Tororo',
  ],
  Northern: [
    'Abim', 'Adjumani', 'Agago', 'Alebtong', 'Amolatar', 'Amudat', 'Amuru', 'Apac', 'Arua',
    'Dokolo', 'Gulu', 'Kaabong', 'Karenga', 'Kitgum', 'Koboko', 'Kole', 'Kotido', 'Kwania', 'Lamwo',
    'Lira', 'Madi-Okollo', 'Maracha', 'Moroto', 'Moyo', 'Nabilatuk', 'Nakapiripirit', 'Napak',
    'Nebbi', 'Nwoya', 'Obongi', 'Omoro', 'Otuke', 'Oyam', 'Pader', 'Pakwach', 'Terego', 'Yumbe',
    'Zombo',
  ],
  Western: [
    'Buhweju', 'Buliisa', 'Bundibugyo', 'Bunyangabu', 'Bushenyi', 'Hoima', 'Ibanda', 'Isingiro',
    'Kabale', 'Kabarole', 'Kagadi', 'Kakumiro', 'Kamwenge', 'Kanungu', 'Kasese', 'Kazo', 'Kibaale',
    'Kikuube', 'Kiruhura', 'Kiryandongo', 'Kisoro', 'Kitagwenda', 'Kyegegwa', 'Kyenjojo', 'Masindi',
    'Mbarara', 'Mitooma', 'Ntoroko', 'Ntungamo', 'Rubanda', 'Rubirizi', 'Rukiga', 'Rukungiri',
    'Rwampara', 'Sheema',
  ],
};

/**
 * Other names that mean a district: alternative spellings, municipalities/cities, and the
 * neighbourhoods people put in the location box. Kept short and conservative — a short alias that
 * is a substring of unrelated words would pull in wrong listings.
 */
export const ALIASES: Record<string, string[]> = {
  Kampala: ['Nakawa', 'Makindye', 'Kawempe', 'Rubaga', 'Ntinda', 'Kololo', 'Bugolobi', 'Muyenga', 'Kansanga', 'Nakasero', 'Naguru', 'Bukoto', 'Lugogo', 'Luzira', 'Munyonyo'],
  Wakiso: ['Entebbe', 'Kajjansi', 'Nansana', 'Namugongo', 'Najjera', 'Kasangati', 'Gayaza', 'Busabala', 'Nsangi', 'Lubowa', 'Abayita Ababiri'],
  Buikwe: ['Lugazi', 'Njeru'],
  Kabarole: ['Fort Portal'],
  Kassanda: ['Kasanda'],
  Luweero: ['Luwero'],
  Sembabule: ['Ssembabule'],
  Buliisa: ['Bulisa'],
  Kyankwanzi: ['Kiankwanzi'],
};

const REGION_OF = new Map<string, UgandaRegion>();
for (const region of REGION_ORDER) for (const d of REGIONS[region]) REGION_OF.set(d.toLowerCase(), region);

export const ALL_DISTRICTS: string[] = REGION_ORDER.flatMap((r) => REGIONS[r]);

/** Lower-case search terms for one district: its name plus its aliases. */
export function termsForDistrict(district: string): string[] {
  const key = [...REGION_OF.keys()].find((k) => k === district.trim().toLowerCase());
  if (!key) return [];
  const canonical = ALL_DISTRICTS.find((d) => d.toLowerCase() === key)!;
  return [canonical, ...(ALIASES[canonical] ?? [])].map((t) => t.toLowerCase());
}

/** "Northern Region" / "northern" → 'Northern'. */
export function parseRegion(value: string): UgandaRegion | null {
  const v = value.trim().toLowerCase().replace(/\s*region$/, '');
  return REGION_ORDER.find((r) => r.toLowerCase() === v) ?? null;
}

/**
 * Terms the `location=` filter should match (any of them, case-insensitive substring), or null when
 * `value` is not a known district/region — then the caller keeps its plain "contains" behaviour, so
 * free-text locations typed by hand still work.
 */
export function expandLocationTerms(value: string): string[] | null {
  const region = parseRegion(value);
  if (region) return [...new Set(REGIONS[region].flatMap((d) => termsForDistrict(d)))];
  const terms = termsForDistrict(value);
  return terms.length ? terms : null;
}

export interface LocationRow { location: string; count: number }

export interface DistrictCount { name: string; count: number }
export interface RegionCount { region: UgandaRegion; label: string; total: number; districts: DistrictCount[] }
export interface LocationDirectory { total: number; regions: RegionCount[] }

/**
 * Pure: turn "location text → number of listings" rows into per-region, per-district counts.
 * Only districts that have at least one listing are returned, busiest first within each region; a
 * region with no listings is omitted. A listing that names two districts counts for both (exactly
 * what the filter returns for each). `total` counts every row, matched or not.
 */
export function buildLocationDirectory(rows: LocationRow[]): LocationDirectory {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const lowered = rows.map((r) => ({ text: (r.location || '').toLowerCase(), count: r.count }));
  const regions: RegionCount[] = [];

  for (const region of REGION_ORDER) {
    const districts: DistrictCount[] = [];
    let regionTotal = 0;
    for (const name of REGIONS[region]) {
      const terms = termsForDistrict(name);
      const count = lowered.reduce((s, r) => (terms.some((t) => r.text.includes(t)) ? s + r.count : s), 0);
      if (count > 0) districts.push({ name, count });
    }
    // Region total = listings matching ANY of its districts (not the sum, which double-counts).
    const regionTerms = expandLocationTerms(region)!;
    regionTotal = lowered.reduce((s, r) => (regionTerms.some((t) => r.text.includes(t)) ? s + r.count : s), 0);
    if (districts.length === 0) continue;
    districts.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    regions.push({ region, label: `${region}${REGION_SUFFIX}`, total: regionTotal, districts });
  }
  return { total, regions };
}
