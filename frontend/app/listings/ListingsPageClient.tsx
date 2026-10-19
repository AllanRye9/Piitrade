'use client';

import { useTr } from '@/lib/i18n/useTr';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Listing, Category } from '@/lib/types';
import { ListingGrid } from '@/components/listings/ListingGrid';
import { FilterSidebar } from '@/components/listings/FilterSidebar';
import { SearchBar } from '@/components/listings/SearchBar';
import { QuickFilterBar } from '@/components/listings/QuickFilterBar';
import { useCountry } from '@/context/CountryContext';
import { FlagIcon } from '@/components/ui/FlagIcon';
import { warmLocationCache, attachCachedLocation } from '@/lib/geolocation';

const SORT_OPTIONS: Record<string, string> = {
  recommended: 'Recommended',
  relevance: 'Best Match',
  createdAt: 'Most Recent',
  price_asc: 'Lowest Price',
  price_desc: 'Highest Price',
  views: 'Most Popular',
};

function ListingsContent() {
  const tr = useTr();
  const params = useSearchParams();
  const router = useRouter();
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>([]);
  const [correction, setCorrection] = useState<{ used: string; original: string } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  // Default changed from 'comfortable' to 'compact' so preview images on
  // this page render roughly half the size of before (compact packs more
  // columns per row — see ListingGrid.tsx). Scoped to this page only: the
  // shared ListingCard/ListingGrid components and their 'comfortable'
  // default are unchanged, so every other page that renders listings is
  // unaffected. The toggle above still lets a visitor switch back.
  const [density, setDensity] = useState<'comfortable' | 'compact'>('compact');
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const currentPage = parseInt(params ? params.get('page') || '1' : '1');
  const activeSort  = params?.get('sort') || (params?.get('q') ? 'relevance' : 'recommended');

  // Load categories once
  useEffect(() => {
    api.get('/categories').then(({ data }) => setCategories(data)).catch(() => {});
  }, []);

  // Close the sort dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return;
    const onClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [sortOpen]);

  // Stable ref to track the last fetched param string — prevents duplicate requests
  const prevQueryRef = useRef('');

  // Best-effort location warm-up: kicks off the browser's geolocation
  // permission prompt once per session (if not already answered) so a
  // fix is cached and ready by the time a search request goes out. Never
  // blocks — see lib/geolocation.ts.
  useEffect(() => {
    warmLocationCache();
  }, []);

  useEffect(() => {
    const merged = new URLSearchParams(params ? params.toString() : '');
    // Always inject the selected country unless already in the URL params
    if (!merged.get('country') && country) merged.set('country', country);
    if (!merged.get('sort')) merged.set('sort', merged.get('q') ? 'relevance' : 'recommended');

    const queryKey = merged.toString();
    if (queryKey === prevQueryRef.current) return;
    prevQueryRef.current = queryKey;

    const controller = new AbortController();
    setLoading(true);

    // Clone before attaching location so a newly-warmed cache never changes
    // `queryKey` (above) and triggers a spurious duplicate fetch — location
    // only ever enriches the outgoing request, never the dedup check.
    const requestParams = new URLSearchParams(merged);
    attachCachedLocation(requestParams);

    api.get(`/listings?${requestParams.toString()}`, { signal: controller.signal })
      .then(({ data }) => {
        setListings(data.listings || []);
        setCorrection(data.correctedQuery ? { used: data.correctedQuery, original: data.originalQuery || '' } : null);
        setTotal(data.pagination?.total || 0);
        setPages(data.pagination?.pages || 1);
      })
      .catch((err) => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        setListings([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [params, country]);

  const goToPage = (page: number) => {
    const newParams = new URLSearchParams(params ? params.toString() : '');
    newParams.set('page', String(page));
    router.push(`/listings?${newParams.toString()}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setSort = (value: string) => {
    const newParams = new URLSearchParams(params ? params.toString() : '');
    newParams.set('sort', value);
    newParams.set('page', '1');
    router.push(`/listings?${newParams.toString()}`);
    setSortOpen(false);
  };

  const removeParam = (key: string) => {
    const p = new URLSearchParams(params ? params.toString() : '');
    p.delete(key);
    p.set('page', '1');
    router.push(`/listings?${p.toString()}`);
  };

  const COUNTRY_META: Record<string, { isoCode: string; label: string }> = {
    UGANDA: { isoCode: 'UG', label: 'Uganda' },
  };
  const activeCountry  = params?.get('country') || country;
  const activeMeta     = COUNTRY_META[activeCountry];
  const activeQ        = params?.get('q') || '';
  const fromPhoto      = params?.get('photo') === '1';
  const [photoAlts, setPhotoAlts] = useState<string[]>([]);
  useEffect(() => {
    if (!fromPhoto) { setPhotoAlts([]); return; }
    try {
      const raw = window.sessionStorage.getItem('piitrade_image_alts');
      const parsed = raw ? JSON.parse(raw) : null;
      setPhotoAlts(parsed && Array.isArray(parsed.alts) ? parsed.alts.slice(0, 4) : []);
    } catch { setPhotoAlts([]); }
  }, [fromPhoto, activeQ]);
  const activeCat      = params?.get('category') || '';
  const activeLocation = params?.get('location') || '';
  const activeCondition = params?.get('condition') || '';
  const activePriceMin = params?.get('priceMin') || '';
  const activePriceMax = params?.get('priceMax') || '';
  const activeVerified = params?.get('verifiedOnly') === 'true';
  const activePhotos = params?.get('withPhotos') === 'true';
  const placement       = params?.get('placement') ?? '';

  const activeFilterCount = [activeQ, activeCat, activeLocation, activeCondition, activePriceMin || activePriceMax, activeVerified, activePhotos].filter(Boolean).length;

  const PLACEMENT_LABELS: Record<string, { title: string; subtitle: string; icon: string }> = {
    FEATURED_DEAL:      { title: "Today's Deals",    subtitle: "Hand-picked deals and featured offers.", icon: '🔥' },
    FLASH_SALE:         { title: 'Flash Deals',       subtitle: "Limited-time flash deals — grab them before they're gone!", icon: '⚡' },
    LATEST_COLLECTIONS: { title: 'New Collections',  subtitle: 'Freshly added collections from our best Web Stores.', icon: '✨' },
  };
  const placementMeta = PLACEMENT_LABELS[placement];

  const pageTitle = placementMeta?.title
    ?? (activeQ ? `Results for "${activeQ}"` : activeMeta ? `${activeMeta.label} Listings` : 'Browse All Listings');
  const pageSubtitle = placementMeta?.subtitle
    ?? (activeCat ? `Showing ${activeCat} listings${activeMeta ? ` in ${activeMeta.label}` : ''}` : 'Discover products from verified sellers.');

  const resultsStart = total === 0 ? 0 : (currentPage - 1) * 20 + 1;
  const resultsEnd = Math.min(currentPage * 20, total);

  return (
    <div>
      {/* ── Compact hero header — trimmed further so listings sit higher on the page ── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-premium-navy via-[#9A3300] to-[#6B2400] py-3 sm:py-4 px-4">
        {/* Ambient texture */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle at 15% 20%, #fff 0%, transparent 45%), radial-gradient(circle at 85% 80%, #fff 0%, transparent 40%)' }}
          aria-hidden="true"
        />
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-transparent via-premium-gold to-transparent" aria-hidden="true" />

        <div className="relative max-w-4xl mx-auto flex items-center justify-center gap-2.5 flex-wrap">
          {activeMeta && !placement && (
            <div className="rounded-lg overflow-hidden ring-2 ring-white/40 shadow-md shrink-0">
              <FlagIcon code={activeMeta.isoCode} size={24} />
            </div>
          )}
          {placementMeta && <span className="text-xl shrink-0" aria-hidden="true">{placementMeta.icon}</span>}
          <h1 className="text-sm sm:text-lg font-extrabold text-white tracking-tight">{pageTitle}</h1>
          <span className="hidden sm:inline text-red-100/70 text-xs">{pageSubtitle}</span>
          {!loading && (
            <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-full backdrop-blur-sm shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-premium-gold-light" aria-hidden="true" />
              {total.toLocaleString()} {total === 1 ? 'listing' : 'listings'}
            </span>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-5">
        {/* Search bar */}
        <div className="mb-3 sm:mb-4 relative z-10">
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-1">
            <SearchBar
              initialQ={params ? params.get('q') || '' : ''}
              initialLocation={params ? params.get('location') || '' : ''}
            />
          </div>
        </div>

        <QuickFilterBar total={total} loading={loading} activeCount={activeFilterCount} onMore={() => setFilterOpen(true)} />

        {fromPhoto && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-orange-100 bg-orange-50/70 px-3 py-2.5 text-sm">
            <span className="font-semibold text-gray-800">📷 Photo search:</span>
            <span className="text-gray-600">showing matches for “{activeQ}”.</span>
            {photoAlts.length > 0 && <span className="text-gray-500">Not right? Try</span>}
            {photoAlts.map((alt) => (
              <button
                key={alt}
                type="button"
                onClick={() => {
                  const p = new URLSearchParams(params ? params.toString() : '');
                  p.set('q', alt); p.set('page', '1');
                  router.push(`/listings?${p.toString()}`);
                }}
                className="rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100"
              >
                {alt}
              </button>
            ))}
          </div>
        )}

        {/* Active filters summary */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3 xs:mb-4">
            {activeQ && (
              <span className="inline-flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                🔍 &quot;{activeQ}&quot;
                <button type="button" onClick={() => removeParam('q')} className="ml-0.5 hover:text-red-900 interactive" aria-label="Remove search filter">×</button>
              </span>
            )}
            {activeCat && (
              <span className="inline-flex items-center gap-1.5 bg-violet-50 border border-violet-100 text-violet-700 text-xs font-semibold px-3 py-1.5 rounded-full capitalize">
                📂 {activeCat}
                <button type="button" onClick={() => removeParam('category')} className="ml-0.5 hover:text-violet-900 interactive" aria-label="Remove category filter">×</button>
              </span>
            )}
            {activeLocation && (
              <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-100 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                📍 {activeLocation}
                <button type="button" onClick={() => removeParam('location')} className="ml-0.5 hover:text-amber-900 interactive" aria-label="Remove location filter">×</button>
              </span>
            )}
            {activeCondition && (
              <span className="inline-flex items-center gap-1.5 bg-teal-50 border border-teal-100 text-teal-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                {activeCondition === 'NEW' ? '✨ New' : '📦 Used'}
                <button type="button" onClick={() => removeParam('condition')} className="ml-0.5 hover:text-teal-900 interactive" aria-label="Remove condition filter">×</button>
              </span>
            )}
            {(activePriceMin || activePriceMax) && (
              <span className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-100 text-rose-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                💰 {activePriceMin || '0'} – {activePriceMax || '∞'}
                <button
                  type="button"
                  onClick={() => {
                    const p = new URLSearchParams(params ? params.toString() : '');
                    p.delete('priceMin'); p.delete('priceMax'); p.set('page', '1');
                    router.push(`/listings?${p.toString()}`);
                  }}
                  className="ml-0.5 hover:text-rose-900 interactive"
                  aria-label="Remove price filter"
                >×</button>
              </span>
            )}
            {activeVerified && (
              <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                🪪 KYC Verified Only
                <button type="button" onClick={() => removeParam('verifiedOnly')} className="ml-0.5 hover:text-emerald-900 interactive" aria-label="Remove verified sellers filter">×</button>
              </span>
            )}
            {activePhotos && (
              <span className="inline-flex items-center gap-1.5 bg-sky-50 border border-sky-100 text-sky-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                📷 With photos
                <button type="button" onClick={() => removeParam('withPhotos')} className="ml-0.5 hover:text-sky-900 interactive" aria-label="Remove photos filter">×</button>
              </span>
            )}
            {activeFilterCount > 1 && (
              <button
                type="button"
                onClick={() => router.push(`/listings?country=${country}`)}
                className="text-xs font-semibold text-gray-400 hover:text-red-500 transition-colors interactive underline underline-offset-2"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Mobile filter toggle */}
        <div className="flex items-center justify-between mb-3 md:hidden">
          <p className="text-gray-500 text-sm font-medium">
            <span className="text-gray-900 font-bold">{total}</span> listings
          </p>
          <button
            onClick={() => setFilterOpen(true)}
            className="relative flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors shadow-sm interactive"
          >
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            {tr('Filters')}
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 min-w-[18px] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex gap-5">
          <FilterSidebar categories={categories} isOpen={filterOpen} onClose={() => setFilterOpen(false)} />

          <div className="flex-1 min-w-0">
            {/* Desktop toolbar */}
            <div className="hidden md:flex items-center justify-between mb-4 bg-white/70 backdrop-blur-sm border border-gray-100 rounded-xl px-4 py-2.5 shadow-sm">
              <p className="text-gray-500 text-sm">
                {total > 0 ? (
                  <>Showing <span className="text-gray-900 font-bold">{resultsStart}–{resultsEnd}</span> of <span className="text-gray-900 font-bold">{total.toLocaleString()}</span></>
                ) : (
                  <span className="text-gray-900 font-bold">0 {tr('listings')}</span>
                )}
              </p>

              <div className="flex items-center gap-3">
                {/* Density toggle */}
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setDensity('comfortable')}
                    aria-label="Comfortable grid"
                    aria-pressed={density === 'comfortable'}
                    className={`p-1.5 rounded-md transition-colors interactive ${density === 'comfortable' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2}/><rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2}/><rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2}/><rect x="14" y="14" width="7" height="7" rx="1" strokeWidth={2}/></svg>
                  </button>
                  <button
                    onClick={() => setDensity('compact')}
                    aria-label="Compact grid"
                    aria-pressed={density === 'compact'}
                    className={`p-1.5 rounded-md transition-colors interactive ${density === 'compact' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="4" height="4" rx="0.5" strokeWidth={2}/><rect x="10" y="3" width="4" height="4" rx="0.5" strokeWidth={2}/><rect x="17" y="3" width="4" height="4" rx="0.5" strokeWidth={2}/><rect x="3" y="10" width="4" height="4" rx="0.5" strokeWidth={2}/><rect x="10" y="10" width="4" height="4" rx="0.5" strokeWidth={2}/><rect x="17" y="10" width="4" height="4" rx="0.5" strokeWidth={2}/><rect x="3" y="17" width="4" height="4" rx="0.5" strokeWidth={2}/><rect x="10" y="17" width="4" height="4" rx="0.5" strokeWidth={2}/><rect x="17" y="17" width="4" height="4" rx="0.5" strokeWidth={2}/></svg>
                  </button>
                </div>

                <div className="w-px h-5 bg-gray-200" aria-hidden="true" />

                {/* Sort dropdown */}
                <div className="relative" ref={sortMenuRef}>
                  <button
                    onClick={() => setSortOpen((v) => !v)}
                    aria-haspopup="listbox"
                    aria-expanded={sortOpen}
                    className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-red-600 transition-colors interactive"
                  >
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9M3 12h5m10-8v16m0 0l-4-4m4 4l4-4"/></svg>
                    {tr(SORT_OPTIONS[activeSort] || 'Sort')}
                    <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${sortOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {sortOpen && (
                    <ul
                      role="listbox"
                      className="absolute right-0 top-full mt-2 w-44 bg-white border border-gray-100 rounded-xl shadow-xl overflow-hidden z-30 animate-fade-in"
                    >
                      {Object.entries(SORT_OPTIONS)
                        .filter(([key]) => key !== 'relevance' || activeQ)
                        .map(([key, label]) => (
                          <li key={key}>
                            <button
                              role="option"
                              aria-selected={activeSort === key}
                              onClick={() => setSort(key)}
                              className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-colors ${
                                activeSort === key ? 'bg-red-50 text-red-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'
                              }`}
                            >
                              {tr(label)}
                              {activeSort === key && (
                                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                              )}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {correction && !loading && (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
                No exact matches for <strong>&ldquo;{correction.original}&rdquo;</strong> — showing results for <strong>&ldquo;{correction.used}&rdquo;</strong>.
              </p>
            )}
            {!loading && !correction && listings.length === 0 && activeQ && (
              <p className="mb-3 text-xs text-gray-500">
                Tips: search by brand or model (<em>iphone 14</em>), use quotes for an exact phrase (<em>&quot;toyota harrier&quot;</em>), exclude words with a minus (<em>laptop -hp</em>) or set a budget (<em>phone under 500k</em>).
              </p>
            )}
            <ListingGrid listings={listings} loading={loading} density={density} />

            {!loading && pages > 1 && (
              <div className="flex flex-col items-center gap-2 mt-8">
                <p className="hidden sm:block text-xs text-gray-400">
                  Showing {resultsStart}–{resultsEnd} of {total.toLocaleString()} listings
                </p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  <button
                    onClick={() => goToPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-2 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors interactive"
                  >{tr('← Prev')}</button>
                  {Array.from({ length: pages }, (_, i) => i + 1)
                    .filter((p) => Math.abs(p - currentPage) <= 2 || p === 1 || p === pages)
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
                              p === currentPage ? 'bg-red-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-red-200'
                            }`}
                          >{p}</button>
                        )
                    )}
                  <button
                    onClick={() => goToPage(Math.min(pages, currentPage + 1))}
                    disabled={currentPage === pages}
                    className="px-3 py-2 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors interactive"
                  >{tr('Next →')}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ListingsPage() {
  return (
    <Suspense fallback={
      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="h-12 bg-gray-100 animate-pulse rounded-xl mb-6" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl overflow-hidden border border-gray-100">
              <div className="aspect-[4/3] bg-gray-200 animate-pulse" />
              <div className="p-2.5 space-y-2">
                <div className="h-3 bg-gray-200 animate-pulse rounded-full" />
                <div className="h-4 bg-gray-200 animate-pulse rounded-full w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    }>
      <ListingsContent />
    </Suspense>
  );
}

