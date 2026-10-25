'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCountry } from '@/context/CountryContext';
import { ListingCard } from '@/components/listings/ListingCard';
import { RowCarousel } from '@/components/ui/RowCarousel';
import OfferCountdown from '@/components/ui/OfferCountdown';
import type { Listing } from '@/lib/types';
import { T } from '@/components/ui/T';

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
  const [endAt, setEndAt] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    api
      .get('/listings/back-to-school', { params: { country, limit: 12 }, signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setListings((data.listings || []) as Listing[]);
        setEndAt(data.endAt || null);
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
    <section aria-labelledby="back-to-school-heading">
      <div className="rounded-2xl overflow-hidden bg-[var(--theme-bg-light)] border border-orange-100">
        {/* Banner header */}
        <Link href="/back-to-school" className="flex items-center gap-2 sm:gap-3 px-2.5 py-2 sm:px-3.5 sm:py-3">
          <div className="shrink-0 w-8 h-8 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl bg-white shadow-sm flex items-center justify-center text-base sm:text-xl">
            🎒
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="back-to-school-heading" className="font-black text-gray-900 leading-tight text-xs sm:text-lg truncate">
              <span className="text-[var(--theme-primary)]"><T>BACK TO SCHOOL</T></span> <span aria-hidden="true">⚡</span>
            </h2>
            <p className="text-[10px] sm:text-xs text-gray-500 truncate">
              <T>Hand-picked for the new term, while stocks last</T>
            </p>
          </div>
          <OfferCountdown endAt={endAt} className="hidden xs:inline-flex" />
          <span className="shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-700">
            <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </Link>

        {/* Three cards per row on mobile (matches the reference layout),
            collapsing into the standard responsive grid at sm+ - same
            RowCarousel + ListingCard pairing used by Flash Deals,
            so this section looks and behaves like the rest of the site
            rather than its own one-off peeking scroller. */}
        <div className="px-2.5 pb-2.5 sm:px-3 sm:pb-3 -mt-0.5">
          {loading ? (
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-xl bg-white/70 aspect-[3/4] shrink-0 basis-[clamp(8.5rem,39.5vw,11rem)] min-[480px]:basis-[7rem] sm:basis-[9.25rem] md:basis-[10rem] lg:basis-[11.5rem]" />
              ))}
            </div>
          ) : (
            <RowCarousel ariaLabel="Back to school listings">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} compact />
              ))}
            </RowCarousel>
          )}
        </div>
      </div>
    </section>
  );
}
