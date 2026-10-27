/**
 * HomeAgriculturalSection
 *
 * Farm produce preview for the homepage, positioned right below Flash
 * Deals. Deliberately built the same way as CountryRecentAcrossCategories
 * rather than reusing the older HomeFarmerMarketplace/FarmerMarketplaceSection
 * widgets: those talk to the separate wholesale farmer-marketplace system
 * (JSON-file-backed FarmerPost/BuyerOffer negotiation, no admin-approval
 * gate, built for bulk B2B trade) — a different data model and posting
 * pipeline entirely. This section shows ordinary Listing rows in the
 * Agriculture category, fetched the exact same way Motors/Electronics/
 * Property/Fashion are on this page, so "posting produce" is just posting
 * a normal listing (open to every user for this one category — see
 * POST /listings — and still subject to admin approval like everything
 * else) rather than a second, parallel system to maintain.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useCountry } from '@/context/CountryContext';
import { ListingCard } from '@/components/listings/ListingCard';
import { RowCarousel } from '@/components/ui/RowCarousel';
import type { Listing } from '@/lib/types';
import { api } from '@/lib/api';

interface Props {
  initialListings: Listing[];
}

export default function HomeAgriculturalSection({ initialListings }: Props) {
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>(initialListings);
  const skipFirst = useRef(true);

  useEffect(() => {
    // The server already rendered this row for Uganda (the only country); fetching it again on mount only
    // duplicates the request. Later country changes still refetch.
    if (skipFirst.current) { skipFirst.current = false; if (country === 'UGANDA' && initialListings.length > 0) return; }
    let cancelled = false;
    api.get(`/listings?category=agriculture&country=${country}&limit=12&sort=createdAt`)
      .then(({ data }) => { if (!cancelled) setListings(data.listings || []); })
      .catch(() => { if (!cancelled) setListings([]); });
    return () => { cancelled = true; };
    // Only a country change should refetch; the initial props are read once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  if (listings.length === 0) return null;

  return (
    <section className="animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-lg xs:text-xl font-extrabold text-premium-navy flex items-center gap-1.5">
            <span aria-hidden="true">🌾</span> Farm Produce
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Fresh produce and farm supplies from sellers across Uganda</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/listings/create-produce"
            className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-colors interactive"
          >
            + Sell Produce
          </Link>
          <Link href="/agriculture" className="text-xs font-semibold text-premium-gold hover:text-premium-gold-dark interactive">
            View all
          </Link>
        </div>
      </div>

      {/* One row with back/forward arrows, like every other homepage section. */}
      <RowCarousel ariaLabel="Farm produce listings">
        {listings.slice(0, 12).map((listing) => (
          <ListingCard key={listing.id} listing={listing} compact />
        ))}
      </RowCarousel>
    </section>
  );
}
