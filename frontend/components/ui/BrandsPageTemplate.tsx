'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ListingCard } from '@/components/listings/ListingCard';
import { Listing } from '@/lib/types';
import { useCountry } from '@/context/CountryContext';
import type { SubCategory } from './CategoryPageTemplate';

export interface BrandItem {
  name: string;
  slug: string;
  icon: string;
  color: string;
}

interface BrandsPageTemplateProps {
  subcategories: Record<string, SubCategory>;
  basePath: string;
  categoryLabel: string;
  categoryHref: string;
  brandsBySubcategory: Record<string, BrandItem[]>;
}

function BrandsPageContent({
  subcategories,
  basePath,
  categoryLabel,
  categoryHref,
  brandsBySubcategory,
}: BrandsPageTemplateProps) {
  const params = useParams<{ subcategory: string }>();
  const subcategorySlug = params?.subcategory || '';
  const { country } = useCountry();

  const meta = subcategories[subcategorySlug] || {
    slug: subcategorySlug,
    label: subcategorySlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: '🏷️',
    color: 'from-gray-600 to-gray-800',
    desc: '',
  };

  const brands = brandsBySubcategory[subcategorySlug] || [];
  // Stable key so the count-fetch effect below doesn't refire just because
  // `brands` got a fresh (but equal) array/object reference on some render.
  const brandSlugsKey = brands.map((b) => b.slug).join(',');

  const [listings, setListings]           = useState<Listing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [total, setTotal]                 = useState(0);

  // Per-brand ACTIVE listing counts within this subcategory, so brands with
  // zero matching listings can be hidden from "Browse by Brand" — mirrors the
  // same category+brand filter BrandListingsTemplate itself uses, so a brand
  // that's shown here is guaranteed to have at least one listing once
  // clicked. `null` = not loaded yet / request failed, in which case we
  // fall back to showing every brand rather than hiding the whole grid.
  const [brandCounts, setBrandCounts] = useState<Record<string, number> | null>(null);
  const prevBrandParamsRef = useRef('');

  useEffect(() => {
    if (!subcategorySlug || !brandSlugsKey) {
      setBrandCounts({});
      return;
    }

    const paramsKey = `${subcategorySlug}|${country}|${brandSlugsKey}`;
    if (paramsKey === prevBrandParamsRef.current) return;
    prevBrandParamsRef.current = paramsKey;

    const controller = new AbortController();
    setBrandCounts(null);

    Promise.all(
      brands.map((brand) => {
        // Structured "brand" custom field match (Listing.customFieldValues.brand),
        // not free-text search — mirrors BrandListingsTemplate's filter.
        const qParams = new URLSearchParams({ category: subcategorySlug, brand: brand.name, limit: '1' });
        if (country) qParams.set('country', country);
        return api
          .get(`/listings?${qParams.toString()}`, { signal: controller.signal })
          .then(({ data }) => [brand.slug, data.pagination?.total ?? (data.listings || []).length] as const)
          // A failed lookup (including this specific request being canceled)
          // shouldn't hide a brand that might genuinely have listings —
          // mark it with a count that keeps it visible. If the whole batch
          // was canceled (unmount / params changed), the `aborted` check
          // below skips applying any of this anyway.
          .catch(() => [brand.slug, 1] as const);
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const next: Record<string, number> = {};
      for (const [slug, count] of results) next[slug] = count;
      setBrandCounts(next);
    });

    return () => controller.abort();
    // `brands` deliberately omitted: brandSlugsKey already captures every
    // change to its contents that matters here (and, unlike `brands`, is a
    // primitive that doesn't get a new identity on every render for
    // subcategory slugs that aren't in `brandsBySubcategory`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subcategorySlug, country, brandSlugsKey]);

  // Fall back to showing every brand until counts are known.
  const visibleBrands = brandCounts
    ? brands.filter((brand) => (brandCounts[brand.slug] ?? 0) > 0)
    : brands;

  // Guard against redundant fetches
  const prevParamsRef = useRef('');

  useEffect(() => {
    if (!subcategorySlug) return;

    const paramsKey = `${subcategorySlug}|${country}`;
    if (paramsKey === prevParamsRef.current) return;
    prevParamsRef.current = paramsKey;

    const controller = new AbortController();
    setListingsLoading(true);

    const qParams = new URLSearchParams({ category: subcategorySlug, sort: 'createdAt', limit: '12' });
    if (country) qParams.set('country', country);

    api.get(`/listings?${qParams.toString()}`, { signal: controller.signal })
      .then(({ data }) => {
        setListings(data.listings || []);
        setTotal(data.pagination?.total ?? (data.listings || []).length);
      })
      .catch((err) => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        setListings([]);
      })
      .finally(() => setListingsLoading(false));

    return () => controller.abort();
  }, [subcategorySlug, country]);

  return (
    <div className="min-h-screen bg-gray-50">
      <h1 className="sr-only">{meta.label}</h1>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-3">
        {/* Breadcrumb + count: one slim line */}
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-gray-500">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 truncate">
            <Link href="/" className="hover:text-red-600">Home</Link>
            <span>/</span>
            <Link href={categoryHref} className="hover:text-red-600">{categoryLabel}</Link>
            <span>/</span>
            <span className="font-semibold text-gray-700">{meta.label}</span>
          </nav>
          <Link href={`/listings?category=${encodeURIComponent(subcategorySlug)}&sort=recommended`} className="shrink-0 font-semibold text-red-600 hover:text-red-700">
            {total > 0 ? `${total.toLocaleString('en-US')} listing${total !== 1 ? 's' : ''}` : 'View all'} →
          </Link>
        </div>

        {/* Brands: one horizontally scrolling chip row (hidden when none of this subcategory's brands have listings) */}
        {visibleBrands.length > 0 && (
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0">
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-red-600 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">All {meta.label}</span>
            {visibleBrands.map((brand) => (
              <Link
                key={brand.slug}
                href={`${basePath}/${subcategorySlug}/${brand.slug}`}
                className="shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-red-300 hover:text-red-700"
              >
                <span aria-hidden="true">{brand.icon}</span> {brand.name}
              </Link>
            ))}
          </div>
        )}

        <section>
          {listingsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-7 gap-3">
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
          ) : listings.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-7 gap-3">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-dashed border-gray-200 p-10 text-center">
              <div className="text-5xl mb-3">{meta.icon}</div>
              <p className="font-semibold text-gray-700">No {meta.label.toLowerCase()} listed yet</p>
              <p className="text-sm text-gray-400 mt-1">Be the first to post one!</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function BrandsPageTemplate(props: BrandsPageTemplateProps) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading…</div>
      </div>
    }>
      <BrandsPageContent {...props} />
    </Suspense>
  );
}
