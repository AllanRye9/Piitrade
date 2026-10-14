'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useCountry } from '@/context/CountryContext';
import { ListingCard } from '@/components/listings/ListingCard';
import { MobileCardCarousel } from '@/components/ui/MobileCardCarousel';
import OfferCountdown from '@/components/ui/OfferCountdown';
import type { Listing } from '@/lib/types';
import { T } from '@/components/ui/T';

/**
 * Special Offers — home page strip (all screen sizes).
 *
 * GET /api/listings/special-offers applies everything server-side: the
 * admin's section switch + schedule window, and the minimum-discount
 * threshold against each listing's seller-declared original price. It
 * returns nothing when the section is off, so this just hides itself.
 */
export default function SpecialOffersSection() {
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [minDiscount, setMinDiscount] = useState<number | null>(null);
  const [endAt, setEndAt] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api
      .get('/listings/special-offers', { params: { country, limit: 8 }, signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setListings((data.listings || []) as Listing[]);
        setMinDiscount(typeof data.minDiscountPercent === 'number' ? data.minDiscountPercent : null);
        setEndAt(data.endAt || null);
        setTotal(data.total || 0);
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
    <section aria-labelledby="special-offers-heading">
      <div className="rounded-2xl overflow-hidden border border-red-100 bg-gradient-to-br from-red-50 via-white to-orange-50">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <Link href="/special-offers" className="flex min-w-0 flex-1 items-center gap-3">
            <div className="shrink-0 w-11 h-11 rounded-xl bg-red-600 text-white shadow-sm flex items-center justify-center text-lg font-black" aria-hidden="true">%</div>
            <div className="min-w-0">
              <h2 id="special-offers-heading" className="font-black text-gray-900 leading-tight text-[15px] sm:text-lg truncate">
                <span className="text-red-600"><T>SPECIAL OFFERS</T></span>
              </h2>
              <p className="text-[11px] sm:text-xs text-gray-500 truncate">
                {minDiscount != null ? `${minDiscount}% off and more` : 'Big savings'}{total > 0 ? ` · ${total} deal${total === 1 ? '' : 's'}` : ''}
              </p>
            </div>
          </Link>
          <OfferCountdown endAt={endAt} className="hidden xs:inline-flex" />
          <Link href="/special-offers" className="shrink-0 text-xs font-bold text-red-600 hover:text-red-700 whitespace-nowrap">
            View all →
          </Link>
        </div>

        <div className="px-3 pb-3">
          {loading ? (
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-xl bg-white/70 aspect-[3/4]" />
              ))}
            </div>
          ) : (
            <MobileCardCarousel gridClassName="sm:grid-cols-3 md:grid-cols-4 gap-2.5" ariaLabel="Special offers">
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
