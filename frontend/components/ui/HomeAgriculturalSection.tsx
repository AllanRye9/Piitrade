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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCountry } from '@/context/CountryContext';
import { ListingCard } from '@/components/listings/ListingCard';
import type { Listing } from '@/lib/types';
import { api } from '@/lib/api';

interface Props {
  initialListings: Listing[];
}

export default function HomeAgriculturalSection({ initialListings }: Props) {
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>(initialListings);

  useEffect(() => {
    let cancelled = false;
    api.get(`/listings?category=agriculture&country=${country}&limit=6&sort=createdAt`)
      .then(({ data }) => { if (!cancelled) setListings(data.listings || []); })
      .catch(() => { if (!cancelled) setListings([]); });
    return () => { cancelled = true; };
  }, [country]);

  if (listings.length === 0) return null;

  return (
    <section className="max-w-7xl mx-auto px-3 xs:px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <div>
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

      {/* Standard responsive grid — 2/row on phones, up to 6/row on desktop.
          Matches every other homepage listing section on this page. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {listings.slice(0, 6).map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </section>
  );
}
