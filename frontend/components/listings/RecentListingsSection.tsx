'use client';

// RecentListingsSection — extracted from flash-sales/page.tsx so it can be
// imported by other pages (CountryLandingClient etc.) without violating the
// Next.js rule that page files must not export arbitrary named components.

import { useMemo, useState } from 'react';
import { Listing, Category } from '@/lib/types';
import { ListingCard } from '@/components/listings/ListingCard';
import { useCountry } from '@/context/CountryContext';
import { getCountryPriceRanges } from '@/lib/utils';

type SortKey = 'relevance'|'price_asc'|'price_desc'|'date_newest'|'date_oldest'|'views'|'saves';
type ConditionFilter = ''|'NEW'|'USED';
type StatusFilter    = ''|'ACTIVE'|'SOLD';

interface Filters {
  category: string; country: string; priceMin: string; priceMax: string;
  condition: ConditionFilter; status: StatusFilter;
  make: string; model: string; yearMin: string; yearMax: string; fuelType: string; transmission: string;
  propertyType: string; listingType: string; bedroomsMin: string; sizeSqftMin: string;
  employmentType: string; salaryMin: string; industry: string;
  experienceLevel: string; cvIndustry: string;
  brand: string; serviceCategory: string;
}

const EMPTY: Filters = {
  category: '', country: '', priceMin: '', priceMax: '', condition: '', status: '',
  make: '', model: '', yearMin: '', yearMax: '', fuelType: '', transmission: '',
  propertyType: '', listingType: '', bedroomsMin: '', sizeSqftMin: '',
  employmentType: '', salaryMin: '', industry: '', experienceLevel: '', cvIndustry: '',
  brand: '', serviceCategory: '',
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance',   label: '✨ Relevance'         },
  { value: 'price_asc',   label: '💰 Price: Low → High' },
  { value: 'price_desc',  label: '💰 Price: High → Low' },
  { value: 'date_newest', label: '🆕 Newest First'      },
  { value: 'date_oldest', label: '📅 Oldest First'      },
  { value: 'views',       label: '👁️ Most Viewed'       },
  { value: 'saves',       label: '❤️ Most Saved'        },
];

const COUNTRY_LABELS: Record<string, string> = {
  '': 'All Countries', UGANDA: '🇺🇬 Uganda',
};
const FUEL_TYPES      = ['', 'Petrol', 'Diesel', 'Electric', 'Hybrid', 'LPG'];
const TRANSMISSIONS   = ['', 'Automatic', 'Manual', 'CVT', 'Semi-Auto'];
const PROPERTY_TYPES  = ['', 'Apartment', 'House', 'Villa', 'Office', 'Land', 'Warehouse'];
const LISTING_TYPES   = ['', 'For Sale', 'For Rent', 'Short Stay'];
const EMP_TYPES       = ['', 'Full-Time', 'Part-Time', 'Contract', 'Internship', 'Remote', 'Freelance'];
const INDUSTRIES      = ['', 'Technology', 'Healthcare', 'Finance', 'Education', 'Construction', 'Retail', 'Hospitality', 'Transport', 'Other'];
const EXP_LEVELS      = ['', 'Entry Level', 'Mid Level', 'Senior', 'Director', 'Executive'];
const SERVICE_CATS    = ['', 'Home Services', 'Tech & IT', 'Beauty', 'Tutoring', 'Events', 'Cleaning', 'Legal', 'Medical', 'Other'];

function applySort(arr: Listing[], sort: SortKey): Listing[] {
  const a = [...arr];
  switch (sort) {
    case 'price_asc':   return a.sort((x, y) => x.price - y.price);
    case 'price_desc':  return a.sort((x, y) => y.price - x.price);
    case 'date_newest': return a.sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
    case 'date_oldest': return a.sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());
    case 'views': case 'saves': return a.sort((x, y) => (y.views || 0) - (x.views || 0));
    default: return a;
  }
}

function applyFilters(arr: Listing[], f: Filters): Listing[] {
  return arr.filter((l) => {
    const cat = l.category as Category & { parent?: Category };
    if (f.category && !cat?.slug?.includes(f.category) && !cat?.parent?.slug?.includes(f.category)) return false;
    if (f.country && l.country !== f.country) return false;
    if (f.priceMin && l.price < Number(f.priceMin)) return false;
    if (f.priceMax && l.price > Number(f.priceMax)) return false;
    if (f.condition && l.condition !== f.condition) return false;
    if (f.status === 'SOLD' && l.status !== 'SOLD') return false;
    if (f.status === 'ACTIVE' && l.status === 'SOLD') return false;
    if (f.make && !l.motorDetails?.make?.toLowerCase().includes(f.make.toLowerCase())) return false;
    if (f.model && !l.motorDetails?.model?.toLowerCase().includes(f.model.toLowerCase())) return false;
    if (f.yearMin && l.motorDetails?.year && Number(l.motorDetails.year) < Number(f.yearMin)) return false;
    if (f.yearMax && l.motorDetails?.year && Number(l.motorDetails.year) > Number(f.yearMax)) return false;
    if (f.fuelType && l.motorDetails?.fuelType !== f.fuelType) return false;
    if (f.transmission && l.motorDetails?.transmission !== f.transmission) return false;
    if (f.propertyType && l.propertyDetails?.propertyType !== f.propertyType) return false;
    if (f.listingType && l.propertyDetails?.listingType !== f.listingType) return false;
    if (f.bedroomsMin && l.propertyDetails?.bedrooms && Number(l.propertyDetails.bedrooms) < Number(f.bedroomsMin)) return false;
    if (f.sizeSqftMin && l.propertyDetails?.sizeSqft && Number(l.propertyDetails.sizeSqft) < Number(f.sizeSqftMin)) return false;
    if (f.employmentType && l.jobDetails?.employmentType !== f.employmentType) return false;
    if (f.salaryMin && l.jobDetails?.salaryMin && Number(l.jobDetails.salaryMin) < Number(f.salaryMin)) return false;
    if (f.industry && l.jobDetails?.industry !== f.industry) return false;
    if (f.experienceLevel && l.jobDetails?.experienceLevel !== f.experienceLevel) return false;
    if (f.brand && !l.title.toLowerCase().includes(f.brand.toLowerCase())) return false;
    if (f.serviceCategory && !l.description?.toLowerCase().includes(f.serviceCategory.toLowerCase())) return false;
    return true;
  });
}

// FilterPanel is used inside RecentListingsSection
export function FilterPanel({ filters, setFilters, country, onReset }: {
  filters: Filters; setFilters: (f: Filters) => void; country: string; onReset: () => void;
}) {
  const S = (k: keyof Filters) => (v: string) => setFilters({ ...filters, [k]: v });
  const pr = getCountryPriceRanges(country || 'UGANDA');
  const cat = filters.category;
  const all = !cat;

  const Sel = ({ k, opts, labels }: { k: keyof Filters; opts: string[]; labels?: Record<string, string> }) => (
    <select value={filters[k]} onChange={(e) => S(k)(e.target.value)}
      className="w-full text-xs rounded-lg border border-gray-200 bg-white px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400 text-gray-700">
      {opts.map((o) => <option key={o} value={o}>{labels?.[o] ?? (o || 'Any')}</option>)}
    </select>
  );
  const Inp = ({ k, ph, type = 'text' }: { k: keyof Filters; ph: string; type?: string }) => (
    <input type={type} placeholder={ph} value={filters[k]}
      onChange={(e) => S(k)(e.target.value)}
      className="w-full text-xs rounded-lg border border-gray-200 bg-white px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400 text-gray-700" />
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-black text-gray-900 text-sm">Filters</span>
        <button onClick={onReset} className="text-orange-500 hover:text-orange-700 font-semibold text-[10px]">Reset All</button>
      </div>
      <div>
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Country / Region</p>
        <Sel k="country" opts={Object.keys(COUNTRY_LABELS)} labels={COUNTRY_LABELS} />
      </div>
      <div>
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Price Range</p>
        <select value="" onChange={(e) => {
          const r = pr.find((p) => p.label === e.target.value);
          if (r) setFilters({ ...filters, priceMin: r.min, priceMax: r.max });
        }} className="w-full text-xs rounded-lg border border-gray-200 bg-white px-2.5 py-2 mb-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400 text-gray-700">
          <option value="">Quick range…</option>
          {pr.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
        </select>
        <div className="flex gap-1.5">
          <Inp k="priceMin" ph="Min" type="number" />
          <Inp k="priceMax" ph="Max" type="number" />
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Condition</p>
        <div className="flex gap-1.5">
          {(['', 'NEW', 'USED'] as ConditionFilter[]).map((c) => (
            <button key={c} onClick={() => S('condition')(c)}
              className={`flex-1 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${filters.condition === c ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'}`}>
              {c || 'Any'}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Status</p>
        <div className="flex gap-1.5">
          {([['', 'All'], ['ACTIVE', 'Open'], ['SOLD', 'Sold']] as [StatusFilter, string][]).map(([v, l]) => (
            <button key={v} onClick={() => S('status')(v)}
              className={`flex-1 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors ${filters.status === v ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {(all || cat === 'motors') && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">🚗 Motors</p>
          <Inp k="make" ph="Make (e.g. Toyota)" />
          <Inp k="model" ph="Model (e.g. Corolla)" />
          <div className="flex gap-1.5"><Inp k="yearMin" ph="From year" type="number" /><Inp k="yearMax" ph="To year" type="number" /></div>
          <Sel k="fuelType" opts={FUEL_TYPES} />
          <Sel k="transmission" opts={TRANSMISSIONS} />
        </div>
      )}
      {(all || cat === 'property') && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">🏠 Property</p>
          <Sel k="propertyType" opts={PROPERTY_TYPES} />
          <Sel k="listingType" opts={LISTING_TYPES} />
          <Inp k="bedroomsMin" ph="Min bedrooms" type="number" />
          <Inp k="sizeSqftMin" ph="Min size (sqft)" type="number" />
        </div>
      )}
      {(all || cat === 'jobs') && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">💼 Jobs</p>
          <Sel k="employmentType" opts={EMP_TYPES} />
          <Sel k="industry" opts={INDUSTRIES} />
          <Inp k="salaryMin" ph="Min salary" type="number" />
        </div>
      )}
      {(all || cat === 'cv') && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">📄 CV</p>
          <Sel k="experienceLevel" opts={EXP_LEVELS} />
          <Sel k="cvIndustry" opts={INDUSTRIES} />
        </div>
      )}
      {(all || cat === 'electronics' || cat === 'fashion') && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">💻 Brand</p>
          <Inp k="brand" ph="Brand (e.g. Samsung)" />
        </div>
      )}
      {(all || cat === 'services') && (
        <div className="space-y-2 pt-2 border-t border-gray-100">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">🔧 Services</p>
          <Sel k="serviceCategory" opts={SERVICE_CATS} />
        </div>
      )}
    </div>
  );
}

// ── RecentListingsSection ────────────────────────────────────────────────────
// Exported as a named export from this dedicated component file (not from a
// Next.js page file) so it can be imported anywhere without build errors.
export function RecentListingsSection({
  listings,
  title = 'Recent Listings',
  categorySlug = '',
  gridClassName = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3',
}: {
  listings: Listing[];
  title?: string;
  categorySlug?: string;
  /** Override the card grid classes (defaults to the original 6-column layout). */
  gridClassName?: string;
}) {
  const { country } = useCountry();
  const [sort, setSort] = useState<SortKey>('date_newest');
  const [filters, setFilters] = useState<Filters>({ ...EMPTY, category: categorySlug });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');

  const activeFilterCount = useMemo(() =>
    Object.entries(filters).filter(([k, v]) => v !== '' && k !== 'category').length, [filters]);

  const displayed = useMemo(() => {
    let pool = [...listings];
    if (searchQ.trim()) pool = pool.filter((l) => l.title.toLowerCase().includes(searchQ.toLowerCase()));
    pool = applyFilters(pool, filters);
    return applySort(pool, sort).slice(0, 12);
  }, [listings, searchQ, filters, sort]);

  return (
    <div>
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <h2 className="text-base font-bold text-gray-800 flex items-center gap-2 flex-1">
          🕐 {title}
        </h2>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            className="text-xs rounded-lg border border-gray-200 bg-white px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400 w-36"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="text-xs rounded-lg border border-gray-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400 text-gray-700"
          >
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            onClick={() => setFiltersOpen((p) => !p)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${filtersOpen ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-400'}`}
          >
            🎛️
            {activeFilterCount > 0 && (
              <span className={`text-[9px] font-black px-1 rounded-full ${filtersOpen ? 'bg-white text-orange-600' : 'bg-orange-500 text-white'}`}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="mb-3">
          <FilterPanel
            filters={filters}
            setFilters={setFilters}
            country={country}
            onReset={() => setFilters({ ...EMPTY, category: categorySlug })}
          />
        </div>
      )}

      {displayed.length > 0 ? (
        <div className={gridClassName}>
          {displayed.map((l) => <ListingCard key={l.id} listing={l} />)}
        </div>
      ) : (
        <p className="text-sm text-gray-400 py-4 text-center">No listings match your current filters.</p>
      )}
    </div>
  );
}
