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

interface WhyItem {
  icon: string;
  title: string;
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
  whyItems?: WhyItem[];
}

const DEFAULT_WHY_ITEMS: WhyItem[] = [
  { icon: '🔒', title: 'Verified Sellers',    desc: 'All sellers are verified for your safety and peace of mind.' },
  { icon: '📸', title: 'High-Quality Photos', desc: 'Listings feature detailed images reviewed by our team.' },
  { icon: '💬', title: 'Direct Messaging',    desc: 'Chat directly with sellers to negotiate and inspect.' },
  { icon: '🌍', title: 'Regional Coverage',   desc: 'Listings across UAE, Uganda, Kenya and China.' },
];

const SORT_OPTS = [
  { value: 'createdAt'  as const, label: 'Newest' },
  { value: 'price_asc'  as const, label: 'Price ↑' },
  { value: 'price_desc' as const, label: 'Price ↓' },
  { value: 'views'      as const, label: 'Popular' },
];

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
  whyItems = DEFAULT_WHY_ITEMS,
}: CategoryPageTemplateProps) {
  const { country } = useCountry();
  const [recentListings, setRecentListings] = useState<Listing[]>([]);
  const [loading, setLoading]               = useState(true);
  const [sort, setSort]                     = useState<'createdAt' | 'price_asc' | 'price_desc' | 'views'>('createdAt');
  const [total, setTotal]                   = useState(0);

  // Hide subcategories with zero ACTIVE listings in this country until a
  // listing gets posted into them. If the counts request fails or hasn't
  // resolved yet, `counts` is null and we fall back to showing every
  // subcategory rather than hiding the whole grid on a transient error.
  const { counts: subcategoryCounts } = useActiveSubcategoryCounts(country);
  const visibleSubcategories = subcategoryCounts
    ? subcategories.filter((sub) => (subcategoryCounts[sub.slug] ?? 0) > 0)
    : subcategories;

  // Track previous fetch params to avoid redundant re-fetches
  const prevParamsRef = useRef('');

  useEffect(() => {
    // Build a stable string key for the current params
    const paramsKey = `${categorySlug}|${country}|${sort}`;
    if (paramsKey === prevParamsRef.current) return; // nothing changed — skip
    prevParamsRef.current = paramsKey;

    const controller = new AbortController();
    setLoading(true);

    const params = new URLSearchParams({
      category: categorySlug,
      sort,
      limit: '24',
    });
    if (country) params.set('country', country);

    api.get(`/listings?${params}`, { signal: controller.signal })
      .then(({ data }) => {
        setRecentListings((data.listings || []).slice(0, 12));
        setTotal(data.pagination?.total ?? (data.listings || []).length);
      })
      .catch((err) => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        setRecentListings([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [categorySlug, country, sort]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className={`relative overflow-hidden bg-gradient-to-br ${heroGradient} text-white py-10 sm:py-16`}>
        <div
          className="absolute inset-0 opacity-20"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.08'%3E%3Ccircle cx='30' cy='30' r='20'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}
        />
        <div className="relative max-w-7xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 px-4 py-1.5 rounded-full text-sm font-medium mb-4">
            <span>{heroIcon}</span> {categoryLabel} Marketplace
          </div>
          <h1 className="text-3xl sm:text-5xl font-black mb-3">{heroTitle}</h1>
          <p className="text-gray-300 text-base sm:text-lg max-w-xl mx-auto mb-6">{heroSubtitle}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/listings/create" className="bg-amber-400 hover:bg-amber-300 text-black font-bold px-6 py-3 rounded-xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 text-sm">
              {postCtaLabel}
            </Link>
            <Link href={`${basePath}/${(visibleSubcategories[0] ?? subcategories[0])?.slug ?? ''}`} className="bg-white/10 hover:bg-white/20 border border-white/30 text-white font-semibold px-6 py-3 rounded-xl transition-all text-sm">
              Browse {(visibleSubcategories[0] ?? subcategories[0])?.label ?? categoryLabel}
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-10">
        {/* Subcategory grid */}
        {visibleSubcategories.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-extrabold text-gray-900">Browse by Type</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {visibleSubcategories.map((sub) => (
                <Link
                  key={sub.slug}
                  href={`${basePath}/${sub.slug}`}
                  className={`group relative overflow-hidden rounded-xl p-4 bg-gradient-to-br ${sub.color} text-white hover:shadow-xl hover:-translate-y-1 transition-all duration-300`}
                >
                  <div className="absolute -top-3 -right-3 w-12 h-12 bg-white/10 rounded-full" />
                  <div className="text-3xl mb-2 group-hover:scale-110 transition-transform duration-300 inline-block">{sub.icon}</div>
                  <h3 className="font-bold text-sm leading-tight">{sub.label}</h3>
                  <p className="text-[10px] opacity-75 mt-0.5 leading-tight hidden sm:block">{sub.desc}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Recent listings */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-base sm:text-xl font-extrabold text-gray-900">Recent Listings</h2>
              <p className="text-xs sm:text-sm text-gray-500">
                {categoryLabel} listings{country ? ` in ${country}` : ''}
                {total > 0 && ` — ${total.toLocaleString('en-US')} total`}
              </p>
            </div>
            <Link
              href={`/listings?category=${encodeURIComponent(categorySlug)}${country ? `&country=${country}` : ''}`}
              className="text-sm font-semibold text-sky-600 hover:text-sky-700 flex items-center gap-1 self-start sm:self-auto"
            >
              View all
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
              </svg>
            </Link>
          </div>

          {/* Sort tabs */}
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 scrollbar-none">
            {SORT_OPTS.map(opt => (
              <button key={opt.value} onClick={() => setSort(opt.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                  sort === opt.value ? 'bg-sky-600 text-white shadow-sm' : 'bg-white text-gray-600 border border-gray-200 hover:border-sky-300'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>

          {loading ? (
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
          ) : recentListings.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {recentListings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-dashed border-gray-200 p-12 text-center">
              <div className="text-5xl mb-3">{heroIcon}</div>
              <p className="font-semibold text-gray-700">No {categoryLabel.toLowerCase()} listings yet</p>
              <p className="text-sm text-gray-400 mt-1">Be the first to post a {categoryLabel.toLowerCase()} ad!</p>
              <Link href="/listings/create" className="mt-4 inline-block bg-sky-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-sky-700 transition-colors">
                Post Ad
              </Link>
            </div>
          )}
        </section>

        {/* Why use Piitrade */}
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8">
          <h2 className="text-xl font-extrabold text-gray-900 mb-6 text-center">Why Use Piitrade {categoryLabel}?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {whyItems.map((item) => (
              <div key={item.title} className="text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-sky-50 flex items-center justify-center text-2xl">{item.icon}</div>
                <h3 className="font-bold text-gray-800 text-sm mb-1">{item.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
