'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCountry } from '@/context/CountryContext';
import { ListingCard } from '@/components/listings/ListingCard';
import { MobileCardCarousel } from '@/components/ui/MobileCardCarousel';
import type { Listing } from '@/lib/types';

/**
 * BackToSchoolSection
 *
 * Fully admin-controlled: an admin assigns listings into this section via
 * Listing.placement = 'BACK_TO_SCHOOL' (Admin -> Listings -> Approve/Edit,
 * same mechanism as Flash Deals/Featured Deal/Latest Collections), and
 * turns the section itself on/off - with an optional scheduled window - via
 * SiteConfig.backToSchool (Admin -> Settings -> "Back to School" section).
 *
 * GET /api/listings/back-to-school does both checks server-side (section
 * enabled + within its scheduled window, if one is set) and returns an
 * empty list when either fails, so this component only has to decide
 * whether to render at all based on what comes back - no separate
 * "is this feature on" fetch needed.
 */
export default function BackToSchoolSection() {
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    api
      .get('/listings/back-to-school', { params: { country, limit: 8 }, signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setListings((data.listings || []) as Listing[]);
        setLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setListings([]);
        setLoading(false);
      });

    return () => controller.abort();
  }, [country]);

  if (!loading && listings.length === 0) return null;

  return (
    <section className="sm:hidden">
      <div className="rounded-2xl overflow-hidden bg-[var(--theme-bg-light)] border border-orange-100">
        {/* Banner header */}
        <Link href="/listings?placement=BACK_TO_SCHOOL" className="flex items-center gap-3 px-3.5 py-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-white shadow-sm flex items-center justify-center text-xl">
            🎒
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-black text-gray-900 leading-tight text-[15px] truncate">
              <span className="text-[var(--theme-primary)]">BACK TO SCHOOL</span> <span aria-hidden="true">⚡</span>
            </p>
            <p className="text-[11px] text-gray-500 truncate">
              Admin picks for the new term, while stocks last
            </p>
          </div>
          <span className="shrink-0 w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </Link>

        {/* Three cards per row on mobile (matches the reference layout),
            collapsing into the standard responsive grid at sm+ - same
            MobileCardCarousel + ListingCard pairing used by Flash Deals,
            so this section looks and behaves like the rest of the site
            rather than its own one-off peeking scroller. */}
        <div className="px-3 pb-3 -mt-0.5">
          {loading ? (
            <div className="grid grid-cols-3 gap-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-xl bg-white/70 aspect-[3/4]" />
              ))}
            </div>
          ) : (
            <MobileCardCarousel gridClassName="sm:grid-cols-3 md:grid-cols-4 gap-2.5" ariaLabel="Back to school listings">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </MobileCardCarousel>
          )}
        </div>
      </div>
    </section>
  );
}
