/**
 * CountryLandingClient.tsx
 *
 * Shared client component used by all four country pages.
 *
 * Strategy:
 * - Fetch ALL active listings for the country once on mount (no category param).
 * - Client-side filter by listing.category.slug or listing.category.parentId
 *   when a tab is clicked — no extra network request needed.
 * - This ensures: All tab shows everything; category tabs filter the same dataset.
 * - Images: productImages[0].cdnUrl → listing.images[0] → placeholder (in that order).
 * - Per-country CSS animations applied to the header text.
 */
'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
// import Image from 'next/image';
import Link from 'next/link';
import { useCountry } from '@/context/CountryContext';
import { ListingCard } from '@/components/listings/ListingCard';
import { FlagIcon } from '@/components/ui/FlagIcon';
import type { Country, Listing } from '@/lib/types';
import { api } from '@/lib/api';

interface Props { country: Country; }

/* ── Per-country theme config ─────────────────────────────────────────────── */
const THEME: Record<Country, {
  name: string;
  isoCode: string;
  accent: string;
  currency: string;
  tagline: string;
  animClass: string;   // unique CSS animation class per country
}> = {
  UAE: {
    name:       'United Arab Emirates',
    isoCode:    'AE',
    accent:     '#C8A951',
    currency:   'AED',
    tagline:    'Premium marketplace for the Gulf region',
    animClass:  'anim-uae',    // shimmer / gold sweep
  },
  UGANDA: {
    name:       'Uganda',
    isoCode:    'UG',
    accent:     '#F5A623',
    currency:   'UGX',
    tagline:    'The Pearl of Africa marketplace',
    animClass:  'anim-uganda', // typewriter
  },
  KENYA: {
    name:       'Kenya',
    isoCode:    'KE',
    accent:     '#CE1126',
    currency:   'KES',
    tagline:    'Silicon Savannah — buy & sell smart',
    animClass:  'anim-kenya',  // bounce-in
  },
  CHINA: {
    name:       'China',
    isoCode:    'CN',
    accent:     '#DE2910',
    currency:   'CNY',
    tagline:    'Global wholesale gateway',
    animClass:  'anim-china',  // wave letters
  },
};

/* ── Category tabs — slugs match DB parent categories exactly ──────────────── */
const TABS = [
  { label: 'All',         slug: '',             icon: '🌐' },
  { label: 'Electronics', slug: 'electronics',  icon: '💻' },
  { label: 'Appliances',  slug: 'appliances',   icon: '🏠' },
  { label: 'Fashion',     slug: 'fashion',      icon: '👗' },
  { label: 'Motors',      slug: 'motors',       icon: '🚗' },
  { label: 'Property',    slug: 'property',     icon: '🏢' },
  { label: 'Jobs',        slug: 'jobs',         icon: '💼' },
  { label: 'Furniture',   slug: 'furniture',    icon: '🛋️' },
  { label: 'Services',    slug: 'services',     icon: '🔧' },
  { label: 'Classifieds', slug: 'classifieds',  icon: '📋' },
];

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Resolve the best available image URL for a listing.
 * Priority: productImages[0].cdnUrl → images[0] → null
 */
// function getBestImage(listing: Listing): string | null {
  // productImages are CDN-hosted uploads — always prefer these
  // const cdn = listing.productImages?.find((p) => p.cdnUrl)?.cdnUrl;
  // if (cdn) return cdn;
  // Fall back to the images string array (legacy / relative paths)
  // if (listing.images && listing.images.length > 0) return listing.images[0];
  // return null;
// }

/**
 * Determine whether a listing belongs to a given category tab slug.
 * A listing belongs if:
 *   (a) its own category.slug === tabSlug, OR
 *   (b) its category has a parent whose slug === tabSlug (child → parent match)
 *
 * We use the data already included in the listing (category.slug, category.parentId)
 * plus the allListings array to look up parent slugs without extra API calls.
 */
function listingMatchesTab(
  listing: Listing & { category?: { slug?: string; parentId?: string; parent?: { slug?: string } } },
  tabSlug: string,
  parentSlugById: Map<string, string>,
): boolean {
  if (!tabSlug) return true; // "All" tab — everything matches
  const catSlug = listing.category?.slug ?? '';
  // Direct match
  if (catSlug === tabSlug) return true;
  // Check parent via pre-built map (parentId → parent slug)
  const parentId = listing.category?.parentId;
  if (parentId) {
    const parentSlug = parentSlugById.get(parentId);
    if (parentSlug === tabSlug) return true;
  }
  // Check parent if returned directly in category object
  if (listing.category?.parent?.slug === tabSlug) return true;
  return false;
}

/* ── Component ──────────────────────────────────────────────────────────── */

export default function CountryLandingClient({ country }: Props) {
  const { setCountry } = useCountry();
  const theme = THEME[country];
  const didSetCountry = useRef(false);

  const [activeTabSlug, setActiveTabSlug] = useState('');
  const [allListings, setAllListings]     = useState<Listing[]>([]);
  const [loading, setLoading]             = useState(true);
  const [fetchError, setFetchError]       = useState('');
  // Map from categoryId → parent slug, built from returned listings
  const [parentSlugById, setParentSlugById] = useState<Map<string, string>>(new Map());

  const activeTab = TABS.find((t) => t.slug === activeTabSlug) ?? TABS[0];

  // Sync global country context once on mount
  useEffect(() => {
    if (!didSetCountry.current) {
      didSetCountry.current = true;
      setCountry(country);
    }
  }, [country, setCountry]);

  // Fetch ALL listings for this country once — tabs filter client-side
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setAllListings([]);
      setFetchError('');

      try {
        // Request a large page so we get everything in one shot.
        // No category param — we want the full country dataset.
        const { data } = await api.get('/listings', {
          params: {
            country,
            limit: '100',
            sort:  'createdAt',
          },
        });
        if (cancelled) return;

        const pool: Listing[] = Array.isArray(data.listings) ? data.listings : [];
        setAllListings(pool);

        // Build parentId → parent.slug lookup from what the API returned
        const map = new Map<string, string>();
        pool.forEach((l) => {
          const cat = l.category as (typeof l.category & { parentId?: string; parent?: { id?: string; slug?: string } }) | undefined;
          if (cat?.parentId && cat?.parent?.slug) {
            map.set(cat.parentId, cat.parent.slug);
          }
        });
        setParentSlugById(map);
      } catch (err: unknown) {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : 'Failed to load listings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [country]); // only re-fetch when country changes — tab switches are client-side

  // Client-side filter: derived from allListings + activeTabSlug
  const visibleListings = useMemo(() => {
    if (!activeTabSlug) return allListings;
    return allListings.filter((l) =>
      listingMatchesTab(
        l as Listing & { category?: { slug?: string; parentId?: string; parent?: { slug?: string } } },
        activeTabSlug,
        parentSlugById,
      )
    );
  }, [allListings, activeTabSlug, parentSlugById]);

  // Only show tabs that have at least one listing (plus always show "All")
  const tabsWithData = useMemo(() => {
    return TABS.filter((tab) => {
      if (!tab.slug) return true; // always show All
      return allListings.some((l) =>
        listingMatchesTab(
          l as Listing & { category?: { slug?: string; parentId?: string; parent?: { slug?: string } } },
          tab.slug,
          parentSlugById,
        )
      );
    });
  }, [allListings, parentSlugById]);

  return (
    <>
      {/* Per-country CSS animations injected once */}
      <style>{`
        /* UAE — gold shimmer sweep */
        @keyframes shimmer-gold {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }
        .anim-uae {
          background: linear-gradient(90deg, #C8A951 0%, #fffbe0 40%, #C8A951 60%, #a07820 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: shimmer-gold 3s linear infinite;
        }

        /* UGANDA — typewriter cursor blink */
        @keyframes typewriter {
          from { clip-path: inset(0 100% 0 0); }
          to   { clip-path: inset(0 0%   0 0); }
        }
        @keyframes blink {
          50% { border-color: transparent; }
        }
        .anim-uganda {
          display: inline-block;
          overflow: hidden;
          border-right: 2px solid #F5A623;
          white-space: nowrap;
          animation: typewriter 1.8s steps(30,end) forwards,
                     blink      0.6s step-end 1.8s infinite;
        }

        /* KENYA — bounce-in from below */
        @keyframes bounce-in {
          0%   { transform: translateY(24px); opacity: 0; }
          60%  { transform: translateY(-6px); opacity: 1; }
          80%  { transform: translateY(3px); }
          100% { transform: translateY(0); }
        }
        .anim-kenya {
          animation: bounce-in 0.8s cubic-bezier(.36,.07,.19,.97) both;
        }

        /* CHINA — wave letters (applied via JS letter split below) */
        @keyframes wave {
          0%, 100% { transform: translateY(0);   }
          50%       { transform: translateY(-6px); }
        }
        .anim-china .wave-letter {
          display: inline-block;
          animation: wave 1.2s ease-in-out infinite;
        }
        .anim-china .wave-letter:nth-child(1)  { animation-delay: 0.00s; }
        .anim-china .wave-letter:nth-child(2)  { animation-delay: 0.06s; }
        .anim-china .wave-letter:nth-child(3)  { animation-delay: 0.12s; }
        .anim-china .wave-letter:nth-child(4)  { animation-delay: 0.18s; }
        .anim-china .wave-letter:nth-child(5)  { animation-delay: 0.24s; }
        .anim-china .wave-letter:nth-child(6)  { animation-delay: 0.30s; }
        .anim-china .wave-letter:nth-child(7)  { animation-delay: 0.36s; }
        .anim-china .wave-letter:nth-child(8)  { animation-delay: 0.42s; }
        .anim-china .wave-letter:nth-child(9)  { animation-delay: 0.48s; }
        .anim-china .wave-letter:nth-child(10) { animation-delay: 0.54s; }
        .anim-china .wave-letter:nth-child(11) { animation-delay: 0.60s; }
        .anim-china .wave-letter:nth-child(12) { animation-delay: 0.66s; }
        .anim-china .wave-letter:nth-child(13) { animation-delay: 0.72s; }
        .anim-china .wave-letter:nth-child(14) { animation-delay: 0.78s; }
        .anim-china .wave-letter:nth-child(15) { animation-delay: 0.84s; }
        .anim-china .wave-letter:nth-child(16) { animation-delay: 0.90s; }
        .anim-china .wave-letter:nth-child(17) { animation-delay: 0.96s; }
        .anim-china .wave-letter:nth-child(18) { animation-delay: 1.02s; }
        .anim-china .wave-letter:nth-child(19) { animation-delay: 1.08s; }
        .anim-china .wave-letter:nth-child(20) { animation-delay: 1.14s; }
      `}</style>

      <div className="min-h-screen bg-gray-50/90">
        <div className="max-w-7xl mx-auto px-4 py-4">

          {/* ── Country identity header ───────────────────────────── */}
          <div
            className="flex items-center gap-4 mb-5 pb-4 border-b border-gray-100"
          >
            {/* Flag — large enough to be clearly visible */}
            <div className="shrink-0 rounded-xl overflow-hidden shadow ring-2 ring-black/10 w-14 h-14 flex items-center justify-center bg-white">
              <FlagIcon code={theme.isoCode} size={52} />
            </div>

            {/* Name + slogan */}
            <div className="flex-1 min-w-0">
              {/* Animated country name — each country has its own animation */}
              <h1
                className={`text-xl sm:text-2xl font-extrabold leading-tight ${theme.animClass}`}
                style={{ color: theme.accent }}
              >
                {country === 'CHINA'
                  // Wave animation: split into individual letter spans
                  ? theme.name.split('').map((ch, i) => (
                      <span key={i} className="wave-letter">{ch === ' ' ? '\u00A0' : ch}</span>
                    ))
                  : theme.name}
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">{theme.tagline}</p>
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-300 mt-0.5">
                PIITRADE · SHOP SMART. SHOP TRUSTED.
              </p>
            </div>

            {/* Currency chip + sell CTA */}
            <div className="shrink-0 flex flex-col items-end gap-1.5">
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-full text-white"
                style={{ backgroundColor: theme.accent }}
              >
                {theme.currency}
              </span>
              <Link
                href={`/listings/create?country=${country}`}
                className="text-xs font-bold px-3 py-1.5 rounded-lg border-2 transition-all hover:text-white hover:bg-opacity-90"
                style={{ borderColor: theme.accent, color: theme.accent }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = theme.accent; (e.currentTarget as HTMLAnchorElement).style.color = '#fff'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = theme.accent; }}
              >
                + Sell
              </Link>
            </div>
          </div>

          {/* ── Category Tab Strip ─────────────────────────────────── */}
          <div
            className="flex gap-2 overflow-x-auto pb-2 mb-5 scrollbar-hide"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {tabsWithData.map((tab) => {
              const isActive = tab.slug === activeTabSlug;
              return (
                <button
                  key={tab.slug}
                  type="button"
                  onClick={() => setActiveTabSlug(tab.slug)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold border transition-all duration-200 ${
                    isActive
                      ? 'text-white border-transparent shadow-md scale-105'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:bg-gray-50'
                  }`}
                  style={isActive ? { background: theme.accent, borderColor: theme.accent } : {}}
                >
                  <span aria-hidden="true">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* ── Listings ───────────────────────────────────────────── */}
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="rounded-xl bg-gray-100 animate-pulse aspect-[3/4]" />
              ))}
            </div>

          ) : fetchError ? (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-6 py-10 text-center">
              <p className="font-semibold text-red-600 mb-1">Could not load listings</p>
              <p className="text-xs text-red-400 mb-4">{fetchError}</p>
              <button
                type="button"
                onClick={() => { setFetchError(''); setLoading(true); setActiveTabSlug(''); }}
                className="px-5 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700"
              >
                Retry
              </button>
            </div>

          ) : visibleListings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-16 text-center">
              <p className="text-4xl mb-3">{activeTab.icon}</p>
              <p className="text-base font-bold text-gray-700">
                No {activeTab.label !== 'All' ? `${activeTab.label} ` : ''}listings in {theme.name} yet
              </p>
              <p className="mt-1 text-sm text-gray-400">
                {activeTabSlug
                  ? `Try another category or be the first to post ${activeTab.label} in ${theme.name}.`
                  : `Be the first to list something in ${theme.name}!`}
              </p>
              <Link
                href={`/listings/create?country=${country}`}
                className="mt-5 inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white shadow"
                style={{ backgroundColor: theme.accent }}
              >
                + Post a Listing
              </Link>
            </div>

          ) : (
            <>
              {/* Section heading */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-extrabold text-gray-800 flex items-center gap-2">
                  <span>{activeTab.icon}</span>
                  {activeTab.label === 'All'
                    ? `All Listings — ${theme.name}`
                    : `${activeTab.label} in ${theme.name}`}
                  <span className="text-xs font-normal text-gray-400">
                    ({visibleListings.length})
                  </span>
                </h2>
                <Link
                  href={`/listings?country=${country}${activeTabSlug ? `&category=${activeTabSlug}` : ''}`}
                  className="text-xs font-semibold hover:opacity-75 transition-opacity"
                  style={{ color: theme.accent }}
                >
                  View all →
                </Link>
              </div>

              {/* Listings grid — uses ListingCard which already handles image resolution */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                {visibleListings.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>

              <div className="mt-8 text-center">
                <Link
                  href={`/listings?country=${country}${activeTabSlug ? `&category=${activeTabSlug}` : ''}`}
                  className="inline-flex items-center gap-2 rounded-xl px-8 py-3 text-sm font-bold text-white shadow-md transition-all hover:opacity-90"
                  style={{ backgroundColor: theme.accent }}
                >
                  View All {theme.name} {activeTabSlug ? activeTab.label : 'Listings'} →
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
