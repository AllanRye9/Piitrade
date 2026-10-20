'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCountry } from '@/context/CountryContext';
import { ListingCard } from '@/components/listings/ListingCard';
import { MobileCardCarousel } from '@/components/ui/MobileCardCarousel';
import type { Listing } from '@/lib/types';
import { T } from '@/components/ui/T';

/**
 * FlashDealsSection
 *
 * Homepage row for listings an admin has placed as FLASH_SALE (Admin ->
 * Listings -> approve/edit, ordered at Admin -> Homepage Layout). Flash
 * listings are kept out of the general feed, so this row (and
 * /listings?placement=FLASH_SALE) is where they are shown. Self-hides when
 * there are none.
 */
export default function FlashDealsSection() {
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api
      .get('/listings/flash-sales', { params: { country, limit: 12 }, signal: controller.signal })
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
    <section aria-labelledby="flash-deals-heading" className="animate-fade-up rounded-2xl border border-red-200 bg-gradient-to-r from-red-50/70 to-orange-50/50 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 id="flash-deals-heading" className="text-base xs:text-lg sm:text-xl font-extrabold text-premium-navy flex items-center gap-1.5 min-w-0">
          <span aria-hidden="true">⚡</span>
          <span className="truncate"><T>Flash Deals</T></span>
        </h2>
        <Link
          href="/listings?placement=FLASH_SALE"
          className="shrink-0 text-xs font-semibold text-white bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 px-3 py-1.5 rounded-lg flex items-center gap-1 interactive shadow-sm"
        >
          <T>View all</T>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl bg-white/70 aspect-[3/4]" />
          ))}
        </div>
      ) : (
        <MobileCardCarousel gridClassName="sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5" ariaLabel="Flash deal listings">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </MobileCardCarousel>
      )}
    </section>
  );
}
