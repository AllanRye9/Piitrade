/**
 * CountryFeaturedDeal
 *
 * Re-fetches the Featured Deal listing(s) when the selected country changes.
 * Displays up to 6 items in a single responsive row:
 *   desktop  → 6 columns
 *   tablet   → 3–4 columns
 *   mobile   → 2 columns
 */
'use client';

import { useEffect, useState } from 'react';
import { useCountry } from '@/context/CountryContext';
import type { Listing } from '@/lib/types';
import FeaturedProductCard from '@/components/ui/FeaturedProductCard';
import { API_URL } from '@/lib/api';

interface Props {
  /** The server-fetched deal for the initial render (SSR / hydration). */
  initialDeal: Listing | null;
}

/** Resolve the best image URL from a listing. */
function resolveListingImage(listing: Listing): string | undefined {
  return (
    (listing.productImages as Array<{ cdnUrl: string }> | undefined)
      ?.find((p) => p.cdnUrl)?.cdnUrl ??
    listing.images?.[0]
  );
}

export default function CountryFeaturedDeal({ initialDeal }: Props) {
  const { country } = useCountry();

  // We show up to 6 featured-deal listings.
  const [deals, setDeals] = useState<Listing[]>(
    initialDeal ? [initialDeal] : []
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    // Request more than 1 so we can fill the row; backend may return 1–6.
    fetch(`${API_URL}/api/listings/featured-deal?country=${country}&limit=6`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        // Backend may return a single object OR { listings: [...] }
        if (!data) {
          setDeals([]);
        } else if (Array.isArray(data.listings)) {
          setDeals(data.listings.slice(0, 6));
        } else if (Array.isArray(data)) {
          setDeals(data.slice(0, 6));
        } else if (data.id) {
          // Single listing object
          setDeals([data as Listing]);
        } else {
          setDeals([]);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setDeals([]);
          setReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [country]);

  // ── Loading skeleton (6 card placeholders) ────────────────────────────────
  if (!ready) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse"
          >
            <div className="aspect-[4/3] bg-gradient-to-br from-sky-100 to-indigo-100" />
            <div className="p-2 space-y-1.5">
              <div className="h-2.5 bg-gray-200 rounded w-3/4" />
              <div className="h-2 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (deals.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-6">
        No featured deal available for {country} right now.
      </p>
    );
  }

  // ── 6-column responsive grid ──────────────────────────────────────────────
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
      {deals.map((deal) => (
        <FeaturedProductCard
          key={deal.id}
          storeName={deal.user?.name || '3R Elite Store'}
          title={deal.title}
          description={deal.description}
          originalPrice={
            deal.originalPrice
              ? `${deal.currency} ${deal.originalPrice.toLocaleString()}`
              : undefined
          }
          discountedPrice={`${deal.currency} ${deal.price?.toLocaleString()}`}
          imageUrl={resolveListingImage(deal)}
          href={`/listings/${deal.id}`}
          isHandpicked
          listing={deal}
        />
      ))}
    </div>
  );
}
