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
  // zero matching listings can be hidden from "Shop by Brand" — mirrors the
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
              <p className="text-white/80 text-sm mt-1">Browse all {meta.label.toLowerCase()}, or filter by brand</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* All listings in this subcategory */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-extrabold text-gray-900">All {meta.label}</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {total > 0
                  ? `${total.toLocaleString('en-US')} listing${total !== 1 ? 's' : ''} across all brands`
                  : `Browse ${meta.label.toLowerCase()} listings`}
              </p>
            </div>
            <Link
              href={`/listings?category=${encodeURIComponent(subcategorySlug)}&sort=recommended`}
              className="text-sm font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1 transition-colors shrink-0"
            >
              View All
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>

          {listingsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
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

        {/* Shop by Brand — hidden entirely once we know none of this
            subcategory's brands have any matching listings, and each tile
            below is filtered the same way individually. */}
        {visibleBrands.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">Shop by Brand</h2>
                <p className="text-sm text-gray-500 mt-0.5">Select a brand to see its {meta.label.toLowerCase()} listings</p>
              </div>
              <Link
                href={`/listings?category=${encodeURIComponent(subcategorySlug)}&sort=recommended`}
                className="text-sm font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1 transition-colors"
              >
                View All {meta.label}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            {/* Brands grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              <Link
                href={`/listings?category=${encodeURIComponent(subcategorySlug)}&sort=recommended`}
                className="group flex flex-col items-center justify-center gap-3 p-5 bg-white rounded-2xl border-2 border-dashed border-gray-200 hover:border-sky-400 hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
              >
                <span className="text-3xl">🏷️</span>
                <span className="font-bold text-gray-800 text-sm text-center">All {meta.label}</span>
                <span className="text-xs text-gray-400">View all listings</span>
              </Link>

              {visibleBrands.map((brand) => (
                <Link
                  key={brand.slug}
                  href={`${basePath}/${subcategorySlug}/${brand.slug}`}
                  className={`group relative overflow-hidden flex flex-col items-center justify-center gap-3 p-5 rounded-2xl bg-gradient-to-br ${brand.color} text-white hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300`}
                >
                  <div className="absolute -top-4 -right-4 w-16 h-16 bg-white/10 rounded-full" />
                  <div className="absolute -bottom-4 -left-4 w-12 h-12 bg-white/10 rounded-full" />
                  <span className="text-3xl group-hover:scale-110 transition-transform duration-300 relative z-10">{brand.icon}</span>
                  <span className="font-bold text-sm text-center leading-tight relative z-10">{brand.name}</span>
                </Link>
              ))}
            </div>
          </>
        )}

        {/* Post Ad CTA */}
        <div className="mt-10 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-gray-900">Have a {meta.label} to sell?</h3>
            <p className="text-sm text-gray-500 mt-0.5">Post your listing and reach buyers across the region.</p>
          </div>
          <Link href="/listings/create" className="shrink-0 bg-amber-400 hover:bg-amber-300 text-black font-bold px-6 py-3 rounded-xl text-sm transition-colors shadow-sm">
            + Post Ad
          </Link>
        </div>
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
