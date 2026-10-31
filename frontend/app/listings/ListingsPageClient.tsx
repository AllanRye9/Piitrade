'use client';

import { useTr } from '@/lib/i18n/useTr';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Listing, Category } from '@/lib/types';
import { ListingGrid } from '@/components/listings/ListingGrid';
import { FilterSidebar } from '@/components/listings/FilterSidebar';
import { QuickFilterBar } from '@/components/listings/QuickFilterBar';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { useCountry } from '@/context/CountryContext';
import { warmLocationCache, attachCachedLocation } from '@/lib/geolocation';

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
  // Default changed from 'comfortable' to 'compact' so preview images on
  // this page render roughly half the size of before (compact packs more
  // columns per row — see ListingGrid.tsx). Scoped to this page only: the
  // shared ListingCard/ListingGrid components and their 'comfortable'
  // default are unchanged, so every other page that renders listings is
  // unaffected. The toggle above still lets a visitor switch back.
  const density = 'compact' as const; // fixed: the grid/list view toggle was removed

  const currentPage = parseInt(params ? params.get('page') || '1' : '1');

  // Load categories once
  useEffect(() => {
    api.get('/categories').then(({ data }) => setCategories(data)).catch(() => {});
  }, []);

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
    FEATURED_DEAL:      { title: 'Featured Deals',    subtitle: "Hand-picked deals and featured offers.", icon: '🔥' },
    FLASH_SALE:         { title: 'Flash Deals',       subtitle: "Limited-time flash deals — grab them before they're gone!", icon: '⚡' },
    LATEST_COLLECTIONS: { title: 'New Collections',  subtitle: 'Freshly added collections from our best Merchants.', icon: '✨' },
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
      {/* The gradient hero banner was removed so listings sit at the top of the page. The page keeps its
          <h1> (and description) for SEO / screen readers; the active country / placement / query context
          remains visible in the breadcrumb and the active-filter chips below. */}
      <h1 className="sr-only">{pageTitle}</h1>
      <p className="sr-only">{pageSubtitle}</p>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-3">
        <Breadcrumb
          className="mb-1.5"
          items={[
            { label: 'Home', href: '/' },
            ...(activeMeta ? [{ label: activeMeta.label, href: `/country/${activeMeta.label.toLowerCase()}` }] : []),
            { label: placementMeta?.title ?? 'Listings' },
          ]}
        />
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

        <div className="flex gap-5">
          <FilterSidebar categories={categories} isOpen={filterOpen} onClose={() => setFilterOpen(false)} />

          <div className="flex-1 min-w-0">
            {/* Result count — a slim line (no card, no view toggle) */}
            <p className="hidden md:block mb-2 text-xs text-gray-500">
              {total > 0 ? (
                <>Showing <span className="text-gray-900 font-bold">{resultsStart}–{resultsEnd}</span> of <span className="text-gray-900 font-bold">{total.toLocaleString()}</span></>
              ) : (
                <span className="text-gray-900 font-bold">0 {tr('listings')}</span>
              )}
            </p>

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
            <ListingGrid listings={listings} loading={loading} density={density} maxColumns={activeCat ? undefined : 4} priorityCount={4} />

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

