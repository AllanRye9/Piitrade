/**
 * CountryLatestCollections
 * Re-fetches Latest Collections listings when the selected country changes.
 */
'use client';

import { useEffect, useState } from 'react';
import { useCountry } from '@/context/CountryContext';
import { ListingCard } from '@/components/listings/ListingCard';
import type { Listing } from '@/lib/types';
import { API_URL } from '@/lib/api';


interface Props { initialListings: Listing[]; }

export default function CountryLatestCollections({ initialListings }: Props) {
  const { country } = useCountry();
  const [listings, setListings] = useState<Listing[]>(initialListings);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/listings/latest-collections?limit=6&country=${country}`)
      .then((r) => r.ok ? r.json() : { listings: [] })
      .then((data) => { if (!cancelled) setListings(data.listings || []); })
      .catch(() => { if (!cancelled) setListings([]); });
    return () => { cancelled = true; };
  }, [country]);

  if (listings.length === 0) return null;

  // Standard responsive grid — 2/row on phones, up to 6/row on desktop.
  // Was a 3-per-row carousel on mobile; same readability fix as the other
  // homepage sections above.
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 stagger-children">
      {listings.slice(0, 6).map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}
