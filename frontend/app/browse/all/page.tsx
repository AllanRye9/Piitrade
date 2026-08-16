'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useCountry } from '@/context/CountryContext';
import { api } from '@/lib/api';
import { ListingCard } from '@/components/listings/ListingCard';
import { RecentListingsSection } from '@/components/listings/RecentListingsSection'; 
import { Listing, Category } from '@/lib/types';
import Link from 'next/link';

type SortOption = 'recommended' | 'createdAt' | 'price_asc' | 'price_desc';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'recommended', label: 'For You' },
  { value: 'createdAt', label: 'Newest First' },
  { value: 'price_asc', label: 'Price: Low → High' },
  { value: 'price_desc', label: 'Price: High → Low' },
];

export default function BrowseAllPage() {
  const { country } = useCountry();
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

  const LIMIT = 24;

  // Fetch top-level categories for tab nav
  useEffect(() => {
    api.get('/categories')
      .then(({ data }) => setCategories(data))
      .catch(() => {});
  }, []);

  const fetchListings = useCallback(async (pg: number, categorySlug: string, sortBy: SortOption) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        limit: LIMIT,
        page: pg,
        sort: sortBy,
        country,
      };
      if (categorySlug) params.category = categorySlug;

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
    fetchListings(1, activeCategorySlug, sort);
  }, [country, activeCategorySlug, sort, fetchListings]);

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
    fetchListings(newPage, activeCategorySlug, sort);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Top-level categories only (no parent)
  const topCategories = categories.filter((c) => !c.parentId);

  return (
    <div className="min-h-screen bg-gray-50/90">
      {/* Hero */}
      <div className="bg-gradient-to-br from-elite-navy via-sky-700 to-sky-500 text-white py-8 sm:py-12">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 px-4 py-1.5 rounded-full text-sm font-medium mb-4">
            <span>🌐</span> All Listings
          </div>
          <h1 className="text-3xl sm:text-5xl font-black mb-3">
            Browse <span className="text-amber-400">Everything</span>
          </h1>
          <p className="text-white/80 text-base sm:text-lg max-w-xl mx-auto">
            Explore all listings across every category, filtered to your selected country and ranked by your interests.
          </p>
          <p className="mt-2 text-sm text-white/60">
            Showing results for <span className="font-semibold text-white/90">{country}</span> · {total.toLocaleString()} listings
          </p>
          <div className="mt-5">
            <Link
              href="/listings/create"
              className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-black font-bold px-6 py-3 rounded-xl transition-all shadow-lg hover:-translate-y-0.5 text-sm"
            >
              + Post an Ad
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Sticky filter row */}
        <div className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200 pb-3 mb-6 pt-2">
          {/* Category tabs */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 mb-3">
            <button
              onClick={() => handleCategoryChange('', 'All')}
              className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                activeCategorySlug === ''
                  ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300 hover:text-sky-700'
              }`}
            >
              🌐 All
            </button>
            {topCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategoryChange(cat.slug, cat.name)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                  activeCategorySlug === cat.slug
                    ? 'bg-sky-600 text-white border-sky-600 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300 hover:text-sky-700'
                }`}
              >
                {cat.icon && <span>{cat.icon}</span>}
                {cat.name}
              </button>
            ))}
          </div>

          {/* Sort + results count */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-gray-500">
              {loading ? 'Loading…' : `${total.toLocaleString()} listing${total !== 1 ? 's' : ''} found`}
              {activeCategorySlug && (
                <span className="ml-1 text-gray-400">in <span className="font-semibold text-gray-600">{activeCategoryName}</span></span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 font-medium">Sort:</span>
              <div className="flex gap-1">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSort(opt.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      sort === opt.value
                        ? 'bg-sky-600 text-white border-sky-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-16 text-center">
            <div className="text-5xl mb-3">🔍</div>
            <p className="font-bold text-gray-700 text-lg mb-1">No listings found</p>
            <p className="text-sm text-gray-400 mb-5">
              There are no listings for <strong>{country}</strong>
              {activeCategorySlug ? ` in the selected category` : ''}.
            </p>
            <Link
              href="/listings/create"
              className="inline-block bg-sky-600 text-white text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-sky-700 transition-colors"
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
