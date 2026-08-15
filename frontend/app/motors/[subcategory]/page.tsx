'use client';

import { useEffect, useState, Suspense, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ListingCard } from '@/components/listings/ListingCard';
import { Listing } from '@/lib/types';
import { useCountry } from '@/context/CountryContext';
import { getCountryPriceRanges } from '@/lib/utils';
import { useActiveSubcategoryCounts } from '@/hooks/useActiveSubcategoryCounts';

const MOTOR_SUBCATEGORIES: Record<string, { label: string; icon: string; color: string }> = {
  'used-cars': { label: 'Used Cars', icon: '🚙', color: 'from-blue-600 to-indigo-700' },
  'new-cars': { label: 'New Cars', icon: '🏎️', color: 'from-emerald-600 to-teal-700' },
  'classic-cars': { label: 'Classic Cars', icon: '🚕', color: 'from-amber-600 to-orange-700' },
  'motorcycles': { label: 'Motorcycles', icon: '🏍️', color: 'from-red-600 to-rose-700' },
  'trucks-buses': { label: 'Trucks & Buses', icon: '🚛', color: 'from-slate-600 to-gray-800' },
  'boats': { label: 'Boats', icon: '⛵', color: 'from-cyan-600 to-sky-700' },
  'other-vehicles': { label: 'Other Vehicles', icon: '🚐', color: 'from-violet-600 to-purple-700' },
  'parts-accessories': { label: 'Parts & Accessories', icon: '🔩', color: 'from-orange-600 to-red-700' },
  'car-parts': { label: 'Car Parts', icon: '⚙️', color: 'from-zinc-600 to-slate-700' },
  'tyres-wheels': { label: 'Tyres & Wheels', icon: '🛞', color: 'from-stone-600 to-neutral-800' },
  'car-accessories': { label: 'Car Accessories', icon: '🪄', color: 'from-fuchsia-600 to-pink-700' },
};

const MAKES = ['Any Make', 'Toyota', 'Honda', 'Nissan', 'BMW', 'Mercedes', 'Audi', 'Ford', 'Hyundai', 'Kia', 'Volkswagen', 'Other'];

const MAKE_CARDS = [
  { name: 'Toyota', icon: '🚙', color: 'from-red-600 to-red-800' },
  { name: 'Honda', icon: '🚗', color: 'from-red-500 to-rose-700' },
  { name: 'Nissan', icon: '🚗', color: 'from-gray-700 to-gray-900' },
  { name: 'BMW', icon: '🚘', color: 'from-blue-700 to-blue-900' },
  { name: 'Mercedes', icon: '🚘', color: 'from-slate-600 to-slate-800' },
  { name: 'Audi', icon: '🚘', color: 'from-gray-800 to-black' },
  { name: 'Ford', icon: '🚗', color: 'from-blue-600 to-blue-800' },
  { name: 'Hyundai', icon: '🚗', color: 'from-sky-600 to-blue-800' },
  { name: 'Kia', icon: '🚗', color: 'from-red-600 to-red-900' },
  { name: 'Volkswagen', icon: '🚗', color: 'from-blue-500 to-indigo-700' },
];

function MotorsSubcategoryContent() {
  const params = useParams<{ subcategory: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { country } = useCountry();
  // useMemo so the array reference is stable — an inline array in useEffect deps
  // causes a new reference every render → infinite fetch loop.
  const PRICE_RANGES = useMemo(() => getCountryPriceRanges(country), [country]);
  const subcategory = params?.subcategory || 'used-cars';
  const meta = MOTOR_SUBCATEGORIES[subcategory] || { label: subcategory, icon: '🚗', color: 'from-gray-600 to-gray-800' };

  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const controllerRef = useRef<AbortController | null>(null);

  // Hide empty sibling subcategories from the "Other Categories" nav below
  // until they have ACTIVE listings in this country. Falls back to showing
  // all of them if the counts request fails or hasn't resolved yet.
  const { counts: subcategoryCounts } = useActiveSubcategoryCounts(country);
  const otherSubcategories = Object.entries(MOTOR_SUBCATEGORIES)
    .filter(([slug]) => slug !== subcategory)
    .filter(([slug]) => !subcategoryCounts || (subcategoryCounts[slug] ?? 0) > 0);

  const currentPage = parseInt(searchParams?.get('page') || '1');
  const sortBy = searchParams?.get('sort') || 'recommended';
  const make = searchParams?.get('make') || '';
  const priceRange = searchParams?.get('priceRange') || '';

  const fetchListings = useCallback(() => {
    if (controllerRef.current) controllerRef.current.abort();
    const ctrl = new AbortController();
    controllerRef.current = ctrl;

    setLoading(true);
    const qParams = new URLSearchParams();
    // Use the subcategory slug directly — backend buildCategoryFilter checks both
    // the category slug and its parent's slug, so 'used-cars' resolves correctly.
    qParams.set('category', subcategory);
    qParams.set('page', String(currentPage));
    qParams.set('sort', sortBy);
    qParams.set('limit', '18');
    if (country) qParams.set('country', country);
    if (make) qParams.set('q', make);
    const pRange = PRICE_RANGES.find((r) => r.label === priceRange);
    if (pRange) {
      if (pRange.min) qParams.set('priceMin', pRange.min);
      if (pRange.max) qParams.set('priceMax', pRange.max);
    }

    api.get(`/listings?${qParams.toString()}`, { signal: ctrl.signal })
      .then(({ data }) => {
        setListings(data.listings || []);
        setTotal(data.pagination?.total || 0);
        setPages(data.pagination?.pages || 1);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === 'CanceledError' || err?.name === 'AbortError') return;
        setListings([]);
        setLoading(false);
      });
  }, [subcategory, currentPage, sortBy, make, priceRange, country, PRICE_RANGES]);

  useEffect(() => {
    fetchListings();
    return () => { controllerRef.current?.abort(); };
  }, [fetchListings]);

  useEffect(() => () => { controllerRef.current?.abort(); }, []);

  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams?.toString() || '');
    if (value) p.set(key, value); else p.delete(key);
    p.set('page', '1');
    router.push(`/motors/${subcategory}?${p.toString()}`);
  };

  return (
    <div className="min-h-screen bg-gray-50/90">
      {/* Header */}
      <div className={`relative overflow-hidden bg-gradient-to-br ${meta.color} text-white py-8 sm:py-12`}>
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_30%_50%,white_0%,transparent_60%)]" />
        <div className="relative max-w-7xl mx-auto px-4">
          <nav className="flex items-center gap-2 text-xs text-white/70 mb-3">
            <Link href="/" className="hover:text-white">Home</Link>
            <span>/</span>
            <Link href="/motors" className="hover:text-white">Motors</Link>
            <span>/</span>
            <span className="text-white font-semibold">{meta.label}</span>
          </nav>
          <div className="flex items-center gap-4">
            <span className="text-4xl">{meta.icon}</span>
            <div>
              <h1 className="text-2xl sm:text-4xl font-black">{meta.label}</h1>
              <p className="text-white/80 text-sm mt-1">
                {total > 0 ? `${total.toLocaleString('en-US')} listing${total !== 1 ? 's' : ''} available` : 'Browse available listings'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Make brand cards (only for car subcategories) */}
        {['used-cars', 'new-cars', 'classic-cars'].includes(subcategory) && (
          <div className="mb-6">
            <h2 className="text-sm font-bold text-gray-700 mb-3">Filter by Make</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => updateParam('make', '')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${!make ? 'bg-sky-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:border-sky-200'}`}
              >
                🏷️ All Makes
              </button>
              {MAKE_CARDS.map((m) => (
                <button
                  key={m.name}
                  onClick={() => updateParam('make', m.name)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${make === m.name ? `bg-gradient-to-r ${m.color} text-white shadow-md` : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                >
                  <span>{m.icon}</span> {m.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filters bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600 whitespace-nowrap">Make:</label>
            <select
              value={make}
              onChange={(e) => updateParam('make', e.target.value === 'Any Make' ? '' : e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-sky-300 outline-none"
            >
              {MAKES.map((m) => <option key={m} value={m === 'Any Make' ? '' : m}>{m}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600 whitespace-nowrap">Price:</label>
            <select
              value={priceRange}
              onChange={(e) => updateParam('priceRange', e.target.value === 'Any Price' ? '' : e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-sky-300 outline-none"
            >
              {PRICE_RANGES.map((r) => <option key={r.label}>{r.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-xs font-semibold text-gray-600 whitespace-nowrap">Sort:</label>
            <select
              value={sortBy}
              onChange={(e) => updateParam('sort', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-sky-300 outline-none"
            >
              <option value="recommended">Recommended</option>
              <option value="createdAt">Newest</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="views">Most Popular</option>
            </select>
          </div>
          <Link
            href="/listings/create"
            className="ml-auto sm:ml-0 bg-amber-400 hover:bg-amber-300 text-black font-bold px-4 py-1.5 rounded-lg text-xs transition-colors"
          >
            + Post Ad
          </Link>
        </div>

        {/* Listings grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-gray-200" />
                <div className="p-2 space-y-1.5">
                  <div className="h-2.5 bg-gray-200 rounded w-3/4" />
                  <div className="h-2 bg-gray-100 rounded w-1/2" />
                  <div className="h-4 bg-gray-200 rounded w-1/3 mt-1" />
                </div>
              </div>
            ))}
          </div>
        ) : listings.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
            {/* Pagination */}
            {pages > 1 && (
              <div className="mt-8 flex justify-center gap-2">
                {Array.from({ length: pages }, (_, i) => i + 1).map((pg) => (
                  <button
                    key={pg}
                    onClick={() => updateParam('page', String(pg))}
                    className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${currentPage === pg ? 'bg-sky-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-sky-50'}`}
                  >
                    {pg}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-16 text-center">
            <div className="text-6xl mb-4">{meta.icon}</div>
            <p className="text-xl font-bold text-gray-700 mb-2">No {meta.label} listed yet</p>
            <p className="text-sm text-gray-400 mb-6">Be the first to post a {meta.label.toLowerCase()} listing!</p>
            <Link
              href="/listings/create"
              className="inline-block bg-sky-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-sky-700 transition-colors"
            >
              Post {meta.label} Ad
            </Link>
          </div>
        )}
      </div>

      {/* Other subcategory nav */}
      {otherSubcategories.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pb-10">
          <h2 className="text-lg font-bold text-gray-800 mb-3">Other Categories</h2>
          <div className="flex flex-wrap gap-2">
            {otherSubcategories.map(([slug, s]) => (
              <Link
                key={slug}
                href={`/motors/${slug}`}
                className="inline-flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
              >
                <span>{s.icon}</span> {s.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MotorsSubcategoryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50/90 flex items-center justify-center">
        <div className="text-gray-500">Loading…</div>
      </div>
    }>
      <MotorsSubcategoryContent />
    </Suspense>
  );
}