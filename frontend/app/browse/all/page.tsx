'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useCountry } from '@/context/CountryContext';
import { countryLabel } from '@/lib/utils';
import { api } from '@/lib/api';
import { ListingCard } from '@/components/listings/ListingCard';
import { RecentListingsSection } from '@/components/listings/RecentListingsSection'; 
import { Listing, Category } from '@/lib/types';
import Link from 'next/link';
import { useCategoryCounts } from '@/hooks/useCategoryCounts';
import { isBuyerVisible } from '@/lib/categoryVisibility';

type SortOption = 'recommended' | 'createdAt' | 'price_asc' | 'price_desc';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'recommended', label: 'For You' },
  { value: 'createdAt', label: 'Newest First' },
  { value: 'price_asc', label: 'Price: Low → High' },
  { value: 'price_desc', label: 'Price: High → Low' },
];

const PRICE_PRESETS = [
  { label: 'Under 65K', min: '', max: '65000' },
  { label: '65K – 270K', min: '65000', max: '270000' },
  { label: '270K – 1M', min: '270000', max: '1000000' },
  { label: 'Over 1M', min: '1000000', max: '' },
];

export default function BrowseAllPage() {
  const { country, locations } = useCountry();
  const { counts: rollupCounts } = useCategoryCounts(country);
  const [listings, setListings] = useState<Listing[]>([]);
  const [recentListings, setRecentListings] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [recentLoading, setRecentLoading] = useState(false);
  const [sort, setSort] = useState<SortOption>('recommended');
  const [activeCategorySlug, setActiveCategorySlug] = useState('');
  const [activeCategoryName, setActiveCategoryName] = useState('All');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const recentFetchedRef = useRef<string>('');

  // Search
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');

  // Filters
  const [location, setLocation] = useState('');
  const [condition, setCondition] = useState<'' | 'NEW' | 'USED'>('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);

  const activePricePreset = PRICE_PRESETS.find((p) => p.min === priceMin && p.max === priceMax);
  const activeFilterCount = [location, condition, priceMin || priceMax, verifiedOnly].filter(Boolean).length;

  const clearAllFilters = () => {
    setLocation('');
    setCondition('');
    setPriceMin('');
    setPriceMax('');
    setVerifiedOnly(false);
  };

  const LIMIT = 24;

  // Fetch top-level categories for tab nav
  useEffect(() => {
    api.get('/categories')
      .then(({ data }) => setCategories(data))
      .catch(() => {});
  }, []);

  // Close the filters popover on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const onClick = (e: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [filterOpen]);

  const fetchListings = useCallback(async (
    pg: number,
    categorySlug: string,
    sortBy: SortOption,
    query: string,
    loc: string,
    cond: '' | 'NEW' | 'USED',
    pMin: string,
    pMax: string,
    verified: boolean,
  ) => {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean> = {
        limit: LIMIT,
        page: pg,
        sort: sortBy,
        country,
      };
      if (categorySlug) params.category = categorySlug;
      if (query) params.q = query;
      if (loc) params.location = loc;
      if (cond) params.condition = cond;
      if (pMin) params.priceMin = pMin;
      if (pMax) params.priceMax = pMax;
      if (verified) params.verifiedOnly = true;

      const { data } = await api.get('/listings', { params });
      setListings(data.listings || []);
      setTotal(data.pagination?.total ?? 0);
      setPages(data.pagination?.pages ?? 1);
    } catch {
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [country]);

  // Fetch "Recent Listings" — random sample from the active tab/category
  const fetchRecentListings = useCallback(async (categorySlug: string) => {
    const key = `${country}-${categorySlug}`;
    if (recentFetchedRef.current === key) return;
    recentFetchedRef.current = key;
    setRecentLoading(true);
    try {
      const params: Record<string, string | number> = {
        limit: 12,
        page: 1,
        sort: 'createdAt',
        country,
      };
      if (categorySlug) params.category = categorySlug;
      const { data } = await api.get('/listings', { params });
      const pool: Listing[] = data.listings || [];
      // Shuffle for variety
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      setRecentListings(pool.slice(0, 6));
    } catch {
      setRecentListings([]);
    } finally {
      setRecentLoading(false);
    }
  }, [country]);

  useEffect(() => {
    setPage(1);
    fetchListings(1, activeCategorySlug, sort, q, location, condition, priceMin, priceMax, verifiedOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, activeCategorySlug, sort, q, location, condition, priceMin, priceMax, verifiedOnly, fetchListings]);

  // Fetch recent listings whenever tab or country changes
  useEffect(() => {
    recentFetchedRef.current = ''; // reset cache key so we re-fetch
    fetchRecentListings(activeCategorySlug);
  }, [country, activeCategorySlug, fetchRecentListings]);

  const handleCategoryChange = (slug: string, name: string) => {
    setActiveCategorySlug(slug);
    setActiveCategoryName(name);
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchListings(newPage, activeCategorySlug, sort, q, location, condition, priceMin, priceMax, verifiedOnly);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQ(searchInput.trim());
  };

  // Top-level categories only (no parent). Buyer surface: categories with no live listings are hidden
  // (the one currently selected always stays), so the ~20 newer categories don't show up empty.
  const topCategories = categories.filter(
    (c) => !c.parentId && (c.slug === activeCategorySlug || isBuyerVisible(c.slug, rollupCounts)),
  );

  const filterPanelContent = (
    <div className="space-y-4">
      <div>
        <h3 className="font-bold text-gray-800 text-xs uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <span aria-hidden="true">🛡️</span> Trust &amp; Safety
        </h3>
        <label className="flex items-center gap-2.5 cursor-pointer group">
          <div className="relative">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-200 peer-checked:bg-emerald-500 rounded-full transition-colors" />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
          </div>
          <span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">KYC Verified Sellers Only</span>
        </label>
      </div>

      <div>
        <h3 className="font-bold text-gray-800 text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <span aria-hidden="true">📍</span> Location
        </h3>
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="input-premium text-sm"
        >
          <option value="">All Locations</option>
          {locations.map((loc) => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>
      </div>

      <div>
        <h3 className="font-bold text-gray-800 text-xs uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <span aria-hidden="true">🏷️</span> Condition
        </h3>
        <div className="flex gap-2">
          {[
            { value: '' as const, label: 'Any' },
            { value: 'NEW' as const, label: '✨ New' },
            { value: 'USED' as const, label: '📦 Used' },
          ].map((c) => (
            <button
              key={c.value}
              onClick={() => setCondition(c.value)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all interactive border ${
                condition === c.value
                  ? 'bg-red-500 text-white border-red-500 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-red-200 hover:text-red-600'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-bold text-gray-800 text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <span aria-hidden="true">💰</span> Price Range
        </h3>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {PRICE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => { setPriceMin(preset.min); setPriceMax(preset.max); }}
              className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all interactive border ${
                activePricePreset?.label === preset.label
                  ? 'bg-red-500 text-white border-red-500 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-red-200 hover:text-red-600'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Min"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            className="input-premium text-sm flex-1 pl-2 pr-2"
          />
          <span className="flex items-center text-gray-300 font-medium">—</span>
          <input
            type="number"
            placeholder="Max"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            className="input-premium text-sm flex-1 pl-2 pr-2"
          />
        </div>
      </div>

      {activeFilterCount > 0 && (
        <button
          onClick={clearAllFilters}
          className="w-full text-sm text-gray-500 hover:text-red-500 transition-colors text-center py-2 border border-dashed border-gray-200 rounded-xl hover:border-red-200 interactive"
        >
          🗑️ Clear All Filters
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50/90">
      {/* Compact identity strip */}
      <div className="relative overflow-hidden bg-gradient-to-r from-premium-navy via-red-700 to-red-500 text-white">
        <div className="relative max-w-7xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center gap-3">
          <span className="text-xl sm:text-2xl shrink-0" aria-hidden="true">🌐</span>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm sm:text-lg font-extrabold leading-tight truncate">Browse Everything</h1>
            <p className="hidden sm:block text-white/70 text-xs leading-snug">
              Every category, filtered to {country} · {total.toLocaleString('en-US')} listings
            </p>
          </div>
          <Link
            href="/listings/create"
            className="shrink-0 bg-amber-400 hover:bg-amber-300 text-black font-bold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-colors text-xs sm:text-sm interactive"
          >
            + Post an Ad
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Search bar */}
        <form onSubmit={handleSearchSubmit} className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search all listings…"
              className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-3 py-2.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 transition-shadow"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors interactive shrink-0"
          >
            Search
          </button>
          {q && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setQ(''); }}
              className="px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs text-gray-500 hover:bg-gray-50 interactive shrink-0"
            >
              Clear
            </button>
          )}
        </form>

        {/* Active filter chips */}
        {(q || activeFilterCount > 0) && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {q && (
              <span className="inline-flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                🔍 &quot;{q}&quot;
                <button type="button" onClick={() => { setSearchInput(''); setQ(''); }} className="ml-0.5 hover:text-red-900 interactive" aria-label="Remove search filter">×</button>
              </span>
            )}
            {location && (
              <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-100 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                📍 {location}
                <button type="button" onClick={() => setLocation('')} className="ml-0.5 hover:text-amber-900 interactive" aria-label="Remove location filter">×</button>
              </span>
            )}
            {condition && (
              <span className="inline-flex items-center gap-1.5 bg-teal-50 border border-teal-100 text-teal-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                {condition === 'NEW' ? '✨ New' : '📦 Used'}
                <button type="button" onClick={() => setCondition('')} className="ml-0.5 hover:text-teal-900 interactive" aria-label="Remove condition filter">×</button>
              </span>
            )}
            {(priceMin || priceMax) && (
              <span className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-100 text-rose-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                💰 {priceMin || '0'} – {priceMax || '∞'}
                <button type="button" onClick={() => { setPriceMin(''); setPriceMax(''); }} className="ml-0.5 hover:text-rose-900 interactive" aria-label="Remove price filter">×</button>
              </span>
            )}
            {verifiedOnly && (
              <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                🪪 KYC Verified Only
                <button type="button" onClick={() => setVerifiedOnly(false)} className="ml-0.5 hover:text-emerald-900 interactive" aria-label="Remove verified filter">×</button>
              </span>
            )}
            {(q || activeFilterCount > 1) && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); setQ(''); clearAllFilters(); }}
                className="text-xs font-semibold text-gray-400 hover:text-red-500 transition-colors interactive underline underline-offset-2"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Sticky filter row */}
        <div className="sticky top-0 z-20 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 pb-3 mb-6 pt-2">
          {/* Category tabs */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 mb-3">
            <button
              onClick={() => handleCategoryChange('', 'All')}
              className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors interactive ${
                activeCategorySlug === ''
                  ? 'bg-red-600 text-white border-red-600 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-red-300 hover:text-red-700'
              }`}
            >
              🌐 All
            </button>
            {topCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategoryChange(cat.slug, cat.name)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors interactive ${
                  activeCategorySlug === cat.slug
                    ? 'bg-red-600 text-white border-red-600 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-red-300 hover:text-red-700'
                }`}
              >
                {cat.icon && <span>{cat.icon}</span>}
                {cat.name}
              </button>
            ))}
          </div>

          {/* Sort + Filters + results count */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-gray-500">
              {loading ? 'Loading…' : `${total.toLocaleString('en-US')} listing${total !== 1 ? 's' : ''} found`}
              {activeCategorySlug && (
                <span className="ml-1 text-gray-400">in <span className="font-semibold text-gray-600">{activeCategoryName}</span></span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-xs text-gray-500 font-medium">Sort:</span>
                <div className="flex gap-1">
                  {SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSort(opt.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors interactive ${
                        sort === opt.value
                          ? 'bg-red-600 text-white border-red-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Sort select — mobile only */}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="sm:hidden bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-red-300"
              >
                {SORT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>

              {/* Filters button — desktop popover / mobile drawer */}
              <div className="relative" ref={filterPanelRef}>
                <button
                  onClick={() => setFilterOpen((v) => !v)}
                  className="relative flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:border-red-300 transition-colors interactive"
                >
                  <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" /></svg>
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-red-600 text-white text-[9px] font-bold">
                      {activeFilterCount}
                    </span>
                  )}
                </button>

                {/* Desktop popover */}
                {filterOpen && (
                  <div className="hidden sm:block absolute right-0 top-full mt-2 w-72 bg-white border border-gray-100 rounded-xl shadow-xl z-30 p-4 animate-fade-in max-h-[70vh] overflow-y-auto">
                    {filterPanelContent}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile filters drawer */}
        {filterOpen && (
          <div className="sm:hidden">
            <div
              className="fixed inset-0 bg-black/50 z-40 animate-fade-in"
              onClick={() => setFilterOpen(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 right-0 w-80 max-w-[88vw] z-50 overflow-y-auto animate-slide-down bg-gray-50">
              <div className="min-h-full p-4">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-100">
                  <h2 className="font-extrabold text-gray-900 text-base">Filters</h2>
                  <button
                    onClick={() => setFilterOpen(false)}
                    className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors interactive"
                    aria-label="Close filters"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  {filterPanelContent}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Recent Listings section ─────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <span>🕐</span>
              Recent Listings
              {activeCategorySlug && (
                <span className="text-sm font-normal text-gray-500">in {activeCategoryName}</span>
              )}
            </h2>
          </div>
          {recentLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse">
                  <div className="aspect-[4/3] bg-gray-200" />
                  <div className="p-2 space-y-1.5">
                    <div className="h-2.5 bg-gray-200 rounded w-3/4" />
                    <div className="h-2 bg-gray-100 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentListings.length > 0 ? (
            <RecentListingsSection
              listings={recentListings}
              title={activeCategorySlug ? `Recent in ${activeCategoryName}` : 'Recent Listings'}
              categorySlug={activeCategorySlug}
              gridClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3"
            />
          ) : null}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">All Listings</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Listings grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-gray-200" />
                <div className="p-2 space-y-1.5">
                  <div className="h-2.5 bg-gray-200 rounded w-3/4" />
                  <div className="h-2 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : listings.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-16 text-center">
            <div className="text-5xl mb-3">🔍</div>
            <p className="font-bold text-gray-700 text-lg mb-1">No listings found</p>
            <p className="text-sm text-gray-400 mb-5">
              There are no listings for <strong>{countryLabel(country)}</strong>
              {activeCategorySlug ? ` in the selected category` : ''}.
            </p>
            <Link
              href="/listings/create"
              className="inline-block bg-red-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-red-700 transition-colors"
            >
              Be the first — Post an Ad
            </Link>
          </div>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-8">
            <button
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              ← Previous
            </button>
            <span className="px-4 py-2 text-sm text-gray-500">
              Page {page} of {pages}
            </span>
            <button
              disabled={page >= pages}
              onClick={() => handlePageChange(page + 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
