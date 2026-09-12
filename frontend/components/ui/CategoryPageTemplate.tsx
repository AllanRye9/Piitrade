'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useCountry } from '@/context/CountryContext';
import { api } from '@/lib/api';
import { ListingCard } from '@/components/listings/ListingCard';
import { Listing } from '@/lib/types';
import { useActiveSubcategoryCounts } from '@/hooks/useActiveSubcategoryCounts';

export interface SubCategory {
  slug: string;
  label: string;
  icon: string;
  color: string;
  desc: string;
}

interface CategoryPageTemplateProps {
  categorySlug: string;
  categoryLabel: string;
  heroGradient: string;
  heroIcon: string;
  heroTitle: React.ReactNode;
  heroSubtitle: string;
  subcategories: SubCategory[];
  basePath: string;
  postCtaLabel?: string;
  /** Where the "+ Post ... Ad" button links. Defaults to the standard
   *  `/listings/create` form, which requires an Agent/Company/Organization/
   *  Admin account. Categories open to every user (currently just
   *  Agriculture) override this to point at their own lightweight posting
   *  page instead. */
  postCtaHref?: string;
}

const SORT_OPTS = [
  { value: 'createdAt'  as const, label: 'Newest' },
  { value: 'price_asc'  as const, label: 'Price ↑' },
  { value: 'price_desc' as const, label: 'Price ↓' },
  { value: 'views'      as const, label: 'Popular' },
];

const PAGE_SIZE = 24;

export default function CategoryPageTemplate({
  categorySlug,
  categoryLabel,
  heroGradient,
  heroIcon,
  heroTitle,
  heroSubtitle,
  subcategories,
  basePath,
  postCtaLabel = `+ Post ${categoryLabel} Ad`,
  postCtaHref = '/listings/create',
}: CategoryPageTemplateProps) {
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading]   = useState(true);
  const [sort, setSort]         = useState<'createdAt' | 'price_asc' | 'price_desc' | 'views'>('createdAt');
  const [q, setQ]               = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [condition, setCondition]     = useState<'' | 'NEW' | 'USED'>('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [total, setTotal]       = useState(0);
  const [pages, setPages]       = useState(1);
  const [page, setPage]         = useState(1);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Hide subcategories with zero ACTIVE listings in this country until a
  // listing gets posted into them. If the counts request fails or hasn't
  // resolved yet, `counts` is null and we fall back to showing every
  // subcategory rather than hiding the whole row on a transient error.
  const { counts: subcategoryCounts } = useActiveSubcategoryCounts(country);
  const visibleSubcategories = subcategoryCounts
    ? subcategories.filter((sub) => (subcategoryCounts[sub.slug] ?? 0) > 0)
    : subcategories;

  // Close the "more filters" popover on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const onClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [moreOpen]);

  // Reset to page 1 whenever a filter changes (but not when `page` itself changes)
  useEffect(() => { setPage(1); }, [categorySlug, country, sort, q, subcategory, condition, verifiedOnly]);

  // Track previous fetch params to avoid redundant re-fetches
  const prevParamsRef = useRef('');

  useEffect(() => {
    const paramsKey = `${categorySlug}|${country}|${sort}|${q}|${subcategory}|${condition}|${verifiedOnly}|${page}`;
    if (paramsKey === prevParamsRef.current) return; // nothing changed — skip
    prevParamsRef.current = paramsKey;

    const controller = new AbortController();
    setLoading(true);

    const params = new URLSearchParams({
      category: subcategory || categorySlug,
      sort,
      limit: String(PAGE_SIZE),
      page: String(page),
    });
    if (country) params.set('country', country);
    if (q) params.set('q', q);
    if (condition) params.set('condition', condition);
    if (verifiedOnly) params.set('verifiedOnly', 'true');

    api.get(`/listings?${params}`, { signal: controller.signal })
      .then(({ data }) => {
        setListings(data.listings || []);
        setTotal(data.pagination?.total ?? (data.listings || []).length);
        setPages(data.pagination?.pages ?? 1);
      })
      .catch((err) => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        setListings([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [categorySlug, country, sort, q, subcategory, condition, verifiedOnly, page]);

  const goToPage = (p: number) => {
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const activeExtraFilterCount = [condition, verifiedOnly].filter(Boolean).length;
  const resultsStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const resultsEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Compact identity strip — no more full-viewport hero ── */}
      <div className={`relative overflow-hidden bg-gradient-to-r ${heroGradient} text-white`}>
        <div className="relative max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-3.5 flex items-center gap-3">
          <span className="text-xl sm:text-2xl shrink-0" aria-hidden="true">{heroIcon}</span>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm sm:text-lg font-extrabold leading-tight truncate">{heroTitle}</h1>
            <p className="hidden sm:block text-white/70 text-xs leading-snug line-clamp-2">{heroSubtitle}</p>
          </div>
          <Link
            href={postCtaHref}
            className="shrink-0 bg-amber-400 hover:bg-amber-300 text-black font-bold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg transition-colors text-xs sm:text-sm interactive"
          >
            {postCtaLabel}
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
        {/* ── Subcategory quick-filter row (horizontal scroll, not a card grid) ── */}
        {visibleSubcategories.length > 0 && (
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0">
            <button
              onClick={() => setSubcategory('')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all interactive border ${
                !subcategory ? 'bg-red-600 text-white border-red-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
              }`}
            >
              All {categoryLabel}
            </button>
            {visibleSubcategories.map((sub) => (
              <button
                key={sub.slug}
                onClick={() => setSubcategory(sub.slug === subcategory ? '' : sub.slug)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all interactive border ${
                  subcategory === sub.slug ? 'bg-red-600 text-white border-red-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'
                }`}
              >
                <span aria-hidden="true">{sub.icon}</span> {sub.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Search, sort & filter toolbar — everything in one compact row ── */}
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${categoryLabel.toLowerCase()}...`}
              className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 transition-shadow"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Sort tabs — desktop only, compact pills */}
            <div className="hidden md:flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
              {SORT_OPTS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSort(opt.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-all interactive ${
                    sort === opt.value ? 'bg-red-600 text-white shadow-sm' : 'text-gray-500 hover:text-red-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Sort select — mobile only */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="md:hidden bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-red-300"
            >
              {SORT_OPTS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>

            {/* More filters popover */}
            <div className="relative" ref={moreRef}>
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className="relative flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:border-red-300 transition-colors interactive"
              >
                <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" /></svg>
                Filters
                {activeExtraFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center rounded-full bg-red-600 text-white text-[9px] font-bold">
                    {activeExtraFilterCount}
                  </span>
                )}
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-gray-100 rounded-xl shadow-xl z-30 p-3.5 space-y-3 animate-fade-in">
                  <div>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Condition</p>
                    <div className="flex gap-1.5">
                      {[{ v: '', l: 'Any' }, { v: 'NEW', l: '✨ New' }, { v: 'USED', l: '📦 Used' }].map((c) => (
                        <button
                          key={c.v}
                          onClick={() => setCondition(c.v as '' | 'NEW' | 'USED')}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all interactive border ${
                            condition === c.v ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200 hover:border-red-200'
                          }`}
                        >{c.l}</button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2.5 cursor-pointer group pt-1 border-t border-gray-100">
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
                    <span className="text-xs text-gray-700 group-hover:text-gray-900 transition-colors">
                      🪪 KYC Verified Sellers Only
                    </span>
                  </label>
                  {activeExtraFilterCount > 0 && (
                    <button
                      onClick={() => { setCondition(''); setVerifiedOnly(false); }}
                      className="w-full text-center text-xs text-gray-400 hover:text-red-500 transition-colors pt-1 interactive"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Results count */}
        <p className="text-xs text-gray-400 mb-3">
          {loading ? 'Searching…' : total > 0
            ? <>Showing <span className="font-semibold text-gray-600">{resultsStart}–{resultsEnd}</span> of <span className="font-semibold text-gray-600">{total.toLocaleString()}</span> {categoryLabel.toLowerCase()} listings{country ? ` in ${country}` : ''}</>
            : `No ${categoryLabel.toLowerCase()} listings found`}
        </p>

        {/* ── Listings — the page's main event, spanning top to bottom ── */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3">
            {Array.from({ length: PAGE_SIZE }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="aspect-[4/3] shimmer" />
                <div className="p-2 space-y-1.5">
                  <div className="h-2.5 shimmer rounded w-3/4" />
                  <div className="h-2 shimmer rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : listings.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3 stagger-children">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 p-12 text-center">
            <div className="text-5xl mb-3">{heroIcon}</div>
            <p className="font-semibold text-gray-700">No {categoryLabel.toLowerCase()} listings yet</p>
            <p className="text-sm text-gray-400 mt-1">
              {q || subcategory || condition || verifiedOnly ? 'Try adjusting your search or filters.' : `Be the first to post a ${categoryLabel.toLowerCase()} ad!`}
            </p>
            <Link href={postCtaHref} className="mt-4 inline-block bg-red-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-red-700 transition-colors interactive">
              Post Ad
            </Link>
          </div>
        )}

        {/* Pagination */}
        {!loading && pages > 1 && (
          <div className="flex flex-wrap justify-center gap-1.5 mt-6">
            <button
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors interactive"
            >← Prev</button>
            {Array.from({ length: pages }, (_, i) => i + 1)
              .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === pages)
              .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis');
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === 'ellipsis'
                  ? <span key={`e-${i}`} className="flex items-center px-1 text-gray-400 text-sm">…</span>
                  : (
                    <button
                      key={p}
                      onClick={() => goToPage(p as number)}
                      className={`w-9 h-9 rounded-lg text-sm font-semibold transition-all interactive ${
                        p === page ? 'bg-red-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-red-200'
                      }`}
                    >{p}</button>
                  )
              )}
            <button
              onClick={() => goToPage(Math.min(pages, page + 1))}
              disabled={page === pages}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors interactive"
            >Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
