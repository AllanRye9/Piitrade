'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ListingCard } from '@/components/listings/ListingCard';
import { Listing } from '@/lib/types';
import { useCountry } from '@/context/CountryContext';
import type { SubCategory } from './CategoryPageTemplate';
import type { BrandItem } from './BrandsPageTemplate';

interface BrandListingsTemplateProps {
  /** All subcategories — used to get the current subcategory metadata */
  subcategories: Record<string, SubCategory>;
  /** Brands per subcategory */
  brandsBySubcategory: Record<string, BrandItem[]>;
  /** Base path, e.g. "/electronics" */
  basePath: string;
  /** Display name for the parent category, e.g. "Electronics" */
  categoryLabel: string;
  /** href of the parent category page, e.g. "/electronics" */
  categoryHref: string;
  /** Price range presets */
  priceRanges?: Array<{ label: string; min: string; max: string }>;
}

const DEFAULT_PRICE_RANGES = [
  { label: 'Any Price', min: '', max: '' },
  { label: 'Under $100', min: '', max: '100' },
  { label: '$100–$500', min: '100', max: '500' },
  { label: '$500–$1.5k', min: '500', max: '1500' },
  { label: '$1.5k–$5k', min: '1500', max: '5000' },
  { label: 'Over $5k', min: '5000', max: '' },
];

function BrandListingsContent({
  subcategories,
  brandsBySubcategory,
  basePath,
  categoryLabel,
  categoryHref,
  priceRanges = DEFAULT_PRICE_RANGES,
}: BrandListingsTemplateProps) {
  const params = useParams<{ subcategory: string; brand: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { country } = useCountry();

  const subcategorySlug = params?.subcategory || '';
  const brandSlug = params?.brand || '';

  const subcategoryMeta = subcategories[subcategorySlug] || {
    slug: subcategorySlug,
    label: subcategorySlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: '🏷️',
    color: 'from-gray-600 to-gray-800',
    desc: '',
  };

  const brands = brandsBySubcategory[subcategorySlug] || [];
  const siblingBrands = brands.filter((b) => b.slug !== brandSlug);
  const siblingBrandSlugsKey = siblingBrands.map((b) => b.slug).join(',');
  const brandMeta = brands.find((b) => b.slug === brandSlug) || {
    name: brandSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    slug: brandSlug,
    icon: '🏷️',
    color: subcategoryMeta.color,
  };

  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Sibling-brand ACTIVE listing counts, same approach and rationale as
  // BrandsPageTemplate's brandCounts — hides "Other Brands" links that
  // would themselves lead to an empty page. Falls back to showing every
  // sibling brand while counts are loading / if the batch fails.
  const [siblingBrandCounts, setSiblingBrandCounts] = useState<Record<string, number> | null>(null);
  const prevSiblingParamsRef = useRef('');

  const currentPage = parseInt(searchParams?.get('page') || '1');
  const sortBy = searchParams?.get('sort') || 'createdAt';
  const priceRange = searchParams?.get('priceRange') || '';

  useEffect(() => {
    setLoading(true);
    const qParams = new URLSearchParams();
    qParams.set('category', subcategorySlug);
    // Filter by the structured "brand" custom field (Listing.customFieldValues.brand),
    // not free-text search — see Category.fieldSchema for the admin-defined field.
    qParams.set('brand', brandMeta.name);
    qParams.set('page', String(currentPage));
    qParams.set('sort', sortBy);
    qParams.set('limit', '18');
    if (country) qParams.set('country', country);

    const pRange = priceRanges.find((r) => r.label === priceRange);
    if (pRange) {
      if (pRange.min) qParams.set('priceMin', pRange.min);
      if (pRange.max) qParams.set('priceMax', pRange.max);
    }

    api
      .get(`/listings?${qParams.toString()}`)
      .then(({ data }) => {
        setListings(data.listings || []);
        setTotal(data.pagination?.total || 0);
        setPages(data.pagination?.pages || 1);
      })
      .catch(() => setListings([]))
      .finally(() => setLoading(false));
  }, [subcategorySlug, brandMeta.name, currentPage, sortBy, priceRange, country, priceRanges]);

  useEffect(() => {
    if (!subcategorySlug || !siblingBrandSlugsKey) {
      setSiblingBrandCounts({});
      return;
    }

    const paramsKey = `${subcategorySlug}|${country}|${siblingBrandSlugsKey}`;
    if (paramsKey === prevSiblingParamsRef.current) return;
    prevSiblingParamsRef.current = paramsKey;

    const controller = new AbortController();
    setSiblingBrandCounts(null);

    Promise.all(
      siblingBrands.map((brand) => {
        const qParams = new URLSearchParams({ category: subcategorySlug, brand: brand.name, limit: '1' });
        if (country) qParams.set('country', country);
        return api
          .get(`/listings?${qParams.toString()}`, { signal: controller.signal })
          .then(({ data }) => [brand.slug, data.pagination?.total ?? (data.listings || []).length] as const)
          .catch(() => [brand.slug, 1] as const);
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const next: Record<string, number> = {};
      for (const [slug, count] of results) next[slug] = count;
      setSiblingBrandCounts(next);
    });

    return () => controller.abort();
    // siblingBrands deliberately omitted — see the identical pattern (and
    // rationale) in BrandsPageTemplate.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subcategorySlug, country, siblingBrandSlugsKey]);

  const visibleSiblingBrands = siblingBrandCounts
    ? siblingBrands.filter((brand) => (siblingBrandCounts[brand.slug] ?? 0) > 0)
    : siblingBrands;

  const updateParam = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams?.toString() || '');
    if (value) p.set(key, value);
    else p.delete(key);
    p.set('page', '1');
    router.push(`${basePath}/${subcategorySlug}/${brandSlug}?${p.toString()}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <h1 className="sr-only">{brandMeta.name} {subcategoryMeta.label}</h1>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-3">
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-gray-500">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 truncate">
            <Link href="/" className="hover:text-red-600">Home</Link>
            <span>/</span>
            <Link href={categoryHref} className="hover:text-red-600">{categoryLabel}</Link>
            <span>/</span>
            <Link href={`${basePath}/${subcategorySlug}`} className="hover:text-red-600">{subcategoryMeta.label}</Link>
            <span>/</span>
            <span className="font-semibold text-gray-700">{brandMeta.name}</span>
          </nav>
          <span className="shrink-0 font-semibold text-gray-600">
            {total > 0 ? `${total.toLocaleString('en-US')} listing${total !== 1 ? 's' : ''}` : 'No listings'}
          </span>
        </div>

        {/* Sibling brands: one scrolling chip row */}
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0">
          <Link
            href={`${basePath}/${subcategorySlug}`}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors border-gray-200 bg-white text-gray-700 hover:border-red-300 hover:text-red-700"
          >
            All {subcategoryMeta.label}
          </Link>
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors border-red-600 bg-red-600 text-white">
            <span aria-hidden="true">{brandMeta.icon}</span> {brandMeta.name}
          </span>
          {visibleSiblingBrands.filter((b) => b.slug !== brandSlug).map((b) => (
            <Link
              key={b.slug}
              href={`${basePath}/${subcategorySlug}/${b.slug}`}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors border-gray-200 bg-white text-gray-700 hover:border-red-300 hover:text-red-700"
            >
              <span aria-hidden="true">{b.icon}</span> {b.name}
            </Link>
          ))}
        </div>

        {/* Filters bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2 mb-3 flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600 whitespace-nowrap">Price:</label>
            <select
              value={priceRange}
              onChange={(e) => updateParam('priceRange', e.target.value === 'Any Price' ? '' : e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-red-300 outline-none"
            >
              {priceRanges.map((r) => (
                <option key={r.label}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-gray-600 whitespace-nowrap">Sort:</label>
            <select
              value={sortBy}
              onChange={(e) => updateParam('sort', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-700 focus:ring-2 focus:ring-red-300 outline-none"
            >
              <option value="createdAt">Newest</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="views">Most Popular</option>
            </select>
          </div>
          <Link
            href="/listings/create"
            className="ml-auto bg-amber-400 hover:bg-amber-300 text-black font-bold px-4 py-1.5 rounded-lg text-xs transition-colors"
          >
            + Post Ad
          </Link>
        </div>

        {/* Listings grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-7 gap-3">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-7 gap-3">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
            {pages > 1 && (
              <div className="mt-4 flex justify-center gap-2">
                {Array.from({ length: pages }, (_, i) => i + 1).map((pg) => (
                  <button
                    key={pg}
                    onClick={() => updateParam('page', String(pg))}
                    className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${
                      currentPage === pg
                        ? 'bg-red-600 text-white'
                        : 'bg-white border border-gray-200 text-gray-700 hover:bg-red-50'
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
            <div className="text-6xl mb-4">{brandMeta.icon}</div>
            <p className="text-xl font-bold text-gray-700 mb-2">No {brandMeta.name} {subcategoryMeta.label.toLowerCase()} listed yet</p>
            <p className="text-sm text-gray-400 mb-6">
              Be the first to list a {brandMeta.name} {subcategoryMeta.label.toLowerCase()}!
            </p>
            <Link
              href="/listings/create"
              className="inline-block bg-red-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-red-700 transition-colors"
            >
              Post Listing
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BrandListingsTemplate(props: BrandListingsTemplateProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-gray-500">Loading…</div>
        </div>
      }
    >
      <BrandListingsContent {...props} />
    </Suspense>
  );
}
