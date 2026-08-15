'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ListingCard } from '@/components/listings/ListingCard';
import { Listing } from '@/lib/types';
import { useCountry } from '@/context/CountryContext';
import type { SubCategory } from './CategoryPageTemplate';
import { useActiveSubcategoryCounts } from '@/hooks/useActiveSubcategoryCounts';

interface CategorySubcategoryTemplateProps {
  /** All subcategories in this category — used for the "Other Categories" nav */
  subcategories: Record<string, SubCategory>;
  /** Base path, e.g. "/property" */
  basePath: string;
  /** Display name for the parent category, e.g. "Property" */
  categoryLabel: string;
  /** href of the parent category page, e.g. "/property" */
  categoryHref: string;
  /** Price range presets shown in the filter bar */
  priceRanges?: Array<{ label: string; min: string; max: string }>;
}

const DEFAULT_PRICE_RANGES = [
  { label: 'Any Price', min: '', max: '' },
  { label: 'Under $500', min: '', max: '500' },
  { label: '$500–$2k', min: '500', max: '2000' },
  { label: '$2k–$10k', min: '2000', max: '10000' },
  { label: '$10k–$50k', min: '10000', max: '50000' },
  { label: 'Over $50k', min: '50000', max: '' },
];

function SubcategoryContent({
  subcategories,
  basePath,
  categoryLabel,
  categoryHref,
  priceRanges = DEFAULT_PRICE_RANGES,
}: CategorySubcategoryTemplateProps) {
  const params = useParams<{ subcategory: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { country } = useCountry();

  const subcategorySlug = params?.subcategory || '';
  const meta = subcategories[subcategorySlug] || {
    slug: subcategorySlug,
    label: subcategorySlug.replace(/-/g, ' '),
    icon: '🏷️',
    color: 'from-gray-600 to-gray-800',
    desc: '',
  };

  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Hide empty sibling subcategories from the "Other Categories" nav below
  // until they have ACTIVE listings in this country. Falls back to showing
  // all of them if the counts request fails or hasn't resolved yet.
  const { counts: subcategoryCounts } = useActiveSubcategoryCounts(country);
  const otherSubcategories = Object.entries(subcategories)
    .filter(([slug]) => slug !== subcategorySlug)
    .filter(([slug]) => !subcategoryCounts || (subcategoryCounts[slug] ?? 0) > 0);

  const currentPage = parseInt(searchParams?.get('page') || '1');
  const sortBy      = searchParams?.get('sort') || 'createdAt';
  const priceRange  = searchParams?.get('priceRange') || '';

  // Stable ref for priceRanges so it never causes the effect to re-run
  const priceRangesRef = useRef(priceRanges);
  useEffect(() => { priceRangesRef.current = priceRanges; }, [priceRanges]);

  // Guard against redundant fetches
  const prevParamsRef = useRef('');

  useEffect(() => {
    if (!subcategorySlug) return;

    // Build a stable key — only re-fetch when these primitives actually change
    const paramsKey = `${subcategorySlug}|${currentPage}|${sortBy}|${priceRange}|${country}`;
    if (paramsKey === prevParamsRef.current) return;
    prevParamsRef.current = paramsKey;

    const controller = new AbortController();
    setLoading(true);

    const qParams = new URLSearchParams();
    qParams.set('category', subcategorySlug);
    qParams.set('page', String(currentPage));
    qParams.set('sort', sortBy);
    qParams.set('limit', '18');
    if (country) qParams.set('country', country);

    // Use the ref so priceRanges is NOT in the dependency array
    const pRange = priceRangesRef.current?.find((r) => r.label === priceRange);
    if (pRange) {
      if (pRange.min) qParams.set('priceMin', pRange.min);
      if (pRange.max) qParams.set('priceMax', pRange.max);
    }

    api
      .get(`/listings?${qParams.toString()}`, { signal: controller.signal })
      .then(({ data }) => {
        setListings(data.listings || []);
        setTotal(data.pagination?.total || 0);
        setPages(data.pagination?.pages || 1);
      })
      .catch((err) => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        setListings([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
    // priceRanges intentionally excluded — accessed via ref to avoid re-fetch loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subcategorySlug, currentPage, sortBy, priceRange, country]);

  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams?.toString() || '');
    if (value) p.set(key, value);
    else p.delete(key);
    p.set('page', '1');
    router.push(`${basePath}/${subcategorySlug}?${p.toString()}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className={`relative overflow-hidden bg-gradient-to-br ${meta.color} text-white py-8 sm:py-12`}>
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_30%_50%,white_0%,transparent_60%)]" />
        <div className="relative max-w-7xl mx-auto px-4">
          <nav className="flex items-center gap-2 text-xs text-white/70 mb-3">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <span>/</span>
            <Link href={categoryHref} className="hover:text-white transition-colors">{categoryLabel}</Link>
            <span>/</span>
            <span className="text-white font-semibold">{meta.label}</span>
          </nav>
          <div className="flex items-center gap-4">
            <span className="text-4xl">{meta.icon}</span>
            <div>
              <h1 className="text-2xl sm:text-4xl font-black">{meta.label}</h1>
              <p className="text-white/80 text-sm mt-1">
                {total > 0
                  ? `${total.toLocaleString('en-US')} listing${total !== 1 ? 's' : ''} available`
                  : 'Browse available listings'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Filters bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600 whitespace-nowrap">Price:</label>
            <select
              value={priceRange}
              onChange={(e) =>
                updateParam('priceRange', e.target.value === 'Any Price' ? '' : e.target.value)
              }
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-sky-300 outline-none"
            >
              {priceRanges.map((r) => (
                <option key={r.label}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-xs font-semibold text-gray-600 whitespace-nowrap">Sort:</label>
            <select
              value={sortBy}
              onChange={(e) => updateParam('sort', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-sky-300 outline-none"
            >
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
                    className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${
                      currentPage === pg
                        ? 'bg-sky-600 text-white'
                        : 'bg-white border border-gray-200 text-gray-700 hover:bg-sky-50'
                    }`}
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
            <p className="text-sm text-gray-400 mb-6">
              Be the first to post a {meta.label.toLowerCase()} listing!
            </p>
            <Link
              href="/listings/create"
              className="inline-block bg-sky-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-sky-700 transition-colors"
            >
              Post {meta.label} Ad
            </Link>
          </div>
        )}
      </div>

      {/* Other subcategories nav */}
      {otherSubcategories.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pb-10">
          <h2 className="text-lg font-bold text-gray-800 mb-3">Other Categories</h2>
          <div className="flex flex-wrap gap-2">
            {otherSubcategories.map(([slug, s]) => (
              <Link
                key={slug}
                href={`${basePath}/${slug}`}
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

export default function CategorySubcategoryTemplate(props: CategorySubcategoryTemplateProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-gray-500">Loading…</div>
        </div>
      }
    >
      <SubcategoryContent {...props} />
    </Suspense>
  );
}
