'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Listing, Category } from '@/lib/types';
import { ListingCard } from '@/components/listings/ListingCard';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { useCountry } from '@/context/CountryContext';
import { resolveImageUrl } from '@/lib/utils';
// import { getCountryPriceRanges } from '@/lib/utils';
import { FilterPanel } from '@/components/listings/RecentListingsSection'; // FilterPanel lives in shared component

// ── Types ──────────────────────────────────────────────────────────────────
interface Store {
  id: string; userId: string; name: string; slug: string;
  logo: string | null; rating: number; ratingCount: number; isActive: boolean;
  user: { id: string; name: string; avatar: string | null; role: string };
}

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

// ── Constants ───────────────────────────────────────────────────────────────
const CATEGORIES = [
  { slug: '',            icon: '⚡', label: 'All Flash Deals' },
  { slug: 'motors',      icon: '🚗', label: 'Motors'         },
  { slug: 'property',    icon: '🏠', label: 'Property'       },
  { slug: 'jobs',        icon: '💼', label: 'Jobs'           },
  { slug: 'cv',          icon: '📄', label: 'CV'             },
  { slug: 'classifieds', icon: '📋', label: 'Classifieds'    },
  { slug: 'electronics', icon: '💻', label: 'Electronics'    },
  { slug: 'fashion',     icon: '👗', label: 'Fashion'        },
  { slug: 'furniture',   icon: '🛋️', label: 'Furniture'      },
  { slug: 'services',    icon: '🔧', label: 'Services'       },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance',   label: '✨ Relevance'         },
  { value: 'price_asc',   label: '💰 Price: Low → High' },
  { value: 'price_desc',  label: '💰 Price: High → Low' },
  { value: 'date_newest', label: '🆕 Newest First'      },
  { value: 'date_oldest', label: '📅 Oldest First'      },
  { value: 'views',       label: '👁️ Most Viewed'       },
  { value: 'saves',       label: '❤️ Most Saved'        },
];

// const COUNTRY_LABELS: Record<string, string> = {
//   '': 'All Countries', UAE: '🇦🇪 UAE', UGANDA: '🇺🇬 Uganda', KENYA: '🇰🇪 Kenya', CHINA: '🇨🇳 China',
// };
// const FUEL_TYPES      = ['', 'Petrol', 'Diesel', 'Electric', 'Hybrid', 'LPG'];
// const TRANSMISSIONS   = ['', 'Automatic', 'Manual', 'CVT', 'Semi-Auto'];
// const PROPERTY_TYPES  = ['', 'Apartment', 'House', 'Villa', 'Office', 'Land', 'Warehouse'];
// const LISTING_TYPES   = ['', 'For Sale', 'For Rent', 'Short Stay'];
// const EMP_TYPES       = ['', 'Full-Time', 'Part-Time', 'Contract', 'Internship', 'Remote', 'Freelance'];
// const INDUSTRIES      = ['', 'Technology', 'Healthcare', 'Finance', 'Education', 'Construction', 'Retail', 'Hospitality', 'Transport', 'Other'];
// const EXP_LEVELS      = ['', 'Entry Level', 'Mid Level', 'Senior', 'Director', 'Executive'];
// const SERVICE_CATS    = ['', 'Home Services', 'Tech & IT', 'Beauty', 'Tutoring', 'Events', 'Cleaning', 'Legal', 'Medical', 'Other'];

const EMPTY: Filters = {
  category: '', country: '', priceMin: '', priceMax: '', condition: '', status: '',
  make: '', model: '', yearMin: '', yearMax: '', fuelType: '', transmission: '',
  propertyType: '', listingType: '', bedroomsMin: '', sizeSqftMin: '',
  employmentType: '', salaryMin: '', industry: '', experienceLevel: '', cvIndustry: '',
  brand: '', serviceCategory: '',
};

// ── Countdown ────────────────────────────────────────────────────────────────
function useCountdown(listings: Listing[]) {
  const expiryTime = useMemo(() => {
    const now = Date.now();
    const ts = listings
      .map((l) => l.placementExpiresAt ? new Date(l.placementExpiresAt).getTime() : NaN)
      .filter((v) => Number.isFinite(v) && v > now) as number[];
    if (ts.length) return Math.min(...ts);
    const eod = new Date(); eod.setHours(23,59,59,999); return eod.getTime();
  }, [listings]);
  const [t, setT] = useState({ hours: 0, minutes: 0, seconds: 0 });
  useEffect(() => {
    const calc = () => {
      const d = Math.max(0, expiryTime - Date.now());
      setT({ hours: Math.floor(d/3_600_000), minutes: Math.floor((d%3_600_000)/60_000), seconds: Math.floor((d%60_000)/1_000) });
    };
    calc(); const id = setInterval(calc, 1000); return () => clearInterval(id);
  }, [expiryTime]);
  return t;
}

function applySort(arr: Listing[], sort: SortKey): Listing[] {
  const a = [...arr];
  switch (sort) {
    case 'price_asc':   return a.sort((x,y) => x.price - y.price);
    case 'price_desc':  return a.sort((x,y) => y.price - x.price);
    case 'date_newest': return a.sort((x,y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
    case 'date_oldest': return a.sort((x,y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());
    case 'views': case 'saves': return a.sort((x,y) => (y.views||0) - (x.views||0));
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

// ── Main export ──────────────────────────────────────────────────────────────
export default function FlashSalesPage() {
  const { country } = useCountry();
  const [allListings, setAllListings] = useState<Listing[]>([]);
  const [allStores, setAllStores]     = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [loading, setLoading]         = useState(true);
  const [sort, setSort]               = useState<SortKey>('relevance');
  const [filters, setFilters]         = useState<Filters>({ ...EMPTY });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchQ, setSearchQ]         = useState('');

  useEffect(() => {
    api.get(`/listings/flash-sales?limit=200${country ? `&country=${country}` : ''}`)
      .then(({ data }) => setAllListings(data.listings || []))
      .catch(() => setAllListings([]))
      .finally(() => setLoading(false));
    api.get('/stores?limit=100')
      .then(({ data }) => setAllStores(data.stores || []))
      .catch(() => {});
  }, [country]);

  const { hours, minutes, seconds } = useCountdown(allListings);
  const pad = (n: number) => String(n).padStart(2, '0');

  const activeFilterCount = useMemo(() =>
    Object.entries(filters).filter(([, v]) => v !== '').length, [filters]);

  const displayed = useMemo(() => {
    let pool = [...allListings];
    if (selectedStore) pool = pool.filter((l) => l.user.id === selectedStore);
    if (searchQ.trim()) pool = pool.filter((l) =>
      l.title.toLowerCase().includes(searchQ.toLowerCase()) ||
      l.description?.toLowerCase().includes(searchQ.toLowerCase()));
    pool = applyFilters(pool, filters);
    return applySort(pool, sort);
  }, [allListings, selectedStore, searchQ, filters, sort]);

  const storesWithDeals = useMemo(() => {
    const ids = new Set(allListings.map((l) => l.user.id));
    return allStores.filter((s) => ids.has(s.userId));
  }, [allListings, allStores]);

  const resetFilters = useCallback(() => setFilters({ ...EMPTY }), []);

  return (
    <div className="min-h-screen bg-gray-50/90">
      {/* Hero */}
      <div className="relative overflow-hidden text-white py-8 sm:py-12"
        style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#db2777 40%,#ea580c 100%)' }}>
        <div className="absolute -top-8 -right-8 w-48 h-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 left-16 w-56 h-56 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="relative max-w-7xl mx-auto px-4">
          <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Flash Deals' }]} className="text-white/70 mb-4" />
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-4xl drop-shadow-lg">⚡</span>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-black leading-tight">Flash Deals</h1>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold text-orange-900 bg-gradient-to-r from-yellow-200 via-amber-400 to-yellow-200 animate-pulse">
                    🔥 LIMITED TIME
                  </span>
                </div>
                <p className="text-white/80 text-sm mt-0.5">
                  {loading ? 'Loading deals…' : `${allListings.length} flash deal${allListings.length !== 1 ? 's' : ''} across all categories`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto rounded-2xl border border-white/30 bg-white/15 px-4 py-2 text-sm font-bold backdrop-blur-sm tabular-nums shadow-inner">
              <span className="relative flex items-center justify-center w-2.5 h-2.5">
                <span className="absolute w-full h-full rounded-full bg-red-400 animate-ping opacity-60" />
                <span className="w-full h-full rounded-full bg-red-400" />
              </span>
              {pad(hours)}:{pad(minutes)}:{pad(seconds)}
              <span className="text-white/70 font-medium text-xs">remaining</span>
            </div>
          </div>

          {/* Category tab bar */}
          <div className="mt-5 flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.slug}
                onClick={() => setFilters((prev) => ({ ...prev, category: cat.slug }))}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-all ${
                  filters.category === cat.slug
                    ? 'bg-white text-purple-700 border-white shadow-md'
                    : 'bg-white/15 text-white border-white/25 hover:bg-white/25'
                }`}
              >
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Store strip */}
        {storesWithDeals.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-900">🏪 Shop by Web Store</h2>
              {selectedStore && (
                <button onClick={() => setSelectedStore(null)}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 px-2 py-1 rounded-full border border-red-200 hover:bg-red-50 transition-colors">
                  Clear
                </button>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {storesWithDeals.map((store) => {
                const cnt = allListings.filter((l) => l.user.id === store.userId).length;
                const sel = selectedStore === store.userId;
                return (
                  <button key={store.id} onClick={() => setSelectedStore(sel ? null : store.userId)}
                    className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${sel ? 'bg-purple-50 border-purple-400 ring-2 ring-purple-300 text-purple-800' : 'bg-white border-gray-200 text-gray-700 hover:border-purple-300 hover:bg-purple-50'}`}>
                    {store.logo
                      ? <Image src={resolveImageUrl(store.logo)} alt={store.name} width={20} height={20} className="w-5 h-5 rounded-md object-cover" />
                      : <span className="w-5 h-5 rounded-md bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center text-xs">🏢</span>}
                    {store.name}
                    <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full text-[10px] font-bold">{cnt}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Search + Sort + Filter toggle row */}
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input type="text" placeholder="Search flash deals…" value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400" />
            {searchQ && <button onClick={() => setSearchQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg">×</button>}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
            className="text-sm rounded-xl border border-gray-200 bg-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-400 text-gray-700 font-medium">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => setFiltersOpen((p) => !p)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all ${filtersOpen ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-700 border-gray-200 hover:border-orange-400 hover:text-orange-600'}`}>
            🎛️ Filters
            {activeFilterCount > 0 && (
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${filtersOpen ? 'bg-white text-orange-600' : 'bg-orange-500 text-white'}`}>{activeFilterCount}</span>
            )}
          </button>
        </div>

        {/* Result meta */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">
            <span className="font-bold text-gray-900">{displayed.length}</span> deal{displayed.length !== 1 ? 's' : ''}
            {filters.category && <span className="ml-1">in <span className="font-semibold text-gray-700">{CATEGORIES.find((c) => c.slug === filters.category)?.icon} {CATEGORIES.find((c) => c.slug === filters.category)?.label}</span></span>}
          </p>
          {activeFilterCount > 0 && <button onClick={resetFilters} className="text-xs text-orange-500 hover:text-orange-700 font-semibold">Clear all</button>}
        </div>

        {/* Sidebar + grid */}
        <div className="flex gap-5 items-start">
          {filtersOpen && (
            <div className="shrink-0 w-60 sticky top-4">
              <FilterPanel filters={filters} setFilters={setFilters} country={country} onReset={resetFilters} />
            </div>
          )}

          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse">
                    <div className="aspect-[4/3] bg-gray-200" />
                    <div className="p-2.5 space-y-2"><div className="h-3 bg-gray-200 rounded w-3/4" /><div className="h-4 bg-gray-200 rounded w-1/2" /></div>
                  </div>
                ))}
              </div>
            ) : displayed.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {displayed.map((l) => <ListingCard key={l.id} listing={l} />)}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-16 text-center">
                <span className="text-5xl mb-4 block">⚡</span>
                <h2 className="text-lg font-bold text-gray-800 mb-1">No matching deals</h2>
                <p className="text-sm text-gray-400 mb-5">
                  {activeFilterCount > 0 ? 'Try adjusting your filters.' : 'Check back soon — new deals drop every day.'}
                </p>
                <div className="flex gap-2 justify-center flex-wrap">
                  {activeFilterCount > 0 && <button onClick={resetFilters} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl">Clear Filters</button>}
                  <Link href="/listings" className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl">Browse All</Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Post CTA */}
        {!loading && (
          <div className="mt-10 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-gray-900">Have a flash deal to offer?</h3>
              <p className="text-sm text-gray-500 mt-0.5">Post a listing and mark it as a flash deal to appear here.</p>
            </div>
            <Link href="/listings/create" className="shrink-0 bg-amber-400 hover:bg-amber-300 text-black font-bold px-6 py-3 rounded-xl text-sm shadow-sm">
              + Post Flash Deal
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
